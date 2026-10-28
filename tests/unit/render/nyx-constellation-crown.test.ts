import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { CardPreviewData } from "@/components/cards/card-preview";
import { anatomyDefaults, frameAnatomyOf, normalizeAnatomy } from "@/lib/cards/anatomy";
import { CROWN_REFERENCES, crownKeyFor, crownOverlayFor } from "@/lib/cards/crown";
import { M15_CROWN, M15_NYX_CROWN, NYX_CONSTELLATION_CROWN, getFrameProfile } from "@/lib/cards/template-layout";
import { legendaryVariationOf } from "@/lib/creator/legendary-variation";
import manifestJson from "@/lib/frames/frame-manifest.json";
import { resetFrameAssetCacheForTests } from "@/lib/render/card-frames";
import { frameAssetPathsFor, renderCardImage, type RenderPreset } from "@/lib/render/card-image";
import { NYX_CONSTELLATION_CROWN_RECIPE as RECIPE, fadeNyxCrownBand, nyxCrownFade, tintNyxCrownBand } from "@/scripts/lib/nyx-crown.mjs";
import { FRAME_TEMPLATE_VALUES, type FrameStyle } from "@/types/card";

// ---------------------------------------------------------------------------
// The Nyx Constellation frame's legendary crown (template `nyx`; owner
// 2026-10-13). The Theros Beyond Death constellation showcase prints (THB
// #258–268) wear the standard 2015 crown in the card's colour with the Nyx
// starfield strip inside it — the Nyx dress's band. `nyxcrown/<key>` is that
// published band with ONE cut (scripts/lib/nyx-crown.mjs): the arms' last
// rows fade out, so the crown hands over to the MSE masters' narrower rim —
// and ONE tint (owner Round 59): the colourless card's silver `a` toned onto
// the colourless master's bronze, its starfield strip left alone.
//
//   • the recipe, the slot and the PROFILES entry agree, and no other entry
//     reads the band;
//   • the 14 objects are published and their provenance is recorded;
//   • the published bands ARE the parent's pixels with the fade (when local
//     copies at the manifest's sha256 are on disk: FRAMES_BUILD_DIR, else
//     .frames-build; CI fetches them);
//   • an ADDITION: only `frame_style.crown === true` on a Legendary card
//     draws it — absent, off and a nonlegendary card bake byte-identical to
//     the frame as it was; the difference stays inside the band's rows;
//   • the Legendary chip / switch is offered on the template.
// ---------------------------------------------------------------------------

type Entry = { hash: string; sha256: string; bytes: number; width: number; height: number };
const REAL = (manifestJson as { files: Record<string, Entry> }).files;
const BUILD = process.env.FRAMES_BUILD_DIR ? path.resolve(process.env.FRAMES_BUILD_DIR) : path.join(process.cwd(), ".frames-build");
const KEYS = ["w", "u", "b", "r", "g", "m", "a"];

function published(rel: string): Buffer | null {
  const file = path.join(BUILD, rel);
  if (!REAL[rel] || !fs.existsSync(file)) return null;
  const bytes = fs.readFileSync(file);
  return createHash("sha256").update(bytes).digest("hex") === REAL[rel].sha256 ? bytes : null;
}
const bands = Object.fromEntries(KEYS.map((k) => [k, published(`nyxcrown/${k}.png`)]));
const parents = Object.fromEntries(KEYS.map((k) => [k, published(`m15nyxcrown/${k}.png`)]));
const haveBands = KEYS.every((k) => bands[k] !== null);
/** The frame's own masters — in the frames bucket since TODO 4.17f (Card
 *  Conjurer's 'Nyx Showcase'), served beside the bands. */
const MASTER_KEYS = ["w", "u", "b", "r", "g", "m", "c"];
const masters = Object.fromEntries(MASTER_KEYS.map((k) => [k, published(`nyx/${k}.png`)]));
const haveMasters = MASTER_KEYS.every((k) => masters[k] !== null);
const haveParents = KEYS.every((k) => parents[k] !== null);
/** The plain crown band each tinted key is told apart from its strip by. */
const plains = Object.fromEntries(Object.entries(RECIPE.tint).map(([k, t]) => [k, published(`${t.plain}/${k}.png`)]));
const havePlains = Object.values(plains).every((b) => b !== null);

