// ---------------------------------------------------------------------------
// card-pdf.ts
//
// Wraps a rendered card PNG into a print-ready PDF using pdf-lib.
//
// Three layouts now supported:
//
//   "card"            — Single card on a page exactly 2.5" × 3.5" (63.5 × 88.9 mm).
//                       Good for inserting into a sleeve or sharing digitally.
//   "sheet-letter"    — Nine copies tiled 3×3 on US Letter (8.5" × 11") with crop marks.
//   "sheet-a4"        — Nine copies tiled 3×3 on A4 (210 × 297 mm) with crop marks.
//
// Standard MTG card dimensions:
//   2.5"  × 3.5"  (imperial)
//   63.5mm × 88.9mm (metric)
//   180pt × 252pt  (PDF points @ 72pt/inch)
//
// Letter page: 8.5" × 11" = 612pt × 792pt
//   Horizontal margin: (612 − 3×180) / 2 = (612 − 540) / 2 = 36pt
//   Vertical margin:   (792 − 3×252) / 2 = (792 − 756) / 2 = 18pt
//
// A4 page: 210 × 297 mm ≈ 595.276 × 841.890pt
//   Horizontal margin: (595.276 − 540) / 2 ≈ 27.64pt
//   Vertical margin:   (841.890 − 756) / 2 ≈ 42.95pt
//   → 3×3 MTG cards fit comfortably on A4 with reasonable margins.
//
// The old `PdfLayout` of "card" | "sheet" is preserved for backward
// compatibility — passing "sheet" still produces the Letter sheet.
// ---------------------------------------------------------------------------

import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, PDFFont, PDFImage, rgb, StandardFonts } from "pdf-lib";

// PDF point dimensions for a standard MTG card (72pt = 1 inch).
const CARD_W_PT = 180; // 2.5"
const CARD_H_PT = 252; // 3.5"

// Paper sizes in PDF points.
const LETTER_W_PT = 612; // 8.5"
const LETTER_H_PT = 792; // 11"
const A4_W_PT = 595.276; // 210mm × (72/25.4)
const A4_H_PT = 841.890; // 297mm × (72/25.4)

// Sheet layout: 3 columns × 3 rows.
const COLS = 3;
const ROWS = 3;

// Crop mark length and inset from card corner.
const CROP_LEN = 6; // pt
const CROP_GAP = 2; // pt gap between card edge and mark start

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function embedImage(doc: PDFDocument, pngBytes: Uint8Array): Promise<PDFImage> {
  // pdf-lib auto-detects PNG vs JPEG by the magic bytes.
  try {
    return await doc.embedPng(pngBytes);
  } catch {
    return await doc.embedJpg(pngBytes);
  }
}

function drawCropMark(
  page: ReturnType<PDFDocument["addPage"]>,
  cx: number,
  cy: number,
  hDir: number,
  vDir: number,
): void {
  const color = rgb(0, 0, 0);
  const thickness = 0.25;

  page.drawLine({
    start: { x: cx + hDir * CROP_GAP, y: cy },
    end: { x: cx + hDir * (CROP_GAP + CROP_LEN), y: cy },
    thickness,
    color,
  });

  page.drawLine({
    start: { x: cx, y: cy + vDir * CROP_GAP },
    end: { x: cx, y: cy + vDir * (CROP_GAP + CROP_LEN) },
    thickness,
    color,
  });
}

/** A new document carrying PipGlyph's metadata block. */
async function newDocument(title: string, subject: string): Promise<PDFDocument> {
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  doc.setAuthor("PipGlyph");
  doc.setSubject(subject);
  doc.setCreator("PipGlyph (pipglyph.com)");
  doc.setProducer("pdf-lib");
  return doc;
}

/** One card on a page exactly 2.5" × 3.5". */
function addCardPage(doc: PDFDocument, img: PDFImage): void {
  const page = doc.addPage([CARD_W_PT, CARD_H_PT]);
  page.drawImage(img, { x: 0, y: 0, width: CARD_W_PT, height: CARD_H_PT });
}

/** Paper for a sheet layout — A4 when asked for, US Letter otherwise
 *  ("sheet", "sheet-letter", and the checklist pages of a "pages" deck). */
function sheetSize(layout: string): readonly [number, number] {
  return layout === "sheet-a4" ? [A4_W_PT, A4_H_PT] : [LETTER_W_PT, LETTER_H_PT];
}

