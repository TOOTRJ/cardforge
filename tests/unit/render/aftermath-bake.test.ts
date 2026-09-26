import sharp from "sharp";
import { describe, expect, it } from "vitest";
import type { CardPreviewData } from "@/components/cards/card-preview";
import type { CardBackFace } from "@/types/card";
import { getFrameProfile, type Rect } from "@/lib/cards/template-layout";
import { renderCardImage, RENDER_PRESETS } from "@/lib/render/card-image";

// ---------------------------------------------------------------------------
// Aftermath's sideways bottom half (TODO 0.22 + the 4.31 rotated-art note),
// pinned on REAL bakes: the aftermath frame is a git file under
// public/frames (read from disk), so these are offline and deterministic.
// Rendered at the "default" preset (750 × 1050).
//
// The printed Cut // Ribbons and Commit // Memory turn the bottom half 90°
// CLOCKWISE (Card Conjurer too): the second name reads top → bottom with its
// cost at the bottom, and the sideways art's top faces the title bar. The
// half used to turn the other way (270°), and Satori drew the sideways art
// with an art-free strip across the window.
// ---------------------------------------------------------------------------

const W = RENDER_PRESETS.default.width;
const H = RENDER_PRESETS.default.height;
const BG = [16, 16, 21]; // the bake's page colour (#101015), under the frame

function card(back: Partial<CardBackFace>, over: Partial<CardPreviewData> = {}): CardPreviewData {
  return {
    title: "Probe",
    cost: "{1}{W}",
    cardType: "instant",
    supertype: null,
    subtypes: [],
    rarity: "rare",
    colorIdentity: ["white"],
    rulesText: "Draw a card.",
    flavorText: null,
    power: null,
    toughness: null,
    loyalty: null,
    defense: null,
    artistCredit: "Probe",
    artUrl: null,
    artPosition: {},
    frameStyle: { template: "aftermath", finish: "regular" },
    setIconUrl: null,
    setIconCode: null,
    backFace: { title: "Second", card_type: "sorcery", ...back },
    faceContent: null,
    watermark: null,
    ...over,
  } as CardPreviewData;
}

type Raw = { data: Buffer };
async function bake(data: CardPreviewData): Promise<Raw> {
  const res = await renderCardImage(data, "default", { brandMark: false, watermarkText: null });
  return { data: await sharp(Buffer.from(await res.arrayBuffer())).removeAlpha().raw().toBuffer() };
}
const px = (r: Raw, x: number, y: number) => {
  const i = (y * W + x) * 3;
  return [r.data[i], r.data[i + 1], r.data[i + 2]];
};

/** A 1200 × 800 PNG: `top` colour over `bottom` colour (the art's up side). */
async function twoToneArt(top: number[], bottom: number[]): Promise<string> {
  const [w, h] = [1200, 800];
  const buf = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y += 1) {
    const c = y < h / 2 ? top : bottom;
    for (let x = 0; x < w; x += 1) buf.set(c, (y * w + x) * 3);
  }
  const png = await sharp(buf, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
  return `data:image/png;base64,${png.toString("base64")}`;
}

/** A `w` × `h` PNG, `fill` all over with a `band`-row `top` / `bottom` edge. */
async function bandArt(w: number, h: number, fill: number[], band = 0, top = fill, bottom = fill): Promise<string> {
  const buf = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y += 1) {
    const c = y < band ? top : y >= h - band ? bottom : fill;
    for (let x = 0; x < w; x += 1) buf.set(c, (y * w + x) * 3);
  }
  const png = await sharp(buf, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
  return `data:image/png;base64,${png.toString("base64")}`;
}

const near = (c: number[], ref: number[], tol: number) =>
  Math.abs(c[0] - ref[0]) + Math.abs(c[1] - ref[1]) + Math.abs(c[2] - ref[2]) < tol;

/** A rotated slot's footprint on the card, in px: the pre-rotation box
 *  turned 90° about its centre (width and height swap). */
function footprint(rect: Rect) {
  const cx = ((rect.leftPct + rect.widthPct / 2) / 100) * W;
  const cy = ((rect.topPct + rect.heightPct / 2) / 100) * H;
  const halfW = ((rect.heightPct / 100) * H) / 2;
  const halfH = ((rect.widthPct / 100) * W) / 2;
  return { x0: cx - halfW, x1: cx + halfW, y0: cy - halfH, y1: cy + halfH };
}

const layout = getFrameProfile("aftermath");
const second = layout.secondFace!;

