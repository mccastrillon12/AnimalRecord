import { Injectable } from '@nestjs/common';
import {
  ExtractedDiagnosis,
  ExtractedMedicalOrder,
  ExtractedMedication,
  ExtractedVaccination,
  MedicalDocumentExtraction,
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
    const inference = this.asObject(
      custom.inference_result ?? custom.inferenceResult,
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
      ]) || this.stringValue(matchedBlueprint, ['name']);

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
      ),
      medications: this.mapMedications(
        this.arrayValue(inference, [
          'medications',
          'medicines',
          'medicamentos',
        ]),
      ),
      vaccinations: this.mapVaccinations(
        this.arrayValue(inference, ['vaccinations', 'vaccines', 'vacunas']),
      ),
      medicalOrders: this.mapMedicalOrders(
        this.arrayValue(inference, [
          'medical_orders',
          'medicalOrders',
          'orders',
          'ordenes',
        ]),
      ),
      referral: this.mapReferral(inference),
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

    return { extraction, providerMetadata };
  }

  private mapDiagnoses(values: unknown[]): ExtractedDiagnosis[] {
    return values
      .map((value, index) => {
        const item = this.asObject(value);
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
          confidence: this.numberValue(item, ['confidence', 'confianza']),
          source: this.mapSource(item),
        };
      })
      .filter((item) => item.name.length > 0);
  }

  private mapMedications(values: unknown[]): ExtractedMedication[] {
    return values
      .map((value, index) => {
        const item = this.asObject(value);
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
          confidence: this.numberValue(item, ['confidence', 'confianza']),
          source: this.mapSource(item),
        };
      })
      .filter((item) => item.name.length > 0);
  }

  private mapVaccinations(values: unknown[]): ExtractedVaccination[] {
    return values
      .map((value, index) => {
        const item = this.asObject(value);
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
          manufacturer: this.stringValue(item, ['manufacturer', 'fabricante']),
          lot: this.stringValue(item, ['lot', 'lote']),
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
          veterinarian: this.stringValue(item, ['veterinarian', 'veterinario']),
          confidence: this.numberValue(item, ['confidence', 'confianza']),
          source: this.mapSource(item),
        };
      })
      .filter((item) => item.name.length > 0);
  }

  private mapMedicalOrders(values: unknown[]): ExtractedMedicalOrder[] {
    return values
      .map((value, index) => {
        const item = this.asObject(value);
        return {
          id: this.itemId(item, 'medical-order', index),
          name: this.itemName(value, item, [
            'name',
            'nombre',
            'order_name',
            'orderName',
            'orden',
          ]),
          orderType: this.stringValue(item, [
            'order_type',
            'orderType',
            'tipo',
          ]),
          instructions: this.stringValue(item, [
            'instructions',
            'indicaciones',
          ]),
          priority: this.stringValue(item, ['priority', 'prioridad']),
          confidence: this.numberValue(item, ['confidence', 'confianza']),
          source: this.mapSource(item),
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

  private mapReferral(
    inference: JsonObject,
  ): MedicalDocumentExtraction['referral'] {
    const referral = this.asObject(
      this.value(inference, ['referral', 'remision']),
    );
    if (Object.keys(referral).length === 0) return undefined;

    return {
      reason: this.stringValue(referral, ['reason', 'motivo']),
      destination: this.stringValue(referral, ['destination', 'destino']),
      specialty: this.stringValue(referral, ['specialty', 'especialidad']),
      clinicalSummary: this.stringValue(referral, [
        'clinical_summary',
        'clinicalSummary',
        'resumen_clinico',
      ]),
      confidence: this.numberValue(referral, ['confidence', 'confianza']),
      source: this.mapSource(referral),
    };
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
      'referral',
      'remision',
      'warnings',
      'advertencias',
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
