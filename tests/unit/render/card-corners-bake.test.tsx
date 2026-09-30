import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { CardPreviewData } from "@/components/cards/card-preview";
import {
  CARD_CORNER_CSS,
  applyCardCornerMask,
  cardCornerRadiusPx,
} from "@/lib/cards/card-corner";
import type { CardCorners } from "@/lib/cards/output-corners";
import { RENDER_PRESETS } from "@/lib/render/card-image";

// ---------------------------------------------------------------------------
// The bake's corner (TODO 3.26, owner decisions 2026-09-27) on REAL HD bakes.
//
//   round  (the default; every display bake) — the card's corner cut into
//          the PNG's alpha at 4.3 % of the short side (64.5 px at 1500×2100
//          AND 2100×1500), with lib/cards/card-corner.ts applyCardCornerMask:
//          alpha only, the RGB under the arc kept as drawn.
//   square (print) — opaque; the round render squared again
//          (squareCardCorners): outside the arc the border black, the root's
//          #101015 on a ring (whose see-through edge band IS that colour),
//          or — where art or frame design runs into the corner — what was
//          drawn (lib/frames/square-corners.ts).
//
// Bucket frames (m15, m15borderless, fullartland) are stand-ins from a
// stubbed bucket, like edge-to-edge-bake.test.tsx: a Card Conjurer-style
// master (opaque black, its corner cut transparent at 39 px — the pre-3.26
// import — or at 64.5 px — 3.26's re-cut) and clear masters for the
// art-to-edge frames. modern, battle (landscape), tarkirdragon (a ring) and
// bloomburrow (design in its top corners) are git masters read from disk. The art is one flat colour, so anything else where the art
// shows is something the renderer drew.
// ---------------------------------------------------------------------------

const ORIGIN = "https://frames.test";
const ART = [40, 160, 200] as const;
const ROOT = [16, 16, 21] as const; // the bake root's #101015 backdrop
const HD = RENDER_PRESETS.hd;

let artUrl = "";
let restore: () => void = () => {};

async function png(w: number, h: number, rgb: readonly number[], alpha = 1) {
  return sharp({ create: { width: w, height: h, channels: 4, background: { r: rgb[0], g: rgb[1], b: rgb[2], alpha } } })
    .png()
    .toBuffer();
}

/** A Card Conjurer-style master: opaque black, its corners cut transparent at
 *  `radius` with the importer's own formula. */
async function ccMaster(radius: number) {
  const data = Buffer.alloc(HD.width * HD.height * 4);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  applyCardCornerMask(data, HD.width, HD.height, radius);
  return sharp(data, { raw: { width: HD.width, height: HD.height, channels: 4 } }).png().toBuffer();
}

/** Serve `files` as the frames bucket (content-addressed, sha-checked). */
async function serveBucket(files: Record<string, Buffer>) {
  const { frameObjectKey, setFrameStorageForTests } = await import("@/lib/frames/frame-url");
  const { resetFrameAssetCacheForTests } = await import("@/lib/render/card-frames");
  const manifest = {
    version: 1 as const,
    bucket: "frames",
    files: Object.fromEntries(
      Object.entries(files).map(([key, buf]) => {
        const sha256 = createHash("sha256").update(buf).digest("hex");
        return [key, { hash: sha256.slice(0, 12), sha256, bytes: buf.length, width: 1, height: 1 }];
      }),
    ),
  };
  const byUrl = new Map(
    Object.entries(files).map(([key, buf]) => [`${ORIGIN}/${frameObjectKey(key, manifest.files[key].hash)}`, buf]),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      const buf = byUrl.get(String(input));
      if (!buf) throw new Error(`unexpected fetch: ${input}`);
      return new Response(new Uint8Array(buf), { status: 200, headers: { "content-type": "image/png" } });
    }),
  );
  restore();
  restore = setFrameStorageForTests({ manifest, origin: ORIGIN });
  resetFrameAssetCacheForTests();
}

let ccCut39: Buffer;
let ccCut645: Buffer;
async function bucketFiles(ccMasterBytes: Buffer): Promise<Record<string, Buffer>> {
  const clear = await png(150, 210, [0, 0, 0], 0);
  const plate = await png(240, 154, [128, 128, 128]);
  return {
    "m15/g.png": ccMasterBytes,
    "m15/pt/g.png": plate,
    "m15borderless/g.png": clear,
    "m15borderless/pt/g.png": plate,
    "fullartland/w.png": clear,
    "fullartland/symbol/w.png": await png(168, 168, [255, 0, 255]),
  };
}

