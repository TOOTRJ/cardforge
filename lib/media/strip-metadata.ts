// ---------------------------------------------------------------------------
// Camera metadata never leaves with an upload (TODO 3.14a).
//
// A phone photo carries EXIF — camera make/model, capture time, often GPS
// coordinates, a thumbnail of the uncropped shot — plus XMP, IPTC and vendor
// extras, and every upload is served from a PUBLIC storage URL. This module
// removes all of it at the CONTAINER level: segments, chunks and extension
// blocks are dropped and nothing is decoded or re-encoded, so the decoded
// pixels are byte-identical and a card baked from the stripped file comes
// out exactly as it did from the original.
//
// Kept, because it changes what a viewer or the bake draws:
//   * the ICC colour profile (JPEG APP2 ICC_PROFILE, PNG iCCP, WebP ICCP, GIF
//     ICCRGBG1012) and PNG's other colour/transparency chunks;
//   * an EXIF Orientation of 2–8, rewritten as a one-tag EXIF block (26 bytes
//     of TIFF) — from the file's FIRST EXIF block only, the one sharp and
//     Chrome read. lib/media/orientation.ts turns new uploads, but a file whose
//     upright re-encode would overflow its bucket, or a legacy file (the two
//     migration-0118 JPEGs), must keep saying how it is turned or the creator
//     would show it sideways;
//   * everything a decoder needs: JFIF (minus any thumbnail), Adobe APP14
//     (the colour transform of CMYK/YCCK JPEGs), frame/scan/table segments,
//     PNG critical + animation chunks, WebP VP8X/ALPH/ANIM/ANMF, GIF control,
//     plain-text and looping blocks;
//   * zero-filled padding (a JPEG COM or PNG pgPd of only 0x00 bytes) — it
//     carries nothing, and the owner-run backfill uses it to keep a file on the
//     same side of the bake's inline-size threshold (padImageToAtLeast);
//   * C2PA Content Credentials (JPEG APP11 JUMBF, PNG caBX, WebP C2PA) — the
//     provenance an AI generator or editor signs in, "trainedAlgorithmicMedia"
//     and all — but ONLY when they are the file's sole metadata and carry no
//     EXIF assertion (`stds.exif`, GPS): then nothing else changes, so the
//     file is left byte-for-byte and its credential stays valid. When anything
//     else has to go, the credential goes too — its hash covers the other
//     bytes, so it would no longer verify — and so does one that embeds EXIF
//     (an assertion, or a thumbnail that kept its own EXIF block).
// Dropped: EXIF (GPS, camera, dates, thumbnail, MakerNote), XMP (incl.
// extended), IPTC / Photoshop IRB, comments, PNG text/time chunks, MPF and
// everything after the image's end marker (secondary, depth and gain-map
// images, vendor trailers), C2PA as above, and any other segment, chunk or
// extension not on the keep lists — an unknown one may hold anything.
//
// A container this parser cannot walk (truncated, malformed) returns null:
// the upload path then re-encodes with sharp (lib/media/upload-bytes.ts),
// which writes no metadata; the backfill leaves it alone and says so.
//
// Dependency-free and erasable-syntax-only: scripts/strip-upload-metadata.mjs
// (the owner-run backfill) imports it through node's type stripping.
// ---------------------------------------------------------------------------

export type ImageContainer = "jpeg" | "png" | "webp" | "gif";

export type MetadataReport = {
  format: ImageContainer;
  /** What stripping removes, as stable labels (sorted) — never a value. Empty
   *  when the file is already clean. */
  found: string[];
  /** GPS coordinates somewhere in the file (EXIF GPS latitude/longitude, or
   *  an XMP GPS property). */
  gps: boolean;
  /** EXIF Orientation 2–8, which is KEPT (as a one-tag EXIF block). */
  orientation: number | null;
  /** An ICC colour profile is present — kept. */
  icc: boolean;
  /** C2PA Content Credentials present and KEPT (the file's only metadata,
   *  no EXIF assertion). When they have to go, "c2pa" is in `found`. */
  provenance: boolean;
};

