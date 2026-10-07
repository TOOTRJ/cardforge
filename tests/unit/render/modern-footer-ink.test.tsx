import sharp from "sharp";
import { describe, expect, it } from "vitest";
import type { CardPreviewData } from "@/components/cards/card-preview";
import type { FrameTemplate } from "@/types/card";
import { footerInk, getFrameProfile, slotInk } from "@/lib/cards/template-layout";
import { resolveFrameProfile } from "@/lib/cards/profile-override";
import { renderCardImage, RENDER_PRESETS, type RenderPreset } from "@/lib/render/card-image";

// ---------------------------------------------------------------------------
// The 2003 frame's artist line (TODO 4.23a, layout v44). Eighth Edition →
// Journey into Nyx print the footer black on white, blue, red, green, gold
// and the artifact frame and WHITE on the black frame and on lands (M12 #81,
// #224). INK_DARK on those masters measured 1.1 : 1 (`modern`/b) and
// 2.2–2.3 : 1 (the brown band every `modernland` key shares). Pinned on the
// git masters and on REAL bakes at both sizes; the preview half is in
// tests/unit/components/modern-footer-ink.test.tsx.
// ---------------------------------------------------------------------------

const KEYS = ["w", "u", "b", "r", "g", "c", "m"] as const;
type Key = (typeof KEYS)[number];
const COLOR: Record<Key, CardPreviewData["colorIdentity"]> = {
  w: ["white"],
  u: ["blue"],
  b: ["black"],
  r: ["red"],
  g: ["green"],
  c: ["colorless"],
  m: ["white", "blue"],
};
/** The eight combos the prints letter in white. */
const WHITE: readonly (readonly [FrameTemplate, Key])[] = [
  ["modern", "b"],
  ...KEYS.map((k) => ["modernland", k] as const),
];
const DARK: readonly (readonly [FrameTemplate, Key])[] = KEYS.filter((k) => k !== "b").map((k) => ["modern", k] as const);