beforeAll(async () => {
  artUrl = `data:image/png;base64,${(await png(1200, 1680, ART)).toString("base64")}`;
  ccCut39 = await ccMaster(39);
  ccCut645 = await ccMaster(cardCornerRadiusPx(HD.width, HD.height));
  await serveBucket(await bucketFiles(ccCut39));
});

afterAll(() => {
  restore();
  vi.unstubAllGlobals();
});

type Template = "m15" | "m15borderless" | "fullartland" | "modern" | "battle" | "tarkirdragon" | "bloomburrow";

function card(template: Template): CardPreviewData {
  const base = {
    rarity: "common",
    artistCredit: "Probe",
    artUrl,
    artPosition: {},
    flavorText: null,
    loyalty: null,
    defense: null,
    power: null,
    toughness: null,
    setIconUrl: null,
    setIconCode: null,
    backFace: null,
    faceContent: null,
    watermark: null,
    frameStyle: { template, finish: "regular" },
  };
  if (template === "fullartland") {
    return { ...base, title: "Plains", cardType: "land", supertype: "Basic", subtypes: ["Plains"], colorIdentity: ["white"], cost: null, rulesText: null } as unknown as CardPreviewData;
  }
  if (template === "battle") {
    return { ...base, title: "Invasion of Probe", cost: "{2}{R}", cardType: "battle", supertype: null, subtypes: ["Siege"], colorIdentity: ["red"], rulesText: "When this enters, it deals 3 damage to any target.", defense: "5" } as unknown as CardPreviewData;
  }
  return { ...base, title: "Giant Growth", cost: "{G}", cardType: "instant", supertype: null, subtypes: [], colorIdentity: ["green"], rulesText: "Target creature gets +3/+3 until end of turn." } as unknown as CardPreviewData;
}

type Bake = {
  png: Buffer;
  data: Buffer; // RGBA
  w: number;
  h: number;
  channels: number;
  /** [r, g, b, a] at (x, y); negative coordinates count from the far edge. */
  at: (x: number, y: number) => [number, number, number, number];
};

async function decode(buf: Buffer): Promise<Bake> {
  const meta = await sharp(buf).metadata();
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  return {
    png: buf,
    data,
    w,
    h,
    channels: meta.channels ?? 0,
    at: (x, y) => {
      const X = x < 0 ? w + x : x;
      const Y = y < 0 ? h + y : y;
      const o = (Y * w + X) * 4;
      return [data[o], data[o + 1], data[o + 2], data[o + 3]];
    },
  };
}

async function bake(template: Template, corners?: CardCorners): Promise<Bake> {
  const { renderCardImage } = await import("@/lib/render/card-image");
  const res = await renderCardImage(
    card(template),
    "hd",
    corners ? { brandMark: false, watermarkText: null, corners } : { brandMark: false, watermarkText: null },
  );
  return decode(Buffer.from(await res.arrayBuffer()));
}

const R = cardCornerRadiusPx(HD.width, HD.height); // 64.5 in both orientations
const BOX = Math.ceil(R) + 1; // the corner boxes the two modes may differ in
const inCornerBox = (b: Bake, x: number, y: number) =>
  (x < BOX || x >= b.w - BOX) && (y < BOX || y >= b.h - BOX);
const near = (p: readonly number[], rgb: readonly number[], tol = 2) =>
  rgb.every((c, i) => Math.abs(p[i] - c) <= tol);
/** The four corners' mirror images of corner-local (x, y). */
const mirrors = (x: number, y: number): Array<[number, number]> => [
  [x, y],
  [-1 - x, y],
  [x, -1 - y],
  [-1 - x, -1 - y],
];

