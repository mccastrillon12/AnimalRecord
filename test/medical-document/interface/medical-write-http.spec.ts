import {
  ExecutionContext,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Server } from 'http';
import * as request from 'supertest';
import {
  AnimalMedicalDocumentController,
  MedicalDocumentController,
} from '../../../src/app/medical-document/medical-document.controller';
import { JwtAuthGuard } from '../../../src/app/auth/jwt-auth.guard';
import { HttpExceptionFilter } from '../../../src/app/shared/filters/http-exception.filter';
import { MedicalDocumentAnalysisRunner } from '../../../src/context/medical-document/application/medical-document-analysis-runner';
import { MedicalDocumentAnalysisRefresher } from '../../../src/context/medical-document/application/medical-document-analysis-refresher';
import { MedicalDocumentReviewer } from '../../../src/context/medical-document/application/medical-document-reviewer';
import { MedicalDocumentFinder } from '../../../src/context/medical-document/application/medical-document-finder';
import { MedicalDocumentDownloader } from '../../../src/context/medical-document/application/medical-document-downloader';
import { MedicalDocumentFeedbackService } from '../../../src/context/medical-document/application/medical-document-feedback-service';
import { MedicalDocumentFieldCatalog } from '../../../src/context/medical-document/application/medical-document-field-catalog';
import { MedicalDocumentReplacementService } from '../../../src/context/medical-document/application/medical-document-replacement-service';
import { MedicalDocumentAssociationRemover } from '../../../src/context/medical-document/application/medical-document-association-remover';
import { MedicalDocumentWriteCoordinator } from '../../../src/context/medical-document/application/medical-document-write-coordinator';
import { AnimalWriteCoordinator } from '../../../src/context/animal-transfer/application/animal-write-coordinator';
import { AnimalAccessPolicy } from '../../../src/context/animal/application/animal-access-policy';
import {
  MedicalDocument,
  MedicalDocumentStatus,
} from '../../../src/context/medical-document/domain/medical-document';

