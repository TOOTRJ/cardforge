import { createHash } from "node:crypto";
import sharp from "sharp";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { CardPreviewData } from "@/components/cards/card-preview";
import { RENDER_PRESETS } from "@/lib/render/card-image";

// ---------------------------------------------------------------------------
// TextSlot.dy (TODO 4.20, layout v32) on a REAL bake: the front-face name and
// type line move by Math.round(dy × width) px — the whole px nearest the
// preview's translateY(dy in cqw), pinned in
// tests/unit/components/text-dy-preview.test.tsx — and nothing else moves:
// not the band, not the pips (costDy's job), not the set symbol. The shipped
// family profiles carry their own dy (tests/unit/cards/m15-text-sizes.test.ts
// pins them); here the m15 profile gets the dy each case needs through a
// wrapped getFrameProfile. The m15 masters live in the frames bucket (never
// in git): the bake is served a flat mid-grey stand-in through a stubbed
// bucket, so the name's and type line's dark ink and the pale {W} disc are
// the only marks in their bands. Rendered at the "default" preset
// (750 × 1050).
// ---------------------------------------------------------------------------

const slotDy = vi.hoisted(() => ({ title: undefined as number | undefined, type: undefined as number | undefined }));

vi.mock("@/lib/cards/template-layout", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/cards/template-layout")>();
  return {
    ...real,
    getFrameProfile: (template?: string) => {
      const profile = real.getFrameProfile(template);
      return {
        ...profile,
        title: { ...profile.title, dy: slotDy.title },
        type: { ...profile.type, dy: slotDy.type },
      };
    },
  };
});

const W = RENDER_PRESETS.default.width;
const H = RENDER_PRESETS.default.height;
const ORIGIN = "https://frames.test";

async function standInBucket() {
  const { frameObjectKey } = await import("@/lib/frames/frame-url");
  const frame = await sharp({
    create: { width: 1500, height: 2100, channels: 4, background: { r: 128, g: 128, b: 128, alpha: 1 } },
  })
    .png()
    .toBuffer();
  const files: Record<string, Buffer> = { "m15/w.png": frame };
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
  return { manifest, byUrl };
}

const sorcery = {
  title: "Probe Name",
  cost: "{W}",
  cardType: "sorcery",
  supertype: null,
  subtypes: [],
  rarity: "common",
  colorIdentity: ["white"],
  rulesText: null,
  flavorText: null,
  power: null,
  toughness: null,
  loyalty: null,
  defense: null,
  artistCredit: "Probe",
  artUrl: null,
  artPosition: {},
  frameStyle: { template: "m15", finish: "regular" },
  setIconUrl: null,
  setIconCode: null,
  backFace: null,
  faceContent: null,
  watermark: null,
} as unknown as CardPreviewData;

type Box = { top: number; bottom: number; left: number; right: number };

/** Bounding box of the pixels `hit` accepts inside [x0, x1) × [y0, y1). */
function inkBox(
  lum: (x: number, y: number) => number,
  hit: (l: number) => boolean,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
): Box | null {
  let box: Box | null = null;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      if (!hit(lum(x, y))) continue;
      box = box
        ? { top: Math.min(box.top, y), bottom: Math.max(box.bottom, y), left: Math.min(box.left, x), right: Math.max(box.right, x) }
        : { top: y, bottom: y, left: x, right: x };
    }
  }
  return box;
}

