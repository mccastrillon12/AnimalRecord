import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type BlueprintField = {
  inferenceType?: string;
  instruction?: string;
  properties?: Record<string, BlueprintField>;
};

type BlueprintSchema = {
  description?: string;
  properties: Record<string, BlueprintField>;
  definitions: Record<string, BlueprintField>;
};

const documentBlueprints = [
  'prescription',
  'medical-order',
  'referral',
  'vaccination-card',
  'clinical-history',
  'diagnostic-image',
  'laboratory-result',
];

const loadBlueprint = (name: string): BlueprintSchema =>
  JSON.parse(
    readFileSync(
      join(process.cwd(), 'docs', 'aws', 'blueprints', `${name}.schema.json`),
      'utf8',
    ),
  ) as BlueprintSchema;

describe('Authored document content blueprints', () => {
  it.each(documentBlueprints)(
    '%s extracts authored content without generating a summary',
    (name) => {
      const schema = loadBlueprint(name);

      for (const field of [
        'reported_summary',
        'reported_recommendations',
        'reported_observations',
      ]) {
        expect(schema.properties[field]?.inferenceType).toBe('explicit');
        expect(schema.properties[field]?.instruction).toContain(
          'Transcribir literalmente',
        );
      }

      const recommendationsInstruction =
        schema.properties.reported_recommendations?.instruction;
      expect(recommendationsInstruction).toContain('Indicaciones');
      expect(recommendationsInstruction).toContain('Recommendations');
      expect(recommendationsInstruction).toContain('Indications');
      expect(recommendationsInstruction).toContain('Instructions');

      expect(schema.properties).not.toHaveProperty('summary');
      expect(
        schema.definitions.DOCUMENT_SECTION?.properties,
      ).not.toHaveProperty('summary');

      const inspectLimits = (value: unknown): void => {
        if (!value || typeof value !== 'object') return;
        for (const [key, nested] of Object.entries(value)) {
          if (
            (key === 'instruction' || key === 'description') &&
            typeof nested === 'string'
          ) {
            expect(nested.length).toBeLessThanOrEqual(600);
          }
          inspectLimits(nested);
        }
      };
      inspectLimits(schema);
    },
  );
});
