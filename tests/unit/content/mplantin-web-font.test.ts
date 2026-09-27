import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { brotliDecompressSync, inflateSync } from "node:zlib";
// @ts-expect-error -- opentype.js (a dev dependency) ships no type declarations.
import opentype from "opentype.js";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// The editor and live preview draw rules text with the MPlantin web font
// (app/globals.css lists mplantin.woff2, then .woff, then .ttf); the Satori
// bake reads the .ttf master. Until 2026-09-27 the .woff2 was a re-encode of
// that .ttf, whose cmap subtables carry language 1: Chromium's font
// sanitiser (OTS) rejects that ("cmap: Languages should be 0 (1)"), so every
// page downloaded the .woff2, threw it away and fetched the .woff instead
// (TODO 3.27, found in 4.31). The .woff2 is now the .woff's own sfnt
// re-encoded: `python3 -m fontTools.ttLib.woff2 compress -o
// public/fonts/mplantin.woff2 public/fonts/mplantin.woff` (fontTools 4.60.2,
// brotli 1.2.0; no transform applies to a CFF font). These tests hold it to
// the .woff table for table and keep the master untouched;
// tests/e2e/web-fonts.spec.ts loads it in Chromium itself.
// ---------------------------------------------------------------------------

const FONTS = path.join(process.cwd(), "public/fonts");
const MANA_FONT = path.join(process.cwd(), "node_modules/mana-font/fonts");
const read = (dir: string, file: string) => readFileSync(path.join(dir, file));

type Table = { data: Buffer; transformed: boolean };
type Font = { flavor: string; tables: Map<string, Table> };

/** A bare sfnt (.ttf/.otf): a table directory of offsets into the file. */
function decodeSfnt(buf: Buffer): Font {
  const tables = new Map<string, Table>();
  for (let i = 0; i < buf.readUInt16BE(4); i++) {
    const at = 12 + 16 * i;
    const offset = buf.readUInt32BE(at + 8);
    tables.set(buf.toString("latin1", at, at + 4), {
      data: buf.subarray(offset, offset + buf.readUInt32BE(at + 12)),
      transformed: false,
    });
  }
  return { flavor: buf.toString("latin1", 0, 4), tables };
}

/** WOFF 1.0: a table directory of zlib-deflated (or stored) sfnt tables. */
function decodeWoff(buf: Buffer): Font {
  expect(buf.toString("latin1", 0, 4)).toBe("wOFF");
  const tables = new Map<string, Table>();
  for (let i = 0; i < buf.readUInt16BE(12); i++) {
    const at = 44 + 20 * i;
    const [offset, compLength, origLength] = [4, 8, 12].map((d) => buf.readUInt32BE(at + d));
    const raw = buf.subarray(offset, offset + compLength);
    tables.set(buf.toString("latin1", at, at + 4), {
      data: compLength < origLength ? inflateSync(raw) : Buffer.from(raw),
      transformed: false,
    });
  }
  return { flavor: buf.toString("latin1", 4, 8), tables };
}

// WOFF2 §4.1: the tags a directory entry may name by index (63 = explicit).
const WOFF2_KNOWN_TAGS = (
  "cmap head hhea hmtx maxp name OS/2 post cvt_ fpgm glyf loca prep CFF_ VORG EBDT " +
  "EBLC gasp hdmx kern LTSH PCLT VDMX vhea vmtx BASE GDEF GPOS GSUB EBSC JSTF MATH " +
  "CBDT CBLC COLR CPAL SVG_ sbix acnt avar bdat bloc bsln cvar fdsc feat fmtx fvar " +
  "gvar hsty just lcar mort morx opbd prop trak Zapf Silf Glat Gloc Feat Sill"
)
  .split(" ")
  .map((tag) => tag.replace("_", " "));

/**
 * WOFF 2.0, single fonts only: the table directory, then one Brotli stream
 * holding every table back to back in directory order. A transformed table
 * (glyf/loca, or hmtx) comes back in its transformed form, flagged — the
 * tests below only read untransformed ones.
 */
