import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  ADVENTURE_PAGE_BOX,
  ADVENTURE_PAGE_CUT,
  ADVENTURE_PAGE_KEYS as RECIPE_KEYS,
  CC_TEMPLATES,
  adventurePageFindings,
  cutThroughMask,
  describeAdventurePage,
  sourceFilesFor,
} from "../../../scripts/lib/cc-frames.mjs";
import provenanceJson from "@/lib/cards/frame-sources.json";
import manifestJson from "@/lib/frames/frame-manifest.json";
import { frameAnatomyOf, resolveFrameOverlays } from "@/lib/cards/anatomy";
import { partColourVerdict } from "@/lib/cards/part-color";
import { ADVENTURE_PAGE, ADVENTURE_PAGE_KEYS, getFrameProfile } from "@/lib/cards/template-layout";
import type { ColorIdentity } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 4.26 — the ADVENTURE spell's page in its own colour (owner decision
// 2026-10-22: pre-cut pieces). Card Conjurer paints the storybook's LEFT
// page in the spell's colour by drawing that colour's frame through its
// `bookLeft` mask; the importer publishes the cut as pieces,
// `adventure/page/<key>` (scripts/lib/cc-frames.mjs ADVENTURE_PAGE_CUT), and
// the renderers draw them through the `partPage` overlay slot Prepare's page
// uses (lib/cards/template-layout.ts ADVENTURE_PAGE) — no renderer code of
// its own. This holds the recipe, the slot and the published objects
// together, and the slot's resolution:
//   • the slot's rect IS the recipe's box (even px: whole px at the 750
//     bake), its keys the recipe's, and the bucket holds a PNG and a WebP of
//     every key at the box's size; provenance names the mask;
//   • a mono spell over a creature of another colour draws its colour's
//     page; a two-colour spell the gold one (no print shows a pair page
//     beside a creature of other colours); none where the spell is the
//     creature's own colour, with the switch off or absent (a card stored
//     before 4.26), or with no colour of its own;
//   • the cut itself (adventurePageFindings) — and, on the real pieces and
//     masters (FRAMES_BUILD_DIR at the manifest's sha256), each piece is its
//     master's pixels and over its own master changes nothing.
// ---------------------------------------------------------------------------

type Entry = { sha256: string; width: number; height: number };
const MANIFEST = (manifestJson as { files: Record<string, Entry> }).files;
const PROVENANCE = provenanceJson as Record<string, { page?: { mask: string; box: unknown; keys: string[]; sources: Record<string, string> }; sourceFiles: string[] }>;

describe("the adventure page's recipe, slot and objects", () => {
  it("draws the page through a partPage slot at the recipe's box", () => {
    expect(frameAnatomyOf("adventure").partColor).toBe(true);
    expect((getFrameProfile("adventure").overlays ?? []).filter((s) => s.anatomy === "partPage")).toEqual([ADVENTURE_PAGE]);
    const { rect } = ADVENTURE_PAGE;
    const box = ADVENTURE_PAGE_BOX;
    expect((rect.leftPct * 1500) / 100).toBeCloseTo(box.x, 6);
    expect((rect.topPct * 2100) / 100).toBeCloseTo(box.y, 6);
    expect((rect.widthPct * 1500) / 100).toBeCloseTo(box.width, 6);
    expect((rect.heightPct * 2100) / 100).toBeCloseTo(box.height, 6);
    // Even px: whole px at the 750 bake.
    for (const v of [box.x, box.y, box.width, box.height]) expect(v % 2, `${v}`).toBe(0);
    expect([...ADVENTURE_PAGE_KEYS]).toEqual([...RECIPE_KEYS]);
    expect(ADVENTURE_PAGE.assetPathTemplate).toBe("/frames/adventure/page/{key}.png");
  });

  it("is published at the box's size, and provenance names the mask and the masters", () => {
    for (const key of RECIPE_KEYS) {
      for (const ext of ["png", "webp"]) {
        const entry = MANIFEST[`adventure/page/${key}.${ext}`];
        expect(entry, `${key}.${ext}`).toBeDefined();
        expect([entry!.width, entry!.height], `${key}.${ext}`).toEqual([ADVENTURE_PAGE_BOX.width, ADVENTURE_PAGE_BOX.height]);
      }
    }
    expect(CC_TEMPLATES.adventure.page).toBe(ADVENTURE_PAGE_CUT);
    expect(sourceFilesFor(CC_TEMPLATES.adventure)).toContain(ADVENTURE_PAGE_CUT.mask);
    const page = PROVENANCE.adventure!.page!;
    expect(page.mask).toBe("img/frames/adventure/regular/bookLeft.png");
    expect(page.box).toEqual(ADVENTURE_PAGE_BOX);
    expect(page.keys).toEqual([...RECIPE_KEYS]);
    for (const key of RECIPE_KEYS) expect(page.sources[key]).toBe(`adventure/${key}.png`);
    expect(PROVENANCE.adventure!.sourceFiles).toContain(ADVENTURE_PAGE_CUT.mask);
    expect(describeAdventurePage("adventure", "r", ADVENTURE_PAGE_CUT, "0123456789abcdef")[0]).toMatch(/^adventure\/r\.png .* x 72–753 × y 1312–1937 .*bookLeft\.png/);
  });
});

