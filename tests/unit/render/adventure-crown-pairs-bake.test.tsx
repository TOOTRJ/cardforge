import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CardPreviewData } from "@/components/cards/card-preview";
import { anatomyDefaults, newCardFrameStyle, normalizeAnatomy, resolveFrameOverlays } from "@/lib/cards/anatomy";
import { crownKeyFor } from "@/lib/cards/crown";
import { ADVENTURE_CROWN, ADVENTURE_PAGE, getFrameProfile } from "@/lib/cards/template-layout";
import { legendaryVariationOf } from "@/lib/creator/legendary-variation";
import { resetFrameAssetCacheForTests } from "@/lib/render/card-frames";
import { renderCardImage, type RenderPreset } from "@/lib/render/card-image";
import { serveStandInFrames, type StandInFrames } from "@/tests/stubs/stand-in-frames";
import type { ColorIdentity, FrameStyle } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 4.6f (owner 2026-11-22): the legendary crown and the two-colour pair
// masters on the ADVENTURE frame — opt-in per card (an ADDITION: no bump, no
// sweep, no badge), on REAL bakes over flat stand-in masters, bands and
// pages served from a stubbed bucket:
//   • a stored card — no `crown` / `twoColor` key — bakes byte for byte as
//     with both switches off, and fetches neither the band nor a pair master;
//   • the crown draws its key's band, only inside the band's rows;
//   • a pair with the switch on paints the pair master of print's dress
//     (gold-split `wu`, hybrid `wu-h` with the grey plate);
//   • with 4.26's page: a spell of the creature's own pair draws no page over
//     its pair master (the master paints the pair's pages — MKM #212); a mono
//     spell still draws its colour's page, another pair the gold page; the
//     Prepare frame, which publishes its pair pages, is unchanged.
// ---------------------------------------------------------------------------

const TONES: Record<string, number> = { b: 40, m: 160, c: 100, w: 230, wu: 70, "wu-h": 200, gu: 90 };
const CROWN_RGB = [250, 10, 10];
const PAGE_RGB = [10, 200, 30];
type Raw = { data: Buffer; w: number; h: number; png: Buffer };

async function bake(card: CardPreviewData, preset: RenderPreset = "hd"): Promise<Raw> {
  const res = await renderCardImage(card, preset, { brandMark: true, watermarkText: null, corners: "round" });
  const png = Buffer.from(await res.arrayBuffer());
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height, png };
}
const grey = (r: Raw, x: number, y: number) => r.data[(y * r.w + x) * 4]!;
const rgb = (r: Raw, x: number, y: number) => [...r.data.subarray((y * r.w + x) * 4, (y * r.w + x) * 4 + 3)];
function differingRows(a: Raw, b: Raw): number[] {
  const rows = new Set<number>();
  for (let i = 0; i < a.data.length; i += 1) if (a.data[i] !== b.data[i]) rows.add(Math.floor(i / 4 / a.w));
  return [...rows].sort((x, y) => x - y);
}

type Over = { frameStyle?: Record<string, unknown>; colors?: ColorIdentity[]; cost?: string; supertype?: string | null; backColors?: string[]; backCost?: string };
/** Kellan, Inquisitive Prodigy // Tail the Suspect (MKM #212), as a W|U card. */
function card(over: Over = {}): CardPreviewData {
  return {
    title: "Kellan, Inquisitive Prodigy",
    cost: over.cost ?? "{2}{W}{U}",
    cardType: "creature",
    supertype: over.supertype === undefined ? "Legendary" : over.supertype,
    subtypes: ["Human", "Faerie", "Detective"],
    rarity: "rare",
    colorIdentity: over.colors ?? ["white", "blue"],
    rulesText: null,
    flavorText: null,
    power: "3",
    toughness: "4",
    loyalty: null,
    defense: null,
    artistCredit: "A. Painter",
    artUrl: null,
    artPosition: {},
    frameStyle: { template: "adventure", finish: "regular", ...(over.frameStyle ?? {}) },
    setIconUrl: null,
    setIconCode: null,
    backFace: {
      title: "Tail the Suspect",
      cost: over.backCost ?? "{W}{U}",
      card_type: "sorcery",
      subtypes: ["Adventure"],
      ...(over.backColors ? { color_identity: over.backColors } : {}),
    },
    faceContent: null,
    watermark: null,
  } as unknown as CardPreviewData;
}

