import { Inject, Injectable } from '@nestjs/common';
import {
  MedicalDocument,
  MedicalDocumentAnalysisSnapshot,
  MedicalDocumentDetectedCategory,
  MedicalDocumentExtraction,
  MedicalDocumentPdfRasterRescueState,
  MedicalDocumentStatus,
  MedicalDocumentType,
} from '../domain/medical-document';
import {
  MedicalDocumentAnalysis,
  MedicalDocumentAnalysisJobStatus,
  MedicalDocumentAnalyzer,
} from '../domain/medical-document-analyzer';
import { MedicalDocumentPdfRasterizer } from '../domain/medical-document-pdf-rasterizer';
import { MedicalDocumentRepository } from '../domain/medical-document-repository';
import { MedicalDocumentStorage } from '../domain/medical-document-storage';
import {
  buildMedicalDocumentAnalysisInputStorageKey,
  buildMedicalDocumentAnalysisOutputStorageKey,
  buildMedicalDocumentDocumentAnalysisOutputStorageKey,
  buildMedicalDocumentImageAnalysisOutputStorageKey,
  buildMedicalDocumentPdfRescueInputStorageKey,
  buildMedicalDocumentPdfRescueOutputStorageKey,
} from './medical-document-storage-key';
import { requiresPdfAnalysisInput } from './medical-document-analysis-input';

const PDF_MIME_TYPE = 'application/pdf';
const DIAGNOSTIC_IMAGE_SUMMARY =
  'Imagen diagnostica veterinaria con metadatos tecnicos transcritos. La IA no genero interpretacion clinica.';

@Injectable()
export class MedicalDocumentAnalysisRefresher {
  constructor(
    @Inject('MedicalDocumentRepository')
    private readonly repository: MedicalDocumentRepository,
    @Inject('MedicalDocumentStorage')
    private readonly storage: MedicalDocumentStorage,
    @Inject('MedicalDocumentAnalyzer')
    private readonly analyzer: MedicalDocumentAnalyzer,
    @Inject('MedicalDocumentPdfRasterizer')
    private readonly pdfRasterizer?: MedicalDocumentPdfRasterizer,
  ) {}

  async refresh(document: MedicalDocument): Promise<MedicalDocument> {
    if (document.status !== MedicalDocumentStatus.Analyzing) return document;

    const outputS3Uri =
      document.analysisOutputUri || this.initialOutputUri(document);
    let invocationArn = document.analysisInvocationArn;

    if (!invocationArn) {
      const inputStorageKey = this.analysisInputStorageKey(
        document,
        outputS3Uri,
      );
      const inputS3Uri = this.storage.objectUri(inputStorageKey);
      invocationArn = await this.analyzer.start(
        inputS3Uri,
        outputS3Uri,
        this.analysisClientToken(document),
      );
      document.registerAnalysisJob(invocationArn, outputS3Uri);
      await this.repository.update(document);
    }

    const result = await this.analyzer.getResult(invocationArn, outputS3Uri);
    if (result.status === MedicalDocumentAnalysisJobStatus.InProgress) {
      return document;
    }
    if (result.status === MedicalDocumentAnalysisJobStatus.Failed) {
      if (this.isPdfRasterRescueStage(document)) {
        await this.finishPdfRasterRescuePage(document, undefined, true);
        return document;
      }
      if (this.isImageAnalysisStage(document, outputS3Uri)) {
        await this.startDocumentFallback(document);
        return document;
      }
      document.fail(result.failureReason);
      await this.repository.update(document);
      return document;
    }

    if (this.isPdfRasterRescueStage(document)) {
      const diagnosticAnalysis = result.analysis.detectedCategories.some(
        (detection) =>
          detection.category === MedicalDocumentType.DiagnosticImage,
      )
        ? this.analysisForPdfPage(
            result.analysis,
            document.currentPdfRasterRescuePage!,
          )
        : undefined;
      await this.finishPdfRasterRescuePage(document, diagnosticAnalysis);
      return document;
    }

    if (
      this.isImageAnalysisStage(document, outputS3Uri) &&
      !result.analysis.detectedCategories.some(
        (detection) =>
          detection.category === MedicalDocumentType.DiagnosticImage,
      )
    ) {
      await this.startDocumentFallback(document);
      return document;
    }

    if (this.shouldStartPdfRasterRescue(document, result.analysis)) {
      await this.startPdfRasterRescue(document, result.analysis);
      return document;
    }

    await this.complete(document, result.analysis);
    return document;
  }

