import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  loadLocalAdditionalAsset,
  NOTO_FALLBACK_FAMILY,
  notoFontForText,
  notoRequestCodepoints,
  STRIPPED_EMOJI_IMAGE,
} from "@/lib/render/fallback-assets";
import { readCmap, withCmap } from "@/lib/render/font-cmap";

// ---------------------------------------------------------------------------
// TODO 6.16a — Satori's extra-asset loader is answered from disk. These pin
// (a) that it never reaches the network, and (b) that the "unknown"-class
// font it builds maps what Google's per-request Noto Sans subset mapped — the
// recorded responses in fixtures/google-noto-sans are the ground truth.
// ---------------------------------------------------------------------------

const ROOT = path.resolve(__dirname, "../../..");
const FIXTURES = path.join(__dirname, "fixtures/google-noto-sans");
const NOTO = readFileSync(path.join(ROOT, "public/fonts/NotoSans-Fallback.ttf"));
const googleCmaps = JSON.parse(readFileSync(path.join(FIXTURES, "subset-cmaps.json"), "utf8")) as Record<
  string,
  number[]
>;
const textOf = (key: string) =>
  key
    .split(" ")
    .map((u) => String.fromCodePoint(parseInt(u.slice(2), 16)))
    .join("");

/** The sfnt table directory, tag → bytes. */
function tables(font: Uint8Array): Map<string, Buffer> {
  const buf = Buffer.from(font);
  const out = new Map<string, Buffer>();
  for (let i = 0; i < buf.readUInt16BE(4); i += 1) {
    const at = 12 + i * 16;
    const offset = buf.readUInt32BE(at + 8);
    out.set(buf.toString("latin1", at, at + 4), buf.subarray(offset, offset + buf.readUInt32BE(at + 12)));
  }
  return out;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("loadLocalAdditionalAsset — never the network", () => {
  it("answers every class without calling fetch", async () => {
    const fetchSpy = vi.fn(() => {
      throw new Error("render-time fetch");
    });
    vi.stubGlobal("fetch", fetchSpy);
    expect(await loadLocalAdditionalAsset("emoji", "🔥")).toBe(STRIPPED_EMOJI_IMAGE);
    expect(await loadLocalAdditionalAsset("ja-JP|zh-CN|zh-TW|zh-HK", "日本")).toEqual([]);
    expect(await loadLocalAdditionalAsset("symbol", "★")).toEqual([]);
    expect(await loadLocalAdditionalAsset("math", "′")).toEqual([]);
    expect(await loadLocalAdditionalAsset("ar-AR", "عربى")).toEqual([]);
    const fonts = await loadLocalAdditionalAsset("unknown", "Ǵ");
    expect(Array.isArray(fonts) && fonts).toMatchObject([
      { name: NOTO_FALLBACK_FAMILY, weight: 400, style: "normal" },
    ]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("answers decomposed (NFD) Latin that satori files under another script from Noto Sans", async () => {
    // "u" + U+0308 is classed he-IL, "n" + U+0303 th-TH: next/og fetched Noto
    // Sans Hebrew / Thai and drew the marks; without an answer they left a gap.
    const hebrew = await loadLocalAdditionalAsset("he-IL", "üöä");
    const thai = await loadLocalAdditionalAsset("th-TH", "ñ");
    expect(hebrew).toMatchObject([{ name: `${NOTO_FALLBACK_FAMILY} he-IL`, weight: 400, style: "normal" }]);
    expect(thai).toMatchObject([{ name: `${NOTO_FALLBACK_FAMILY} th-TH` }]);
    const cmapOf = (fonts: Awaited<ReturnType<typeof loadLocalAdditionalAsset>>) =>
      readCmap(Buffer.from((fonts as Array<{ data: Buffer }>)[0].data));
    expect(cmapOf(hebrew).has(0x308)).toBe(true);
    expect(cmapOf(thai).has(0x303)).toBe(true);
    // Real Hebrew / Thai / CJK text still gets nothing.
    expect(await loadLocalAdditionalAsset("he-IL", "שלום")).toEqual([]);
    expect(await loadLocalAdditionalAsset("th-TH", "ภาษา")).toEqual([]);
    expect(await loadLocalAdditionalAsset("ja-JP", "ẹ日")).toEqual([]);
  });

  it("strips emoji to an invisible SVG", () => {
    const svg = Buffer.from(STRIPPED_EMOJI_IMAGE.split(",")[1], "base64").toString();
    expect(STRIPPED_EMOJI_IMAGE.startsWith("data:image/svg+xml;base64,")).toBe(true);
    expect(svg).toMatch(/^<svg [^>]*\/>$/);
  });

  it("gives no font for a request Google was never sent (outside Noto Sans' ranges)", async () => {
    expect(notoRequestCodepoints("ﬁ")).toBeNull();
    expect(notoRequestCodepoints("\u{10400}")).toBeNull(); // Deseret
    expect(await loadLocalAdditionalAsset("unknown", "\u{10400}")).toEqual([]);
  });
});

describe("the request font matches Google's per-request subset", () => {
  it.each(Object.keys(googleCmaps).filter((key) => key !== "U+FB01"))(
    "maps exactly what Google mapped for %s",
    (key) => {
      expect(notoRequestCodepoints(textOf(key))).toEqual(googleCmaps[key]);
    },
  );

  it("keeps the full font's glyph ids, outlines and metrics — only the cmap changes", () => {
    const full = readCmap(NOTO);
    const font = notoFontForText("ǵǴ​");
    expect(font).not.toBeNull();
    const mapped = readCmap(font as Buffer);
    expect([...mapped.keys()]).toEqual(googleCmaps["U+01F5 U+01F4 U+200B"]);
    for (const [cp, gid] of mapped) expect(gid).toBe(full.get(cp));
    const before = tables(NOTO);
    const after = tables(font as Buffer);
    expect([...after.keys()].sort()).toEqual([...before.keys()].sort());
    for (const tag of ["glyf", "loca", "hmtx", "hhea", "maxp", "OS/2", "post", "name"]) {
      expect(after.get(tag)?.equals(before.get(tag) as Buffer), tag).toBe(true);
    }
  });

  it("reuses the same bytes for the same request (Satori parses each data object once)", () => {
    expect(notoFontForText("Ǵ")).toBe(notoFontForText("Ǵ"));
  });

  it("the bundled glyphs are Google's: every mapped glyph of a recorded response has the same outline bytes", () => {
    // glyf data per glyph, compared through each font's own loca + cmap.
    const glyphBytes = (font: Uint8Array, cp: number) => {
      const t = tables(font);
      const head = t.get("head") as Buffer;
      const loca = t.get("loca") as Buffer;
      const glyf = t.get("glyf") as Buffer;
      const long = head.readInt16BE(50) === 1;
      const gid = readCmap(font).get(cp) as number;
      const at = (i: number) => (long ? loca.readUInt32BE(i * 4) : loca.readUInt16BE(i * 2) * 2);
      return glyf.subarray(at(gid), at(gid + 1));
    };
    const google = readFileSync(path.join(FIXTURES, "text-200b.ttf"));
    // U+200B and space are simple (empty) glyphs; ǵ/Ǵ are composites whose
    // component ids are renumbered by any subsetter, so compare those through
    // the rendered bake (fallback-assets-bake.test.ts) instead.
    for (const cp of [0x20, 0x200b]) {
      expect(glyphBytes(NOTO, cp).equals(glyphBytes(google, cp))).toBe(true);
    }
  });
});

describe("withCmap", () => {
  it("writes a cmap opentype-style parsers read back exactly", () => {
    const entries: Array<[number, number]> = [
      [0x41, 36],
      [0x42, 37],
      [0x43, 38],
      [0x1f5, 959],
      [0x10400, 5],
    ];
    const font = withCmap(NOTO, entries);
    expect([...readCmap(font).entries()]).toEqual(entries);
  });
});
