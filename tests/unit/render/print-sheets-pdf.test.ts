import sharp from "sharp";
import {
  decodePDFRawStream,
  PDFArray,
  PDFDocument,
  PDFPage,
  PDFRawStream,
  PDFRef,
} from "pdf-lib";
import { beforeAll, describe, expect, it } from "vitest";
import { buildCardPdf, buildDeckPdf } from "@/lib/render/card-pdf";
import { DEFAULT_SHEET_OPTIONS, planSheet, type SheetOptions } from "@/lib/render/sheet-layout";

// ---------------------------------------------------------------------------
// TODO 6.15 — print sheets from any selection: buildDeckPdf lays a list of
// cards out with the sheet options (gap, cut guides, card size) and the
// 1/8 in bleed; the grid is lib/render/sheet-layout.ts (its own tests).
// Here: what lands in the SAVED PDF — every card in its cell, the guides
// drawn BENEATH the cards (before the first image, so they only show in the
// margins and gaps), a bleed page per card for "pages" + bleed.
// ---------------------------------------------------------------------------

type Matrix = [number, number, number, number, number, number];
type Point = [number, number];
type Op = { kind: "image"; ctm: Matrix } | { kind: "line"; from: Point; to: Point };
type InspectedPage = { width: number; height: number; ops: Op[] };

function concat(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[1] * n[2],
    m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2],
    m[2] * n[1] + m[3] * n[3],
    m[4] * n[0] + m[5] * n[2] + n[4],
    m[4] * n[1] + m[5] * n[3] + n[5],
  ];
}
const r2 = (v: number) => Math.round(v * 100) / 100 + 0;
const apply = (ctm: Matrix, u: number, v: number): Point => [
  r2(u * ctm[0] + v * ctm[2] + ctm[4]),
  r2(u * ctm[1] + v * ctm[3] + ctm[5]),
];

function contentText(doc: PDFDocument, page: PDFPage): string {
  const contents = page.node.Contents();
  const streams =
    contents instanceof PDFArray
      ? contents.asArray().map((ref) => doc.context.lookup(ref as PDFRef) as PDFRawStream)
      : [contents as PDFRawStream];
  return streams.map((s) => Buffer.from(decodePDFRawStream(s).decode()).toString("latin1")).join("\n");
}

/** Every image placement and line, in PAINT order. */
async function inspect(bytes: Uint8Array): Promise<InspectedPage[]> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((page) => {
    const ops: Op[] = [];
    const stack: Matrix[] = [];
    let ctm: Matrix = [1, 0, 0, 1, 0, 0];
    let operands: string[] = [];
    let pen: Point | null = null;
    for (const token of contentText(doc, page).split(/\s+/).filter(Boolean)) {
      if (/^[-+.\d]/.test(token) || token.startsWith("/")) {
        operands.push(token);
        continue;
      }
      const nums = operands.map(Number);
      if (token === "q") stack.push(ctm);
      else if (token === "Q") ctm = stack.pop()!;
      else if (token === "cm") ctm = concat(nums as Matrix, ctm);
      else if (token === "Do") ops.push({ kind: "image", ctm });
      else if (token === "m") pen = apply(ctm, nums[0], nums[1]);
      else if (token === "l") ops.push({ kind: "line", from: pen!, to: apply(ctm, nums[0], nums[1]) });
      operands = [];
    }
    return { ...page.getSize(), ops };
  });
}

const images = (page: InspectedPage) => page.ops.filter((op): op is Extract<Op, { kind: "image" }> => op.kind === "image");
const lines = (page: InspectedPage) => page.ops.filter((op): op is Extract<Op, { kind: "line" }> => op.kind === "line");

/** The box an upright image fills: [left, bottom, right, top]. */
function box(ctm: Matrix): [number, number, number, number] {
  const [l, b] = apply(ctm, 0, 0);
  const [r, t] = apply(ctm, 1, 1);
  return [l, b, r, t];
}

/** Every line is painted before the first image — the cards cover them. */
function guidesBeneath(page: InspectedPage): boolean {
  const firstImage = page.ops.findIndex((op) => op.kind === "image");
  const lastLine = page.ops.map((op) => op.kind).lastIndexOf("line");
  return lastLine < firstImage;
}

async function png(width: number, height: number): Promise<Uint8Array> {
  return new Uint8Array(
    await sharp({ create: { width, height, channels: 3, background: { r: 10, g: 10, b: 10 } } }).png().toBuffer(),
  );
}

let CARD: Uint8Array; // 5:7, like the HD render
let BLEED_CARD: Uint8Array; // 1650 × 2250 in miniature: 5:7 plus the bleed
let BLEED_LANDSCAPE: Uint8Array;
beforeAll(async () => {
  CARD = await png(50, 70);
  BLEED_CARD = await png(66, 90);
  BLEED_LANDSCAPE = await png(90, 66);
});

