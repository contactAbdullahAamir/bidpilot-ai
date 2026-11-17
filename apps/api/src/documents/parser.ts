/**
 * Document parsing into page records. File type is detected from content
 * (magic bytes), never from the client-supplied filename or MIME type.
 */

export type ParsedDocument = {
  mimeType: string;
  extension: string;
  pages: string[];
  /** 1-based page numbers with no extractable text (likely scanned images). */
  emptyPages: number[];
};

export class UnsupportedDocumentError extends Error {}

const PSEUDO_PAGE_CHARS = 3200;

// unpdf is ESM-only; keep a real dynamic import under CommonJS output.
const esmImport = new Function("specifier", "return import(specifier)") as <T>(specifier: string) => Promise<T>;

export function detectType(bytes: Buffer): "pdf" | "docx" | "text" {
  if (bytes.subarray(0, 5).toString("latin1") === "%PDF-") return "pdf";
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) return "docx";
  if (bytes.includes(0)) throw new UnsupportedDocumentError("This file type is not supported. Upload a PDF, DOCX, TXT or Markdown file.");
  const text = bytes.toString("utf8");
  if (text.includes("�") && (text.match(/�/g)?.length ?? 0) > 20) {
    throw new UnsupportedDocumentError("The file is not valid UTF-8 text.");
  }
  return "text";
}

export async function parseDocument(bytes: Buffer): Promise<ParsedDocument> {
  const type = detectType(bytes);
  if (type === "pdf") {
    const { extractText, getDocumentProxy } = await esmImport<{
      getDocumentProxy(data: Uint8Array): Promise<unknown>;
      extractText(pdf: unknown, options: { mergePages: false }): Promise<{ totalPages: number; text: string[] }>;
    }>("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { text } = await extractText(pdf, { mergePages: false });
    const pages = (text as string[]).map(normalizeWhitespace);
    return { mimeType: "application/pdf", extension: ".pdf", pages, emptyPages: emptyPageNumbers(pages) };
  }
  if (type === "docx") {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer: bytes });
    const pages = splitIntoPages(result.value);
    if (pages.length === 0) throw new UnsupportedDocumentError("The DOCX file contains no readable text.");
    return {
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      extension: ".docx",
      pages,
      emptyPages: []
    };
  }
  const pages = splitIntoPages(bytes.toString("utf8"));
  if (pages.length === 0) throw new UnsupportedDocumentError("The file is empty.");
  return { mimeType: "text/plain", extension: ".txt", pages, emptyPages: [] };
}

/** Pasted or flowing text: honor form feeds as page breaks, else split at paragraph boundaries. */
export function splitIntoPages(text: string): string[] {
  const normalized = text.replace(/\r\n?/g, "\n");
  const hardPages = normalized.split("\f");
  const pages: string[] = [];
  for (const hard of hardPages) {
    if (hard.length <= PSEUDO_PAGE_CHARS * 1.25) {
      pages.push(hard);
      continue;
    }
    let current = "";
    for (const paragraph of hard.split(/\n{2,}/)) {
      if (current && current.length + paragraph.length > PSEUDO_PAGE_CHARS) {
        pages.push(current);
        current = "";
      }
      current += (current ? "\n\n" : "") + paragraph;
    }
    if (current) pages.push(current);
  }
  return pages.map(normalizeWhitespace).filter((page) => page.length > 0);
}

function normalizeWhitespace(text: string): string {
  return text
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function emptyPageNumbers(pages: string[]): number[] {
  return pages.flatMap((page, index) => (page.replace(/\s/g, "").length < 20 ? [index + 1] : []));
}
