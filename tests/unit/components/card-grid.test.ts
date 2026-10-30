import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CARD_GRID_CLASS,
  CARD_GRID_COMPACT_CLASS,
  CARD_GRID_SIZES,
  DASHBOARD_CARD_GRID_SIZES,
  DASHBOARD_COMPACT_GRID_SIZES,
  WINDOW_GRID_SIZES,
} from "@/components/cards/card-grid";
import { ROW_GRID_CLASS, ROW_MAX, rowTileClass } from "@/components/gallery/card-row";
import {
  DASHBOARD_DECK_GRID_SIZES,
  DECK_GRID_CLASS,
  DECK_GRID_SIZES,
  DECK_NARROW_FRAME_SIZES,
  deckRowTileClass,
} from "@/components/decks/deck-tile";
import {
  COMMANDER_ROW_GRID_CLASS,
  COMMANDER_ROW_MAX,
  COMMANDER_ROW_SIZES,
  commanderRowTileClass,
} from "@/components/decks/commander-row";

// ---------------------------------------------------------------------------
// TODO WD3 / WD4: the card and deck grids count their columns by the width
// of the box they sit in (container queries) — 2 / 3 / 4 / 5 / 6 cards (the
// five-column step: owner 2026-10-29), 2 – 8 compact My Cards tiles, 1 / 2 /
// 3 / 4 decks — and a picture drawn from a bigger file than its tile asks
// for the tile's width (`sizes`), by the FRAME the grid is in. Held here:
// the steps, the strips' hidden tiles, that every grid sits in a query
// container (without one, every container variant misses and the grid falls
// back to its phone column count), the tile widths, and that each frame's
// `sizes` never asks for less than its tile at any window width from 320 to
// 2560 px — a blurry picture — nor much more — a heavier one. A grid that
// counts its columns by the WINDOW keeps the thumbnail's generous default.
// ---------------------------------------------------------------------------

const gutter = (vw: number) => (vw < 640 ? 16 : vw < 1024 ? 24 : 32);

/** The box a grid sits in, per frame — the layout's own arithmetic. */
const FRAMES = {
  /** PageContainer size="wide": 1920 px cap. */
  wide: (vw: number) => Math.min(vw, 1920) - 2 * gutter(vw),
  /** DashboardShell: the wide frame less the 220 px rail and its 32 px gap
   *  from lg (1024 px); under it the rail sits above the column. */
  dashboard: (vw: number) => Math.min(vw, 1920) - 2 * gutter(vw) - (vw >= 1024 ? 252 : 0),
  /** PageContainer size="standard": 1280 px cap. */
  standard: (vw: number) => Math.min(vw, 1280) - 2 * gutter(vw),
  /** The card page's own 1152 px frame (its modal is narrower). */
  cardPage: (vw: number) => Math.min(vw, 1152) - 2 * gutter(vw),
  /** /decks' commander row (TODO DK8.4): the wide frame less the glowing
   *  surface's padding (p-5, sm:p-7) and its 1 px border. */
  commanderRow: (vw: number) => Math.min(vw, 1920) - 2 * gutter(vw) - 2 * (vw < 640 ? 20 : 28) - 2,
  /** A `DashboardShell readable` column (Settings): 1024 px at most. */
  readable: (vw: number) => Math.min(1024, Math.min(vw, 1920) - 2 * gutter(vw) - (vw >= 1024 ? 252 : 0)),
};

type Grid = { columns: (box: number, vw: number) => number; gap: (box: number) => number };

const CARD_GRID: Grid = {
  columns: (w) => (w < 576 ? 2 : w < 896 ? 3 : w < 1344 ? 4 : w < 1600 ? 5 : 6),
  gap: (w) => (w < 576 ? 16 : 20),
};
const COMPACT_GRID: Grid = {
  columns: (w) => (w < 480 ? 2 : w < 640 ? 3 : w < 896 ? 4 : w < 1120 ? 5 : w < 1344 ? 6 : w < 1568 ? 7 : 8),
  gap: () => 12,
};
const COMMANDER_ROW: Grid = {
  columns: (w) => (w < 576 ? 3 : w < 768 ? 4 : w < 960 ? 5 : w < 1216 ? 6 : w < 1472 ? 7 : 8),
  gap: () => 12,
};
const DECK_GRID: Grid = {
  columns: (w) => (w < 576 ? 1 : w < 896 ? 2 : w < 1344 ? 3 : 4),
  gap: () => 20,
};
/** A grid that counts by the WINDOW: 1 column, then the given counts from
 *  sm (640) / lg (1024) / xl (1280). */