describe("the recipe, the slot and the entry", () => {
  it("names the nyx masters' keys — w u b r g m and the artifact silver — and no pair", () => {
    expect([...RECIPE.keys]).toEqual(KEYS);
    expect([...NYX_CONSTELLATION_CROWN.keys]).toEqual(KEYS);
    expect(RECIPE.folder).toBe("nyxcrown");
    expect(RECIPE.from).toBe("m15nyxcrown");
    // Every key is one the parent band publishes.
    for (const key of KEYS) expect(M15_NYX_CROWN.keys, key).toContain(key);
  });

  it("is the M15 crown's slot (rows 0–409, full width) reading its own folder", () => {
    expect(NYX_CONSTELLATION_CROWN.rect).toEqual(M15_CROWN.rect);
    expect(NYX_CONSTELLATION_CROWN.anatomy).toBe("crown");
    expect(NYX_CONSTELLATION_CROWN.assetPathTemplate).toBe("/frames/nyxcrown/{key}.png");
    expect([RECIPE.width, RECIPE.rows]).toEqual([1500, 410]);
  });

  it("is on the nyx entry only, the colourless key mapped to the artifact silver — the frame's one overlay", () => {
    expect(getFrameProfile("nyx").overlays).toEqual([{ ...NYX_CONSTELLATION_CROWN, keyMap: { c: "a" } }]);
    expect(
      FRAME_TEMPLATE_VALUES.filter((t) => (getFrameProfile(t).overlays ?? []).some((o) => o.assetPathTemplate === NYX_CONSTELLATION_CROWN.assetPathTemplate)),
    ).toEqual(["nyx"]);
    // The crown and nothing else: no pairs, no collector line, no stamp.
    expect(frameAnatomyOf("nyx")).toMatchObject({ crown: true, twoColor: [], collector: false, stamp: false, dfcIcon: false, border: false });
    expect(getFrameProfile("nyx").twoColorMasters).toBeUndefined();
    expect(getFrameProfile("nyx").crownMasters).toBeUndefined();
  });

  it("fades the arms linearly: whole on the first row, gone on the last, never above", () => {
    const { from, to } = RECIPE.fade;
    expect([from, to]).toEqual([372, 408]);
    expect(nyxCrownFade(0)).toBe(1);
    expect(nyxCrownFade(from)).toBe(1);
    expect(nyxCrownFade((from + to) / 2)).toBeCloseTo(0.5, 9);
    expect(nyxCrownFade(to)).toBe(0);
    expect(nyxCrownFade(409)).toBe(0);
    // On a synthetic band: alpha only, the arms only, and it refuses ink
    // anywhere else under the fade's first row.
    const band = Buffer.alloc(1500 * 410 * 4, 0);
    const put = (x: number, y: number, a: number) => band.set([10, 20, 30, a], (y * 1500 + x) * 4);
    put(100, 100, 255);
    put(100, from, 255);
    put(100, 390, 200);
    put(1400, 408, 255);
    const stray = Buffer.from(band);
    stray.set([10, 20, 30, 9], (400 * 1500 + 750) * 4);
    expect(fadeNyxCrownBand(band).changed).toBe(2);
    const at = (x: number, y: number) => [...band.subarray((y * 1500 + x) * 4, (y * 1500 + x) * 4 + 4)];
    expect(at(100, 100)).toEqual([10, 20, 30, 255]);
    expect(at(100, from)).toEqual([10, 20, 30, 255]);
    expect(at(100, 390)).toEqual([10, 20, 30, 100]);
    expect(at(1400, 408)).toEqual([10, 20, 30, 0]);
    expect(() => fadeNyxCrownBand(stray)).toThrow(/outside the arms/);
    expect(() => fadeNyxCrownBand(Buffer.alloc(16))).toThrow(/expected 1500×410/);
  });
});

