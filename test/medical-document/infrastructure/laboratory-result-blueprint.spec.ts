import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type SchemaNode = {
  instruction?: string;
  inferenceType?: string;
  properties?: Record<string, SchemaNode>;
  definitions?: Record<string, SchemaNode>;
  items?: SchemaNode;
  [key: string]: unknown;
};

describe('Laboratory result blueprint', () => {
  const schema = JSON.parse(
    readFileSync(
      join(
        process.cwd(),
        'docs',
        'aws',
        'blueprints',
        'laboratory-result.schema.json',
      ),
      'utf8',
    ),
  ) as SchemaNode & { class: string };

  const report = schema.definitions?.LABORATORY_REPORT.properties || {};
  const result = schema.definitions?.LABORATORY_RESULT.properties || {};

  it('uses the canonical class and literal transcription contract', () => {
    expect(schema.class).toBe('LABORATORY_RESULT');
    expect(schema.properties).toHaveProperty('document_sections');
    expect(schema.properties).toHaveProperty('laboratory_report');
    expect(schema.properties).toHaveProperty('laboratory_results');
    expect(report).toHaveProperty('specimen_type');
    expect(report).toHaveProperty('reported_comments');
    expect(result).toHaveProperty('name');
    expect(result).toHaveProperty('result');
    expect(result).toHaveProperty('unit');
    expect(result).toHaveProperty('reference_range');
    expect(result).toHaveProperty('flag');
    expect(result).toHaveProperty('technical_details');
  });

  it.each([
    'interpretation',
    'status',
    'diagnosis',
    'clinical_findings',
    'prognosis',
    'recommendations',
  ])('does not expose a generated %s field', (field) => {
    expect(schema.properties).not.toHaveProperty(field);
    expect(result).not.toHaveProperty(field);
  });

  it('requires printed flags and keeps authored comments isolated', () => {
    expect(result.flag.instruction).toContain('Solo marcador impreso');
    expect(result.flag.instruction).toContain('No calcularlo');
    expect(report.reported_comments.inferenceType).toBe('explicit');
    expect(report.reported_comments.instruction).toContain(
      'Transcribir literalmente',
    );
    expect(report.reported_comments.instruction).toContain(
      'No crear, completar, resumir ni convertirlos en diagnosticos',
    );
  });

  it('separates printed flags and preserves standalone dash results', () => {
    expect(result.result.instruction).toContain(
      '15* se separa como result 15 y flag *',
    );
    expect(result.result.instruction).toContain(
      'Un guion aislado (-) en la celda es resultado visible',
    );
    expect(result.flag.instruction).toContain(
      'permanece en result y no es flag',
    );
  });

  it('keeps every BDA description and instruction within 600 characters', () => {
    const constrainedTexts: string[] = [];
    const visit = (node: unknown): void => {
      if (!node || typeof node !== 'object') return;
      for (const [key, value] of Object.entries(node)) {
        if (
          (key === 'instruction' || key === 'description') &&
          typeof value === 'string'
        ) {
          constrainedTexts.push(value);
        } else {
          visit(value);
        }
      }
    };

    visit(schema);

    expect(constrainedTexts.length).toBeGreaterThan(0);
    expect(
      Math.max(...constrainedTexts.map((text) => text.length)),
    ).toBeLessThanOrEqual(600);
  });
});