const windowGrid = (sm: number, lg: number, xl: number, gap: number): Grid => ({
  columns: (_w, vw) => (vw < 640 ? 1 : vw < 1024 ? sm : vw < 1280 ? lg : xl),
  gap: () => gap,
});

function tile(grid: Grid, frame: (vw: number) => number, vw: number): number {
  const box = frame(vw);
  const columns = grid.columns(box, vw);
  return (box - (columns === 1 ? 0 : grid.gap(box) * (columns - 1))) / columns;
}

/** What a `sizes` list answers at a window width. */
function sizesAt(sizes: string, vw: number): number {
  for (const entry of sizes.split(/,\s*(?![^(]*\))/)) {
    const media = /^\(min-width:\s*(\d+)px\)\s+(.+)$/.exec(entry.trim());
    if (media && vw < Number(media[1])) continue;
    const value = (media ? media[2] : entry).trim();
    const expression = value
      .replace(/calc/g, "")
      .replace(/(\d+(?:\.\d+)?)vw/g, (_, n: string) => `(${n} * ${vw} / 100)`)
      .replace(/px/g, "");
    expect(expression).toMatch(/^[\d\s()+\-*/.]+$/);
    return Function(`return (${expression});`)() as number;
  }
  throw new Error(`no entry of "${sizes}" answers ${vw}px`);
}

const WINDOWS = Array.from({ length: 2560 - 320 + 1 }, (_, i) => 320 + i);