let frames: StandInFrames;
beforeAll(async () => {
  const pieces: Record<string, { rgb: number[]; width: number; height: number }> = {};
  for (const key of ["w", "m", "a", "wu", "gu"]) pieces[ADVENTURE_CROWN.assetPathTemplate.replace("{key}", key)] = { rgb: CROWN_RGB, width: 1500, height: 410 };
  for (const key of ["w", "u", "m"]) pieces[ADVENTURE_PAGE.assetPathTemplate.replace("{key}", key)] = { rgb: PAGE_RGB, width: 682, height: 626 };
  frames = await serveStandInFrames(
    Object.entries(TONES).map(([key, tone]) => ({ template: "adventure", keys: [key], tone, ...(key === "m" ? { pieces } : {}) })),
  );
}, 60_000);
afterAll(() => frames?.restore());
const since = (before: number) => frames.fetched.slice(before);
/** The fetch count after the bake's asset cache is emptied: what the next
 *  bake fetches is everything it draws. */
const fresh = () => {
  resetFrameAssetCacheForTests();
  return frames.fetched.length;
};

describe("an adventure stored before 4.6f keeps its bake", () => {
  it("a legendary W|U card with no switch bakes as both switches off, and fetches no band and no pair master", async () => {
    const before = fresh();
    const stored = await bake(card());
    const off = await bake(card({ frameStyle: { crown: false, twoColor: false } }));
    expect(stored.png.equals(off.png)).toBe(true);
    expect(since(before).some((k) => k.startsWith("adventurecrown/") || k === "adventure/wu.png" || k === "adventure/wu-h.png")).toBe(false);
    // The gold master, as before.
    expect(grey(stored, 30, 1000)).toBe(TONES.m);
    // …and its frame style saves as it was: nothing stamped, nothing dropped.
    const style: FrameStyle = { template: "adventure", finish: "regular" };
    expect(normalizeAnatomy(style, "adventure", "creature")).toBe(style);
  }, 60_000);
});

describe("the crown", () => {
  it("draws the key's band, only inside its rows (0–409)", async () => {
    const before = fresh();
    const on = await bake(card({ colors: ["white"], cost: "{1}{W}", frameStyle: { crown: true } }));
    expect(since(before)).toContain("adventurecrown/w.png");
    const off = await bake(card({ colors: ["white"], cost: "{1}{W}", frameStyle: { crown: false } }));
    const rows = differingRows(on, off);
    expect(rows.length).toBeGreaterThan(300);
    expect(rows[rows.length - 1]).toBeLessThan(410);
    expect(rgb(on, 750, 50)).toEqual(CROWN_RGB);
  }, 60_000);

  it("is keyed by the master drawn: the colour, gold, the artifact silver for a colourless card, the pair on a pair master", () => {
    const profile = getFrameProfile("adventure");
    const key = (colorIdentity: ColorIdentity[], frameStyle: Record<string, unknown>, cost = "{2}{W}{U}") =>
      crownKeyFor({ colorIdentity, cardType: "creature", supertype: "Legendary", cost, frameStyle }, profile);
    expect(key(["white"], { crown: true })).toBe("w");
    expect(key(["multicolor"], { crown: true })).toBe("m");
    expect(key(["colorless"], { crown: true }, "{5}")).toBe("a");
    expect(key(["white", "blue"], { crown: true, twoColor: true })).toBe("wu");
    expect(key(["white", "blue"], { crown: true, twoColor: true }, "{W/U}{W/U}")).toBe("wu");
    // A pair drawn gold wears the gold crown; off, absent or not legendary: none.
    expect(key(["white", "blue"], { crown: true })).toBe("m");
    expect(key(["white"], { crown: false })).toBeNull();
    expect(key(["white"], {})).toBeNull();
    expect(crownKeyFor({ colorIdentity: ["white"], cardType: "creature", supertype: null, frameStyle: { crown: true } }, profile)).toBeNull();
  });

  it("a new adventure starts with both switches on; the Legendary chip is offered", () => {
    expect(anatomyDefaults("adventure")).toEqual({ crown: true, twoColor: true, partColor: true });
    expect(newCardFrameStyle({ template: "adventure", finish: "regular" }, "creature")).toEqual({ template: "adventure", finish: "regular", crown: true, twoColor: true, partColor: true });
    expect(
      legendaryVariationOf({ template: "adventure", cardType: "creature", supertype: "Legendary", colorIdentity: ["white"], crown: true }),
    ).toMatchObject({ available: true, reason: null, selected: true, switchShown: true });
  });
});