/** A 3×3 proxy sheet with crop marks. `slots` fills the grid row by row —
 *  at most COLS × ROWS images; fewer leaves the remaining cells blank. */
function drawSheetPage(
  doc: PDFDocument,
  slots: readonly PDFImage[],
  pageWidth: number,
  pageHeight: number,
): void {
  const page = doc.addPage([pageWidth, pageHeight]);
  const marginX = (pageWidth - COLS * CARD_W_PT) / 2;
  const marginY = (pageHeight - ROWS * CARD_H_PT) / 2;

  slots.slice(0, COLS * ROWS).forEach((img, i) => {
    const row = Math.floor(i / COLS);
    const col = i % COLS;
    const x = marginX + col * CARD_W_PT;
    const y = pageHeight - marginY - (row + 1) * CARD_H_PT;

    page.drawImage(img, { x, y, width: CARD_W_PT, height: CARD_H_PT });

    const corners = [
      { cx: x, cy: y, hDir: -1, vDir: -1 },
      { cx: x + CARD_W_PT, cy: y, hDir: 1, vDir: -1 },
      { cx: x, cy: y + CARD_H_PT, hDir: -1, vDir: 1 },
      { cx: x + CARD_W_PT, cy: y + CARD_H_PT, hDir: 1, vDir: 1 },
    ] as const;
    for (const corner of corners) {
      drawCropMark(page, corner.cx, corner.cy, corner.hDir, corner.vDir);
    }
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Supported output layouts.
 *
 * Legacy aliases (kept so existing callers don't break):
 *   "sheet" ≡ "sheet-letter"
 */
export type PdfLayout = "card" | "sheet" | "sheet-letter" | "sheet-a4";

/**
 * Build a print-ready PDF from a rendered card PNG.
 *
 * @param pngBytes   Raw PNG bytes from `renderCardImage`.
 * @param layout     "card" → single 2.5"×3.5" page;
 *                   "sheet" or "sheet-letter" → 9-up Letter sheet;
 *                   "sheet-a4" → 9-up A4 sheet.
 * @param cardTitle  Used in the PDF metadata `title` field.
 * @returns          A Uint8Array of PDF bytes ready to stream to the client.
 */
export async function buildCardPdf(
  pngBytes: Uint8Array,
  layout: PdfLayout = "card",
  cardTitle = "PipGlyph Card",
): Promise<Uint8Array> {
  const doc = await newDocument(
    cardTitle,
    "Custom MTG card — fan-made, not affiliated with Wizards of the Coast.",
  );
  const img = await embedImage(doc, pngBytes);

  if (layout === "card") {
    addCardPage(doc, img);
  } else {
    // "sheet" (legacy) and "sheet-letter" both produce the US Letter sheet.
    const [pageWidth, pageHeight] = sheetSize(layout);
    drawSheetPage(doc, Array.from({ length: COLS * ROWS }, () => img), pageWidth, pageHeight);
  }

  return doc.save();
}

// ---------------------------------------------------------------------------
// Whole-deck export (decks series PR 6).
// ---------------------------------------------------------------------------

export type DeckPdfEntry = {
  png: Uint8Array;
  /** Physical copies to print (sheet layouts repeat the card this many
   *  times — that's what you cut out and sleeve). */
  copies: number;
};

export type DeckPdfChecklist = {
  heading: string;
  /** One line per un-printed entry, e.g. "4× Lightning Bolt". */
  lines: string[];
};

export type DeckPdfLayout = "pages" | "sheet-letter" | "sheet-a4";

const CHECKLIST_TITLE_SIZE = 16;
const CHECKLIST_LINE_SIZE = 11;
const CHECKLIST_MARGIN = 54;
const CHECKLIST_LINE_GAP = 16;

/**
 * The checklist font. pdf-lib's built-in Helvetica can only encode WinAnsi —
 * a deck titled "Æther Storm", a card called "Lim-Dûl's Vault" or anything in
 * Japanese used to throw inside drawText and 500 the whole export. Callers
 * pass the bytes of a real TTF (the browser fetches /fonts/mplantin.ttf, a
 * server route reads it from disk) and it is embedded through fontkit; with
 * no bytes we fall back to Helvetica. Either way every code point the font
 * lacks is swapped for "?" before drawing — the export never throws on text.
 * (This module also runs in the browser, so it must not touch node:fs.)
 */
async function embedChecklistFont(
  doc: PDFDocument,
  fontBytes: Uint8Array | ArrayBuffer | null | undefined,
): Promise<PDFFont> {
  if (fontBytes && fontBytes.byteLength > 0) {
    try {
      doc.registerFontkit(fontkit);
      return await doc.embedFont(fontBytes, { subset: true });
    } catch {
      // Corrupt / unreadable bytes — Helvetica still produces a document.
    }
  }
  return doc.embedFont(StandardFonts.Helvetica);
}

function encodable(font: PDFFont, text: string): string {
  const supported = new Set(font.getCharacterSet());
  let out = "";
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    out += cp !== undefined && supported.has(cp) ? ch : "?";
  }
  return out;
}

function drawChecklistPages(
  doc: PDFDocument,
  font: PDFFont,
  checklist: DeckPdfChecklist,
  pageWidth: number,
  pageHeight: number,
): void {
  const linesPerPage = Math.floor(
    (pageHeight - CHECKLIST_MARGIN * 2 - CHECKLIST_TITLE_SIZE * 2) /
      CHECKLIST_LINE_GAP,
  );
  for (let start = 0; start < checklist.lines.length; start += linesPerPage) {
    const page = doc.addPage([pageWidth, pageHeight]);
    let y = pageHeight - CHECKLIST_MARGIN;
    if (start === 0) {
      page.drawText(encodable(font, checklist.heading).slice(0, 120), {
        x: CHECKLIST_MARGIN,
        y,
        size: CHECKLIST_TITLE_SIZE,
        font,
        color: rgb(0.1, 0.1, 0.12),
      });
    }
    y -= CHECKLIST_TITLE_SIZE * 2;
    for (const line of checklist.lines.slice(start, start + linesPerPage)) {
      page.drawText(encodable(font, line).slice(0, 90), {
        x: CHECKLIST_MARGIN,
        y,
        size: CHECKLIST_LINE_SIZE,
        font,
        color: rgb(0.2, 0.2, 0.24),
      });
      y -= CHECKLIST_LINE_GAP;
    }
  }
}

/**
 * Build a whole-deck PDF.
 *
 * - "pages": one page per UNIQUE card at 2.5"×3.5" — `copies` is ignored
 *   and nothing records the quantity (a 100-page PDF helps nobody; the
 *   export route's checklist lists only un-remixed real cards, not counts).
 * - "sheet-letter" / "sheet-a4": 3×3 proxy sheets with crop marks, each
 *   card repeated `copies` times, different cards mixed onto shared pages.
 *
 * `checklist` (optional) appends text pages listing whatever wasn't
 * printed — un-remixed real cards, per the no-Scryfall-scans decision.
 */
export async function buildDeckPdf(
  entries: DeckPdfEntry[],
  options: {
    title?: string;
    layout: DeckPdfLayout;
    checklist?: DeckPdfChecklist | null;
    /** TTF bytes for the checklist text (see embedChecklistFont). */
    checklistFont?: Uint8Array | ArrayBuffer | null;
  },
): Promise<Uint8Array> {
  const { title = "PipGlyph Deck", layout, checklist = null, checklistFont = null } = options;
  const doc = await newDocument(
    title,
    "Custom MTG-style deck — fan-made, not affiliated with Wizards of the Coast.",
  );
  const [pageWidth, pageHeight] = sheetSize(layout);

  if (layout === "pages") {
    for (const entry of entries) {
      addCardPage(doc, await embedImage(doc, entry.png));
    }
  } else {
    // Embed each unique PNG once; the slot list repeats the PDFImage.
    const slots: PDFImage[] = [];
    for (const entry of entries) {
      const img = await embedImage(doc, entry.png);
      for (let copy = 0; copy < Math.max(1, entry.copies); copy += 1) {
        slots.push(img);
      }
    }

    const perPage = COLS * ROWS;
    for (let start = 0; start < slots.length; start += perPage) {
      drawSheetPage(doc, slots.slice(start, start + perPage), pageWidth, pageHeight);
    }
  }

  if (checklist && checklist.lines.length > 0) {
    const font = await embedChecklistFont(doc, checklistFont);
    drawChecklistPages(doc, font, checklist, pageWidth, pageHeight);
  }

  // A deck with nothing printable still returns a valid (checklist-only or
  // single blank) document rather than a corrupt zero-page file.
  if (doc.getPageCount() === 0) {
    doc.addPage([CARD_W_PT, CARD_H_PT]);
  }

  return doc.save();
}
