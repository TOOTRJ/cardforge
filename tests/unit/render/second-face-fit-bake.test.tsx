import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { CardPreviewData } from "@/components/cards/card-preview";
import { displayLine } from "@/lib/cards/card-display";
import { measuredLinePx, secondFaceLineSizes } from "@/lib/cards/render-tiers";
import { RENDER_PRESETS } from "@/lib/render/card-image";
import { displayRunPx } from "@/lib/render/satori-text";
import { serveStandInFrames, type StandInFrames } from "@/tests/stubs/stand-in-frames";

// ---------------------------------------------------------------------------
// A `fitLines` second face's shrunk name on a REAL bake (layout v32): set at
// measuredLinePx — the whole pixel BELOW its fit, as the front's name — not
// rounded up (a fit of 26.6 px drew at 27 and ran the line past its fit).
// Flip's upside-down creature; its Card Conjurer master lives in the frames
// bucket (layout v38), so the bake is served a flat stand-in master and
// plates (tests/stubs/stand-in-frames.ts). The second face's name is
// recoloured pure magenta (colour only), so its ink is the only magenta on
// the card.
// ---------------------------------------------------------------------------

let frames: StandInFrames;
beforeAll(async () => {
  frames = await serveStandInFrames([{ template: "flip", keys: ["r"] }]);
}, 60_000);
afterAll(() => frames.restore());

vi.mock("@/lib/cards/template-layout", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/cards/template-layout")>();
  return {
    ...real,
    getFrameProfile: (template?: string) => {
      const p = real.getFrameProfile(template);
      if (template !== "flip" || !p.secondFace) return p;
      return { ...p, secondFace: { ...p.secondFace, title: { ...p.secondFace.title, colorHex: "#ff00ff" } } };
    },
  };
});

const { width: W, height: H } = RENDER_PRESETS.default;
const magenta = (r: number, g: number, b: number) => r > 170 && b > 170 && g < 110;

describe("a fitLines second face's shrunk name — real bake", () => {
  it("is drawn at the whole px below its fit, like the front's", async () => {
    const { getFrameProfile } = await import("@/lib/cards/template-layout");
    const face = getFrameProfile("flip").secondFace!;
    expect(face.fitLines).toBe(true);
    // A name whose fit lands in the upper half of a pixel at 750 wide, so
    // rounding and flooring differ.
    const candidates = [
      "Rune-Tail, Kitsune Ascendant of the Hidden Vale",
      "Ichiga, Who Topples Oaks and Mountains Alike",
      "Homura, Human Ascendant of the Burning Sky",
      "Kenzo the Hardhearted, Warden of the Old Gate",
      "Tomoya the Revealer of Many Hidden Paths",
      "Sasaya's Essence Ascendant of the Wild Hunt",
    ];
    const pick = candidates
      .map((name) => ({ name, fit: secondFaceLineSizes({ slot: face, name, typeLine: "Legendary Creature — Spirit", cost: null }) }))
      .find(({ fit }) => fit.titleSizePct < face.title.sizePct && (fit.titleSizePct * W) % 1 >= 0.5 && fit.titleText !== "");
    expect(pick, "a candidate with a fit in a pixel's upper half").toBeDefined();
    const { name, fit } = pick!;
    expect(fit.titleText).toBe(name);
    const floorPx = measuredLinePx(fit.titleSizePct, face.title.sizePct, W);
    expect(floorPx).toBe(Math.floor(fit.titleSizePct * W));

    const card = {
      title: "Probe",
      cost: "{2}{R}",
      cardType: "creature",
      supertype: null,
      subtypes: [],
      rarity: "common",
      colorIdentity: ["red"],
      rulesText: null,
      flavorText: null,
      power: "2",
      toughness: "2",
      loyalty: null,
      defense: null,
      artistCredit: "Probe",
      artUrl: null,
      artPosition: {},
      frameStyle: { template: "flip", finish: "regular" },
      setIconUrl: null,
      setIconCode: null,
      backFace: { title: name, card_type: "creature", supertype: "Legendary", subtypes: ["Spirit"], power: "4", toughness: "4" },
      faceContent: null,
      watermark: null,
    } as unknown as CardPreviewData;
    const mod = await import("@/lib/render/card-image");
    const png = Buffer.from(await (await mod.renderCardImage(card, "default", { brandMark: false, watermarkText: null })).arrayBuffer());
    const data = await sharp(png).removeAlpha().raw().toBuffer();
    const rect = face.title.rect;
    let left: number = W;
    let right = -1;
    for (let y = Math.floor((rect.topPct / 100) * H) - 10; y < Math.ceil(((rect.topPct + rect.heightPct) / 100) * H) + 10; y += 1) {
      for (let x = 0; x < W; x += 1) {
        const i = (y * W + x) * 3;
        if (!magenta(data[i], data[i + 1], data[i + 2])) continue;
        left = Math.min(left, x);
        right = Math.max(right, x);
      }
    }
    const inkWidth = right - left + 1;
    const at = (px: number) => displayRunPx(displayLine(name), px, 0).ink;
    // The ink spans the run at the floored px (its side bearings aside),
    // clearly shorter than the rounded-up px would draw.
    expect(Math.abs(inkWidth - at(floorPx))).toBeLessThanOrEqual(6);
    expect(at(floorPx + 1) - inkWidth).toBeGreaterThan(8);
  });
});
