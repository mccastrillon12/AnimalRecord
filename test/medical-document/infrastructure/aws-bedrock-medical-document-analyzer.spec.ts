import { BedrockDataAutomationRuntimeClient } from '@aws-sdk/client-bedrock-data-automation-runtime';
import { AwsBedrockMedicalDocumentAnalyzer } from '../../../src/context/medical-document/infrastructure/ai/aws-bedrock-medical-document-analyzer';
import { MedicalDocumentExtractionMapper } from '../../../src/context/medical-document/infrastructure/ai/medical-document-extraction-mapper';
import { MedicalDocumentStorage } from '../../../src/context/medical-document/domain/medical-document-storage';
import { EnvironmentConfigService } from '../../../src/context/shared/infrastructure/config/environment/environment.service';
import { MedicalDocumentAnalysisJobStatus } from '../../../src/context/medical-document/domain/medical-document-analyzer';
import { MedicalDocumentType } from '../../../src/context/medical-document/domain/medical-document';

describe('AwsBedrockMedicalDocumentAnalyzer', () => {
  const send = jest.spyOn(BedrockDataAutomationRuntimeClient.prototype, 'send');
  const config = {
    getAwsBedrockDataAutomationRegion: () => 'us-east-1',
    getAwsBedrockDataAutomationProfileArn: () => 'profile-arn',
    getAwsBedrockDataAutomationProjectArn: () => 'project-arn',
  } as EnvironmentConfigService;
  const storage = {
    listJsonObjects: jest.fn(),
  } as unknown as jest.Mocked<MedicalDocumentStorage>;

  beforeEach(() => {
    send.mockReset();
    storage.listJsonObjects.mockReset();
  });

  afterAll(() => send.mockRestore());

  it('starts BDA asynchronously with an idempotency token and S3 output', async () => {
    send.mockResolvedValueOnce({ invocationArn: 'invocation-arn' } as never);
    const analyzer = new AwsBedrockMedicalDocumentAnalyzer(
      config,
      new MedicalDocumentExtractionMapper(),
      storage,
    );

    const invocationArn = await analyzer.start(
      's3://bucket/input.pdf',
      's3://bucket/output/',
      'document-id',
    );

    expect(invocationArn).toBe('invocation-arn');
    expect((send.mock.calls[0][0] as { input: unknown }).input).toEqual(
      expect.objectContaining({
        clientToken: 'document-id',
        inputConfiguration: { s3Uri: 's3://bucket/input.pdf' },
        outputConfiguration: { s3Uri: 's3://bucket/output/' },
      }),
    );
  });

  it('reads and maps all logical subdocument results after success', async () => {
    send.mockResolvedValueOnce({
      status: 'Success',
      outputConfiguration: { s3Uri: 's3://bucket/output/job-id/' },
    } as never);
    storage.listJsonObjects.mockResolvedValue([
      {
        key: 'output/job-id/0/custom_output/0/result.json',
        content: customResult('PRESCRIPTION', 0.95),
      },
      {
        key: 'output/job-id/0/standard_output/0/result.json',
        content: JSON.stringify({ metadata: { start_page_index: 1 } }),
      },
      {
        key: 'output/job-id/0/custom_output/1/result.json',
        content: customResult('REFERRAL', 0.8),
      },
      {
        key: 'output/job-id/job_metadata.json',
        content: '{}',
      },
    ]);
    const analyzer = new AwsBedrockMedicalDocumentAnalyzer(
      config,
      new MedicalDocumentExtractionMapper(),
      storage,
    );

    const result = await analyzer.getResult(
      'invocation-arn',
      's3://bucket/fallback/',
    );

    expect(result.status).toBe(MedicalDocumentAnalysisJobStatus.Succeeded);
    expect(storage.listJsonObjects.mock.calls).toEqual([
      ['s3://bucket/output/job-id/'],
    ]);
    if (result.status !== MedicalDocumentAnalysisJobStatus.Succeeded) return;
    expect(
      result.analysis.detectedCategories.map((item) => item.category),
    ).toEqual([MedicalDocumentType.Prescription, MedicalDocumentType.Referral]);
  });
});

function customResult(type: string, confidence: number): string {
  return JSON.stringify({
    matched_blueprint: { name: type, confidence },
    document_class: { type },
    inference_result: {},
  });
}
