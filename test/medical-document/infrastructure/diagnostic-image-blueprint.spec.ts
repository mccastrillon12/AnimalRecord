import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Diagnostic image blueprint', () => {
  const schema = JSON.parse(
    readFileSync(
      join(
        process.cwd(),
        'docs',
        'aws',
        'blueprints',
        'diagnostic-image.schema.json',
      ),
      'utf8',
    ),
  ) as {
    class: string;
    description: string;
    properties: Record<string, { instruction?: string }>;
    definitions: Record<
      string,
      {
        properties?: Record<
          string,
          { inferenceType?: string; instruction?: string }
        >;
      }
    >;
  };

  it('uses the canonical class and transcription-only extraction contract', () => {
    expect(schema.class).toBe('DIAGNOSTIC_IMAGE');
    expect(schema.properties).toHaveProperty('document_sections');
    expect(schema.properties).toHaveProperty('diagnostic_image');
    expect(schema.definitions.DIAGNOSTIC_IMAGE.properties).toHaveProperty(
      'name',
    );
    expect(schema.definitions.DIAGNOSTIC_IMAGE.properties).toHaveProperty(
      'modality',
    );
    expect(schema.definitions.DIAGNOSTIC_IMAGE.properties).toHaveProperty(
      'study_date',
    );
    expect(schema.definitions.DIAGNOSTIC_IMAGE.properties).toHaveProperty(
      'marker',
    );
    expect(schema.definitions.DIAGNOSTIC_IMAGE.properties).toHaveProperty(
      'image_number',
    );
    expect(schema.definitions.DIAGNOSTIC_IMAGE.properties).toHaveProperty(
      'reported_diagnosis',
    );
    expect(
      schema.definitions.DIAGNOSTIC_IMAGE.properties?.reported_diagnosis
        .inferenceType,
    ).toBe('explicit');
    expect(
      schema.definitions.DIAGNOSTIC_IMAGE.properties?.name.inferenceType,
    ).toBe('inferred');
    expect(schema.properties.diagnostic_image.instruction).toContain(
      'Texto y metadatos de esta imagen',
    );
  });

  it('recognizes an isolated image from visible technical overlays', () => {
    expect(schema.description).toContain(
      'cuyo contenido principal sea el estudio visual',
    );
    expect(schema.description).toContain('Patient ID');
    expect(schema.description).toContain('Clasificar aqui aunque solo existan');
    expect(schema.properties.document_sections.instruction).toContain(
      'Crear siempre una fila DIAGNOSTIC_IMAGE',
    );
  });

  it.each([
    'findings',
    'clinical_findings',
    'impression',
    'diagnosis',
    'prognosis',
    'recommendations',
    'interpretation',
  ])('does not expose a %s field', (field) => {
    expect(schema.properties).not.toHaveProperty(field);
    expect(schema.definitions.DIAGNOSTIC_IMAGE.properties).not.toHaveProperty(
      field,
    );
  });

  it('only permits a diagnosis as literal reported text', () => {
    const instruction =
      schema.definitions.DIAGNOSTIC_IMAGE.properties?.reported_diagnosis
        .instruction || '';

    expect(instruction).toContain('literalmente escrito');
    expect(instruction).toContain('Nunca deducirlo');
  });

  it('keeps its description and instructions within BDA limits', () => {
    expect(schema.description.length).toBeLessThanOrEqual(600);

    const inspect = (value: unknown): void => {
      if (!value || typeof value !== 'object') return;
      const object = value as Record<string, unknown>;
      if (typeof object.instruction === 'string') {
        expect(object.instruction.length).toBeLessThanOrEqual(600);
      }
      Object.values(object).forEach(inspect);
    };

    inspect(schema);
  });
});