/** An unrotated slot's box on the card, in px. */
function box(rect: Rect) {
  return {
    x0: (rect.leftPct / 100) * W,
    x1: ((rect.leftPct + rect.widthPct) / 100) * W,
    y0: (rect.topPct / 100) * H,
    y1: ((rect.topPct + rect.heightPct) / 100) * H,
  };
}

const lum = (c: number[]) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];

/** Bounding box of the dark ink (luminance < 70) inside a px region. */
function inkBox(r: Raw, x0: number, y0: number, x1: number, y1: number) {
  const out = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (let y = Math.ceil(y0); y < Math.floor(y1); y += 1) {
    for (let x = Math.ceil(x0); x < Math.floor(x1); x += 1) {
      if (lum(px(r, x, y)) >= 70) continue;
      out.x0 = Math.min(out.x0, x);
      out.x1 = Math.max(out.x1, x + 1);
      out.y0 = Math.min(out.y0, y);
      out.y1 = Math.max(out.y1, y + 1);
    }
  }
  return { ...out, w: out.x1 - out.x0, h: out.y1 - out.y0 };
}

/** Thickness of the first run of inked rows (top half, reading down) or
 *  inked columns (turned bottom half, reading from the right edge in). */
function firstLine(r: Raw, reg: { x0: number; x1: number; y0: number; y1: number }, turned: boolean) {
  const [a0, a1] = turned ? [Math.floor(reg.x1) - 1, Math.ceil(reg.x0)] : [Math.ceil(reg.y0), Math.floor(reg.y1) - 1];
  const step = turned ? -1 : 1;
  const inked = (i: number) => {
    const [b0, b1] = turned ? [Math.ceil(reg.y0), Math.floor(reg.y1)] : [Math.ceil(reg.x0), Math.floor(reg.x1)];
    for (let j = b0; j < b1; j += 1) if (lum(turned ? px(r, i, j) : px(r, j, i)) < 70) return true;
    return false;
  };
  let i = a0;
  while (i !== a1 && !inked(i)) i += step;
  const start = i;
  while (i !== a1 && inked(i)) i += step;
  return Math.abs(i - start);
}

