import { Injectable } from '@nestjs/common';
import { dirname, join, sep } from 'node:path';
import {
  Canvas,
  createCanvas,
  DOMMatrix,
  ImageData,
  Path2D,
} from '@napi-rs/canvas';
import {
  MedicalDocumentPdfRasterizer,
  MedicalDocumentRasterizedPdf,
} from '../../domain/medical-document-pdf-rasterizer';

const TARGET_DPI = 144;
const PDF_POINTS_PER_INCH = 72;
const MAX_RENDERED_SIDE = 4096;
const MAX_RESCUE_PAGES = 20;
const MAX_IMAGE_BYTES = 4_500_000;
const JPEG_QUALITIES = [85, 70, 55, 40];
const PDFJS_ROOT = dirname(require.resolve('pdfjs-dist/package.json'));

type PdfJsModule = typeof import('pdfjs-dist/legacy/build/pdf.mjs');

// TypeScript compiles dynamic imports to require() in this CommonJS project.
// Calling the native import expression indirectly keeps the ESM-only PDF.js
// bundle loadable without changing the module format of the Nest application.
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const loadPdfJs = Function(
  'return import("pdfjs-dist/legacy/build/pdf.mjs")',
) as () => Promise<PdfJsModule>;

@Injectable()
export class PdfJsMedicalDocumentPdfRasterizer implements MedicalDocumentPdfRasterizer {
  async rasterize(content: Uint8Array): Promise<MedicalDocumentRasterizedPdf> {
    this.installPdfJsGlobals();
    const pdfjs = await loadPdfJs();
    const loadingTask = pdfjs.getDocument({
      data: Uint8Array.from(content),
      useSystemFonts: true,
      standardFontDataUrl: `${join(PDFJS_ROOT, 'standard_fonts')}${sep}`,
    });
    const document = await loadingTask.promise;

    try {
      const pageNumbers = this.representativePageNumbers(document.numPages);
      const pages = [];

      for (const pageNumber of pageNumbers) {
        const page = await document.getPage(pageNumber);
        try {
          const initialViewport = page.getViewport({ scale: 1 });
          const scale = Math.min(
            TARGET_DPI / PDF_POINTS_PER_INCH,
            MAX_RENDERED_SIDE /
              Math.max(initialViewport.width, initialViewport.height),
          );
          const viewport = page.getViewport({ scale });
          const canvas = createCanvas(
            Math.max(1, Math.ceil(viewport.width)),
            Math.max(1, Math.ceil(viewport.height)),
          );
          await page.render({
            canvasContext: canvas.getContext(
              '2d',
            ) as unknown as CanvasRenderingContext2D,
            viewport,
          }).promise;

          pages.push({
            pageNumber,
            content: Uint8Array.from(await this.encodeWithinLimit(canvas)),
          });
        } finally {
          page.cleanup();
        }
      }

      return { totalPageCount: document.numPages, pages };
    } finally {
      await document.destroy();
    }
  }

  private representativePageNumbers(totalPageCount: number): number[] {
    if (totalPageCount <= MAX_RESCUE_PAGES) {
      return Array.from({ length: totalPageCount }, (_, index) => index + 1);
    }

    return [
      ...new Set(
        Array.from(
          { length: MAX_RESCUE_PAGES },
          (_, index) =>
            Math.round(
              (index * (totalPageCount - 1)) / (MAX_RESCUE_PAGES - 1),
            ) + 1,
        ),
      ),
    ];
  }

  private async encodeWithinLimit(canvas: Canvas): Promise<Buffer> {
    let encoded = await canvas.encode('jpeg', JPEG_QUALITIES[0]);
    for (const quality of JPEG_QUALITIES.slice(1)) {
      if (encoded.length <= MAX_IMAGE_BYTES) return encoded;
      encoded = await canvas.encode('jpeg', quality);
    }
    if (encoded.length > MAX_IMAGE_BYTES) {
      throw new Error('A rendered PDF page exceeds the BDA image size limit');
    }
    return encoded;
  }

  private installPdfJsGlobals(): void {
    const runtime = globalThis as unknown as Record<string, unknown>;
    runtime.DOMMatrix ||= DOMMatrix;
    runtime.ImageData ||= ImageData;
    runtime.Path2D ||= Path2D;
  }
}
