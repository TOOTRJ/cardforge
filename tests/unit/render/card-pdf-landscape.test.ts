import sharp from "sharp";
import {
  decodePDFRawStream,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFPage,
  PDFRawStream,
  PDFRef,
} from "pdf-lib";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { CardPreviewData } from "@/components/cards/card-preview";
import { buildCardPdf, buildDeckPdf, type PdfLayout } from "@/lib/render/card-pdf";

// ---------------------------------------------------------------------------
// TODO 6.22 — the print PDF (single card, 3×3 sheets, the Pro deck export)
// drew every render into a portrait 180 × 252 pt slot, so a landscape Battle
// or Split bake (2100 × 1500) printed squeezed to 5:7. A landscape render is
// now turned 90° ANTICLOCKWISE into the portrait slot — the way Wizards
// prints them (Scryfall's scans of Invasion of Zendikar and Fire // Ice: the
// title runs bottom-to-top up the left edge, Fire in the bottom half), so the
// proxy reads when turned clockwise, like the real card.
//
// These tests read the placement back out of the SAVED PDF: each image's
// transformation matrix is replayed from the page's content stream (q/Q/cm
// up to its Do), and the design's four corners are mapped through it.
// ---------------------------------------------------------------------------

type Matrix = [number, number, number, number, number, number];
type Point = [number, number];
type PlacedImage = { ctm: Matrix; width: number; height: number };
type Segment = [Point, Point];
type InspectedPage = { width: number; height: number; images: PlacedImage[]; segments: Segment[] };

const CARD_W = 180;
const CARD_H = 252;

/** `m` applied first, then `n` (PDF row-vector convention). */
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

const r2 = (v: number) => Math.round(v * 100) / 100 + 0; // + 0 folds -0
function apply(ctm: Matrix, u: number, v: number): Point {
  return [r2(u * ctm[0] + v * ctm[2] + ctm[4]), r2(u * ctm[1] + v * ctm[3] + ctm[5])];
}

/** Where the DESIGN's corners land on the page (PDF image space: u runs
 *  left → right across the picture, v bottom → top). */
function designCorners(ctm: Matrix) {
  return {
    topLeft: apply(ctm, 0, 1),
    topRight: apply(ctm, 1, 1),
    bottomLeft: apply(ctm, 0, 0),
    bottomRight: apply(ctm, 1, 0),
  };
}

/** The design corners a render must have in the slot whose lower-left corner
 *  is (x, y): upright for a portrait render; for a landscape one, its top
 *  edge up the slot's LEFT side (reading bottom-to-top) and its left edge
 *  along the slot's bottom — Scryfall's portrait scan of a Battle / Split. */
function expectedCorners(x: number, y: number, orientation: "portrait" | "landscape") {
  const [left, right, bottom, top] = [r2(x), r2(x + CARD_W), r2(y), r2(y + CARD_H)];
  return orientation === "portrait"
    ? { topLeft: [left, top], topRight: [right, top], bottomLeft: [left, bottom], bottomRight: [right, bottom] }
    : { topLeft: [left, bottom], topRight: [left, top], bottomLeft: [right, bottom], bottomRight: [right, top] };
}

function rawStream(doc: PDFDocument, ref: PDFRef): PDFRawStream {
  const obj = doc.context.lookup(ref);
  if (!(obj instanceof PDFRawStream)) throw new Error(`expected a stream at ${String(ref)}`);
  return obj;
}

function xObjectSize(doc: PDFDocument, page: PDFPage, name: string): { width: number; height: number } {
  const xobjects = page.node.Resources()!.lookup(PDFName.of("XObject"), PDFDict);
  const stream = rawStream(doc, xobjects.get(PDFName.of(name)) as PDFRef);
  const num = (key: string) => stream.dict.lookup(PDFName.of(key), PDFNumber).asNumber();
  return { width: num("Width"), height: num("Height") };
}

function contentText(doc: PDFDocument, page: PDFPage): string {
  const contents = page.node.Contents();
  const streams =
    contents instanceof PDFArray
      ? contents.asArray().map((ref) => rawStream(doc, ref as PDFRef))
      : [contents as PDFRawStream];
  return streams.map((s) => Buffer.from(decodePDFRawStream(s).decode()).toString("latin1")).join("\n");
}

