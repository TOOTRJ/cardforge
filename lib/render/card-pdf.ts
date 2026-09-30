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
//
// Every slot is PORTRAIT, whatever the render (TODO 6.22). A landscape render
// (Battle, Split — 2100 × 1500 at HD) is turned 90° anticlockwise into it,
// the way the printed card carries it: a Battle or Split is a portrait card
// with its design printed sideways, read by turning the card clockwise. The
// card stays 2.5" × 3.5", the 3×3 sheet and its crop marks stay as they are,
// and the PNG itself (stored bake, download) stays landscape.
//
// BLEED (TODO 6.1a, the single-card page only): the render carries 1/8 in
// (9 pt) of bleed on every side (lib/render/card-print.ts), so it is drawn
// 198 × 270 pt — the trim 180 × 252 plus the bleed — centred on a page with
// a 1/4 in slug all round (234 × 306 pt). Crop marks sit in the slug on the
// TRIM lines, stopping short of the bleed so they never print into it, and
// the page declares its TrimBox (the card) and BleedBox (card + bleed) for
// print software.
//
// SHEETS (TODO 6.15): a sheet's grid comes from lib/render/sheet-layout.ts
// — paper, gap (none or 1/16 in), cut guides (corner marks or full-length
// lines), card size (2.5 × 3.5 in or 63 × 88 mm) and the bleed. The default
// is the 3 × 3 butted sheet with corner marks, at the positions it always
// had. The guides are drawn FIRST, beneath the cards, so they show only in
// the margins and gaps — a mark never prints on a neighbouring card or into
// a bleed. A bleed sheet puts each card's bleed box in its cell; the marks
// sit on its trim lines, outside the bleed.
// ---------------------------------------------------------------------------

import fontkit from "@pdf-lib/fontkit";
import { degrees, PDFDocument, PDFFont, PDFImage, PDFPage, rgb, StandardFonts } from "pdf-lib";
import {
  DEFAULT_SHEET_OPTIONS,
  PAPER_PT,
  planSheet,
  sheetGuides,
  type SheetOptions,
  type SheetPaper,
  type SheetPlan,
} from "@/lib/render/sheet-layout";

// PDF point dimensions for a standard MTG card (72pt = 1 inch).
const CARD_W_PT = 180; // 2.5"
const CARD_H_PT = 252; // 3.5"

// The single-card bleed page (TODO 6.1a): 1/8 in bleed, 1/4 in slug.
export const BLEED_PT = 9; // 0.125"
export const SLUG_PT = 18; // 0.25"
/** Gap between the bleed box and a trim-line crop mark in the slug. */
const BLEED_MARK_GAP = 2; // pt

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

/** embedImage, then write the image into the document NOW. pdf-lib decodes
 *  a PNG to raw pixels on embedPng and keeps them until the image is
 *  written — by default at save(), so a many-card PDF held every card
 *  decoded at once (≈ 9.5 MB per HD render, 11 MB per 1650 × 2250 bleed
 *  render: 1.4–1.7 GB for a 150-card export, in the browser tab). Writing
 *  each as it comes frees its pixels before the next is decoded; the saved
 *  file is the same pages. */
async function embedImageNow(doc: PDFDocument, pngBytes: Uint8Array): Promise<PDFImage> {
  const img = await embedImage(doc, pngBytes);
  await img.embed();
  return img;
}

/** How a render fills the portrait card slot whose lower-left corner is
 *  (x, y) — pdf-lib `drawImage` options (points, y up; `rotate` is
 *  anticlockwise about the image's own lower-left corner).
 *
 *  A portrait render fills the slot as is. A landscape render (wider than
 *  tall) is turned 90° anticlockwise: drawn 252 × 180 from the slot's
 *  lower-RIGHT corner, so its top edge runs up the slot's left side and its
 *  left edge along the bottom. That is how Wizards prints them — Scryfall's
 *  scans of Invasion of Zendikar (MOM) and Fire // Ice (MH2) are portrait,
 *  the title reading bottom-to-top up the left edge, Fire in the bottom
 *  half — so the printed proxy reads when turned clockwise, like the real
 *  card (the same quarter turn scripts/visual-audit.mjs undoes on a scan). */
function cardSlotPlacement(
  image: { width: number; height: number },
  x: number,
  y: number,
  slotW: number = CARD_W_PT,
  slotH: number = CARD_H_PT,
): { x: number; y: number; width: number; height: number; rotateDeg: 0 | 90 } {
  if (image.width > image.height) {
    return { x: x + slotW, y, width: slotH, height: slotW, rotateDeg: 90 };
  }
  return { x, y, width: slotW, height: slotH, rotateDeg: 0 };
}

