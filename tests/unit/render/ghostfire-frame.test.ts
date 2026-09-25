import sharp from "sharp";
import { describe, expect, it } from "vitest";
import type { CardPreviewData } from "@/components/cards/card-preview";
import { getFrameProfile } from "@/lib/cards/template-layout";
import { renderCardImage, RENDER_PRESETS } from "@/lib/render/card-image";

// ---------------------------------------------------------------------------
// Ghostfire (tarkirghostfire, owner review 2026-09-25). The frame bakes MSE's
// translucent teal namebox / typebox / textbox under the outline and ships
// its P/T ribbon, and the profile sets white ink inside the bands. The
// frame is a git frame (public/frames), so the bakes below are real and
// offline. Rendered at the "default" preset (750 × 1050).
// ---------------------------------------------------------------------------

const COLORS = ["w", "u", "b", "r", "g", "c", "m"] as const;
const W = RENDER_PRESETS.default.width;
const H = RENDER_PRESETS.default.height;

// Band interiors on the 1500 × 2100 masters (between the outline runs).
const TYPE_BAND = { top: 51.38, bottom: 56.86 };

async function rgba(file: string) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const at = (xPct: number, yPct: number) => {
    const i = (Math.round((info.height * yPct) / 100) * info.width + Math.round((info.width * xPct) / 100)) * 4;
    return [data[i], data[i + 1], data[i + 2], data[i + 3]];
  };
  return { info, at };
}

describe("Ghostfire frame masters", () => {
  it("bakes the teal boxes at 60 % under the outline, same art for every colour key", async () => {
    for (const c of COLORS) {
      const { info, at } = await rgba(`public/frames/tarkirghostfire/${c}.png`);
      expect([info.width, info.height], c).toEqual([1500, 2100]);
      // Name band, type band and text box: MSE's #03586b at set_alpha 60 %.
      for (const [x, y] of [[30, 7.7], [30, 54.1], [30, 70]]) {
        expect(at(x, y), `${c} @ ${x},${y}`).toEqual([3, 88, 107, 153]);
      }
      // The art window stays a transparent cut-out.
      expect(at(50, 30)[3], `${c} art window`).toBe(0);
      const webp = await sharp(`public/frames/tarkirghostfire/${c}.webp`).metadata();
      expect([webp.width, webp.height], `${c}.webp`).toEqual([1500, 2100]);
    }
  });

  it("ships the 385 × 208 P/T ribbon for every colour, drawn exactly at its crop box", async () => {
    for (const c of COLORS) {
      const meta = await sharp(`public/frames/tarkirghostfire/pt/${c}.png`).metadata();
      expect([meta.width, meta.height], c).toEqual([385, 208]);
      const webp = await sharp(`public/frames/tarkirghostfire/pt/${c}.webp`).metadata();
      expect([webp.width, webp.height], `${c}.webp`).toEqual([385, 208]);
    }
    // scripts/build-showcase-frames.mjs crops MSE's pt.png at 1093,1768 on
    // the 1500 × 2100 card.
    const pt = getFrameProfile("tarkirghostfire").pt!;
    expect(pt.plateAssetPathTemplate).toBe("/frames/tarkirghostfire/pt/{color}.png");
    const r = pt.plateRect!;
    expect((r.leftPct / 100) * 1500).toBeCloseTo(1093, 0);
    expect((r.topPct / 100) * 2100).toBeCloseTo(1768, 0);
    expect((r.widthPct / 100) * 1500).toBeCloseTo(385, 0);
    expect((r.heightPct / 100) * 2100).toBeCloseTo(208, 0);
  });

  it("leaves Bloomburrow Anime (the other borderlessShowcase) as it was", () => {
    const anime = getFrameProfile("bloomanime");
    expect(anime.rules.backdropHex).toBe("rgba(8,8,12,0.55)");
    expect(anime.title.sizePct).toBe(0.044);
    expect(anime.type.rect).toEqual({ topPct: 56, leftPct: 8, widthPct: 84, heightPct: 4.5 });
    expect(anime.pt?.plateAssetPathTemplate).toBeUndefined();
  });
});

function card(over: Partial<CardPreviewData> = {}): CardPreviewData {
  return {
    title: "Veil of Echoes",
    cost: "{1}{U}{U}",
    cardType: "enchantment",
    supertype: null,
    subtypes: [],
    rarity: "mythic",
    colorIdentity: ["colorless"],
    rulesText: "Vigilance",
    flavorText: null,
    power: null,
    toughness: null,
    loyalty: null,
    defense: null,
    artistCredit: "Probe",
    artUrl: null,
    artPosition: {},
    frameStyle: { template: "tarkirghostfire", finish: "regular" },
    setIconUrl: null,
    setIconCode: null,
    backFace: null,
    faceContent: null,
    watermark: null,
    ...over,
  } as CardPreviewData;
}

