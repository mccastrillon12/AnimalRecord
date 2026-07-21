import { Injectable } from '@nestjs/common';
import {
  BedrockDataAutomationRuntimeClient,
  InvokeDataAutomationCommand,
} from '@aws-sdk/client-bedrock-data-automation-runtime';
import {
  MedicalDocumentAnalysis,
  MedicalDocumentAnalyzer,
} from '../../domain/medical-document-analyzer';
import { EnvironmentConfigService } from '../../../shared/infrastructure/config/environment/environment.service';
import { ExternalServiceError } from '../../../shared/domain/errors/ExternalServiceError';
import { MedicalDocumentExtractionMapper } from './medical-document-extraction-mapper';

@Injectable()
export class AwsBedrockMedicalDocumentAnalyzer implements MedicalDocumentAnalyzer {
  private readonly client: BedrockDataAutomationRuntimeClient;

  constructor(
    private readonly configService: EnvironmentConfigService,
    private readonly mapper: MedicalDocumentExtractionMapper,
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

  async analyze(s3Uri: string): Promise<MedicalDocumentAnalysis> {
    const dataAutomationProfileArn =
      this.configService.getAwsBedrockDataAutomationProfileArn();
    const dataAutomationProjectArn =
      this.configService.getAwsBedrockDataAutomationProjectArn();

    if (!dataAutomationProfileArn || !dataAutomationProjectArn) {
      throw new ExternalServiceError(
        'Bedrock Data Automation is not configured',
      );
    }

    try {
      const response = await this.client.send(
        new InvokeDataAutomationCommand({
          inputConfiguration: { s3Uri },
          dataAutomationConfiguration: {
            dataAutomationProjectArn,
            stage: 'LIVE',
          },
          dataAutomationProfileArn,
        }),
      );

      if (response.semanticModality !== 'DOCUMENT') {
        throw new ExternalServiceError(
          'The uploaded file was not recognized as a document',
        );
      }

      const segment = response.outputSegments?.[0];
      return this.mapper.map(segment?.customOutput, segment?.standardOutput);
    } catch (error) {
      if (error instanceof ExternalServiceError) throw error;
      throw new ExternalServiceError(
        'Bedrock Data Automation could not analyze the document',
      );
    }
  }
}