async function inspect(bytes: Uint8Array): Promise<InspectedPage[]> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((page) => {
    const images: PlacedImage[] = [];
    const segments: Segment[] = [];
    const stack: Matrix[] = [];
    let ctm: Matrix = [1, 0, 0, 1, 0, 0];
    let operands: string[] = [];
    let penAt: Point | null = null;
    for (const token of contentText(doc, page).split(/\s+/).filter(Boolean)) {
      if (/^[-+.\d]/.test(token) || token.startsWith("/")) {
        operands.push(token);
        continue;
      }
      const nums = operands.map(Number);
      if (token === "q") stack.push(ctm);
      else if (token === "Q") ctm = stack.pop()!;
      else if (token === "cm") ctm = concat(nums as Matrix, ctm);
      else if (token === "Do") images.push({ ctm, ...xObjectSize(doc, page, operands[0].slice(1)) });
      else if (token === "m") penAt = apply(ctm, nums[0], nums[1]);
      else if (token === "l") segments.push([penAt!, apply(ctm, nums[0], nums[1])]);
      operands = [];
    }
    return { ...page.getSize(), images, segments };
  });
}

/** A flat PNG of the given size (the PDF only reads its dimensions). */
async function png(width: number, height: number, rgb: [number, number, number]): Promise<Uint8Array> {
  const buf = await sharp({
    create: { width, height, channels: 3, background: { r: rgb[0], g: rgb[1], b: rgb[2] } },
  })
    .png()
    .toBuffer();
  return new Uint8Array(buf);
}

/** The 3×3 grid's slot lower-left corners, row by row from the top. */
function sheetSlots(pageWidth: number, pageHeight: number): Point[] {
  const marginX = (pageWidth - 3 * CARD_W) / 2;
  const marginY = (pageHeight - 3 * CARD_H) / 2;
  return Array.from({ length: 9 }, (_, i) => [
    marginX + (i % 3) * CARD_W,
    pageHeight - marginY - (Math.floor(i / 3) + 1) * CARD_H,
  ]);
}

let PORTRAIT: Uint8Array;
let LANDSCAPE: Uint8Array;
beforeAll(async () => {
  // 5:7 and 7:5, like the HD bakes (1500 × 2100 / 2100 × 1500), only smaller.
  PORTRAIT = await png(50, 70, [200, 40, 40]);
  LANDSCAPE = await png(70, 50, [40, 40, 200]);
});

