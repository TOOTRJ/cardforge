import { readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CardPreviewData } from "@/components/cards/card-preview";
import { renderCardImage } from "@/lib/render/card-image";

// ---------------------------------------------------------------------------
// TODO 6.16a on REAL bakes (the git "retro" frame, read from disk):
//
//  1. A card whose text Satori's registered fonts don't cover bakes with
//     global fetch THROWING — the loader answers from disk.
//  2. For the characters production cards actually hit ("Ǵ" in an upper-cased
//     artist line, a zero-width space opening the flavor text, plus a mix),
//     the local fallback bakes the SAME BYTES next/og baked with Google
//     reachable: the recorded Google responses in fixtures/google-noto-sans
//     are replayed through the loader exactly the way next/og returned them.
// ---------------------------------------------------------------------------

const FIXTURES = path.join(__dirname, "fixtures/google-noto-sans");

/** Which answer Satori's extra-asset requests get:
 *    local  — the shipped loader (lib/render/fallback-assets.ts)
 *    google — next/og's, with Google's recorded responses (the old bake)
 *    none   — next/og's when Google was down (no font at all) */
let mode: "local" | "google" | "none" = "local";
const requests: Array<[string, string]> = [];

async function googleReplay(code: string, text: string) {
  if (code !== "unknown") throw new Error(`no recorded response for ${code}`);
  const key = [...new Set(Array.from(text, (c) => (c.codePointAt(0) as number).toString(16)))].sort().join("-");
  const file = {
    "1f4": "text-1f4.ttf",
    "200b": "text-200b.ttf",
    "1f4-1f5-200b": "text-1f5-1f4-200b.ttf",
  }[key];
  if (!file) throw new Error(`no recorded response for ${key}`);
  const bytes = readFileSync(path.join(FIXTURES, file));
  // next/og hands Satori the response's ArrayBuffer under this name.
  const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return [{ name: `satori_unknown_fallback_${text}`, data, weight: 400 as const, style: "normal" as const, lang: undefined }];
}

vi.mock("@/lib/render/fallback-assets", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/render/fallback-assets")>();
  return {
    ...real,
    loadLocalAdditionalAsset: async (code: string, text: string) => {
      requests.push([code, text]);
      if (mode === "google") return googleReplay(code, text);
      if (mode === "none") return [];
      return real.loadLocalAdditionalAsset(code, text);
    },
  };
});

// Any network request throws (a `data:` URL is not the network).
const realFetch = globalThis.fetch;
const fetchSpy = vi.fn((input: RequestInfo | URL): Promise<Response> => {
  throw new Error(`render-time fetch: ${String(input).slice(0, 80)}`);
});

beforeEach(() => {
  requests.length = 0;
  fetchSpy.mockClear();
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) =>
    String(input).startsWith("data:") ? realFetch(input, init) : fetchSpy(input),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  mode = "local";
});

function card(patch: Partial<CardPreviewData>): CardPreviewData {
  return {
    title: "Kiba and Akamaru",
    cost: "{2}{G}{G}{W}{W}",
    cardType: "creature",
    supertype: null,
    subtypes: ["Wurm"],
    rarity: "mythic",
    colorIdentity: ["green"],
    rulesText: "Trample",
    flavorText: null,
    power: "5",
    toughness: "5",
    loyalty: null,
    defense: null,
    artistCredit: "Probe",
    artUrl: null,
    artPosition: {},
    frameStyle: { template: "retro", finish: "regular" },
    setIconUrl: null,
    setIconCode: null,
    backFace: null,
    faceContent: null,
    watermark: null,
    ...patch,
  } as CardPreviewData;
}

async function bake(data: CardPreviewData, as: typeof mode): Promise<Buffer> {
  mode = as;
  const res = await renderCardImage(data, "default", { brandMark: true, watermarkText: null });
  return Buffer.from(await res.arrayBuffer());
}

// The shapes of the two public production cards that fetched Noto Sans at
// every bake before this change, and a mix with a fallback glyph inside a
// body-font word, one opening a word, and a zero-width space. The last flag:
// does the fallback font change the pixels at all? (Beleren draws its own
// missing-glyph box mid-word, so the artist line looks the same either way.)
const PRODUCTION_SHAPES: Array<[string, Partial<CardPreviewData>, boolean]> = [
  ["artist line with ǵ (upper-cased to Ǵ in the footer)", { artistCredit: "Volkan Baǵa" }, false],
  [
    "flavor text opening with a zero-width space",
    { flavorText: "​\"Some roots grow deep in the earth; others grow deep in the heart.\"" },
    true,
  ],
  [
    "rules text with ǵ mid-word and Ǵ word-initial, flavor with U+200B",
    { rulesText: "Trample\nWhen Baǵa enters, Ǵoran gains trample.", flavorText: "​Roots hold." },
    true,
  ],
];

describe("bake fallback glyphs without the network", () => {
  it.each(PRODUCTION_SHAPES)(
    "%s: the bytes next/og baked with Google reachable",
    async (_label, patch, fallbackVisible) => {
      const data = card(patch);
      const before = await bake(data, "google");
      const googleRequests = requests.splice(0);
      const after = await bake(data, "local");
      expect(requests).toEqual(googleRequests); // Satori asked for the same things
      expect(googleRequests.length).toBeGreaterThan(0);
      expect(after.equals(before)).toBe(true);
      expect(fetchSpy).not.toHaveBeenCalled();
      // Not vacuous: with no fallback font at all the bake differs.
      if (fallbackVisible) expect((await bake(data, "none")).equals(before)).toBe(false);
    },
    60_000,
  );

  it("bakes emoji, CJK, Arabic and out-of-font symbols with fetch throwing", async () => {
    const png = await bake(
      card({
        title: "Ember 🔥 Drake",
        rulesText: "Flying ★ ⇒ ✗\nعربى",
        flavorText: "竜の炎。 👍🏽",
        artistCredit: "Ǵoran ☠",
      }),
      "local",
    );
    const meta = await sharp(png).metadata();
    expect(meta.format).toBe("png");
    expect(meta.width).toBeGreaterThan(0);
    expect(fetchSpy).not.toHaveBeenCalled();
    const classes = new Set(requests.map(([code]) => code));
    expect(classes).toContain("emoji");
    expect(classes).toContain("unknown");
    expect([...classes].some((c) => c.includes("ja-JP"))).toBe(true);
  }, 60_000);
});