type Raw = { data: Buffer; width: number };
async function bake(data: CardPreviewData): Promise<Raw> {
  const res = await renderCardImage(data, "default", { brandMark: false, watermarkText: null });
  const { data: px, info } = await sharp(Buffer.from(await res.arrayBuffer()))
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  expect([info.width, info.height]).toEqual([W, H]);
  return { data: px, width: info.width };
}

const px = (r: Raw, x: number, y: number) => {
  const i = (y * r.width + x) * 3;
  return [r.data[i], r.data[i + 1], r.data[i + 2]];
};

/** Bounding box of pixels that differ by more than 24 on any channel. */
function diffBox(a: Raw, b: Raw) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const p = px(a, x, y);
      const q = px(b, x, y);
      if (p.some((v, k) => Math.abs(v - q[k]) > 24)) {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
    }
  }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}

describe("Ghostfire bake", () => {
  it("draws the type line in white ink inside the type band (it sat on the lower rim)", async () => {
    const [enchantment, artifact] = [await bake(card()), await bake(card({ cardType: "artifact" }))];
    const box = diffBox(enchantment, artifact)!;
    expect(box).not.toBeNull();
    expect((box.y0 / H) * 100).toBeGreaterThan(TYPE_BAND.top);
    expect(((box.y1 + 1) / H) * 100).toBeLessThan(TYPE_BAND.bottom);
    expect((box.x0 / W) * 100).toBeGreaterThan(8);
    expect((box.x0 / W) * 100).toBeLessThan(9.5);
    // Centred in the band and at the scan-measured size: a smaller type or a
    // shift that still stays inside the band must fail too.
    expect(Math.abs(((box.y0 + box.y1 + 1) / 2 / H) * 100 - 54.12)).toBeLessThan(0.4);
    // 195 px = the "Enchantment"/"Artifact" difference at sizePct 0.0445, the
    // size that lands the scan's "Creature — Dragon" at 561 px (1500 wide).
    expect(Math.abs(box.x1 - box.x0 + 1 - 195) / 195).toBeLessThan(0.03);
    // White ink: the brightest glyph pixels are near-white, not INK_DARK.
    let bright = 0;
    for (let y = box.y0; y <= box.y1; y += 1) {
      for (let x = box.x0; x <= box.x1; x += 1) {
        if (px(enchantment, x, y).every((v) => v > 200)) bright += 1;
      }
    }
    expect(bright).toBeGreaterThan(200);
  }, 60_000);

  it("puts white P/T digits on the ribbon plate", async () => {
    const creature = { cardType: "creature", subtypes: ["Dragon"] } as Partial<CardPreviewData>;
    const [none, three, eight] = [
      await bake(card(creature)),
      await bake(card({ ...creature, power: "3", toughness: "3" })),
      await bake(card({ ...creature, power: "8", toughness: "8" })),
    ];
    // The whole change is the plate, drawn at its crop box (1093,1768
    // 385 × 208 on 1500 × 2100 → half that here).
    const plate = diffBox(none, three)!;
    expect(Math.abs(plate.x0 - 546)).toBeLessThanOrEqual(3);
    expect(Math.abs(plate.y0 - 884)).toBeLessThanOrEqual(3);
    expect(Math.abs(plate.x1 - 738)).toBeLessThanOrEqual(3);
    expect(Math.abs(plate.y1 - 987)).toBeLessThanOrEqual(3);
    // Digits (what changes between 3/3 and 8/8): centred where the TDM #400
    // scan prints them (86.1 %W, 90.4 %H), in white ink.
    const digits = diffBox(three, eight)!;
    const cx = ((digits.x0 + digits.x1 + 1) / 2 / W) * 100;
    const cy = ((digits.y0 + digits.y1 + 1) / 2 / H) * 100;
    expect(cx).toBeGreaterThan(85);
    expect(cx).toBeLessThan(87.2);
    expect(cy).toBeGreaterThan(89.6);
    expect(cy).toBeLessThan(91.2);
    let white = 0;
    for (let y = digits.y0; y <= digits.y1; y += 1) {
      for (let x = digits.x0; x <= digits.x1; x += 1) {
        if (px(three, x, y).every((v) => v > 215)) white += 1;
      }
    }
    expect(white).toBeGreaterThan(300);
  }, 60_000);

  it("draws no scrim over the baked text box", async () => {
    const [none, rules] = [await bake(card({ rulesText: null })), await bake(card())];
    // A text-free spot inside the rules rect: a scrim would darken it.
    for (const [xPct, yPct] of [[85, 62], [85, 84], [20, 84]]) {
      const x = Math.round((W * xPct) / 100);
      const y = Math.round((H * yPct) / 100);
      expect(px(rules, x, y), `${xPct},${yPct}`).toEqual(px(none, x, y));
    }
  }, 60_000);
});
