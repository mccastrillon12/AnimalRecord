import { Injectable } from '@nestjs/common';
import {
  ExtractedDiagnosticResult,
  ExtractedDiagnosis,
  ExtractedMedicalOrder,
  ExtractedMedication,
  ExtractedVaccination,
  MedicalDocumentExtraction,
  MedicalDocumentDetectedCategory,
  MedicalDocumentExtractionsByCategory,
  MedicalDocumentProviderMetadata,
  MedicalDocumentType,
} from '../../domain/medical-document';
import { MedicalDocumentAnalysis } from '../../domain/medical-document-analyzer';

type JsonObject = Record<string, unknown>;

@Injectable()
export class MedicalDocumentExtractionMapper {
  map(customOutput?: string, standardOutput?: string): MedicalDocumentAnalysis {
    const custom = this.parseJson(customOutput);
    const standard = this.parseJson(standardOutput);
    const matchedBlueprint = this.asObject(
      custom.matched_blueprint ?? custom.matchedBlueprint,
    );
    const documentClass = this.asObject(
      custom.document_class ?? custom.documentClass,
    );
    const inference = this.asObject(
      custom.inference_result ?? custom.inferenceResult,
    );
    const explainability = this.asObject(
      this.arrayValue(custom, ['explainability_info', 'explainabilityInfo'])[0],
    );
    const matchStatusWarning =
      Object.keys(inference).length === 0
        ? ['The document did not match a configured extraction blueprint']
        : [];

    const rawType =
      this.stringValue(inference, [
        'document_type',
        'documentType',
        'tipo_documento',
        'tipoDocumento',
      ]) ||
      this.stringValue(documentClass, ['type']) ||
      this.stringValue(matchedBlueprint, ['name']);

    const extraction: MedicalDocumentExtraction = {
      documentType: this.toDocumentType(rawType),
      documentTypeConfidence: this.numberValue(matchedBlueprint, [
        'confidence',
      ]),
      summary:
        this.stringValue(inference, ['summary', 'resumen']) ||
        this.standardSummary(standard),
      documentDate: this.stringValue(inference, [
        'document_date',
        'documentDate',
        'fecha_documento',
        'fechaDocumento',
      ]),
      issuer: this.mapIssuer(inference),
      patientHints: this.stringArrayValue(inference, [
        'patient_hints',
        'patientHints',
        'patients',
        'pacientes',
      ]),
      diagnoses: this.mapDiagnoses(
        this.arrayValue(inference, [
          'diagnoses',
          'diagnostics',
          'diagnosticos',
          'diagnostico',
        ]),
        this.arrayValue(explainability, [
          'diagnoses',
          'diagnostics',
          'diagnosticos',
          'diagnostico',
        ]),
      ),
      medications: this.mapMedications(
        this.arrayValue(inference, [
          'medications',
          'medicines',
          'medicamentos',
        ]),
        this.arrayValue(explainability, [
          'medications',
          'medicines',
          'medicamentos',
        ]),
      ),
      vaccinations: this.mapVaccinations(
        this.arrayValue(inference, ['vaccinations', 'vaccines', 'vacunas']),
        this.arrayValue(explainability, [
          'vaccinations',
          'vaccines',
          'vacunas',
        ]),
      ),
      medicalOrders: this.mapMedicalOrders(
        this.arrayValue(inference, [
          'medical_orders',
          'medicalOrders',
          'orders',
          'ordenes',
        ]),
        this.arrayValue(explainability, [
          'medical_orders',
          'medicalOrders',
          'orders',
          'ordenes',
        ]),
      ),
      clinicalHistory: this.mapClinicalHistory(inference, explainability),
      diagnosticResults: this.mapDiagnosticResults(
        this.arrayValue(inference, [
          'diagnostic_results',
          'diagnosticResults',
          'test_results',
          'resultados_diagnosticos',
        ]),
        this.arrayValue(explainability, [
          'diagnostic_results',
          'diagnosticResults',
          'test_results',
          'resultados_diagnosticos',
        ]),
      ),
      referral: this.mapReferral(inference, explainability),
      additionalFields: this.additionalFields(inference),
      warnings: [
        ...matchStatusWarning,
        ...this.stringArrayValue(inference, ['warnings', 'advertencias']),
      ],
    };

    const providerMetadata: MedicalDocumentProviderMetadata = {
      provider: 'AWS_BEDROCK_DATA_AUTOMATION',
      matchedBlueprintArn: this.stringValue(matchedBlueprint, ['arn']),
      matchedBlueprintName: this.stringValue(matchedBlueprint, ['name']),
      matchedBlueprintVersion: this.stringValue(matchedBlueprint, ['version']),
      matchConfidence: this.numberValue(matchedBlueprint, ['confidence']),
    };

    const pageRange = this.pageRange(standard);
    const mainDetection =
      extraction.documentType !== MedicalDocumentType.Other
        ? {
            category: extraction.documentType,
            confidence: extraction.documentTypeConfidence,
            pageStart: pageRange.pageStart,
            pageEnd: pageRange.pageEnd,
            summary: extraction.summary,
          }
        : undefined;
    const detectedCategories = this.mergeSectionDetections(
      mainDetection,
      this.mapDocumentSections(inference),
    );
    const primaryDetectedCategory =
      mainDetection?.category || detectedCategories[0]?.category;
    const extractionsByCategory: MedicalDocumentExtractionsByCategory = {};

    for (const detection of detectedCategories) {
      extractionsByCategory[detection.category] = this.extractionForCategory(
        extraction,
        detection.category,
      );
    }
    if (detectedCategories.length === 0) {
      extractionsByCategory[MedicalDocumentType.Other] = extraction;
    }

    return {
      primaryDetectedCategory,
      detectedCategories,
      extractionsByCategory,
      providerMetadata,
    };
  }