describe("aftermath — the bottom half turns clockwise, like the print", () => {
  it("prints the second name ABOVE its cost (read top → bottom)", async () => {
    expect(second.rotation).toBe(90);
    const r = await bake(card({ title: "Probe", cost: "{R}{R}" }));
    const bar = footprint(second.title.rect);
    const [x0, x1] = [Math.ceil(bar.x0) + 6, Math.floor(bar.x1) - 6];
    let pipTop = Infinity;
    let inkTop = Infinity;
    for (let y = Math.ceil(bar.y0); y < Math.floor(bar.y1); y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const [cr, cg, cb] = px(r, x, y);
        if (cr > cg + 60 && cr > cb + 80) pipTop = Math.min(pipTop, y);
        else if (0.299 * cr + 0.587 * cg + 0.114 * cb < 70) inkTop = Math.min(inkTop, y);
      }
    }
    // Both drawn, the name's first glyph first — and the red pips start in
    // the bottom half of the bar, where the print puts the cost.
    expect(pipTop).toBeLessThan(Infinity);
    expect(inkTop).toBeLessThan(pipTop - 40);
    expect(pipTop).toBeGreaterThan((bar.y0 + bar.y1) / 2);
  }, 60_000);

  it("turns the sideways art so its top faces the title bar, and fills the window", async () => {
    // Red up, blue down: turned clockwise the red half lies on the RIGHT of
    // the window (the title bar side), the blue half on the left.
    const art = await twoToneArt([230, 30, 40], [30, 60, 230]);
    const win = footprint(second.artSlot!);
    const cases = [{}, { focalX: 0.2, focalY: 0.75, scale: 1.6 }, { focalX: 0, focalY: 1, scale: 1.2 }];
    for (const art_position of cases) {
      const r = await bake(card({ art_url: art, art_position }));
      let bg = 0;
      let n = 0;
      for (let y = Math.ceil(win.y0) + 3; y < Math.floor(win.y1) - 3; y += 2) {
        for (let x = Math.ceil(win.x0) + 3; x < Math.floor(win.x1) - 3; x += 2) {
          const c = px(r, x, y);
          if (Math.abs(c[0] - BG[0]) + Math.abs(c[1] - BG[1]) + Math.abs(c[2] - BG[2]) < 12) bg += 1;
          n += 1;
        }
      }
      // The old bake left a background strip across the window here.
      expect(bg / n).toBe(0);
    }
    const r = await bake(card({ art_url: art }));
    const midY = Math.round((win.y0 + win.y1) / 2);
    const right = px(r, Math.round(win.x1) - 20, midY);
    const left = px(r, Math.round(win.x0) + 20, midY);
    expect(right[0]).toBeGreaterThan(180);
    expect(right[2]).toBeLessThan(90);
    expect(left[2]).toBeGreaterThan(180);
    expect(left[0]).toBeLessThan(90);
  }, 120_000);

  it("draws a zoomed-out sideways art with no line of its opposite edge", async () => {
    // A 3000 × 400 panorama, yellow along its top edge and cyan along its
    // bottom: turned clockwise, yellow belongs on the RIGHT of the shrunk
    // picture and cyan on its left. Here Yoga rounded the art box 1 px past
    // the picture's bottom edge, and the background's repeat painted a
    // yellow column down the picture's LEFT edge.
    const [yellow, cyan] = [
      [240, 220, 0],
      [0, 220, 230],
    ];
    const art = await bandArt(3000, 400, [150, 110, 160], 40, yellow, cyan);
    const r = await bake(card({ art_url: art, art_position: { focalX: 0.3, focalY: 0.9, scale: 0.75 } }));
    const win = footprint(second.artSlot!);
    const midX = (win.x0 + win.x1) / 2;
    const count = (ref: number[], leftHalf: boolean) => {
      let n = 0;
      for (let y = Math.ceil(win.y0); y < Math.floor(win.y1); y += 1) {
        for (let x = Math.ceil(win.x0); x < Math.floor(win.x1); x += 1) {
          if (x < midX === leftHalf && near(px(r, x, y), ref, 50)) n += 1;
        }
      }
      return n;
    };
    expect(count(cyan, true)).toBeGreaterThan(1000);
    expect(count(yellow, false)).toBeGreaterThan(1000);
    expect(count(yellow, true)).toBe(0);
  }, 60_000);

  it("keeps a wall of rules text inside the white box (Card Conjurer's x 6.94–44.94%, y 57.0–90.57%)", async () => {
    // Card Conjurer's rotated rules box, in px: the rules slot turns onto it.
    const cc = { x0: 0.0694 * W, x1: 0.4494 * W, y0: 0.57 * H, y1: 0.9057 * H };
    const box = footprint(second.rules.rect);
    for (const k of ["x0", "x1", "y0", "y1"] as const) expect(Math.abs(box[k] - cc[k])).toBeLessThan(0.5);
    const long =
      "Aftermath (Cast this spell only from your graveyard. Then exile it.)\n" +
      "Each player shuffles their hand and graveyard into their library, then draws seven cards. " +
      "Then each opponent loses 2 life and you gain 2 life for each card drawn this way. " +
      "If a player has no cards in hand, that player discards nothing and scries 2 instead.";
    const [withText, without] = [await bake(card({ rules_text: long })), await bake(card({ rules_text: "" }))];
    let inside = 0;
    let outside = 0;
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        const a = px(withText, x, y);
        const b = px(without, x, y);
        if (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) <= 60) continue;
        if (x >= cc.x0 - 1 && x <= cc.x1 + 1 && y >= cc.y0 - 1 && y <= cc.y1 + 1) inside += 1;
        else outside += 1;
      }
    }
    expect(inside).toBeGreaterThan(2000);
    // The old box was 53% of the card wide once turned: this text ran off
    // the white box onto the black border.
    expect(outside).toBe(0);
  }, 60_000);

  it("foil: the sheen follows the sideways art the bake draws", async () => {
    // Light up, black down → turned, light on the right of the window.
    const art = await twoToneArt([240, 240, 240], [4, 4, 4]);
    const back = { art_url: art, art_position: { focalX: 0.3, focalY: 0.6, scale: 1.3 } };
    const regular = await bake(card(back));
    const foil = await bake(card(back, { frameStyle: { template: "aftermath", finish: "foil" } }));
    const win = footprint(second.artSlot!);
    const band = { y0: Math.round(win.y0) + 20, y1: Math.round(win.y1) - 20 };
    const colDelta = (x: number) => {
      let s = 0;
      for (let y = band.y0; y < band.y1; y += 1) {
        const a = px(regular, x, y);
        const b = px(foil, x, y);
        s += (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])) / 3;
      }
      return s / (band.y1 - band.y0);
    };
    const lum = (x: number) => {
      const c = px(regular, x, Math.round((win.y0 + win.y1) / 2));
      return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
    };
    const xs = Array.from({ length: Math.floor(win.x1) - Math.ceil(win.x0) - 8 }, (_, i) => Math.ceil(win.x0) + 4 + i);
    // Where the art turns from black to light in the regular bake…
    const artEdge = xs.find((x) => lum(x) > 128)!;
    expect(artEdge).toBeGreaterThan(win.x0 + 30);
    expect(artEdge).toBeLessThan(win.x1 - 30);
    // …the sheen starts too (± 3 px): none on the black part, clear on the light.
    const sheenEdge = xs.find((x) => colDelta(x) > 4)!;
    expect(Math.abs(sheenEdge - artEdge)).toBeLessThanOrEqual(3);
    expect(colDelta(artEdge - 12)).toBeLessThan(1.5);
    expect(colDelta(artEdge + 12)).toBeGreaterThan(6);
  }, 60_000);

  it("foil: the sheen covers the light art and none of the bare window", async () => {
    // A light picture all over, so the foil shows wherever the mask draws
    // it. Zoomed out (0.75) the art is cut to the window shrunk about its
    // focal point, so the mask must be too, not spill the scaled cover into
    // the bare margin; zoomed in (1.3) a bare strip in the bake (the old
    // art-free one) must stay bare in the foil.
    const art = await bandArt(3000, 400, [235, 235, 235]);
    const win = footprint(second.artSlot!);
    for (const [art_position, minBare] of [
      [{ focalX: 0.5, focalY: 0.5, scale: 0.75 }, 5000],
      [{ focalX: 0.3, focalY: 0.6, scale: 1.3 }, 0],
    ] as const) {
      const back = { art_url: art, art_position };
      const regular = await bake(card(back));
      const foil = await bake(card(back, { frameStyle: { template: "aftermath", finish: "foil" } }));
      const [x0, x1, y0, y1] = [Math.ceil(win.x0) + 3, Math.floor(win.x1) - 3, Math.ceil(win.y0) + 3, Math.floor(win.y1) - 3];
      // Each window pixel's kind in the regular bake: bare, light art, or
      // an edge between them (skipped, with a 3 px margin).
      const kind = (x: number, y: number) => {
        const c = px(regular, x, y);
        return near(c, BG, 12) ? "bare" : Math.min(...c) > 200 ? "art" : "edge";
      };
      const kinds = new Map<number, string>();
      for (let y = y0 - 3; y < y1 + 3; y += 1) for (let x = x0 - 3; x < x1 + 3; x += 1) kinds.set(y * W + x, kind(x, y));
      const sum = { bare: [0, 0], art: [0, 0] } as Record<string, number[]>;
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          const k = kinds.get(y * W + x)!;
          if (k === "edge") continue;
          let solid = true;
          for (let dy = -3; dy <= 3 && solid; dy += 1) {
            for (let dx = -3; dx <= 3 && solid; dx += 1) solid = kinds.get((y + dy) * W + x + dx) === k;
          }
          if (!solid) continue;
          const [a, b] = [px(regular, x, y), px(foil, x, y)];
          sum[k][0] += (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])) / 3;
          sum[k][1] += 1;
        }
      }
      expect(sum.bare[1]).toBeGreaterThanOrEqual(minBare);
      if (sum.bare[1]) expect(sum.bare[0] / sum.bare[1]).toBeLessThan(0.5);
      expect(sum.art[1]).toBeGreaterThan(10_000);
      expect(sum.art[0] / sum.art[1]).toBeGreaterThan(6);
    }
  }, 60_000);
});

