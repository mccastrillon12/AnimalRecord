import { v4 as uuidv4 } from 'uuid';
import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { InvalidArgumentError } from '../../shared/domain/errors/InvalidArgumentError';

export enum MedicalDocumentType {
  Prescription = 'PRESCRIPTION',
  MedicalOrder = 'MEDICAL_ORDER',
  Referral = 'REFERRAL',
  VaccinationCard = 'VACCINATION_CARD',
  Other = 'OTHER',
}

export enum MedicalDocumentStatus {
  PendingUpload = 'PENDING_UPLOAD',
  Analyzing = 'ANALYZING',
  ReviewPending = 'REVIEW_PENDING',
  Accepted = 'ACCEPTED',
  Rejected = 'REJECTED',
  Failed = 'FAILED',
}

export type ExtractionSource = {
  page?: number;
  text?: string;
};

export type ExtractedItem = {
  id: string;
  confidence?: number;
  source?: ExtractionSource;
};

export type ExtractedDiagnosis = ExtractedItem & {
  name: string;
  code?: string;
  notes?: string;
};

export type ExtractedMedication = ExtractedItem & {
  name: string;
  activeIngredient?: string;
  presentation?: string;
  dose?: string;
  route?: string;
  frequency?: string;
  duration?: string;
  instructions?: string;
};

export type ExtractedVaccination = ExtractedItem & {
  name: string;
  diseasesCovered?: string[];
  manufacturer?: string;
  lot?: string;
  applicationDate?: string;
  nextDoseDate?: string;
  veterinarian?: string;
};

export type ExtractedMedicalOrder = ExtractedItem & {
  name: string;
  orderType?: string;
  instructions?: string;
  priority?: string;
};

export type ExtractedReferral = {
  reason?: string;
  destination?: string;
  specialty?: string;
  clinicalSummary?: string;
  confidence?: number;
  source?: ExtractionSource;
};

export type MedicalDocumentExtraction = {
  documentType: MedicalDocumentType;
  documentTypeConfidence?: number;
  summary?: string;
  documentDate?: string;
  issuer?: {
    name?: string;
    clinic?: string;
    professionalId?: string;
  };
  patientHints: string[];
  diagnoses: ExtractedDiagnosis[];
  medications: ExtractedMedication[];
  vaccinations: ExtractedVaccination[];
  medicalOrders: ExtractedMedicalOrder[];
  referral?: ExtractedReferral;
  additionalFields: Record<string, unknown>;
  warnings: string[];
};

export type MedicalDocumentAssignment = {
  animalId: string;
  extractedItemIds: string[];
};

export type MedicalDocumentProviderMetadata = {
  provider: string;
  matchedBlueprintArn?: string;
  matchedBlueprintName?: string;
  matchedBlueprintVersion?: string;
  matchConfidence?: number;
};

export type MedicalDocumentPrimitiveType = {
  id: string;
  ownerId: string;
  animalIds: string[];
  originalFileName: string;
  mimeType: string;
  fileSize: number;
  storageKey: string;
  status: MedicalDocumentStatus;
  extraction?: MedicalDocumentExtraction;
  validatedExtraction?: MedicalDocumentExtraction;
  assignments: MedicalDocumentAssignment[];
  providerMetadata?: MedicalDocumentProviderMetadata;
  failureReason?: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  reviewedAt?: string;
};

export class MedicalDocument {
  constructor(
    public readonly id: string,
    public readonly ownerId: string,
    public readonly animalIds: string[],
    public readonly originalFileName: string,
    public readonly mimeType: string,
    public readonly fileSize: number,
    public readonly storageKey: string,
    public status: MedicalDocumentStatus,
    public extraction: MedicalDocumentExtraction | undefined,
    public validatedExtraction: MedicalDocumentExtraction | undefined,
    public assignments: MedicalDocumentAssignment[],
    public providerMetadata: MedicalDocumentProviderMetadata | undefined,
    public failureReason: string | undefined,
    public version: number,
    public readonly createdAt: string,
    public updatedAt: string,
    public reviewedAt?: string,
  ) {}

  static create(
    ownerId: string,
    animalIds: string[],
    originalFileName: string,
    mimeType: string,
    fileSize: number,
    storageKey: string,
    id: string = uuidv4(),
  ): MedicalDocument {
    if (animalIds.length === 0) {
      throw new InvalidArgumentError('At least one animal is required');
    }

    const now = new Date().toISOString();
    return new MedicalDocument(
      id,
      ownerId,
      [...new Set(animalIds)],
      originalFileName,
      mimeType,
      fileSize,
      storageKey,
      MedicalDocumentStatus.PendingUpload,
      undefined,
      undefined,
      [],
      undefined,
      undefined,
      1,
      now,
      now,
    );
  }

  markAnalyzing(): void {
    this.ensureStatus(MedicalDocumentStatus.PendingUpload);
    this.status = MedicalDocumentStatus.Analyzing;
    this.touch();
  }

