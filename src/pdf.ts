import * as pdfjs from 'pdfjs-dist';
// Vite-friendly worker import
// @ts-ignore - ?url suffix is a Vite feature
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

export interface PdfExtractResult {
  text: string;
  pages: number;
  title?: string;
}

export async function extractPdfText(file: File): Promise<PdfExtractResult> {
  const buf = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buf }).promise;

  let combined = '';
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item: any) => ('str' in item ? item.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (pageText) combined += pageText + '\n\n';
  }

  let title: string | undefined;
  try {
    const meta = await doc.getMetadata();
    const info = (meta?.info ?? {}) as Record<string, unknown>;
    const t = info['Title'];
    if (typeof t === 'string' && t.trim()) title = t.trim();
  } catch {
    /* ignore metadata failures */
  }

  // Fallback title: derive from first meaningful line
  if (!title) {
    const firstLine = combined.split('\n').map((l) => l.trim()).find((l) => l.length > 6);
    if (firstLine) title = firstLine.slice(0, 120);
  }

  return { text: combined.trim(), pages: doc.numPages, title };
}