  mapSegments(
    segments: Array<{ customOutput?: string; standardOutput?: string }>,
  ): MedicalDocumentAnalysis {
    const analyses =
      segments.length > 0
        ? segments.map((segment) =>
            this.map(segment.customOutput, segment.standardOutput),
          )
        : [this.map()];
    const recognized = analyses.some(
      (analysis) => analysis.detectedCategories.length > 0,
    );
    const detections = new Map<
      MedicalDocumentType,
      MedicalDocumentDetectedCategory
    >();
    const extractions: MedicalDocumentExtractionsByCategory = {};

    for (const analysis of analyses) {
      for (const detection of analysis.detectedCategories) {
        const existing = detections.get(detection.category);
        detections.set(
          detection.category,
          existing ? this.mergeDetection(existing, detection) : detection,
        );
      }

      for (const [category, extraction] of Object.entries(
        analysis.extractionsByCategory,
      )) {
        const documentType = category as MedicalDocumentType;
        if (
          !extraction ||
          (recognized && documentType === MedicalDocumentType.Other)
        ) {
          continue;
        }
        extractions[documentType] = extractions[documentType]
          ? this.mergeExtraction(extractions[documentType], extraction)
          : extraction;
      }
    }

    const detectedCategories = [...detections.values()];
    const primaryDetectedCategory = [...detectedCategories].sort(
      (left, right) => (right.confidence || 0) - (left.confidence || 0),
    )[0]?.category;
    const primaryAnalysis = analyses.find(
      (analysis) =>
        analysis.primaryDetectedCategory === primaryDetectedCategory,
    );

    return {
      primaryDetectedCategory,
      detectedCategories,
      extractionsByCategory: Object.fromEntries(
        Object.entries(extractions).map(([category, extraction]) => [
          category,
          this.ensureUniqueItemIds(extraction),
        ]),
      ),
      providerMetadata: {
        ...(primaryAnalysis?.providerMetadata || analyses[0].providerMetadata),
        segmentCount: segments.length,
      },
    };
  }

