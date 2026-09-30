// ---------------------------------------------------------------------------
// sheet-layout.ts — where the cards of a print SHEET go (TODO 6.15).
//
// Pure geometry in PDF points (72 pt = 1 in, y up), no imports: it runs in
// the browser (the deck / selection export builds its PDF there) and on the
// server (the single-card sheet route), both through lib/render/card-pdf.ts.
//
// A sheet is a grid of CELLS. A cell is the card's bleed box — the trim box
// (the card itself) plus the bleed on each side when the renders carry one
// (TODO 6.1a) — and the grid is as many cells as fit inside the paper less a
// 1/8 in margin, `gap` apart, centred. The page turns landscape when that
// fits MORE cards (A4 with a bleed: 4 × 2 = 8 instead of 2 × 3 = 6), or as
// many with roomier margins — the cut marks live there (Letter with a bleed:
// 3 × 2 either way, but portrait would leave 1/8 in at the sides); otherwise
// it stays portrait. Cards themselves are always portrait (a landscape
// render is turned into the cell, card-pdf.ts).
//
// The default options are the sheet PipGlyph always printed — 3 × 3 butted
// 2.5 × 3.5 in cards, centred (36 / 18 pt margins on Letter, 27.64 / 42.95
// on A4), corner marks — and planSheet reproduces those positions exactly.
//
// Cut guides are placed on the TRIM lines and are meant to be drawn BENEATH
// the cards (card-pdf.ts does), so they only ever show in the margins and
// the gaps — never on a card's face or its bleed:
//   corners — at each card's four trim corners, two short marks pointing
//             out, starting just outside its bleed box;
//   lines   — every trim line, full length, page edge to page edge.
// ---------------------------------------------------------------------------

export type SheetPaper = "letter" | "a4";

/** Space between neighbouring cells: none (butted) or 1/16 in. */
export const SHEET_GAPS = ["none", "sixteenth"] as const;
export type SheetGap = (typeof SHEET_GAPS)[number];

/** Corner crop marks, or full-length cut lines. */
export const SHEET_MARKS = ["corners", "lines"] as const;
export type SheetMarks = (typeof SHEET_MARKS)[number];

/** The card's trim: 2.5 × 3.5 in (the nominal size, and every render's
 *  5:7), or 63 × 88 mm (a printed Magic card, 0.8 % smaller). */
export const SHEET_CARD_SIZES = ["in", "mm"] as const;
export type SheetCardSize = (typeof SHEET_CARD_SIZES)[number];

export type SheetOptions = {
  gap: SheetGap;
  marks: SheetMarks;
  cardSize: SheetCardSize;
  /** The renders carry a 1/8 in bleed on every side (TODO 6.1a,
   *  lib/render/card-print.ts): each cell grows by it, the trim stays. */
  bleed: boolean;
};

export const DEFAULT_SHEET_OPTIONS: SheetOptions = {
  gap: "none",
  marks: "corners",
  cardSize: "in",
  bleed: false,
};

const MM = 72 / 25.4;

export const PAPER_PT: Record<SheetPaper, { width: number; height: number }> = {
  letter: { width: 612, height: 792 }, // 8.5 × 11 in
  a4: { width: 595.276, height: 841.89 }, // 210 × 297 mm
};

export const CARD_SIZE_PT: Record<SheetCardSize, { width: number; height: number }> = {
  in: { width: 180, height: 252 },
  mm: { width: 63 * MM, height: 88 * MM },
};

export const GAP_PT: Record<SheetGap, number> = { none: 0, sixteenth: 4.5 };

/** 1/8 in of bleed at 2.5 × 3.5 in. A render's bleed is part of the image,
 *  so on a 63 × 88 mm card it scales with the card (per axis). */
export const SHEET_BLEED_PT = 9;

/** The least paper left round the grid: 1/8 in, room for a corner mark. */
export const SHEET_MIN_MARGIN_PT = 9;

/** A corner mark: this far out from the bleed box, this long. */
export const CROP_GAP_PT = 2;
export const CROP_LEN_PT = 6;

/** Rounding slack, so 3 × 198 pt fits 594 pt of Letter. */
const EPS = 1e-6;

export type Box = { x: number; y: number; width: number; height: number };

/** One card position: the cell (= the bleed box) and the trim box inside it. */
export type SheetCell = Box & { trim: Box };

export type SheetPlan = {
  pageWidth: number;
  pageHeight: number;
  orientation: "portrait" | "landscape";
  cols: number;
  rows: number;
  perPage: number;
  /** Row by row from the top-left; lower-left corners, y up. */
  cells: SheetCell[];
  /** The bleed in points on each axis (0 without one). */
  bleedX: number;
  bleedY: number;
  gap: number;
};

export type Segment = { x1: number; y1: number; x2: number; y2: number };

/** How many cells of `cell` fit in `span`, `gap` apart. */
function fit(span: number, cell: number, gap: number): number {
  return Math.max(0, Math.floor((span + gap + EPS) / (cell + gap)));
}

/** The whole grid for `paper` and `options`. Throws only if not a single
 *  card fits, which none of the offered options can cause. */
