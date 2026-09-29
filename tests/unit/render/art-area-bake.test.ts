import { createHash } from "node:crypto";
import sharp from "sharp";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { CardPreviewData } from "@/components/cards/card-preview";
import { RENDER_PRESETS } from "@/lib/render/card-image";

// ---------------------------------------------------------------------------
// Layout v35 (TODO 4.4 (2), 4.17a, 4.17b) on REAL bakes: where the art is
// painted. Every master is a fully CLEAR stand-in served from a stubbed
// bucket (the real ones are frames-bucket objects, never in git), and the art
// is one flat colour, so a pixel is either the art or the bake's #101015
// ground. The card prints no text box content, cost, P/T or loyalty, so
// nothing else sits on the probed pixels. Rendered at the "default" preset
// (750 × 1050: the percent rects halve).
//   * the see-through masters paint the art from the black border's inner
//     edge — 27.75–722.25 × 28.35–1008 here (was 30–720 × 42–1008), m15pw's
//     colourless master included (it had none);
//   * the CC M15 profiles paint the window's art in CC_M15_ART_SLOT —
//     57.5–693.2 × 118.1–583.6 here (was 58.5–691.5 × 119.7–581.7);
//   * nyx's art runs on under the whole text box, to 93 % (976.5 here; was
//     81.2 %, 852.6).
// The preview draws the same rects (tests/unit/components/art-area-preview
// .test.tsx).
// ---------------------------------------------------------------------------

const W = RENDER_PRESETS.default.width;
const ORIGIN = "https://frames.test";
const ART = [40, 160, 200] as const;
const GROUND = [16, 16, 21] as const;

const solid = (w: number, h: number, rgb: readonly number[], alpha = 1) =>
  sharp({ create: { width: w, height: h, channels: 4, background: { r: rgb[0], g: rgb[1], b: rgb[2], alpha } } }).png().toBuffer();

let artUrl = "";
let bucket: { manifest: unknown; byUrl: Map<string, Buffer> };
let restoreStorage: () => void = () => {};

beforeAll(async () => {
  artUrl = `data:image/png;base64,${(await solid(600, 840, ART)).toString("base64")}`;
  const { frameObjectKey } = await import("@/lib/frames/frame-url");
  const clear = await solid(1500, 2100, [0, 0, 0], 0);
  const files: Record<string, Buffer> = {};
  for (const master of ["m15/c", "m15/w", "m15land/g", "m15devoid/b", "m15token/c", "m15tokentext/c", "m15pw/c", "m15pw/u"]) {
    files[`${master}.png`] = clear;
  }
  const manifest = {
    version: 1 as const,
    bucket: "frames",
    files: Object.fromEntries(
      Object.entries(files).map(([key, buf]) => {
        const sha256 = createHash("sha256").update(buf).digest("hex");
        return [key, { hash: sha256.slice(0, 12), sha256, bytes: buf.length, width: 1500, height: 2100 }];
      }),
    ),
  };
  bucket = {
    manifest,
    byUrl: new Map(Object.entries(files).map(([key, buf]) => [`${ORIGIN}/${frameObjectKey(key, manifest.files[key].hash)}`, buf])),
  };
});

afterEach(() => {
  restoreStorage();
  restoreStorage = () => {};
  vi.unstubAllGlobals();
});

function card(template: string, colorIdentity: string[], over: Partial<Record<string, unknown>> = {}): CardPreviewData {
  return {
    title: "Probe",
    cost: null,
    cardType: "artifact",
    supertype: null,
    subtypes: [],
    rarity: "common",
    colorIdentity,
    rulesText: null,
    flavorText: null,
    power: null,
    toughness: null,
    loyalty: null,
    defense: null,
    artistCredit: null,
    artUrl,
    artPosition: {},
    frameStyle: { template, finish: "regular" },
    setIconUrl: null,
    setIconCode: null,
    backFace: null,
    faceContent: null,
    watermark: null,
    ...over,
  } as unknown as CardPreviewData;
}