describe("the card grid's columns", () => {
  it("steps 2 / 3 / 4 / 5 / 6 at 36 / 56 / 84 / 100rem of its container", () => {
    expect(CARD_GRID_CLASS.split(" ")).toEqual(
      expect.arrayContaining([
        "grid-cols-2",
        "@xl:grid-cols-3",
        "@4xl:grid-cols-4",
        "@min-[84rem]:grid-cols-5",
        "@min-[100rem]:grid-cols-6",
      ]),
    );
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
      "hidden @min-[100rem]:flex",
    ]);
    expect(Array.from({ length: 4 }, (_, i) => deckRowTileClass(i))).toEqual([
      "flex",
      "hidden @xl:flex",
      "hidden @4xl:flex",
      "hidden @min-[84rem]:flex",
    ]);
  });

  it("the deck grid is one column fewer at the card grid's first steps", () => {
    expect(DECK_GRID_CLASS.split(" ")).toEqual(
      expect.arrayContaining(["grid-cols-1", "@xl:grid-cols-2", "@4xl:grid-cols-3", "@min-[84rem]:grid-cols-4"]),
    );
  });

  it("the compact grid steps one column at a time past four", () => {
    expect(CARD_GRID_COMPACT_CLASS.split(" ")).toEqual(
      expect.arrayContaining([
        "grid-cols-2",
        "@min-[30rem]:grid-cols-3",
        "@min-[40rem]:grid-cols-4",
        "@min-[56rem]:grid-cols-5",
        "@min-[70rem]:grid-cols-6",
        "@min-[84rem]:grid-cols-7",
        "@min-[98rem]:grid-cols-8",
      ]),
    );
  });

  it("a card tile never outgrows the 600 px thumbnail, and keeps ~250 px past four columns", () => {
    for (const vw of WINDOWS) {
      for (const frame of [FRAMES.wide, FRAMES.dashboard]) {
        expect(tile(CARD_GRID, frame, vw), `${vw}px`).toBeLessThanOrEqual(321);
      }
      if (vw >= 1408) expect(tile(CARD_GRID, FRAMES.wide, vw), `${vw}px`).toBeGreaterThanOrEqual(250);
    }
    // The owner's laptops (2026-10-29): columns × tile on a wide page.
    const at = (vw: number) => `${CARD_GRID.columns(FRAMES.wide(vw), vw)} × ${Math.round(tile(CARD_GRID, FRAMES.wide, vw))}`;
    expect([390, 1366, 1440, 1536, 1680, 1920, 2560].map(at)).toEqual([
      "2 × 171",
      "4 × 311",
      "5 × 259",
      "5 × 278",
      "6 × 253",
      "6 × 293",
      "6 × 293",
    ]);
  });

  it("/decks' commander row: smaller tiles, 3 → 8 in one row, the tiles past the last column hidden (DK8.4)", () => {
    expect(COMMANDER_ROW_GRID_CLASS.split(" ")).toEqual(
      expect.arrayContaining([
        "grid-cols-3",
        "@min-[36rem]:grid-cols-4",
        "@min-[48rem]:grid-cols-5",
        "@min-[60rem]:grid-cols-6",
        "@min-[76rem]:grid-cols-7",
        "@min-[92rem]:grid-cols-8",
      ]),
    );
    expect(COMMANDER_ROW_MAX).toBe(8);
    expect(Array.from({ length: COMMANDER_ROW_MAX }, (_, i) => commanderRowTileClass(i))).toEqual([
      "flex",
      "flex",
      "flex",
      "hidden @min-[36rem]:flex",
      "hidden @min-[48rem]:flex",
      "hidden @min-[60rem]:flex",
      "hidden @min-[76rem]:flex",
      "hidden @min-[92rem]:flex",
    ]);
    const at = (vw: number) =>
      `${COMMANDER_ROW.columns(FRAMES.commanderRow(vw), vw)} × ${Math.round(tile(COMMANDER_ROW, FRAMES.commanderRow, vw))}`;
    expect([390, 1366, 1920].map(at)).toEqual(["3 × 97", "7 × 167", "8 × 214"]);
    // Smaller than the card row's tile at every window.
    for (const vw of WINDOWS) {
      expect(tile(COMMANDER_ROW, FRAMES.commanderRow, vw), `${vw}px`).toBeLessThan(tile(CARD_GRID, FRAMES.wide, vw));
    }
  });

  it("a compact tile stays ~150–215 px in the dashboard", () => {
    for (const vw of WINDOWS.filter((vw) => vw >= 1024)) {
      const t = tile(COMPACT_GRID, FRAMES.dashboard, vw);
      expect(t, `${vw}px`).toBeGreaterThanOrEqual(150);
      expect(t, `${vw}px`).toBeLessThanOrEqual(216);
    }
    const at = (vw: number) =>
      `${COMPACT_GRID.columns(FRAMES.dashboard(vw), vw)} × ${Math.round(tile(COMPACT_GRID, FRAMES.dashboard, vw))}`;
    expect([1280, 1366, 1440, 1536, 1680, 1920].map(at)).toEqual([
      "5 × 183",
      "5 × 200",
      "6 × 177",
      "6 × 193",
      "7 × 185",
      "8 × 190",
    ]);
  });
});

