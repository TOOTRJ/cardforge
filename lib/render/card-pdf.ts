// ---------------------------------------------------------------------------
// card-pdf.ts
//
// Wraps a rendered card PNG into a print-ready PDF using pdf-lib.
//
// Two layouts:
//
//   "card"  — Single card on a page exactly 2.5" × 3.5" (63.5 × 88.9 mm).
//             Good for inserting into a sleeve or sharing digitally.
//
//   "sheet" — Nine copies of the card tiled 3×3 on US Letter (8.5" × 11")
//             paper, with 0.25pt crop marks at each corner.
//             Cut along the marks to get 9 sleeved-ready cards.
//
// Standard MTG card dimensions:
//   2.5"  × 3.5"  (imperial)
//   63.5mm × 88.9mm (metric)
//   180pt × 252pt  (PDF points @ 72pt/inch)
//
// Letter page: 8.5" × 11" = 612pt × 792pt
//   Horizontal margin: (612 − 3×180) / 2 = (612 − 540) / 2 = 36pt
//   Vertical margin:   (792 − 3×252) / 2 = (792 − 756) / 2 = 18pt
//   → Cards fit with equal margins on all sides.
// ---------------------------------------------------------------------------

import { PDFDocument, PDFImage, rgb } from "pdf-lib";

// PDF point dimensions for a standard MTG card (72pt = 1 inch).
const CARD_W_PT = 180; // 2.5"
const CARD_H_PT = 252; // 3.5"

// US Letter dimensions in PDF points.
const LETTER_W_PT = 612; // 8.5"
const LETTER_H_PT = 792; // 11"

// Sheet layout: 3 columns × 3 rows.
const COLS = 3;
const ROWS = 3;
const SHEET_MARGIN_X = (LETTER_W_PT - COLS * CARD_W_PT) / 2; // 36pt
const SHEET_MARGIN_Y = (LETTER_H_PT - ROWS * CARD_H_PT) / 2; // 18pt

// Crop mark length and inset from card corner.
const CROP_LEN = 6; // pt
const CROP_GAP = 2; // pt gap between card edge and mark start

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Embed a PNG or JPEG bytes into the PDF document. Returns the PDFImage. */
async function embedImage(doc: PDFDocument, pngBytes: Uint8Array): Promise<PDFImage> {
  // pdf-lib auto-detects PNG vs JPEG by the magic bytes.
  try {
    return await doc.embedPng(pngBytes);
  } catch {
    // Fallback: try JPEG (shouldn't happen with our renderer, but safe)
    return await doc.embedJpg(pngBytes);
  }
}

/**
 * Draw crop marks at a single card corner.
 * @param page      — the pdf-lib page to draw on
 * @param cx, cy    — the corner position in PDF coordinates (bottom-left origin)
 * @param hDir      — +1 for right-facing mark, -1 for left-facing
 * @param vDir      — +1 for up-facing mark, -1 for down-facing
 */
function drawCropMark(
  page: ReturnType<PDFDocument["addPage"]>,
  cx: number,
  cy: number,
  hDir: number,
  vDir: number,
): void {
  const color = rgb(0, 0, 0);
  const thickness = 0.25;

  // Horizontal arm (extends away from card in horizontal direction)
  page.drawLine({
    start: { x: cx + hDir * CROP_GAP, y: cy },
    end: { x: cx + hDir * (CROP_GAP + CROP_LEN), y: cy },
    thickness,
    color,
  });

  // Vertical arm (extends away from card in vertical direction)
  page.drawLine({
    start: { x: cx, y: cy + vDir * CROP_GAP },
    end: { x: cx, y: cy + vDir * (CROP_GAP + CROP_LEN) },
    thickness,
    color,
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type PdfLayout = "card" | "sheet";

/**
 * Build a print-ready PDF from a rendered card PNG.
 *
 * @param pngBytes  Raw PNG bytes from `renderCardImage`.
 * @param layout    "card" → single 2.5"×3.5" page; "sheet" → 9-up letter.
 * @param cardTitle Used in the PDF metadata `title` field.
 * @returns         A Uint8Array of PDF bytes ready to stream to the client.
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
    // Single page exactly the size of the card.
    const page = doc.addPage([CARD_W_PT, CARD_H_PT]);
    page.drawImage(img, {
      x: 0,
      y: 0,
      width: CARD_W_PT,
      height: CARD_H_PT,
    });
  } else {
    // Sheet: letter page, 3×3 grid with crop marks.
    const page = doc.addPage([LETTER_W_PT, LETTER_H_PT]);

    // pdf-lib uses bottom-left origin; iterate rows top-to-bottom.
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        // Convert from top-left grid index to PDF bottom-left coordinates.
        const x = SHEET_MARGIN_X + col * CARD_W_PT;
        const y = LETTER_H_PT - SHEET_MARGIN_Y - (row + 1) * CARD_H_PT;

        // Draw card image
        page.drawImage(img, { x, y, width: CARD_W_PT, height: CARD_H_PT });

        // Draw crop marks at all four corners of this card.
        const corners = [
          { cx: x, cy: y, hDir: -1, vDir: -1 },                     // bottom-left
          { cx: x + CARD_W_PT, cy: y, hDir: 1, vDir: -1 },           // bottom-right
          { cx: x, cy: y + CARD_H_PT, hDir: -1, vDir: 1 },           // top-left
          { cx: x + CARD_W_PT, cy: y + CARD_H_PT, hDir: 1, vDir: 1 },// top-right
        ] as const;

        for (const corner of corners) {
          drawCropMark(page, corner.cx, corner.cy, corner.hDir, corner.vDir);
        }
      }
    }
  }

  return doc.save();
}
