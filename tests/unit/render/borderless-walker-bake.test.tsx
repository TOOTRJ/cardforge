import { createHash } from "node:crypto";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { CardPreviewData } from "@/components/cards/card-preview";
import { TALL_WALKER_SHIFT_PCT, getFrameProfile, type Rect } from "@/lib/cards/template-layout";
import { RENDER_PRESETS } from "@/lib/render/card-image";

// ---------------------------------------------------------------------------
// The borderless planeswalkers (TODO 4.33) on REAL bakes: the art reaches the
// top and side edges; the ability rows are Card Conjurer's neutral light
// stripes (white α 0.608, #a4a4a4 α 0.706 — not m15pw's cream); the loyalty
// value sits on the master's own shield, cut out to <template>/loyalty/; the
// tall template prints its type line 138 HD px higher. The masters are
// frames-bucket objects, so the bucket is stubbed (as in
// edge-to-edge-bake.test.tsx) with see-through stand-in masters: every pixel
// that isn't the art's flat colour is the renderer's. The preview's twin is
// tests/unit/components/borderless-walker-preview.test.tsx.
// ---------------------------------------------------------------------------

const W = RENDER_PRESETS.default.width;
const H = RENDER_PRESETS.default.height;
const ORIGIN = "https://frames.test";
const ART_RGB = [40, 160, 200] as const;
const SHIELD_RGB = [255, 0, 255] as const;

let artUrl = "";
let restore: () => void = () => {};

async function solid(w: number, h: number, rgb: readonly number[], alpha = 1) {
  return sharp({ create: { width: w, height: h, channels: 4, background: { r: rgb[0], g: rgb[1], b: rgb[2], alpha } } })
    .png()
    .toBuffer();
}

beforeAll(async () => {
  artUrl = `data:image/png;base64,${(await solid(600, 840, ART_RGB)).toString("base64")}`;
  const { frameObjectKey, setFrameStorageForTests } = await import("@/lib/frames/frame-url");
  const clear = await solid(150, 210, [0, 0, 0], 0);
  const shield = await solid(240, 154, SHIELD_RGB);
  const files: Record<string, Buffer> = {
    "m15borderlesspw/w.png": clear,
    "m15borderlesspw/loyalty/w.png": shield,
    "m15borderlesspwtall/w.png": clear,
    "m15borderlesspwtall/loyalty/w.png": shield,
  };
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
  restore = setFrameStorageForTests({ manifest, origin: ORIGIN });
});

afterAll(() => {
  restore();
  vi.unstubAllGlobals();
});

type Px = [number, number, number];
type Bake = { px: (x: number, y: number) => Px };

async function bake(template: string, card: Partial<CardPreviewData> = {}): Promise<Bake> {
  const { renderCardImage } = await import("@/lib/render/card-image");
  const res = await renderCardImage(
    {
      title: "Ajani, Caller of the Pride",
      cost: "{1}{W}{W}",
      cardType: "planeswalker",
      supertype: "Legendary",
      subtypes: ["Ajani"],
      colorIdentity: ["white"],
      loyalty: "4",
      rulesText: "+1: Put a +1/+1 counter on up to one target creature.\n−3: Target creature gains flying.\n−8: Create X 2/2 white Cat creature tokens.",
      rarity: "mythic",
      artistCredit: "Test Artist",
      artUrl,
      artPosition: {},
      setIconUrl: null,
      setIconCode: null,
      backFace: null,
      faceContent: null,
      watermark: null,
      frameStyle: { template },
      ...card,
    } as unknown as CardPreviewData,
    "default",
    { brandMark: false, watermarkText: null, corners: "round" },
  );
  const data = await sharp(Buffer.from(await res.arrayBuffer())).removeAlpha().raw().toBuffer();
  return {
    px: (x, y) => {
      const i = (Math.round(y) * W + Math.round(x)) * 3;
      return [data[i], data[i + 1], data[i + 2]];
    },
  };
}