describe("every caller names its corner", () => {
  const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");
  it("display bakes are round; print is square", () => {
    // The stored PNG (save-time bake and the platform re-bake): round.
    expect(read("lib/cards/bake-render.ts")).toMatch(/renderCardImage\(previewData, "hd", \{[^}]*corners: "round"/);
    expect(read("lib/cards/rebake-batch.ts")).toMatch(/renderCardImage\(previewData, "hd", \{[^}]*corners: "round"/);
    // The PDF card and sheets: the PRINT path (TODO 6.10), which squares
    // every render it makes — as do the 800 ppi / bleed PNGs.
    expect(read("app/api/cards/[id]/pdf/route.ts")).toMatch(/renderCardPrint\(previewData, \{/);
    expect(read("lib/render/card-print.ts")).toMatch(/squareCardCorners\(trim, trimW, trimH, cornerFills, radius\)/);
    // The deck export (PDF sheets AND the ZIP): square, named explicitly.
    expect(read("lib/decks/export-client.ts")).toContain('cardPngHref(card.id, { preset: quality, corners: "square" })');
  });
});

describe("renderPng's corner option (lib/render/satori-png.ts)", () => {
  const element = (
    <div style={{ display: "flex", width: "100%", height: "100%", background: "#c83c1e" }} />
  );

  it("unset: the exact bytes Satori → sharp always produced (every OG / brand image)", async () => {
    const [{ renderPng }, { default: satori }, { MPLANTIN_FONT_BYTES }] = await Promise.all([
      import("@/lib/render/satori-png"),
      import("satori"),
      import("@/lib/render/card-fonts"),
    ]);
    const fonts = [{ name: "MPlantin", data: MPLANTIN_FONT_BYTES, weight: 400 as const, style: "normal" as const }];
    const svg = await satori(element, { width: 200, height: 280, fonts });
    const before = await sharp(new TextEncoder().encode(svg)).resize(200).png().toBuffer();
    expect((await renderPng(element, { width: 200, height: 280, fonts })).equals(before)).toBe(true);
  });

  it("set: alpha cut to the mask, every RGB value kept", async () => {
    const [{ renderPng }, { MPLANTIN_FONT_BYTES }] = await Promise.all([
      import("@/lib/render/satori-png"),
      import("@/lib/render/card-fonts"),
    ]);
    const fonts = [{ name: "MPlantin", data: MPLANTIN_FONT_BYTES, weight: 400 as const, style: "normal" as const }];
    const square = await decode(await renderPng(element, { width: 200, height: 280, fonts }));
    const r = cardCornerRadiusPx(200, 280); // 8.6
    const round = await decode(await renderPng(element, { width: 200, height: 280, fonts, cornerRadiusPx: r }));
    const expected = Buffer.from(square.data);
    applyCardCornerMask(expected, 200, 280, r);
    expect(round.data.equals(expected)).toBe(true);
    expect(round.at(0, 0)).toEqual([200, 60, 30, 0]);
  });
});

const TEMPLATES: Template[] = ["m15", "m15borderless", "fullartland", "modern", "battle", "tarkirdragon", "bloomburrow"];
const round = new Map<Template, Bake>();
const square = new Map<Template, Bake>();

describe("the bake's corner (TODO 3.26)", () => {
  beforeAll(async () => {
    for (const t of TEMPLATES) {
      round.set(t, await bake(t));
      square.set(t, await bake(t, "square"));
    }
  }, 240_000);

  it("keeps the canvas: 1500×2100, and 2100×1500 for the landscape battle", () => {
    for (const t of TEMPLATES) {
      const b = round.get(t)!;
      expect([b.w, b.h]).toEqual(t === "battle" ? [2100, 1500] : [1500, 2100]);
      expect(cardCornerRadiusPx(b.w, b.h)).toBe(64.5);
    }
  });

  describe("round (the default)", () => {
    it.each(TEMPLATES)("%s: transparent outside the 64.5 px arc — α(0,0) 0, α(60,0) 223 — at all four corners", (t) => {
      const b = round.get(t)!;
      for (const [x, y] of [...mirrors(0, 0), ...mirrors(1, 1), ...mirrors(10, 3)]) expect(b.at(x, y)[3]).toBe(0);
      for (const [x, y] of [...mirrors(60, 0), ...mirrors(0, 60)]) expect(b.at(x, y)[3]).toBe(223);
      for (const [x, y] of [...mirrors(63, 0), ...mirrors(0, 63)]) expect(b.at(x, y)[3]).toBe(253);
      for (const [x, y] of [...mirrors(64, 0), ...mirrors(0, 64), ...mirrors(19, 19)]) expect(b.at(x, y)[3]).toBe(255);
    });

    it.each(TEMPLATES)("%s: the alpha channel is exactly the mask over an opaque card — nothing else is see-through", (t) => {
      const b = round.get(t)!;
      const expected = Buffer.alloc(b.w * b.h * 4, 255);
      applyCardCornerMask(expected, b.w, b.h);
      let diff = 0;
      for (let i = 3; i < b.data.length; i += 4) if (b.data[i] !== expected[i]) diff += 1;
      expect(diff).toBe(0);
    });

    it("keeps the RGB under the arc as drawn: the CC cut's #101015 backdrop, the borderless frame's art", () => {
      // Alpha only — a removeAlpha() read still sees what the renderer drew.
      expect(near(round.get("m15")!.at(0, 0), ROOT)).toBe(true);
      expect(near(round.get("m15borderless")!.at(0, 0), ART)).toBe(true);
      expect(near(round.get("m15borderless")!.at(-1, 0), ART)).toBe(true);
      for (const [x, y] of mirrors(0, 0)) expect(near(round.get("fullartland")!.at(x, y), ART)).toBe(true);
    });
  });

  describe("square (print)", () => {
    it.each(TEMPLATES)("%s: fully opaque", async (t) => {
      const b = square.get(t)!;
      expect((await sharp(b.png).stats()).isOpaque).toBe(true);
    });

    it("a Card Conjurer frame (cut at 39 px): the whole corner box is the border black, no #101015 notch", () => {
      const b = square.get("m15")!;
      let worst = 0;
      for (const [cx, cy] of mirrors(0, 0))
        for (let y = 0; y < BOX; y += 1)
          for (let x = 0; x < BOX; x += 1) {
            const p = b.at(cx < 0 ? -1 - x : x, cy < 0 ? -1 - y : y);
            worst = Math.max(worst, p[0], p[1], p[2]);
          }
      expect(worst).toBe(0);
    });

    it("an art-to-edge frame keeps its art in the corner; a cut corner below the art is black", () => {
      const borderless = square.get("m15borderless")!;
      for (const [x, y] of [[0, 0], [1, 1], [-1, 0], [-2, 1]] as const) expect(near(borderless.at(x, y), ART)).toBe(true);
      // Below the art window (92.24 %H): the clear stand-in's cut corner.
      expect(borderless.at(0, -1).slice(0, 3)).toEqual([0, 0, 0]);
      expect(borderless.at(-1, -1).slice(0, 3)).toEqual([0, 0, 0]);
      const full = square.get("fullartland")!;
      for (const [x, y] of mirrors(0, 0)) expect(near(full.at(x, y), ART)).toBe(true);
    });

    it("a ring (the landscape battle, tarkirdragon): the root's #101015 outside the arc — its see-through band's colour, no #000 cap", () => {
      for (const t of ["battle", "tarkirdragon"] as const) {
        const b = square.get(t)!;
        for (const [x, y] of [...mirrors(0, 0), ...mirrors(8, 2)]) expect(b.at(x, y).slice(0, 3), `${t} ${x},${y}`).toEqual([...ROOT]);
      }
    });

    it("Bloomburrow: its design runs into the top corners and stays; the bottom corners are the root", () => {
      const sq = square.get("bloomburrow")!;
      const rd = round.get("bloomburrow")!;
      // The round bake keeps RGB under the cut: the square shows it opaque.
      for (const [x, y] of [[0, 0], [-1, 0], [5, 1]] as const) {
        expect(sq.at(x, y), `${x},${y}`).toEqual([...rd.at(x, y).slice(0, 3), 255]);
        expect(near(sq.at(x, y), [0, 0, 0], 20), `${x},${y}`).toBe(false);
      }
      for (const [x, y] of [[0, -1], [-1, -1]] as const) expect(sq.at(x, y).slice(0, 3)).toEqual([...ROOT]);
    });

    // The seam test (3.26 review): at every corner a square output fills, the
    // corner reads as the border beside it — the fill matches the edge band
    // just past the corner box, whatever colour that band is (within a
    // scanned border's noise, ≤ 12 levels; #000 against a ring's #101015 is
    // 16–21).
    it.each(["m15", "modern", "battle", "tarkirdragon"] as const)("%s: every filled corner matches the edge band beside it", (t) => {
      const b = square.get(t)!;
      const past = Math.ceil(R) + 4;
      for (const [sx, sy] of [[1, 1], [-2, 1], [1, -2], [-2, -2]] as const) {
        const corner = b.at(sx, sy);
        const bandX = b.at(sx < 0 ? -1 - past : past, sy < 0 ? -4 : 3);
        const bandY = b.at(sx < 0 ? -4 : 3, sy < 0 ? -1 - past : past);
        expect(near(corner, bandX, 12), `${t} ${sx},${sy} vs ${bandX}`).toBe(true);
        expect(near(corner, bandY, 12), `${t} ${sx},${sy} vs ${bandY}`).toBe(true);
      }
    });
  });

  it.each(TEMPLATES)("%s: round and square are byte-identical outside the four corner boxes", (t) => {
    const a = round.get(t)!;
    const b = square.get(t)!;
    let diff = 0;
    let outsideBoxDiffs = 0;
    for (let y = 0; y < a.h; y += 1)
      for (let x = 0; x < a.w; x += 1) {
        const o = (y * a.w + x) * 4;
        const same =
          a.data[o] === b.data[o] &&
          a.data[o + 1] === b.data[o + 1] &&
          a.data[o + 2] === b.data[o + 2] &&
          a.data[o + 3] === b.data[o + 3];
        if (same) continue;
        diff += 1;
        if (!inCornerBox(a, x, y)) outsideBoxDiffs += 1;
      }
    expect(outsideBoxDiffs).toBe(0);
    expect(diff).toBeGreaterThan(0);
  });

  it("3.26's re-cut master (64.5 px): the square corner stays the border black, the round bake unchanged", async () => {
    await serveBucket(await bucketFiles(ccCut645));
    try {
      const sq = await bake("m15", "square");
      let worst = 0;
      for (const [cx, cy] of mirrors(0, 0))
        for (let y = 0; y < BOX; y += 1)
          for (let x = 0; x < BOX; x += 1) {
            const p = sq.at(cx < 0 ? -1 - x : x, cy < 0 ? -1 - y : y);
            worst = Math.max(worst, p[0], p[1], p[2]);
          }
      // Where the master's anti-aliased cut and the fill's meet on the same
      // arc, the #101015 backdrop can tint a pixel by a few levels at most.
      expect(worst).toBeLessThanOrEqual(6);
      // The round bake's alpha is the mask either way; only the RGB under it
      // (#101015 where the master is cut) can move.
      const rd = await bake("m15");
      const was = round.get("m15")!;
      for (let i = 3; i < rd.data.length; i += 4) expect(rd.data[i]).toBe(was.data[i]);
    } finally {
      await serveBucket(await bucketFiles(ccCut39));
    }
  }, 60_000);

  describe("downstream of a round stored bake", () => {
    it("the 750 px downscale (free download, raw OG) keeps the transparent corner", async () => {
      const { fitStoredRender } = await import("@/lib/render/stored-render");
      const fitted = await decode(await fitStoredRender(round.get("m15")!.png, "default", false));
      expect([fitted.w, fitted.h]).toEqual([750, 1050]);
      for (const [x, y] of mirrors(0, 0)) expect(fitted.at(x, y)[3]).toBe(0);
      expect(fitted.at(375, 525)[3]).toBe(255);
      const landscape = await decode(await fitStoredRender(round.get("battle")!.png, "default", true));
      expect([landscape.w, landscape.h]).toEqual([1050, 750]);
      for (const [x, y] of mirrors(0, 0)) expect(landscape.at(x, y)[3]).toBe(0);
    });

    it("squaring it for a free Square download gives an opaque card with the border's corners", async () => {
      const [{ fitStoredRender, flattenStoredCorners }, { squareCornerFillsOf }] = await Promise.all([
        import("@/lib/render/stored-render"),
        import("@/lib/render/card-image"),
      ]);
      const fitted = await fitStoredRender(round.get("m15")!.png, "default", false);
      const flat = await decode(await flattenStoredCorners(fitted, squareCornerFillsOf(card("m15"))));
      expect(flat.channels).toBe(3);
      for (const [x, y] of mirrors(0, 0)) expect(flat.at(x, y).slice(0, 3)).toEqual([0, 0, 0]);
      const before = await decode(fitted);
      expect(flat.at(375, 525)).toEqual(before.at(375, 525));
      // A ring's corners are its band's #101015.
      const ring = await fitStoredRender(round.get("tarkirdragon")!.png, "default", false);
      const ringFlat = await decode(await flattenStoredCorners(ring, squareCornerFillsOf(card("tarkirdragon"))));
      for (const [x, y] of mirrors(0, 0)) expect(ringFlat.at(x, y).slice(0, 3)).toEqual([...ROOT]);
    });

    // The free Square is the paid Square's twin: the stored round bake,
    // squared with the same fills, is the live square render pixel for pixel
    // (at the bake's own size — a free download is then downscaled 2×).
    it.each(["m15", "modern", "battle", "tarkirdragon"] as const)("%s: the round bake squared = the live square render, at HD", async (t) => {
      const [{ flattenStoredCorners }, { squareCornerFillsOf }] = await Promise.all([
        import("@/lib/render/stored-render"),
        import("@/lib/render/card-image"),
      ]);
      const flat = await decode(await flattenStoredCorners(round.get(t)!.png, squareCornerFillsOf(card(t))));
      const live = square.get(t)!;
      let diff = 0;
      for (let i = 0; i < live.data.length; i += 1) if (i % 4 !== 3 && flat.data[i] !== live.data[i]) diff += 1;
      expect(diff).toBe(0);
    });

    it("refuses to square a corner that keeps its drawn pixels (art or design): the route renders those live", async () => {
      const [{ flattenStoredCorners }, { squareCornerFillsOf }] = await Promise.all([
        import("@/lib/render/stored-render"),
        import("@/lib/render/card-image"),
      ]);
      const fills = squareCornerFillsOf(card("bloomburrow"));
      expect(fills.slice(0, 2)).toEqual([null, null]);
      await expect(flattenStoredCorners(round.get("bloomburrow")!.png, fills)).rejects.toThrow(/can't be squared/);
    });

    it("the 600 px WebP thumb keeps the alpha channel and the transparent corner", async () => {
      const { makeRenderThumb } = await import("@/lib/cards/render-thumb");
      const thumb = await decode(await makeRenderThumb(round.get("m15")!.png));
      expect(thumb.channels).toBe(4);
      expect([thumb.w, thumb.h]).toEqual([600, 840]);
      for (const [x, y] of mirrors(0, 0)) expect(thumb.at(x, y)[3]).toBe(0);
      expect(thumb.at(300, 420)[3]).toBe(255);
    });
  });

  // The live preview is a CSS-clipped box (app/globals.css .card-corners —
  // CARD_CORNER_CSS, kept equal by card-corner.test.ts). Model that clip as
  // pixel coverage of the rounded rect it draws (16×16 samples) and hold the
  // bake's corner to it: where the clip shows nothing the bake is exactly
  // transparent, and every pixel of the corner box agrees within
  // anti-aliasing tolerance (the mask's 1 px ramp vs area coverage).
  it.each(["m15", "battle"] as const)("%s: the round corner is the CSS clip's corner (parity with CardPreview)", (t) => {
    const b = round.get(t)!;
    const [hPct, vPct] = (t === "battle" ? CARD_CORNER_CSS.landscape : CARD_CORNER_CSS.portrait)
      .split("/")
      .map((s) => parseFloat(s) / 100);
    const rx = hPct * b.w;
    const ry = vPct * b.h;
    const SS = 16;
    let edge = 0;
    let worst = 0;
    for (let y = 0; y < BOX; y += 1)
      for (let x = 0; x < BOX; x += 1) {
        let inside = 0;
        for (let sy = 0; sy < SS; sy += 1)
          for (let sx = 0; sx < SS; sx += 1) {
            const px = x + (sx + 0.5) / SS;
            const py = y + (sy + 0.5) / SS;
            const dx = px < rx ? (rx - px) / rx : 0;
            const dy = py < ry ? (ry - py) / ry : 0;
            if (dx * dx + dy * dy <= 1) inside += 1;
          }
        const coverage = inside / (SS * SS);
        for (const [mx, my] of mirrors(x, y)) {
          const alpha = b.at(mx, my)[3] / 255;
          if (coverage === 0) expect(alpha).toBe(0);
          if (coverage > 0 && coverage < 1) edge += 1;
          worst = Math.max(worst, Math.abs(alpha - coverage));
        }
      }
    expect(edge).toBeGreaterThan(4 * 60);
    expect(worst).toBeLessThan(0.1);
  });
});
