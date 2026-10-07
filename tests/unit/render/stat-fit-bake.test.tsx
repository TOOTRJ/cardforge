import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CardPreviewData } from "@/components/cards/card-preview";
import type { FrameTemplate } from "@/types/card";
import { getFrameProfile } from "@/lib/cards/template-layout";
import { renderCardImage } from "@/lib/render/card-image";
import { serveStandInFrames, type StandInFrames } from "@/tests/stubs/stand-in-frames";

// ---------------------------------------------------------------------------
// Stat shrink-to-fit (TODO 3.18) and the Draconic P/T plate (TODO 4.31) on
// REAL HD bakes. Every template here draws a git frame from public/frames
// (read from disk), so the renders are deterministic and offline — but
// flip and battle, whose Card Conjurer masters live in the frames bucket
// (layouts v38 / v43): they are served a flat stand-in master and plates
// (tests/stubs/stand-in-frames.ts). The M15 plate lives in the frames bucket
// too; its fit is pinned in stat-fit.test.ts.
// ---------------------------------------------------------------------------

let frames: StandInFrames;
beforeAll(async () => {
  frames = await serveStandInFrames([
    { template: "flip", keys: ["r"] },
    { template: "battle", keys: ["r"] },
  ]);
}, 60_000);
afterAll(() => frames.restore());

function card(template: FrameTemplate, over: Partial<CardPreviewData> = {}): CardPreviewData {
  return {
    title: "Probe Dragon",
    cost: "{3}{R}{R}",
    cardType: "creature",
    supertype: null,
    subtypes: ["Dragon"],
    rarity: "rare",
    colorIdentity: ["red"],
    rulesText: "Flying",
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
async function bake(data: CardPreviewData): Promise<Raw> {
  const res = await renderCardImage(data, "hd", { brandMark: false, watermarkText: null });
  const { data: px, info } = await sharp(Buffer.from(await res.arrayBuffer()))
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data: px, width: info.width, height: info.height };
}

/** Bounding box (HD px) of pixels that differ by more than 24 on any channel. */
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
  return x1 < 0 ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}

const lum = (r: Raw, x: number, y: number) => {
  const i = (y * r.width + x) * 3;
  return 0.299 * r.data[i] + 0.587 * r.data[i + 1] + 0.114 * r.data[i + 2];
};

describe("long stats shrink to fit", () => {
  it("Alpha: *+1/*+1 ends inside the pinstripe, centred where 10/10 is", async () => {
    const colorIdentity: CardPreviewData["colorIdentity"] = ["white"];
    const none = await bake(card("agclassic", { colorIdentity, power: null, toughness: null }));
    const long = diffBox(none, await bake(card("agclassic", { colorIdentity, power: "*+1", toughness: "*+1" })))!;
    const short = diffBox(none, await bake(card("agclassic", { colorIdentity, power: "10", toughness: "10" })))!;
    // The strip's pinstripe is a dark line from ~1405 px (alphaland) / ~1410
    // (agclassic); the value used to run to ~1430, into the black border.
    expect(long.x1).toBeLessThanOrEqual(1404);
    expect(long.x0).toBeGreaterThanOrEqual(1236);
    expect(Math.abs((long.x0 + long.x1) / 2 - (short.x0 + short.x1) / 2)).toBeLessThan(4);
  }, 60_000);

  it("Modern: 100/100 stays on the plate's light face (1143–1373 px), off the bevel", async () => {
    const small = await bake(card("modern", { power: "1", toughness: "1" }));
    const box = diffBox(small, await bake(card("modern", { power: "100", toughness: "100" })))!;
    expect(box.x0).toBeGreaterThanOrEqual(1143);
    expect(box.x1).toBeLessThanOrEqual(1373);
  }, 60_000);

  it("Retro: *+1/*+1 fits the strip at full size — on ONE line, centred, though wider than its rect", async () => {
    const none = await bake(card("retro", { power: null, toughness: null }));
    const long = diffBox(none, await bake(card("retro", { power: "*+1", toughness: "*+1" })))!;
    const short = diffBox(none, await bake(card("retro", { power: "4", toughness: "4" })))!;
    const rect = getFrameProfile("retro").pt!.rect;
    // Wider than the 210 px rect (it used to wrap after the slash, two lines).
    expect(long.x1 - long.x0).toBeGreaterThan((rect.widthPct / 100) * 1500);
    expect(long.y1 - long.y0).toBeLessThan((short.y1 - short.y0) * 1.3);
    // Centred like the preview's span, not run off the rect's right edge.
    expect(Math.abs((long.x0 + long.x1) / 2 - (short.x0 + short.x1) / 2)).toBeLessThan(4);
    expect(long.x0).toBeGreaterThanOrEqual(1125);
    expect(long.x1).toBeLessThanOrEqual(1410);
  }, 60_000);

  it("Flip: the upside-down second face shrinks 100/100 into its plate's face (93–272 px)", async () => {
    const flip = (power: string, toughness: string) =>
      card("flip", {
        power: "2",
        toughness: "2",
        backFace: { title: "Probe Reborn", card_type: "creature", subtypes: ["Spirit"], rules_text: "Flying", power, toughness },
      } as Partial<CardPreviewData>);
    // Both bakes draw the bottom plate (layout v38): the diff is the digits.
    const box = diffBox(await bake(flip("1", "1")), await bake(flip("100", "100")))!;
    // The plate's light face on the digits' rows (FLIP's secondFace.pt
    // inkSpanPct): 93–272 px; before v38's plates, the band ran 104–258.
    expect(box.x0).toBeGreaterThanOrEqual(92);
    expect(box.x1).toBeLessThanOrEqual(273);
  }, 60_000);

  it("Battle: a three-digit defense shrinks into the painted shield's black interior (1932–2019 px), and no badge is drawn", async () => {
    // TODO 4.21b (layout v43): the defense is the value alone, in the
    // shield Card Conjurer's master paints — the drawn disc and its outline
    // are gone. (The stand-in master is flat grey: the value is the only
    // mark the defense adds.)
    const battle = (defense: string | null) =>
      card("battle", { cardType: "battle", subtypes: ["Siege"], power: null, toughness: null, defense });
    const slot = getFrameProfile("battle").defense!;
    // Landscape: 2100 × 1500.
    const [spanL, spanR] = [(slot.inkSpanPct!.leftPct / 100) * 2100, (slot.inkSpanPct!.rightPct / 100) * 2100];
    expect([Math.round(spanL), Math.round(spanR)]).toEqual([1932, 2019]);
    const none = await bake(battle(null));
    const one = await bake(battle("5"));
    const three = await bake(battle("100"));
    const wide = diffBox(none, three)!;
    // The ink may reach the interior's edge (one antialiased pixel either way).
    expect(wide.x0).toBeGreaterThanOrEqual(Math.floor(spanL) - 1);
    expect(wide.x1).toBeLessThanOrEqual(Math.ceil(spanR) + 1);
    // …and shrinks no further than it must: it still spans the interior.
    expect(spanR - spanL).toBeLessThan(wide.x1 - wide.x0 + 12);
    // A printed battle's one digit: 78 px, centred where the prints centre
    // theirs (the pack's 1962 px across + the shield's 12 px — TODO 4.21d —
    // and 82 px below the shield's top point).
    const digit = diffBox(none, one)!;
    const shield = slot.paintedRect!;
    expect(Math.abs((digit.x0 + digit.x1) / 2 - 1974)).toBeLessThan(3);
    expect(Math.abs((digit.y0 + digit.y1) / 2 - ((shield.topPct / 100) * 1500 + 82))).toBeLessThan(3);
    expect(digit.y1 - digit.y0).toBeGreaterThan(52);
    expect(digit.y1 - digit.y0).toBeLessThan(62);
    // No drawn badge: the defense adds nothing but the digit's own ink — a
    // box as narrow as the digit (the MSE profile's dark disc was 128 px
    // wide and 101 tall), and every pixel it changes is LIGHTER than the
    // stand-in master's grey (white ink; a disc or an outline would darken).
    expect(digit.x1 - digit.x0).toBeLessThan(48);
    let darker = 0;
    for (let y = digit.y0; y < digit.y1; y += 1) {
      for (let x = digit.x0; x < digit.x1; x += 1) {
        if (lum(one, x, y) < lum(none, x, y) - 24) darker += 1;
      }
    }
    expect(darker).toBe(0);
  }, 60_000);
});