describe("the colourless card's tint (owner Round 59)", () => {
  const W = 1500;
  const H = 410;
  const band = () => {
    // A plain crown: silver metal everywhere on rows 30–120, a darker bevel
    // row and a highlight row, black above.
    const plain = Buffer.alloc(W * H * 4, 0);
    for (let y = 0; y < 121; y++)
      for (let x = 100; x < 400; x++) {
        const v: [number, number, number] = y < 30 ? [0, 0, 0] : y === 30 ? [112, 113, 113] : y === 31 ? [250, 250, 250] : [223, 225, 225];
        plain.set([...v, 255], (y * W + x) * 4);
      }
    // The Nyx band: the same crown with a dark strip over rows 60–90, its
    // first and last row half over the metal.
    const nyx = Buffer.from(plain);
    for (let y = 60; y <= 90; y++)
      for (let x = 150; x < 350; x++) {
        const edge = y === 60 || y === 90;
        nyx.set(edge ? [127, 128, 133, 255] : [30, 30, 40, 255], (y * W + x) * 4);
      }
    return { plain, nyx };
  };
  const at = (buf: Buffer, x: number, y: number) => [...buf.subarray((y * W + x) * 4, (y * W + x) * 4 + 4)];

  it("tints the artifact silver `a` and no other band, onto the colourless master's rim", () => {
    expect(Object.keys(RECIPE.tint)).toEqual(["a"]);
    expect(RECIPE.tint.a).toEqual({ plain: "m15crown", from: [223, 225, 225], to: [172, 148, 132] });
    // The plain band it reads is a published one, and the key the nyx entry
    // maps the colourless master to.
    expect(M15_CROWN.keys).toContain("a");
    expect(getFrameProfile("nyx").overlays?.[0]?.keyMap).toEqual({ c: "a" });
  });

  it("lands the metal on the target, keeps the hue of the bevel, black and alpha — and leaves the strip alone", () => {
    const { plain, nyx } = band();
    const { out, strip, edged, changed } = tintNyxCrownBand(nyx, plain, RECIPE.tint.a);
    expect(strip).toBe(200 * 31);
    // Metal: `from` lands on `to` exactly.
    expect(at(out, 120, 50)).toEqual([172, 148, 132, 255]);
    // A darker bevel pixel takes the same gains (the same hue, darker)…
    expect(at(out, 120, 30)).toEqual([Math.round((112 * 172) / 223), Math.round((113 * 148) / 225), Math.round((113 * 132) / 225), 255]);
    // …a highlight keeps its lightness order and is LESS coloured than the
    // metal (the colour part of the gain fades toward white): never the
    // per-channel gain's 193 / 164 / 147.
    const [r, g, b] = at(out, 120, 31);
    expect(r).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(b);
    expect(r - b).toBeLessThan(172 - 132);
    expect(0.2126 * r + 0.7152 * g + 0.0722 * b).toBeGreaterThan(0.2126 * 172 + 0.7152 * 148 + 0.0722 * 132);
    // Black stays black; nothing transparent is painted.
    expect(at(out, 120, 10)).toEqual([0, 0, 0, 255]);
    expect(at(out, 50, 50)).toEqual([0, 0, 0, 0]);
    // The strip's inside: the parent's bytes.
    for (let y = 63; y <= 87; y += 4) expect(at(out, 250, y), `row ${y}`).toEqual([30, 30, 40, 255]);
    // Its edge rows are half crown: they take about half the metal's move.
    const edge = at(out, 250, 60);
    expect(edge[0]).toBeGreaterThan(127 - 30);
    expect(edge[0]).toBeLessThan(127);
    expect(edge[2]).toBeLessThan(edge[0]);
    expect(edged).toBeGreaterThan(0);
    expect(changed).toBeGreaterThan(edged);
    // Alpha: never.
    for (let i = 3; i < out.length; i += 4) if (out[i] !== nyx[i]) throw new Error(`alpha moved at ${i}`);
  });

  it("refuses a band with no strip, or one that differs from its plain crown outside the strip's rows", () => {
    const { plain, nyx } = band();
    expect(() => tintNyxCrownBand(plain, plain, RECIPE.tint.a)).toThrow(/no starfield strip/);
    const stray = Buffer.from(nyx);
    stray.set([1, 2, 3, 255], (200 * W + 300) * 4);
    expect(() => tintNyxCrownBand(stray, plain, RECIPE.tint.a)).toThrow(/outside the strip's rows/);
    expect(() => tintNyxCrownBand(Buffer.alloc(16), plain, RECIPE.tint.a)).toThrow(/expected two 1500×410/);
  });
});

describe("published to the frames bucket", () => {
  it("lists every key, PNG and WebP, at 1500 × 410 — and nothing else under the folder", () => {
    for (const key of KEYS) {
      for (const ext of ["png", "webp"]) {
        const entry = REAL[`nyxcrown/${key}.${ext}`];
        expect(entry, `nyxcrown/${key}.${ext}`).toBeDefined();
        expect([entry.width, entry.height], `nyxcrown/${key}.${ext}`).toEqual([1500, 410]);
      }
    }
    expect(Object.keys(REAL).filter((k) => k.startsWith("nyxcrown/")).length).toBe(KEYS.length * 2);
  });

  it("records its provenance: PipGlyph's own cut of the published Nyx crown bands, no commit of its own", () => {
    const provenance = JSON.parse(fs.readFileSync("lib/cards/frame-sources.json", "utf8")).nyxcrown;
    expect(provenance).toMatchObject({
      source: "pipglyph",
      converter: "scripts/build-nyx-crown.mjs",
      kind: "overlay",
      sourceFiles: [...KEYS.map((k) => `m15nyxcrown/${k}.png`), "m15crown/a.png"].sort(),
    });
    expect(provenance.commit).toBeUndefined();
    expect(provenance.output).toMatch(/^1500x410 overlay band: /);
    expect(Object.keys(provenance.colors)).toEqual(KEYS);
    for (const key of KEYS) {
      // Each band names the parent it was cut from, at the sha the manifest
      // lists for it today.
      expect(provenance.colors[key][0], key).toBe(`m15nyxcrown/${key}.png (published, sha256 ${REAL[`m15nyxcrown/${key}.png`].sha256.slice(0, 12)})`);
      expect(provenance.colors[key][1], key).toMatch(/^alpha × \(1 − t\) on rows 372–408/);
      // Only the tinted band says a third thing.
      expect(provenance.colors[key].length, key).toBe(key === "a" ? 3 : 2);
    }
    expect(provenance.colors.a[2]).toContain(`m15crown/a.png (published, sha256 ${REAL["m15crown/a.png"].sha256.slice(0, 12)})`);
    expect(provenance.colors.a[2]).toMatch(/^metal toned 223, 225, 225 → 172, 148, 132 /);
  });

  it("has a crowned print to be judged against in every colour that printed one", () => {
    expect(Object.keys(CROWN_REFERENCES.nyx ?? {})).toEqual(["w", "u", "b", "r", "g", "m"]);
    for (const ref of Object.values(CROWN_REFERENCES.nyx ?? {})) expect(ref?.set).toBe("thb");
  });

  it.skipIf(!haveBands || !haveParents || !havePlains)("each published band is its parent's pixels with the arms faded — the colourless one toned first (set FRAMES_BUILD_DIR if skipped)", async () => {
    const raw = async (bytes: Buffer) => (await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true })).data;
    for (const key of KEYS) {
      const [band, parent] = [await raw(bands[key]!), await raw(parents[key]!)];
      const tint = (RECIPE.tint as Record<string, (typeof RECIPE.tint)["a"]>)[key] ?? null;
      const plain = tint ? await raw(plains[key]!) : null;
      const toned = tint ? tintNyxCrownBand(parent, plain!, tint).out : parent;
      const want = Buffer.from(toned);
      fadeNyxCrownBand(want);
      expect(band.equals(want), key).toBe(true);
      // Above the fade it is the (toned) parent byte for byte; its last rows
      // are clear.
      const head = (RECIPE.fade.from + 1) * 1500 * 4;
      expect(band.subarray(0, head).equals(toned.subarray(0, head)), key).toBe(true);
      for (let i = RECIPE.fade.to * 1500 * 4 + 3; i < band.length; i += 4) expect(band[i]).toBe(0);
      if (!tint) continue;
      // The tinted band: the parent's alpha above the fade, the master's
      // bronze on its arm (not the silver), and the parent's starfield —
      // every strip pixel more than the edge's reach from metal — untouched.
      for (let i = 3; i < head; i += 4) if (band[i] !== parent[i]) throw new Error(`${key}: alpha moved at ${i}`);
      const px = (buf: Buffer, x: number, y: number) => [...buf.subarray((y * 1500 + x) * 4, (y * 1500 + x) * 4 + 3)];
      expect(px(parent, 100, 300)).toEqual([223, 225, 225]);
      expect(px(band, 100, 300)).toEqual([172, 148, 132]);
      const differs = (x: number, y: number) => {
        const o = (y * 1500 + x) * 4;
        return parent[o] !== plain![o] || parent[o + 1] !== plain![o + 1] || parent[o + 2] !== plain![o + 2] || parent[o + 3] !== plain![o + 3];
      };
      let inside = 0;
      const R = RECIPE.edge.reach;
      for (let y = RECIPE.stripRows[0]; y <= RECIPE.stripRows[1]; y++) {
        for (let x = R; x < 1500 - R; x++) {
          let deep = true;
          for (let dy = -R; dy <= R && deep; dy++) for (let dx = -R; dx <= R && deep; dx++) if (!differs(x + dx, y + dy)) deep = false;
          if (!deep) continue;
          inside++;
          expect(px(band, x, y), `${x},${y}`).toEqual(px(parent, x, y));
        }
      }
      expect(inside).toBeGreaterThan(15_000);
    }
  });
});