const near = (a: Px, b: readonly number[], tol = 3) => a.every((v, i) => Math.abs(v - b[i]) <= tol);
/** `ink` at `alpha` over the flat art, as 8-bit RGB. */
const over = (ink: readonly number[], alpha: number) => ART_RGB.map((a, i) => Math.round(ink[i] * alpha + a * (1 - alpha)));
const dark = ([r, g, b]: Px) => r < 90 && g < 90 && b < 90;

/** The rows of dark ink in a card-percent band (the type line's). */
function inkRows(b: Bake, rect: Rect): { top: number; bottom: number } {
  let top = -1;
  let bottom = -1;
  const x0 = Math.ceil((rect.leftPct / 100) * W);
  const x1 = Math.floor(((rect.leftPct + rect.widthPct) / 100) * W);
  for (let y = Math.ceil((rect.topPct / 100) * H); y < Math.floor(((rect.topPct + rect.heightPct) / 100) * H); y += 1) {
    let n = 0;
    for (let x = x0; x < x1; x += 1) if (dark(b.px(x, y))) n += 1;
    if (n >= 3) {
      if (top < 0) top = y;
      bottom = y;
    }
  }
  return { top, bottom };
}

describe("the borderless planeswalkers on real bakes (TODO 4.33)", () => {
  it("runs the art to the top and side edges, and draws the rows in Card Conjurer's neutral light stripes", async () => {
    const b = await bake("m15borderlesspw");
    // The art at the top edge, the side edges and between the bars.
    for (const [x, y] of [[W / 2, 2], [2, H / 3], [W - 3, H / 3], [W / 2, 0.3 * H]] as const) {
      expect(near(b.px(x, y), ART_RGB, 2), `${x},${y}`).toBe(true);
    }
    // Down the rows' right edge, clear of the text: both stripes, over the
    // art — never m15pw's cream.
    const rules = getFrameProfile("m15borderlesspw").rules.rect;
    const x = ((rules.leftPct + rules.widthPct) / 100) * W - 4;
    const seen: Px[] = [];
    for (let y = Math.ceil((rules.topPct / 100) * H) + 3; y < ((rules.topPct + rules.heightPct) / 100) * H - 40; y += 2) {
      seen.push(b.px(x, y));
    }
    const stripeA = over([255, 255, 255], 0.608);
    const stripeB = over([164, 164, 164], 0.706);
    expect(seen.some((p) => near(p, stripeA))).toBe(true);
    expect(seen.some((p) => near(p, stripeB))).toBe(true);
    const cream = over([244, 238, 226], 0.78);
    expect(seen.some((p) => near(p, cream, 2))).toBe(false);
  });

  it("puts the starting loyalty on the master's own shield, cut out to its loyalty/ plate", async () => {
    const b = await bake("m15borderlesspw");
    const box = getFrameProfile("m15borderlesspw").loyalty!.plateRect!;
    // The shield's stand-in fills its box but for the white digits on it.
    const cx = ((box.leftPct + box.widthPct * 0.2) / 100) * W;
    const cy = ((box.topPct + box.heightPct / 2) / 100) * H;
    expect(near(b.px(cx, cy), SHIELD_RGB, 2)).toBe(true);
  });

  it("prints the tall one's type line 138 HD px higher, the name where it was", async () => {
    const regular = await bake("m15borderlesspw");
    const tall = await bake("m15borderlesspwtall");
    const band = getFrameProfile("m15borderlesspw").type.rect;
    const tallBand = getFrameProfile("m15borderlesspwtall").type.rect;
    expect(band.topPct - tallBand.topPct).toBeCloseTo(TALL_WALKER_SHIFT_PCT, 9);
    expect(TALL_WALKER_SHIFT_PCT * 21).toBeCloseTo(138, 9);
    const a = inkRows(regular, band);
    const t = inkRows(tall, tallBand);
    expect(a.top).toBeGreaterThan(0);
    // 138 HD px = 69 px at 750.
    expect(Math.abs(a.top - t.top - 69)).toBeLessThanOrEqual(1);
    expect(Math.abs(a.bottom - t.bottom - 69)).toBeLessThanOrEqual(1);
    const title = getFrameProfile("m15borderlesspw").title.rect;
    expect(inkRows(tall, title)).toEqual(inkRows(regular, title));
  });
});