  completeAnalysis(
    extraction: MedicalDocumentExtraction,
    providerMetadata: MedicalDocumentProviderMetadata,
  ): void {
    this.ensureStatus(MedicalDocumentStatus.Analyzing);
    this.extraction = extraction;
    this.providerMetadata = providerMetadata;
    this.failureReason = undefined;
    this.status = MedicalDocumentStatus.ReviewPending;
    this.touch();
  }

  fail(reason: string): void {
    if (
      [MedicalDocumentStatus.Accepted, MedicalDocumentStatus.Rejected].includes(
        this.status,
      )
    ) {
      throw new ConflictError(
        `Cannot fail a document in status ${this.status}`,
      );
    }
    this.status = MedicalDocumentStatus.Failed;
    this.failureReason = reason;
    this.touch();
  }

  accept(
    expectedVersion: number,
    extraction: MedicalDocumentExtraction,
    assignments: MedicalDocumentAssignment[],
  ): void {
    this.ensureVersion(expectedVersion);
    this.ensureStatus(MedicalDocumentStatus.ReviewPending);
    this.validateAssignments(assignments, extraction);

    this.validatedExtraction = extraction;
    this.assignments = assignments.map((assignment) => ({
      animalId: assignment.animalId,
      extractedItemIds: [...new Set(assignment.extractedItemIds)],
    }));
    this.status = MedicalDocumentStatus.Accepted;
    this.reviewedAt = new Date().toISOString();
    this.version += 1;
    this.touch();
  }

  reject(expectedVersion: number): void {
    this.ensureVersion(expectedVersion);
    this.ensureStatus(MedicalDocumentStatus.ReviewPending);
    this.status = MedicalDocumentStatus.Rejected;
    this.reviewedAt = new Date().toISOString();
    this.version += 1;
    this.touch();
  }

  toPrimitives(): MedicalDocumentPrimitiveType {
    return {
      id: this.id,
      ownerId: this.ownerId,
      animalIds: this.animalIds,
      originalFileName: this.originalFileName,
      mimeType: this.mimeType,
      fileSize: this.fileSize,
      storageKey: this.storageKey,
      status: this.status,
      extraction: this.extraction,
      validatedExtraction: this.validatedExtraction,
      assignments: this.assignments,
      providerMetadata: this.providerMetadata,
      failureReason: this.failureReason,
      version: this.version,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      reviewedAt: this.reviewedAt,
    };
  }

  static fromPrimitives(data: MedicalDocumentPrimitiveType): MedicalDocument {
    return new MedicalDocument(
      data.id,
      data.ownerId,
      data.animalIds,
      data.originalFileName,
      data.mimeType,
      data.fileSize,
      data.storageKey,
      data.status,
      data.extraction,
      data.validatedExtraction,
      data.assignments || [],
      data.providerMetadata,
      data.failureReason,
      data.version,
      data.createdAt,
      data.updatedAt,
      data.reviewedAt,
    );
  }

  private ensureStatus(expected: MedicalDocumentStatus): void {
    if (this.status !== expected) {
      throw new ConflictError(`Document must be in status ${expected}`);
    }
  }

  private ensureVersion(expectedVersion: number): void {
    if (this.version !== expectedVersion) {
      throw new ConflictError('The document was modified by another request');
    }
  }

  private validateAssignments(
    assignments: MedicalDocumentAssignment[],
    extraction: MedicalDocumentExtraction,
  ): void {
    const knownAnimalIds = new Set(this.animalIds);
    const duplicatedAnimalIds = assignments
      .map((assignment) => assignment.animalId)
      .filter((animalId, index, values) => values.indexOf(animalId) !== index);

    if (duplicatedAnimalIds.length > 0) {
      throw new InvalidArgumentError(
        'Each animal can only have one document assignment',
      );
    }

    if (assignments.length !== knownAnimalIds.size) {
      throw new InvalidArgumentError(
        'Every animal associated with the document must have an assignment',
      );
    }

    const allItemIds = [
      ...extraction.diagnoses,
      ...extraction.medications,
      ...extraction.vaccinations,
      ...extraction.medicalOrders,
    ].map((item) => item.id);
    const knownItemIds = new Set(allItemIds);

    if (knownItemIds.size !== allItemIds.length) {
      throw new InvalidArgumentError('Extracted item IDs must be unique');
    }

    for (const assignment of assignments) {
      if (!knownAnimalIds.has(assignment.animalId)) {
        throw new InvalidArgumentError(
          `Animal ${assignment.animalId} is not associated with this document`,
        );
      }
      if (
        assignment.extractedItemIds.some((itemId) => !knownItemIds.has(itemId))
      ) {
        throw new InvalidArgumentError(
          'An assignment contains an unknown extracted item',
        );
      }
    }
  }

  private touch(): void {
    this.updatedAt = new Date().toISOString();
  }
}
