import { createHash } from "node:crypto";
import sharp from "sharp";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { CardPreviewData } from "@/components/cards/card-preview";
import { displayLine } from "@/lib/cards/card-display";
import { TYPE_SYMBOL_GAP_PCT, fitTypeLineBand, measuredLinePx } from "@/lib/cards/render-tiers";
import { setSymbolSize, setSymbolSource } from "@/lib/cards/set-symbol-size";
import { getFrameProfile } from "@/lib/cards/template-layout";
import { fitTitleBand, manaCostWidthPct } from "@/lib/cards/title-band";
import { RULES_TEXT, ptToPct } from "@/lib/cards/typography";
import { RENDER_PRESETS } from "@/lib/render/card-image";
import { displayRunPx } from "@/lib/render/satori-text";

// ---------------------------------------------------------------------------
// Layout v32's review fixes (TODO 4.20) on REAL bakes of the shipped
// profiles:
//   • a walker's long name beside a one-pip cost is drawn WHOLE by the bake
//     — its fit's room never exceeds the room the bake's band lays it out in
//     (Satori used to cut it with its own "…" while the preview drew it
//     whole) — at both bake sizes;
//   • a type line too long even at the 5 pt floor is drawn as the fit's ONE
//     "…"-cut string, at the floor's whole px, a print's gap before the set
//     symbol's ink (both renderers draw that string);
//   • the rules backdrop is painted UNDER the type band: on Expedition, whose
//     rules box overlaps the type bar, it no longer dims the bake's set
//     symbol.
// The Card Conjurer masters live in the frames bucket: the bake is served a
// flat light-grey stand-in (so the dark ink is the only dark mark in its
// band); Expedition's MSE master is read from public/frames as always.
// ---------------------------------------------------------------------------

const ORIGIN = "https://frames.test";

async function standInBucket() {
  const { frameObjectKey } = await import("@/lib/frames/frame-url");
  const frame = await sharp({
    create: { width: 1500, height: 2100, channels: 4, background: { r: 200, g: 200, b: 200, alpha: 1 } },
  })
    .png()
    .toBuffer();
  const files: Record<string, Buffer> = { "m15/b.png": frame, "m15pw/b.png": frame };
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

/** An opaque blue diamond on transparency — an uploaded set icon. */
async function iconDataUrl(): Promise<string> {
  const size = 128;
  const px = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = (y * size + x) * 4;
      px[i] = 30;
      px[i + 1] = 90;
      px[i + 2] = 160;
      px[i + 3] = Math.abs(x - 64) + Math.abs(y - 64) < 60 ? 255 : 0;
    }
  }
  const png = await sharp(px, { raw: { width: size, height: size, channels: 4 } }).png().toBuffer();
  return `data:image/png;base64,${png.toString("base64")}`;
}

function card(over: Partial<CardPreviewData> & { template: string }): CardPreviewData {
  const { template, ...rest } = over;
  return {
    title: "Probe",
    cost: "{2}{B}",
    cardType: "sorcery",
    supertype: null,
    subtypes: [],
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
    frameStyle: { template, finish: "regular" },
    setIconUrl: null,
    setIconCode: null,
    backFace: null,
    faceContent: null,
    watermark: null,
    ...rest,
  } as unknown as CardPreviewData;
}

type Img = { data: Buffer; width: number };
type Box = { top: number; bottom: number; left: number; right: number };

function inkBox(img: Img, hit: (r: number, g: number, b: number) => boolean, x0: number, x1: number, y0: number, y1: number): Box | null {
  let box: Box | null = null;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const i = (y * img.width + x) * 3;
      if (!hit(img.data[i], img.data[i + 1], img.data[i + 2])) continue;
      box = box
        ? { top: Math.min(box.top, y), bottom: Math.max(box.bottom, y), left: Math.min(box.left, x), right: Math.max(box.right, x) }
        : { top: y, bottom: y, left: x, right: x };
    }
  }
  return box;
}

/** The name's (or type line's) dark ink — near-black, unsaturated. */
const dark = (r: number, g: number, b: number) => r < 90 && g < 90 && b < 90 && Math.max(r, g, b) - Math.min(r, g, b) < 30;
/** Anything that isn't the stand-in's flat grey. */
const marked = (r: number, g: number, b: number) => Math.abs(r - 200) + Math.abs(g - 200) + Math.abs(b - 200) > 24;

