import { crc32 } from "node:zlib";
import sharp from "sharp";
import { expect } from "vitest";
import { inspectImageMetadata, isOrientationOnlyTiff, tiffOf } from "@/lib/media/strip-metadata";

// ---------------------------------------------------------------------------
// Camera-metadata fixtures (TODO 3.14a), generated in-test — no binary files
// and no real photo: the GPS position, camera and owner below are made up.
//
// `cameraPhoto()` is what a phone hands the upload form: EXIF with the
// camera, capture time and a GPS IFD (latitude AND longitude), an XMP packet
// that repeats the position, an ICC profile (Display P3, like an iPhone) and
// optionally an Orientation tag. The container-level extras phones, editors
// and C2PA signers add (JFIF/JFXX thumbnails, IPTC, MPF + a trailing
// secondary image, C2PA, PNG text/time chunks, a GIF comment…) are spliced
// in with the helpers below, byte for byte.
// ---------------------------------------------------------------------------

export const FAKE_CAMERA_MAKE = "PipGlyphTestCam";
export const FAKE_OWNER = "Test Owner Name";
/** A position nobody lives at (the Gulf of Guinea, "Null Island"-adjacent). */
export const FAKE_GPS = {
  GPSLatitudeRef: "N",
  GPSLatitude: "0/1 12/1 34/1",
  GPSLongitudeRef: "E",
  GPSLongitude: "0/1 56/1 7/1",
};
export const FAKE_XMP =
  '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
  '<rdf:Description xmlns:exif="http://ns.adobe.com/exif/1.0/" exif:GPSLatitude="0,12.57N" exif:GPSLongitude="0,56.12E"/>' +
  "</rdf:RDF></x:xmpmeta>";

export const PHOTO_W = 96;
export const PHOTO_H = 64;

/** A busy RGB picture (gradients + a checker), so a lossy decode has real
 *  work to do and a changed pixel would show. */
export function photoPixels(width = PHOTO_W, height = PHOTO_H, channels: 3 | 4 = 3): Buffer {
  const data = Buffer.alloc(width * height * channels);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * channels;
      const checker = ((x >> 3) + (y >> 3)) & 1 ? 40 : 0;
      data[i] = (x * 255) / width;
      data[i + 1] = (y * 255) / height;
      data[i + 2] = (((x + y) * 3) & 0xff) ^ checker;
      if (channels === 4) data[i + 3] = 128 + ((x * 127) / width);
    }
  }
  return data;
}

export type PhotoFormat = "jpeg" | "png" | "webp";

export async function cameraPhoto(
  format: PhotoFormat,
  opts: { orientation?: number; alpha?: boolean; progressive?: boolean; cmyk?: boolean } = {},
): Promise<Buffer> {
  const channels = opts.alpha ? 4 : 3;
  let img = sharp(photoPixels(PHOTO_W, PHOTO_H, channels), { raw: { width: PHOTO_W, height: PHOTO_H, channels } });
  // A CMYK JPEG (print-shop export) carries no ICC here: sharp's bundled CMYK
  // profile is ~1 MB. Its colours hang on the Adobe APP14 marker instead.
  img = opts.cmyk ? img.toColourspace("cmyk") : img.withIccProfile("p3");
  img = img
    .withExif({
      IFD0: { Make: FAKE_CAMERA_MAKE, Model: "Model 9", Artist: FAKE_OWNER, DateTime: "2026:01:02 03:04:05" },
      IFD2: { DateTimeOriginal: "2026:01:02 03:04:05", BodySerialNumber: "SN-000123" },
      IFD3: FAKE_GPS,
    })
    .withXmp(FAKE_XMP);
  if (opts.orientation) img = img.withMetadata({ orientation: opts.orientation });
  if (format === "png") return img.png().toBuffer();
  if (format === "webp") return img.webp({ quality: 90 }).toBuffer();
  return img.jpeg({ quality: 90, progressive: opts.progressive ?? false }).toBuffer();
}

/** A clean picture (no metadata at all) — the byte-for-byte control. */
export async function cleanPhoto(format: PhotoFormat): Promise<Buffer> {
  const img = sharp(photoPixels(), { raw: { width: PHOTO_W, height: PHOTO_H, channels: 3 } });
  if (format === "png") return img.png().toBuffer();
  if (format === "webp") return img.webp({ quality: 90 }).toBuffer();
  return img.jpeg({ quality: 90 }).toBuffer();
}

/** Nothing identifying left: sharp finds no EXIF beyond a one-tag
 *  orientation, no XMP/IPTC/text, and the made-up camera, owner and GPS
 *  strings are gone from the bytes. */
