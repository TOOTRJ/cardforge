import { describe, expect, it } from "vitest";
import {
  CARD_SIZE_PT,
  CROP_GAP_PT,
  CROP_LEN_PT,
  DEFAULT_SHEET_OPTIONS,
  PAPER_PT,
  planSheet,
  SHEET_BLEED_PT,
  SHEET_CARD_SIZES,
  SHEET_GAPS,
  SHEET_MARKS,
  SHEET_MIN_MARGIN_PT,
  sheetGuides,
  type SheetOptions,
  type SheetPaper,
} from "@/lib/render/sheet-layout";

// ---------------------------------------------------------------------------
// TODO 6.15 — the print sheet's grid (lib/render/sheet-layout.ts): paper,
// gap, cut guides, card size and the 1/8 in bleed. The default must be the
// 3 × 3 sheet PipGlyph always printed, at the same positions.
// ---------------------------------------------------------------------------

const r2 = (v: number) => Math.round(v * 100) / 100 + 0;
const PAPERS: SheetPaper[] = ["letter", "a4"];

/** Every combination of the dialog's options. */
const ALL_OPTIONS: SheetOptions[] = SHEET_GAPS.flatMap((gap) =>
  SHEET_MARKS.flatMap((marks) =>
    SHEET_CARD_SIZES.flatMap((cardSize) => [false, true].map((bleed) => ({ gap, marks, cardSize, bleed }))),
  ),
);

/** The old card-pdf.ts drawSheetPage: 3 × 3 butted 180 × 252 pt cells,
 *  centred; per card, per corner, a horizontal then a vertical mark 2–8 pt
 *  out. */
function legacySheet(pageWidth: number, pageHeight: number) {
  const marginX = (pageWidth - 540) / 2;
  const marginY = (pageHeight - 756) / 2;
  const cells = Array.from({ length: 9 }, (_, i) => ({
    x: marginX + (i % 3) * 180,
    y: pageHeight - marginY - (Math.floor(i / 3) + 1) * 252,
  }));
  const marks = cells.flatMap(({ x, y }) =>
    [
      { cx: x, cy: y, h: -1, v: -1 },
      { cx: x + 180, cy: y, h: 1, v: -1 },
      { cx: x, cy: y + 252, h: -1, v: 1 },
      { cx: x + 180, cy: y + 252, h: 1, v: 1 },
    ].flatMap(({ cx, cy, h, v }) => [
      { x1: cx + h * 2, y1: cy, x2: cx + h * 8, y2: cy },
      { x1: cx, y1: cy + v * 2, x2: cx, y2: cy + v * 8 },
    ]),
  );
  return { cells, marks };
}

describe("planSheet — the default is the old 3 × 3 sheet", () => {
  it.each(PAPERS)("%s: nine butted 2.5 × 3.5 in cells at the legacy positions, corner marks where they were", (paper) => {
    const { width, height } = PAPER_PT[paper];
    const plan = planSheet(paper, DEFAULT_SHEET_OPTIONS);
    const legacy = legacySheet(width, height);

    expect(plan.orientation).toBe("portrait");
    expect([plan.pageWidth, plan.pageHeight]).toEqual([width, height]);
    expect([plan.cols, plan.rows, plan.perPage]).toEqual([3, 3, 9]);
    expect(plan.cells.map((c) => [r2(c.x), r2(c.y), c.width, c.height])).toEqual(
      legacy.cells.map((c) => [r2(c.x), r2(c.y), 180, 252]),
    );
    // No bleed: the trim box IS the cell.
    for (const cell of plan.cells) expect(cell.trim).toEqual({ x: cell.x, y: cell.y, width: 180, height: 252 });

    const round = (s: { x1: number; y1: number; x2: number; y2: number }) => [r2(s.x1), r2(s.y1), r2(s.x2), r2(s.y2)];
    expect(sheetGuides(plan, "corners").map(round)).toEqual(legacy.marks.map(round));
  });

  it("Letter keeps its 36 / 18 pt margins, A4 its 27.64 / 42.95", () => {
    const letter = planSheet("letter");
    expect([r2(letter.cells[0].x), r2(letter.pageHeight - (letter.cells[0].y + 252))]).toEqual([36, 18]);
    const a4 = planSheet("a4");
    expect([r2(a4.cells[0].x), r2(a4.pageHeight - (a4.cells[0].y + 252))]).toEqual([27.64, 42.95]);
  });
});