  private analysisInputStorageKey(
    document: MedicalDocument,
    outputS3Uri: string,
  ): string {
    const rescuePage = document.currentPdfRasterRescuePage;
    if (rescuePage !== undefined) {
      return buildMedicalDocumentPdfRescueInputStorageKey(
        document.ownerId,
        document.id,
        rescuePage,
      );
    }
    if (this.isImageAnalysisStage(document, outputS3Uri)) {
      return document.temporaryStorageKey || document.storageKey;
    }
    return requiresPdfAnalysisInput(document.mimeType)
      ? buildMedicalDocumentAnalysisInputStorageKey(
          document.ownerId,
          document.id,
        )
      : document.temporaryStorageKey || document.storageKey;
  }

  private analysisClientToken(document: MedicalDocument): string {
    const rescuePage = document.currentPdfRasterRescuePage;
    return rescuePage === undefined
      ? document.id
      : `${document.id}-pdf-raster-rescue-${rescuePage}`;
  }

  private shouldStartPdfRasterRescue(
    document: MedicalDocument,
    analysis: MedicalDocumentAnalysis,
  ): boolean {
    if (document.mimeType !== PDF_MIME_TYPE || document.pdfRasterRescue) {
      return false;
    }
    if (
      analysis.detectedCategories.some(
        (detection) =>
          detection.category === MedicalDocumentType.DiagnosticImage,
      )
    ) {
      return false;
    }
    if (
      analysis.primaryDetectedCategory ===
        MedicalDocumentType.ClinicalHistory &&
      this.hasSubstantiveClinicalContext(analysis)
    ) {
      return false;
    }
    return (
      analysis.detectedCategories.length === 0 ||
      analysis.primaryDetectedCategory === MedicalDocumentType.ClinicalHistory
    );
  }

  private async startPdfRasterRescue(
    document: MedicalDocument,
    originalAnalysis: MedicalDocumentAnalysis,
  ): Promise<void> {
    try {
      if (!this.pdfRasterizer) {
        throw new Error('The PDF rasterizer is not configured');
      }
      const sourceKey = document.temporaryStorageKey || document.storageKey;
      const source = await this.storage.getObject(sourceKey);
      const rasterized = await this.pdfRasterizer.rasterize(source);
      if (rasterized.pages.length === 0) {
        await this.complete(document, originalAnalysis);
        return;
      }

      await Promise.all(
        rasterized.pages.map((page) =>
          this.storage.putObject(
            buildMedicalDocumentPdfRescueInputStorageKey(
              document.ownerId,
              document.id,
              page.pageNumber,
            ),
            page.content,
            'image/jpeg',
          ),
        ),
      );

      document.beginPdfRasterRescue(
        originalAnalysis,
        rasterized.pages.map((page) => page.pageNumber),
        rasterized.totalPageCount,
      );
      await this.startPdfRasterRescuePage(
        document,
        document.currentPdfRasterRescuePage!,
      );
    } catch {
      await this.complete(
        document,
        this.withRescueWarning(
          originalAnalysis,
          'No fue posible completar la validacion visual del PDF.',
        ),
      );
    }
  }

