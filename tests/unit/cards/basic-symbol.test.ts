import { describe, expect, it } from "vitest";
import {
  BASIC_SYMBOL_GLYPH_SCALE,
  basicSymbolAssetPath,
  basicSymbolAssetPaths,
  basicSymbolBox,
  basicSymbolFor,
  basicSymbolGlyphSizePct,
} from "@/lib/cards/basic-symbol";
import {
  BASIC_SYMBOL_CC_2022,
  BASIC_SYMBOL_MSE_SOCKET,
  getFrameProfile,
  type BasicSymbolSlot,
} from "@/lib/cards/template-layout";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";

// ---------------------------------------------------------------------------
// The basic-land symbol slot (TODO 3.24): which symbol a face prints in its
// profile's slot, and the one geometry both renderers draw it at.
// ---------------------------------------------------------------------------

const plains = { cardType: "land", supertype: "Basic", subtypes: ["Plains"], title: "Plains", rulesText: null };
const withSlot = { basicSymbol: BASIC_SYMBOL_MSE_SOCKET };

describe("basicSymbolFor", () => {
  it("is null on a profile without a slot — every profile today", () => {
    for (const template of FRAME_TEMPLATE_VALUES) {
      expect(basicSymbolFor(getFrameProfile(template), plains, null), template).toBeNull();
    }
  });

  it("prints a basic's own mana symbol, fully opaque", () => {
    expect(basicSymbolFor(withSlot, plains, null)).toEqual({
      slot: BASIC_SYMBOL_MSE_SOCKET,
      mark: { kind: "mana", key: "w" },
      opacity: 1,
    });
    const wastes = { cardType: "land", supertype: "Basic", subtypes: [], title: "Wastes", rulesText: null };
    expect(basicSymbolFor(withSlot, wastes, null)?.mark).toEqual({ kind: "mana", key: "c" });
  });

  it("is null for anything that is not a basic land (the rules-box watermark stays)", () => {
    const dual = { cardType: "land", supertype: null, subtypes: ["Plains", "Island"], title: "Tundra", rulesText: null };
    const nonbasic = { cardType: "land", supertype: null, subtypes: [], title: "Command Tower", rulesText: "{T}: Add one mana." };
    const creature = { cardType: "creature", supertype: null, subtypes: ["Angel"], title: "Serra Angel", rulesText: "Flying" };
    for (const face of [dual, nonbasic, creature]) {
      expect(basicSymbolFor(withSlot, face, { kind: "mana", key: "w", size: "large" })).toBeNull();
    }
  });

  it("swaps an explicit watermark into the slot: mana changes the symbol, an image is contained", () => {
    expect(basicSymbolFor(withSlot, plains, { kind: "mana", key: "b", size: "large" })?.mark).toEqual({
      kind: "mana",
      key: "b",
    });
    expect(basicSymbolFor(withSlot, plains, { kind: "preset", key: "order-sun", size: "normal" })?.mark).toEqual({
      kind: "preset",
      key: "order-sun",
    });
    const custom = basicSymbolFor(withSlot, plains, { kind: "custom", url: "https://x.test/a.png", opacity: 0.4 });
    expect(custom?.mark).toEqual({ kind: "custom", url: "https://x.test/a.png" });
    // An explicit opacity is honoured; the default is the printed symbol's 1.
    expect(custom?.opacity).toBe(0.4);
  });
});

