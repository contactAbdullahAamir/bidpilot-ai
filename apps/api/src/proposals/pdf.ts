import PDFDocument from "pdfkit";
import type { Evidence } from "@bidpilot/contracts";

export const PDF_TEMPLATE_VERSION = "bidpilot-standard-1.0";

export type ApprovedSnapshot = {
  proposalVersion: number;
  organizationName: string;
  opportunity: { title: string; clientName: string; deadline: string | null };
  sections: { title: string; content: string }[];
  evidence: Evidence[];
  approvedBy: string;
  approvedAt: string;
  checksum?: string;
};

const INK = "#17211f";

/** Standard PDF fonts are WinAnsi-encoded; map common Unicode punctuation. */
export function pdfSafe(text: string): string {
  return text
    .replace(/[\u2018\u2019\u2032]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\u00B7/g, "|")
    .replace(/[^\t\n\r\x20-\x7E\u00A0-\u00FF\u2022]/g, "");
}
const MUTED = "#5f6b67";
const ACCENT = "#2f6b57";

/** Deterministic PDF rendering of an approved, immutable proposal snapshot. */
export function renderProposalPdf(snapshot: ApprovedSnapshot, checksum: string): Promise<{ bytes: Buffer; pageCount: number }> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: 72, bottom: 72, left: 64, right: 64 },
      bufferPages: true,
      info: {
        Title: `${snapshot.opportunity.title} - Proposal`,
        Author: snapshot.organizationName,
        Creator: PDF_TEMPLATE_VERSION,
        CreationDate: new Date(snapshot.approvedAt)
      }
    });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("error", reject);

    const labels = new Map(snapshot.evidence.map((e, i) => [`E${i + 1}`, i + 1]));
    const usedRefs = new Set<number>();

    // Cover
    doc.rect(0, 0, doc.page.width, 8).fill(ACCENT);
    doc.moveDown(6);
    doc.fillColor(ACCENT).font("Helvetica-Bold").fontSize(11).text("PROPOSAL RESPONSE", { characterSpacing: 2 });
    doc.moveDown(0.6);
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(28).text(pdfSafe(snapshot.opportunity.title), { lineGap: 4 });
    doc.moveDown(0.6);
    doc.font("Helvetica").fontSize(14).fillColor(MUTED).text(pdfSafe(`Prepared for ${snapshot.opportunity.clientName}`));
    doc.text(pdfSafe(`Submitted by ${snapshot.organizationName}`));
    doc.moveDown(4);
    doc.fontSize(10).fillColor(MUTED);
    doc.text(`Version ${snapshot.proposalVersion} | Approved ${new Date(snapshot.approvedAt).toUTCString()} by ${snapshot.approvedBy}`);
    doc.text(`Document checksum (SHA-256): ${checksum}`, { width: 420 });

    // Table of contents
    doc.addPage();
    heading(doc, "Contents", 18);
    snapshot.sections.forEach((section, index) => {
      doc.font("Helvetica").fontSize(11).fillColor(INK).text(pdfSafe(`${index + 1}.  ${section.title}`), { lineGap: 6 });
    });
    if (snapshot.evidence.length) doc.text(`${snapshot.sections.length + 1}.  References`, { lineGap: 6 });

    // Sections
    snapshot.sections.forEach((section, index) => {
      doc.addPage();
      heading(doc, `${index + 1}. ${section.title}`, 18);
      renderMarkdown(doc, section.content, labels, usedRefs);
    });

    // References
    if (snapshot.evidence.length) {
      doc.addPage();
      heading(doc, `${snapshot.sections.length + 1}. References`, 18);
      doc.font("Helvetica").fontSize(9.5).fillColor(MUTED).text("Statements marked with a bracketed number are supported by the following approved company sources.");
      doc.moveDown();
      snapshot.evidence.forEach((evidence, index) => {
        if (!usedRefs.has(index + 1)) return;
        doc.font("Helvetica-Bold").fontSize(10).fillColor(INK).text(pdfSafe(`[${index + 1}] ${evidence.assetTitle} (v${evidence.assetVersion})`));
        doc.font("Helvetica").fontSize(9).fillColor(MUTED).text(truncate(evidence.excerpt, 360), { lineGap: 2 });
        doc.moveDown(0.6);
      });
    }

    // Headers and footers
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i += 1) {
      doc.switchToPage(i);
      if (i === 0) continue;
      const bottom = doc.page.height - 48;
      doc.font("Helvetica").fontSize(8.5).fillColor(MUTED);
      doc.text(pdfSafe(`${snapshot.organizationName} | ${snapshot.opportunity.title}`), 64, 36, { width: doc.page.width - 128, align: "left", lineBreak: false });
      doc.text(`Page ${i + 1} of ${range.count}`, 64, bottom, { width: doc.page.width - 128, align: "right", lineBreak: false });
      doc.text(`Version ${snapshot.proposalVersion}`, 64, bottom, { width: doc.page.width - 128, align: "left", lineBreak: false });
    }
    const pageCount = range.count;
    doc.on("end", () => resolve({ bytes: Buffer.concat(chunks), pageCount }));
    doc.end();
  });
}