  private mergeDetection(
    current: MedicalDocumentDetectedCategory,
    next: MedicalDocumentDetectedCategory,
  ): MedicalDocumentDetectedCategory {
    return {
      category: current.category,
      confidence: Math.max(current.confidence || 0, next.confidence || 0),
      pageStart: this.minimumDefined(current.pageStart, next.pageStart),
      pageEnd: this.maximumDefined(current.pageEnd, next.pageEnd),
      summary: current.summary || next.summary,
      evidence: current.evidence || next.evidence,
    };
  }

  private mapDocumentSections(
    inference: JsonObject,
  ): MedicalDocumentDetectedCategory[] {
    return this.arrayValue(inference, [
      'document_sections',
      'documentSections',
      'secciones_documento',
    ])
      .map((value) => {
        const section = this.asObject(value);
        return {
          category: this.toDocumentType(
            this.stringValue(section, [
              'category',
              'document_type',
              'documentType',
              'categoria',
            ]),
          ),
          confidence: this.numberValue(section, ['confidence', 'confianza']),
          pageStart: this.numberValue(section, [
            'page_start',
            'pageStart',
            'pagina_inicio',
          ]),
          pageEnd: this.numberValue(section, [
            'page_end',
            'pageEnd',
            'pagina_fin',
          ]),
          summary: this.stringValue(section, ['summary', 'resumen']),
          evidence: this.stringValue(section, ['evidence', 'evidencia']),
        };
      })
      .filter((section) => section.category !== MedicalDocumentType.Other);
  }

  private mergeSectionDetections(
    main: MedicalDocumentDetectedCategory | undefined,
    sections: MedicalDocumentDetectedCategory[],
  ): MedicalDocumentDetectedCategory[] {
    const detections = new Map<
      MedicalDocumentType,
      MedicalDocumentDetectedCategory
    >();
    for (const detection of [main, ...sections]) {
      if (!detection) continue;
      const existing = detections.get(detection.category);
      detections.set(
        detection.category,
        existing ? this.mergeDetection(existing, detection) : detection,
      );
    }
    return [...detections.values()];
  }

  private extractionForCategory(
    extraction: MedicalDocumentExtraction,
    category: MedicalDocumentType,
  ): MedicalDocumentExtraction {
    const common = {
      ...extraction,
      documentType: category,
      diagnoses: [],
      medications: [],
      vaccinations: [],
      medicalOrders: [],
      clinicalHistory: undefined,
      diagnosticResults: [],
      referral: undefined,
    };

    if (category === MedicalDocumentType.Prescription) {
      return {
        ...common,
        diagnoses: extraction.diagnoses,
        medications: extraction.medications,
      };
    }
    if (category === MedicalDocumentType.MedicalOrder) {
      return {
        ...common,
        diagnoses: extraction.diagnoses,
        medicalOrders: extraction.medicalOrders,
      };
    }
    if (category === MedicalDocumentType.Referral) {
      return {
        ...common,
        diagnoses: extraction.diagnoses,
        medications: extraction.medications,
        referral: extraction.referral,
      };
    }
    if (category === MedicalDocumentType.VaccinationCard) {
      return { ...common, vaccinations: extraction.vaccinations };
    }
    if (category === MedicalDocumentType.ClinicalHistory) {
      return {
        ...common,
        diagnoses: extraction.diagnoses,
        clinicalHistory: extraction.clinicalHistory,
        diagnosticResults: extraction.diagnosticResults,
      };
    }
    return extraction;
  }