async function bake(c: CardPreviewData) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      const buf = bucket.byUrl.get(String(input));
      if (!buf) return new Response(null, { status: 404 });
      return new Response(new Uint8Array(buf), { status: 200, headers: { "content-type": "image/png" } });
    }),
  );
  restoreStorage = (await import("@/lib/frames/frame-url")).setFrameStorageForTests({
    manifest: bucket.manifest as never,
    origin: ORIGIN,
  });
  const { renderCardImage } = await import("@/lib/render/card-image");
  const png = Buffer.from(await (await renderCardImage(c, "default", { brandMark: false, watermarkText: null })).arrayBuffer());
  const data = await sharp(png).removeAlpha().raw().toBuffer();
  return (x: number, y: number) => {
    const i = (y * W + x) * 3;
    const px = [data[i], data[i + 1], data[i + 2]];
    const near = (rgb: readonly number[]) => px.every((v, k) => Math.abs(v - rgb[k]) <= 2);
    return near(ART) ? "art" : near(GROUND) ? "ground" : `rgb(${px.join(",")})`;
  };
}

describe("layout v35 — where the art is painted (real bakes, clear stand-in masters)", { timeout: 30_000 }, () => {
  it("runs the art under every see-through master from the black border's inner edge (4.17a; m15pw/c new, 4.17b)", async () => {
    for (const [template, colours] of [
      ["m15", ["colorless"]],
      ["m15devoid", ["black"]],
      ["m15token", ["colorless"]],
      ["m15tokentext", ["colorless"]],
      ["m15pw", ["colorless"]],
    ] as const) {
      const at = await bake(card(template, [...colours], template === "m15pw" ? { cardType: "planeswalker" } : {}));
      // The top band v34 left dark (under-frame art from 42 px here): art
      // from 28.35 px down now, above the title text's rows.
      expect(at(375, 30), `${template} top band`).toBe("art");
      expect(at(375, 36), `${template} top band`).toBe("art");
      expect(at(375, 27), `${template} above the rect`).toBe("ground");
      // …and from 27.75 px in at the sides (v34: 30).
      expect(at(28, 520), `${template} left`).toBe("art");
      expect(at(26, 520), `${template} left`).toBe("ground");
      expect(at(721, 520), `${template} right`).toBe("art");
      expect(at(723, 520), `${template} right`).toBe("ground");
    }
    // A coloured walker paints an opaque master: no art under its frame.
    const blue = await bake(card("m15pw", ["blue"], { cardType: "planeswalker" }));
    expect(blue(28, 520)).toBe("ground");
    expect(blue(375, 30)).toBe("ground");
  });

  it("paints the CC M15 profiles' window art in CC_M15_ART_SLOT (4.4 (2))", async () => {
    for (const [template, colours] of [
      ["m15", ["white"]],
      ["m15land", ["green"]],
    ] as const) {
      const at = await bake(card(template, [...colours]));
      // 57.5–693.2 × 118.1–583.6 at 750 px; the v34 slot 58.5–691.5 × 119.7–581.7.
      expect(at(58, 300), `${template} left`).toBe("art");
      expect(at(56, 300), `${template} left`).toBe("ground");
      expect(at(692, 300), `${template} right`).toBe("art");
      expect(at(694, 300), `${template} right`).toBe("ground");
      expect(at(375, 119), `${template} top`).toBe("art");
      expect(at(375, 117), `${template} top`).toBe("ground");
      expect(at(375, 582), `${template} bottom`).toBe("art");
      expect(at(375, 584), `${template} bottom`).toBe("ground");
      // Opaque masters: no art under the frame.
      expect(at(28, 520), template).toBe("ground");
    }
  });

  it("runs nyx's art on under its whole text box, to 93 % (4.17b)", async () => {
    // nyx's masters are in git; a clear bucket stand-in replaces them here.
    const { frameObjectKey } = await import("@/lib/frames/frame-url");
    const clear = await solid(1500, 2100, [0, 0, 0], 0);
    const sha256 = createHash("sha256").update(clear).digest("hex");
    const manifest = bucket.manifest as { files: Record<string, unknown> };
    manifest.files["nyx/w.png"] = { hash: sha256.slice(0, 12), sha256, bytes: clear.length, width: 1500, height: 2100 };
    bucket.byUrl.set(`${ORIGIN}/${frameObjectKey("nyx/w.png", sha256.slice(0, 12))}`, clear);
    const at = await bake(card("nyx", ["white"]));
    // 6/11.2/88 × 81.8 → 45–705 × 117.6–976.5 at 750 px (v34 ended at 852.6).
    expect(at(375, 900), "the text box's lower part").toBe("art");
    expect(at(375, 975), "down to 93 %").toBe("art");
    expect(at(375, 978), "below the slot").toBe("ground");
  });
});
