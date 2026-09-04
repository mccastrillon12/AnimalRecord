import { Injectable } from '@nestjs/common';
import { MedicalDocumentType } from '../domain/medical-document';

export enum MedicalDocumentFieldKind {
  Text = 'TEXT',
  LongText = 'LONG_TEXT',
  Date = 'DATE',
  List = 'LIST',
  Table = 'TABLE',
  DynamicObject = 'DYNAMIC_OBJECT',
}

export type MedicalDocumentFieldCatalogSection = {
  key: string;
  label: string;
  order: number;
};

export type MedicalDocumentFieldCatalogColumn = {
  key: string;
  label: string;
  kind: MedicalDocumentFieldKind;
  order: number;
  editable: boolean;
  hideWhenEmpty: boolean;
};

export type MedicalDocumentFieldCatalogField = {
  path: string;
  label: string;
  sectionKey: string;
  order: number;
  kind: MedicalDocumentFieldKind;
  editable: boolean;
  hideWhenEmpty: boolean;
  columns?: MedicalDocumentFieldCatalogColumn[];
  fallbackLabel?: string;
};

export type MedicalDocumentFieldCatalogResponse = {
  catalogVersion: string;
  locale: 'es-CO';
  category: MedicalDocumentType;
  categoryLabel: string;
  sections: MedicalDocumentFieldCatalogSection[];
  fields: MedicalDocumentFieldCatalogField[];
  hiddenTechnicalKeys: string[];
};

type ColumnInput = [
  key: string,
  label: string,
  kind?: MedicalDocumentFieldKind,
];

const CATALOG_VERSION = '1.0.0';

const CATEGORY_LABELS: Record<MedicalDocumentType, string> = {
  [MedicalDocumentType.Prescription]: 'Fórmula médica',
  [MedicalDocumentType.MedicalOrder]: 'Orden médica',
  [MedicalDocumentType.Referral]: 'Remisión',
  [MedicalDocumentType.VaccinationCard]: 'Carné de vacunación',
  [MedicalDocumentType.ClinicalHistory]: 'Historia clínica',
  [MedicalDocumentType.DiagnosticImage]: 'Imagen diagnóstica',
  [MedicalDocumentType.LaboratoryResult]: 'Resultado de laboratorio',
  [MedicalDocumentType.Other]: 'Otro documento',
};

const section = (
  key: string,
  label: string,
  order: number,
): MedicalDocumentFieldCatalogSection => ({ key, label, order });

const field = (
  path: string,
  label: string,
  sectionKey: string,
  order: number,
  kind: MedicalDocumentFieldKind = MedicalDocumentFieldKind.Text,
  editable = true,
  hideWhenEmpty = true,
): MedicalDocumentFieldCatalogField => ({
  path,
  label,
  sectionKey,
  order,
  kind,
  editable,
  hideWhenEmpty,
});

const table = (
  path: string,
  label: string,
  sectionKey: string,
  order: number,
  columns: ColumnInput[],
): MedicalDocumentFieldCatalogField => ({
  ...field(path, label, sectionKey, order, MedicalDocumentFieldKind.Table),
  columns: columns.map(([key, columnLabel, kind], index) => ({
    key,
    label: columnLabel,
    kind: kind ?? MedicalDocumentFieldKind.Text,
    order: (index + 1) * 10,
    editable: true,
    hideWhenEmpty: true,
  })),
});

const COMMON_SECTIONS: MedicalDocumentFieldCatalogSection[] = [
  section('general', 'Información general', 10),
  section('issuer', 'Emisor', 20),
  section('patient', 'Paciente', 30),
  section('owner', 'Propietario', 40),
  section('additional', 'Campos adicionales', 90),
  section('warnings', 'Advertencias', 100),
];