describe("basicSymbolBox", () => {
  it("is the largest square in the slot, centred — Card Conjurer's 168 px box is already square", () => {
    const box = basicSymbolBox(BASIC_SYMBOL_CC_2022.rect, 7 / 5);
    // 11.2 % × 1500 = 168 px wide; 8.0 % × 2100 = 168 px tall.
    expect(box.widthPct * 15).toBeCloseTo(168, 6);
    expect(box.heightPct * 21).toBeCloseTo(168, 6);
    expect(box.leftPct).toBeCloseTo(BASIC_SYMBOL_CC_2022.rect.leftPct, 9);
    expect(box.topPct).toBeCloseTo(BASIC_SYMBOL_CC_2022.rect.topPct, 9);
  });

  it("shrinks a wide slot to its height and centres it horizontally", () => {
    const rect = { topPct: 80, leftPct: 10, widthPct: 30, heightPct: 10 };
    const box = basicSymbolBox(rect, 7 / 5);
    // 10 % of 2100 = 210 px → 14 % of 1500.
    expect(box.widthPct).toBeCloseTo(14, 9);
    expect(box.heightPct).toBeCloseTo(10, 9);
    expect(box.leftPct + box.widthPct / 2).toBeCloseTo(25, 9);
    expect(box.topPct).toBeCloseTo(80, 9);
  });

  it("sets the glyph at 0.8 of the disc, in card-width units", () => {
    const box = basicSymbolBox(BASIC_SYMBOL_MSE_SOCKET.rect, 7 / 5);
    expect(basicSymbolGlyphSizePct(BASIC_SYMBOL_MSE_SOCKET.rect, 7 / 5)).toBeCloseTo(
      (box.widthPct / 100) * BASIC_SYMBOL_GLYPH_SCALE,
      12,
    );
    expect(BASIC_SYMBOL_GLYPH_SCALE).toBe(0.8);
  });
});

describe("a split type line's size (TextSlot.split)", () => {
  it("splits at the em dash and prints both halves at the smaller of their fits", async () => {
    const { splitTypeLine } = await import("@/lib/cards/card-display");
    const { fitSingleLineSizePct, fitSplitTypeSizePct } = await import("@/lib/cards/render-tiers");
    expect(splitTypeLine("Basic Land — Forest")).toEqual(["Basic Land", "Forest"]);
    expect(splitTypeLine("Basic Snow Land — Island Swamp")).toEqual(["Basic Snow Land", "Island Swamp"]);
    expect(splitTypeLine("Basic Land")).toEqual(["Basic Land", ""]);
    const leftRect = { topPct: 81.96, leftPct: 8.54, widthPct: 12, heightPct: 5.43 };
    const rightRect = { topPct: 81.96, leftPct: 58, widthPct: 28, heightPct: 5.43 };
    const left = fitSingleLineSizePct({ text: "Basic Snow Land", rect: leftRect, baseSizePct: 0.0435 });
    const right = fitSingleLineSizePct({ text: "Forest", rect: rightRect, baseSizePct: 0.0435 });
    // The long left half has to shrink; the short right half doesn't.
    expect(left).toBeLessThan(right);
    expect(
      fitSplitTypeSizePct({ left: "Basic Snow Land", right: "Forest", leftRect, rightRect, baseSizePct: 0.0435 }),
    ).toBe(left);
  });
});

describe("symbol assets", () => {
  const slot: BasicSymbolSlot = { ...BASIC_SYMBOL_CC_2022, assetPathTemplate: "/frames/fullartland/symbol/{symbol}.png" };

  it("resolve per mana key and are listed for the bake's preload", () => {
    expect(basicSymbolAssetPath(slot, "g")).toBe("/frames/fullartland/symbol/g.png");
    const plan = basicSymbolFor({ basicSymbol: slot }, plains, { kind: "mana", key: "u", size: "large" });
    expect(basicSymbolAssetPaths(plan)).toEqual(["/frames/fullartland/symbol/u.png"]);
  });

  it("list nothing without a template, for an image mark, or for style none", () => {
    expect(basicSymbolAssetPaths(basicSymbolFor({ basicSymbol: BASIC_SYMBOL_CC_2022 }, plains, null))).toEqual([]);
    expect(
      basicSymbolAssetPaths(basicSymbolFor({ basicSymbol: slot }, plains, { kind: "preset", key: "order-sun" })),
    ).toEqual([]);
    expect(basicSymbolAssetPaths(basicSymbolFor({ basicSymbol: { ...slot, style: "none" } }, plains, null))).toEqual(
      [],
    );
    expect(basicSymbolAssetPaths(null)).toEqual([]);
  });
});