describe("Draconic P/T plate (TDM #321 Ureni, #301 Magmatic Hellkite)", () => {
  it("ships a 368 × 188 plate for every colour, drawn exactly at its crop box", async () => {
    for (const c of ["w", "u", "b", "r", "g", "c", "m"]) {
      const meta = await sharp(`public/frames/tarkirdraconic/pt/${c}.png`).metadata();
      expect([meta.width, meta.height], c).toEqual([368, 188]);
      const webp = await sharp(`public/frames/tarkirdraconic/pt/${c}.webp`).metadata();
      expect([webp.width, webp.height], `${c}.webp`).toEqual([368, 188]);
    }
    // scripts/build-showcase-frames.mjs crops MSE's plate at 1132,1813 on the
    // 1500 × 2100 card.
    const r = getFrameProfile("tarkirdraconic").pt!.plateRect!;
    expect((r.leftPct / 100) * 1500).toBeCloseTo(1132, 0);
    expect((r.topPct / 100) * 2100).toBeCloseTo(1813, 0);
    expect((r.widthPct / 100) * 1500).toBeCloseTo(368, 0);
    expect((r.heightPct / 100) * 2100).toBeCloseTo(188, 0);
  });

  it.each<[string, CardPreviewData["colorIdentity"]]>([
    ["r", ["red"]],
    ["m", ["green", "blue", "red"]],
  ])("%s: dark digits on the serpent-ringed light box", async (_key, colorIdentity) => {
    const none = await bake(card("tarkirdraconic", { colorIdentity, power: null, toughness: null }));
    const pt = await bake(card("tarkirdraconic", { colorIdentity, power: "10", toughness: "10" }));
    // The plate is drawn with the value (1132–1500 × 1813–2001 px, running
    // to the card's right edge) — the old slot drew white digits only.
    const box = diffBox(none, pt)!;
    expect(box.x0).toBeLessThanOrEqual(1140);
    expect(box.x1).toBeGreaterThanOrEqual(1480);
    // Ink: dark digits centred where the scans print them (86.0 %W, 91.7 %H).
    const rect = getFrameProfile("tarkirdraconic").pt!.rect;
    let dark = 0;
    let white = 0;
    let sx = 0;
    let sy = 0;
    for (let y = Math.round((rect.topPct / 100) * 2100); y < ((rect.topPct + rect.heightPct) / 100) * 2100; y += 1) {
      for (let x = Math.round((rect.leftPct / 100) * 1500); x < ((rect.leftPct + rect.widthPct) / 100) * 1500; x += 1) {
        const l = lum(pt, x, y);
        if (l < 60) {
          dark += 1;
          sx += x;
          sy += y;
        }
        if (l > 250) white += 1;
      }
    }
    expect(dark).toBeGreaterThan(2500);
    expect(white).toBe(0);
    expect(Math.abs(sx / dark / 1500 - 0.86)).toBeLessThan(0.006);
    expect(Math.abs(sy / dark / 2100 - 0.917)).toBeLessThan(0.006);
  }, 60_000);
});