  private mergeExtraction(
    current: MedicalDocumentExtraction,
    next: MedicalDocumentExtraction,
  ): MedicalDocumentExtraction {
    return {
      documentType: current.documentType,
      documentTypeConfidence: Math.max(
        current.documentTypeConfidence || 0,
        next.documentTypeConfidence || 0,
      ),
      summary: current.summary || next.summary,
      documentDate: current.documentDate || next.documentDate,
      issuer: { ...next.issuer, ...current.issuer },
      patientHints: this.uniqueStrings([
        ...current.patientHints,
        ...next.patientHints,
      ]),
      diagnoses: [...current.diagnoses, ...next.diagnoses],
      medications: [...current.medications, ...next.medications],
      vaccinations: [...current.vaccinations, ...next.vaccinations],
      medicalOrders: [...current.medicalOrders, ...next.medicalOrders],
      clinicalHistory:
        current.clinicalHistory || next.clinicalHistory
          ? { ...next.clinicalHistory, ...current.clinicalHistory }
          : undefined,
      diagnosticResults: [
        ...(current.diagnosticResults || []),
        ...(next.diagnosticResults || []),
      ],
      referral:
        current.referral || next.referral
          ? { ...next.referral, ...current.referral }
          : undefined,
      additionalFields: {
        ...next.additionalFields,
        ...current.additionalFields,
      },
      warnings: this.uniqueStrings([...current.warnings, ...next.warnings]),
    };
  }

  private ensureUniqueItemIds(
    extraction: MedicalDocumentExtraction,
  ): MedicalDocumentExtraction {
    const used = new Set<string>();
    const normalize = <T extends { id: string }>(items: T[]): T[] =>
      items.map((item) => {
        const base = item.id;
        let id = base;
        let suffix = 2;
        while (used.has(id)) id = `${base}-${suffix++}`;
        used.add(id);
        return { ...item, id };
      });

    return {
      ...extraction,
      diagnoses: normalize(extraction.diagnoses),
      medications: normalize(extraction.medications),
      vaccinations: normalize(extraction.vaccinations),
      medicalOrders: normalize(extraction.medicalOrders),
      diagnosticResults: normalize(extraction.diagnosticResults || []),
    };
  }

  private pageRange(standard: JsonObject): {
    pageStart?: number;
    pageEnd?: number;
  } {
    const metadata = this.asObject(standard.metadata);
    const pages = this.arrayValue(standard, ['pages'])
      .map((page) => this.numberValue(this.asObject(page), ['page_index']))
      .filter((page): page is number => page !== undefined)
      .map((page) => page + 1);
    return {
      pageStart:
        this.numberValue(metadata, ['start_page_index']) ??
        (pages.length > 0 ? Math.min(...pages) : undefined),
      pageEnd:
        this.numberValue(metadata, ['end_page_index']) ??
        (pages.length > 0 ? Math.max(...pages) : undefined),
    };
  }

  private minimumDefined(
    ...values: Array<number | undefined>
  ): number | undefined {
    const defined = values.filter(
      (value): value is number => value !== undefined,
    );
    return defined.length > 0 ? Math.min(...defined) : undefined;
  }

  private maximumDefined(
    ...values: Array<number | undefined>
  ): number | undefined {
    const defined = values.filter(
      (value): value is number => value !== undefined,
    );
    return defined.length > 0 ? Math.max(...defined) : undefined;
  }

  private uniqueStrings(values: string[]): string[] {
    return [...new Set(values)];
  }

  private mapDiagnoses(
    values: unknown[],
    evidenceValues: unknown[] = [],
  ): ExtractedDiagnosis[] {
    return values
      .map((value, index) => {
        const item = this.asObject(value);
        const evidence = this.asObject(evidenceValues[index]);
        return {
          id: this.itemId(item, 'diagnosis', index),
          name: this.itemName(value, item, [
            'name',
            'nombre',
            'diagnosis',
            'diagnostico',
          ]),
          code: this.stringValue(item, ['code', 'codigo']),
          notes: this.stringValue(item, [
            'notes',
            'description',
            'observaciones',
          ]),
          confidence: this.itemConfidence(item, evidence),
          source: this.mapSource(item) || this.mapEvidenceSource(evidence),
        };
      })
      .filter((item) => item.name.length > 0);
  }