function heading(doc: PDFKit.PDFDocument, text: string, size: number): void {
  doc.font("Helvetica-Bold").fontSize(size).fillColor(INK).text(pdfSafe(text), { lineGap: 4 });
  doc.moveDown(0.5);
}

function truncate(text: string, max: number): string {
  return pdfSafe(text.length > max ? `${text.slice(0, max - 3)}...` : text);
}

function renderMarkdown(doc: PDFKit.PDFDocument, markdown: string, labels: Map<string, number>, used: Set<number>): void {
  const clean = (line: string) =>
    pdfSafe(line)
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .replace(/(^|\s)\*(.+?)\*(?=\s|$)/g, "$1$2")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\[(E\d+)\]/g, (_match, label: string) => {
        const n = labels.get(label);
        if (!n) return "";
        used.add(n);
        return `[${n}]`;
      })
      .replace(/\s+([.,;:])/g, "$1");

  for (const block of markdown.replace(/\r\n?/g, "\n").split(/\n{2,}/)) {
    const lines = block.split("\n").filter((l) => l.trim());
    if (!lines.length) continue;
    const first = lines[0].trim();
    const headingMatch = first.match(/^(#{1,4})\s+(.*)$/);
    if (headingMatch && lines.length === 1) {
      const size = headingMatch[1].length <= 2 ? 13.5 : 11.5;
      doc.moveDown(0.4);
      doc.font("Helvetica-Bold").fontSize(size).fillColor(INK).text(clean(headingMatch[2]));
      doc.moveDown(0.3);
      continue;
    }
    if (lines.every((l) => /^\s*([-*•]|\d+[.)])\s+/.test(l))) {
      for (const line of lines) {
        const numbered = line.trim().match(/^(\d+)[.)]\s+(.*)$/);
        const text = clean(numbered ? numbered[2] : line.replace(/^\s*[-*•]\s+/, ""));
        doc.font("Helvetica").fontSize(10.5).fillColor(INK).text(`${numbered ? `${numbered[1]}.` : "•"}  ${text}`, { indent: 10, lineGap: 3 });
      }
      doc.moveDown(0.5);
      continue;
    }
    for (const line of lines) {
      const h = line.trim().match(/^(#{1,4})\s+(.*)$/);
      if (h) {
        doc.font("Helvetica-Bold").fontSize(11.5).fillColor(INK).text(clean(h[2]));
      }
    }
    const paragraph = lines.filter((l) => !/^\s*#{1,4}\s/.test(l)).map((l) => l.trim()).join(" ");
    if (paragraph) doc.font("Helvetica").fontSize(10.5).fillColor(INK).text(clean(paragraph), { lineGap: 3, align: "left" });
    doc.moveDown(0.6);
  }
}