describe("the page the slot draws", () => {
  const profile = getFrameProfile("adventure");
  const KEY: Record<string, string> = { white: "w", blue: "u", black: "b", red: "r", green: "g" };
  const page = (colors: ColorIdentity[], style: Record<string, unknown>, part: { colors: ColorIdentity[]; cost?: string } | null, cost = "{1}{B}") =>
    resolveFrameOverlays(profile, style, {
      colors,
      cost,
      cardType: "creature",
      supertype: null,
      colorKey: colors.length === 1 ? (KEY[colors[0]!] ?? (colors[0] === "multicolor" ? "m" : "c")) : "m",
      part,
    }).filter((o) => o.anatomy === "partPage");

  it("draws a mono spell's page over a creature of another colour (WOE #221: red beside black)", () => {
    expect(page(["black"], { template: "adventure", partColor: true }, { colors: ["red"], cost: "{R}" })).toEqual([
      { anatomy: "partPage", rect: ADVENTURE_PAGE.rect, key: "r", path: "/frames/adventure/page/r.png" },
    ]);
    // …each of the five, and gold.
    for (const [colour, key] of Object.entries(KEY)) {
      const creature: ColorIdentity[] = colour === "black" ? ["red"] : ["black"];
      expect(page(creature, { template: "adventure", partColor: true }, { colors: [colour as ColorIdentity] }).map((o) => o.key), colour).toEqual([key]);
    }
    expect(page(["black"], { template: "adventure", partColor: true }, { colors: ["multicolor"], cost: "{W}{U}{B}" }).map((o) => o.key)).toEqual(["m"]);
  });

  it("draws a coloured spell's page over a COLOURLESS creature (HOB #170: white over adventure/c)", () => {
    // The Arkenstone // Seek the Heart: a colourless artifact creature on
    // the `c` master (CC's artifact frame, verified), a {2}{W} spell.
    expect(page(["colorless"], { template: "adventure", partColor: true }, { colors: ["white"], cost: "{2}{W}" }, "{5}")).toEqual([
      { anatomy: "partPage", rect: ADVENTURE_PAGE.rect, key: "w", path: "/frames/adventure/page/w.png" },
    ]);
    // …gated in both keys: the creature's `c` and the spell's `w`.
    const keys = (...k: string[]) => new Set(k);
    expect(partColourVerdict("adventure", ["colorless"], null, ["white"], keys("adventure/c", "adventure/w"))).toEqual({ drawn: true, ok: true, frameColors: ["colorless"] });
    expect(partColourVerdict("adventure", ["colorless"], null, ["white"], keys("adventure/c"))).toMatchObject({ drawn: true, ok: false });
  });

  it("paints a two-colour spell's page gold — both dresses — and none over a gold creature", () => {
    expect(page(["black"], { template: "adventure", partColor: true }, { colors: ["green", "blue"], cost: "{G}{U}" }).map((o) => o.key)).toEqual(["m"]);
    expect(page(["black"], { template: "adventure", partColor: true }, { colors: ["green", "white"], cost: "{G/W}{G/W}" }).map((o) => o.key)).toEqual(["m"]);
    // MKM #212 Kellan (a G/U creature, a {G}{U} spell), ELD #212 Oakhame
    // Ranger (hybrid both): the gold master's own page.
    expect(page(["green", "blue"], { template: "adventure", partColor: true }, { colors: ["green", "blue"], cost: "{G}{U}" }, "{2}{G}{U}")).toEqual([]);
    expect(page(["green", "white"], { template: "adventure", partColor: true }, { colors: ["green", "white"], cost: "{G/W}{G/W}" }, "{G/W}{G/W}")).toEqual([]);
    // WOE #220 Beluna: a gold creature, a gold spell.
    expect(page(["multicolor"], { template: "adventure", partColor: true }, { colors: ["multicolor"], cost: "{2}{G}{U}{R}" }, "{G}{U}{R}")).toEqual([]);
  });

  it("draws nothing off, absent (a card stored before 4.26), without a colour of its own, or in the creature's colour", () => {
    expect(page(["black"], { template: "adventure", partColor: false }, { colors: ["red"] })).toEqual([]);
    expect(page(["black"], { template: "adventure" }, { colors: ["red"] })).toEqual([]);
    expect(page(["black"], { template: "adventure", partColor: true }, { colors: [] })).toEqual([]);
    expect(page(["black"], { template: "adventure", partColor: true }, null)).toEqual([]);
    expect(page(["red"], { template: "adventure", partColor: true }, { colors: ["red"], cost: "{1}{R}" })).toEqual([]);
    // No colourless page is published: a colourless spell's key draws none.
    expect(page(["black"], { template: "adventure", partColor: true }, { colors: ["colorless"], cost: "{3}" })).toEqual([]);
  });

  it("partColourVerdict: the spell's colour verified on the adventure frame, else the look off", () => {
    const keys = (...k: string[]) => new Set(k);
    expect(partColourVerdict("adventure", ["black"], null, ["red"], keys("adventure/b", "adventure/r"))).toEqual({ drawn: true, ok: true, frameColors: ["black"] });
    expect(partColourVerdict("adventure", ["black"], null, ["red"], keys("adventure/b"))).toEqual({ drawn: true, ok: false, frameColors: ["black"] });
    // A two-colour spell is gated in the gold key it paints.
    expect(partColourVerdict("adventure", ["black"], null, ["green", "blue"], keys("adventure/b", "adventure/m"))).toMatchObject({ ok: true });
    // A first part's own colour is never read here (the creature IS the card's).
    expect(partColourVerdict("adventure", ["black"], ["red"], ["red"], keys("adventure/b", "adventure/r"))).toEqual({ drawn: true, ok: true, frameColors: ["black"] });
  });
});