  private mapMedications(
    values: unknown[],
    evidenceValues: unknown[] = [],
  ): ExtractedMedication[] {
    return values
      .map((value, index) => {
        const item = this.asObject(value);
        const evidence = this.asObject(evidenceValues[index]);
        return {
          id: this.itemId(item, 'medication', index),
          name: this.itemName(value, item, [
            'name',
            'nombre',
            'medication',
            'medicamento',
          ]),
          activeIngredient: this.stringValue(item, [
            'active_ingredient',
            'activeIngredient',
            'principio_activo',
          ]),
          presentation: this.stringValue(item, [
            'presentation',
            'presentacion',
          ]),
          dose: this.stringValue(item, ['dose', 'dosis']),
          route: this.stringValue(item, ['route', 'via']),
          frequency: this.stringValue(item, ['frequency', 'frecuencia']),
          duration: this.stringValue(item, ['duration', 'duracion']),
          instructions: this.stringValue(item, [
            'instructions',
            'indicaciones',
          ]),
          confidence: this.itemConfidence(item, evidence),
          source:
            this.mapSource(item) || this.mapEvidenceSource(evidence, ['name']),
        };
      })
      .filter((item) => item.name.length > 0);
  }

  private mapVaccinations(
    values: unknown[],
    evidenceValues: unknown[] = [],
  ): ExtractedVaccination[] {
    return values
      .map((value, index) => {
        const item = this.asObject(value);
        const evidence = this.asObject(evidenceValues[index]);
        return {
          id: this.itemId(item, 'vaccination', index),
          name: this.itemName(value, item, [
            'name',
            'nombre',
            'vaccine_name',
            'vaccineName',
            'vacuna',
          ]),
          diseasesCovered: this.stringArrayValue(item, [
            'diseases_covered',
            'diseasesCovered',
            'enfermedades',
          ]),
          brand: this.stringValue(item, ['brand', 'marca']),
          manufacturer: this.stringValue(item, ['manufacturer', 'fabricante']),
          vaccineType: this.stringValue(item, [
            'vaccine_type',
            'vaccineType',
            'tipo_vacuna',
            'tipo',
          ]),
          lot: this.stringValue(item, ['lot', 'lote']),
          lotExpirationDate: this.stringValue(item, [
            'lot_expiration_date',
            'lotExpirationDate',
            'fecha_vencimiento_lote',
            'vencimiento_lote',
          ]),
          applicationDate: this.stringValue(item, [
            'application_date',
            'applicationDate',
            'fecha_aplicacion',
          ]),
          nextDoseDate: this.stringValue(item, [
            'next_dose_date',
            'nextDoseDate',
            'proxima_dosis',
          ]),
          route: this.stringValue(item, ['route', 'via']),
          applicationSite: this.stringValue(item, [
            'application_site',
            'applicationSite',
            'sitio_aplicacion',
          ]),
          tagNumber: this.stringValue(item, [
            'tag_number',
            'tagNumber',
            'numero_placa',
            'placa',
          ]),
          veterinarian: this.stringValue(item, ['veterinarian', 'veterinario']),
          confidence: this.itemConfidence(item, evidence),
          source:
            this.mapSource(item) || this.mapEvidenceSource(evidence, ['name']),
        };
      })
      .filter((item) => item.name.length > 0);
  }

  private mapMedicalOrders(
    values: unknown[],
    evidenceValues: unknown[] = [],
  ): ExtractedMedicalOrder[] {
    const mapped = values.map((value, index) => {
      const item = this.asObject(value);
      const evidence = this.asObject(evidenceValues[index]);
      return {
        id: this.itemId(item, 'medical-order', index),
        name: this.itemName(value, item, [
          'name',
          'nombre',
          'order_name',
          'orderName',
          'orden',
        ]),
        orderType: this.stringValue(item, ['order_type', 'orderType', 'tipo']),
        instructions: this.stringValue(item, ['instructions', 'indicaciones']),
        priority: this.stringValue(item, ['priority', 'prioridad']),
        confidence: this.itemConfidence(item, evidence),
        source: this.mapSource(item) || this.mapEvidenceSource(evidence),
      };
    });

    const orders = mapped.filter((item) => item.name.length > 0);
    const orphanInstructions = mapped
      .filter((item) => item.name.length === 0)
      .map((item) => item.instructions)
      .filter((value): value is string => Boolean(value));

    if (orders.length !== 1 || orphanInstructions.length === 0) {
      return orders;
    }

    const instructions = [orders[0].instructions, ...orphanInstructions]
      .filter((value): value is string => Boolean(value))
      .filter((value, index, all) => all.indexOf(value) === index)
      .join('; ');

    return [{ ...orders[0], instructions }];
  }

