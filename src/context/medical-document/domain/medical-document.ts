import { v4 as uuidv4 } from 'uuid';
import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { InvalidArgumentError } from '../../shared/domain/errors/InvalidArgumentError';

export enum MedicalDocumentType {
  Prescription = 'PRESCRIPTION',
  MedicalOrder = 'MEDICAL_ORDER',
  Referral = 'REFERRAL',
  VaccinationCard = 'VACCINATION_CARD',
  ClinicalHistory = 'CLINICAL_HISTORY',
  Other = 'OTHER',
}

export enum MedicalDocumentClassificationOutcome {
  Match = 'MATCH',
  Mismatch = 'MISMATCH',
  MatchWithAdditional = 'MATCH_WITH_ADDITIONAL',
  Multiple = 'MULTIPLE',
  Detected = 'DETECTED',
  Unclassified = 'UNCLASSIFIED',
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
  brand?: string;
  manufacturer?: string;
  vaccineType?: string;
  lot?: string;
  lotExpirationDate?: string;
  applicationDate?: string;
  nextDoseDate?: string;
  route?: string;
  applicationSite?: string;
  tagNumber?: string;
  veterinarian?: string;
};

export type ExtractedMedicalOrder = ExtractedItem & {
  name: string;
  orderType?: string;
  instructions?: string;
  priority?: string;
};

export type ExtractedDiagnosticResult = ExtractedItem & {
  name: string;
  date?: string;
  result?: string;
  interpretation?: string;
  status?: string;
};

export type ExtractedClinicalHistory = {
  reasonForConsultation?: string;
  anamnesis?: string;
  physicalExam?: string;
  vitalSigns?: string[];
  clinicalFindings?: string[];
  evolution?: string;
  treatmentPlan?: string;
  recommendations?: string[];
  followUp?: string;
  prognosis?: string;
  confidence?: number;
  source?: ExtractionSource;
};

export type ExtractedReferral = {
  reason?: string;
  destination?: string;
  specialty?: string;
  clinicalSummary?: string;
  confidence?: number;
  source?: ExtractionSource;
};

export type ExtractedPatient = {
  name?: string;
  identifier?: string;
  species?: string;
  breed?: string;
  sex?: string;
  color?: string;
  size?: string;
  reproductiveStatus?: string;
  age?: string;
  birthDate?: string;
  weight?: string;
  microchip?: string;
};

export type ExtractedOwner = {
  name?: string;
  identification?: string;
  phone?: string;
  email?: string;
  address?: string;
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
  patient?: ExtractedPatient;
  owner?: ExtractedOwner;
  patientHints: string[];
  diagnoses: ExtractedDiagnosis[];
  medications: ExtractedMedication[];
  vaccinations: ExtractedVaccination[];
  medicalOrders: ExtractedMedicalOrder[];
  clinicalHistory?: ExtractedClinicalHistory;
  diagnosticResults?: ExtractedDiagnosticResult[];
  referral?: ExtractedReferral;
  additionalFields: Record<string, unknown>;
  warnings: string[];
};

export type MedicalDocumentDetectedCategory = {
  category: MedicalDocumentType;
  confidence?: number;
  pageStart?: number;
  pageEnd?: number;
  summary?: string;
  evidence?: string;
};

export type MedicalDocumentExtractionsByCategory = Partial<
  Record<MedicalDocumentType, MedicalDocumentExtraction>
>;

export type MedicalDocumentAssignment = {
  animalId: string;
  extractedItemIds: string[];
};

export type MedicalDocumentLocation = {
  animalId: string;
  storageKey: string;
};