describe("layout v32 review fixes — real bakes", () => {
  let bucket: Awaited<ReturnType<typeof standInBucket>>;
  let restoreStorage: () => void = () => {};

  beforeAll(async () => {
    bucket = await standInBucket();
  });
  afterEach(() => {
    restoreStorage();
    restoreStorage = () => {};
    vi.unstubAllGlobals();
  });

  async function bake(c: CardPreviewData, preset: "default" | "hd" = "default"): Promise<Img> {
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
    const png = Buffer.from(await (await mod.renderCardImage(c, preset, { brandMark: false, watermarkText: null })).arrayBuffer());
    return { data: await sharp(png).removeAlpha().raw().toBuffer(), width: RENDER_PRESETS[preset].width };
  }

  it("draws a walker's long name whole beside a one-pip cost, at both bake sizes", async () => {
    const pw = getFrameProfile("m15pw");
    const cost = "{B}";
    for (const preset of ["default", "hd"] as const) {
      const { width: W, height: H } = RENDER_PRESETS[preset];
      for (const name of ["Ajani, Betrayer of the First Light", "Teferi, the Harbinger of Stone II"]) {
        const fit = fitTitleBand(pw, name, cost, "portrait")!;
        // The text both renderers draw: the whole name.
        expect(fit.text).toBe(name);
        const px = measuredLinePx(fit.sizePct, pw.title.sizePct, W);
        const out = await bake(card({ template: "m15pw", title: name, cost }), preset);
        const rect = pw.title.rect;
        const y0 = Math.floor((rect.topPct / 100) * H) - 12;
        const y1 = Math.ceil(((rect.topPct + rect.heightPct) / 100) * H) + 12;
        const left = Math.round((rect.leftPct / 100) * W);
        const box = pw.costRect!;
        const pipsLeft = Math.floor(((box.leftPct + box.widthPct) / 100 - manaCostWidthPct(cost, pw.costSizePct!)) * W);
        // (Short of the disc's dark hard shadow, ≈ 0.1 disc left of it.)
        const shadow = Math.ceil(0.1 * pw.costSizePct! * W) + 2;
        const ink = inkBox(out, dark, left - 4, pipsLeft - shadow, y0, y1)!;
        // Its ink ends where the whole name's kerned run does — not at a "…".
        const run = displayRunPx(displayLine(name), px, (pw.title.letterSpacingEm ?? 0) * px);
        // (Within the last letter's side bearing; a "…" would end it ≥ 40 px
        // short at 750.)
        expect(ink.right, `${preset} ${name}`).toBeLessThanOrEqual(left + run.ink + 2);
        expect(ink.right, `${preset} ${name}`).toBeGreaterThanOrEqual(left + run.ink - (preset === "hd" ? 10 : 5));
      }
    }
  });

  it("draws a type line too long for the floor as the fit's one '…' string, a print's gap before the symbol", async () => {
    const m15 = getFrameProfile("m15");
    const { width: W, height: H } = RENDER_PRESETS.default;
    const subtypes = ["Arcane", "Lesson", "Trap", "Adventure", "Omen", "Case", "Room", "Plan", "Class", "Saga", "Aura"];
    const c = card({ template: "m15", supertype: "Legendary", subtypes });
    const typeLine = `Legendary Sorcery — ${subtypes.join(" ")}`;
    const symbol = setSymbolSize(m15, setSymbolSource(null, null));
    const fit = fitTypeLineBand({
      layout: m15,
      text: typeLine,
      symbolWidthPct: symbol.drawnWidthPct,
      symbolInkLeftPct: symbol.inkLeftPct,
    });
    expect(fit.sizePct).toBe(ptToPct(RULES_TEXT.hardFloorPt));
    expect(fit.text.endsWith("…")).toBe(true);
    // The bake's whole px: the floor's own (21 at 750), never the one below.
    const px = measuredLinePx(fit.sizePct, m15.type.sizePct, W);
    expect(px).toBe(21);
    const out = await bake(c);
    const rect = m15.type.rect;
    const y0 = Math.floor((rect.topPct / 100) * H) - 8;
    const y1 = Math.ceil(((rect.topPct + rect.heightPct) / 100) * H) + 8;
    const left = Math.round((rect.leftPct / 100) * W);
    const right = Math.round(((rect.leftPct + rect.widthPct) / 100) * W);
    const symbolW = Math.round(symbol.drawnWidthPct * W);
    const mark = inkBox(out, marked, right - symbolW - 2, right + 2, y0, y1)!;
    const line = inkBox(out, dark, left - 4, right - symbolW - 4, y0, y1)!;
    const run = displayRunPx(displayLine(fit.text), px, 0);
    expect(Math.abs(line.right - (left + run.ink))).toBeLessThanOrEqual(4);
    expect(mark.left - line.right).toBeGreaterThanOrEqual(Math.round(TYPE_SYMBOL_GAP_PCT * W) - 2);
  });

  it("keeps a shrunk name on its band's baseline, as a print sets it (slotTextDy)", async () => {
    const m15 = getFrameProfile("m15");
    const cost = "{2}{W}{W}";
    // No descenders (Beleren's H, g, p… have them): the lowest row with a
    // few ink px is the baseline (a round letter's overshoot is thinner).
    const short = "Moonlit Warden";
    const long = "Moonlit Warden of the Silent Crown Tower";
    const fit = fitTitleBand(m15, long, cost, "portrait")!;
    expect(fit.text).toBe(long);
    for (const preset of ["default", "hd"] as const) {
      const { width: W, height: H } = RENDER_PRESETS[preset];
      const shrink = Math.round(m15.title.sizePct * W) - measuredLinePx(fit.sizePct, m15.title.sizePct, W);
      expect(shrink).toBeGreaterThan(0.3 * m15.title.sizePct * W);
      const rect = m15.title.rect;
      const y0 = Math.floor((rect.topPct / 100) * H) - 12;
      const y1 = Math.ceil(((rect.topPct + rect.heightPct) / 100) * H) + 12;
      const x0 = Math.round((rect.leftPct / 100) * W) - 4;
      const x1 = Math.round(((rect.leftPct + rect.widthPct) / 100) * W * 0.6);
      const baseline = async (name: string) => {
        const img = await bake(card({ template: "m15", title: name, cost }), preset);
        let row = -1;
        for (let y = y0; y < y1; y += 1) {
          let n = 0;
          for (let x = x0; x < x1; x += 1) {
            const i = (y * img.width + x) * 3;
            if (dark(img.data[i], img.data[i + 1], img.data[i + 2])) n += 1;
          }
          if (n >= 3) row = y;
        }
        return row;
      };
      // Centred, it would climb ≈ ⅓ px per px it shrank (≥ 4 px at 750,
      // ≥ 9 at HD here); kept, it lands within the bake's rounding of the
      // full-size name's baseline (Satori sets the line ≈ 0.36 em below the
      // band's centre where the preview's hhea box puts it at ⅓ em).
      expect(shrink / 3).toBeGreaterThan(preset === "hd" ? 8 : 4);
      expect(Math.abs((await baseline(long)) - (await baseline(short))), preset).toBeLessThanOrEqual(2);
    }
  });

  it("paints Expedition's rules backdrop under its set symbol, as the preview layers it", async () => {
    const icon = await iconDataUrl();
    const exp = getFrameProfile("expeditionland");
    const { width: W, height: H } = RENDER_PRESETS.hd;
    // The rules box overlaps the type bar: the backdrop reaches the symbol.
    const sym = setSymbolSize(exp, setSymbolSource(icon, null));
    const bandCentre = ((exp.type.rect.topPct + exp.type.rect.heightPct / 2) / 100) * H;
    const symbolBottom = bandCentre + (sym.sizePct * W) / 2;
    expect((exp.rules.rect.topPct / 100) * H).toBeLessThan(symbolBottom - 10);
    const base = { template: "expeditionland", title: "Probe Expanse", cardType: "land" as const, cost: null, setIconUrl: icon };
    const bare = await bake(card({ ...base, rulesText: null }), "hd");
    const boxed = await bake(card({ ...base, rulesText: "{T}: Add {C}." }), "hd");
    const blue = (r: number, g: number, b: number) => Math.abs(r - 30) < 12 && Math.abs(g - 90) < 12 && Math.abs(b - 160) < 12;
    const right = Math.round(((exp.type.rect.leftPct + exp.type.rect.widthPct) / 100) * W);
    const x0 = right - Math.round(sym.drawnWidthPct * W) - 4;
    const y0 = Math.floor((exp.type.rect.topPct / 100) * H) - 10;
    const y1 = Math.ceil(symbolBottom) + 10;
    const a = inkBox(bare, blue, x0, right + 4, y0, y1)!;
    const b = inkBox(boxed, blue, x0, right + 4, y0, y1)!;
    // The icon's full height shows through in both — no dimmed lower part.
    expect(b.bottom).toBe(a.bottom);
    expect(b.top).toBe(a.top);
    expect(a.bottom).toBeGreaterThan((exp.rules.rect.topPct / 100) * H + 5);
  });
});