  private mapDiagnosticResults(
    values: unknown[],
    evidenceValues: unknown[] = [],
  ): ExtractedDiagnosticResult[] {
    return values
      .map((value, index) => {
        const item = this.asObject(value);
        const evidence = this.asObject(evidenceValues[index]);
        return {
          id: this.itemId(item, 'diagnostic-result', index),
          name: this.itemName(value, item, [
            'name',
            'nombre',
            'test_name',
            'testName',
            'study',
            'estudio',
          ]),
          date: this.stringValue(item, ['date', 'fecha']),
          result: this.stringValue(item, ['result', 'resultado']),
          interpretation: this.stringValue(item, [
            'interpretation',
            'interpretacion',
            'notes',
          ]),
          status: this.stringValue(item, ['status', 'estado']),
          confidence: this.itemConfidence(item, evidence),
          source:
            this.mapSource(item) || this.mapEvidenceSource(evidence, ['name']),
        };
      })
      .filter((item) => item.name.length > 0);
  }

  private mapIssuer(
    inference: JsonObject,
  ): MedicalDocumentExtraction['issuer'] {
    const issuer = this.asObject(this.value(inference, ['issuer', 'emisor']));
    if (Object.keys(issuer).length === 0) return undefined;

    return {
      name: this.stringValue(issuer, ['name', 'nombre']),
      clinic: this.stringValue(issuer, ['clinic', 'clinica']),
      professionalId: this.stringValue(issuer, [
        'professional_id',
        'professionalId',
        'tarjeta_profesional',
      ]),
    };
  }

  private mapClinicalHistory(
    inference: JsonObject,
    explainability: JsonObject,
  ): MedicalDocumentExtraction['clinicalHistory'] {
    const clinicalHistory = this.asObject(
      this.value(inference, [
        'clinical_history',
        'clinicalHistory',
        'historia_clinica',
      ]),
    );
    if (Object.keys(clinicalHistory).length === 0) return undefined;
    const evidence = this.asObject(
      this.value(explainability, [
        'clinical_history',
        'clinicalHistory',
        'historia_clinica',
      ]),
    );

    return {
      reasonForConsultation: this.stringValue(clinicalHistory, [
        'reason_for_consultation',
        'reasonForConsultation',
        'motivo_consulta',
        'presenting_problem',
      ]),
      anamnesis: this.stringValue(clinicalHistory, [
        'anamnesis',
        'history',
        'antecedentes',
      ]),
      physicalExam: this.stringValue(clinicalHistory, [
        'physical_exam',
        'physicalExam',
        'examen_fisico',
      ]),
      vitalSigns: this.stringArrayValue(clinicalHistory, [
        'vital_signs',
        'vitalSigns',
        'signos_vitales',
      ]),
      clinicalFindings: this.stringArrayValue(clinicalHistory, [
        'clinical_findings',
        'clinicalFindings',
        'hallazgos_clinicos',
      ]),
      evolution: this.stringValue(clinicalHistory, [
        'evolution',
        'evolucion',
        'progress_notes',
      ]),
      treatmentPlan: this.stringValue(clinicalHistory, [
        'treatment_plan',
        'treatmentPlan',
        'plan_terapeutico',
        'plan',
      ]),
      recommendations: this.stringArrayValue(clinicalHistory, [
        'recommendations',
        'recomendaciones',
        'observations',
      ]),
      followUp: this.stringValue(clinicalHistory, [
        'follow_up',
        'followUp',
        'seguimiento',
        'control',
      ]),
      prognosis: this.stringValue(clinicalHistory, ['prognosis', 'pronostico']),
      confidence: this.itemConfidence(clinicalHistory, evidence),
      source:
        this.mapSource(clinicalHistory) || this.mapEvidenceSource(evidence),
    };
  }

