import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CardPreviewData } from "@/components/cards/card-preview";
import { anatomyDefaults, frameAnatomyOf, newCardFrameStyle, normalizeAnatomy, resolveTwoColor } from "@/lib/cards/anatomy";
import { crownKeyFor } from "@/lib/cards/crown";
import { SAGA_CROWN, getFrameProfile } from "@/lib/cards/template-layout";
import { legendaryVariationOf } from "@/lib/creator/legendary-variation";
import { resetFrameAssetCacheForTests } from "@/lib/render/card-frames";
import { renderCardImage, type RenderPreset } from "@/lib/render/card-image";
import { serveStandInFrames, type StandInFrames } from "@/tests/stubs/stand-in-frames";
import type { ColorIdentity, FrameStyle } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 4.6f (owner 2026-11-25): the legendary crown and the two-colour pair
// masters on the SAGA frame — opt-in per card (an ADDITION: no bump, no
// sweep, no badge), on REAL bakes over flat stand-in masters, bands and the
// rail's pieces served from a stubbed bucket:
//   • a stored card — no `crown` / `twoColor` key — bakes byte for byte as
//     with both switches off, and fetches neither the band nor a pair master;
//   • the crown draws its key's band, only inside the band's rows;
//   • a pair with the switch on paints its gold-split pair master (an
//     all-hybrid cost too: no hybrid saga was printed, so the saga has no
//     hybrid dress);
//   • a new saga starts with both switches on.
// ---------------------------------------------------------------------------

const TONES: Record<string, number> = { b: 40, m: 160, c: 100, w: 230, u: 70, wu: 90, gu: 120 };
const CROWN_RGB = [250, 10, 10];
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

type Over = { frameStyle?: Record<string, unknown>; colors?: ColorIdentity[]; cost?: string; supertype?: string | null };
/** A W|U saga in KHM's shape (Niko Defies Destiny's cost). */
function card(over: Over = {}): CardPreviewData {
  return {
    title: "The Tale of the Probe",
    cost: over.cost ?? "{1}{W}{U}",
    cardType: "enchantment",
    supertype: over.supertype === undefined ? "Legendary" : over.supertype,
    subtypes: ["Saga"],
    rarity: "rare",
    colorIdentity: over.colors ?? ["white", "blue"],
    rulesText: "I — Draw a card.\nII — Scry 2.\nIII — Draw a card.",
    flavorText: null,
    power: null,
    toughness: null,
    loyalty: null,
    defense: null,
    artistCredit: "A. Painter",
    artUrl: null,
    artPosition: {},
    frameStyle: { template: "saga", finish: "regular", ...(over.frameStyle ?? {}) },
    setIconUrl: null,
    setIconCode: null,
    backFace: null,
    faceContent: null,
    watermark: null,
  } as unknown as CardPreviewData;
}