/** Draw a render into the portrait card slot at (x, y) — see cardSlotPlacement.
 *  The slot is the card (180 × 252 pt) unless a bleed page passes its own. */
function drawCardInSlot(
  page: PDFPage,
  img: PDFImage,
  x: number,
  y: number,
  slotW: number = CARD_W_PT,
  slotH: number = CARD_H_PT,
): void {
  const { rotateDeg, ...box } = cardSlotPlacement(img, x, y, slotW, slotH);
  page.drawImage(img, { ...box, rotate: degrees(rotateDeg) });
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

/** One card on a page exactly 2.5" × 3.5" (portrait — a landscape render is
 *  turned into it, never given a landscape page). */
function addCardPage(doc: PDFDocument, img: PDFImage): void {
  const page = doc.addPage([CARD_W_PT, CARD_H_PT]);
  drawCardInSlot(page, img, 0, 0);
}

/**
 * One card WITH its bleed (TODO 6.1a) on a page with a 1/4 in slug: the
 * render (trim + 1/8 in every side) fills the bleed box, portrait (a
 * landscape render is turned into it, like addCardPage); crop marks on the
 * four trim lines run through the slug, never into the bleed; TrimBox and
 * BleedBox say which is which.
 */
function addBleedCardPage(doc: PDFDocument, img: PDFImage): void {
  const bleedW = CARD_W_PT + 2 * BLEED_PT;
  const bleedH = CARD_H_PT + 2 * BLEED_PT;
  const page = doc.addPage([bleedW + 2 * SLUG_PT, bleedH + 2 * SLUG_PT]);
  drawCardInSlot(page, img, SLUG_PT, SLUG_PT, bleedW, bleedH);
  const trimX = SLUG_PT + BLEED_PT;
  const trimY = SLUG_PT + BLEED_PT;
  page.setBleedBox(SLUG_PT, SLUG_PT, bleedW, bleedH);
  page.setTrimBox(trimX, trimY, CARD_W_PT, CARD_H_PT);

  const color = rgb(0, 0, 0);
  const thickness = 0.25;
  const near = BLEED_PT + BLEED_MARK_GAP; // mark start, from the trim line
  const far = BLEED_PT + SLUG_PT - BLEED_MARK_GAP; // mark end
  for (const x of [trimX, trimX + CARD_W_PT]) {
    for (const [from, dir] of [
      [trimY, -1],
      [trimY + CARD_H_PT, 1],
    ] as const) {
      // Vertical mark on the trim line x, above / below the card.
      page.drawLine({ start: { x, y: from + dir * near }, end: { x, y: from + dir * far }, thickness, color });
    }
  }
  for (const y of [trimY, trimY + CARD_H_PT]) {
    for (const [from, dir] of [
      [trimX, -1],
      [trimX + CARD_W_PT, 1],
    ] as const) {
      // Horizontal mark on the trim line y, left / right of the card.
      page.drawLine({ start: { x: from + dir * near, y }, end: { x: from + dir * far, y }, thickness, color });
    }
  }
}

/** Paper for a sheet layout — A4 when asked for, US Letter otherwise
 *  ("sheet", "sheet-letter", and the checklist pages of a "pages" deck). */
function sheetPaper(layout: string): SheetPaper {
  return layout === "sheet-a4" ? "a4" : "letter";
}

function sheetSize(layout: string): readonly [number, number] {
  const { width, height } = PAPER_PT[sheetPaper(layout)];
  return [width, height];
}

/** One sheet page: the cut guides first (beneath — they show only in the
 *  margins and gaps), then `slots` into the plan's cells row by row. At
 *  most `plan.perPage` images; fewer leaves the remaining cells blank. */
function drawSheetPage(
  doc: PDFDocument,
  slots: readonly PDFImage[],
  plan: SheetPlan,
  marks: SheetOptions["marks"],
): void {
  const page = doc.addPage([plan.pageWidth, plan.pageHeight]);
  const used = Math.min(slots.length, plan.perPage);
  for (const { x1, y1, x2, y2 } of sheetGuides(plan, marks, used)) {
    page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: 0.25, color: rgb(0, 0, 0) });
  }
  slots.slice(0, used).forEach((img, i) => {
    // A cell is the card's bleed box (its trim box without a bleed); a
    // landscape render is turned into it like everywhere else.
    const cell = plan.cells[i];
    drawCardInSlot(page, img, cell.x, cell.y, cell.width, cell.height);
  });
}