describe("the cut (adventurePageFindings)", () => {
  const W = 8;
  const H = 6;
  const box = { x: 2, y: 1, width: 4, height: 4 };
  const rgba = (f: (x: number, y: number) => [number, number, number, number]) => {
    const out = Buffer.alloc(W * H * 4);
    for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) out.set(f(x, y), (y * W + x) * 4);
    return out;
  };
  const master = rgba((x, y) => [10 * x, 20 * y, 7, 255]);

  it("passes a cut of the mask's whole alpha, soft edge included", () => {
    const mask = rgba((x, y) => [0, 0, 0, x >= 2 && x < 6 && y >= 1 && y < 5 ? (x === 5 ? 128 : 255) : 0]);
    const piece = cutThroughMask(master, mask, W, box);
    const f = adventurePageFindings(piece, master, mask, W, H, box);
    expect(f.failures).toEqual([]);
    expect([f.opaque, f.partial]).toEqual([12, 4]);
  });

  it("refuses a box that leaves part of the mask out, a wrong alpha or a wrong colour", () => {
    const mask = rgba((x, y) => [0, 0, 0, x >= 1 && x < 6 && y >= 1 && y < 5 ? 255 : 0]);
    const piece = cutThroughMask(master, mask, W, box);
    expect(adventurePageFindings(piece, master, mask, W, H, box).failures).toEqual(["4 px of the mask fall outside the box"]);
    const inside = rgba((x, y) => [0, 0, 0, x >= 2 && x < 6 && y >= 1 && y < 5 ? 255 : 0]);
    const bad = Buffer.from(cutThroughMask(master, inside, W, box));
    bad[3] = 200;
    bad[4] = 99;
    expect(adventurePageFindings(bad, master, inside, W, H, box).failures).toEqual([
      "1 px whose alpha is not the mask's × the master's",
      "1 px whose colour is not the master's",
    ]);
  });
});

// On the REAL pieces and masters, where a local copy holds them at the
// manifest's sha256 (FRAMES_BUILD_DIR, as CI's frames cache).
const BUILD = process.env.FRAMES_BUILD_DIR ? path.resolve(process.env.FRAMES_BUILD_DIR) : null;
const local = (rel: string) => {
  if (!BUILD) return null;
  const file = path.join(BUILD, rel);
  if (!fs.existsSync(file)) return null;
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex") === MANIFEST[rel]?.sha256 ? file : null;
};
const havePieces = RECIPE_KEYS.every((k: string) => local(`adventure/page/${k}.png`) && local(`adventure/${k}.png`));

describe.skipIf(!havePieces)("the published pieces", () => {
  it("are their master's pixels in the box: a piece over its own master changes nothing", async () => {
    const box = ADVENTURE_PAGE_BOX;
    for (const key of RECIPE_KEYS) {
      const { data: piece } = await sharp(local(`adventure/page/${key}.png`)!).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const { data: master } = await sharp(local(`adventure/${key}.png`)!).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      let shown = 0;
      let off = 0;
      for (let y = 0; y < box.height; y += 1) {
        for (let x = 0; x < box.width; x += 1) {
          const o = (y * box.width + x) * 4;
          const p = ((box.y + y) * 1500 + box.x + x) * 4;
          if (piece[o + 3]! === 0) continue;
          shown += 1;
          if (piece[o] !== master[p] || piece[o + 1] !== master[p + 1] || piece[o + 2] !== master[p + 2]) off += 1;
        }
      }
      expect(off, key).toBe(0);
      // The page: 415 121 opaque + 3 147 soft px of the mask.
      expect(shown, key).toBe(418_268);
    }
  }, 60_000);
});
