import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import manifestJson from "@/lib/frames/frame-manifest.json";
import provenanceJson from "@/lib/cards/frame-sources.json";
import {
  CC_COMMIT,
  CC_TEMPLATES,
  MDFC_STRIP_BOX,
  MDFC_STRIP_CUTS,
  MDFC_STRIP_ERODE_PX,
  MDFC_STRIP_SNAP_PX,
  cutStripRider,
  describeStripRider,
  insideMaskEroded,
  snapToBlocks,
  stripRiderFindings,
  stripRiderInterior,
  stripRiderKeys,
  stripRiderSourceOf,
} from "@/scripts/lib/cc-frames.mjs";
import {
  MDFC_FLIPSIDE_FRONT,
  MDFC_STRIP_RIDER_BACK,
  MDFC_STRIP_RIDER_FRONT,
  MDFC_STRIP_RIDER_LAND_BACK,
  MDFC_STRIP_RIDER_LAND_FRONT,
  getFrameProfile,
  type FrameOverlaySlot,
} from "@/lib/cards/template-layout";
import { mdfcStripOwnKey, resolveFrameOverlays, resolveTwoColor } from "@/lib/cards/anatomy";
import { backPreviewData, frontPreviewData, stripKeyOf } from "@/lib/cards/faces";
import type { CardPreviewData } from "@/components/cards/card-preview";
import { FRAME_TEMPLATE_VALUES, type CardBackFace } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 5.1c — the flipside strip rider in the other face's colour. On a
// two-colour modal card the prints paint the strip in the colour of the face
// it DESCRIBES (STX #147's green front carries a blue strip, the pathways'
// fronts their back's colour, KHM #114's front the B/R back's gold); the
// masters paint their own. Each modal template publishes its masters' tabs
// as pieces (strip/<key>.png: CC's Flipside mask's interior eroded 1 px and
// snapped to the HD grid's 2 × 2 px blocks, the tab's own pixels), and both
// renderers draw the OTHER face's piece over the strip the master paints,
// only when it differs from the master's own.
//   • the recipe: four templates, their own keys plus `l` on the spell
//     bodies (the grey land modal's tab), an even box at the mask's bbox,
//     the erosion and the snap;
//   • the cut on a synthetic master and mask: alpha 0 / 255, the eroded
//     and block-snapped interior, the master's colour — and the findings
//     that refuse a wrong piece;
//   • the key rule (faces.ts stripKeyOf): mono = its letter, a two-colour
//     spell = gold, a two-colour or colourless land = the land grey, a
//     hybrid-dressed front = the land grey, a colourless spell = `c`;
//   • what the profiles declare, and what the resolver draws: nothing on a
//     mono card, a transform body or a plain frame; the other face's key on
//     a two-colour card; the split pair's own strip is gold, the hybrid's
//     none;
//   • the published pieces (where a copy at the manifest's sha256 is on disk
//     — FRAMES_BUILD_DIR, else .frames-build; CI fetches them, a missing one
//     FAILS there): every key, PNG + WebP at the box's size; each piece the
//     master's own pixels (0 px differ in colour, alpha binary, nothing
//     outside the snapped mask) — the base-tone identity; a piece drawn over
//     its own master through the rasteriser the bake uses (sharp / librsvg,
//     the <image> Satori emits) changes 0 px at HD AND at the 750 bake (the
//     block snap: the 2:1 resample reads one whole block per pixel) — so a
//     mono card's rider, skipped as built, could as well be drawn (the
//     owner's call); with the Card Conjurer cache, a fresh cut reproduces
//     the published piece byte for byte.
// ---------------------------------------------------------------------------

const manifest = manifestJson as { files: Record<string, { sha256: string; width: number; height: number; bytes: number }> };
const provenance = provenanceJson as unknown as Record<string, { strip?: { mask: string; box: typeof MDFC_STRIP_BOX; erodePx: number; snapPx: number; keys: string[]; sources: Record<string, string>; colors: Record<string, string[]> }; notes: string[] }>;
const BUILD = process.env.FRAMES_BUILD_DIR ? path.resolve(process.env.FRAMES_BUILD_DIR) : path.join(process.cwd(), ".frames-build");
const STRICT = Boolean(process.env.CI && process.env.FRAMES_BUILD_DIR);
const CC_CACHE = process.env.CC_CACHE ?? path.join(os.homedir(), ".cache", "pipglyph-cc", CC_COMMIT);
const W = 1500;
const H = 2100;

const STRIP_TEMPLATES = ["m15mdfcfront", "m15mdfcback", "m15mdfclandfront", "m15mdfclandback"] as const;
const SLOT_OF: Record<(typeof STRIP_TEMPLATES)[number], FrameOverlaySlot> = {
  m15mdfcfront: MDFC_STRIP_RIDER_FRONT,
  m15mdfcback: MDFC_STRIP_RIDER_BACK,
  m15mdfclandfront: MDFC_STRIP_RIDER_LAND_FRONT,
  m15mdfclandback: MDFC_STRIP_RIDER_LAND_BACK,
};

function onDisk(rel: string): string | null {
  const entry = manifest.files[rel];
  if (!entry) throw new Error(`the manifest has no ${rel}`);
  const file = path.join(BUILD, rel);
  if (!fs.existsSync(file)) return null;
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex") === entry.sha256 ? file : null;
}
async function rgba(file: string) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
}
type Img = Awaited<ReturnType<typeof rgba>>;
async function maskAt(file: string, width: number, height: number): Promise<Buffer> {
  // The importer's own rasterisation (scripts/import-cc-frames.mjs rgba).
  return (await sharp(file, { density: 300 }).resize(width, height, { fit: "fill", kernel: "lanczos3" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true })).data;
}