describe("the two-colour pair masters", () => {
  it("a gold W|U cost paints the gold-split pair master and its gold plate", async () => {
    const before = fresh();
    const r = await bake(card({ supertype: null, frameStyle: { twoColor: true } }));
    expect(since(before)).toContain("adventure/wu.png");
    expect(since(before)).toContain("m15/pt/m.png");
    expect(grey(r, 30, 1000)).toBe(TONES.wu);
  }, 60_000);

  it("an all-hybrid cost paints the hybrid master and the grey plate", async () => {
    const before = fresh();
    const r = await bake(card({ supertype: null, cost: "{W/U}{W/U}", frameStyle: { twoColor: true } }));
    expect(since(before)).toContain("adventure/wu-h.png");
    expect(since(before)).toContain("m15/pt/c.png");
    expect(grey(r, 30, 1000)).toBe(TONES["wu-h"]);
  }, 60_000);

  it("a legendary pair wears the pair's band over the pair master", async () => {
    const before = fresh();
    await bake(card({ frameStyle: { twoColor: true, crown: true } }));
    expect(since(before)).toEqual(expect.arrayContaining(["adventure/wu.png", "adventurecrown/wu.png"]));
  }, 60_000);
});

describe("beside the spell's page in its own colour (TODO 4.26)", () => {
  const style = (over: Record<string, unknown>) => ({ twoColor: true, partColor: true, ...over });
  const pages = (colors: ColorIdentity[], cost: string, part: { colors: string[]; cost: string } | null, frameStyle: Record<string, unknown>, template = "adventure") =>
    resolveFrameOverlays(getFrameProfile(template), frameStyle, {
      colors,
      cost,
      cardType: "creature",
      supertype: null,
      colorKey: colors.length === 1 ? ({ white: "w", blue: "u", black: "b" } as Record<string, string>)[colors[0]!]! : "m",
      part: part ? { colors: part.colors as ColorIdentity[], cost: part.cost } : null,
    })
      .filter((o) => o.anatomy === "partPage")
      .map((o) => o.key);

  it("a spell of the creature's own pair draws no page over its pair master — either dress", () => {
    expect(pages(["white", "blue"], "{2}{W}{U}", { colors: ["white", "blue"], cost: "{W}{U}" }, style({}))).toEqual([]);
    expect(pages(["white", "blue"], "{2}{W}{U}", { colors: ["white", "blue"], cost: "{W/U}{W/U}" }, style({}))).toEqual([]);
    expect(pages(["white", "blue"], "{W/U}{W/U}", { colors: ["white", "blue"], cost: "{W}{U}" }, style({}))).toEqual([]);
  });

  it("a mono spell draws its colour's page over the pair master; another pair the gold page", () => {
    expect(pages(["white", "blue"], "{2}{W}{U}", { colors: ["white"], cost: "{W}" }, style({}))).toEqual(["w"]);
    expect(pages(["white", "blue"], "{2}{W}{U}", { colors: ["blue", "black"], cost: "{U}{B}" }, style({}))).toEqual(["m"]);
  });

  it("with the two-colour switch off the card is gold, as before: its own pair's spell draws nothing (the gold page IS its page)", () => {
    expect(pages(["white", "blue"], "{2}{W}{U}", { colors: ["white", "blue"], cost: "{W}{U}" }, style({ twoColor: false }))).toEqual([]);
    expect(pages(["white", "blue"], "{2}{W}{U}", { colors: ["white"], cost: "{W}" }, style({ twoColor: false }))).toEqual(["w"]);
  });

  it("the Prepare frame, which publishes its pair pages, is unchanged: a hybrid spell's grey page over the gold-split creature", () => {
    expect(pages(["white", "blue"], "{2}{W}{U}", { colors: ["white", "blue"], cost: "{W/U}{W/U}" }, style({}), "prepare")).toEqual(["wu-h"]);
    expect(pages(["white", "blue"], "{2}{W}{U}", { colors: ["white", "blue"], cost: "{W}{U}" }, style({}), "prepare")).toEqual([]);
  });

  it("on the bake: the same-pair spell's page is not fetched and the card bakes as with the page off; a mono spell's is", async () => {
    let before = fresh();
    const on = await bake(card({ supertype: null, backColors: ["white", "blue"], frameStyle: style({}) }));
    expect(since(before).some((k) => k.startsWith("adventure/page/"))).toBe(false);
    const off = await bake(card({ supertype: null, backColors: ["white", "blue"], frameStyle: style({ partColor: false }) }));
    expect(on.png.equals(off.png)).toBe(true);
    before = fresh();
    const mono = await bake(card({ supertype: null, backColors: ["white"], backCost: "{W}", frameStyle: style({}) }));
    expect(since(before)).toContain("adventure/page/w.png");
    expect(rgb(mono, 700, 1900)).toEqual(PAGE_RGB);
    // The creature's right page stays its pair master's.
    expect(grey(mono, 1000, 1700)).toBe(TONES.wu);
  }, 60_000);
});