describe("planSheet — the options (TODO 6.15)", () => {
  it.each(PAPERS)("%s, 1/16 in gap: still nine, the cells 4.5 pt apart on both axes", (paper) => {
    const plan = planSheet(paper, { ...DEFAULT_SHEET_OPTIONS, gap: "sixteenth" });
    expect(plan.perPage).toBe(9);
    expect(r2(plan.cells[1].x - (plan.cells[0].x + plan.cells[0].width))).toBe(4.5);
    expect(r2(plan.cells[0].y - (plan.cells[3].y + plan.cells[3].height))).toBe(4.5);
  });

  it("63 × 88 mm cards are 178.58 × 249.45 pt, still nine to a sheet", () => {
    const plan = planSheet("letter", { ...DEFAULT_SHEET_OPTIONS, cardSize: "mm" });
    expect(plan.perPage).toBe(9);
    expect([r2(plan.cells[0].trim.width), r2(plan.cells[0].trim.height)]).toEqual([178.58, 249.45]);
  });

  it("the bleed grows each cell by 1/8 in a side around the SAME trim — six to a Letter sheet (3 × 3 would need 11.25 in)", () => {
    const plan = planSheet("letter", { ...DEFAULT_SHEET_OPTIONS, bleed: true });
    // 3 × 2 fits either way; the landscape page leaves 99 / 36 pt round the
    // grid where portrait would leave 9 pt at the sides (see the tie test).
    expect([plan.orientation, plan.cols, plan.rows]).toEqual(["landscape", 3, 2]);
    const [cell] = plan.cells;
    expect([cell.width, cell.height]).toEqual([198, 270]);
    expect([cell.trim.x - cell.x, cell.trim.y - cell.y, cell.trim.width, cell.trim.height]).toEqual([
      SHEET_BLEED_PT,
      SHEET_BLEED_PT,
      180,
      252,
    ]);
  });

  it("A4 with a bleed turns the page when that fits more: 4 × 2 = 8 landscape, not 2 × 3 = 6", () => {
    const plan = planSheet("a4", { ...DEFAULT_SHEET_OPTIONS, bleed: true });
    expect([plan.orientation, plan.cols, plan.rows, plan.perPage]).toEqual(["landscape", 4, 2, 8]);
    expect([plan.pageWidth, plan.pageHeight]).toEqual([PAPER_PT.a4.height, PAPER_PT.a4.width]);
  });

  it("a tie goes to the roomier page: Letter + bleed is 3 × 2 both ways, landscape leaves 99 / 36 pt, portrait 9 / 126", () => {
    for (const cardSize of SHEET_CARD_SIZES) {
      const plan = planSheet("letter", { ...DEFAULT_SHEET_OPTIONS, cardSize, bleed: true });
      const [first] = plan.cells;
      const last = plan.cells[plan.cells.length - 1];
      expect([plan.orientation, plan.perPage]).toEqual(["landscape", 6]);
      expect([plan.pageWidth, plan.pageHeight]).toEqual([792, 612]);
      // Both margins wide enough for a printer to reach the marks in them.
      expect(Math.min(first.x, last.y)).toBeGreaterThan(30);
    }
    // No tie, no turn: the default Letter sheet holds 9 portrait, 8 landscape.
    expect(planSheet("letter").orientation).toBe("portrait");
  });

  it("Letter with a bleed AND a gap: landscape 3 × 2 = 6 beats portrait 2 × 2", () => {
    const plan = planSheet("letter", { ...DEFAULT_SHEET_OPTIONS, bleed: true, gap: "sixteenth" });
    expect([plan.orientation, plan.cols, plan.rows]).toEqual(["landscape", 3, 2]);
  });

  it("a 63 × 88 mm card's bleed scales with it, per axis (the render's bleed is part of the image)", () => {
    const plan = planSheet("letter", { ...DEFAULT_SHEET_OPTIONS, cardSize: "mm", bleed: true });
    expect(r2(plan.bleedX)).toBe(r2(SHEET_BLEED_PT * (CARD_SIZE_PT.mm.width / 180)));
    expect(r2(plan.bleedY)).toBe(r2(SHEET_BLEED_PT * (CARD_SIZE_PT.mm.height / 252)));
    // The render (trim 5:7 + its bleed) fills the cell with the trim exactly on the trim box.
    const [cell] = plan.cells;
    expect(r2(cell.width / (180 + 18))).toBe(r2(CARD_SIZE_PT.mm.width / 180));
    expect(r2(cell.height / (252 + 18))).toBe(r2(CARD_SIZE_PT.mm.height / 252));
  });

  it.each(PAPERS.flatMap((paper) => ALL_OPTIONS.map((o) => [paper, o] as const)))(
    "%s %o: every cell on the page with ≥ 1/8 in to spare, none overlapping, the grid centred",
    (paper, options) => {
      const plan = planSheet(paper, options);
      expect(plan.cells).toHaveLength(plan.cols * plan.rows);
      for (const c of plan.cells) {
        expect(c.x).toBeGreaterThanOrEqual(SHEET_MIN_MARGIN_PT - 1e-6);
        expect(c.y).toBeGreaterThanOrEqual(SHEET_MIN_MARGIN_PT - 1e-6);
        expect(c.x + c.width).toBeLessThanOrEqual(plan.pageWidth - SHEET_MIN_MARGIN_PT + 1e-6);
        expect(c.y + c.height).toBeLessThanOrEqual(plan.pageHeight - SHEET_MIN_MARGIN_PT + 1e-6);
      }
      for (let i = 0; i < plan.cells.length; i += 1) {
        for (let j = i + 1; j < plan.cells.length; j += 1) {
          const [a, b] = [plan.cells[i], plan.cells[j]];
          const apart =
            a.x + a.width <= b.x + 1e-6 || b.x + b.width <= a.x + 1e-6 || a.y + a.height <= b.y + 1e-6 || b.y + b.height <= a.y + 1e-6;
          expect(apart).toBe(true);
        }
      }
      const first = plan.cells[0];
      const last = plan.cells[plan.cells.length - 1];
      expect(first.x).toBeCloseTo(plan.pageWidth - (last.x + last.width), 6);
      expect(last.y).toBeCloseTo(plan.pageHeight - (first.y + first.height), 6);
    },
  );
});

