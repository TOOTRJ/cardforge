import { createHash } from "node:crypto";
import sharp from "sharp";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { CardPreviewData } from "@/components/cards/card-preview";
import { displayLine } from "@/lib/cards/card-display";
import { BAND_GAP_PCT, TYPE_SYMBOL_GAP_PCT, fitTypeLine, measuredLinePx } from "@/lib/cards/render-tiers";
import { setSymbolSize, setSymbolSource } from "@/lib/cards/set-symbol-size";
import { fitTitleBand } from "@/lib/cards/title-band";
import { TITLE_SIZE_PCT, TYPE_SIZE_PCT } from "@/lib/cards/typography";
import { RENDER_PRESETS } from "@/lib/render/card-image";
import { displayRunPx } from "@/lib/render/satori-text";

// ---------------------------------------------------------------------------
// The measured fits (TODO 4.20, layout v32) on a REAL bake: a name too long
// for the room beside its inline cost is drawn WHOLE at the fitted size (the
// whole px below it), ending where its kerned run ends — not cut with a "…"
// at the band's edge — and clear of the pips; a long type line ends a
// print's gap (TYPE_SYMBOL_GAP_PCT) before the set symbol's ink; and where
// nothing needs fitting the flag
// changes no pixel. The preview's twin is
// tests/unit/components/measured-fit-preview.test.tsx; both call the same
// helpers (tests/unit/render/render-parity.test.ts). The m15 profile is set
// to the family's sizes in both runs and gets the flag only in the measured
// one, through a wrapped getFrameProfile. The m15 masters live in the frames
// bucket: the bake is served a flat light-grey stand-in, so the dark ink and
// the discs are the only marks in their bands. 750 × 1050 ("default").
// ---------------------------------------------------------------------------

const flags = vi.hoisted(() => ({ on: false }));

vi.mock("@/lib/cards/template-layout", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/cards/template-layout")>();
  const { TITLE_SIZE_PCT: TITLE, TYPE_SIZE_PCT: TYPE } = await import("@/lib/cards/typography");
  return {
    ...real,
    getFrameProfile: (template?: string) => {
      const p = real.getFrameProfile(template);
      if (template !== "m15") return p;
      // The shipped m15 carries the flag: cleared for the old-path run.
      const fit = { fit: flags.on ? ("measured" as const) : undefined };
      return { ...p, title: { ...p.title, sizePct: TITLE, ...fit }, type: { ...p.type, sizePct: TYPE, ...fit } };
    },
  };
});

const W = RENDER_PRESETS.default.width;
const H = RENDER_PRESETS.default.height;
const ORIGIN = "https://frames.test";

async function standInBucket() {
  const { frameObjectKey } = await import("@/lib/frames/frame-url");
  const frame = await sharp({
    create: { width: 1500, height: 2100, channels: 4, background: { r: 200, g: 200, b: 200, alpha: 1 } },
  })
    .png()
    .toBuffer();
  const files: Record<string, Buffer> = { "m15/b.png": frame };
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

const LONG_NAME = "Vinnie 'Goldfang' Lupo, Boss of Burrow Street";
const LONG_TYPE = "Legendary Sorcery — Arcane Lesson Trap Adventure";
const COST = "{2}{B}{B}";

function sorcery(title: string, subtypes: string[], supertype: string | null): CardPreviewData {
  return {
    title,
    cost: COST,
    cardType: "sorcery",
    supertype,
    subtypes,
    rarity: "common",
    colorIdentity: ["black"],
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
}

type Box = { top: number; bottom: number; left: number; right: number };

function inkBox(data: Buffer, hit: (r: number, g: number, b: number) => boolean, x0: number, x1: number, y0: number, y1: number): Box | null {
  let box: Box | null = null;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const i = (y * W + x) * 3;
      if (!hit(data[i], data[i + 1], data[i + 2])) continue;
      box = box
        ? { top: Math.min(box.top, y), bottom: Math.max(box.bottom, y), left: Math.min(box.left, x), right: Math.max(box.right, x) }
        : { top: y, bottom: y, left: x, right: x };
    }
  }
  return box;
}

/** The name's (or type line's) dark ink — near-black, unsaturated. */
const dark = (r: number, g: number, b: number) => r < 90 && g < 90 && b < 90 && Math.max(r, g, b) - Math.min(r, g, b) < 30;
/** Anything that isn't the stand-in's flat grey: ink, discs, the mark. */
const marked = (r: number, g: number, b: number) => Math.abs(r - 200) + Math.abs(g - 200) + Math.abs(b - 200) > 24;

