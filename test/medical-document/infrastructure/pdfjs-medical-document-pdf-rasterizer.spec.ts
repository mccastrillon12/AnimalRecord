import { representativePdfPageNumbers } from '../../../src/context/medical-document/infrastructure/pdf/pdfjs-medical-document-pdf-rasterizer';

describe('representativePdfPageNumbers', () => {
  it('keeps every page when the PDF has at most three pages', () => {
    expect(representativePdfPageNumbers(1)).toEqual([1]);
    expect(representativePdfPageNumbers(3)).toEqual([1, 2, 3]);
  });

  it('selects only the first, middle and last pages from a long PDF', () => {
    expect(representativePdfPageNumbers(8)).toEqual([1, 5, 8]);
    expect(representativePdfPageNumbers(20)).toEqual([1, 11, 20]);
  });
});