  private mapReferral(
    inference: JsonObject,
    explainability: JsonObject,
  ): MedicalDocumentExtraction['referral'] {
    const referral = this.asObject(
      this.value(inference, ['referral', 'remision']),
    );
    if (Object.keys(referral).length === 0) return undefined;
    const evidence = this.asObject(
      this.value(explainability, ['referral', 'remision']),
    );

    return {
      reason: this.stringValue(referral, ['reason', 'motivo']),
      destination: this.stringValue(referral, ['destination', 'destino']),
      specialty: this.stringValue(referral, ['specialty', 'especialidad']),
      clinicalSummary: this.stringValue(referral, [
        'clinical_summary',
        'clinicalSummary',
        'resumen_clinico',
      ]),
      confidence: this.itemConfidence(referral, evidence),
      source: this.mapSource(referral) || this.mapEvidenceSource(evidence),
    };
  }

  private itemConfidence(
    item: JsonObject,
    evidence: JsonObject,
  ): number | undefined {
    const direct =
      this.numberValue(item, ['confidence', 'confianza']) ??
      this.numberValue(evidence, ['confidence', 'confianza']);
    if (direct !== undefined) return direct;

    const nested = Object.values(evidence)
      .map((value) => this.asObject(value))
      .filter((value) => {
        const extractedValue = this.value(value, ['value']);
        return extractedValue !== undefined && extractedValue !== '';
      })
      .map((value) => this.numberValue(value, ['confidence', 'confianza']))
      .filter((value): value is number => value !== undefined);

    if (nested.length === 0) return undefined;
    return nested.reduce((total, value) => total + value, 0) / nested.length;
  }

  private mapEvidenceSource(
    evidence: JsonObject,
    preferredKeys: string[] = [],
  ): { page?: number; text?: string } | undefined {
    for (const key of preferredKeys) {
      const source = this.mapDirectEvidenceSource(this.asObject(evidence[key]));
      if (source) return source;
    }

    const direct = this.mapDirectEvidenceSource(evidence);
    if (direct) return direct;

    for (const value of Object.values(evidence)) {
      const source = this.mapDirectEvidenceSource(this.asObject(value));
      if (source) return source;
    }
    return undefined;
  }

  private mapDirectEvidenceSource(
    evidence: JsonObject,
  ): { page?: number; text?: string } | undefined {
    const geometry = this.asObject(this.arrayValue(evidence, ['geometry'])[0]);
    const page = this.numberValue(geometry, ['page', 'pagina']);
    const extractedValue = this.value(evidence, ['value']);
    const text =
      typeof extractedValue === 'string' && extractedValue.trim()
        ? extractedValue.trim()
        : undefined;

    return page !== undefined || text !== undefined
      ? { page, text }
      : undefined;
  }

  private mapSource(
    item: JsonObject,
  ): { page?: number; text?: string } | undefined {
    const source = this.asObject(
      this.value(item, ['source', 'fuente', 'evidence', 'evidencia']),
    );
    const page =
      this.numberValue(source, ['page', 'pagina']) ??
      this.numberValue(item, ['page', 'pagina']);
    const text =
      this.stringValue(source, ['text', 'texto']) ??
      this.stringValue(item, ['source_text', 'sourceText']);

    return page !== undefined || text !== undefined
      ? { page, text }
      : undefined;
  }