describe("the 3 × 3 sheet keeps its geometry, with its marks now BENEATH the cards", () => {
  it.each(["sheet-letter", "sheet-a4"] as const)("single-card %s: 9 cards, 72 marks, none painted over a card", async (layout) => {
    const [page] = await inspect(await buildCardPdf(CARD, layout, "Nine"));
    expect(images(page)).toHaveLength(9);
    expect(lines(page)).toHaveLength(72);
    // The old sheet drew each card's marks right after it, so a later card's
    // marks landed on the edges of the cards before it.
    expect(guidesBeneath(page)).toBe(true);
  });

  it("the deck export's sheets, no options: the same 3 × 3 at the same cells", async () => {
    const [page] = await inspect(await buildDeckPdf([{ png: CARD, copies: 9 }], { layout: "sheet-letter" }));
    const plan = planSheet("letter", DEFAULT_SHEET_OPTIONS);
    expect(images(page).map((op) => box(op.ctm))).toEqual(
      plan.cells.map((c) => [r2(c.x), r2(c.y), r2(c.x + 180), r2(c.y + 252)]),
    );
    expect(guidesBeneath(page)).toBe(true);
  });
});

describe("buildDeckPdf — a selection with sheet options (TODO 6.15)", () => {
  it("1/16 in gap, full-length lines, 63 × 88 mm: 11 copies → 9 + 2, each in its cell, lines across the page", async () => {
    const sheet = { gap: "sixteenth", marks: "lines", cardSize: "mm" } as const;
    const pages = await inspect(
      await buildDeckPdf(
        [
          { png: CARD, copies: 7 },
          { png: CARD, copies: 4 },
        ],
        { layout: "sheet-letter", sheet },
      ),
    );
    const plan = planSheet("letter", { ...sheet, bleed: false });
    expect(pages.map((p) => [p.width, p.height])).toEqual([
      [612, 792],
      [612, 792],
    ]);
    expect(images(pages[0])).toHaveLength(9);
    expect(images(pages[1])).toHaveLength(2);
    expect(images(pages[1]).map((op) => box(op.ctm))).toEqual(
      plan.cells.slice(0, 2).map((c) => [r2(c.x), r2(c.y), r2(c.x + c.width), r2(c.y + c.height)]),
    );
    for (const page of pages) {
      expect(guidesBeneath(page)).toBe(true);
      for (const { from, to } of lines(page)) {
        // Full length: edge to edge of the page.
        if (from[0] === to[0]) expect([from[1], to[1]]).toEqual([0, 792]);
        else expect([from[0], to[0]]).toEqual([0, 612]);
      }
    }
    // The part-filled page cuts round its two cards only: with the gap each
    // card has its own two x-lines (4), and they share their row's two y-lines.
    expect(lines(pages[1]).filter((l) => l.from[0] === l.to[0])).toHaveLength(4);
    expect(lines(pages[1]).filter((l) => l.from[1] === l.to[1])).toHaveLength(2);
  });

  it("bleed on Letter: six to a sheet, each render filling its bleed box, the trim where the plan says", async () => {
    const options: SheetOptions = { ...DEFAULT_SHEET_OPTIONS, bleed: true };
    const pages = await inspect(
      await buildDeckPdf([{ png: BLEED_CARD, copies: 7 }], { layout: "sheet-letter", bleed: true }),
    );
    const plan = planSheet("letter", options);
    expect(images(pages[0])).toHaveLength(6);
    expect(images(pages[1])).toHaveLength(1);
    images(pages[0]).forEach((op, i) => {
      const cell = plan.cells[i];
      expect(box(op.ctm)).toEqual([r2(cell.x), r2(cell.y), r2(cell.x + 198), r2(cell.y + 270)]);
    });
    // Corner marks on the trim lines, outside every bleed box.
    const [first] = lines(pages[0]);
    expect(first.from[1]).toBe(r2(plan.cells[0].trim.y));
    expect(first.from[0]).toBeLessThan(plan.cells[0].x);
    expect(guidesBeneath(pages[0])).toBe(true);
  });

  it("bleed on A4 turns the page: 8 to a landscape sheet, a landscape render turned into its portrait cell", async () => {
    const [page] = await inspect(
      await buildDeckPdf([{ png: BLEED_LANDSCAPE, copies: 8 }], { layout: "sheet-a4", bleed: true }),
    );
    expect([page.width, page.height]).toEqual([841.89, 595.276]);
    expect(images(page)).toHaveLength(8);
    const plan = planSheet("a4", { ...DEFAULT_SHEET_OPTIONS, bleed: true });
    const cell = plan.cells[0];
    const ctm = images(page)[0].ctm;
    // Turned 90° anticlockwise: the design's top-left lands bottom-left of the cell.
    expect(apply(ctm, 0, 1)).toEqual([r2(cell.x), r2(cell.y)]);
    expect(apply(ctm, 1, 0)).toEqual([r2(cell.x + cell.width), r2(cell.y + cell.height)]);
  });

  it("one per page with a bleed: each card on its own bleed page (TrimBox + BleedBox), copies ignored", async () => {
    const bytes = await buildDeckPdf(
      [
        { png: BLEED_CARD, copies: 3 },
        { png: BLEED_CARD, copies: 1 },
      ],
      { layout: "pages", bleed: true },
    );
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(2);
    for (const page of doc.getPages()) {
      expect(page.getSize()).toEqual({ width: 234, height: 306 });
      expect(page.getTrimBox()).toEqual({ x: 27, y: 27, width: 180, height: 252 });
      expect(page.getBleedBox()).toEqual({ x: 18, y: 18, width: 198, height: 270 });
    }
  });

  it("without a bleed, one per page is the plain 2.5 × 3.5 in page, as before", async () => {
    const doc = await PDFDocument.load(await buildDeckPdf([{ png: CARD, copies: 2 }], { layout: "pages" }));
    expect(doc.getPages().map((p) => p.getSize())).toEqual([{ width: 180, height: 252 }]);
  });
});