export async function expectNoCameraMetadata(bytes: Uint8Array) {
  const meta = await sharp(bytes).metadata();
  if (meta.exif) expect(isOrientationOnlyTiff(tiffOf(meta.exif))).toBe(true);
  expect(meta.xmp).toBeUndefined();
  expect(meta.iptc).toBeUndefined();
  expect(meta.comments ?? []).toEqual([]);
  const text = Buffer.from(bytes).toString("latin1");
  for (const needle of [FAKE_CAMERA_MAKE, FAKE_OWNER, "GPSLatitude", "SN-000123"]) {
    expect(text.includes(needle), needle).toBe(false);
  }
  expect(inspectImageMetadata(bytes)?.found).toEqual([]);
}

// --- JPEG splicing -------------------------------------------------------------

export function jpegSegment(code: number, payload: Buffer | string): Buffer {
  const body = typeof payload === "string" ? Buffer.from(payload, "latin1") : payload;
  const len = body.length + 2;
  return Buffer.concat([Buffer.from([0xff, code, len >> 8, len & 0xff]), body]);
}

/** Insert whole segments right after SOI. */
export function withJpegSegments(jpeg: Buffer, ...segments: Buffer[]): Buffer {
  return Buffer.concat([jpeg.subarray(0, 2), ...segments, jpeg.subarray(2)]);
}

/** Insert segments right before the Nth (0-based) SOS marker — between the
 *  scans of a progressive JPEG. In a scan's entropy data 0xFF is always
 *  followed by 0x00 or a restart marker, so every FF DA is a real SOS. */
export function withSegmentsBeforeScan(jpeg: Buffer, scan: number, ...segments: Buffer[]): Buffer {
  let at = -1;
  for (let n = 0, from = 0; n <= scan; n += 1) {
    at = jpeg.indexOf(Buffer.from([0xff, 0xda]), from);
    if (at < 0) throw new Error(`no SOS #${scan}`);
    from = at + 2;
  }
  return Buffer.concat([jpeg.subarray(0, at), ...segments, jpeg.subarray(at)]);
}

/** A JFIF APP0 with a 2×1 uncompressed RGB thumbnail. */
export const jfifWithThumbnail = () =>
  jpegSegment(0xe0, Buffer.from([...Buffer.from("JFIF\0", "latin1"), 1, 2, 0, 0, 72, 0, 72, 2, 1, 9, 9, 9, 8, 8, 8]));
export const jfxxThumbnail = () => jpegSegment(0xe0, Buffer.from("JFXX\0\x13thumbnail-bytes", "latin1"));
/** Photoshop IRB 0x0404 (IPTC-NAA) holding a By-line (2:80). */
export const iptcSegment = () =>
  jpegSegment(
    0xed,
    Buffer.concat([
      Buffer.from("Photoshop 3.0\0", "latin1"),
      Buffer.from("8BIM", "latin1"),
      Buffer.from([0x04, 0x04, 0, 0, 0, 0, 0, 0x0d, 0x1c, 0x02, 0x50, 0, 0x08]),
      Buffer.from(FAKE_OWNER.slice(0, 8), "latin1"),
    ]),
  );
export const mpfSegment = () => jpegSegment(0xe2, "MPF\0MM\0*\0\0\0\x08");
export const c2paSegment = () => jpegSegment(0xeb, "JP\0\x01\0\0\0\x01\0\0\0\x10jumbc2pa-manifest");
export const commentSegment = () => jpegSegment(0xfe, `Shot by ${FAKE_OWNER}`);
export const ducky = () => jpegSegment(0xec, "Ducky\0\x01\0\x04\0\0\0\x50");
/** A secondary image after EOI, the way MPF / Ultra HDR / depth maps ride. */
export const trailingImage = async () => cleanPhoto("jpeg");

// --- PNG splicing ----------------------------------------------------------------

export function pngChunk(type: string, data: Buffer | string): Buffer {
  const body = typeof data === "string" ? Buffer.from(data, "latin1") : data;
  const typeBytes = Buffer.from(type, "latin1");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, body])));
  return Buffer.concat([len, typeBytes, body, crc]);
}

/** Insert chunks right before the first IDAT. */
export function withPngChunks(png: Buffer, ...chunks: Buffer[]): Buffer {
  const idat = png.indexOf(Buffer.from("IDAT", "latin1")) - 4;
  return Buffer.concat([png.subarray(0, idat), ...chunks, png.subarray(idat)]);
}