describe("who is offered it", () => {
  const legendary = { template: "nyx", cardType: "creature", supertype: "Legendary Enchantment", colorIdentity: ["white"] as const, crown: true };

  it("a save keeps the switch on nyx, and a new card starts with it on", () => {
    expect(anatomyDefaults("nyx")).toEqual({ crown: true });
    expect(normalizeAnatomy({ template: "nyx", finish: "regular", crown: true }, "nyx", "creature")).toEqual({ template: "nyx", finish: "regular", crown: true });
    // A stored card names no switch: the same object back, nothing stamped.
    const stored: FrameStyle = { template: "nyx", finish: "regular" };
    expect(normalizeAnatomy(stored, "nyx", "creature")).toBe(stored);
  });

  it("the Legendary chip and the switch are offered; a card that is not legendary is offered the chip, unselected", () => {
    expect(legendaryVariationOf(legendary)).toMatchObject({ available: true, reason: null, selected: true, switchShown: true, addsWordTo: null });
    expect(legendaryVariationOf({ ...legendary, crown: false })).toMatchObject({ available: true, selected: false, switchShown: true });
    expect(legendaryVariationOf({ ...legendary, supertype: "Enchantment" })).toMatchObject({ available: true, selected: false, switchShown: false, addsWordTo: "front" });
  });

  it("the key is the master drawn: the colour, gold for a pair or three colours, the silver for a colourless card", () => {
    const profile = getFrameProfile("nyx");
    const card = (colorIdentity: CardPreviewData["colorIdentity"], twoColor = false) => ({
      colorIdentity,
      cardType: "creature",
      supertype: "Legendary Enchantment",
      frameStyle: { crown: true, ...(twoColor ? { twoColor: true } : {}) },
    });
    const letters = { white: "w", blue: "u", black: "b", red: "r", green: "g" } as const;
    for (const [colour, key] of Object.entries(letters)) expect(crownKeyFor(card([colour as never]), profile), colour).toBe(key);
    expect(crownKeyFor(card(["red", "green"]), profile)).toBe("m");
    expect(crownKeyFor(card(["red", "green"], true), profile)).toBe("m");
    expect(crownKeyFor(card(["multicolor"]), profile)).toBe("m");
    expect(crownKeyFor(card(["colorless"]), profile)).toBe("a");
    expect(crownOverlayFor(card(["colorless"]), profile)?.path).toBe("/frames/nyxcrown/a.png");
    // Off, absent, not legendary, a planeswalker: nothing.
    expect(crownKeyFor({ ...card(["white"]), frameStyle: { crown: false } }, profile)).toBeNull();
    expect(crownKeyFor({ ...card(["white"]), frameStyle: {} }, profile)).toBeNull();
    expect(crownKeyFor({ ...card(["white"]), supertype: "Enchantment" }, profile)).toBeNull();
    expect(crownKeyFor({ ...card(["white"]), cardType: "planeswalker" }, profile)).toBeNull();
  });
});