// A synthetic master and mask for the cut's own tests: a 40 × 24 card with
// a "tab" (a 20 × 10 rectangle plus a 3-px chevron tip) whose mask is 255
// inside, with an anti-aliased rim of 128 round it.
const S = { w: 40, h: 24 };
function syntheticMask(): Buffer {
  const m = Buffer.alloc(S.w * S.h * 4);
  const inside = (x: number, y: number) => (x >= 4 && x < 24 && y >= 6 && y < 16) || (x >= 24 && x < 27 && y >= 8 && y < 14);
  for (let y = 0; y < S.h; y += 1) {
    for (let x = 0; x < S.w; x += 1) {
      const o = (y * S.w + x) * 4;
      const rim = !inside(x, y) && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => inside(x + dx, y + dy));
      m[o + 3] = inside(x, y) ? 255 : rim ? 128 : 0;
    }
  }
  return m;
}
function syntheticMaster(): Buffer {
  const d = Buffer.alloc(S.w * S.h * 4);
  for (let y = 0; y < S.h; y += 1) {
    for (let x = 0; x < S.w; x += 1) {
      const o = (y * S.w + x) * 4;
      d[o] = (x * 7 + y * 3) & 255;
      d[o + 1] = (x * 5 + y * 11) & 255;
      d[o + 2] = (x * 13 + y) & 255;
      d[o + 3] = 255;
    }
  }
  return d;
}