/** Lay `slots` out on as many sheet pages as they need. */
function drawSheets(doc: PDFDocument, slots: readonly PDFImage[], plan: SheetPlan, marks: SheetOptions["marks"]): void {
  for (let start = 0; start < slots.length; start += plan.perPage) {
    drawSheetPage(doc, slots.slice(start, start + plan.perPage), plan, marks);
  }
}

/** `partial` without its undefined keys, so a spread keeps the defaults. */
function definedOnly<T extends object>(partial: Partial<T> | undefined): Partial<T> {
  return Object.fromEntries(
    Object.entries(partial ?? {}).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
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
 * @param options    `bleed`: the PNG carries a 1/8 in bleed (TODO 6.1a) —
 *                   "card" only: a bleed page with trim-line crop marks
 *                   (addBleedCardPage). Sheets have no bleed layout (6.15).
 * @returns          A Uint8Array of PDF bytes ready to stream to the client.
 */
export async function buildCardPdf(
  pngBytes: Uint8Array,
  layout: PdfLayout = "card",
  cardTitle = "PipGlyph Card",
  options: { bleed?: boolean } = {},
): Promise<Uint8Array> {
  if (options.bleed && layout !== "card") {
    throw new Error("A bleed PDF is a single-card page.");
  }
  const doc = await newDocument(
    cardTitle,
    "Custom MTG card — fan-made, not affiliated with Wizards of the Coast.",
  );
  const img = await embedImage(doc, pngBytes);

  if (layout === "card") {
    if (options.bleed) addBleedCardPage(doc, img);
    else addCardPage(doc, img);
  } else {
    // "sheet" (legacy) and "sheet-letter" both produce the US Letter sheet:
    // one page of the default grid (3 × 3), every cell the same card.
    const plan = planSheet(sheetPaper(layout), DEFAULT_SHEET_OPTIONS);
    drawSheetPage(doc, Array.from({ length: plan.perPage }, () => img), plan, DEFAULT_SHEET_OPTIONS.marks);
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

/** The sheet options a caller may set; the bleed is its own option (it
 *  also applies to one-per-page PDFs). */
export type DeckPdfSheetOptions = Partial<Omit<SheetOptions, "bleed">>;

/**
 * Build a whole-deck PDF — or any list of cards (TODO 6.15, the selection
 * export in My Cards).
 *
 * - "pages": one page per UNIQUE card at 2.5"×3.5" — `copies` is ignored
 *   and nothing records the quantity (a 100-page PDF helps nobody; the
 *   export route's checklist lists only un-remixed real cards, not counts).
 *   With `bleed`, each page is the single-card bleed page (addBleedCardPage).
 * - "sheet-letter" / "sheet-a4": proxy sheets (3×3 by default), each card
 *   repeated `copies` times, different cards mixed onto shared pages;
 *   `sheet` picks the gap, the cut guides and the card size, `bleed` gives
 *   every cell its bleed box (lib/render/sheet-layout.ts).
 *
 * `bleed` says the PNGs CARRY a 1/8 in bleed (the print renders of
 * lib/render/card-print.ts) — this module never adds one.
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
    /** Sheet layouts: gap, cut guides, card size (defaults: the 3×3). */
    sheet?: DeckPdfSheetOptions;
    /** The PNGs carry a 1/8 in bleed (TODO 6.1a). */
    bleed?: boolean;
    /** The PDF's metadata subject line. */
    subject?: string;
  },
): Promise<Uint8Array> {
  const {
    title = "PipGlyph Deck",
    layout,
    checklist = null,
    checklistFont = null,
    bleed = false,
    subject = "Custom MTG-style deck — fan-made, not affiliated with Wizards of the Coast.",
  } = options;
  const doc = await newDocument(title, subject);
  const [pageWidth, pageHeight] = sheetSize(layout);

  if (layout === "pages") {
    for (const entry of entries) {
      const img = await embedImageNow(doc, entry.png);
      if (bleed) addBleedCardPage(doc, img);
      else addCardPage(doc, img);
    }
  } else {
    // Embed each unique PNG once; the slot list repeats the PDFImage.
    const slots: PDFImage[] = [];
    for (const entry of entries) {
      const img = await embedImageNow(doc, entry.png);
      for (let copy = 0; copy < Math.max(1, entry.copies); copy += 1) {
        slots.push(img);
      }
    }

    const sheet: SheetOptions = { ...DEFAULT_SHEET_OPTIONS, ...definedOnly(options.sheet), bleed };
    drawSheets(doc, slots, planSheet(sheetPaper(layout), sheet), sheet.marks);
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