  private async finishPdfRasterRescuePage(
    document: MedicalDocument,
    diagnosticAnalysis?: MedicalDocumentAnalysisSnapshot,
    failed = false,
  ): Promise<void> {
    const rescue = document.pdfRasterRescue!;
    const nextPage = document.recordPdfRasterRescuePage(
      diagnosticAnalysis,
      failed,
    );

    if (
      diagnosticAnalysis === undefined &&
      rescue.diagnosticPages.length === 0 &&
      rescue.originalAnalysis.primaryDetectedCategory ===
        MedicalDocumentType.ClinicalHistory
    ) {
      await this.complete(
        document,
        this.withRescueWarnings(
          rescue.originalAnalysis,
          this.pdfRasterRescueWarnings(rescue),
        ),
      );
      return;
    }

    if (nextPage !== undefined) {
      await this.startPdfRasterRescuePage(document, nextPage);
      return;
    }

    if (rescue.diagnosticPages.length > 0) {
      const diagnostic = this.diagnosticAnalysisFromRescue(document);
      await this.complete(
        document,
        this.hasSubstantiveClinicalContext(rescue.originalAnalysis)
          ? this.mergeOriginalWithDiagnosticRescue(
              rescue.originalAnalysis,
              diagnostic,
            )
          : diagnostic,
      );
      return;
    }

    await this.complete(
      document,
      this.withRescueWarnings(
        rescue.originalAnalysis,
        this.pdfRasterRescueWarnings(rescue),
      ),
    );
  }

  private async startPdfRasterRescuePage(
    document: MedicalDocument,
    pageNumber: number,
  ): Promise<void> {
    const inputS3Uri = this.storage.objectUri(
      buildMedicalDocumentPdfRescueInputStorageKey(
        document.ownerId,
        document.id,
        pageNumber,
      ),
    );
    const outputS3Uri = this.storage.objectUri(
      buildMedicalDocumentPdfRescueOutputStorageKey(
        document.ownerId,
        document.id,
        pageNumber,
      ),
    );
    const invocationArn = await this.analyzer.start(
      inputS3Uri,
      outputS3Uri,
      `${document.id}-pdf-raster-rescue-${pageNumber}`,
    );
    document.registerAnalysisJob(invocationArn, outputS3Uri);
    await this.repository.update(document);
  }

  private analysisForPdfPage(
    analysis: MedicalDocumentAnalysis,
    pageNumber: number,
  ): MedicalDocumentAnalysisSnapshot {
    const extraction =
      analysis.extractionsByCategory[MedicalDocumentType.DiagnosticImage]!;
    return {
      primaryDetectedCategory: MedicalDocumentType.DiagnosticImage,
      detectedCategories: [
        {
          ...analysis.detectedCategories.find(
            (detection) =>
              detection.category === MedicalDocumentType.DiagnosticImage,
          )!,
          pageStart: pageNumber,
          pageEnd: pageNumber,
          summary: DIAGNOSTIC_IMAGE_SUMMARY,
        },
      ],
      extractionsByCategory: {
        [MedicalDocumentType.DiagnosticImage]: {
          ...extraction,
          summary: DIAGNOSTIC_IMAGE_SUMMARY,
          diagnosticImages: (extraction.diagnosticImages || []).map(
            (image, index) => ({
              ...image,
              id: `diagnostic-image-p${pageNumber}-${index + 1}`,
              source: { ...image.source, page: pageNumber },
            }),
          ),
        },
      },
      providerMetadata: analysis.providerMetadata,
    };
  }