export type MedicalDocumentProviderMetadata = {
  provider: string;
  segmentCount?: number;
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
  /** Legacy source key retained while older records are still readable. */
  storageKey: string;
  temporaryStorageKey?: string;
  documentLocations?: MedicalDocumentLocation[];
  status: MedicalDocumentStatus;
  requestedCategory?: MedicalDocumentType;
  primaryDetectedCategory?: MedicalDocumentType;
  detectedCategories: MedicalDocumentDetectedCategory[];
  classificationOutcome?: MedicalDocumentClassificationOutcome;
  extractionsByCategory: MedicalDocumentExtractionsByCategory;
  finalCategory?: MedicalDocumentType;
  /** Legacy field used only while reading records created before categorization. */
  extraction?: MedicalDocumentExtraction;
  validatedExtraction?: MedicalDocumentExtraction;
  assignments: MedicalDocumentAssignment[];
  providerMetadata?: MedicalDocumentProviderMetadata;
  analysisInvocationArn?: string;
  analysisOutputUri?: string;
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
    public temporaryStorageKey: string | undefined,
    public documentLocations: MedicalDocumentLocation[],
    public status: MedicalDocumentStatus,
    public readonly requestedCategory: MedicalDocumentType | undefined,
    public primaryDetectedCategory: MedicalDocumentType | undefined,
    public detectedCategories: MedicalDocumentDetectedCategory[],
    public classificationOutcome:
      | MedicalDocumentClassificationOutcome
      | undefined,
    public extractionsByCategory: MedicalDocumentExtractionsByCategory,
    public finalCategory: MedicalDocumentType | undefined,
    public validatedExtraction: MedicalDocumentExtraction | undefined,
    public assignments: MedicalDocumentAssignment[],
    public providerMetadata: MedicalDocumentProviderMetadata | undefined,
    public analysisInvocationArn: string | undefined,
    public analysisOutputUri: string | undefined,
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
    requestedCategory?: MedicalDocumentType,
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
      storageKey,
      [],
      MedicalDocumentStatus.PendingUpload,
      requestedCategory,
      undefined,
      [],
      undefined,
      {},
      undefined,
      undefined,
      [],
      undefined,
      undefined,
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

  registerAnalysisJob(invocationArn: string, outputUri: string): void {
    this.ensureStatus(MedicalDocumentStatus.Analyzing);
    if (!invocationArn.trim() || !outputUri.trim()) {
      throw new InvalidArgumentError(
        'Analysis invocation ARN and output URI are required',
      );
    }
    this.analysisInvocationArn = invocationArn;
    this.analysisOutputUri = outputUri;
    this.touch();
  }

  completeAnalysis(
    primaryDetectedCategory: MedicalDocumentType | undefined,
    detectedCategories: MedicalDocumentDetectedCategory[],
    extractionsByCategory: MedicalDocumentExtractionsByCategory,
    providerMetadata: MedicalDocumentProviderMetadata,
  ): void {
    this.ensureStatus(MedicalDocumentStatus.Analyzing);
    this.validateAnalysis(
      primaryDetectedCategory,
      detectedCategories,
      extractionsByCategory,
    );
    this.primaryDetectedCategory = primaryDetectedCategory;
    this.detectedCategories = detectedCategories.map((detection) => ({
      ...detection,
    }));
    this.classificationOutcome =
      this.resolveClassificationOutcome(detectedCategories);
    this.extractionsByCategory = { ...extractionsByCategory };
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
    finalCategory: MedicalDocumentType,
    extraction: MedicalDocumentExtraction,
    assignments: MedicalDocumentAssignment[],
    documentLocations: MedicalDocumentLocation[],
  ): void {
    this.validateAcceptance(
      expectedVersion,
      finalCategory,
      extraction,
      assignments,
    );
    this.validateDocumentLocations(documentLocations);

    const originalFinalExtraction = this.extractionsByCategory[finalCategory];
    this.finalCategory = finalCategory;
    this.validatedExtraction = extraction;
    this.extractionsByCategory = {
      [finalCategory]: originalFinalExtraction || extraction,
    };
    this.assignments = assignments.map((assignment) => ({
      animalId: assignment.animalId,
      extractedItemIds: [...new Set(assignment.extractedItemIds)],
    }));
    this.documentLocations = documentLocations.map((location) => ({
      ...location,
    }));
    this.status = MedicalDocumentStatus.Accepted;
    this.reviewedAt = new Date().toISOString();
    this.version += 1;
    this.touch();
  }

  validateAcceptance(
    expectedVersion: number,
    finalCategory: MedicalDocumentType,
    extraction: MedicalDocumentExtraction,
    assignments: MedicalDocumentAssignment[],
  ): void {
    this.ensureVersion(expectedVersion);
    this.ensureStatus(MedicalDocumentStatus.ReviewPending);
    this.validateFinalExtraction(finalCategory, extraction);
    this.validateAssignments(assignments, extraction);
  }

  clearTemporaryStorage(): void {
    if (!this.temporaryStorageKey) return;
    this.temporaryStorageKey = undefined;
    this.touch();
  }

  clearAnalysisJob(): void {
    if (!this.analysisInvocationArn && !this.analysisOutputUri) return;
    this.analysisInvocationArn = undefined;
    this.analysisOutputUri = undefined;
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
      temporaryStorageKey: this.temporaryStorageKey,
      documentLocations: this.documentLocations,
      status: this.status,
      requestedCategory: this.requestedCategory,
      primaryDetectedCategory: this.primaryDetectedCategory,
      detectedCategories: this.detectedCategories,
      classificationOutcome: this.classificationOutcome,
      extractionsByCategory: this.extractionsByCategory,
      finalCategory: this.finalCategory,
      validatedExtraction: this.validatedExtraction,
      assignments: this.assignments,
      providerMetadata: this.providerMetadata,
      analysisInvocationArn: this.analysisInvocationArn,
      analysisOutputUri: this.analysisOutputUri,
      failureReason: this.failureReason,
      version: this.version,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      reviewedAt: this.reviewedAt,
    };
  }

  static fromPrimitives(data: MedicalDocumentPrimitiveType): MedicalDocument {
    const legacyExtraction = data.extraction;
    const extractionsByCategory =
      data.extractionsByCategory &&
      Object.keys(data.extractionsByCategory).length > 0
        ? data.extractionsByCategory
        : legacyExtraction
          ? { [legacyExtraction.documentType]: legacyExtraction }
          : {};
    const legacyDetectedCategory =
      legacyExtraction?.documentType !== MedicalDocumentType.Other
        ? legacyExtraction?.documentType
        : undefined;
    const detectedCategories =
      data.detectedCategories?.length > 0
        ? data.detectedCategories
        : legacyDetectedCategory
          ? [
              {
                category: legacyDetectedCategory,
                confidence: legacyExtraction?.documentTypeConfidence,
                summary: legacyExtraction?.summary,
              },
            ]
          : [];
    const primaryDetectedCategory =
      data.primaryDetectedCategory ?? legacyDetectedCategory;
    const finalCategory =
      data.finalCategory ?? data.validatedExtraction?.documentType;

    return new MedicalDocument(
      data.id,
      data.ownerId,
      data.animalIds,
      data.originalFileName,
      data.mimeType,
      data.fileSize,
      data.storageKey,
      data.temporaryStorageKey,
      data.documentLocations || [],
      data.status,
      data.requestedCategory,
      primaryDetectedCategory,
      detectedCategories,
      data.classificationOutcome ??
        MedicalDocument.classificationOutcomeFor(
          data.requestedCategory,
          detectedCategories,
        ),
      extractionsByCategory,
      finalCategory,
      data.validatedExtraction,
      data.assignments || [],
      data.providerMetadata,
      data.analysisInvocationArn,
      data.analysisOutputUri,
      data.failureReason,
      data.version,
      data.createdAt,
      data.updatedAt,
      data.reviewedAt,
    );
  }

  get extraction(): MedicalDocumentExtraction | undefined {
    if (this.primaryDetectedCategory) {
      return this.extractionsByCategory[this.primaryDetectedCategory];
    }
    return Object.values(this.extractionsByCategory)[0];
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
      ...(extraction.diagnosticResults || []),
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

  private validateDocumentLocations(
    documentLocations: MedicalDocumentLocation[],
  ): void {
    const knownAnimalIds = new Set(this.animalIds);
    const locationAnimalIds = documentLocations.map(
      (location) => location.animalId,
    );
    if (
      documentLocations.length !== knownAnimalIds.size ||
      new Set(locationAnimalIds).size !== locationAnimalIds.length ||
      locationAnimalIds.some((animalId) => !knownAnimalIds.has(animalId))
    ) {
      throw new InvalidArgumentError(
        'Every associated animal must have one final document location',
      );
    }
    const storageKeys = documentLocations.map((location) =>
      location.storageKey.trim(),
    );
    if (
      storageKeys.some((storageKey) => storageKey.length === 0) ||
      new Set(storageKeys).size !== storageKeys.length
    ) {
      throw new InvalidArgumentError(
        'Final document location keys must be non-empty and unique',
      );
    }
  }

  private validateAnalysis(
    primaryDetectedCategory: MedicalDocumentType | undefined,
    detectedCategories: MedicalDocumentDetectedCategory[],
    extractionsByCategory: MedicalDocumentExtractionsByCategory,
  ): void {
    const categories = detectedCategories.map((item) => item.category);
    if (new Set(categories).size !== categories.length) {
      throw new InvalidArgumentError('Detected categories must be unique');
    }
    if (categories.includes(MedicalDocumentType.Other)) {
      throw new InvalidArgumentError(
        'OTHER is a fallback extraction, not a detected medical category',
      );
    }
    if (
      primaryDetectedCategory !== undefined &&
      !categories.includes(primaryDetectedCategory)
    ) {
      throw new InvalidArgumentError(
        'The primary detected category must be present in detected categories',
      );
    }
    if (primaryDetectedCategory === undefined && categories.length > 0) {
      throw new InvalidArgumentError(
        'A primary detected category is required when categories are detected',
      );
    }

    for (const [category, extraction] of Object.entries(
      extractionsByCategory,
    )) {
      if (extraction?.documentType !== (category as MedicalDocumentType)) {
        throw new InvalidArgumentError(
          'Every extraction must match its category key',
        );
      }
      if (
        categories.length > 0 &&
        !categories.includes(category as MedicalDocumentType)
      ) {
        throw new InvalidArgumentError(
          'An extraction cannot be added for a category that was not detected',
        );
      }
    }

    if (
      categories.some(
        (category) => extractionsByCategory[category] === undefined,
      )
    ) {
      throw new InvalidArgumentError(
        'Every detected category must have its own extraction',
      );
    }
  }

  private resolveClassificationOutcome(
    detectedCategories: MedicalDocumentDetectedCategory[],
  ): MedicalDocumentClassificationOutcome {
    return MedicalDocument.classificationOutcomeFor(
      this.requestedCategory,
      detectedCategories,
    );
  }

  private static classificationOutcomeFor(
    requestedCategory: MedicalDocumentType | undefined,
    detectedCategories: MedicalDocumentDetectedCategory[],
  ): MedicalDocumentClassificationOutcome {
    const categories = new Set(
      detectedCategories.map((detection) => detection.category),
    );
    if (categories.size === 0) {
      return MedicalDocumentClassificationOutcome.Unclassified;
    }
    if (!requestedCategory) {
      return categories.size === 1
        ? MedicalDocumentClassificationOutcome.Detected
        : MedicalDocumentClassificationOutcome.Multiple;
    }
    if (!categories.has(requestedCategory)) {
      return MedicalDocumentClassificationOutcome.Mismatch;
    }
    return categories.size === 1
      ? MedicalDocumentClassificationOutcome.Match
      : MedicalDocumentClassificationOutcome.MatchWithAdditional;
  }

  private validateFinalExtraction(
    finalCategory: MedicalDocumentType,
    extraction: MedicalDocumentExtraction,
  ): void {
    if (extraction.documentType !== finalCategory) {
      throw new InvalidArgumentError(
        'The validated extraction must match the final category',
      );
    }

    const has = {
      diagnoses: extraction.diagnoses.length > 0,
      medications: extraction.medications.length > 0,
      vaccinations: extraction.vaccinations.length > 0,
      medicalOrders: extraction.medicalOrders.length > 0,
      clinicalHistory: extraction.clinicalHistory !== undefined,
      diagnosticResults: (extraction.diagnosticResults?.length || 0) > 0,
      referral: extraction.referral !== undefined,
    };
    const allowed: Record<MedicalDocumentType, Set<keyof typeof has>> = {
      [MedicalDocumentType.Prescription]: new Set(['diagnoses', 'medications']),
      [MedicalDocumentType.MedicalOrder]: new Set([
        'diagnoses',
        'medicalOrders',
      ]),
      [MedicalDocumentType.Referral]: new Set([
        'diagnoses',
        'medications',
        'diagnosticResults',
        'referral',
      ]),
      [MedicalDocumentType.VaccinationCard]: new Set(['vaccinations']),
      [MedicalDocumentType.ClinicalHistory]: new Set([
        'diagnoses',
        'clinicalHistory',
        'diagnosticResults',
      ]),
      [MedicalDocumentType.Other]: new Set(),
    };
    const invalidSections = Object.entries(has)
      .filter(
        ([section, present]) =>
          present && !allowed[finalCategory].has(section as keyof typeof has),
      )
      .map(([section]) => section);

    if (invalidSections.length > 0) {
      throw new InvalidArgumentError(
        `The ${finalCategory} extraction contains data from other categories: ${invalidSections.join(', ')}`,
      );
    }
  }

  private touch(): void {
    this.updatedAt = new Date().toISOString();
  }
}