describe("card PDF — a landscape render is turned into the portrait slot (TODO 6.22)", () => {
  it("single card: a 2.5 × 3.5 in portrait page either way, the landscape render turned 90° anticlockwise", async () => {
    const [portrait] = await inspect(await buildCardPdf(PORTRAIT, "card", "Portrait"));
    const [landscape] = await inspect(await buildCardPdf(LANDSCAPE, "card", "Battle"));

    for (const page of [portrait, landscape]) {
      expect([page.width, page.height]).toEqual([CARD_W, CARD_H]);
      expect(page.images).toHaveLength(1);
    }
    expect(designCorners(portrait.images[0].ctm)).toEqual(expectedCorners(0, 0, "portrait"));
    expect(designCorners(landscape.images[0].ctm)).toEqual(expectedCorners(0, 0, "landscape"));
    // The PNG itself is embedded as it came (landscape pixels, not resampled).
    expect([landscape.images[0].width, landscape.images[0].height]).toEqual([70, 50]);
  });

  it.each<[PdfLayout, number, number]>([
    ["sheet", 612, 792],
    ["sheet-letter", 612, 792],
    ["sheet-a4", 595.276, 841.89],
  ])("%s: all nine cells hold the turned card, and the crop marks do not move", async (layout, pw, ph) => {
    const [portrait] = await inspect(await buildCardPdf(PORTRAIT, layout));
    const [landscape] = await inspect(await buildCardPdf(LANDSCAPE, layout));
    const slots = sheetSlots(pw, ph);

    expect([landscape.width, landscape.height]).toEqual([pw, ph]);
    expect(portrait.images).toHaveLength(9);
    expect(landscape.images).toHaveLength(9);
    slots.forEach(([x, y], i) => {
      expect(designCorners(portrait.images[i].ctm)).toEqual(expectedCorners(x, y, "portrait"));
      expect(designCorners(landscape.images[i].ctm)).toEqual(expectedCorners(x, y, "landscape"));
    });
    // The marks bracket the slot, which the turned card fills exactly.
    expect(landscape.segments.length).toBe(9 * 4 * 2);
    expect(landscape.segments).toEqual(portrait.segments);
  });

  it("deck export: each card placed by its own orientation — on 3×3 sheets and one card per page", async () => {
    const entries = [
      { png: PORTRAIT, copies: 2 },
      { png: LANDSCAPE, copies: 1 },
      { png: PORTRAIT, copies: 1 },
    ];
    const expected = ["portrait", "portrait", "landscape", "portrait"] as const;

    const [sheet] = await inspect(await buildDeckPdf(entries, { layout: "sheet-letter" }));
    const slots = sheetSlots(612, 792);
    expect(sheet.images).toHaveLength(4);
    expected.forEach((orientation, i) => {
      expect(designCorners(sheet.images[i].ctm)).toEqual(expectedCorners(slots[i][0], slots[i][1], orientation));
    });

    const [a4] = await inspect(await buildDeckPdf(entries, { layout: "sheet-a4" }));
    const a4Slots = sheetSlots(595.276, 841.89);
    expect(designCorners(a4.images[2].ctm)).toEqual(expectedCorners(a4Slots[2][0], a4Slots[2][1], "landscape"));

    // "pages": one card per UNIQUE entry, copies ignored.
    const pages = await inspect(await buildDeckPdf(entries, { layout: "pages" }));
    expect(pages.map((p) => [p.width, p.height])).toEqual([
      [CARD_W, CARD_H],
      [CARD_W, CARD_H],
      [CARD_W, CARD_H],
    ]);
    expect(designCorners(pages[0].images[0].ctm)).toEqual(expectedCorners(0, 0, "portrait"));
    expect(designCorners(pages[1].images[0].ctm)).toEqual(expectedCorners(0, 0, "landscape"));
    expect(designCorners(pages[2].images[0].ctm)).toEqual(expectedCorners(0, 0, "portrait"));
  });

  describe("real landscape bakes (public/frames/battle and split are in git — offline)", () => {
    beforeAll(() => {
      const realFetch = globalThis.fetch;
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
          // Satori loads its yoga wasm from a data: URL; nothing leaves the box.
          if (String(input).startsWith("data:")) return realFetch(input, init);
          throw new Error(`unexpected fetch: ${String(input)}`);
        }),
      );
    });
    afterAll(() => {
      vi.unstubAllGlobals();
    });

    const base = {
      supertype: null,
      rarity: "rare",
      flavorText: null,
      power: null,
      toughness: null,
      loyalty: null,
      defense: null,
      artistCredit: "Probe",
      artUrl: null,
      artPosition: {},
      setIconUrl: null,
      setIconCode: null,
      backFace: null,
      faceContent: null,
      watermark: null,
    };
    const battle = {
      ...base,
      title: "Invasion of Probe",
      cost: "{2}{G}",
      cardType: "battle",
      subtypes: ["Siege"],
      colorIdentity: ["green"],
      rulesText: "When Invasion of Probe enters, search your library for a basic land card.",
      defense: "4",
      frameStyle: { template: "battle", finish: "regular" },
    } as unknown as CardPreviewData;
    const split = {
      ...base,
      title: "Fire Probe",
      cost: "{1}{R}",
      cardType: "instant",
      subtypes: [],
      colorIdentity: ["red", "blue"],
      rulesText: "Fire Probe deals 2 damage divided as you choose among one or two targets.",
      frameStyle: { template: "split", finish: "regular" },
      backFace: { title: "Ice Probe", cost: "{1}{U}", card_type: "instant", rules_text: "Tap target permanent. Draw a card." },
    } as unknown as CardPreviewData;

    it.each([
      ["battle", battle],
      ["split", split],
    ] as const)("a %s bake prints turned, not squashed to 5:7", async (_label, card) => {
      const { renderCardImage } = await import("@/lib/render/card-image");
      // What the PDF route asks for (square corners — print), at the smaller preset.
      const res = await renderCardImage(card, "default", { brandMark: false, watermarkText: null, corners: "square" });
      const bake = new Uint8Array(await res.arrayBuffer());
      const meta = await sharp(bake).metadata();
      expect([meta.width, meta.height]).toEqual([1050, 750]);

      const [page] = await inspect(await buildCardPdf(bake, "card"));
      expect([page.width, page.height]).toEqual([CARD_W, CARD_H]);
      expect(designCorners(page.images[0].ctm)).toEqual(expectedCorners(0, 0, "landscape"));
    }, 60_000);
  });
});
