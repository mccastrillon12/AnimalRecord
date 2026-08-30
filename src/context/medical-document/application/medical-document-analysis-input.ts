import { PDFDocument } from 'pdf-lib';

const PDF_ANALYSIS_MIME_TYPES = new Set(['image/jpeg', 'image/png']);
const TARGET_DPI = 150;
const POINTS_PER_INCH = 72;
const MAX_PAGE_SIDE_POINTS = 9000;

export function requiresPdfAnalysisInput(mimeType: string): boolean {
  return PDF_ANALYSIS_MIME_TYPES.has(mimeType);
}

export async function createPdfAnalysisInput(
  content: Uint8Array,
  mimeType: string,
): Promise<Uint8Array> {
  if (!requiresPdfAnalysisInput(mimeType)) {
    throw new Error(`Cannot create a PDF analysis input from ${mimeType}`);
  }

  const pdf = await PDFDocument.create();
  // pdf-lib's JPEG parser reads from the beginning of the backing ArrayBuffer.
  // Multer can provide a Buffer view with a non-zero byte offset, so copy the
  // exact upload bytes before embedding them.
  const imageBytes = Uint8Array.from(content);
  const image =
    mimeType === 'image/jpeg'
      ? await pdf.embedJpg(imageBytes)
      : await pdf.embedPng(imageBytes);
  const pointsPerPixel = POINTS_PER_INCH / TARGET_DPI;
  const scale = Math.min(
    pointsPerPixel,
    MAX_PAGE_SIDE_POINTS / image.width,
    MAX_PAGE_SIDE_POINTS / image.height,
  );
  const width = image.width * scale;
  const height = image.height * scale;
  const page = pdf.addPage([width, height]);
  page.drawImage(image, { x: 0, y: 0, width, height });

  return pdf.save({ useObjectStreams: false });
}