  private additionalFields(inference: JsonObject): Record<string, unknown> {
    const knownKeys = new Set([
      'document_type',
      'documentType',
      'tipo_documento',
      'tipoDocumento',
      'summary',
      'resumen',
      'document_date',
      'documentDate',
      'fecha_documento',
      'fechaDocumento',
      'issuer',
      'emisor',
      'patient_hints',
      'patientHints',
      'patients',
      'pacientes',
      'diagnoses',
      'diagnostics',
      'diagnosticos',
      'diagnostico',
      'medications',
      'medicines',
      'medicamentos',
      'vaccinations',
      'vaccines',
      'vacunas',
      'medical_orders',
      'medicalOrders',
      'orders',
      'ordenes',
      'clinical_history',
      'clinicalHistory',
      'historia_clinica',
      'diagnostic_results',
      'diagnosticResults',
      'test_results',
      'resultados_diagnosticos',
      'referral',
      'remision',
      'warnings',
      'advertencias',
      'document_sections',
      'documentSections',
      'secciones_documento',
    ]);

    return Object.fromEntries(
      Object.entries(inference).filter(([key]) => !knownKeys.has(key)),
    );
  }

  private standardSummary(standard: JsonObject): string | undefined {
    const document = this.asObject(standard.document);
    return this.stringValue(document, ['summary', 'description']);
  }

  private toDocumentType(value?: string): MedicalDocumentType {
    const normalized = (value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_');

    if (
      normalized.includes('vacc') ||
      normalized.includes('vacun') ||
      normalized.includes('carne')
    ) {
      return MedicalDocumentType.VaccinationCard;
    }
    if (normalized.includes('referral') || normalized.includes('remision')) {
      return MedicalDocumentType.Referral;
    }
    if (
      normalized.includes('medical_order') ||
      normalized.includes('orden_medica')
    ) {
      return MedicalDocumentType.MedicalOrder;
    }
    if (
      normalized.includes('clinical_history') ||
      normalized.includes('historia_clinica') ||
      normalized.includes('patient_chart') ||
      normalized.includes('medical_summary_report')
    ) {
      return MedicalDocumentType.ClinicalHistory;
    }
    if (
      normalized.includes('prescription') ||
      normalized.includes('formula') ||
      normalized.includes('receta')
    ) {
      return MedicalDocumentType.Prescription;
    }
    return MedicalDocumentType.Other;
  }

  private parseJson(value?: string): JsonObject {
    if (!value) return {};
    try {
      return this.asObject(JSON.parse(value));
    } catch {
      return {};
    }
  }

  private itemId(item: JsonObject, prefix: string, index: number): string {
    return this.stringValue(item, ['id']) || `${prefix}-${index + 1}`;
  }

  private itemName(raw: unknown, item: JsonObject, keys: string[]): string {
    return typeof this.unwrap(raw) === 'string'
      ? String(this.unwrap(raw)).trim()
      : this.stringValue(item, keys) || '';
  }

  private value(object: JsonObject, keys: string[]): unknown {
    for (const key of keys) {
      if (object[key] !== undefined && object[key] !== null) {
        return this.unwrap(object[key]);
      }
    }
    return undefined;
  }

  private stringValue(object: JsonObject, keys: string[]): string | undefined {
    const value = this.value(object, keys);
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number') return String(value);
    return undefined;
  }

  private numberValue(object: JsonObject, keys: string[]): number | undefined {
    const value = this.value(object, keys);
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (
      typeof value === 'string' &&
      value.trim() &&
      Number.isFinite(Number(value))
    )
      return Number(value);
    return undefined;
  }

  private arrayValue(object: JsonObject, keys: string[]): unknown[] {
    const value = this.value(object, keys);
    if (Array.isArray(value)) return value;
    return value !== undefined ? [value] : [];
  }

  private stringArrayValue(object: JsonObject, keys: string[]): string[] {
    return this.arrayValue(object, keys)
      .map((value) => this.unwrap(value))
      .filter(
        (value): value is string =>
          typeof value === 'string' && value.trim().length > 0,
      )
      .map((value) => value.trim());
  }

  private unwrap(value: unknown): unknown {
    const object = this.asObject(value);
    return Object.keys(object).length > 0 && 'value' in object
      ? object.value
      : value;
  }

  private asObject(value: unknown): JsonObject {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as JsonObject)
      : {};
  }
}
