import { describe, expect, it } from "vitest";
import type { KitItem } from "@/lib/tools/token-kit/collect";
import type { KitFace, KitFrame, KitItemState } from "@/lib/tools/token-kit/model";
import {
  initialItemState,
  kitCountsLine,
  kitPrintTokens,
  kitSlug,
  kitSummary,
  makersLine,
  mergeKitItems,
  storedKitItems,
} from "@/lib/tools/token-kit/workspace";

// ---------------------------------------------------------------------------
// The Token Kit page's state: a token's starting choices, what prints, the
// summary line.
// ---------------------------------------------------------------------------

const face = (title: string, kind: KitFace["kind"] = "token", typeWords: string | null = "Creature"): KitFace => ({
  kind,
  title,
  typeWords,
  subtypes: [],
  colors: ["white"],
  rulesText: null,
  flavorText: null,
  power: null,
  toughness: null,
});

const item = (key: string, f: KitFace, suggested = 2): KitItem => ({ key, face: f, makers: ["A"], scryfallId: null, suggested, why: [] });
const on = (copies: number): KitItemState => ({ include: true, copies, artUrl: null, artistCredit: null, artPosition: null });
const drawn: KitFrame = { ok: true, template: "m20token", design: "fullart", standIn: false };

describe("initialItemState", () => {
  it("takes the saved choices, else the suggestion; a dungeon starts out of the kit", () => {
    expect(initialItemState(item("a", face("Spirit"), 4), undefined)).toEqual(on(4));
    expect(initialItemState(item("a", face("Spirit")), { ...on(30), artUrl: "x" })).toMatchObject({ copies: 24, artUrl: "x" });
    expect(initialItemState(item("d", face("Undercity", "helper", "Dungeon")), undefined).include).toBe(false);
  });
});

describe("kitPrintTokens", () => {
  const items = [item("a", face("Spirit")), item("b", face("Spirit")), item("c", face("Treasure")), item("d", face("Gone"))];
  const states = { a: on(3), b: on(2), c: { ...on(5), include: false }, d: on(1) };
  const frames: Record<string, KitFrame> = { a: drawn, b: drawn, c: drawn, d: { ok: false, reason: "unverified" } };

  it("prints only included, drawable tokens, each slug its own", () => {
    expect(kitPrintTokens(items, states, frames, { sheets: true })).toEqual([
      { key: "a", title: "Spirit", slug: "spirit", copies: 3 },
      { key: "b", title: "Spirit", slug: "spirit-2", copies: 2 },
    ]);
  });

  it("one copy each off a sheet", () => {
    expect(kitPrintTokens(items, states, frames, { sheets: false }).map((t) => t.copies)).toEqual([1, 1]);
  });

  it("budgets the copies to the export's 150 cards", () => {
    const many = Array.from({ length: 10 }, (_, i) => item(`k${i}`, face(`T${i}`)));
    const all = Object.fromEntries(many.map((m) => [m.key, on(24)]));
    const allFrames = Object.fromEntries(many.map((m) => [m.key, drawn]));
    const printed = kitPrintTokens(many, all, allFrames, { sheets: true });
    expect(printed.reduce((n, t) => n + t.copies, 0)).toBe(150);
  });
});

describe("kitSummary / kitCountsLine", () => {
  it("counts kinds, what prints and what isn't drawn", () => {
    const items = [item("a", face("Spirit")), item("e", face("Chandra Emblem", "emblem", null)), item("h", face("The Monarch", "helper", null))];
    const summary = kitSummary(items, { a: on(3), e: on(1), h: { ...on(1), include: false } }, { a: drawn, e: drawn, h: { ok: false, reason: "unverified" } });
    expect(summary).toEqual({ tokens: 1, emblems: 1, helpers: 1, included: 2, cards: 4, undrawable: 1 });
    expect(kitCountsLine(summary)).toBe("1 token · 1 emblem · 1 helper card");
    expect(kitCountsLine({ tokens: 3, emblems: 0, helpers: 2 })).toBe("3 tokens · 2 helper cards");
  });
});

describe("kitSlug / makersLine", () => {
  it("slugs names for files", () => {
    expect(kitSlug("Éowyn's Kit!")).toBe("eowyn-s-kit");
    expect(kitSlug("!!!")).toBe("token");
  });
  it("names the makers, then a count", () => {
    expect(makersLine(["A"])).toBe("A");
    expect(makersLine(["A", "B", "C"])).toBe("A, B and C");
    expect(makersLine(["A", "B", "C", "D"])).toBe("A, B and 2 more");
  });
});

describe("storedKitItems / mergeKitItems (a save never forgets a token it wasn't shown)", () => {
  it("reads only the states that still parse", () => {
    expect(storedKitItems(null)).toEqual({});
    expect(storedKitItems([on(1)])).toEqual({});
    expect(storedKitItems({ a: on(2), b: { include: "yes" }, c: { ...on(30) } })).toEqual({ a: on(2) });
  });

  it("keeps the stored states of tokens this build didn't show; the build's win", () => {
    const stored = { a: on(2), gone: { ...on(5), artUrl: "https://x/card-art/u/ai-1.png" } };
    const merged = mergeKitItems(stored, { a: on(4), b: on(1) }, 300);
    expect(merged).toEqual({ a: on(4), b: on(1), gone: stored.gone });
  });

  it("past the cap the build's states stay whole and pictures are kept first", () => {
    const stored = { x: on(1), y: { ...on(1), artUrl: "https://x/card-art/u/up.png" }, z: on(1) };
    const merged = mergeKitItems(stored, { a: on(1), b: on(1) }, 3);
    expect(Object.keys(merged).sort()).toEqual(["a", "b", "y"]);
  });
});
