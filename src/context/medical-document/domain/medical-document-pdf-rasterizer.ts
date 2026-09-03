export type MedicalDocumentRasterizedPdfPage = {
  pageNumber: number;
  content: Uint8Array;
};

export type MedicalDocumentRasterizedPdf = {
  totalPageCount: number;
  pages: MedicalDocumentRasterizedPdfPage[];
};

export interface MedicalDocumentPdfRasterizer {
  rasterize(content: Uint8Array): Promise<MedicalDocumentRasterizedPdf>;
}
