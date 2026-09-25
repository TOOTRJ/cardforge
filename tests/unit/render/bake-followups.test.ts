import sharp from "sharp";
import { describe, expect, it } from "vitest";
import type { CardPreviewData } from "@/components/cards/card-preview";
import type { FrameTemplate } from "@/types/card";
import { getFrameProfile } from "@/lib/cards/template-layout";
import { renderCardImage, RENDER_PRESETS } from "@/lib/render/card-image";

// ---------------------------------------------------------------------------
// Frame-review follow-ups (layout v25/v26, owner review 2026-09-25), pinned on
// REAL bakes rather than source greps: every template here draws a git frame
// from public/frames (read from disk), so the renders are deterministic and
// offline. Rendered at the "default" preset (750 × 1050).
// ---------------------------------------------------------------------------

const W = RENDER_PRESETS.default.width;
const H = RENDER_PRESETS.default.height;

function card(template: FrameTemplate, over: Partial<CardPreviewData> = {}): CardPreviewData {
  return {
    title: "Probe Knight",
    cost: "{2}{W}",
    cardType: "creature",
    supertype: null,
    subtypes: ["Human", "Knight"],
    rarity: "uncommon",
    colorIdentity: ["white"],
    rulesText: "Vigilance",
    flavorText: null,
    power: "4",
    toughness: "4",
    loyalty: null,
    defense: null,
    artistCredit: "Probe",
    artUrl: null,
    artPosition: {},
    frameStyle: { template, finish: "regular" },
    setIconUrl: null,
    setIconCode: null,
    backFace: null,
    faceContent: null,
    watermark: null,
    ...over,
  } as CardPreviewData;
}

type Raw = { data: Buffer; width: number; height: number };
async function bake(data: CardPreviewData, brandMark = false): Promise<Raw> {
  const res = await renderCardImage(data, "default", { brandMark, watermarkText: null });
  const { data: px, info } = await sharp(Buffer.from(await res.arrayBuffer()))
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data: px, width: info.width, height: info.height };
}

/** Bounding box of pixels that differ by more than 24 on any channel. */
function diffBox(a: Raw, b: Raw) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < a.height; y += 1) {
    for (let x = 0; x < a.width; x += 1) {
      const i = (y * a.width + x) * 3;
      if (
        Math.abs(a.data[i] - b.data[i]) > 24 ||
        Math.abs(a.data[i + 1] - b.data[i + 1]) > 24 ||
        Math.abs(a.data[i + 2] - b.data[i + 2]) > 24
      ) {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
    }
  }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}

const lum = (r: Raw, x: number, y: number) => {
  const i = (y * r.width + x) * 3;
  return 0.299 * r.data[i] + 0.587 * r.data[i + 1] + 0.114 * r.data[i + 2];
};

describe("etched finish (v26)", () => {
  it.each<FrameTemplate>(["retro", "modern"])("%s: texture on the frame only — no left-edge strip, border and art untouched", async (template) => {
    const [regular, etched] = [await bake(card(template)), await bake(card(template, { frameStyle: { template, finish: "etched" } }))];
    // Black border = pixels that are black in the regular bake. The texture
    // is masked by the frame's luminance, so near-black frame pixels may move
    // by a few levels (measured max 30 of 765 summed RGB); the old Fragment
    // bug painted a gold (#d4a64a) strip OVER the black border — ~450.
    let border = 0;
    let art = 0;
    let frame = 0;
    const artSlot = getFrameProfile(template).artSlot;
    const ax0 = Math.ceil((W * (artSlot.leftPct + 1)) / 100);
    const ax1 = Math.floor((W * (artSlot.leftPct + artSlot.widthPct - 1)) / 100);
    const ay0 = Math.ceil((H * (artSlot.topPct + 1)) / 100);
    const ay1 = Math.floor((H * (artSlot.topPct + artSlot.heightPct - 1)) / 100);
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        const i = (y * W + x) * 3;
        const d = Math.abs(regular.data[i] - etched.data[i]) + Math.abs(regular.data[i + 1] - etched.data[i + 1]) + Math.abs(regular.data[i + 2] - etched.data[i + 2]);
        if (d === 0) continue;
        if (lum(regular, x, y) < 12) {
          if (d > 60) border += 1;
        }
        else if (x >= ax0 && x <= ax1 && y >= ay0 && y <= ay1) art += 1;
        else frame += 1;
      }
    }
    expect(border).toBe(0);
    expect(art).toBe(0);
    expect(frame).toBeGreaterThan(5000);
  }, 60_000);
});

