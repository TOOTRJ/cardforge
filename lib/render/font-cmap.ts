// ---------------------------------------------------------------------------
// Minimal sfnt (TrueType/OpenType) cmap surgery for the bake's fallback font
// (lib/render/fallback-assets.ts): read which glyph a font gives each code
// point, and copy the font with a cmap that maps ONLY the code points you
// choose. Glyph data, ids and metrics are untouched — a request-shaped font
// behaves like the per-request subset Google Fonts used to serve.
//
// Pure byte work, no dependencies; reads cmap formats 4 and 12 and writes
// format 12 (both are what opentype.js — Satori's parser — supports).
// ---------------------------------------------------------------------------

type TableRecord = { tag: string; checksum: number; offset: number; length: number };

const u16 = (b: Uint8Array, o: number) => (b[o] << 8) | b[o + 1];
const i16 = (b: Uint8Array, o: number) => {
  const v = u16(b, o);
  return v & 0x8000 ? v - 0x10000 : v;
};
const u32 = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;

function tableRecords(font: Uint8Array): TableRecord[] {
  const count = u16(font, 4);
  const records: TableRecord[] = [];
  for (let i = 0; i < count; i += 1) {
    const at = 12 + i * 16;
    records.push({
      tag: String.fromCharCode(font[at], font[at + 1], font[at + 2], font[at + 3]),
      checksum: u32(font, at + 4),
      offset: u32(font, at + 8),
      length: u32(font, at + 12),
    });
  }
  return records;
}

/** The font's code point → glyph id map (the Unicode subtable a renderer
 *  would pick: format 12 when present, else format 4). Glyph 0 is left out. */
export function readCmap(font: Uint8Array): Map<number, number> {
  const cmap = tableRecords(font).find((t) => t.tag === "cmap");
  if (!cmap) throw new Error("font has no cmap table");
  const base = cmap.offset;
  const subtables = u16(font, base + 2);
  let best: { offset: number; format: number } | null = null;
  for (let i = 0; i < subtables; i += 1) {
    const platform = u16(font, base + 4 + i * 8);
    const encoding = u16(font, base + 4 + i * 8 + 2);
    const offset = base + u32(font, base + 4 + i * 8 + 4);
    const unicode = (platform === 3 && (encoding === 1 || encoding === 10)) || platform === 0;
    if (!unicode) continue;
    const format = u16(font, offset);
    if ((format === 12 && best?.format !== 12) || (format === 4 && !best)) best = { offset, format };
  }
  if (!best) throw new Error("font has no Unicode cmap subtable (format 4 or 12)");
  const map = new Map<number, number>();
  const at = best.offset;
  if (best.format === 12) {
    const groups = u32(font, at + 12);
    for (let g = 0; g < groups; g += 1) {
      const start = u32(font, at + 16 + g * 12);
      const end = u32(font, at + 20 + g * 12);
      const gid = u32(font, at + 24 + g * 12);
      for (let cp = start; cp <= end; cp += 1) if (gid + (cp - start)) map.set(cp, gid + (cp - start));
    }
    return map;
  }
  const segX2 = u16(font, at + 6);
  const ends = at + 14;
  const starts = ends + segX2 + 2;
  const deltas = starts + segX2;
  const rangeOffsets = deltas + segX2;
  for (let s = 0; s < segX2; s += 2) {
    const end = u16(font, ends + s);
    const start = u16(font, starts + s);
    const delta = i16(font, deltas + s);
    const rangeOffset = u16(font, rangeOffsets + s);
    for (let cp = start; cp <= end && cp !== 0xffff; cp += 1) {
      let gid: number;
      if (rangeOffset === 0) {
        gid = (cp + delta) & 0xffff;
      } else {
        const raw = u16(font, rangeOffsets + s + rangeOffset + (cp - start) * 2);
        gid = raw === 0 ? 0 : (raw + delta) & 0xffff;
      }
      if (gid) map.set(cp, gid);
    }
  }
  return map;
}

/** A cmap table holding one (3,10) format-12 subtable for `entries`. */
function cmapTable(entries: ReadonlyArray<readonly [number, number]>): Uint8Array {
  const sorted = [...entries].sort((a, b) => a[0] - b[0]);
  const groups: Array<[number, number, number]> = [];
  for (const [cp, gid] of sorted) {
    const last = groups[groups.length - 1];
    if (last && cp === last[1] + 1 && gid === last[2] + (cp - last[0])) last[1] = cp;
    else groups.push([cp, cp, gid]);
  }
  const subLength = 16 + groups.length * 12;
  const out = new Uint8Array(12 + subLength);
  const view = new DataView(out.buffer);
  view.setUint16(0, 0); // version
  view.setUint16(2, 1); // one encoding record
  view.setUint16(4, 3); // platform: Windows
  view.setUint16(6, 10); // encoding: Unicode full repertoire
  view.setUint32(8, 12); // subtable offset
  view.setUint16(12, 12); // format 12
  view.setUint16(14, 0);
  view.setUint32(16, subLength);
  view.setUint32(20, 0); // language
  view.setUint32(24, groups.length);
  groups.forEach(([start, end, gid], i) => {
    view.setUint32(28 + i * 12, start);
    view.setUint32(32 + i * 12, end);
    view.setUint32(36 + i * 12, gid);
  });
  return out;
}

function checksum(bytes: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < bytes.length; i += 4) {
    const word = ((bytes[i] ?? 0) << 24) | ((bytes[i + 1] ?? 0) << 16) | ((bytes[i + 2] ?? 0) << 8) | (bytes[i + 3] ?? 0);
    sum = (sum + (word >>> 0)) >>> 0;
  }
  return sum;
}

/**
 * A copy of `font` whose cmap maps exactly `entries` ([code point, glyph id]
 * pairs — normally a slice of {@link readCmap}). Every other table is copied
 * byte for byte, so outlines, advances, glyph ids and vertical metrics stay
 * what they were.
 */
export function withCmap(font: Uint8Array, entries: ReadonlyArray<readonly [number, number]>): Buffer {
  const records = tableRecords(font).sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
  const bodies = records.map((r) =>
    r.tag === "cmap" ? cmapTable(entries) : font.subarray(r.offset, r.offset + r.length),
  );
  const headerLength = 12 + records.length * 16;
  let size = headerLength;
  for (const body of bodies) size += (body.length + 3) & ~3;
  const out = Buffer.alloc(size);
  out.set(font.subarray(0, 12), 0); // sfnt version + search fields (table count unchanged)
  let offset = headerLength;
  let headOffset = -1;
  records.forEach((r, i) => {
    const body = bodies[i];
    const at = 12 + i * 16;
    out.write(r.tag, at, "latin1");
    out.writeUInt32BE(r.tag === "head" ? checksumHead(body) : checksum(body), at + 4);
    out.writeUInt32BE(offset, at + 8);
    out.writeUInt32BE(body.length, at + 12);
    out.set(body, offset);
    if (r.tag === "head") headOffset = offset;
    offset += (body.length + 3) & ~3;
  });
  if (headOffset >= 0) {
    // checkSumAdjustment: 0xB1B0AFBA minus the whole font's checksum taken
    // with the field zeroed.
    out.writeUInt32BE(0, headOffset + 8);
    out.writeUInt32BE((0xb1b0afba - checksum(out)) >>> 0, headOffset + 8);
  }
  return out;
}

/** The head table's checksum is taken with checkSumAdjustment zeroed. */
function checksumHead(head: Uint8Array): number {
  const copy = new Uint8Array(head);
  copy.fill(0, 8, 12);
  return checksum(copy);
}
