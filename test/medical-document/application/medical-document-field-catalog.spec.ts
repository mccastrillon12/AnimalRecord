import {
  MedicalDocumentFieldCatalog,
  MedicalDocumentFieldKind,
} from '../../../src/context/medical-document/application/medical-document-field-catalog';
import { MedicalDocumentType } from '../../../src/context/medical-document/domain/medical-document';

describe('MedicalDocumentFieldCatalog', () => {
  const catalog = new MedicalDocumentFieldCatalog();

  it.each(Object.values(MedicalDocumentType))(
    'returns a complete es-CO catalog for %s',
    (category) => {
      const response = catalog.get(category, 'es');

      expect(response.category).toBe(category);
      expect(response.categoryLabel).toBeTruthy();
      expect(response.locale).toBe('es-CO');
      expect(response.catalogVersion).toMatch(/^\d+\.\d+\.\d+$/);
      expect(response.hiddenTechnicalKeys).toEqual([
        'id',
        'confidence',
        'source',
      ]);
      expect(response.sections.map(({ key }) => key)).toEqual(
        expect.arrayContaining([
          'general',
          'issuer',
          'patient',
          'owner',
          'additional',
          'warnings',
        ]),
      );
      expect(new Set(response.fields.map(({ path }) => path)).size).toBe(
        response.fields.length,
      );
      expect(response.fields).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: 'additionalFields',
            kind: MedicalDocumentFieldKind.DynamicObject,
            fallbackLabel: 'Campo adicional',
          }),
        ]),
      );
    },
  );

  it('describes diagnostic image metadata without inventing clinical fields', () => {
    const response = catalog.get(MedicalDocumentType.DiagnosticImage);
    const images = response.fields.find(
      ({ path }) => path === 'diagnosticImages',
    );

    expect(images?.kind).toBe(MedicalDocumentFieldKind.Table);
    expect(images?.columns?.map(({ key }) => key)).toEqual([
      'name',
      'modality',
      'studyDate',
      'studyTime',
      'studyDescription',
      'bodyRegion',
      'projection',
      'laterality',
      'marker',
      'seriesNumber',
      'imageNumber',
      'accessionNumber',
      'calibrationStatus',
      'reportedDiagnosis',
    ]);
    expect(
      images?.columns?.find(({ key }) => key === 'reportedDiagnosis'),
    ).toMatchObject({ label: 'Diagnóstico reportado en el archivo' });
    expect(response.fields.map(({ path }) => path)).not.toContain(
      'clinicalHistory',
    );
  });

  it('keeps laboratory values as opaque strings and separates the printed flag', () => {
    const response = catalog.get(MedicalDocumentType.LaboratoryResult);
    const results = response.fields.find(
      ({ path }) => path === 'laboratoryResults',
    );

    expect(results?.columns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'result', label: 'Resultado' }),
        expect.objectContaining({ key: 'unit', label: 'Unidad' }),
        expect.objectContaining({
          key: 'referenceRange',
          label: 'Rango de referencia',
        }),
        expect.objectContaining({ key: 'flag', label: 'Indicador impreso' }),
      ]),
    );
  });

  it('does not expose technical row metadata as visible table columns', () => {
    for (const category of Object.values(MedicalDocumentType)) {
      const visibleColumns = catalog
        .get(category)
        .fields.flatMap(({ columns = [] }) => columns.map(({ key }) => key));

      expect(visibleColumns).not.toEqual(
        expect.arrayContaining(['id', 'confidence', 'source']),
      );
    }
  });
});
