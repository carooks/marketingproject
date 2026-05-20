// Channel-aware PDF export for a single draft, plus a multi-draft package.
// Uses jsPDF (pure client-side, no network). Output is a branded handoff doc.

import { jsPDF } from 'jspdf';
import type { Draft, FormatId } from './types';
import { FORMATS } from './types';
import { BRAND } from './brand';

const NAVY: [number, number, number] = [16, 42, 67];      // #102A43
const BLUE: [number, number, number] = [31, 111, 235];    // #1F6FEB
const SLATE: [number, number, number] = [60, 75, 95];
const MUTED: [number, number, number] = [120, 130, 145];

const MARGIN = 56;       // pt
const PAGE_W = 612;      // US Letter
const PAGE_H = 792;
const CONTENT_W = PAGE_W - MARGIN * 2;

export function exportDraftToPdf(draft: Draft): void {
  const def = FORMATS.find((f) => f.id === draft.formatId)!;
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  let y = renderHeader(doc, def.label, def.medium);

  y = section(doc, y, 'Channel', def.medium);
  y = section(doc, y, 'Audience', draft.metadata.audience);
  if (draft.metadata.cta) y = section(doc, y, 'Call to action', draft.metadata.cta);
  y = section(doc, y, 'Suggested reviewer', draft.metadata.suggestedReviewer);

  y = heading(doc, y, draft.title || 'Draft');
  y = body(doc, y, draft.body);

  if (draft.notes) {
    y = heading(doc, y, 'Production notes');
    y = body(doc, y, draft.notes);
  }

  if (draft.flags && draft.flags.length > 0) {
    y = heading(doc, y, 'Flags from the agent');
    y = bullets(doc, y, draft.flags);
  }

  if (draft.qualityChecks && draft.qualityChecks.length > 0) {
    y = heading(doc, y, 'Quality checks');
    y = bullets(
      doc,
      y,
      draft.qualityChecks.map(
        (c) => `[${c.status.toUpperCase()}] ${c.label}${c.detail ? ' — ' + c.detail : ''}`
      )
    );
  }

  renderFooter(doc);
  const safe = slug(def.label);
  doc.save(`${BRAND.name.toLowerCase()}-${safe}-${stamp()}.pdf`);
}

export function exportPackageToPdf(drafts: Draft[]): void {
  if (drafts.length === 0) return;
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  let y = renderHeader(doc, 'Cross-channel package', `${drafts.length} approved drafts`);
  y = body(
    doc,
    y,
    `${BRAND.name} content package generated ${new Date().toLocaleString()}. ` +
      `Includes the approved drafts for each channel below. Nothing has been published — ` +
      `hand off to the channel owners.`
  );

  drafts.forEach((d, i) => {
    doc.addPage();
    const def = FORMATS.find((f) => f.id === d.formatId)!;
    let py = renderHeader(doc, def.label, `${i + 1} of ${drafts.length}`);
    py = section(doc, py, 'Audience', d.metadata.audience);
    if (d.metadata.cta) py = section(doc, py, 'Call to action', d.metadata.cta);
    py = heading(doc, py, d.title || 'Draft');
    py = body(doc, py, d.body);
    if (d.notes) {
      py = heading(doc, py, 'Production notes');
      py = body(doc, py, d.notes);
    }
    renderFooter(doc);
  });

  doc.save(`${BRAND.name.toLowerCase()}-content-package-${stamp()}.pdf`);
}

// ---------- helpers ----------

function renderHeader(doc: jsPDF, title: string, subtitle: string): number {
  doc.setFillColor(...NAVY);
  doc.rect(0, 0, PAGE_W, 72, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text(BRAND.name.toUpperCase(), MARGIN, 30);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text(title, MARGIN, 54);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(220, 235, 255);
  doc.text(subtitle, PAGE_W - MARGIN, 54, { align: 'right' });

  return 100;
}

function renderFooter(doc: jsPDF): void {
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setDrawColor(...MUTED);
    doc.setLineWidth(0.5);
    doc.line(MARGIN, PAGE_H - 40, PAGE_W - MARGIN, PAGE_H - 40);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(
      `${BRAND.name} · Content Repurposer · Draft for review — not for publication`,
      MARGIN,
      PAGE_H - 24
    );
    doc.text(`Page ${p} of ${pages}`, PAGE_W - MARGIN, PAGE_H - 24, { align: 'right' });
  }
}

function section(doc: jsPDF, y: number, label: string, value: string): number {
  y = ensureSpace(doc, y, 30);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...BLUE);
  doc.text(label.toUpperCase(), MARGIN, y);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(...SLATE);
  const lines = doc.splitTextToSize(value, CONTENT_W);
  doc.text(lines, MARGIN, y + 14);
  return y + 14 + lines.length * 13 + 8;
}

function heading(doc: jsPDF, y: number, text: string): number {
  y = ensureSpace(doc, y, 30);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(...NAVY);
  const lines = doc.splitTextToSize(text, CONTENT_W);
  doc.text(lines, MARGIN, y);
  return y + lines.length * 16 + 6;
}

function body(doc: jsPDF, y: number, text: string): number {
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.setTextColor(...SLATE);
  const paragraphs = text.split(/\n\s*\n/);
  for (const para of paragraphs) {
    const lines = doc.splitTextToSize(para.replace(/\n/g, ' '), CONTENT_W);
    for (const line of lines) {
      y = ensureSpace(doc, y, 16);
      doc.text(line, MARGIN, y);
      y += 14;
    }
    y += 6;
  }
  return y + 4;
}

function bullets(doc: jsPDF, y: number, items: string[]): number {
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(...SLATE);
  for (const item of items) {
    const lines = doc.splitTextToSize(item, CONTENT_W - 16);
    y = ensureSpace(doc, y, lines.length * 13 + 4);
    doc.text('•', MARGIN, y);
    doc.text(lines, MARGIN + 14, y);
    y += lines.length * 13 + 4;
  }
  return y + 6;
}

function ensureSpace(doc: jsPDF, y: number, needed: number): number {
  if (y + needed > PAGE_H - 60) {
    doc.addPage();
    return 80;
  }
  return y;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function stamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

// Suppress unused-import linter for FormatId (kept for potential future per-channel layouts).
export type _ChannelHint = FormatId;