/** The chunk types of a PNG, in order. */
export function pngChunkTypes(png: Buffer): string[] {
  const types: string[] = [];
  for (let p = 8; p + 8 <= png.length; ) {
    const len = png.readUInt32BE(p);
    types.push(png.toString("latin1", p + 4, p + 8));
    p += 12 + len;
  }
  return types;
}

/** A TIFF (EXIF) block carrying a GPS IFD with latitude + longitude, made
 *  by sharp and lifted out of a JPEG — what a phone writes into eXIf. */
export async function gpsTiff(orientation?: number): Promise<Buffer> {
  let img = sharp(photoPixels(8, 8), { raw: { width: 8, height: 8, channels: 3 } }).withExif({
    IFD0: { Make: FAKE_CAMERA_MAKE },
    IFD3: FAKE_GPS,
  });
  if (orientation) img = img.withMetadata({ orientation });
  const exif = (await sharp(await img.jpeg().toBuffer()).metadata()).exif!;
  return exif.subarray(6); // drop "Exif\0\0"
}

// --- WebP ------------------------------------------------------------------------

/** The RIFF chunk fourccs of a WebP, in order, and the VP8X flags byte. */
export function webpChunks(webp: Buffer): { fourccs: string[]; flags: number | null } {
  const fourccs: string[] = [];
  let flags: number | null = null;
  for (let p = 12; p + 8 <= webp.length; ) {
    const fourcc = webp.toString("latin1", p, p + 4);
    const size = webp.readUInt32LE(p + 4);
    if (fourcc === "VP8X") flags = webp[p + 8];
    fourccs.push(fourcc);
    p += 8 + size + (size & 1);
  }
  return { fourccs, flags };
}

export function riffChunk(fourcc: string, data: Buffer | string): Buffer {
  const body = typeof data === "string" ? Buffer.from(data, "latin1") : data;
  const head = Buffer.alloc(8);
  head.write(fourcc, 0, "latin1");
  head.writeUInt32LE(body.length, 4);
  return Buffer.concat([head, body, body.length & 1 ? Buffer.alloc(1) : Buffer.alloc(0)]);
}

/** A 3-frame animated WebP (VP8X + ANIM + ANMF). */
export async function animatedWebp(): Promise<Buffer> {
  return sharp(photoPixels(16, 48), { raw: { width: 16, height: 48, channels: 3, pageHeight: 16 } })
    .webp({ loop: 0, quality: 90 })
    .toBuffer();
}

/** Append RIFF chunks (and fix the RIFF size). */
export function withWebpChunks(webp: Buffer, ...chunks: Buffer[]): Buffer {
  const out = Buffer.concat([webp, ...chunks]);
  out.writeUInt32LE(out.length - 8, 4);
  return out;
}

// --- GIF -------------------------------------------------------------------------

function gifSubBlocks(data: Buffer): Buffer {
  const parts: Buffer[] = [];
  for (let i = 0; i < data.length; i += 255) {
    const chunk = data.subarray(i, i + 255);
    parts.push(Buffer.from([chunk.length]), chunk);
  }
  parts.push(Buffer.from([0]));
  return Buffer.concat(parts);
}

export const gifApplication = (id: string, data: Buffer) =>
  Buffer.concat([Buffer.from([0x21, 0xff, 11]), Buffer.from(id, "latin1"), gifSubBlocks(data)]);
export const gifLoop = () => gifApplication("NETSCAPE2.0", Buffer.from([1, 0, 0]));
export const gifComment = () => Buffer.concat([Buffer.from([0x21, 0xfe]), gifSubBlocks(Buffer.from(`Taken by ${FAKE_OWNER}`, "latin1"))]);
export const gifXmp = () => gifApplication("XMP DataXMP", Buffer.from(FAKE_XMP, "latin1"));

/** A GIF (sharp/cgif) with a loop extension, a comment and an XMP packet
 *  naming a GPS position spliced in before the first image block. */
export async function cameraGif(opts: { trailer?: boolean } = {}): Promise<Buffer> {
  const gif = await sharp(photoPixels(16, 12), { raw: { width: 16, height: 12, channels: 3 } }).gif().toBuffer();
  const packed = gif[10];
  const headerEnd = 13 + (packed & 0x80 ? 3 * (1 << ((packed & 7) + 1)) : 0);
  const out = Buffer.concat([gif.subarray(0, headerEnd), gifLoop(), gifComment(), gifXmp(), gif.subarray(headerEnd)]);
  return opts.trailer === false ? out.subarray(0, out.length - 1) : out;
}