// The owner's answer (2026-09-25): the bottom half prints at the top half's
// text sizes, like the printed Cut // Ribbons and Card Conjurer. The same
// words on both halves must bake to the same ink, turned a quarter.
describe("aftermath — both halves print at one set of text sizes", () => {
  const RULES = "Draw two cards, then discard a card.";
  const twin = card(
    { title: "Memory", cost: "{4}{U}{U}", card_type: "sorcery", rules_text: RULES },
    { title: "Memory", cost: "{4}{U}{U}", cardType: "sorcery", colorIdentity: ["blue"], rulesText: RULES },
  );
  /** The first / last `frac` of a band along its reading direction. */
  const topPart = (b: ReturnType<typeof box>, from: number, to: number) => ({
    ...b,
    x0: b.x0 + (b.x1 - b.x0) * from,
    x1: b.x0 + (b.x1 - b.x0) * to,
  });
  // A turned slot's footprint is wider than its bar (7% of the card's height
  // vs a ~57 px bar): 12 px in from each side keeps the bar's dark edges out.
  const turnedPart = (b: ReturnType<typeof footprint>, from: number, to: number) => ({
    x0: b.x0 + 12,
    x1: b.x1 - 12,
    y0: b.y0 + (b.y1 - b.y0) * from,
    y1: b.y0 + (b.y1 - b.y0) * to,
  });

  it("the name, type line and cost bake the same size on both halves", async () => {
    const r = await bake(twin);
    const ink = (reg: { x0: number; x1: number; y0: number; y1: number }) => inkBox(r, reg.x0, reg.y0, reg.x1, reg.y1);
    // Name: the first half of each band (the cost sits at the far end).
    const topName = ink(topPart(box(layout.title.rect), 0, 0.45));
    const botName = ink(turnedPart(footprint(second.title.rect), 0, 0.45));
    // Type line: likewise (the top half's set symbol sits at the far end).
    const topType = ink(topPart(box(layout.type.rect), 0, 0.4));
    const botType = ink(turnedPart(footprint(second.type.rect), 0, 0.4));
    // Cost: the far end of each band.
    const topCost = ink(topPart(box(layout.title.rect), 0.55, 1));
    const botCost = ink(turnedPart(footprint(second.title.rect), 0.5, 1));
    for (const [top, bot] of [
      [topName, botName],
      [topType, botType],
      [topCost, botCost],
    ]) {
      expect(top.w).toBeGreaterThan(20);
      // Turned clockwise: the top half's length runs down the bottom half's
      // bar, its height across it.
      expect(Math.abs(top.w - bot.h)).toBeLessThanOrEqual(2);
      expect(Math.abs(top.h - bot.w)).toBeLessThanOrEqual(2);
    }
  }, 60_000);

  it("the rules start at the same 9 pt on both halves", async () => {
    const r = await bake(twin);
    const top = firstLine(r, box(layout.rules.rect), false);
    const bottom = firstLine(r, footprint(second.rules.rect), true);
    expect(top).toBeGreaterThan(20);
    expect(Math.abs(top - bottom)).toBeLessThanOrEqual(1);
  }, 60_000);

  it("a long bottom name and type line shrink to fit their bars", async () => {
    const long = card({
      title: "Glorious Retribution of the Scorched Sky",
      cost: "{3}{R}{R}",
      card_type: "sorcery",
      supertype: "Legendary",
      subtypes: ["Arcane", "Lesson"],
      rules_text: "",
    });
    const short = card({ title: "Ribbons", cost: "{3}{R}{R}", card_type: "sorcery", rules_text: "" });
    const [a, b] = [await bake(long), await bake(short)];
    const across = (r: Raw, rect: Rect, to: number) => {
      const reg = turnedPart(footprint(rect), 0, to);
      return inkBox(r, reg.x0, reg.y0, reg.x1, reg.y1);
    };
    // Smaller type across the bar than a printed-length name / type line
    // (which keep the top half's sizes), and running down most of the bar.
    const [longName, shortName] = [across(a, second.title.rect, 0.45), across(b, second.title.rect, 0.45)];
    const [longType, shortType] = [across(a, second.type.rect, 1), across(b, second.type.rect, 1)];
    expect(longName.w).toBeLessThan(shortName.w * 0.8);
    expect(longType.w).toBeLessThan(shortType.w * 0.8);
    expect(longType.h).toBeGreaterThan(shortType.h * 2);
    // …and every mark stays inside the bars' footprints (the right part of
    // the bottom half, where the two bars and the art window lie).
    const bars = [footprint(second.title.rect), footprint(second.type.rect)];
    const blank = await bake(card({ title: "", cost: "", card_type: undefined, rules_text: "" }));
    let outside = 0;
    for (let y = Math.floor(H * 0.55); y < H; y += 1) {
      for (let x = Math.floor(W * 0.45); x < W; x += 1) {
        const [p, q] = [px(a, x, y), px(blank, x, y)];
        if (Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) + Math.abs(p[2] - q[2]) <= 60) continue;
        if (!bars.some((f) => x >= f.x0 - 1 && x <= f.x1 + 1 && y >= f.y0 - 1 && y <= f.y1 + 1)) outside += 1;
      }
    }
    expect(outside).toBe(0);
  }, 60_000);
});