describe("the grids' `sizes`, frame by frame, at every window from 320 to 2560 px", () => {
  const exact: Array<[string, string, Grid, (vw: number) => number]> = [
    ["cards on a wide page (CARD_GRID_SIZES)", CARD_GRID_SIZES, CARD_GRID, FRAMES.wide],
    ["cards in the dashboard (DASHBOARD_CARD_GRID_SIZES)", DASHBOARD_CARD_GRID_SIZES, CARD_GRID, FRAMES.dashboard],
    ["compact cards in the dashboard", DASHBOARD_COMPACT_GRID_SIZES, COMPACT_GRID, FRAMES.dashboard],
    ["decks on a wide page (DECK_GRID_SIZES)", DECK_GRID_SIZES, DECK_GRID, FRAMES.wide],
    ["decks in the dashboard (DASHBOARD_DECK_GRID_SIZES)", DASHBOARD_DECK_GRID_SIZES, DECK_GRID, FRAMES.dashboard],
    ["/decks' commander row (COMMANDER_ROW_SIZES)", COMMANDER_ROW_SIZES, COMMANDER_ROW, FRAMES.commanderRow],
  ];
  for (const [name, sizes, grid, frame] of exact) {
    it(`${name}: never less than the tile, and never 12 px more`, () => {
      for (const vw of WINDOWS) {
        const t = tile(grid, frame, vw);
        const asked = sizesAt(sizes, vw);
        expect(asked, `${vw}px`).toBeGreaterThanOrEqual(t - 0.01);
        expect(asked - t, `${vw}px`).toBeLessThan(12);
      }
    });
  }

  // Generous lists: never less — they may ask for more.
  const generous: Array<[string, string, Grid, (vw: number) => number]> = [
    ["a challenge's entries (window grid, standard page)", WINDOW_GRID_SIZES, windowGrid(2, 3, 4, 20), FRAMES.standard],
    ["the card page's related rows (window grid)", WINDOW_GRID_SIZES, windowGrid(2, 4, 4, 20), FRAMES.cardPage],
    ["the card page's top remixes (window grid)", WINDOW_GRID_SIZES, windowGrid(2, 4, 4, 16), FRAMES.cardPage],
    ["Settings' pinned-cards picker (window grid, a readable column at most)", WINDOW_GRID_SIZES, windowGrid(2, 3, 3, 12), FRAMES.readable],
    ["the homepage's strip (card grid, standard page)", WINDOW_GRID_SIZES, CARD_GRID, FRAMES.standard],
    ["the card page's decks (deck grid, its 1152 px frame)", DECK_NARROW_FRAME_SIZES, DECK_GRID, FRAMES.cardPage],
  ];
  for (const [name, sizes, grid, frame] of generous) {
    it(`${name}: never less than the tile`, () => {
      for (const vw of WINDOWS) {
        expect(sizesAt(sizes, vw), `${vw}px`).toBeGreaterThanOrEqual(tile(grid, frame, vw) - 0.01);
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
  const read = (path: string) => readFileSync(path, "utf8");

  it("a file that places a grid class by hand also draws its `@container`", () => {
    const placing = files.filter((path) =>
      /className=\{[^}]*\b(?:CARD_GRID_CLASS|CARD_GRID_COMPACT_CLASS|ROW_GRID_CLASS|DECK_GRID_CLASS|GRID_CLASS\[)/.test(
        read(path),
      ),
    );
    expect(placing.length).toBeGreaterThan(0);
    for (const path of placing) expect(read(path), path).toMatch(/"@container"/);
  });

  it("the wide pages' and the dashboard's grids pass their frame's `sizes`", () => {
    const expectations: Array<[string, RegExp]> = [
      ["app/(marketing)/gallery/gallery-view.tsx", /sizes=\{CARD_GRID_SIZES\}/],
      ["app/(marketing)/gallery/type/[type]/page.tsx", /sizes=\{CARD_GRID_SIZES\}/],
      ["app/(marketing)/gallery/tag/[tag]/page.tsx", /sizes=\{CARD_GRID_SIZES\}/],
      ["components/decks/commander-row.tsx", /sizes: COMMANDER_ROW_SIZES/],
      ["app/(marketing)/profile/[username]/page.tsx", /sizes: CARD_GRID_SIZES/],
      ["app/(app)/feed/page.tsx", /sizes=\{DASHBOARD_CARD_GRID_SIZES\}/],
      ["app/(app)/dashboard/decks/page.tsx", /sizes=\{DASHBOARD_DECK_GRID_SIZES\}/],
      ["components/creator/my-cards-browser.tsx", /sizes=\{GRID_SIZES\[view\]\}/],
      ["components/cards/card-detail-content.tsx", /sizes=\{DECK_NARROW_FRAME_SIZES\}/],
    ];
    for (const [path, pattern] of expectations) expect(read(path), path).toMatch(pattern);
  });
});
