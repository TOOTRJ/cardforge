import sharp from "sharp";
import { describe, expect, it } from "vitest";
import type { CardPreviewData } from "@/components/cards/card-preview";
import type { FrameTemplate } from "@/types/card";
import { footerInk, getFrameProfile, slotInk } from "@/lib/cards/template-layout";
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

describe("Alpha brand mark is centred in the re-cut black band", () => {
  it.each<FrameTemplate>(["agclassic", "alphaland"])("%s: ink centred on 2000–2100 px", async (template) => {
    const land = template === "alphaland";
    const data = card(template, { cardType: land ? "land" : "instant", cost: land ? null : "{2}{W}", power: null, toughness: null });
    const box = diffBox(await bake(data, false), await bake(data, true))!;
    const cy = ((box.y0 + box.y1 + 1) / 2 / H) * 2100;
    expect(Math.abs(cy - 2050)).toBeLessThan(6);
  }, 60_000);
});

describe("Alpha P/T sits in the strip below the text box (v25, re-cut)", () => {
  it("centres the digits where the print does (strip 1853–2000 px = 88.24–95.24 %H)", async () => {
    const [none, pt] = [await bake(card("agclassic", { power: null, toughness: null })), await bake(card("agclassic"))];
    const box = diffBox(none, pt)!;
    const cy = ((box.y0 + box.y1 + 1) / 2 / H) * 100;
    const cx = ((box.x0 + box.x1 + 1) / 2 / W) * 100;
    const at = (cy - 88.24) / (95.24 - 88.24);
    // Printed Alpha/Beta digits: centred at 1920–1925 px (0.45–0.49 of the
    // strip), ~88 %W under the text box's right corner (19 LEA/LEB scans).
    expect(at).toBeGreaterThan(0.4);
    expect(at).toBeLessThan(0.52);
    expect(cx).toBeGreaterThan(86.5);
    expect(cx).toBeLessThan(89.5);
    // …and entirely inside the strip, clear of the text box and the black.
    expect(box.y0 / H).toBeGreaterThan(1853 / 2100);
    expect((box.y1 + 1) / H).toBeLessThan(1978 / 2100);
  }, 60_000);
});

describe("Alpha ink: silver P/T and artist line on every frame but white", () => {
  const COLOR: Record<string, CardPreviewData["colorIdentity"]> = {
    w: ["white"],
    u: ["blue"],
    b: ["black"],
    r: ["red"],
    g: ["green"],
    c: ["colorless"],
    m: ["white", "blue"],
  };
  const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const lumOf = ([r, g, b]: number[]) => 0.299 * r + 0.587 * g + 0.114 * b;

  /** The median colour of the lightest (or darkest) 3 % of `pixels`. */
  function extreme(r: Raw, pixels: number[], light: boolean) {
    const sorted = [...pixels].sort((a, b) => {
      const d = lumOf([...r.data.subarray(a, a + 3)]) - lumOf([...r.data.subarray(b, b + 3)]);
      return light ? -d : d;
    });
    const pick = sorted.slice(0, Math.max(3, Math.round(sorted.length * 0.03)));
    const mid = pick[Math.floor(pick.length / 2)];
    return [...r.data.subarray(mid, mid + 3)];
  }
  /** Pixel offsets inside a card-percent rect. */
  function rectPixels(r: Raw, rect: { topPct: number; leftPct: number; widthPct: number; heightPct: number }) {
    const out: number[] = [];
    for (let y = Math.ceil((rect.topPct / 100) * H); y < Math.floor(((rect.topPct + rect.heightPct) / 100) * H); y += 1) {
      for (let x = Math.ceil((rect.leftPct / 100) * W); x < Math.floor(((rect.leftPct + rect.widthPct) / 100) * W); x += 1) {
        out.push((y * W + x) * 3);
      }
    }
    return out;
  }

  it.each(["w", "u", "b", "r", "g", "c", "m"])("agclassic %s: the bake prints the P/T in slotInk's colour", async (key) => {
    const layout = getFrameProfile("agclassic");
    const ink = slotInk(layout.pt!, key);
    const [none, pt] = [
      await bake(card("agclassic", { colorIdentity: COLOR[key], power: null, toughness: null })),
      await bake(card("agclassic", { colorIdentity: COLOR[key] })),
    ];
    const b = diffBox(none, pt)!;
    const pixels: number[] = [];
    for (let y = b.y0; y <= b.y1; y += 1) for (let x = b.x0; x <= b.x1; x += 1) pixels.push((y * W + x) * 3);
    const light = key !== "w";
    // White keeps the dark ink; every other colour is light silver.
    expect(lumOf(hex(ink.colorHex)) > 120).toBe(light);
    const got = extreme(pt, pixels, light);
    hex(ink.colorHex).forEach((c, i) => expect(Math.abs(got[i] - c), `${key} channel ${i}`).toBeLessThan(14));
    // The emboss: silver digits carry a dark lower-right edge.
    if (light) expect(lumOf(extreme(pt, pixels, false))).toBeLessThan(lumOf(extreme(none, pixels, false)) - 10);
  }, 60_000);

  it.each([
    ["agclassic", "b"],
    ["agclassic", "r"],
    ["agclassic", "w"],
    ["alphaland", "w"],
  ])("%s %s: the bake prints the artist line in footerInk's colour", async (template, key) => {
    const layout = getFrameProfile(template as FrameTemplate);
    const ink = footerInk(layout.footer!, key);
    const land = template === "alphaland";
    const r = await bake(card(template as FrameTemplate, {
      colorIdentity: COLOR[key],
      artistCredit: "Douglas Schuler",
      ...(land ? { cardType: "land", cost: null, power: null, toughness: null } : {}),
    }));
    const light = lumOf(hex(ink.colorHex)) > 120;
    // The land frame is brown on every key, so even its white key is silver.
    expect(light).toBe(land || key !== "w");
    const got = extreme(r, rectPixels(r, layout.footer!.rect), light);
    hex(ink.colorHex).forEach((c, i) => expect(Math.abs(got[i] - c), `channel ${i}`).toBeLessThan(18));
    // The emboss: silver lettering carries a dark lower-right edge in the
    // bake too (the preview's is pinned in alpha-ink.test.tsx).
    // Compared with the bare frame master (an empty credit still prints
    // "Art: Unknown", so a second bake would carry lettering too).
    if (light) {
      const { data: frame } = await sharp(`public/frames/${template}/${key}.png`)
        .flatten({ background: "#000" })
        .resize(W, H, { fit: "fill" })
        .raw()
        .toBuffer({ resolveWithObject: true });
      const bare: Raw = { data: frame, width: W, height: H };
      // Light lettering can only brighten the frame; only the emboss shadow
      // darkens it — so count pixels the bake draws darker than the master.
      // (On the near-black strip of the black frame a shadow has nothing to
      // darken, as on the print, so that key checks the colour only.)
      const pixels = rectPixels(r, layout.footer!.rect);
      const lumAt = (raw: Raw, o: number) => lumOf([...raw.data.subarray(o, o + 3)]);
      const stripLum = pixels.reduce((sum, o) => sum + lumAt(bare, o), 0) / pixels.length;
      if (stripLum > 60) {
        const darker = pixels.filter((o) => lumAt(r, o) < lumAt(bare, o) - 20).length;
        expect(darker).toBeGreaterThan(20);
      }
    }
  }, 60_000);
});