function decodeWoff2(buf: Buffer): Font {
  expect(buf.toString("latin1", 0, 4)).toBe("wOF2");
  const flavor = buf.toString("latin1", 4, 8);
  expect(flavor).not.toBe("ttcf");
  let at = 48;
  const base128 = () => {
    let value = 0;
    for (let i = 0; i < 5; i++) {
      const byte = buf[at++];
      value = value * 128 + (byte & 0x7f);
      if (!(byte & 0x80)) return value;
    }
    throw new Error("UIntBase128 longer than 5 bytes");
  };
  const entries: { tag: string; length: number; transformed: boolean }[] = [];
  for (let i = 0; i < buf.readUInt16BE(12); i++) {
    const flags = buf[at++];
    let tag = WOFF2_KNOWN_TAGS[flags & 0x3f];
    if ((flags & 0x3f) === 63) {
      tag = buf.toString("latin1", at, at + 4);
      at += 4;
    }
    const version = flags >> 6;
    const origLength = base128();
    // glyf/loca: version 0 is their transform, 3 the null one; every other
    // table: version 0 is the null transform.
    const transformed = tag === "glyf" || tag === "loca" ? version !== 3 : version !== 0;
    entries.push({ tag, length: transformed ? base128() : origLength, transformed });
  }
  const stream = brotliDecompressSync(buf.subarray(at, at + buf.readUInt32BE(20)));
  const tables = new Map<string, Table>();
  let offset = 0;
  for (const { tag, length, transformed } of entries) {
    tables.set(tag, { data: stream.subarray(offset, offset + length), transformed });
    offset += length;
  }
  expect(offset).toBe(stream.length);
  return { flavor, tables };
}

const decode = (file: string) => {
  const buf = read(FONTS, file);
  return file.endsWith(".woff2") ? decodeWoff2(buf) : decodeWoff(buf);
};

/** Reassemble a plain sfnt (what a browser hands its rasteriser) for opentype.js. */
function toSfnt({ flavor, tables }: Font): Buffer {
  const tags = [...tables.keys()].sort();
  const header = Buffer.alloc(12 + 16 * tags.length);
  header.write(flavor, 0, "latin1");
  const log2 = Math.floor(Math.log2(tags.length));
  header.writeUInt16BE(tags.length, 4);
  header.writeUInt16BE(16 * 2 ** log2, 6);
  header.writeUInt16BE(log2, 8);
  header.writeUInt16BE(16 * tags.length - 16 * 2 ** log2, 10);
  const chunks: Buffer[] = [header];
  let offset = header.length;
  tags.forEach((tag, i) => {
    const { data, transformed } = tables.get(tag)!;
    expect(transformed, tag).toBe(false);
    header.write(tag, 12 + 16 * i, "latin1");
    header.writeUInt32BE(offset, 12 + 16 * i + 8);
    header.writeUInt32BE(data.length, 12 + 16 * i + 12);
    const padded = Buffer.alloc(Math.ceil(data.length / 4) * 4);
    data.copy(padded);
    chunks.push(padded);
    offset += padded.length;
  });
  return Buffer.concat(chunks);
}

/** Every cmap subtable's (platform, encoding, format, language). */
function cmapSubtables(cmap: Buffer) {
  return Array.from({ length: cmap.readUInt16BE(2) }, (_, i) => {
    const offset = cmap.readUInt32BE(4 + 8 * i + 4);
    const format = cmap.readUInt16BE(offset);
    // Formats 0/2/4/6 hold a 16-bit language at +4, 8/10/12/13 a 32-bit one
    // at +8; format 14 has none.
    const language =
      format === 14 ? 0 : format < 8 ? cmap.readUInt16BE(offset + 4) : cmap.readUInt32BE(offset + 8);
    return {
      platform: cmap.readUInt16BE(4 + 8 * i),
      encoding: cmap.readUInt16BE(4 + 8 * i + 2),
      format,
      language,
    };
  });
}