  private diagnosticAnalysisFromRescue(
    document: MedicalDocument,
  ): MedicalDocumentAnalysis {
    const rescue = document.pdfRasterRescue!;
    const pageAnalyses = rescue.diagnosticPages.map((page) => page.analysis);
    const extractions = pageAnalyses.map(
      (analysis) =>
        analysis.extractionsByCategory[MedicalDocumentType.DiagnosticImage]!,
    );
    const first = extractions[0];
    const detections = pageAnalyses.flatMap(
      (analysis) => analysis.detectedCategories,
    );
    const detection = detections
      .slice(1)
      .reduce<MedicalDocumentDetectedCategory>(
        (current, next) => ({
          category: MedicalDocumentType.DiagnosticImage,
          confidence: Math.max(current.confidence || 0, next.confidence || 0),
          pageStart: Math.min(current.pageStart!, next.pageStart!),
          pageEnd: Math.max(current.pageEnd!, next.pageEnd!),
          summary: DIAGNOSTIC_IMAGE_SUMMARY,
          evidence: current.evidence || next.evidence,
        }),
        detections[0],
      );
    const extraction = extractions
      .slice(1)
      .reduce(
        (current, next) => this.mergeDiagnosticExtractions(current, next),
        first,
      );
    const rescueWarnings = this.pdfRasterRescueWarnings(rescue);

    return {
      primaryDetectedCategory: MedicalDocumentType.DiagnosticImage,
      detectedCategories: [detection],
      extractionsByCategory: {
        [MedicalDocumentType.DiagnosticImage]: {
          ...extraction,
          warnings: this.uniqueStrings([
            ...extraction.warnings,
            ...rescueWarnings,
          ]),
        },
      },
      providerMetadata: {
        ...pageAnalyses[0].providerMetadata,
        segmentCount: rescue.diagnosticPages.length,
      },
    };
  }

  private mergeDiagnosticExtractions(
    current: MedicalDocumentExtraction,
    next: MedicalDocumentExtraction,
  ): MedicalDocumentExtraction {
    return {
      ...current,
      documentTypeConfidence: Math.max(
        current.documentTypeConfidence || 0,
        next.documentTypeConfidence || 0,
      ),
      documentDate: current.documentDate || next.documentDate,
      issuer: { ...next.issuer, ...current.issuer },
      patient:
        current.patient || next.patient
          ? { ...next.patient, ...current.patient }
          : undefined,
      owner:
        current.owner || next.owner
          ? { ...next.owner, ...current.owner }
          : undefined,
      patientHints: this.uniqueStrings([
        ...current.patientHints,
        ...next.patientHints,
      ]),
      diagnosticImages: [
        ...(current.diagnosticImages || []),
        ...(next.diagnosticImages || []),
      ],
      warnings: this.uniqueStrings([...current.warnings, ...next.warnings]),
      additionalFields: {},
    };
  }

  private mergeOriginalWithDiagnosticRescue(
    original: MedicalDocumentAnalysisSnapshot,
    diagnostic: MedicalDocumentAnalysis,
  ): MedicalDocumentAnalysis {
    return {
      primaryDetectedCategory: original.primaryDetectedCategory,
      detectedCategories: [
        ...original.detectedCategories,
        diagnostic.detectedCategories[0],
      ],
      extractionsByCategory: {
        ...original.extractionsByCategory,
        [MedicalDocumentType.DiagnosticImage]:
          diagnostic.extractionsByCategory[MedicalDocumentType.DiagnosticImage],
      },
      providerMetadata: original.providerMetadata,
    };
  }

  private hasSubstantiveClinicalContext(
    analysis: MedicalDocumentAnalysisSnapshot,
  ): boolean {
    const extraction =
      analysis.extractionsByCategory[MedicalDocumentType.ClinicalHistory];
    if (!extraction) return false;
    const history = extraction.clinicalHistory;
    return Boolean(
      extraction.diagnoses.length ||
      extraction.medications.length ||
      extraction.vaccinations.length ||
      extraction.medicalOrders.length ||
      extraction.referral ||
      history?.reasonForConsultation ||
      history?.anamnesis ||
      history?.physicalExam ||
      history?.vitalSigns?.length ||
      history?.clinicalFindings?.length ||
      history?.evolution ||
      history?.treatmentPlan ||
      history?.recommendations?.length ||
      history?.followUp ||
      history?.prognosis,
    );
  }