const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lumOf = ([r, g, b]: number[]) => 0.299 * r + 0.587 * g + 0.114 * b;
/** WCAG 2 relative luminance and contrast ratio. */
function relLum(rgb: number[]): number {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: number[], b: number[]): number {
  const [hi, lo] = [relLum(a), relLum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

type Raw = { data: Buffer; width: number; height: number };
type Rect = { topPct: number; leftPct: number; widthPct: number; heightPct: number };

/** Pixel offsets (3 channels) inside a card-percent rect. */
function rectPixels(r: Raw, rect: Rect): number[] {
  const out: number[] = [];
  for (let y = Math.ceil((rect.topPct / 100) * r.height); y < Math.floor(((rect.topPct + rect.heightPct) / 100) * r.height); y += 1) {
    for (let x = Math.ceil((rect.leftPct / 100) * r.width); x < Math.floor(((rect.leftPct + rect.widthPct) / 100) * r.width); x += 1) {
      out.push((y * r.width + x) * 3);
    }
  }
  return out;
}
const at = (r: Raw, o: number) => [r.data[o], r.data[o + 1], r.data[o + 2]];

/** The median colour of the master under the footer slot. */
async function footerGround(template: FrameTemplate, key: Key): Promise<number[]> {
  const { data, info } = await sharp(`public/frames/${template}/${key}.png`)
    .flatten({ background: "#000" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const raw: Raw = { data, width: info.width, height: info.height };
  const pixels = rectPixels(raw, getFrameProfile(template).footer!.rect);
  return [0, 1, 2].map((c) => {
    const channel = pixels.map((o) => data[o + c]).sort((a, b) => a - b);
    return channel[Math.floor(channel.length / 2)];
  });
}

function card(template: FrameTemplate, key: Key): CardPreviewData {
  const land = template === "modernland";
  return {
    title: "Ink Probe",
    cost: land ? null : "{2}{B}",
    cardType: land ? "land" : "creature",
    supertype: null,
    subtypes: land ? [] : ["Zombie"],
    rarity: "uncommon",
    colorIdentity: COLOR[key],
    rulesText: land ? "{T}: Add {C}." : "Deathtouch",
    flavorText: null,
    power: land ? null : "2",
    toughness: land ? null : "2",
    loyalty: null,
    defense: null,
    artistCredit: "Douglas Schuler and Company",
    artUrl: null,
    artPosition: {},
    frameStyle: { template, finish: "regular" },
    setIconUrl: null,
    setIconCode: null,
    backFace: null,
    faceContent: null,
    watermark: null,
  } as CardPreviewData;
}

async function bake(data: CardPreviewData, preset: RenderPreset): Promise<Raw> {
  const res = await renderCardImage(data, preset, { brandMark: false, watermarkText: null });
  const { data: px, info } = await sharp(Buffer.from(await res.arrayBuffer()))
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data: px, width: info.width, height: info.height };
}

describe("2003 footer ink — the profiles", () => {
  it("white on `modern`/b and on every `modernland` key, the slot's dark ink everywhere else, no shadow", () => {
    const modern = getFrameProfile("modern");
    const land = getFrameProfile("modernland");
    for (const [template, key] of WHITE) {
      const profile = template === "modern" ? modern : land;
      expect(footerInk(profile.footer!, key, profile), `${template}/${key}`).toEqual({ colorHex: "#ffffff", shadowCss: undefined });
    }
    for (const [, key] of DARK) {
      expect(footerInk(modern.footer!, key, modern), `modern/${key}`).toEqual({ colorHex: modern.footer!.colorHex, shadowCss: undefined });
    }
    expect(lumOf(hex(modern.footer!.colorHex))).toBeLessThan(40);
    // Nothing else on the pair takes an ink map: the name, the type line and
    // the P/T print dark on every colour (their bars and plate are light
    // even on the black frame), as the prints do.
    for (const profile of [modern, land]) {
      expect(profile.title.inkByColorKey).toBeUndefined();
      expect(profile.type.inkByColorKey).toBeUndefined();
      expect(profile.pt!.inkByColorKey).toBeUndefined();
      for (const key of KEYS) expect(slotInk(profile.pt!, key).colorHex).toBe(profile.pt!.colorHex);
    }
  });

  it("a frame-compare override of the footer's box keeps the ink map (it is code-owned)", () => {
    for (const template of ["modern", "modernland"] as const) {
      const moved = resolveFrameProfile(template, { [template]: { footer: { rect: { topPct: 92 } } } });
      expect(moved.footer!.rect.topPct).toBe(92);
      expect(footerInk(moved.footer!, "b", moved).colorHex, template).toBe("#ffffff");
      expect(moved.footer!.inkByColorKey).toEqual(getFrameProfile(template).footer!.inkByColorKey);
    }
  });

  it.each(WHITE)("%s/%s: the artist line reads at 8 : 1 or better on its master (it was under 2.4 : 1)", async (template, key) => {
    const profile = getFrameProfile(template);
    const ground = await footerGround(template, key);
    const ink = footerInk(profile.footer!, key, profile);
    expect(contrast(hex(ink.colorHex), ground)).toBeGreaterThanOrEqual(8);
    // The ink the slot printed before (the slot's own colour).
    expect(contrast(hex(profile.footer!.colorHex), ground)).toBeLessThan(2.4);
  });

  it.each(DARK)("%s/%s keeps the dark ink, which reads better there than white would", async (template, key) => {
    const profile = getFrameProfile(template);
    const ground = await footerGround(template, key);
    const ink = footerInk(profile.footer!, key, profile);
    expect(ink.colorHex).toBe(profile.footer!.colorHex);
    // Green is the closest call (3.8 : 1 dark, 4.9 : 1 white on the MSE
    // master) and the prints set it black: left as it is (4.10b's masters).
    if (key !== "g") expect(contrast(hex(ink.colorHex), ground)).toBeGreaterThan(contrast([255, 255, 255], ground));
  });
});

describe.each(["default", "hd"] as const)("2003 footer ink — the bake at %s", (preset) => {
  const { width, height } = RENDER_PRESETS[preset];

  /** The footer slot's pixels in the bake and in the bare master at the
   *  bake's size, and how many of them the lettering made LIGHTER / DARKER
   *  than the master by 60 luma or more. */
  async function lettering(template: FrameTemplate, key: Key) {
    const profile = getFrameProfile(template);
    const r = await bake(card(template, key), preset);
    expect([r.width, r.height]).toEqual([width, height]);
    const { data } = await sharp(`public/frames/${template}/${key}.png`)
      .flatten({ background: "#000" })
      .resize(width, height, { fit: "fill" })
      .raw()
      .toBuffer({ resolveWithObject: true });
    const bare: Raw = { data, width, height };
    const pixels = rectPixels(r, profile.footer!.rect);
    const lighter = pixels.filter((o) => lumOf(at(r, o)) > lumOf(at(bare, o)) + 60);
    const darker = pixels.filter((o) => lumOf(at(r, o)) < lumOf(at(bare, o)) - 60);
    return { r, pixels, lighter, darker };
  }

  it.each(WHITE)("%s/%s: the artist line is drawn in white", async (template, key) => {
    const { r, lighter, darker } = await lettering(template, key);
    // Lettering, and only light lettering (no shadow under it).
    expect(lighter.length).toBeGreaterThan(preset === "hd" ? 1200 : 250);
    expect(darker.length).toBe(0);
    // Its solid strokes are the ink itself: the lightest tenth is white.
    const lums = lighter.map((o) => lumOf(at(r, o))).sort((a, b) => b - a);
    expect(lums[Math.floor(lums.length / 10)]).toBeGreaterThan(235);
  }, 60_000);

  it.each(DARK)("%s/%s: the artist line is drawn in the dark ink, as before", async (template, key) => {
    const { lighter, darker } = await lettering(template, key);
    expect(lighter.length).toBe(0);
    // Green's ground is too dark for a 60-luma step (the reason the line
    // reads poorly there; untouched here).
    if (key !== "g") expect(darker.length).toBeGreaterThan(preset === "hd" ? 1200 : 250);
  }, 60_000);
});