describe("the strip rider's recipe (scripts/lib/cc-frames.mjs MDFC_STRIP_CUTS)", () => {
  it("four templates cut their own masters' tabs through CC's Flipside mask, eroded 1 px and snapped to 2 × 2 blocks, into an even box at the mask's bbox; the spell bodies add `l` from the land pair's grey c", () => {
    expect(Object.keys(MDFC_STRIP_CUTS)).toEqual([...STRIP_TEMPLATES]);
    expect(MDFC_STRIP_BOX).toEqual({ x: 44, y: 1866, width: 658, height: 90 });
    for (const v of Object.values(MDFC_STRIP_BOX)) expect(v % 2, "even: 1:1 at HD, 2:1 at the 750 bake — and the blocks stay aligned").toBe(0);
    expect(MDFC_STRIP_ERODE_PX).toBe(1);
    expect(MDFC_STRIP_SNAP_PX).toBe(2);
    for (const t of STRIP_TEMPLATES) {
      const spec = MDFC_STRIP_CUTS[t];
      expect(spec.mask).toBe("img/frames/modal/regular/reminder.svg");
      expect(spec.box).toEqual(MDFC_STRIP_BOX);
      expect(spec.erode).toBe(MDFC_STRIP_ERODE_PX);
      expect(spec.snap).toBe(MDFC_STRIP_SNAP_PX);
      expect((CC_TEMPLATES as Record<string, { strip?: unknown }>)[t].strip, `${t} declares its strip spec`).toBe(spec);
    }
    expect(stripRiderKeys(MDFC_STRIP_CUTS.m15mdfcfront)).toEqual(["w", "u", "b", "r", "g", "m", "a", "l"]);
    expect(stripRiderKeys(MDFC_STRIP_CUTS.m15mdfcback)).toEqual(["w", "u", "b", "r", "g", "m", "a", "l"]);
    expect(stripRiderKeys(MDFC_STRIP_CUTS.m15mdfclandfront)).toEqual(["w", "u", "b", "r", "g", "m", "c"]);
    expect(stripRiderKeys(MDFC_STRIP_CUTS.m15mdfclandback)).toEqual(["w", "u", "b", "r", "g", "m", "c"]);
    expect(stripRiderSourceOf("m15mdfcfront", "u", MDFC_STRIP_CUTS.m15mdfcfront)).toBe("m15mdfcfront/u");
    expect(stripRiderSourceOf("m15mdfcfront", "l", MDFC_STRIP_CUTS.m15mdfcfront)).toBe("m15mdfclandfront/c");
    expect(stripRiderSourceOf("m15mdfcback", "l", MDFC_STRIP_CUTS.m15mdfcback)).toBe("m15mdfclandback/c");
    expect(stripRiderSourceOf("m15mdfclandback", "c", MDFC_STRIP_CUTS.m15mdfclandback)).toBe("m15mdfclandback/c");
    expect(() => stripRiderSourceOf("m15mdfclandback", "l", MDFC_STRIP_CUTS.m15mdfclandback)).toThrow(/no strip piece l/);
    expect(describeStripRider("m15mdfcfront", "l", MDFC_STRIP_CUTS.m15mdfcfront, "abcdef0123456789")[0]).toMatch(/^m15mdfclandfront\/c\.png \(the published master, sha256 abcdef012345\) cut at x 44–701 × y 1866–1955 through the full-alpha interior of img\/frames\/modal\/regular\/reminder\.svg eroded by 1 px and snapped to 2 × 2 px blocks/);
  });

  it("snapToBlocks: a block is kept whole only when every pixel of it is set; stripRiderInterior is the eroded interior snapped — a 1-px block is the map itself", () => {
    const mask = syntheticMask();
    const one = insideMaskEroded(mask, S.w, S.h, 1); // x 5–22 × y 7–14 plus the tip's x 23–25 × y 9–12
    const at = (m: Uint8Array, x: number, y: number) => m[y * S.w + x];
    const snapped = snapToBlocks(one, S.w, S.h, 2);
    // Rows 7 and 14 are odd: the blocks y 6–7 and y 14–15 straddle the edge → dropped.
    expect(at(one, 5, 7)).toBe(1);
    expect(at(snapped, 5, 7)).toBe(0);
    expect(at(snapped, 6, 8)).toBe(1);
    expect(at(snapped, 6, 9)).toBe(1);
    expect(at(one, 5, 8)).toBe(1); // x 5 is odd: the block x 4–5 has x 4 clear → dropped
    expect(at(snapped, 5, 8)).toBe(0);
    expect(at(snapped, 22, 9)).toBe(1); // the block x 22–23 × y 8–9 is all inside the eroded map (x 23's right neighbour is the tip's full-alpha column)
    // Every set pixel of the snapped map sits in a fully-set 2×2 block of the eroded map.
    for (let y = 0; y < S.h; y += 2) for (let x = 0; x < S.w; x += 2) {
      const cells = [at(snapped, x, y), at(snapped, x + 1, y), at(snapped, x, y + 1), at(snapped, x + 1, y + 1)];
      expect(new Set(cells).size, `block ${x},${y} whole or dropped`).toBe(1);
      if (cells[0]) expect([at(one, x, y), at(one, x + 1, y), at(one, x, y + 1), at(one, x + 1, y + 1)]).toEqual([1, 1, 1, 1]);
    }
    expect(Array.from(snapped).filter(Boolean).length).toBeLessThan(Array.from(one).filter(Boolean).length);
    expect(Array.from(snapped).filter(Boolean).length % 4).toBe(0);
    expect(snapToBlocks(one, S.w, S.h, 1)).toBe(one);
    expect(() => snapToBlocks(one, S.w, S.h, 0)).toThrow(/bad block/);
    expect(() => snapToBlocks(one, S.w, S.h + 1, 2)).toThrow(/not 40x25/);
    expect(Buffer.compare(Buffer.from(stripRiderInterior(mask, S.w, S.h, { erode: 1, snap: 2 })), Buffer.from(snapped))).toBe(0);
    expect(Buffer.compare(Buffer.from(stripRiderInterior(mask, S.w, S.h, { erode: 1, snap: 1 })), Buffer.from(one))).toBe(0);
  });

  it("insideMaskEroded: the mask's full-alpha interior, shrunk by the erosion — a partial rim never counts, and a bad erosion throws", () => {
    const mask = syntheticMask();
    const at = (m: Uint8Array, x: number, y: number) => m[y * S.w + x];
    const none = insideMaskEroded(mask, S.w, S.h, 0);
    expect(at(none, 4, 6)).toBe(1); // the interior's corner
    expect(at(none, 3, 6)).toBe(0); // the 128 rim
    expect(at(none, 26, 10)).toBe(1); // the chevron's tip
    const one = insideMaskEroded(mask, S.w, S.h, 1);
    expect(at(one, 4, 6)).toBe(0); // one pixel in from every edge
    expect(at(one, 5, 7)).toBe(1);
    expect(at(one, 26, 10)).toBe(0); // the tip's last column goes (its right neighbour is clear)
    expect(at(one, 25, 10)).toBe(1); // the tip keeps x 24–25 × y 9–12
    expect(at(one, 24, 8)).toBe(0); // the tip's top row goes (its upper neighbour is clear)
    expect(at(one, 25, 11)).toBe(1);
    const two = insideMaskEroded(mask, S.w, S.h, 2);
    expect(at(two, 5, 7)).toBe(0);
    expect(at(two, 6, 8)).toBe(1);
    expect(Array.from(none).filter(Boolean).length).toBe(20 * 10 + 3 * 6);
    expect(Array.from(one).filter(Boolean).length).toBeLessThan(Array.from(none).filter(Boolean).length);
    expect(() => insideMaskEroded(mask, S.w, S.h, -1)).toThrow(/bad erosion/);
    expect(() => insideMaskEroded(mask, S.w, S.h + 1, 1)).toThrow(/not 40x25 RGBA/);
  });

  it("cutStripRider: the box cropped out of the master, the colour the master's everywhere, alpha 255 inside the eroded mask and 0 elsewhere — never a partial pixel", () => {
    const mask = syntheticMask();
    const master = syntheticMaster();
    const inside = insideMaskEroded(mask, S.w, S.h, 1);
    const box = { x: 2, y: 4, width: 28, height: 14 };
    const piece = cutStripRider(master, inside, S.w, box);
    expect(piece.length).toBe(box.width * box.height * 4);
    let opaque = 0;
    for (let y = 0; y < box.height; y += 1) {
      for (let x = 0; x < box.width; x += 1) {
        const d = (y * box.width + x) * 4;
        const s = ((box.y + y) * S.w + box.x + x) * 4;
        expect([piece[d], piece[d + 1], piece[d + 2]]).toEqual([master[s], master[s + 1], master[s + 2]]);
        const want = inside[(box.y + y) * S.w + box.x + x] ? 255 : 0;
        expect(piece[d + 3]).toBe(want);
        if (want) opaque += 1;
      }
    }
    expect(opaque).toBeGreaterThan(0);
    expect(opaque).toBe(Array.from(inside).filter(Boolean).length);
    const findings = stripRiderFindings(piece, master, inside, S.w, S.h, box);
    expect(findings.failures).toEqual([]);
    expect(findings).toMatchObject({ opaque, partial: 0, colourOff: 0, outsideAlpha: 0, insideClear: 0, insideOutsideBox: 0 });
  });

  it("stripRiderFindings refuses a partial pixel, a foreign colour, alpha outside the mask, a clear pixel inside it, and a box the mask escapes", () => {
    const mask = syntheticMask();
    const master = syntheticMaster();
    const inside = insideMaskEroded(mask, S.w, S.h, 1);
    const box = { x: 2, y: 4, width: 28, height: 14 };
    const good = cutStripRider(master, inside, S.w, box);
    const at = (x: number, y: number) => (y * box.height === -1 ? 0 : ((y - box.y) * box.width + (x - box.x)) * 4);
    const partial = Buffer.from(good);
    partial[at(8, 8) + 3] = 120;
    expect(stripRiderFindings(partial, master, inside, S.w, S.h, box).failures).toEqual([expect.stringMatching(/^1 partial-alpha px/)]);
    const tinted = Buffer.from(good);
    tinted[at(8, 8)] = (tinted[at(8, 8)] + 1) & 255;
    expect(stripRiderFindings(tinted, master, inside, S.w, S.h, box).failures).toEqual([expect.stringMatching(/^1 px whose colour is not the master's/)]);
    const leak = Buffer.from(good);
    leak[at(3, 5) + 3] = 255; // outside the eroded mask
    expect(stripRiderFindings(leak, master, inside, S.w, S.h, box).failures).toEqual([expect.stringMatching(/^1 px with alpha outside the eroded mask/)]);
    const hole = Buffer.from(good);
    hole[at(8, 8) + 3] = 0;
    expect(stripRiderFindings(hole, master, inside, S.w, S.h, box).failures).toEqual([expect.stringMatching(/^1 px clear inside the eroded mask/)]);
    const small = { x: 6, y: 4, width: 20, height: 14 };
    expect(stripRiderFindings(cutStripRider(master, inside, S.w, small), master, inside, S.w, S.h, small).failures).toEqual([expect.stringMatching(/px of the eroded mask fall outside the piece's box$/)]);
  });
});

describe("the strip rider's key — the prints' rule (lib/cards/faces.ts stripKeyOf)", () => {
  it("a mono-colour face is its letter (an artifact its colour), a two-colour spell gold, a two-colour or colourless land the land grey, a hybrid-dressed front the land grey, a colourless spell c", () => {
    expect(stripKeyOf({ colorIdentity: ["blue"], cardType: "sorcery" })).toBe("u"); // STX #147's back
    expect(stripKeyOf({ colorIdentity: ["white"], cardType: "artifact" })).toBe("w"); // KHM #15 Sword of the Realms
    expect(stripKeyOf({ colorIdentity: ["black", "red"], cardType: "sorcery" })).toBe("m"); // STX #149's back, KHM #114's Tibalt
    expect(stripKeyOf({ colorIdentity: ["white", "blue", "black", "red", "green"], cardType: "enchantment" })).toBe("m"); // KHM #168
    expect(stripKeyOf({ colorIdentity: ["black", "red"], cardType: "land" })).toBe("l"); // MH3 #252's Sanguine Morass
    expect(stripKeyOf({ colorIdentity: ["colorless"], cardType: "land" })).toBe("l");
    expect(stripKeyOf({ colorIdentity: [], cardType: "land" })).toBe("l");
    expect(stripKeyOf({ colorIdentity: ["white"], cardType: "land" })).toBe("w"); // ZNR #258's Boulderloft
    expect(stripKeyOf({ colorIdentity: ["black", "red"], cardType: "sorcery", wearsHybrid: true })).toBe("l"); // MH3 #252's hybrid front, on its land back
    expect(stripKeyOf({ colorIdentity: ["black"], cardType: "sorcery", wearsHybrid: true })).toBe("b"); // a mono face can't wear the hybrid dress
    expect(stripKeyOf({ colorIdentity: [], cardType: "artifact" })).toBe("c");
    expect(stripKeyOf({ colorIdentity: ["colorless"], cardType: "sorcery" })).toBe("c");
    expect(stripKeyOf({ colorIdentity: null, cardType: "creature" })).toBe("c");
    // The key is the one the face's MASTER is picked by (pickFrameColorKey):
    // the colour chip's and the 5.4 import's literal "multicolor" is the gold
    // master, so its strip is gold — never the artifact stand-in; a mixed or
    // doubled identity draws gold too, and so does its strip.
    expect(stripKeyOf({ colorIdentity: ["multicolor"], cardType: "sorcery" })).toBe("m"); // STX #149's back as the import stores it
    expect(stripKeyOf({ colorIdentity: ["multicolor"], cardType: "land" })).toBe("l");
    expect(stripKeyOf({ colorIdentity: ["white", "colorless"], cardType: "creature" })).toBe("m");
    expect(stripKeyOf({ colorIdentity: ["green", "green"], cardType: "creature" })).toBe("m");
    expect(stripKeyOf({ colorIdentity: ["colorless", "colorless"], cardType: "land" })).toBe("l");
  });

  it("mdfcStripOwnKey: the master's own strip is its colour key, gold on a split pair master, none on the hybrid dress", () => {
    const front = getFrameProfile("m15mdfcfront");
    const base = { cost: "{W}{U}", cardType: "creature", supertype: null, colors: ["white", "blue"] as const };
    expect(mdfcStripOwnKey(null, "u")).toBe("u");
    expect(mdfcStripOwnKey(null, "c")).toBe("c");
    const split = resolveTwoColor(front, { twoColor: true }, base);
    expect(split?.dress).toBe("split");
    expect(mdfcStripOwnKey(split, "m")).toBe("m");
    const hybrid = resolveTwoColor(front, { twoColor: true }, { ...base, cost: "{W/U}{W/U}" });
    expect(hybrid?.dress).toBe("hybrid");
    expect(mdfcStripOwnKey(hybrid, "m")).toBeNull();
  });
});

type Back = NonNullable<CardPreviewData["backFace"]>;
const BACK: CardBackFace = {
  title: "Echoing Equation",
  cost: "{3}{U}{U}",
  card_type: "sorcery",
  subtypes: [],
  rules_text: "Choose target creature you control.",
  frame_style: { template: "m15mdfcback" },
  color_identity: ["blue"],
};
function card(over: Partial<CardPreviewData> = {}, back: Partial<Back> | null = {}): CardPreviewData {
  return {
    title: "Augmenter Pugilist",
    cost: "{1}{G}{G}",
    cardType: "creature",
    supertype: null,
    subtypes: ["Troll", "Druid"],
    rarity: "rare",
    colorIdentity: ["green"],
    rulesText: "Trample",
    flavorText: null,
    power: "3",
    toughness: "3",
    loyalty: null,
    defense: null,
    artistCredit: null,
    artUrl: null,
    artPosition: {},
    frameStyle: { template: "m15mdfcfront", finish: "regular" },
    backCard: null,
    faceContent: null,
    watermark: null,
    setCode: null,
    collectorNumber: null,
    lang: null,
    ...over,
    // The back comes from `back` alone (a spread card's own backFace never wins).
    backFace: back === null ? null : ({ ...BACK, ...back } as Back),
  } as CardPreviewData;
}
/** The overlays a face resolves, as the renderers do (lib/render/card-image.tsx anatomyFactsOf + pickFrameColorKey). */
function overlaysOf(face: CardPreviewData): string[] {
  const profile = getFrameProfile(face.frameStyle?.template as never);
  const colors = face.colorIdentity ?? [];
  const colorKey = colors.length === 0 ? "c" : colors.length > 1 ? "m" : ({ white: "w", blue: "u", black: "b", red: "r", green: "g", colorless: "c", multicolor: "m" } as Record<string, string>)[colors[0]];
  return resolveFrameOverlays(profile, face.frameStyle, {
    colors,
    cost: face.cost,
    cardType: face.cardType,
    supertype: face.supertype,
    rarity: face.rarity,
    dfc: face.dfc ? { role: face.dfc.role, icon: face.dfc.icon, stripKey: face.dfc.otherFace.stripKey } : null,
    colorKey,
  }).map((o) => `${o.anatomy}:${o.key}:${o.path}`);
}

describe("what the profiles declare and the renderers resolve (TODO 5.1c)", () => {
  it("the four modal bodies declare the rider after the crown, each from its own strip folder at the piece's box, with the spec's keys; no other template does", () => {
    expect(getFrameProfile("m15mdfcfront").overlays?.map((o) => o.anatomy)).toEqual(["crown", "mdfcStrip"]);
    expect(getFrameProfile("m15mdfcback").overlays?.map((o) => o.anatomy)).toEqual(["crown", "mdfcStrip"]);
    expect(getFrameProfile("m15mdfclandfront").overlays?.map((o) => o.anatomy)).toEqual(["mdfcStrip"]);
    expect(getFrameProfile("m15mdfclandback").overlays?.map((o) => o.anatomy)).toEqual(["mdfcStrip"]);
    for (const t of STRIP_TEMPLATES) {
      const slot = getFrameProfile(t).overlays!.find((o) => o.anatomy === "mdfcStrip")!;
      expect(slot).toBe(SLOT_OF[t]);
      expect(slot.assetPathTemplate).toBe(`/frames/${t}/strip/{key}.png`);
      expect([...slot.keys]).toEqual(stripRiderKeys(MDFC_STRIP_CUTS[t]));
      // The piece's box in card %, exact fractions of the HD px.
      expect(slot.rect.leftPct * 15).toBeCloseTo(MDFC_STRIP_BOX.x, 9);
      expect(slot.rect.topPct * 21).toBeCloseTo(MDFC_STRIP_BOX.y, 9);
      expect(slot.rect.widthPct * 15).toBeCloseTo(MDFC_STRIP_BOX.width, 9);
      expect(slot.rect.heightPct * 21).toBeCloseTo(MDFC_STRIP_BOX.height, 9);
      // Inside the painted strip's keep-out, which stays the rule's.
      const k = MDFC_FLIPSIDE_FRONT.keepOut;
      expect(slot.rect.leftPct).toBeGreaterThanOrEqual(k.leftPct - 0.1);
      expect(slot.rect.topPct).toBeGreaterThanOrEqual(k.topPct);
      expect(slot.rect.leftPct + slot.rect.widthPct).toBeLessThanOrEqual(k.leftPct + k.widthPct);
      expect(slot.rect.topPct + slot.rect.heightPct).toBeLessThanOrEqual(k.topPct + k.heightPct + 0.1);
    }
    expect(MDFC_STRIP_RIDER_FRONT.keyMap).toEqual({ c: "a" });
    expect(MDFC_STRIP_RIDER_BACK.keyMap).toEqual({ c: "a" });
    expect(MDFC_STRIP_RIDER_LAND_FRONT.keyMap).toEqual({ l: "c" });
    expect(MDFC_STRIP_RIDER_LAND_BACK.keyMap).toEqual({ l: "c" });
    for (const t of FRAME_TEMPLATE_VALUES) {
      if ((STRIP_TEMPLATES as readonly string[]).includes(t)) continue;
      expect(getFrameProfile(t).overlays?.some((o) => o.anatomy === "mdfcStrip") ?? false, t).toBe(false);
    }
    expect(MDFC_FLIPSIDE_FRONT.keepOut).toEqual({ leftPct: 3.0, topPct: 88.67, widthPct: 43.8, heightPct: 4.43 });
  });

  it("a mono-colour card draws no rider on either face (its master paints the strip); a legacy back none; a transform body and a plain frame never", () => {
    const monoBlue = card({ colorIdentity: ["blue"], cost: "{1}{U}{U}" });
    expect(frontPreviewData(monoBlue).dfc?.otherFace.stripKey).toBe("u");
    expect(overlaysOf(frontPreviewData(monoBlue))).toEqual([]);
    expect(backPreviewData(monoBlue)!.dfc?.otherFace.stripKey).toBe("u");
    expect(overlaysOf(backPreviewData(monoBlue)!)).toEqual([]);
    // A legacy back (no body): the front's block names the back's colour,
    // but the back draws on the front's template — its own block is null.
    const legacy = card({}, { frame_style: {} as never });
    expect(backPreviewData(legacy)!.dfc).toBeNull();
    expect(overlaysOf(backPreviewData(legacy)!)).toEqual([]);
    // No back face at all: no block, no rider.
    expect(frontPreviewData(card({}, null)).dfc).toBeUndefined();
    expect(overlaysOf(frontPreviewData(card({}, null)))).toEqual([]);
    // A transform front with a blue back: the icon rider only.
    const transform = card({ frameStyle: { template: "m15dfcfront", finish: "regular" } }, { frame_style: { template: "m15dfcback" }, cost: "" });
    expect(overlaysOf(frontPreviewData(transform))).toEqual(["dfcIcon:default:/frames/dfcicon/default.png"]);
    expect(overlaysOf(backPreviewData(transform)!)).toEqual([]);
    const plain = card({ frameStyle: { template: "m15", finish: "regular" } });
    expect(overlaysOf(frontPreviewData(plain))).toEqual([]);
  });

  it("a two-colour modal card: the front's strip in the BACK's colour, the back's in the FRONT's — the other face's key, each from its own folder", () => {
    const stx147 = card(); // G front // U back
    const front = frontPreviewData(stx147);
    expect(front.dfc?.otherFace.stripKey).toBe("u");
    expect(overlaysOf(front)).toEqual(["mdfcStrip:u:/frames/m15mdfcfront/strip/u.png"]);
    const back = backPreviewData(stx147)!;
    expect(back.dfc?.otherFace.stripKey).toBe("g");
    expect(overlaysOf(back)).toEqual(["mdfcStrip:g:/frames/m15mdfcback/strip/g.png"]);
    // KHM #114: a black front, a B/R back → gold on the front, black on the back.
    const valki = card({ colorIdentity: ["black"], cost: "{1}{B}" }, { title: "Tibalt, Cosmic Impostor", cost: "{5}{B}{R}", color_identity: ["black", "red"] });
    expect(overlaysOf(frontPreviewData(valki))).toEqual(["mdfcStrip:m:/frames/m15mdfcfront/strip/m.png"]);
    expect(overlaysOf(backPreviewData(valki)!)).toEqual(["mdfcStrip:b:/frames/m15mdfcback/strip/b.png"]);
    // A colourless artifact back: the artifact stand-in's tab (c → a) on the front; the back (drawn on the c master, whose strip IS a's) takes the green front's.
    const artifact = card({}, { title: "Sword of Nothing", cost: "{3}", card_type: "artifact", color_identity: [] });
    expect(overlaysOf(frontPreviewData(artifact))).toEqual(["mdfcStrip:a:/frames/m15mdfcfront/strip/a.png"]);
    expect(overlaysOf(backPreviewData(artifact)!)).toEqual(["mdfcStrip:g:/frames/m15mdfcback/strip/g.png"]);
    // A two-colour back stored as the literal "multicolor" (the Multicolor
    // chip's and the import's spelling, backFrameColorsFromScryfall): the
    // back is drawn on the gold master, so the front's strip is gold — and the
    // gold back, whose own strip is gold, takes the green front's.
    const imported = card({}, { title: "Awaken the Blood Avatar", cost: "{6}{B}{R}", color_identity: ["multicolor"] });
    expect(frontPreviewData(imported).dfc?.otherFace.stripKey).toBe("m");
    expect(overlaysOf(frontPreviewData(imported))).toEqual(["mdfcStrip:m:/frames/m15mdfcfront/strip/m.png"]);
    expect(overlaysOf(backPreviewData(imported)!)).toEqual(["mdfcStrip:g:/frames/m15mdfcback/strip/g.png"]);
    // A back with no colour of its own follows the front's (backPreviewData's rule): mono, no rider.
    const following = card({}, { color_identity: undefined as never });
    expect(frontPreviewData(following).dfc?.otherFace.stripKey).toBe("g");
    expect(overlaysOf(frontPreviewData(following))).toEqual([]);
  });

  it("the land pair: a pathway's faces each carry the other's colour; a two-colour land other face is the land grey (`l` → the land pair's own c, the spell front's own l piece)", () => {
    const pathway = card(
      { title: "Branchloft Pathway", cardType: "land", cost: null, colorIdentity: ["green"], rulesText: "{T}: Add {G}.", power: null, toughness: null, subtypes: [], frameStyle: { template: "m15mdfclandfront", finish: "regular" } },
      { title: "Boulderloft Pathway", cost: "", card_type: "land", rules_text: "{T}: Add {W}.", frame_style: { template: "m15mdfclandback" }, color_identity: ["white"] },
    );
    expect(overlaysOf(frontPreviewData(pathway))).toEqual(["mdfcStrip:w:/frames/m15mdfclandfront/strip/w.png"]);
    expect(overlaysOf(backPreviewData(pathway)!)).toEqual(["mdfcStrip:g:/frames/m15mdfclandback/strip/g.png"]);
    // MH3 #252's shape: a hybrid B/R spell front (the hybrid dress on) with
    // a two-colour land back: the land grey on the front (the spell body's
    // own `l` piece), and on the back — the front wears the hybrid dress —
    // the land grey too (the land body's `c`).
    const morass = card(
      { title: "Bloodsoaked Insight", cardType: "sorcery", cost: "{B/R}{B/R}", colorIdentity: ["black", "red"], power: null, toughness: null, subtypes: [], frameStyle: { template: "m15mdfcfront", finish: "regular", twoColor: true } },
      { title: "Sanguine Morass", cost: "", card_type: "land", rules_text: "{T}: Add {B} or {R}.", frame_style: { template: "m15mdfclandback" }, color_identity: ["black", "red"] },
    );
    expect(frontPreviewData(morass).dfc?.otherFace.stripKey).toBe("l");
    expect(overlaysOf(frontPreviewData(morass))).toEqual(["mdfcStrip:l:/frames/m15mdfcfront/strip/l.png"]);
    expect(backPreviewData(morass)!.dfc?.otherFace.stripKey).toBe("l");
    expect(overlaysOf(backPreviewData(morass)!)).toEqual(["mdfcStrip:c:/frames/m15mdfclandback/strip/c.png"]);
    // The switch off: the front draws gold, so its back's strip key is gold
    // `m` — which the B/R land back's own master (the gold land stand-in)
    // already paints: no rider. The front's `l` stays (the back is a land).
    const gold = card({ ...morass, frameStyle: { template: "m15mdfcfront", finish: "regular" } }, morass.backFace as Back);
    expect(backPreviewData(gold)!.dfc?.otherFace.stripKey).toBe("m");
    expect(overlaysOf(backPreviewData(gold)!)).toEqual([]);
    expect(overlaysOf(frontPreviewData(gold))).toEqual(["mdfcStrip:l:/frames/m15mdfcfront/strip/l.png"]);
    // A mono land back whose front is the same colour: none.
    const mono = card(
      { title: "Sink into Stupor", cardType: "instant", cost: "{3}{U}", colorIdentity: ["blue"], subtypes: [], power: null, toughness: null },
      { title: "Soporific Springs", cost: "", card_type: "land", rules_text: "{T}: Add {U}.", frame_style: { template: "m15mdfclandback" }, color_identity: ["blue"] },
    );
    expect(overlaysOf(frontPreviewData(mono))).toEqual([]);
    expect(overlaysOf(backPreviewData(mono)!)).toEqual([]);
  });

  it("a pair master's own strip: the split's is gold (no rider for a two-colour other face), the hybrid's is lerped (always ridden); the crown comes first", () => {
    const wu = card(
      { title: "King T'Challa", cost: "{2}{W}{U}", colorIdentity: ["white", "blue"], supertype: "Legendary", frameStyle: { template: "m15mdfcfront", finish: "regular", twoColor: true, crown: true } },
      { title: "Black Panther, Hope Enduring", cost: "{3}{W}{U}", card_type: "creature", supertype: "Legendary", color_identity: ["white", "blue"] },
    );
    // Split on both faces, each other face two-colour → gold = the split master's own strip: the crown alone.
    expect(overlaysOf(frontPreviewData(wu))).toEqual(["crown:wu:/frames/m15mdfccrown/wu.png"]);
    expect(overlaysOf(backPreviewData(wu)!)).toEqual(["crown:wu:/frames/m15mdfccrown/wu.png"]);
    // The hybrid dress on the front: its lerped strip takes the gold piece; the back's strip for a hybrid-dressed front is the land grey.
    const hybrid = card({ ...wu, cost: "{W/U}{W/U}" }, wu.backFace as Back);
    expect(overlaysOf(frontPreviewData(hybrid))).toEqual(["crown:wu:/frames/m15mdfccrown/wu.png", "mdfcStrip:m:/frames/m15mdfcfront/strip/m.png"]);
    expect(overlaysOf(backPreviewData(hybrid)!)).toEqual(["crown:wu:/frames/m15mdfccrown/wu.png", "mdfcStrip:l:/frames/m15mdfcback/strip/l.png"]);
    // The switch off: gold on both faces, a two-colour other face → the gold master's own strip: nothing.
    const off = card({ ...wu, frameStyle: { template: "m15mdfcfront", finish: "regular", crown: true } }, wu.backFace as Back);
    expect(overlaysOf(frontPreviewData(off))).toEqual(["crown:m:/frames/m15mdfccrown/m.png"]);
    // A gold front with a MONO back: the back's colour over the gold strip.
    const goldMono = card({ ...wu, frameStyle: { template: "m15mdfcfront", finish: "regular" } }, { ...(wu.backFace as Back), color_identity: ["blue"], cost: "{3}{U}" });
    expect(overlaysOf(frontPreviewData(goldMono))).toEqual(["mdfcStrip:u:/frames/m15mdfcfront/strip/u.png"]);
    expect(overlaysOf(backPreviewData(goldMono)!)).toEqual(["mdfcStrip:m:/frames/m15mdfcback/strip/m.png"]);
  });
});

describe("the published pieces (the frames bucket)", () => {
  const keysOf = (t: (typeof STRIP_TEMPLATES)[number]) => stripRiderKeys(MDFC_STRIP_CUTS[t]);
  const pieces = STRIP_TEMPLATES.flatMap((t) => keysOf(t).map((k) => [t, k, onDisk(`${t}/strip/${k}.png`)] as const));
  const sources = STRIP_TEMPLATES.flatMap((t) => keysOf(t).map((k) => [t, k, onDisk(`${stripRiderSourceOf(t, k, MDFC_STRIP_CUTS[t])}.png`)] as const));
  const missing = pieces.filter(([, , f]) => !f).length + sources.filter(([, , f]) => !f).length;
  if (missing && STRICT) throw new Error(`${missing} 5.1c pieces / masters missing from ${BUILD} (CI fetches them: frames-fetch.mjs)`);
  const run = missing ? it.skip : it;
  const cc = fs.existsSync(path.join(CC_CACHE, "img/frames/modal/regular/reminder.svg")) ? path.join(CC_CACHE, "img/frames/modal/regular/reminder.svg") : null;

  it("the manifest lists every piece, PNG and WebP, at the box's size — 30 pieces; the provenance records each template's cut", () => {
    expect(pieces).toHaveLength(30);
    for (const [t, k] of pieces) {
      for (const ext of ["png", "webp"]) expect(manifest.files[`${t}/strip/${k}.${ext}`], `${t}/strip/${k}.${ext}`).toMatchObject({ width: MDFC_STRIP_BOX.width, height: MDFC_STRIP_BOX.height });
    }
    for (const t of STRIP_TEMPLATES) {
      const p = provenance[t].strip!;
      expect(p).toMatchObject({ mask: "img/frames/modal/regular/reminder.svg", box: MDFC_STRIP_BOX, erodePx: 1, keys: keysOf(t) });
      for (const k of keysOf(t)) {
        expect(p.sources[k]).toBe(`${stripRiderSourceOf(t, k, MDFC_STRIP_CUTS[t])}.png`);
        expect(p.colors[k][0].startsWith(`${p.sources[k]} (the published master, sha256 ${manifest.files[p.sources[k]].sha256.slice(0, 12)})`), `${t}/strip/${k}: ${p.colors[k][0]}`).toBe(true);
      }
      expect(provenance[t].notes.some((n) => n.includes("flipside strip RIDERS (TODO 5.1c"))).toBe(true);
    }
  });

  run("each piece is its source master's own tab: 0 px differ in colour, alpha 0 / 255, nothing outside the mask's eroded, block-snapped interior and nothing clear inside it — the base-tone identity for every key of every template", async () => {
    expect(cc, "the Card Conjurer cache (the mask)").not.toBeNull();
    const inside = stripRiderInterior(await maskAt(cc!, W, H), W, H, MDFC_STRIP_CUTS.m15mdfcfront);
    const expectedOpaque = Array.from(inside).filter(Boolean).length;
    // The mask's full-alpha tab is 53,828 px, eroded 52,490, snapped 51,208 — whole blocks.
    expect(expectedOpaque).toBe(51_208);
    expect(expectedOpaque % 4).toBe(0);
    for (const [t, k, file] of pieces) {
      const piece = await rgba(file!);
      expect([piece.w, piece.h], `${t}/strip/${k}`).toEqual([MDFC_STRIP_BOX.width, MDFC_STRIP_BOX.height]);
      const master = await rgba(onDisk(`${stripRiderSourceOf(t, k, MDFC_STRIP_CUTS[t])}.png`)!);
      const findings = stripRiderFindings(piece.data, master.data, inside, W, H, MDFC_STRIP_BOX);
      expect(findings.failures, `${t}/strip/${k}`).toEqual([]);
      expect(findings.opaque, `${t}/strip/${k}`).toBe(expectedOpaque);
    }
    // The spell bodies' `l` is the land pair's grey c, byte for byte (CC's l.png / lb.png).
    const l = await rgba(onDisk("m15mdfcfront/strip/l.png")!);
    const c = await rgba(onDisk("m15mdfclandfront/strip/c.png")!);
    expect(Buffer.compare(l.data, c.data), "m15mdfcfront/strip/l = m15mdfclandfront/strip/c, pixel for pixel").toBe(0);
    const lb = await rgba(onDisk("m15mdfcback/strip/l.png")!);
    const cb = await rgba(onDisk("m15mdfclandback/strip/c.png")!);
    expect(Buffer.compare(lb.data, cb.data), "m15mdfcback/strip/l = m15mdfclandback/strip/c").toBe(0);
  }, 300_000);

  run("with the Card Conjurer cache, a fresh cut reproduces every published piece pixel for pixel", async () => {
    expect(cc).not.toBeNull();
    const inside = stripRiderInterior(await maskAt(cc!, W, H), W, H, MDFC_STRIP_CUTS.m15mdfcfront);
    for (const [t, k, file] of pieces) {
      const master = await rgba(onDisk(`${stripRiderSourceOf(t, k, MDFC_STRIP_CUTS[t])}.png`)!);
      const fresh = cutStripRider(master.data, inside, W, MDFC_STRIP_BOX);
      const published = await rgba(file!);
      expect(Buffer.compare(fresh, published.data), `${t}/strip/${k}`).toBe(0);
    }
  }, 300_000);

  // The rasteriser the bake uses (lib/render/satori-png.ts: sharp / librsvg
  // over the <image preserveAspectRatio="none"> Satori emits for an <img>
  // with objectFit fill), at the HD size and at the 750 default.
  function svgOf(width: number, height: number, layers: { x: number; y: number; w: number; h: number; png: Buffer }[]): Buffer {
    const sx = width / W;
    const sy = height / H;
    const images = layers.map((l) => `<image x="${l.x * sx}" y="${l.y * sy}" width="${l.w * sx}" height="${l.h * sy}" preserveAspectRatio="none" href="data:image/png;base64,${l.png.toString("base64")}"/>`).join("");
    return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#777"/>${images}</svg>`);
  }
  async function raster(width: number, height: number, layers: Parameters<typeof svgOf>[2]): Promise<Img> {
    const { data, info } = await sharp(svgOf(width, height, layers)).resize(width).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return { data, w: info.width, h: info.height };
  }
  function differ(a: Img, b: Img): { px: number; max: number } {
    let px = 0;
    let max = 0;
    for (let i = 0; i < a.data.length; i += 4) {
      let d = 0;
      for (let c = 0; c < 4; c += 1) d = Math.max(d, Math.abs(a.data[i + c] - b.data[i + c]));
      if (d) {
        px += 1;
        if (d > max) max = d;
      }
    }
    return { px, max };
  }
  run("a piece drawn over its own master through the bake's rasteriser changes 0 px at HD AND at the 750 bake on every key (the block snap); the un-snapped eroded cut would not at 750", async () => {
    const own = pieces.filter(([t, k]) => MDFC_STRIP_CUTS[t].keys.includes(k));
    for (const [t, k, file] of own) {
      const masterPng = fs.readFileSync(onDisk(`${t}/${k}.png`)!);
      const piecePng = fs.readFileSync(file!);
      const master = { x: 0, y: 0, w: W, h: H, png: masterPng };
      const rider = { x: MDFC_STRIP_BOX.x, y: MDFC_STRIP_BOX.y, w: MDFC_STRIP_BOX.width, h: MDFC_STRIP_BOX.height, png: piecePng };
      expect(differ(await raster(W, H, [master]), await raster(W, H, [master, rider])), `${t}/strip/${k} at HD`).toEqual({ px: 0, max: 0 });
      expect(differ(await raster(750, 1050, [master]), await raster(750, 1050, [master, rider])), `${t}/strip/${k} at 750`).toEqual({ px: 0, max: 0 });
    }
    // Not vacuous: the same cut WITHOUT the snap (the eroded interior alone)
    // leaves the 2:1 resample a partial pixel on the chevron's diagonals.
    const [t, k] = own[0];
    const masterRaw = await rgba(onDisk(`${t}/${k}.png`)!);
    const eroded = insideMaskEroded(await maskAt(cc!, W, H), W, H, MDFC_STRIP_ERODE_PX);
    const unsnapped = await sharp(cutStripRider(masterRaw.data, eroded, W, MDFC_STRIP_BOX), { raw: { width: MDFC_STRIP_BOX.width, height: MDFC_STRIP_BOX.height, channels: 4 } }).png().toBuffer();
    const master = { x: 0, y: 0, w: W, h: H, png: fs.readFileSync(onDisk(`${t}/${k}.png`)!) };
    const rider = { x: MDFC_STRIP_BOX.x, y: MDFC_STRIP_BOX.y, w: MDFC_STRIP_BOX.width, h: MDFC_STRIP_BOX.height, png: unsnapped };
    const low = differ(await raster(750, 1050, [master]), await raster(750, 1050, [master, rider]));
    expect(low.px).toBeGreaterThan(0);
    expect(low.px).toBeLessThanOrEqual(8);
  }, 600_000);
});