type ParsedFont = {
  numGlyphs: number;
  tables: { cmap: { glyphIndexMap: Record<string, number> } };
  glyphs: { get(index: number): { advanceWidth: number } };
};
const parse = (sfnt: Buffer): ParsedFont =>
  opentype.parse(sfnt.buffer.slice(sfnt.byteOffset, sfnt.byteOffset + sfnt.byteLength));

describe("MPlantin web font (TODO 3.27)", () => {
  it("mplantin.woff2 carries mplantin.woff's sfnt, table for table", () => {
    const woff = decode("mplantin.woff");
    const woff2 = decode("mplantin.woff2");
    expect(woff2.flavor).toBe("OTTO");
    expect(woff2.flavor).toBe(woff.flavor);
    expect([...woff2.tables.keys()].sort()).toEqual([...woff.tables.keys()].sort());
    for (const [tag, { data, transformed }] of woff2.tables) {
      expect(transformed, tag).toBe(false);
      const expected = Buffer.from(woff.tables.get(tag)!.data);
      const actual = Buffer.from(data);
      if (tag === "head") {
        // A WOFF2 encoder rewrites two 'head' fields that no renderer reads:
        // checkSumAdjustment (bytes 8–11, recomputed for the rebuilt sfnt)
        // and flags bit 11 ("losslessly transformed", bytes 16–17).
        for (const head of [expected, actual]) {
          head.writeUInt32BE(0, 8);
          head.writeUInt16BE(head.readUInt16BE(16) & ~0x0800, 16);
        }
      }
      expect(actual.equals(expected), `${tag} differs from the .woff`).toBe(true);
    }
  });

  it("every web font in public/fonts gives each cmap subtable language 0, as Chromium's OTS requires", () => {
    const webFonts = readdirSync(FONTS).filter((file) => /\.woff2?$/.test(file));
    expect(webFonts).toEqual(expect.arrayContaining(["mplantin.woff2", "mplantin.woff"]));
    for (const file of webFonts) {
      const cmap = decode(file).tables.get("cmap")!;
      expect(cmap.transformed).toBe(false);
      for (const subtable of cmapSubtables(cmap.data)) {
        expect(subtable.language, `${file} ${JSON.stringify(subtable)}`).toBe(0);
      }
    }
    // The bake's master itself fails that rule (its Windows subtable says
    // language 1), which is why the web font is never re-encoded from it.
    expect(cmapSubtables(decodeSfnt(read(FONTS, "mplantin.ttf")).tables.get("cmap")!.data)).toContainEqual({
      platform: 3,
      encoding: 1,
      format: 4,
      language: 1,
    });
  });

  it("maps every character to the bake master's glyph advance, so the editor wraps rules text like the bake", () => {
    const web = parse(toSfnt(decode("mplantin.woff2")));
    const master = parse(read(FONTS, "mplantin.ttf"));
    expect(web.numGlyphs).toBe(master.numGlyphs);
    const masterMap = master.tables.cmap.glyphIndexMap;
    const webMap = web.tables.cmap.glyphIndexMap;
    expect(Object.keys(webMap).sort()).toEqual(Object.keys(masterMap).sort());
    expect(Object.keys(masterMap).length).toBeGreaterThan(300);
    for (const [codepoint, glyph] of Object.entries(masterMap)) {
      expect(
        web.glyphs.get(webMap[codepoint]).advanceWidth,
        `U+${Number(codepoint).toString(16).toUpperCase().padStart(4, "0")}`,
      ).toBe(master.glyphs.get(glyph).advanceWidth);
    }
  });

  it("leaves the bake's master untouched: mplantin.ttf and .woff are mana-font's own files", () => {
    // lib/render/card-fonts.ts bakes with mana-font's mplantin.ttf; the
    // public copy is the PDF export's embed and the CSS's last fallback.
    expect(read(FONTS, "mplantin.ttf").equals(read(MANA_FONT, "mplantin.ttf"))).toBe(true);
    expect(read(FONTS, "mplantin.woff").equals(read(MANA_FONT, "mplantin.woff"))).toBe(true);
  });
});