let frames: StandInFrames;
beforeAll(async () => {
  const pieces: Record<string, { rgb: number[]; width: number; height: number }> = {
    "/frames/saga/chapter/badge.png": { rgb: [200, 180, 120], width: 118, height: 132 },
    "/frames/saga/chapter/divider.png": { rgb: [60, 60, 60], width: 592, height: 9 },
  };
  for (const key of ["w", "u", "m", "l", "wu", "gu"]) pieces[SAGA_CROWN.assetPathTemplate.replace("{key}", key)] = { rgb: CROWN_RGB, width: 1500, height: 410 };
  frames = await serveStandInFrames(
    Object.entries(TONES).map(([key, tone]) => ({ template: "saga", keys: [key], tone, ...(key === "m" ? { pieces } : {}) })),
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

describe("a saga stored before 4.6f keeps its bake", () => {
  it("a legendary W|U saga with no switch bakes as both switches off, and fetches no band and no pair master", async () => {
    const before = fresh();
    const stored = await bake(card());
    const off = await bake(card({ frameStyle: { crown: false, twoColor: false } }));
    expect(stored.png.equals(off.png)).toBe(true);
    expect(since(before).some((k) => k.startsWith("sagacrown/") || k === "saga/wu.png")).toBe(false);
    // The gold master, as before.
    expect(grey(stored, 30, 1000)).toBe(TONES.m);
    // …and its frame style saves as it was: nothing stamped, nothing dropped.
    const style: FrameStyle = { template: "saga", finish: "regular" };
    expect(normalizeAnatomy(style, "saga", "enchantment")).toBe(style);
  }, 60_000);
});

describe("the crown", () => {
  it("draws the key's band, only inside its rows (0–409)", async () => {
    const before = fresh();
    const on = await bake(card({ colors: ["blue"], cost: "{2}{U}", frameStyle: { crown: true } }));
    expect(since(before)).toContain("sagacrown/u.png");
    const off = await bake(card({ colors: ["blue"], cost: "{2}{U}", frameStyle: { crown: false } }));
    const rows = differingRows(on, off);
    expect(rows.length).toBeGreaterThan(300);
    expect(rows[rows.length - 1]).toBeLessThan(410);
    expect(rgb(on, 750, 50)).toEqual(CROWN_RGB);
  }, 60_000);

  it("is keyed by the master drawn: the colour, gold, the land crown for a colourless card, the pair on a pair master", () => {
    const profile = getFrameProfile("saga");
    const key = (colorIdentity: ColorIdentity[], frameStyle: Record<string, unknown>, cost = "{1}{W}{U}") =>
      crownKeyFor({ colorIdentity, cardType: "enchantment", supertype: "Legendary", cost, frameStyle }, profile);
    expect(key(["blue"], { crown: true })).toBe("u");
    expect(key(["multicolor"], { crown: true })).toBe("m");
    expect(key(["colorless"], { crown: true }, "{3}")).toBe("l");
    expect(key(["white", "blue"], { crown: true, twoColor: true })).toBe("wu");
    // A pair drawn gold wears the gold crown; off, absent or not legendary: none.
    expect(key(["white", "blue"], { crown: true })).toBe("m");
    expect(key(["blue"], { crown: false })).toBeNull();
    expect(key(["blue"], {})).toBeNull();
    expect(crownKeyFor({ colorIdentity: ["blue"], cardType: "enchantment", supertype: null, frameStyle: { crown: true } }, profile)).toBeNull();
  });

  it("a legendary pair wears the pair's band over the pair master", async () => {
    const before = fresh();
    await bake(card({ frameStyle: { twoColor: true, crown: true } }));
    expect(since(before)).toEqual(expect.arrayContaining(["saga/wu.png", "sagacrown/wu.png"]));
  }, 60_000);
});

describe("the two-colour pair masters", () => {
  it("a gold W|U cost paints the gold-split pair master", async () => {
    const before = fresh();
    const r = await bake(card({ supertype: null, frameStyle: { twoColor: true } }));
    expect(since(before)).toContain("saga/wu.png");
    expect(grey(r, 30, 1000)).toBe(TONES.wu);
  }, 60_000);

  it("an all-hybrid cost paints the same gold-split master (no hybrid dress: none printed)", async () => {
    const profile = getFrameProfile("saga");
    const look = resolveTwoColor(profile, { twoColor: true }, { colors: ["white", "blue"], cost: "{W/U}{W/U}{W/U}", cardType: "enchantment" });
    expect(look).toMatchObject({ pair: "wu", dress: "split", masterKey: "wu" });
    const before = fresh();
    const r = await bake(card({ supertype: null, cost: "{W/U}{W/U}{W/U}", frameStyle: { twoColor: true } }));
    expect(since(before)).toContain("saga/wu.png");
    expect(since(before).some((k) => k.startsWith("saga/wu-h"))).toBe(false);
    expect(grey(r, 30, 1000)).toBe(TONES.wu);
  }, 60_000);

  it("a new saga starts with both switches on; the Legendary chip is offered", () => {
    expect(frameAnatomyOf("saga")).toMatchObject({ crown: true, twoColor: ["split"] });
    expect(anatomyDefaults("saga")).toEqual({ crown: true, twoColor: true });
    expect(newCardFrameStyle({ template: "saga", finish: "regular" }, "enchantment")).toEqual({ template: "saga", finish: "regular", crown: true, twoColor: true });
    expect(
      legendaryVariationOf({ template: "saga", cardType: "enchantment", supertype: "Legendary", colorIdentity: ["blue"], crown: true }),
    ).toMatchObject({ available: true, reason: null, selected: true, switchShown: true });
  });
});