const COMMON_FIELDS: MedicalDocumentFieldCatalogField[] = [
  field('documentType', 'Tipo de documento', 'general', 10, undefined, false),
  field(
    'documentTypeConfidence',
    'Confianza de clasificación',
    'general',
    20,
    undefined,
    false,
  ),
  field('summary', 'Resumen', 'general', 30, MedicalDocumentFieldKind.LongText),
  field(
    'documentDate',
    'Fecha del documento',
    'general',
    40,
    MedicalDocumentFieldKind.Date,
  ),
  field('issuer.name', 'Nombre del profesional', 'issuer', 10),
  field('issuer.clinic', 'Clínica o institución', 'issuer', 20),
  field(
    'issuer.professionalId',
    'Matrícula o identificación profesional',
    'issuer',
    30,
  ),
  field('patient.name', 'Nombre del paciente', 'patient', 10),
  field('patient.identifier', 'Identificador del paciente', 'patient', 20),
  field('patient.species', 'Especie', 'patient', 30),
  field('patient.breed', 'Raza', 'patient', 40),
  field('patient.sex', 'Sexo', 'patient', 50),
  field('patient.color', 'Color o pelaje', 'patient', 60),
  field('patient.size', 'Talla o tamaño', 'patient', 70),
  field('patient.reproductiveStatus', 'Estado reproductivo', 'patient', 80),
  field('patient.age', 'Edad', 'patient', 90),
  field(
    'patient.birthDate',
    'Fecha de nacimiento',
    'patient',
    100,
    MedicalDocumentFieldKind.Date,
  ),
  field('patient.weight', 'Peso', 'patient', 110),
  field('patient.microchip', 'Microchip', 'patient', 120),
  field(
    'patientHints',
    'Fragmentos identificadores',
    'patient',
    130,
    MedicalDocumentFieldKind.List,
    false,
  ),
  field('owner.name', 'Nombre del propietario', 'owner', 10),
  field('owner.identification', 'Identificación del propietario', 'owner', 20),
  field('owner.phone', 'Teléfono', 'owner', 30),
  field('owner.email', 'Correo electrónico', 'owner', 40),
  field('owner.address', 'Dirección', 'owner', 50),
  {
    ...field(
      'additionalFields',
      'Campos adicionales',
      'additional',
      10,
      MedicalDocumentFieldKind.DynamicObject,
    ),
    fallbackLabel: 'Campo adicional',
  },
  field(
    'warnings',
    'Advertencias',
    'warnings',
    10,
    MedicalDocumentFieldKind.List,
    false,
  ),
];

const DIAGNOSES = table(
  'diagnoses',
  'Diagnósticos escritos en el documento',
  'diagnoses',
  10,
  [
    ['name', 'Diagnóstico'],
    ['code', 'Código'],
    ['notes', 'Notas', MedicalDocumentFieldKind.LongText],
  ],
);

const MEDICATIONS = table('medications', 'Medicamentos', 'medications', 10, [
  ['name', 'Medicamento'],
  ['activeIngredient', 'Principio activo'],
  ['presentation', 'Presentación'],
  ['dose', 'Dosis'],
  ['route', 'Vía'],
  ['frequency', 'Frecuencia'],
  ['duration', 'Duración'],
  ['instructions', 'Instrucciones', MedicalDocumentFieldKind.LongText],
]);

const DIAGNOSTIC_RESULTS = table(
  'diagnosticResults',
  'Resultados diagnósticos reportados',
  'diagnosticResults',
  10,
  [
    ['name', 'Examen o estudio'],
    ['date', 'Fecha', MedicalDocumentFieldKind.Date],
    ['result', 'Resultado'],
    [
      'interpretation',
      'Interpretación reportada',
      MedicalDocumentFieldKind.LongText,
    ],
    ['status', 'Estado'],
  ],
);

const CATEGORY_SECTIONS: Record<
  MedicalDocumentType,
  MedicalDocumentFieldCatalogSection[]
> = {
  [MedicalDocumentType.Prescription]: [
    section('diagnoses', 'Diagnósticos consignados', 50),
    section('medications', 'Medicamentos', 60),
  ],
  [MedicalDocumentType.MedicalOrder]: [
    section('diagnoses', 'Diagnósticos consignados', 50),
    section('medicalOrders', 'Órdenes médicas', 60),
  ],
  [MedicalDocumentType.Referral]: [
    section('referral', 'Datos de la remisión', 50),
    section('diagnoses', 'Diagnósticos consignados', 60),
    section('medications', 'Medicamentos reportados', 70),
    section('diagnosticResults', 'Resultados reportados', 80),
  ],
  [MedicalDocumentType.VaccinationCard]: [
    section('vaccinations', 'Vacunas', 50),
  ],
  [MedicalDocumentType.ClinicalHistory]: [
    section('clinicalHistory', 'Contenido de la historia clínica', 50),
    section('diagnoses', 'Diagnósticos consignados', 60),
    section('diagnosticResults', 'Resultados reportados', 70),
  ],
  [MedicalDocumentType.DiagnosticImage]: [
    section('diagnosticImages', 'Imágenes diagnósticas', 50),
  ],
  [MedicalDocumentType.LaboratoryResult]: [
    section('laboratoryReport', 'Datos del informe', 50),
    section('laboratoryResults', 'Resultados de laboratorio', 60),
  ],
  [MedicalDocumentType.Other]: [],
};

