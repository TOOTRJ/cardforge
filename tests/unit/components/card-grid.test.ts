import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CARD_GRID_CLASS, CARD_GRID_SIZES } from "@/components/cards/card-grid";
import { ROW_GRID_CLASS, ROW_MAX, rowTileClass } from "@/components/gallery/card-row";
import { DECK_GRID_CLASS, DECK_GRID_SIZES, deckRowTileClass } from "@/components/decks/deck-tile";

// ---------------------------------------------------------------------------
// TODO WD3: the card and deck grids count their columns by the width of the
// box they sit in (container queries) — 2 / 3 / 4 / 6 cards, 1 / 2 / 3 / 4
// decks — and a picture drawn from a bigger file than its tile asks for the
// tile's width (`sizes`). Held here: the steps, the strips' hidden tiles,
// that every grid sits in a query container (without one, every container
// variant misses and the grid falls back to its phone column count), and
// that `sizes` never asks for less than the tile in a wide page frame — a
// blurry picture — nor much more — a heavier one.
// ---------------------------------------------------------------------------

/** A tile's width in the WIDE page frame (PageContainer: 16 / 24 / 32 px
 *  gutters from 640 / 1024 px, 1920 px cap) — the layout's own arithmetic. */
function wideFrameTile(vw: number, columnsAt: (inner: number) => number): number {
  const gutter = vw < 640 ? 16 : vw < 1024 ? 24 : 32;
  const inner = Math.min(vw, 1920) - 2 * gutter;
  const columns = columnsAt(inner);
  const gap = columns === 1 ? 0 : inner < 576 ? 16 : 20;
  return (inner - gap * (columns - 1)) / columns;
}
const cardColumns = (inner: number) => (inner < 576 ? 2 : inner < 896 ? 3 : inner < 1344 ? 4 : 6);
const deckColumns = (inner: number) => (inner < 576 ? 1 : inner < 896 ? 2 : inner < 1344 ? 3 : 4);

/** What a `sizes` list answers at a window width. */
function sizesAt(sizes: string, vw: number): number {
  for (const entry of sizes.split(/,\s*(?![^(]*\))/)) {
    const media = /^\(min-width:\s*(\d+)px\)\s+(.+)$/.exec(entry.trim());
    if (media && vw < Number(media[1])) continue;
    const value = (media ? media[2] : entry).trim();
    const expression = value.replace(/calc/g, "").replace(/100vw/g, String(vw)).replace(/px/g, "");
    expect(expression).toMatch(/^[\d\s()+\-*/.]+$/);
    return Function(`return (${expression});`)() as number;
  }
  throw new Error(`no entry of "${sizes}" answers ${vw}px`);
}

describe("the card grid's columns", () => {
  it("steps 2 / 3 / 4 / 6 at 36 / 56 / 84rem of its container", () => {
    expect(CARD_GRID_CLASS.split(" ")).toEqual(
      expect.arrayContaining(["grid-cols-2", "@xl:grid-cols-3", "@4xl:grid-cols-4", "@min-[84rem]:grid-cols-6"]),
    );
    // Every count divides a 24-card page: no page ends on a ragged row.
    for (const columns of [2, 3, 4, 6]) expect(24 % columns).toBe(0);
  });

  it("a strip is the grid with the tiles past its last column hidden", () => {
    expect(ROW_GRID_CLASS).toBe(CARD_GRID_CLASS);
    expect(ROW_MAX).toBe(6);
    expect(Array.from({ length: ROW_MAX }, (_, i) => rowTileClass(i))).toEqual([
      "flex",
      "flex",
      "hidden @xl:flex",
      "hidden @4xl:flex",
      "hidden @min-[84rem]:flex",
      "hidden @min-[84rem]:flex",
    ]);
    expect(Array.from({ length: 4 }, (_, i) => deckRowTileClass(i))).toEqual([
      "flex",
      "hidden @xl:flex",
      "hidden @4xl:flex",
      "hidden @min-[84rem]:flex",
    ]);
  });

  it("the deck grid is one column fewer at the same steps", () => {
    expect(DECK_GRID_CLASS.split(" ")).toEqual(
      expect.arrayContaining(["grid-cols-1", "@xl:grid-cols-2", "@4xl:grid-cols-3", "@min-[84rem]:grid-cols-4"]),
    );
  });

  it("a card tile in a wide page stays near the 600 px thumbnail's sharp size", () => {
    for (let vw = 320; vw <= 2560; vw++) {
      expect(wideFrameTile(vw, cardColumns), `${vw}px`).toBeLessThanOrEqual(322);
    }
    expect(Math.round(wideFrameTile(1920, cardColumns))).toBe(293);
    expect(Math.round(wideFrameTile(390, cardColumns))).toBe(171);
  });
});

describe("the grids' `sizes`", () => {
  for (const [name, sizes, columnsAt] of [
    ["cards", CARD_GRID_SIZES, cardColumns],
    ["decks", DECK_GRID_SIZES, deckColumns],
  ] as const) {
    it(`${name}: never less than the tile at any window width, and never 12 px more`, () => {
      for (let vw = 320; vw <= 2560; vw++) {
        const tile = wideFrameTile(vw, columnsAt);
        const asked = sizesAt(sizes, vw);
        expect(asked, `${vw}px`).toBeGreaterThanOrEqual(tile - 0.01);
        expect(asked - tile, `${vw}px`).toBeLessThan(12);
      }
    });
  }
});

describe("every grid sits in a query container (source scan)", () => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (path.endsWith(".tsx")) files.push(path);
    }
  };
  walk("app");
  walk("components");

  it("a file that places a grid class by hand also draws its `@container`", () => {
    const placing = files.filter((path) =>
      /className=\{[^}]*\b(?:CARD_GRID_CLASS|ROW_GRID_CLASS|DECK_GRID_CLASS)\b/.test(readFileSync(path, "utf8")),
    );
    expect(placing.length).toBeGreaterThan(0);
    for (const path of placing) expect(readFileSync(path, "utf8"), path).toMatch(/"@container"/);
  });
});
