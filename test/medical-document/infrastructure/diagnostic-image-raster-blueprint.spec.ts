import { readFileSync } from 'fs';
import { join } from 'path';

type BlueprintField = {
  inferenceType?: string;
  instruction?: string;
  properties?: Record<string, BlueprintField>;
};

type BlueprintSchema = {
  class: string;
  properties: Record<string, BlueprintField>;
  definitions: Record<string, BlueprintField>;
};

describe('Diagnostic image raster blueprint', () => {
  const schema = JSON.parse(
    readFileSync(
      join(
        process.cwd(),
        'docs',
        'aws',
        'blueprints',
        'diagnostic-image-raster.schema.json',
      ),
      'utf8',
    ),
  ) as BlueprintSchema;

  it('routes raster content without exposing clinical interpretation fields', () => {
    expect(schema.class).toBe('MEDICAL_RASTER_IMAGE');
    expect(schema.properties.document_type?.inferenceType).toBe('inferred');
    expect(schema.properties.document_type?.instruction).toContain(
      'DIAGNOSTIC_IMAGE',
    );
    expect(schema.properties.document_type?.instruction).toContain(
      'DOCUMENT_SCAN',
    );
    expect(schema.definitions.DIAGNOSTIC_IMAGE?.properties).not.toHaveProperty(
      'reported_diagnosis',
    );
    expect(schema.definitions.PATIENT).not.toHaveProperty('instruction');
    expect(schema.definitions.DIAGNOSTIC_IMAGE).not.toHaveProperty(
      'instruction',
    );
    expect(JSON.stringify(schema).toLowerCase()).not.toContain(
      'clinical_findings',
    );
  });

  it('uses only inferred leaf fields as required by IMAGE blueprints', () => {
    const visit = (value: unknown): void => {
      if (Array.isArray(value)) {
        value.forEach(visit);
        return;
      }
      if (!value || typeof value !== 'object') return;
      const object = value as Record<string, unknown>;
      if (typeof object.inferenceType === 'string') {
        expect(object.inferenceType).toBe('inferred');
      }
      Object.values(object).forEach(visit);
    };

    visit(schema);
  });

  it('keeps every description and instruction within the BDA limit', () => {
    const visit = (value: unknown): void => {
      if (Array.isArray(value)) {
        value.forEach(visit);
        return;
      }
      if (!value || typeof value !== 'object') return;
      for (const [key, nested] of Object.entries(
        value as Record<string, unknown>,
      )) {
        if (['description', 'instruction'].includes(key)) {
          expect(String(nested).length).toBeLessThanOrEqual(600);
        }
        visit(nested);
      }
    };

    visit(schema);
  });
});