describe('Medical HTTP write coordination', () => {
  let app: INestApplication<Server>;
  const ownerId = '123e4567-e89b-42d3-a456-426614174001';
  const animalId = '123e4567-e89b-42d3-a456-426614174010';
  const secondAnimalId = '123e4567-e89b-42d3-a456-426614174011';
  const documentId = '123e4567-e89b-42d3-a456-426614174020';
  const candidateId = '123e4567-e89b-42d3-a456-426614174021';
  let document: MedicalDocument;
  const findById = jest.fn();
  const beginWrite = jest.fn();
  const endWrite = jest.fn();
  const group = jest.fn();
  const analyze = jest.fn();
  const refresh = jest.fn();
  const accept = jest.fn();
  const reject = jest.fn();
  const replacement = {
    start: jest.fn(),
    accept: jest.fn(),
    reject: jest.fn(),
    relatedDocuments: jest.fn(),
  };
  const remove = jest.fn();

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [MedicalDocumentController, AnimalMedicalDocumentController],
      providers: [
        AnimalWriteCoordinator,
        MedicalDocumentWriteCoordinator,
        {
          provide: AnimalAccessPolicy,
          useValue: { findWritableAnimal: jest.fn().mockResolvedValue({}) },
        },
        {
          provide: 'AnimalOwnershipRepository',
          useValue: {
            findControl: () =>
              Promise.resolve({ ownerId, ownershipVersion: 1 }),
            beginWrite,
            endWrite,
          },
        },
        {
          provide: 'MedicalDocumentRepository',
          useValue: { findAcceptedByGroupId: group },
        },
        { provide: MedicalDocumentFinder, useValue: { findById } },
        { provide: MedicalDocumentAnalysisRunner, useValue: { run: analyze } },
        { provide: MedicalDocumentAnalysisRefresher, useValue: { refresh } },
        { provide: MedicalDocumentReviewer, useValue: { accept, reject } },
        { provide: MedicalDocumentReplacementService, useValue: replacement },
        {
          provide: MedicalDocumentAssociationRemover,
          useValue: { run: remove },
        },
        ...[
          MedicalDocumentDownloader,
          MedicalDocumentFeedbackService,
          MedicalDocumentFieldCatalog,
        ].map((provide) => ({ provide, useValue: {} })),
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          context.switchToHttp().getRequest<{ user: { id: string } }>().user = {
            id: ownerId,
          };
          return true;
        },
      })
      .compile();
    app = module.createNestApplication<INestApplication<Server>>();
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    jest.resetAllMocks();
    document = MedicalDocument.create(
      ownerId,
      [animalId, secondAnimalId],
      'source.pdf',
      'application/pdf',
      10,
      'intake/source.pdf',
      documentId,
    );
    document.markAnalyzing();
    findById.mockImplementation(() => Promise.resolve(document));
    beginWrite.mockResolvedValue(true);
    endWrite.mockResolvedValue(undefined);
    group.mockResolvedValue([]);
    analyze.mockResolvedValue(document);
    refresh.mockResolvedValue(document);
    reject.mockResolvedValue(document);
    replacement.start.mockResolvedValue(document);
    replacement.reject.mockResolvedValue([document]);
    replacement.relatedDocuments.mockResolvedValue([document]);
    remove.mockResolvedValue(undefined);
  });

  const analysisRequest = (path: string) =>
    request(app.getHttpServer())
      .post(path)
      .field('animalIds', JSON.stringify([animalId, secondAnimalId]))
      .attach('file', Buffer.from('%PDF-1.4'), {
        filename: 'source.pdf',
        contentType: 'application/pdf',
      });

  it('keeps multipart/status/DTO success intact and claims all animals through analysis', async () => {
    const response = await analysisRequest('/medical-documents/analyze').expect(
      202,
    );
    expect(response.body).toMatchObject({
      id: documentId,
      status: 'ANALYZING',
      animalIds: [animalId, secondAnimalId],
    });
    expect(response.body).not.toHaveProperty('activeWrites');
    expect(beginWrite).toHaveBeenCalledTimes(2);
    expect(endWrite).toHaveBeenCalledTimes(2);
    expect(beginWrite.mock.invocationCallOrder[1]).toBeLessThan(
      analyze.mock.invocationCallOrder[0],
    );
    expect(analyze.mock.invocationCallOrder[0]).toBeLessThan(
      endWrite.mock.invocationCallOrder[0],
    );
  });

  it('rejects analysis before calling S3/AI if any animal reservation wins', async () => {
    beginWrite.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await analysisRequest('/medical-documents/analyze').expect(409);
    expect(analyze).not.toHaveBeenCalled();
    expect(endWrite).toHaveBeenCalledTimes(1);
  });

  it('holds claims during polling and re-fetches the document under the claims', async () => {
    await request(app.getHttpServer())
      .get(`/medical-documents/${documentId}`)
      .expect(200);
    expect(beginWrite).toHaveBeenCalledTimes(2);
    expect(findById).toHaveBeenCalledTimes(4);
    expect(findById.mock.invocationCallOrder[3]).toBeGreaterThan(
      beginWrite.mock.invocationCallOrder[1],
    );
    expect(refresh).toHaveBeenCalledWith(document);
    expect(endWrite).toHaveBeenCalledTimes(2);
  });

  it('blocks mutating ANALYZING polling but preserves already completed pure reads', async () => {
    beginWrite.mockResolvedValue(false);
    await request(app.getHttpServer())
      .get(`/medical-documents/${documentId}`)
      .expect(409);
    expect(refresh).not.toHaveBeenCalled();
    document = MedicalDocument.fromPrimitives({
      ...document.toPrimitives(),
      status: MedicalDocumentStatus.Accepted,
    });
    await request(app.getHttpServer())
      .get(`/medical-documents/${documentId}`)
      .expect(200);
    expect(beginWrite).toHaveBeenCalledTimes(1);
  });

  it('blocks rejection and candidate cleanup as well as acceptance during transfer processing', async () => {
    beginWrite.mockResolvedValue(false);
    await request(app.getHttpServer())
      .put(`/medical-documents/${documentId}/review`)
      .send({
        decision: 'REJECT',
        documentVersion: 1,
        rejectionReason: 'INCORRECT_INFORMATION',
      })
      .expect(409);
    await request(app.getHttpServer())
      .put(`/medical-documents/${documentId}/replacement-review`)
      .send({
        decision: 'REJECT',
        documentVersion: 1,
        candidateVersion: 1,
        candidateDocumentId: candidateId,
      })
      .expect(409);
    expect(reject).not.toHaveBeenCalled();
    expect(replacement.reject).not.toHaveBeenCalled();
  });

  it('preserves successful rejection and deletion contracts under claims', async () => {
    await request(app.getHttpServer())
      .put(`/medical-documents/${documentId}/review`)
      .send({
        decision: 'REJECT',
        documentVersion: 1,
        rejectionReason: 'INCORRECT_INFORMATION',
      })
      .expect(200);
    await request(app.getHttpServer())
      .delete(
        `/animals/${animalId}/medical-documents/${documentId}?documentVersion=1`,
      )
      .expect(204);
    expect(reject).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith(documentId, animalId, ownerId, 1);
    expect(beginWrite).toHaveBeenCalledTimes(4);
    expect(endWrite).toHaveBeenCalledTimes(4);
  });

  it('blocks replacement analysis and legacy group normalization without changing either', async () => {
    beginWrite.mockResolvedValue(false);
    await analysisRequest(
      `/medical-documents/${documentId}/replacement-analysis`,
    )
      .field('documentVersion', '1')
      .expect(409);
    group.mockResolvedValue([document]);
    await request(app.getHttpServer())
      .get(`/medical-documents/${documentId}/related-documents`)
      .expect(409);
    expect(replacement.start).not.toHaveBeenCalled();
    expect(replacement.relatedDocuments).not.toHaveBeenCalled();
    group.mockResolvedValue([]);
    await request(app.getHttpServer())
      .get(`/medical-documents/${documentId}/related-documents`)
      .expect(200);
    expect(replacement.relatedDocuments).toHaveBeenCalledTimes(1);
  });
});