describe("TextSlot.dy — real bake", () => {
  let bucket: Awaited<ReturnType<typeof standInBucket>>;
  let restoreStorage: () => void = () => {};

  beforeAll(async () => {
    bucket = await standInBucket();
  });
  afterEach(() => {
    restoreStorage();
    restoreStorage = () => {};
    slotDy.title = undefined;
    slotDy.type = undefined;
    vi.unstubAllGlobals();
  });

  async function bake(): Promise<Buffer> {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        const buf = bucket.byUrl.get(String(input));
        if (!buf) throw new Error(`unexpected fetch: ${input}`);
        return new Response(new Uint8Array(buf), { status: 200, headers: { "content-type": "image/png" } });
      }),
    );
    restoreStorage();
    restoreStorage = (await import("@/lib/frames/frame-url")).setFrameStorageForTests({
      manifest: bucket.manifest,
      origin: ORIGIN,
    });
    const mod = await import("@/lib/render/card-image");
    const png = Buffer.from(
      await (await mod.renderCardImage(sorcery, "default", { brandMark: false, watermarkText: null })).arrayBuffer(),
    );
    return sharp(png).removeAlpha().raw().toBuffer();
  }

  it("moves the name and the type line by the whole px nearest dy × width, and nothing else", async () => {
    const { getFrameProfile } = await import("@/lib/cards/template-layout");
    const before = await bake();
    const TITLE_DY = 0.0107; // 8.025 px at 750 → 8
    const TYPE_DY = -0.0081; // -6.075 px → -6
    slotDy.title = TITLE_DY;
    slotDy.type = TYPE_DY;
    expect(getFrameProfile("m15").title.dy).toBe(TITLE_DY);
    const after = await bake();

    const lumOf = (data: Buffer) => (x: number, y: number) => {
      const i = (y * W + x) * 3;
      return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    };
    const dark = (l: number) => l < 70;
    const pale = (l: number) => l > 200;
    const p = getFrameProfile("m15");
    const band = (rect: { topPct: number; heightPct: number }) => ({
      y0: Math.floor((rect.topPct / 100) * H) - 12,
      y1: Math.ceil(((rect.topPct + rect.heightPct) / 100) * H) + 12,
    });
    const title = band(p.title.rect);
    const type = band(p.type.rect);
    const textX1 = Math.round(W * 0.5);

    // The name's and the type line's dark ink: same shape, moved by the
    // rounded dy (the preview moves them by dy × width exactly: ≤ 0.5 px).
    const titleShift = Math.round(TITLE_DY * W);
    const typeShift = Math.round(TYPE_DY * W);
    expect(Math.abs(titleShift - TITLE_DY * W)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(typeShift - TYPE_DY * W)).toBeLessThanOrEqual(0.5);
    const nameBefore = inkBox(lumOf(before), dark, 0, textX1, title.y0, title.y1)!;
    const nameAfter = inkBox(lumOf(after), dark, 0, textX1, title.y0, title.y1)!;
    expect(nameBefore).not.toBeNull();
    expect(nameAfter.top - nameBefore.top).toBe(titleShift);
    expect(nameAfter.bottom - nameBefore.bottom).toBe(titleShift);
    expect([nameAfter.left, nameAfter.right]).toEqual([nameBefore.left, nameBefore.right]);
    const typeBefore = inkBox(lumOf(before), dark, 0, textX1, type.y0, type.y1)!;
    const typeAfter = inkBox(lumOf(after), dark, 0, textX1, type.y0, type.y1)!;
    expect(typeBefore).not.toBeNull();
    expect(typeAfter.top - typeBefore.top).toBe(typeShift);
    expect(typeAfter.bottom - typeBefore.bottom).toBe(typeShift);
    expect([typeAfter.left, typeAfter.right]).toEqual([typeBefore.left, typeBefore.right]);

    // The pale {W} disc stays where costDy put it.
    const discBefore = inkBox(lumOf(before), pale, textX1, W, title.y0, title.y1);
    expect(discBefore).not.toBeNull();
    expect(inkBox(lumOf(after), pale, textX1, W, title.y0, title.y1)).toEqual(discBefore);

    // Every changed pixel is the name's or the type line's: left half, inside
    // their bands (the set symbol, the pips, the rules box and the footer
    // are byte-identical).
    let changed = 0;
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        const i = (y * W + x) * 3;
        if (before[i] === after[i] && before[i + 1] === after[i + 1] && before[i + 2] === after[i + 2]) continue;
        changed += 1;
        const inText = x < textX1 && ((y >= title.y0 && y < title.y1) || (y >= type.y0 && y < type.y1));
        expect(inText, `pixel (${x}, ${y}) changed`).toBe(true);
      }
    }
    expect(changed).toBeGreaterThan(0);
  });

  it("changes nothing when dy is 0 or unset", async () => {
    const unset = await bake();
    slotDy.title = 0;
    slotDy.type = 0;
    expect((await bake()).equals(unset)).toBe(true);
  });
});
