import sharp from "sharp";
import { decodePDFRawStream, PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFRef } from "pdf-lib";
import { beforeAll, describe, expect, it } from "vitest";
import { buildDeckPdf, pageSheetSlots } from "@/lib/render/card-pdf";
import { planSheet } from "@/lib/render/sheet-layout";

// ---------------------------------------------------------------------------
// TODO 5.3 — a double-faced card in the deck / selection PDF (lib/render/
// card-pdf.ts buildDeckPdf): on "pages" its back is its own page right
// after the front; on a sheet its two faces are ONE slot — front beside
// back, every copy, never split across pages (a lone front at the end of a
// page is never placed: the slot moves to the next page whole). A
// single-faced entry is laid out exactly as before.
// ---------------------------------------------------------------------------

let front: Uint8Array;
let back: Uint8Array;
let other: Uint8Array;

beforeAll(async () => {
  const png = async (bg: string) =>
    new Uint8Array(await sharp({ create: { width: 150, height: 210, channels: 3, background: bg } }).png().toBuffer());
  [front, back, other] = await Promise.all([png("#102030"), png("#605040"), png("#a0b0c0")]);
});

/** Each page's image draws, by the image they draw (its XObject ref). */
async function draws(bytes: Uint8Array): Promise<string[][]> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((page) => {
    const contents = page.node.Contents();
    const streams =
      contents instanceof PDFArray
        ? contents.asArray().map((ref) => doc.context.lookup(ref as PDFRef) as PDFRawStream)
        : [contents as PDFRawStream];
    const tokens = streams
      .map((s) => Buffer.from(decodePDFRawStream(s).decode()).toString("latin1"))
      .join("\n")
      .split(/\s+/);
    const xobjects = page.node.Resources()?.lookup(PDFName.of("XObject"), PDFDict);
    const out: string[] = [];
    tokens.forEach((t, i) => {
      if (t !== "Do") return;
      const ref = xobjects?.get(PDFName.of(tokens[i - 1].slice(1)));
      out.push(ref ? ref.toString() : tokens[i - 1]);
    });
    return out;
  });
}

describe("pageSheetSlots", () => {
  it("fills pages with single slots and keeps a two-faced slot's cells together", () => {
    expect(pageSheetSlots([1, 2, 3], 9)).toEqual([[1, 2, 3]]);
    expect(pageSheetSlots([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 9)).toEqual([[1, 2, 3, 4, 5, 6, 7, 8, 9], [10]]);
    // Four pairs fill eight of nine cells; a fifth pair moves whole.
    const pair = [1, 2] as const;
    expect(pageSheetSlots([pair, pair, pair, pair, pair], 9)).toEqual([
      [1, 2, 1, 2, 1, 2, 1, 2],
      [1, 2],
    ]);
    // Eight singles then a pair: the pair never splits over the page end.
    expect(pageSheetSlots([3, 3, 3, 3, 3, 3, 3, 3, pair], 9)).toEqual([[3, 3, 3, 3, 3, 3, 3, 3], [1, 2]]);
    expect(pageSheetSlots([], 9)).toEqual([]);
  });
});

describe("buildDeckPdf with back faces", () => {
  it("pages: a double-faced entry is two pages, the back right after the front; a single-faced one is one", async () => {
    const bytes = await buildDeckPdf(
      [
        { png: front, copies: 4, back },
        { png: other, copies: 1 },
      ],
      { layout: "pages" },
    );
    const got = await draws(bytes);
    expect(got).toHaveLength(3);
    expect(got.map((p) => p.length)).toEqual([1, 1, 1]);
    const [f, b, o] = got.map((p) => p[0]);
    expect(new Set([f, b, o]).size).toBe(3);
  });

  it("sheets: every copy of a double-faced entry is front beside back; singles fill the rest; a pair never splits across pages", async () => {
    const bytes = await buildDeckPdf(
      [
        { png: front, copies: 3, back },
        { png: other, copies: 4 },
      ],
      { layout: "sheet-letter" },
    );
    const got = await draws(bytes);
    const { perPage } = planSheet("letter", { gap: "none", marks: "corners", cardSize: "in", bleed: false });
    expect(perPage).toBe(9);
    // 3 pairs (6 cells) + 3 singles fill page 1; the 4th single on page 2.
    expect(got.map((p) => p.length)).toEqual([9, 1]);
    const [f, b] = got[0];
    expect(f).not.toBe(b);
    expect(got[0].slice(0, 6)).toEqual([f, b, f, b, f, b]);
    expect(new Set(got[0].slice(6)).size).toBe(1);
    expect(got[0][6]).not.toBe(f);
    expect(got[1][0]).toBe(got[0][6]);

    // Four pairs fill eight cells; the fifth pair goes whole onto page 2.
    const pairs = await draws(await buildDeckPdf([{ png: front, copies: 5, back }], { layout: "sheet-letter" }));
    expect(pairs.map((p) => p.length)).toEqual([8, 2]);
    expect(pairs[1]).toEqual([pairs[0][0], pairs[0][1]]);
  });

  it("a null back is a single-faced entry", async () => {
    const got = await draws(await buildDeckPdf([{ png: front, copies: 2, back: null }], { layout: "sheet-a4" }));
    expect(got.map((p) => p.length)).toEqual([2]);
    expect(new Set(got[0]).size).toBe(1);
  });
});