// ---- the bake ---------------------------------------------------------------
const ORIGIN = "https://frames.test";
let artUrl = "";
let restore: () => void = () => {};
const fetched: string[] = [];

beforeAll(async () => {
  if (!haveBands || !haveMasters) return;
  const art = await sharp({ create: { width: 1500, height: 1100, channels: 4, background: { r: 40, g: 160, b: 200, alpha: 1 } } }).png().toBuffer();
  artUrl = `data:image/png;base64,${art.toString("base64")}`;
  const { frameObjectKey, setFrameStorageForTests } = await import("@/lib/frames/frame-url");
  const files = {
    ...Object.fromEntries(KEYS.map((k) => [`nyxcrown/${k}.png`, bands[k]!])),
    ...Object.fromEntries(MASTER_KEYS.map((k) => [`nyx/${k}.png`, masters[k]!])),
  };
  const manifest = { version: 1 as const, bucket: "frames", files: Object.fromEntries(Object.keys(files).map((key) => [key, REAL[key]])) };
  const byUrl = new Map(Object.entries(files).map(([key, buf]) => [`${ORIGIN}/${frameObjectKey(key, REAL[key].hash)}`, [key, buf] as const]));
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      const hit = byUrl.get(String(input));
      if (!hit) throw new Error(`unexpected fetch: ${input}`);
      fetched.push(hit[0]);
      return new Response(new Uint8Array(hit[1]), { status: 200, headers: { "content-type": "image/png" } });
    }),
  );
  restore = setFrameStorageForTests({ manifest, origin: ORIGIN });
  resetFrameAssetCacheForTests();
}, 60_000);