describe("Alpha masters are re-cut to the printed proportions", () => {
  // scripts/build-alpha-frames.mjs: frame 80–1421 × 89–2000, art opening
  // 178–1319 × 219–1138, text box 185–1314 × 1252–1853 (HD px).
  async function master(template: string, key: string) {
    const { data, info } = await sharp(`public/frames/${template}/${key}.png`)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const at = (x: number, y: number) => {
      const i = (y * info.width + x) * 4;
      return { l: 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2], a: data[i + 3] };
    };
    /** Mean luminance and min alpha of the 9 × 9 box around (x, y). */
    const box = (x: number, y: number) => {
      let l = 0;
      let a = 255;
      for (let dy = -4; dy <= 4; dy += 1) {
        for (let dx = -4; dx <= 4; dx += 1) {
          const p = at(x + dx, y + dy);
          l += p.l / 81;
          a = Math.min(a, p.a);
        }
      }
      return { l, a };
    };
    return { info, at, box };
  }

  it.each(["agclassic", "alphaland"])("%s: black border, art opening and strip where the print has them", async (template) => {
    for (const key of ["w", "u", "b", "r", "g", "c", "m"]) {
      const { info, at, box } = await master(template, key);
      expect([info.width, info.height], key).toEqual([1500, 2100]);
      // The 100 px black band below the frame, 80 px at the sides, 89 on top
      // (the old MSE upscale had 60 px all round).
      for (const [x, y] of [[750, 2006], [750, 2090], [40, 1000], [1460, 1000], [750, 45], [70, 1000], [1430, 1000]]) {
        expect(box(x, y).a, `${key} ${x},${y}`).toBe(255);
        expect(box(x, y).l, `${key} ${x},${y}`).toBeLessThan(6);
      }
      // Frame just inside those edges: the strip, the side borders, the
      // title band.
      for (const [x, y] of [[750, 1990], [750, 1900], [130, 600], [1375, 600], [750, 150]]) {
        expect(box(x, y).a, `${key} ${x},${y}`).toBe(255);
        expect(box(x, y).l, `${key} ${x},${y}`).toBeGreaterThan(12);
      }
      // The art opening is cut exactly; the bevel around it is opaque.
      expect(at(178, 219).a).toBe(0);
      expect(at(1318, 1137).a).toBe(0);
      for (const [x, y] of [[177, 600], [1319, 600], [750, 218], [750, 1138]]) {
        expect(at(x, y).a, `${key} ${x},${y}`).toBe(255);
      }
      // Rounded card corners stay transparent.
      expect(at(0, 0).a).toBe(0);
      expect(at(1499, 2099).a).toBe(0);
    }
  });

  it("the art slot covers the opening and stays under the art box's bevel", () => {
    for (const template of ["agclassic", "alphaland"] as const) {
      const a = getFrameProfile(template).artSlot;
      const x0 = (a.leftPct / 100) * 1500;
      const x1 = ((a.leftPct + a.widthPct) / 100) * 1500;
      const y0 = (a.topPct / 100) * 2100;
      const y1 = ((a.topPct + a.heightPct) / 100) * 2100;
      expect(x0).toBeLessThanOrEqual(178);
      expect(x0).toBeGreaterThan(159);
      expect(x1).toBeGreaterThanOrEqual(1319);
      expect(x1).toBeLessThan(1347);
      expect(y0).toBeLessThanOrEqual(219);
      expect(y0).toBeGreaterThan(197);
      expect(y1).toBeGreaterThanOrEqual(1138);
      expect(y1).toBeLessThan(1159);
    }
  });
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
