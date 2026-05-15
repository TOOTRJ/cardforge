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

import { PDFDocument, PDFImage, rgb } from "pdf-lib";

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

function drawSheet(
  doc: PDFDocument,
  img: PDFImage,
  pageWidth: number,
  pageHeight: number,
): void {
  const page = doc.addPage([pageWidth, pageHeight]);
  const marginX = (pageWidth - COLS * CARD_W_PT) / 2;
  const marginY = (pageHeight - ROWS * CARD_H_PT) / 2;

  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
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
    }
  }
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
  cardTitle = "Spellwright Card",
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();

  doc.setTitle(cardTitle);
  doc.setAuthor("Spellwright");
  doc.setSubject("Custom MTG card — fan-made, not affiliated with Wizards of the Coast.");
  doc.setCreator("Spellwright (spellwright.gg)");
  doc.setProducer("pdf-lib");

  const img = await embedImage(doc, pngBytes);

  if (layout === "card") {
    const page = doc.addPage([CARD_W_PT, CARD_H_PT]);
    page.drawImage(img, { x: 0, y: 0, width: CARD_W_PT, height: CARD_H_PT });
  } else if (layout === "sheet-a4") {
    drawSheet(doc, img, A4_W_PT, A4_H_PT);
  } else {
    // "sheet" (legacy) and "sheet-letter" both produce the US Letter sheet.
    drawSheet(doc, img, LETTER_W_PT, LETTER_H_PT);
  }

  return doc.save();
}