describe("pipglyph.com mark sits inside the black border (v25)", () => {
  // extendedart shares modern's placement (brand-mark-placement.test.ts) but
  // preloads the bucket-hosted M15 P/T plate, so it can't bake offline here.
  it.each<FrameTemplate>(["agclassic", "alphaland", "alphatoken", "retro", "retroland", "modern", "modernland", "battle", "split"])(
    "%s",
    async (template) => {
      // No P/T: extendedart draws the M15 plate, which lives in the frames
      // bucket (not on disk). The mark's placement doesn't depend on it.
      const land = template === "alphaland" || template === "retroland" || template === "modernland";
      const data = card(template, { cardType: land ? "land" : "instant", cost: land ? null : "{2}{W}", power: null, toughness: null });
      const [off, on] = [await bake(data, false), await bake(data, true)];
      const box = diffBox(off, on);
      expect(box).not.toBeNull();
      // Every pixel the mark covers must be black border in the unmarked bake.
      let lit = 0;
      let total = 0;
      for (let y = box!.y0; y <= box!.y1; y += 1) {
        for (let x = box!.x0; x <= box!.x1; x += 1) {
          total += 1;
          if (lum(off, x, y) > 40) lit += 1;
        }
      }
      expect(lit / total).toBeLessThan(0.01);
    },
    60_000,
  );
});

describe("Alpha P/T sits in the strip below the text box (v25)", () => {
  it("centres the digits in the strip (90.62–96.14 %H on the agclassic masters)", async () => {
    const [none, pt] = [await bake(card("agclassic", { power: null, toughness: null })), await bake(card("agclassic"))];
    const box = diffBox(none, pt)!;
    const cy = ((box.y0 + box.y1 + 1) / 2 / H) * 100;
    const cx = ((box.x0 + box.x1 + 1) / 2 / W) * 100;
    const at = (cy - 90.62) / (96.14 - 90.62);
    // Printed Alpha/Beta digits sit at 0.485–0.515 of the strip, ~88 %W.
    expect(at).toBeGreaterThan(0.44);
    expect(at).toBeLessThan(0.56);
    expect(cx).toBeGreaterThan(86);
    expect(cx).toBeLessThan(90.5);
  }, 60_000);
});

describe("Dragon Wing P/T plates (v25)", () => {
  it("ships a 271 × 149 plate for every colour, drawn exactly at its crop box", async () => {
    for (const c of ["w", "u", "b", "r", "g", "c", "m"]) {
      const meta = await sharp(`public/frames/tarkirdragon/pt/${c}.png`).metadata();
      expect([meta.width, meta.height], c).toEqual([271, 149]);
      const webp = await sharp(`public/frames/tarkirdragon/pt/${c}.webp`).metadata();
      expect([webp.width, webp.height], `${c}.webp`).toEqual([271, 149]);
    }
    // scripts/build-showcase-frames.mjs crops MSE's plate at 1156,1850 on the
    // 1500 × 2100 card.
    const r = getFrameProfile("tarkirdragon").pt!.plateRect!;
    expect((r.leftPct / 100) * 1500).toBeCloseTo(1156, 0);
    expect((r.topPct / 100) * 2100).toBeCloseTo(1850, 0);
    expect((r.widthPct / 100) * 1500).toBeCloseTo(271, 0);
    expect((r.heightPct / 100) * 2100).toBeCloseTo(149, 0);
  });
});