export function planSheet(paper: SheetPaper, options: SheetOptions = DEFAULT_SHEET_OPTIONS): SheetPlan {
  const trim = CARD_SIZE_PT[options.cardSize];
  const bleedX = options.bleed ? SHEET_BLEED_PT * (trim.width / CARD_SIZE_PT.in.width) : 0;
  const bleedY = options.bleed ? SHEET_BLEED_PT * (trim.height / CARD_SIZE_PT.in.height) : 0;
  const cellW = trim.width + 2 * bleedX;
  const cellH = trim.height + 2 * bleedY;
  const gap = GAP_PT[options.gap];

  const { width: paperW, height: paperH } = PAPER_PT[paper];
  const candidates = (
    [
      ["portrait", paperW, paperH],
      ["landscape", paperH, paperW],
    ] as const
  ).map(([orientation, pageWidth, pageHeight]) => {
    const cols = fit(pageWidth - 2 * SHEET_MIN_MARGIN_PT, cellW, gap);
    const rows = fit(pageHeight - 2 * SHEET_MIN_MARGIN_PT, cellH, gap);
    // The narrower of the two margins the centred grid leaves.
    const margin = Math.min(
      pageWidth - (cols * cellW + (cols - 1) * gap),
      pageHeight - (rows * cellH + (rows - 1) * gap),
    ) / 2;
    return { orientation, pageWidth, pageHeight, cols, rows, margin };
  });
  // More cards wins. On a tie the ROOMIER page wins — its narrowest margin
  // wider — because the marks that locate every cut sit in the margins:
  // Letter with a bleed holds 3 × 2 either way, but portrait leaves 1/8 in
  // at the sides (the horizontal marks would land in most printers'
  // unprintable edge) where landscape leaves 1/2 in. Portrait otherwise.
  const [portrait, landscape] = candidates;
  const count = (c: (typeof candidates)[number]) => c.cols * c.rows;
  const best =
    count(landscape) > count(portrait) ||
    (count(landscape) === count(portrait) && landscape.margin > portrait.margin + 0.01)
      ? landscape
      : portrait;
  if (count(best) === 0) throw new Error("No card fits on this paper.");

  const { pageWidth, pageHeight, cols, rows } = best;
  const marginX = (pageWidth - (cols * cellW + (cols - 1) * gap)) / 2;
  const marginY = (pageHeight - (rows * cellH + (rows - 1) * gap)) / 2;
  const cells: SheetCell[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const x = marginX + col * (cellW + gap);
      const y = pageHeight - marginY - (row + 1) * cellH - row * gap;
      cells.push({
        x,
        y,
        width: cellW,
        height: cellH,
        trim: { x: x + bleedX, y: y + bleedY, width: trim.width, height: trim.height },
      });
    }
  }
  return {
    pageWidth,
    pageHeight,
    orientation: best.orientation,
    cols,
    rows,
    perPage: cols * rows,
    cells,
    bleedX,
    bleedY,
    gap,
  };
}

/** Cards per page for `paper` and `options` (the dialog's "9 per sheet"). */
export function cardsPerSheet(paper: SheetPaper, options: SheetOptions): number {
  return planSheet(paper, options).perPage;
}

/** Distinct values, ascending (two butted cards share a trim line). */
function distinct(values: number[]): number[] {
  const out: number[] = [];
  for (const v of [...values].sort((a, b) => a - b)) {
    if (out.length === 0 || Math.abs(v - out[out.length - 1]) > 0.01) out.push(v);
  }
  return out;
}

/**
 * The cut guides for the first `used` cells of `plan` (a sheet's last page
 * may be part-filled — guides go only round the cards on it).
 *
 * corners: per card, per trim corner, a horizontal and a vertical mark
 * pointing out — from CROP_GAP past the bleed box, CROP_LEN long (the
 * legacy 3 × 3 sheet's marks exactly, when there is no bleed).
 * lines: each distinct trim x as a vertical line and each trim y as a
 * horizontal line, across the whole page.
 */
export function sheetGuides(plan: SheetPlan, marks: SheetMarks, used: number = plan.cells.length): Segment[] {
  const cells = plan.cells.slice(0, Math.max(0, used));
  if (marks === "lines") {
    const xs = distinct(cells.flatMap((c) => [c.trim.x, c.trim.x + c.trim.width]));
    const ys = distinct(cells.flatMap((c) => [c.trim.y, c.trim.y + c.trim.height]));
    return [
      ...xs.map((x) => ({ x1: x, y1: 0, x2: x, y2: plan.pageHeight })),
      ...ys.map((y) => ({ x1: 0, y1: y, x2: plan.pageWidth, y2: y })),
    ];
  }
  const out: Segment[] = [];
  for (const { trim } of cells) {
    const corners = [
      { cx: trim.x, cy: trim.y, h: -1, v: -1 },
      { cx: trim.x + trim.width, cy: trim.y, h: 1, v: -1 },
      { cx: trim.x, cy: trim.y + trim.height, h: -1, v: 1 },
      { cx: trim.x + trim.width, cy: trim.y + trim.height, h: 1, v: 1 },
    ];
    for (const { cx, cy, h, v } of corners) {
      const nearX = plan.bleedX + CROP_GAP_PT;
      const nearY = plan.bleedY + CROP_GAP_PT;
      out.push({ x1: cx + h * nearX, y1: cy, x2: cx + h * (nearX + CROP_LEN_PT), y2: cy });
      out.push({ x1: cx, y1: cy + v * nearY, x2: cx, y2: cy + v * (nearY + CROP_LEN_PT) });
    }
  }
  return out;
}
