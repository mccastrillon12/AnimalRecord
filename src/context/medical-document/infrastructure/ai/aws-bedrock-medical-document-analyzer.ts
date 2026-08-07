import { Inject, Injectable } from '@nestjs/common';
import {
  BedrockDataAutomationRuntimeClient,
  GetDataAutomationStatusCommand,
  InvokeDataAutomationAsyncCommand,
} from '@aws-sdk/client-bedrock-data-automation-runtime';
import {
  MedicalDocumentAnalysisJobResult,
  MedicalDocumentAnalysisJobStatus,
  MedicalDocumentAnalyzer,
} from '../../domain/medical-document-analyzer';
import { MedicalDocumentStorage } from '../../domain/medical-document-storage';
import { EnvironmentConfigService } from '../../../shared/infrastructure/config/environment/environment.service';
import { ExternalServiceError } from '../../../shared/domain/errors/ExternalServiceError';
import { MedicalDocumentExtractionMapper } from './medical-document-extraction-mapper';

type OutputSegmentFiles = {
  customOutput?: string;
  standardOutput?: string;
};

@Injectable()
export class AwsBedrockMedicalDocumentAnalyzer implements MedicalDocumentAnalyzer {
  private readonly client: BedrockDataAutomationRuntimeClient;

  constructor(
    private readonly configService: EnvironmentConfigService,
    private readonly mapper: MedicalDocumentExtractionMapper,
    @Inject('MedicalDocumentStorage')
    private readonly storage: MedicalDocumentStorage,
  ) {
    const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

    this.client = new BedrockDataAutomationRuntimeClient({
      region: this.configService.getAwsBedrockDataAutomationRegion(),
      credentials:
        accessKeyId && secretAccessKey
          ? {
              accessKeyId,
              secretAccessKey,
              sessionToken: process.env.AWS_SESSION_TOKEN,
            }
          : undefined,
    });
  }

  async start(
    inputS3Uri: string,
    outputS3Uri: string,
    clientToken: string,
  ): Promise<string> {
    const { dataAutomationProfileArn, dataAutomationProjectArn } =
      this.configuration();

    try {
      const response = await this.client.send(
        new InvokeDataAutomationAsyncCommand({
          clientToken,
          inputConfiguration: { s3Uri: inputS3Uri },
          outputConfiguration: { s3Uri: outputS3Uri },
          dataAutomationConfiguration: {
            dataAutomationProjectArn,
            stage: 'LIVE',
          },
          dataAutomationProfileArn,
        }),
      );
      if (!response.invocationArn) {
        throw new ExternalServiceError(
          'Bedrock Data Automation did not return an invocation ARN',
        );
      }
      return response.invocationArn;
    } catch (error) {
      if (error instanceof ExternalServiceError) throw error;
      throw new ExternalServiceError(
        'Bedrock Data Automation could not start the document analysis',
      );
    }
  }

  async getResult(
    invocationArn: string,
    outputS3Uri: string,
  ): Promise<MedicalDocumentAnalysisJobResult> {
    try {
      const response = await this.client.send(
        new GetDataAutomationStatusCommand({ invocationArn }),
      );
      if (response.status === 'Created' || response.status === 'InProgress') {
        return { status: MedicalDocumentAnalysisJobStatus.InProgress };
      }
      if (
        response.status === 'ServiceError' ||
        response.status === 'ClientError'
      ) {
        return {
          status: MedicalDocumentAnalysisJobStatus.Failed,
          failureReason:
            response.errorMessage ||
            response.errorType ||
            'Bedrock Data Automation failed to analyze the document',
        };
      }
      if (response.status !== 'Success') {
        throw new ExternalServiceError(
          'Bedrock Data Automation returned an unknown analysis status',
        );
      }

      const resultUri = response.outputConfiguration?.s3Uri || outputS3Uri;
      const files = await this.storage.listJsonObjects(resultUri);
      const segments = this.groupOutputSegments(files);
      if (segments.length === 0) {
        throw new ExternalServiceError(
          'Bedrock Data Automation completed without readable result files',
        );
      }

      return {
        status: MedicalDocumentAnalysisJobStatus.Succeeded,
        analysis: this.mapper.mapSegments(segments),
      };
    } catch (error) {
      if (error instanceof ExternalServiceError) throw error;
      throw new ExternalServiceError(
        'Bedrock Data Automation status or output could not be retrieved',
      );
    }
  }

  private configuration(): {
    dataAutomationProfileArn: string;
    dataAutomationProjectArn: string;
  } {
    const dataAutomationProfileArn =
      this.configService.getAwsBedrockDataAutomationProfileArn();
    const dataAutomationProjectArn =
      this.configService.getAwsBedrockDataAutomationProjectArn();
    if (!dataAutomationProfileArn || !dataAutomationProjectArn) {
      throw new ExternalServiceError(
        'Bedrock Data Automation is not configured',
      );
    }
    return { dataAutomationProfileArn, dataAutomationProjectArn };
  }

  private groupOutputSegments(
    files: Array<{ key: string; content: string }>,
  ): OutputSegmentFiles[] {
    const groups = new Map<string, OutputSegmentFiles>();

    for (const file of files) {
      const match =
        /^(.*)\/(custom_output|standard_output)\/(.+)\/result\.json$/.exec(
          file.key,
        );
      if (!match) continue;
      const groupKey = `${match[1]}/${match[3]}`;
      const group = groups.get(groupKey) || {};
      if (match[2] === 'custom_output') group.customOutput = file.content;
      if (match[2] === 'standard_output') group.standardOutput = file.content;
      groups.set(groupKey, group);
    }

    return [...groups.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([, segment]) => segment);
  }
}