export type StripResult = {
  /** The bytes to store: the input itself (same object) when nothing had to
   *  go, else a new buffer. */
  bytes: Uint8Array;
  report: MetadataReport;
};

// --- bytes -----------------------------------------------------------------

const u16be = (b: Uint8Array, o: number) => (b[o] << 8) | b[o + 1];
const u32be = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const u32le = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

function ascii(b: Uint8Array, start: number, length: number): string {
  let s = "";
  const end = Math.min(b.length, start + length);
  for (let i = start; i < end; i += 1) s += String.fromCharCode(b[i]);
  return s;
}

const startsWith = (b: Uint8Array, offset: number, text: string) => ascii(b, offset, text.length) === text;

function latin1(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i += 8192) {
    s += String.fromCharCode(...b.subarray(i, Math.min(b.length, i + 8192)));
  }
  return s;
}

function concat(parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

const allZero = (b: Uint8Array) => b.every((x) => x === 0);

/** A label fragment from file bytes: letters/digits only, bounded. */
function tagName(raw: string): string {
  const clean = raw.replace(/[^A-Za-z0-9]/g, "_").slice(0, 16);
  return clean || "_";
}

let crcTable: Uint32Array | null = null;
function crc32(parts: Uint8Array[]): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const part of parts) {
    for (let i = 0; i < part.length; i += 1) crc = crcTable[(crc ^ part[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const be32 = (n: number) => new Uint8Array([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
const le32 = (n: number) => new Uint8Array([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]);
const text = (s: string) => Uint8Array.from(s, (ch) => ch.charCodeAt(0));

// --- EXIF (TIFF) -------------------------------------------------------------

/** Tags that identify the camera, lens or its owner. */
const CAMERA_TAGS: ReadonlySet<number> = new Set([
  0x010f, // Make
  0x0110, // Model
  0x927c, // MakerNote
  0xa431, // BodySerialNumber
  0xa432, // LensSpecification
  0xa433, // LensMake
  0xa434, // LensModel
  0xa435, // LensSerialNumber
]);
const AUTHOR_TAGS: ReadonlySet<number> = new Set([
  0x013b, // Artist
  0x8298, // Copyright
  0x9c9d, // XPAuthor
  0xa430, // CameraOwnerName
]);
const DATETIME_TAGS: ReadonlySet<number> = new Set([
  0x0132, // DateTime
  0x9003, // DateTimeOriginal
  0x9004, // DateTimeDigitized
  0x9010, // OffsetTime
  0x9011, // OffsetTimeOriginal
  0x9012, // OffsetTimeDigitized
]);
const TAG_ORIENTATION = 0x0112;
const TAG_EXIF_IFD = 0x8769;
const TAG_GPS_IFD = 0x8825;

/** What an EXIF block (raw TIFF: byte order, 42, IFD0 offset…) says. */
type TiffInfo = { orientation: number | null; labels: string[]; gps: boolean };

function readTiff(t: Uint8Array): TiffInfo {
  const info: TiffInfo = { orientation: null, labels: [], gps: false };
  if (t.length < 8) return info;
  const le = t[0] === 0x49 && t[1] === 0x49;
  if (!le && !(t[0] === 0x4d && t[1] === 0x4d)) return info;
  const r16 = (o: number) => (le ? t[o] | (t[o + 1] << 8) : (t[o] << 8) | t[o + 1]);
  const r32 = (o: number) => (le ? u32le(t, o) : u32be(t, o));
  if (r16(2) !== 42) return info;

  type Entry = { tag: number; type: number; at: number };
  const readIfd = (offset: number): { entries: Entry[]; next: number } | null => {
    if (offset < 8 || offset + 2 > t.length) return null;
    const count = r16(offset);
    const entries: Entry[] = [];
    for (let i = 0; i < count; i += 1) {
      const at = offset + 2 + i * 12;
      if (at + 12 > t.length) break;
      entries.push({ tag: r16(at), type: r16(at + 2), at });
    }
    const nextAt = offset + 2 + count * 12;
    return { entries, next: nextAt + 4 <= t.length ? r32(nextAt) : 0 };
  };
  const labels = new Set<string>();
  const classify = (entries: Entry[]) => {
    for (const e of entries) {
      if (CAMERA_TAGS.has(e.tag)) labels.add("exif:camera");
      else if (AUTHOR_TAGS.has(e.tag)) labels.add("exif:author");
      else if (DATETIME_TAGS.has(e.tag)) labels.add("exif:datetime");
    }
  };

  const ifd0 = readIfd(r32(4));
  if (!ifd0) return info;
  classify(ifd0.entries);
  for (const e of ifd0.entries) {
    if (e.tag === TAG_ORIENTATION) {
      const value = e.type === 3 ? r16(e.at + 8) : e.type === 4 ? r32(e.at + 8) : 0;
      if (value >= 2 && value <= 8) info.orientation = value;
    } else if (e.tag === TAG_EXIF_IFD && (e.type === 4 || e.type === 13)) {
      const sub = readIfd(r32(e.at + 8));
      if (sub) classify(sub.entries);
    } else if (e.tag === TAG_GPS_IFD && (e.type === 4 || e.type === 13)) {
      const gps = readIfd(r32(e.at + 8));
      if (gps && gps.entries.length > 0) {
        labels.add("exif:gps");
        // 2 = GPSLatitude, 4 = GPSLongitude.
        if (gps.entries.some((g) => g.tag === 2 || g.tag === 4)) info.gps = true;
      }
    }
  }
  if (ifd0.next !== 0) labels.add("exif:thumbnail");
  info.labels = [...labels];
  return info;
}

/** The one-tag EXIF block kept for a turned file: IFD0 = { Orientation }. */
export function orientationOnlyTiff(orientation: number, littleEndian = false): Uint8Array {
  const t = new Uint8Array(26);
  const w16 = (o: number, v: number) => {
    if (littleEndian) [t[o], t[o + 1]] = [v & 0xff, v >>> 8];
    else [t[o], t[o + 1]] = [v >>> 8, v & 0xff];
  };
  t.set(littleEndian ? [0x49, 0x49] : [0x4d, 0x4d], 0);
  w16(2, 42);
  if (littleEndian) t.set([8, 0, 0, 0], 4);
  else t.set([0, 0, 0, 8], 4);
  w16(8, 1); // one entry
  w16(10, TAG_ORIENTATION);
  w16(12, 3); // SHORT
  if (littleEndian) t.set([1, 0, 0, 0], 14);
  else t.set([0, 0, 0, 1], 14);
  w16(18, orientation);
  // 20–21 value padding, 22–25 next IFD = 0.
  return t;
}

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

/** True for an EXIF block that is exactly the one-tag Orientation 2–8 form
 *  (either byte order) — what stripping keeps, so it stays untouched. */
export function isOrientationOnlyTiff(t: Uint8Array): boolean {
  const o = readTiff(t).orientation;
  return o !== null && (sameBytes(t, orientationOnlyTiff(o, false)) || sameBytes(t, orientationOnlyTiff(o, true)));
}

/** sharp reports EXIF with the JPEG "Exif\0\0" prefix; containers store it
 *  with or without. */
export function tiffOf(exif: Uint8Array): Uint8Array {
  return startsWith(exif, 0, "Exif\0") ? exif.subarray(6) : exif;
}

type Collector = {
  found: Set<string>;
  gps: boolean;
  orientation: number | null;
  icc: boolean;
  /** An EXIF block was already seen — readers only take the first. */
  exifSeen: boolean;
  /** C2PA manifests seen (always left out of the rebuilt file). */
  c2pa: { present: boolean; exif: boolean };
};

const newCollector = (): Collector => ({
  found: new Set(),
  gps: false,
  orientation: null,
  icc: false,
  exifSeen: false,
  c2pa: { present: false, exif: false },
});

/** An EXIF block: note what it carries; return the TIFF to keep in its place
 *  (the one-tag Orientation form) or null to drop it. `unchanged` = keep the
 *  original bytes, it already is that form.
 *
 *  Only the FIRST EXIF block of a file can keep anything: sharp (so the
 *  bake) and Chrome read the first one and ignore the rest, so a second
 *  block's Orientation never turned the picture — kept, it would start to. */
function handleExif(
  tiff: Uint8Array,
  c: Collector,
): { keep: Uint8Array | null; unchanged: boolean; orientation: number | null } {
  const info = readTiff(tiff);
  const first = !c.exifSeen;
  c.exifSeen = true;
  const orientation = first ? info.orientation : null;
  if (orientation !== null && isOrientationOnlyTiff(tiff)) return { keep: tiff, unchanged: true, orientation };
  c.found.add("exif");
  for (const label of info.labels) c.found.add(label);
  if (info.gps) c.gps = true;
  return { keep: orientation !== null ? orientationOnlyTiff(orientation) : null, unchanged: false, orientation };
}

const XMP_GPS = /GPS(Latitude|Longitude)/;

/** Binary EXIF inside a manifest — a JPEG thumbnail's APP1 ("Exif\0\0" +
 *  a TIFF header) or a PNG thumbnail's eXIf chunk — where a text search for
 *  GPS property names cannot see the coordinates. */
const EMBEDDED_BINARY_EXIF = /Exif\0\0(?:MM\0\x2a|II\x2a\0)|eXIf/;

/** A C2PA manifest store: note it, and whether it embeds EXIF (the
 *  `stds.exif` assertion, which may hold GPS coordinates, or a thumbnail
 *  that still carries its own EXIF). */
function noteC2pa(payload: Uint8Array, c: Collector) {
  c.c2pa.present = true;
  const body = latin1(payload);
  if (/stds\.exif/.test(body) || XMP_GPS.test(body) || EMBEDDED_BINARY_EXIF.test(body)) {
    c.c2pa.exif = true;
    if (XMP_GPS.test(body)) c.gps = true;
  }
}

function noteXmp(payload: Uint8Array, c: Collector) {
  c.found.add("xmp");
  if (XMP_GPS.test(latin1(payload))) {
    c.found.add("xmp:gps");
    c.gps = true;
  }
}

// --- JPEG ---------------------------------------------------------------------

const JFIF = "JFIF\0";
const EXIF_ID = "Exif\0";
const XMP_ID = "http://ns.adobe.com/xap/1.0/\0";
const XMP_EXT_ID = "http://ns.adobe.com/xmp/extension/\0";

function jpegSegment(code: number, payload: Uint8Array): Uint8Array {
  const len = payload.length + 2;
  return concat([new Uint8Array([0xff, code, len >>> 8, len & 0xff]), payload]);
}

/** An APPn/COM segment's fate: the bytes to write (the original, or a
 *  replacement), or null to drop it. */
function jpegApp(code: number, payload: Uint8Array, whole: Uint8Array, c: Collector): Uint8Array | null {
  switch (code) {
    case 0xe0: {
      if (startsWith(payload, 0, JFIF) && payload.length >= 14) {
        // JFIF may embed an uncompressed thumbnail after its 14-byte header.
        if (payload.length === 14 && payload[12] === 0 && payload[13] === 0) return whole;
        c.found.add("thumbnail");
        const header = payload.slice(0, 14);
        header[12] = 0;
        header[13] = 0;
        return jpegSegment(code, header);
      }
      c.found.add(startsWith(payload, 0, "JFXX\0") ? "thumbnail" : "jpeg:app0");
      return null;
    }
    case 0xe1: {
      if (startsWith(payload, 0, EXIF_ID)) {
        const { keep, unchanged, orientation } = handleExif(payload.subarray(6), c);
        if (keep) c.orientation ??= orientation;
        if (unchanged) return whole;
        return keep ? jpegSegment(code, concat([text("Exif\0\0"), keep])) : null;
      }
      if (startsWith(payload, 0, XMP_ID) || startsWith(payload, 0, XMP_EXT_ID)) noteXmp(payload, c);
      else c.found.add("jpeg:app1");
      return null;
    }
    case 0xe2:
      if (startsWith(payload, 0, "ICC_PROFILE\0")) {
        c.icc = true;
        return whole;
      }
      c.found.add(startsWith(payload, 0, "MPF\0") ? "mpf" : "jpeg:app2");
      return null;
    case 0xeb:
      // JPEG XT / JUMBF boxes — how C2PA content credentials ride in a JPEG.
      if (startsWith(payload, 0, "JP")) noteC2pa(payload, c);
      else c.found.add("jpeg:app11");
      return null;
    case 0xed:
      c.found.add(startsWith(payload, 0, "Photoshop 3.0\0") ? "iptc" : "jpeg:app13");
      return null;
    case 0xee:
      // Adobe: the colour transform of a CMYK/YCCK JPEG — decoding needs it.
      if (startsWith(payload, 0, "Adobe")) return whole;
      c.found.add("jpeg:app14");
      return null;
    case 0xfe:
      if (allZero(payload)) return whole;
      c.found.add("comment");
      return null;
    default:
      c.found.add(`jpeg:app${code - 0xe0}`);
      return null;
  }
}

/** Walk a JPEG's markers (fill bytes and progressive scans included). Parts
 *  to write, or null when the file can't be walked to its EOI. `onSos` sees
 *  the offset of each SOS marker in the OUTPUT (for padding). */
function walkJpeg(b: Uint8Array, c: Collector, onSos?: (outOffset: number) => void): Uint8Array[] | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  const out: Uint8Array[] = [b.subarray(0, 2)];
  let outLength = 2;
  const push = (part: Uint8Array) => {
    out.push(part);
    outLength += part.length;
  };
  let p = 2;
  for (;;) {
    if (p >= b.length || b[p] !== 0xff) return null;
    let q = p;
    while (q < b.length && b[q] === 0xff) q += 1;
    if (q >= b.length) return null;
    const code = b[q];
    const start = p;
    p = q + 1;
    if (code === 0xd9) {
      push(b.subarray(start, p));
      if (p < b.length) c.found.add("trailer");
      return out;
    }
    if (code === 0x01 || (code >= 0xd0 && code <= 0xd7)) {
      push(b.subarray(start, p));
      continue;
    }
    if (code === 0x00 || code === 0xd8 || p + 2 > b.length) return null;
    const len = u16be(b, p);
    const end = p + len;
    if (len < 2 || end > b.length) return null;
    const whole = b.subarray(start, end);
    if (code === 0xda) {
      onSos?.(outLength);
      // The scan's entropy-coded data runs to the next marker that is not a
      // stuffed 0xFF00 or a restart marker.
      let e = end;
      for (;;) {
        e = b.indexOf(0xff, e);
        if (e < 0) return null;
        let f = e + 1;
        while (f < b.length && b[f] === 0xff) f += 1;
        if (f >= b.length) return null;
        if (b[f] === 0x00 || (b[f] >= 0xd0 && b[f] <= 0xd7)) {
          e = f + 1;
          continue;
        }
        break;
      }
      push(b.subarray(start, e));
      p = e;
      continue;
    }
    p = end;
    if ((code >= 0xe0 && code <= 0xef) || code === 0xfe) {
      const kept = jpegApp(code, b.subarray(q + 3, end), whole, c);
      if (kept) push(kept);
      continue;
    }
    push(whole);
  }
}

// --- PNG ----------------------------------------------------------------------

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** Ancillary chunks that change how the image is drawn (colour, transparency,
 *  density, animation) — kept. Every other ancillary chunk is dropped. */
const PNG_KEEP: ReadonlySet<string> = new Set([
  "tRNS", "gAMA", "cHRM", "sRGB", "iCCP", "cICP", "mDCv", "cLLi", "sBIT",
  "bKGD", "pHYs", "hIST", "sPLT", "acTL", "fcTL", "fdAT",
]);
/** Zero-filled padding chunk (ancillary, private, safe-to-copy). */
export const PNG_PAD_CHUNK = "pgPd";

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = text(type);
  return concat([be32(data.length), typeBytes, data, be32(crc32([typeBytes, data]))]);
}

function pngTextLabel(type: string, data: Uint8Array, c: Collector) {
  const nul = data.indexOf(0);
  const keyword = ascii(data, 0, nul < 0 ? Math.min(data.length, 79) : nul);
  if (keyword === "XML:com.adobe.xmp" || keyword === "Raw profile type xmp") {
    noteXmp(data, c);
    return;
  }
  if (/^Raw profile type (exif|APP1)$/i.test(keyword)) c.found.add("exif");
  else if (/^Raw profile type (iptc|8bim)$/i.test(keyword)) c.found.add("iptc");
  else c.found.add("png:text");
  // tEXt / uncompressed iTXt: a GPS property written as plain text.
  if (type !== "zTXt" && XMP_GPS.test(latin1(data))) c.gps = true;
}

function walkPng(b: Uint8Array, c: Collector): Uint8Array[] | null {
  if (b.length < 8 || PNG_SIGNATURE.some((x, i) => b[i] !== x)) return null;
  const out: Uint8Array[] = [b.subarray(0, 8)];
  let p = 8;
  while (p + 12 <= b.length) {
    const len = u32be(b, p);
    const type = ascii(b, p + 4, 4);
    const end = p + 12 + len;
    if (!/^[A-Za-z]{4}$/.test(type) || end > b.length) return null;
    const chunk = b.subarray(p, end);
    const data = b.subarray(p + 8, p + 8 + len);
    p = end;
    if (type === "IEND") {
      out.push(chunk);
      if (p < b.length) c.found.add("trailer");
      return out;
    }
    // Critical chunks (upper-case first letter) are the image.
    if (type[0] >= "A" && type[0] <= "Z") {
      out.push(chunk);
      continue;
    }
    if (PNG_KEEP.has(type)) {
      if (type === "iCCP") c.icc = true;
      out.push(chunk);
      continue;
    }
    if (type === PNG_PAD_CHUNK && allZero(data)) {
      out.push(chunk);
      continue;
    }
    if (type === "eXIf") {
      const { keep, unchanged, orientation } = handleExif(tiffOf(data), c);
      if (keep) c.orientation ??= orientation;
      if (unchanged) out.push(chunk);
      else if (keep) out.push(pngChunk("eXIf", keep));
      continue;
    }
    if (type === "tEXt" || type === "zTXt" || type === "iTXt") pngTextLabel(type, data, c);
    else if (type === "tIME") c.found.add("png:time");
    else if (type === "caBX") noteC2pa(data, c);
    else c.found.add(`png:chunk:${tagName(type)}`);
  }
  return null; // no IEND
}

// --- WebP ---------------------------------------------------------------------

const WEBP_KEEP: ReadonlySet<string> = new Set(["VP8X", "ICCP", "ANIM", "ANMF", "ALPH", "VP8 ", "VP8L"]);
const VP8X_EXIF = 0x08;
const VP8X_XMP = 0x04;

function riffChunk(fourcc: string, data: Uint8Array): Uint8Array {
  const parts = [text(fourcc), le32(data.length), data];
  if (data.length & 1) parts.push(new Uint8Array(1));
  return concat(parts);
}

function walkWebp(b: Uint8Array, c: Collector): Uint8Array[] | null {
  if (b.length < 12 || !startsWith(b, 0, "RIFF") || !startsWith(b, 8, "WEBP")) return null;
  const riffEnd = 8 + u32le(b, 4);
  if (riffEnd < 12 || riffEnd > b.length) return null;
  const chunks: { fourcc: string; data: Uint8Array }[] = [];
  let exifKept = false;
  let p = 12;
  while (p < riffEnd) {
    if (p + 8 > riffEnd) return null;
    const fourcc = ascii(b, p, 4);
    const size = u32le(b, p + 4);
    const dataEnd = p + 8 + size;
    if (dataEnd > riffEnd) return null;
    const data = b.subarray(p + 8, dataEnd);
    p = dataEnd + (size & 1);
    if (WEBP_KEEP.has(fourcc)) {
      if (fourcc === "ICCP") c.icc = true;
      chunks.push({ fourcc, data });
    } else if (fourcc === "EXIF") {
      const { keep, orientation } = handleExif(tiffOf(data), c);
      // Only an extended (VP8X) file may carry EXIF at all.
      if (keep && chunks.some((k) => k.fourcc === "VP8X")) {
        chunks.push({ fourcc, data: keep });
        c.orientation ??= orientation;
        exifKept = true;
      }
    } else if (fourcc === "XMP ") {
      noteXmp(data, c);
    } else {
      if (fourcc === "C2PA") noteC2pa(data, c);
      else c.found.add(`webp:chunk:${tagName(fourcc)}`);
    }
  }
  if (riffEnd < b.length) c.found.add("trailer");
  const vp8x = chunks.find((k) => k.fourcc === "VP8X");
  if (vp8x && vp8x.data.length > 0) {
    const flags = vp8x.data[0];
    const wanted = (flags & ~(VP8X_EXIF | VP8X_XMP)) | (exifKept ? VP8X_EXIF : 0);
    if (wanted !== flags) {
      vp8x.data = vp8x.data.slice();
      vp8x.data[0] = wanted;
    }
  }
  const body = chunks.map((k) => riffChunk(k.fourcc, k.data));
  const size = 4 + body.reduce((n, part) => n + part.length, 0);
  return [text("RIFF"), le32(size), text("WEBP"), ...body];
}

// --- GIF ----------------------------------------------------------------------

/** Application extensions that change playback or colour — kept. */
const GIF_APP_KEEP: ReadonlySet<string> = new Set(["NETSCAPE2.0", "ANIMEXTS1.0", "ICCRGBG1012"]);

function walkGif(b: Uint8Array, c: Collector): Uint8Array[] | null {
  if (b.length < 13 || !(startsWith(b, 0, "GIF87a") || startsWith(b, 0, "GIF89a"))) return null;
  const tableSize = (packed: number) => (packed & 0x80 ? 3 * (1 << ((packed & 7) + 1)) : 0);
  let p = 13 + tableSize(b[10]);
  if (p > b.length) return null;
  const out: Uint8Array[] = [b.subarray(0, p)];
  /** End of a run of data sub-blocks starting at q, or -1. */
  const subBlocksEnd = (q: number) => {
    for (;;) {
      if (q >= b.length) return -1;
      const n = b[q];
      q += 1 + n;
      if (n === 0) return q;
    }
  };
  while (p < b.length) {
    const id = b[p];
    if (id === 0x3b) {
      out.push(b.subarray(p, p + 1));
      if (p + 1 < b.length) c.found.add("trailer");
      return out;
    }
    if (id === 0x2c) {
      if (p + 10 > b.length) return null;
      const end = subBlocksEnd(p + 10 + tableSize(b[p + 9]) + 1);
      if (end < 0) return null;
      out.push(b.subarray(p, end));
      p = end;
      continue;
    }
    if (id !== 0x21 || p + 2 > b.length) return null;
    const label = b[p + 1];
    const end = subBlocksEnd(p + 2);
    if (end < 0) return null;
    const block = b.subarray(p, end);
    p = end;
    if (label === 0xf9 || label === 0x01) {
      out.push(block); // graphic control, plain text (drawn)
    } else if (label === 0xfe) {
      c.found.add("comment");
    } else if (label === 0xff) {
      const appId = ascii(block, 3, Math.min(block[2] ?? 0, 11));
      if (GIF_APP_KEEP.has(appId)) {
        if (appId === "ICCRGBG1012") c.icc = true;
        out.push(block);
      } else if (appId === "XMP DataXMP") {
        noteXmp(block, c);
      } else {
        c.found.add(`gif:app:${tagName(appId)}`);
      }
    } else {
      c.found.add(`gif:ext:${label.toString(16)}`);
    }
  }
  return null; // no trailer
}

// --- public API ------------------------------------------------------------------

/** The container, from its magic bytes (not the declared type). */
export function detectContainer(b: Uint8Array): ImageContainer | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b.length >= 8 && PNG_SIGNATURE.every((x, i) => b[i] === x)) return "png";
  if (b.length >= 12 && startsWith(b, 0, "RIFF") && startsWith(b, 8, "WEBP")) return "webp";
  if (b.length >= 6 && (startsWith(b, 0, "GIF87a") || startsWith(b, 0, "GIF89a"))) return "gif";
  return null;
}

/**
 * Remove camera metadata from a JPEG, PNG, WebP or GIF without re-encoding
 * (see the header for what is kept). Returns the input itself when there was
 * nothing to remove, and null for anything else — an unknown format, or a
 * container this parser cannot walk.
 */
export function stripImageMetadata(input: Uint8Array): StripResult | null {
  const format = detectContainer(input);
  if (!format) return null;
  const c = newCollector();
  const parts =
    format === "jpeg" ? walkJpeg(input, c)
    : format === "png" ? walkPng(input, c)
    : format === "webp" ? walkWebp(input, c)
    : walkGif(input, c);
  if (!parts) return null;
  // Content Credentials stay only when they are all there is (see header).
  const keepProvenance = c.c2pa.present && !c.c2pa.exif && c.found.size === 0;
  if (c.c2pa.present && !keepProvenance) {
    c.found.add("c2pa");
    if (c.c2pa.exif) c.found.add("c2pa:exif");
  }
  const report: MetadataReport = {
    format,
    found: [...c.found].sort(),
    gps: c.gps,
    orientation: c.orientation,
    icc: c.icc,
    provenance: keepProvenance,
  };
  return { bytes: report.found.length === 0 ? input : concat(parts), report };
}

/** What stripImageMetadata would remove, without building the output. */
export function inspectImageMetadata(input: Uint8Array): MetadataReport | null {
  return stripImageMetadata(input)?.report ?? null;
}

/**
 * Grow a JPEG or PNG to at least `minBytes` with zero-filled padding (JPEG
 * COM segments before the first scan, one PNG `pgPd` chunk before IEND).
 * Only the owner-run backfill uses it: the bake inlines a JPEG/PNG of at most
 * 3 MB as-is and re-encodes a bigger one (lib/render/art-source.ts
 * MAX_INLINE_BYTES), so a file stripped from just above the threshold to
 * just below it would bake differently; padded, it stays above. The padding
 * carries no information and stripping keeps it (idempotent). Returns the
 * input when it is already big enough, null for another format.
 */
export function padImageToAtLeast(input: Uint8Array, minBytes: number): Uint8Array | null {
  const format = detectContainer(input);
  if (format !== "jpeg" && format !== "png") return null;
  const need = minBytes - input.length;
  if (need <= 0) return input;
  if (format === "png") {
    // A stripped PNG ends with its IEND; 12 bytes of chunk framing go around
    // the zeros.
    const report = stripImageMetadata(input)?.report;
    if (!report || report.found.length > 0 || report.provenance) return null;
    const iend = input.length - 12;
    if (iend < 8 || ascii(input, iend + 4, 4) !== "IEND") return null;
    const pad = pngChunk(PNG_PAD_CHUNK, new Uint8Array(Math.max(0, need - 12)));
    return concat([input.subarray(0, iend), pad, input.subarray(iend)]);
  }
  let sosAt = -1;
  const c = newCollector();
  const parts = walkJpeg(input, c, (at) => {
    if (sosAt < 0) sosAt = at;
  });
  // Pad only a stripped file: then the walk changed nothing and the SOS
  // offset it saw is the input's own.
  if (!parts || sosAt < 0 || c.found.size > 0 || c.c2pa.present) return null;
  const segments: Uint8Array[] = [];
  let remaining = need;
  while (remaining > 0) {
    const payload = Math.min(65533, Math.max(0, remaining - 4));
    segments.push(jpegSegment(0xfe, new Uint8Array(payload)));
    remaining -= payload + 4;
  }
  return concat([input.subarray(0, sosAt), ...segments, input.subarray(sosAt)]);
}