afterAll(() => {
  restore();
  vi.unstubAllGlobals();
});

function card(over: Partial<CardPreviewData> = {}): CardPreviewData {
  return {
    title: "Heliod, Sun-Crowned",
    cost: "{2}{W}",
    cardType: "creature",
    supertype: "Legendary Enchantment",
    subtypes: ["God"],
    rarity: "mythic",
    colorIdentity: ["white"],
    rulesText: "Indestructible\nWhenever you gain life, put a +1/+1 counter on target creature or enchantment you control.",
    flavorText: null,
    power: "5",
    toughness: "5",
    loyalty: null,
    defense: null,
    artistCredit: "Probe",
    artUrl,
    artPosition: {},
    frameStyle: { template: "nyx", finish: "regular", crown: true },
    setIconUrl: null,
    setIconCode: null,
    backFace: null,
    faceContent: null,
    watermark: null,
    ...over,
  } as CardPreviewData;
}

type Raw = { data: Buffer; width: number; height: number };
async function bake(data: CardPreviewData, preset: RenderPreset): Promise<Raw> {
  const res = await renderCardImage({ ...data, artUrl }, preset, { brandMark: false, watermarkText: null, corners: "round" });
  const { data: px, info } = await sharp(Buffer.from(await res.arrayBuffer())).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: px, width: info.width, height: info.height };
}
/** The columns of the pixels that differ in rows [0, toRow). */
function differingColumnsAbove(a: Raw, b: Raw, toRow: number): number[] {
  const cols = new Set<number>();
  for (let i = 0; i < toRow * a.width * 4; i += 1) if (a.data[i] !== b.data[i]) cols.add(Math.floor(i / 4) % a.width);
  return [...cols].sort((x, y) => x - y);
}
function differingRows(a: Raw, b: Raw): number[] {
  const rows = new Set<number>();
  for (let i = 0; i < a.data.length; i += 1) if (a.data[i] !== b.data[i]) rows.add(Math.floor(i / 4 / a.width));
  return [...rows].sort((x, y) => x - y);
}
const plainStyle = { template: "nyx", finish: "regular" } as CardPreviewData["frameStyle"];