  private withRescueWarning(
    analysis: MedicalDocumentAnalysisSnapshot,
    warning: string,
  ): MedicalDocumentAnalysis {
    const category =
      analysis.primaryDetectedCategory || MedicalDocumentType.Other;
    const extraction = analysis.extractionsByCategory[category];
    if (!extraction) return analysis;
    return {
      ...analysis,
      extractionsByCategory: {
        ...analysis.extractionsByCategory,
        [category]: {
          ...extraction,
          warnings: this.uniqueStrings([...extraction.warnings, warning]),
        },
      },
    };
  }

  private withRescueWarnings(
    analysis: MedicalDocumentAnalysisSnapshot,
    warnings: string[],
  ): MedicalDocumentAnalysis {
    return warnings.reduce(
      (current, warning) => this.withRescueWarning(current, warning),
      analysis,
    );
  }

  private pdfRasterRescueWarnings(
    rescue: MedicalDocumentPdfRasterRescueState,
  ): string[] {
    return [
      ...(rescue.failedPageNumbers.length > 0
        ? [
            `No fue posible validar visualmente las paginas ${rescue.failedPageNumbers.join(', ')} del PDF.`,
          ]
        : []),
      ...(rescue.currentPageIndex < rescue.totalPageCount
        ? [
            `La validacion visual examino ${rescue.currentPageIndex} de ${rescue.totalPageCount} paginas representativas.`,
          ]
        : []),
    ];
  }

  private uniqueStrings(values: string[]): string[] {
    return [...new Set(values.filter(Boolean))];
  }

  private async complete(
    document: MedicalDocument,
    analysis: MedicalDocumentAnalysisSnapshot,
  ): Promise<void> {
    document.completeAnalysis(
      analysis.primaryDetectedCategory,
      analysis.detectedCategories,
      analysis.extractionsByCategory,
      analysis.providerMetadata,
    );
    await this.repository.update(document);
  }

  private initialOutputUri(document: MedicalDocument): string {
    const rescuePage = document.currentPdfRasterRescuePage;
    if (rescuePage !== undefined) {
      return this.storage.objectUri(
        buildMedicalDocumentPdfRescueOutputStorageKey(
          document.ownerId,
          document.id,
          rescuePage,
        ),
      );
    }
    const outputKey = requiresPdfAnalysisInput(document.mimeType)
      ? buildMedicalDocumentImageAnalysisOutputStorageKey(
          document.ownerId,
          document.id,
        )
      : buildMedicalDocumentAnalysisOutputStorageKey(
          document.ownerId,
          document.id,
        );
    return this.storage.objectUri(outputKey);
  }

  private isImageAnalysisStage(
    document: MedicalDocument,
    outputS3Uri: string,
  ): boolean {
    if (!requiresPdfAnalysisInput(document.mimeType)) return false;
    return (
      outputS3Uri ===
      this.storage.objectUri(
        buildMedicalDocumentImageAnalysisOutputStorageKey(
          document.ownerId,
          document.id,
        ),
      )
    );
  }

  private isPdfRasterRescueStage(document: MedicalDocument): boolean {
    return document.pdfRasterRescue !== undefined;
  }

  private async startDocumentFallback(
    document: MedicalDocument,
  ): Promise<void> {
    const inputS3Uri = this.storage.objectUri(
      buildMedicalDocumentAnalysisInputStorageKey(
        document.ownerId,
        document.id,
      ),
    );
    const outputS3Uri = this.storage.objectUri(
      buildMedicalDocumentDocumentAnalysisOutputStorageKey(
        document.ownerId,
        document.id,
      ),
    );
    const invocationArn = await this.analyzer.start(
      inputS3Uri,
      outputS3Uri,
      `${document.id}-document-fallback`,
    );
    document.registerAnalysisJob(invocationArn, outputS3Uri);
    await this.repository.update(document);
  }
}
