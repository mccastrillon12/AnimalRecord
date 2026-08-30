import { PDFDocument } from 'pdf-lib';
import {
  createPdfAnalysisInput,
  requiresPdfAnalysisInput,
} from '../../../src/context/medical-document/application/medical-document-analysis-input';

describe('Medical document analysis input', () => {
  it.each(['image/jpeg', 'image/png'])(
    'wraps %s files for document blueprint selection',
    (mimeType) => {
      expect(requiresPdfAnalysisInput(mimeType)).toBe(true);
    },
  );

  it.each(['application/pdf', 'image/tiff'])(
    'keeps %s files in their original BDA-supported document format',
    (mimeType) => {
      expect(requiresPdfAnalysisInput(mimeType)).toBe(false);
    },
  );

  it('creates a readable one-page PDF without replacing the PNG source', async () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=',
      'base64',
    );

    const result = await createPdfAnalysisInput(png, 'image/png');
    const pdf = await PDFDocument.load(result);

    expect(Buffer.from(result).subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.getPageCount()).toBe(1);
    expect(png.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
  });
});