describe("sheetGuides — never on a card", () => {
  /** True when (x, y) is strictly inside some card's TRIM box. */
  const onACard = (plan: ReturnType<typeof planSheet>, x: number, y: number) =>
    plan.cells.some(
      ({ trim }) => x > trim.x + 0.01 && x < trim.x + trim.width - 0.01 && y > trim.y + 0.01 && y < trim.y + trim.height - 0.01,
    );

  it.each(PAPERS.flatMap((paper) => ALL_OPTIONS.map((o) => [paper, o] as const)))(
    "%s %o: every guide lies on a trim line, off every card's face",
    (paper, options) => {
      const plan = planSheet(paper, options);
      const trimXs = plan.cells.flatMap((c) => [c.trim.x, c.trim.x + c.trim.width]).map(r2);
      const trimYs = plan.cells.flatMap((c) => [c.trim.y, c.trim.y + c.trim.height]).map(r2);
      for (const s of sheetGuides(plan, options.marks)) {
        if (s.x1 === s.x2) expect(trimXs).toContain(r2(s.x1));
        else expect(trimYs).toContain(r2(s.y1));
        // Sample along the guide: no point on a card's face.
        for (let t = 0; t <= 1; t += 0.01) {
          expect(onACard(plan, s.x1 + (s.x2 - s.x1) * t, s.y1 + (s.y2 - s.y1) * t)).toBe(false);
        }
      }
    },
  );

  /** The outer strip of the paper most printers can't print: a laser's
   *  usual 4.2 mm (1/6 in); an inkjet's is less. */
  const UNPRINTABLE_EDGE_PT = 12;

  it.each(PAPERS.flatMap((paper) => ALL_OPTIONS.map((o) => [paper, o] as const)))(
    "%s %o: every cut is marked somewhere a printer reaches and no card covers",
    (paper, options) => {
      const plan = planSheet(paper, options);
      const guides = sheetGuides(plan, options.marks);
      // The cards (bleed included) are drawn OVER the guides; a 0.25 pt line
      // on a cell's edge is covered too.
      const covered = (x: number, y: number) =>
        plan.cells.some(
          (c) => x >= c.x - 0.13 && x <= c.x + c.width + 0.13 && y >= c.y - 0.13 && y <= c.y + c.height + 0.13,
        );
      const printable = (x: number, y: number) =>
        x >= UNPRINTABLE_EDGE_PT &&
        x <= plan.pageWidth - UNPRINTABLE_EDGE_PT &&
        y >= UNPRINTABLE_EDGE_PT &&
        y <= plan.pageHeight - UNPRINTABLE_EDGE_PT;
      const shows = (s: { x1: number; y1: number; x2: number; y2: number }) => {
        // Every 1/4 pt along it (a page-long line has ~3,400 samples).
        const steps = Math.ceil(Math.hypot(s.x2 - s.x1, s.y2 - s.y1) * 4);
        for (let i = 0; i <= steps; i += 1) {
          const x = s.x1 + ((s.x2 - s.x1) * i) / steps;
          const y = s.y1 + ((s.y2 - s.y1) * i) / steps;
          if (printable(x, y) && !covered(x, y)) return true;
        }
        return false;
      };
      const trimXs = new Set(plan.cells.flatMap((c) => [c.trim.x, c.trim.x + c.trim.width]).map(r2));
      const trimYs = new Set(plan.cells.flatMap((c) => [c.trim.y, c.trim.y + c.trim.height]).map(r2));
      for (const x of trimXs) {
        expect(
          guides.some((s) => s.x1 === s.x2 && r2(s.x1) === x && shows(s)),
          `the cut at x = ${x} shows on the printed page`,
        ).toBe(true);
      }
      for (const y of trimYs) {
        expect(
          guides.some((s) => s.y1 === s.y2 && r2(s.y1) === y && shows(s)),
          `the cut at y = ${y} shows on the printed page`,
        ).toBe(true);
      }
    },
  );

  it("full-length lines: one per distinct trim line, page edge to page edge (butted cards share theirs)", () => {
    const butted = planSheet("letter");
    const lines = sheetGuides(butted, "lines");
    const vertical = lines.filter((s) => s.x1 === s.x2);
    const horizontal = lines.filter((s) => s.y1 === s.y2);
    expect(vertical.map((s) => r2(s.x1))).toEqual([36, 216, 396, 576]);
    expect(horizontal).toHaveLength(4);
    for (const s of vertical) expect([s.y1, s.y2]).toEqual([0, butted.pageHeight]);
    for (const s of horizontal) expect([s.x1, s.x2]).toEqual([0, butted.pageWidth]);

    const gapped = planSheet("letter", { ...DEFAULT_SHEET_OPTIONS, gap: "sixteenth", marks: "lines" });
    const gappedLines = sheetGuides(gapped, "lines");
    expect(gappedLines.filter((s) => s.x1 === s.x2)).toHaveLength(6);
    expect(gappedLines.filter((s) => s.y1 === s.y2)).toHaveLength(6);
  });

  it("with a bleed, corner marks start past the bleed box (on the trim line, into the margin)", () => {
    const plan = planSheet("letter", { ...DEFAULT_SHEET_OPTIONS, bleed: true });
    const [first] = sheetGuides(plan, "corners");
    const { trim } = plan.cells[0];
    // Card 0's lower-left corner, horizontal mark pointing left.
    expect([first.y1, first.y2]).toEqual([trim.y, trim.y]);
    expect(r2(trim.x - first.x1)).toBe(SHEET_BLEED_PT + CROP_GAP_PT);
    expect(r2(trim.x - first.x2)).toBe(SHEET_BLEED_PT + CROP_GAP_PT + CROP_LEN_PT);
    expect(first.x1).toBeLessThan(plan.cells[0].x);
  });

  it("guides go only round the cards on a part-filled last page", () => {
    const plan = planSheet("letter");
    expect(sheetGuides(plan, "corners", 2)).toHaveLength(2 * 8);
    const lines = sheetGuides(plan, "lines", 2);
    expect(lines.filter((s) => s.x1 === s.x2).map((s) => r2(s.x1))).toEqual([36, 216, 396]);
    expect(lines.filter((s) => s.y1 === s.y2)).toHaveLength(2);
  });
});