describe("the measured fits — real bake", () => {
  let bucket: Awaited<ReturnType<typeof standInBucket>>;
  let restoreStorage: () => void = () => {};

  beforeAll(async () => {
    bucket = await standInBucket();
  });
  afterEach(() => {
    restoreStorage();
    restoreStorage = () => {};
    flags.on = false;
    vi.unstubAllGlobals();
  });

  async function bake(card: CardPreviewData): Promise<Buffer> {
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
      await (await mod.renderCardImage(card, "default", { brandMark: false, watermarkText: null })).arrayBuffer(),
    );
    return sharp(png).removeAlpha().raw().toBuffer();
  }

  it("draws a long name whole at the fitted size, clear of its pips, where the old path cut it", async () => {
    const { getFrameProfile } = await import("@/lib/cards/template-layout");
    const card = sorcery(LONG_NAME, ["Arcane"], null);
    const cut = await bake(card);
    flags.on = true;
    const layout = getFrameProfile("m15");
    const fit = fitTitleBand(layout, LONG_NAME, COST, "portrait")!;
    expect(fit.text).toBe(LONG_NAME);
    const fitted = await bake(card);

    const band = { y0: Math.floor((layout.title.rect.topPct / 100) * H) - 10, y1: Math.ceil(((layout.title.rect.topPct + layout.title.rect.heightPct) / 100) * H) + 10 };
    const left = Math.round((layout.title.rect.leftPct / 100) * W);
    const right = Math.round(((layout.title.rect.leftPct + layout.title.rect.widthPct) / 100) * W);
    // The pips: the first disc's left edge (its hard shadow included).
    const discsWholeBand = inkBox(fitted, marked, left, right, band.y0, band.y1)!;
    const pipsLeft = (() => {
      // Scan leftwards from the band's right end for the first column gap
      // wider than the name ↔ cost gap's half: the row of discs ends there.
      const cols = Array.from({ length: right - left }, (_, i) => inkBox(fitted, marked, left + i, left + i + 1, band.y0, band.y1) !== null);
      let x = cols.length - 1;
      while (x > 0 && !cols[x]) x -= 1;
      let gap = 0;
      for (; x > 0; x -= 1) {
        gap = cols[x] ? 0 : gap + 1;
        if (gap >= 8) return left + x + gap;
      }
      return left;
    })();
    expect(discsWholeBand.right).toBeGreaterThan(pipsLeft);

    // Fitted: the name's ink runs from the band's start to where its kerned
    // run ends at the whole px below the fitted size — the whole name.
    const px = measuredLinePx(fit.sizePct, TITLE_SIZE_PCT, W);
    expect(px).toBe(Math.floor(fit.sizePct * W));
    expect(px).toBeLessThan(Math.round(TITLE_SIZE_PCT * W));
    const run = displayRunPx(displayLine(LONG_NAME), px, (layout.title.letterSpacingEm ?? 0) * px);
    const name = inkBox(fitted, dark, left - 4, pipsLeft, band.y0, band.y1)!;
    expect(Math.abs(name.right - (left + run.ink))).toBeLessThanOrEqual(4);
    // …a band gap and more clear of the pips.
    expect(pipsLeft - name.right).toBeGreaterThanOrEqual(Math.round(BAND_GAP_PCT * W) - 2);

    // The old path set it at 40 px and cut it where the pips' room ends: its
    // ink is taller and runs on to that room's end (the "…").
    const old = inkBox(cut, dark, left - 4, pipsLeft, band.y0, band.y1)!;
    expect(old.bottom - old.top).toBeGreaterThan(name.bottom - name.top + 6);
    const oldRun = displayRunPx(displayLine(LONG_NAME), Math.round(TITLE_SIZE_PCT * W), 0);
    expect(left + oldRun.ink).toBeGreaterThan(old.right + 100);
  });

  it("ends a long type line a print's gap before the set symbol's ink", async () => {
    const { getFrameProfile } = await import("@/lib/cards/template-layout");
    flags.on = true;
    const layout = getFrameProfile("m15");
    const typeLine = LONG_TYPE;
    // No set code or icon: the default mark, drawn the box wide.
    const symbolWidthPct = setSymbolSize(layout, setSymbolSource(null, null)).drawnWidthPct;
    const size = fitTypeLine({ layout, text: typeLine, symbolWidthPct, orientation: "portrait" });
    expect(size).toBeLessThan(TYPE_SIZE_PCT);
    const out = await bake(sorcery("Probe", ["Arcane", "Lesson", "Trap", "Adventure"], "Legendary"));
    const band = { y0: Math.floor((layout.type.rect.topPct / 100) * H) - 6, y1: Math.ceil(((layout.type.rect.topPct + layout.type.rect.heightPct) / 100) * H) + 6 };
    const left = Math.round((layout.type.rect.leftPct / 100) * W);
    const right = Math.round(((layout.type.rect.leftPct + layout.type.rect.widthPct) / 100) * W);
    const symbolW = Math.round(symbolWidthPct * W);
    // The default mark is drawn right-aligned in the band, `symbolW` square.
    const symbol = inkBox(out, marked, right - symbolW - 2, right + 2, band.y0, band.y1)!;
    expect(symbol).not.toBeNull();
    const line = inkBox(out, dark, left - 4, right - symbolW - 4, band.y0, band.y1)!;
    const px = measuredLinePx(size, TYPE_SIZE_PCT, W);
    expect(px).toBe(Math.floor(size * W));
    const run = displayRunPx(displayLine(typeLine), px, 0);
    expect(Math.abs(line.right - (left + run.ink))).toBeLessThanOrEqual(4);
    expect(symbol.left - line.right).toBeGreaterThanOrEqual(Math.round(TYPE_SYMBOL_GAP_PCT * W) - 2);
  });

  it("changes no pixel where nothing needs fitting", async () => {
    const card = sorcery("Serra's Wrath", ["Arcane"], null);
    const plain = await bake(card);
    flags.on = true;
    expect((await bake(card)).equals(plain)).toBe(true);
  });
});