/** The bands a bake fetched (the masters it fetches too are not counted). */
const bandsFetched = () => fetched.filter((key) => key.startsWith("nyxcrown/"));

describe.skipIf(!haveBands || !haveMasters)("the constellation crown in the bake — the real bands and masters (set FRAMES_BUILD_DIR if skipped)", () => {
  const cases: Array<[string, Partial<CardPreviewData>, string]> = [
    ["legendary white", {}, "w"],
    ["legendary green", { colorIdentity: ["green"], cost: "{3}{G}" }, "g"],
    ["legendary red-green pair (gold: no pair masters)", { colorIdentity: ["red", "green"], cost: "{1}{R}{G}" }, "m"],
    ["legendary colourless (the artifact silver)", { colorIdentity: ["colorless"], cost: "{4}" }, "a"],
  ];

  it.each(cases)("%s: warms and draws the %s band, inside the band's rows only", async (_label, over, key) => {
    const crowned = card(over);
    expect(frameAssetPathsFor(crowned)).toContain(`/frames/nyxcrown/${key}.png`);
    resetFrameAssetCacheForTests();
    fetched.length = 0;
    const [a, b] = [await bake(crowned, "default"), await bake({ ...crowned, frameStyle: { ...crowned.frameStyle, crown: false } }, "default")];
    expect(bandsFetched()).toEqual([`nyxcrown/${key}.png`]);
    const rows = differingRows(a, b);
    expect(rows.length).toBeGreaterThan(100);
    // The band is rows 0–409 of 2100; its last painted row is 407 (the fade
    // ends on 408): 204 of the 1050-row bake.
    expect(rows.at(-1)!).toBeLessThanOrEqual(Math.ceil((RECIPE.fade.to / 2100) * a.height));
    // The crown's top edge: the first rows of the card's black border stay —
    // but for the card corner's anti-aliased arc, where the band's cut alpha
    // lays over the master's (Card Conjurer's masters since 4.17f, as on
    // m15 + m15crown: 78 px of the HD arc, black over black).
    const corner = Math.ceil(a.width * 0.06);
    for (const x of differingColumnsAbove(a, b, 10)) expect(x < corner || x >= a.width - corner, `column ${x}`).toBe(true);
  }, 120_000);

  it("at HD the arms end before row 408 and the name, type line, rules and art below move 0 px", async () => {
    const crowned = card();
    const [a, b] = [await bake(crowned, "hd"), await bake({ ...crowned, frameStyle: { ...crowned.frameStyle, crown: false } }, "hd")];
    const rows = differingRows(a, b);
    expect(rows.at(-1)!).toBeLessThan(RECIPE.fade.to);
    expect(rows.at(-1)!).toBeGreaterThan(RECIPE.fade.from);
  }, 150_000);

  it("absent, off, a nonlegendary card and a planeswalker type bake byte-identical to the frame as it was, and fetch no band", async () => {
    resetFrameAssetCacheForTests();
    fetched.length = 0;
    const plain = await bake(card({ frameStyle: plainStyle }), "default");
    expect(differingRows(await bake(card({ frameStyle: { ...plainStyle, crown: false } as CardPreviewData["frameStyle"] }), "default"), plain)).toEqual([]);
    const notLegendary = { supertype: "Enchantment" };
    expect(differingRows(await bake(card(notLegendary), "default"), await bake(card({ ...notLegendary, frameStyle: plainStyle }), "default"))).toEqual([]);
    const walker = { cardType: "planeswalker" as const, loyalty: "4", power: null, toughness: null };
    expect(differingRows(await bake(card(walker), "default"), await bake(card({ ...walker, frameStyle: plainStyle }), "default"))).toEqual([]);
    expect(bandsFetched()).toEqual([]);
    for (const data of [card({ frameStyle: plainStyle }), card(notLegendary), card(walker)]) {
      expect(frameAssetPathsFor(data).some((p) => p.includes("nyxcrown/"))).toBe(false);
    }
  }, 180_000);
});