const CATEGORY_FIELDS: Record<
  MedicalDocumentType,
  MedicalDocumentFieldCatalogField[]
> = {
  [MedicalDocumentType.Prescription]: [DIAGNOSES, MEDICATIONS],
  [MedicalDocumentType.MedicalOrder]: [
    DIAGNOSES,
    table('medicalOrders', 'Órdenes médicas', 'medicalOrders', 10, [
      ['name', 'Examen o procedimiento'],
      ['orderType', 'Tipo de orden'],
      ['instructions', 'Instrucciones', MedicalDocumentFieldKind.LongText],
      ['priority', 'Prioridad'],
    ]),
  ],
  [MedicalDocumentType.Referral]: [
    field(
      'referral.reason',
      'Motivo',
      'referral',
      10,
      MedicalDocumentFieldKind.LongText,
    ),
    field('referral.destination', 'Destino', 'referral', 20),
    field('referral.specialty', 'Especialidad', 'referral', 30),
    field(
      'referral.clinicalSummary',
      'Resumen clínico',
      'referral',
      40,
      MedicalDocumentFieldKind.LongText,
    ),
    { ...DIAGNOSES, order: 10 },
    { ...MEDICATIONS, order: 10 },
    { ...DIAGNOSTIC_RESULTS, order: 10 },
  ],
  [MedicalDocumentType.VaccinationCard]: [
    table('vaccinations', 'Vacunas', 'vaccinations', 10, [
      ['name', 'Vacuna'],
      [
        'diseasesCovered',
        'Enfermedades cubiertas',
        MedicalDocumentFieldKind.List,
      ],
      ['brand', 'Marca'],
      ['manufacturer', 'Fabricante'],
      ['vaccineType', 'Tipo de vacuna'],
      ['lot', 'Lote'],
      [
        'lotExpirationDate',
        'Vencimiento del lote',
        MedicalDocumentFieldKind.Date,
      ],
      ['applicationDate', 'Fecha de aplicación', MedicalDocumentFieldKind.Date],
      ['nextDoseDate', 'Fecha de próxima dosis', MedicalDocumentFieldKind.Date],
      ['route', 'Vía'],
      ['applicationSite', 'Sitio de aplicación'],
      ['tagNumber', 'Número de placa o etiqueta'],
      ['veterinarian', 'Veterinario'],
    ]),
  ],
  [MedicalDocumentType.ClinicalHistory]: [
    field(
      'clinicalHistory.reasonForConsultation',
      'Motivo de consulta',
      'clinicalHistory',
      10,
      MedicalDocumentFieldKind.LongText,
    ),
    field(
      'clinicalHistory.anamnesis',
      'Anamnesis',
      'clinicalHistory',
      20,
      MedicalDocumentFieldKind.LongText,
    ),
    field(
      'clinicalHistory.physicalExam',
      'Examen físico',
      'clinicalHistory',
      30,
      MedicalDocumentFieldKind.LongText,
    ),
    field(
      'clinicalHistory.vitalSigns',
      'Signos vitales',
      'clinicalHistory',
      40,
      MedicalDocumentFieldKind.List,
    ),
    field(
      'clinicalHistory.clinicalFindings',
      'Hallazgos clínicos reportados',
      'clinicalHistory',
      50,
      MedicalDocumentFieldKind.List,
    ),
    field(
      'clinicalHistory.evolution',
      'Evolución',
      'clinicalHistory',
      60,
      MedicalDocumentFieldKind.LongText,
    ),
    field(
      'clinicalHistory.treatmentPlan',
      'Plan de tratamiento',
      'clinicalHistory',
      70,
      MedicalDocumentFieldKind.LongText,
    ),
    field(
      'clinicalHistory.recommendations',
      'Recomendaciones reportadas',
      'clinicalHistory',
      80,
      MedicalDocumentFieldKind.List,
    ),
    field(
      'clinicalHistory.followUp',
      'Seguimiento',
      'clinicalHistory',
      90,
      MedicalDocumentFieldKind.LongText,
    ),
    field(
      'clinicalHistory.prognosis',
      'Pronóstico reportado',
      'clinicalHistory',
      100,
      MedicalDocumentFieldKind.LongText,
    ),
    DIAGNOSES,
    DIAGNOSTIC_RESULTS,
  ],
  [MedicalDocumentType.DiagnosticImage]: [
    table('diagnosticImages', 'Imágenes diagnósticas', 'diagnosticImages', 10, [
      ['name', 'Nombre'],
      ['modality', 'Modalidad'],
      ['studyDate', 'Fecha del estudio', MedicalDocumentFieldKind.Date],
      ['studyTime', 'Hora del estudio'],
      [
        'studyDescription',
        'Descripción técnica',
        MedicalDocumentFieldKind.LongText,
      ],
      ['bodyRegion', 'Región corporal'],
      ['projection', 'Proyección o vista'],
      ['laterality', 'Lateralidad'],
      ['marker', 'Marcador técnico'],
      ['seriesNumber', 'Número de serie'],
      ['imageNumber', 'Número de imagen'],
      ['accessionNumber', 'Número de acceso'],
      ['calibrationStatus', 'Estado de calibración'],
      [
        'reportedDiagnosis',
        'Diagnóstico reportado en el archivo',
        MedicalDocumentFieldKind.LongText,
      ],
    ]),
  ],
  [MedicalDocumentType.LaboratoryResult]: [
    field(
      'laboratoryReport.reportNumber',
      'Número del informe',
      'laboratoryReport',
      10,
    ),
    field(
      'laboratoryReport.orderNumber',
      'Número de orden',
      'laboratoryReport',
      20,
    ),
    field(
      'laboratoryReport.specimenType',
      'Tipo de muestra',
      'laboratoryReport',
      30,
    ),
    field(
      'laboratoryReport.specimenStatus',
      'Estado de la muestra',
      'laboratoryReport',
      40,
    ),
    field(
      'laboratoryReport.collectionDate',
      'Fecha de toma',
      'laboratoryReport',
      50,
      MedicalDocumentFieldKind.Date,
    ),
    field(
      'laboratoryReport.receivedDate',
      'Fecha de recepción',
      'laboratoryReport',
      60,
      MedicalDocumentFieldKind.Date,
    ),
    field(
      'laboratoryReport.reportDate',
      'Fecha del informe',
      'laboratoryReport',
      70,
      MedicalDocumentFieldKind.Date,
    ),
    field(
      'laboratoryReport.analysisDate',
      'Fecha del análisis',
      'laboratoryReport',
      80,
      MedicalDocumentFieldKind.Date,
    ),
    field(
      'laboratoryReport.methods',
      'Métodos',
      'laboratoryReport',
      90,
      MedicalDocumentFieldKind.List,
    ),
    field(
      'laboratoryReport.equipment',
      'Equipos',
      'laboratoryReport',
      100,
      MedicalDocumentFieldKind.List,
    ),
    field(
      'laboratoryReport.analysts',
      'Analistas',
      'laboratoryReport',
      110,
      MedicalDocumentFieldKind.List,
    ),
    field(
      'laboratoryReport.reviewers',
      'Revisores',
      'laboratoryReport',
      120,
      MedicalDocumentFieldKind.List,
    ),
    field(
      'laboratoryReport.reportedComments',
      'Comentarios reportados por el laboratorio',
      'laboratoryReport',
      130,
      MedicalDocumentFieldKind.List,
    ),
    table(
      'laboratoryResults',
      'Resultados de laboratorio',
      'laboratoryResults',
      10,
      [
        ['name', 'Prueba o analito'],
        ['panel', 'Panel'],
        ['result', 'Resultado'],
        ['unit', 'Unidad'],
        ['referenceRange', 'Rango de referencia'],
        ['flag', 'Indicador impreso'],
        ['method', 'Método'],
        [
          'technicalDetails',
          'Detalles técnicos',
          MedicalDocumentFieldKind.LongText,
        ],
      ],
    ),
  ],
  [MedicalDocumentType.Other]: [],
};

@Injectable()
export class MedicalDocumentFieldCatalog {
  get(
    category: MedicalDocumentType,
    locale: 'es' | 'es-CO' = 'es-CO',
  ): MedicalDocumentFieldCatalogResponse {
    const normalizedLocale: 'es-CO' = locale === 'es' ? 'es-CO' : locale;

    return {
      catalogVersion: CATALOG_VERSION,
      locale: normalizedLocale,
      category,
      categoryLabel: CATEGORY_LABELS[category],
      sections: [...COMMON_SECTIONS, ...CATEGORY_SECTIONS[category]].sort(
        (left, right) => left.order - right.order,
      ),
      fields: [...COMMON_FIELDS, ...CATEGORY_FIELDS[category]],
      hiddenTechnicalKeys: ['id', 'confidence', 'source'],
    };
  }
}
