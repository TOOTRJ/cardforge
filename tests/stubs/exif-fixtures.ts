import sharp from "sharp";

// ---------------------------------------------------------------------------
// EXIF orientation fixtures (TODO 3.14), generated in-test — no binary files.
//
// `upright()` is the picture a person sees: four flat quadrants (red top-left,
// green top-right, blue bottom-left, yellow bottom-right). Four distinct
// corners tell all eight orientations apart, so a rotated OR mirrored draw
// can't pass for the right one.
//
// `storedAs(o)` is what a camera writes for that picture with EXIF
// Orientation `o`: the pixels laid out so that obeying the tag shows
// `upright()` (what Chrome does for a JPEG or PNG; it ignores the tag on a
// WebP and shows `asStored(o)` instead). The mapping below is the EXIF
// definition written out by hand (where stored row 0 / column 0 end up on
// screen), and the fixture tests cross-check it against sharp's own
// autoOrient().
// ---------------------------------------------------------------------------

export type Rgb = readonly [number, number, number];

export const QUADRANTS = {
  topLeft: [220, 30, 30],
  topRight: [30, 200, 60],
  bottomLeft: [40, 60, 220],
  bottomRight: [235, 215, 40],
} as const satisfies Record<string, Rgb>;

/** Displayed size of every fixture: portrait, like a phone photo held
 *  upright (the stored file of an orientation-6/8 photo is landscape). */
export const UPRIGHT_W = 300;
export const UPRIGHT_H = 400;

function uprightPixel(x: number, y: number, w: number, h: number): Rgb {
  const left = x < w / 2;
  const top = y < h / 2;
  if (top) return left ? QUADRANTS.topLeft : QUADRANTS.topRight;
  return left ? QUADRANTS.bottomLeft : QUADRANTS.bottomRight;
}

/** Stored pixel (sx, sy) → the displayed pixel it becomes, per EXIF. */
function displayedAt(
  o: number,
  sx: number,
  sy: number,
  dw: number,
  dh: number,
): [number, number] {
  switch (o) {
    case 2: return [dw - 1 - sx, sy];
    case 3: return [dw - 1 - sx, dh - 1 - sy];
    case 4: return [sx, dh - 1 - sy];
    case 5: return [sy, sx];
    case 6: return [dw - 1 - sy, sx];
    case 7: return [dw - 1 - sy, dh - 1 - sx];
    case 8: return [sy, dh - 1 - sx];
    default: return [sx, sy];
  }
}

/** Raw RGB of the stored pixels for orientation `o` (1 = the upright image). */
export function storedPixels(
  o: number,
  dw = UPRIGHT_W,
  dh = UPRIGHT_H,
): { data: Buffer; width: number; height: number } {
  const [sw, sh] = o >= 5 ? [dh, dw] : [dw, dh];
  const data = Buffer.alloc(sw * sh * 3);
  for (let sy = 0; sy < sh; sy += 1) {
    for (let sx = 0; sx < sw; sx += 1) {
      const [dx, dy] = displayedAt(o, sx, sy, dw, dh);
      const rgb = uprightPixel(dx, dy, dw, dh);
      data.set(rgb, (sy * sw + sx) * 3);
    }
  }
  return { data, width: sw, height: sh };
}

export type FixtureFormat = "jpeg" | "png" | "webp";

/** An encoded file whose stored pixels are laid out for orientation `o` and
 *  whose EXIF says `o` — i.e. obeying the tag shows `upright()`. */
export async function storedAs(
  o: number,
  format: FixtureFormat = "jpeg",
  dw = UPRIGHT_W,
  dh = UPRIGHT_H,
): Promise<Buffer> {
  const { data, width, height } = storedPixels(o, dw, dh);
  const img = sharp(data, { raw: { width, height, channels: 3 } }).withMetadata({ orientation: o });
  if (format === "png") return img.png().toBuffer();
  if (format === "webp") return img.webp({ quality: 100 }).toBuffer();
  return img.jpeg({ quality: 100, chromaSubsampling: "4:4:4" }).toBuffer();
}

/** The same picture already upright, no tag — the "pre-rotated" control. */
export async function upright(format: FixtureFormat = "jpeg", dw = UPRIGHT_W, dh = UPRIGHT_H): Promise<Buffer> {
  const { data, width, height } = storedPixels(1, dw, dh);
  const img = sharp(data, { raw: { width, height, channels: 3 } });
  if (format === "png") return img.png().toBuffer();
  if (format === "webp") return img.webp({ quality: 100 }).toBuffer();
  return img.jpeg({ quality: 100, chromaSubsampling: "4:4:4" }).toBuffer();
}

/** The same stored pixels as `storedAs(o)` with NO tag, as PNG — what a
 *  reader that ignores the tag shows (Chrome for a WebP, the pre-3.14 bake
 *  for everything). */
export async function asStored(o: number, dw = UPRIGHT_W, dh = UPRIGHT_H): Promise<Buffer> {
  const { data, width, height } = storedPixels(o, dw, dh);
  return sharp(data, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

export const dataUrl = (bytes: Buffer, mime: string) => `data:${mime};base64,${bytes.toString("base64")}`;

/** Mean colour of a box (fractions of the image), decoded WITHOUT
 *  auto-orienting — i.e. the stored pixels as a tag-blind reader sees them. */
export async function meanRgb(
  bytes: Buffer,
  box: { x0: number; y0: number; x1: number; y1: number },
): Promise<Rgb> {
  const { data, info } = await sharp(bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const [x0, x1] = [Math.round(box.x0 * info.width), Math.round(box.x1 * info.width)];
  const [y0, y1] = [Math.round(box.y0 * info.height), Math.round(box.y1 * info.height)];
  const sum = [0, 0, 0];
  let n = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const i = (y * info.width + x) * info.channels;
      sum[0] += data[i];
      sum[1] += data[i + 1];
      sum[2] += data[i + 2];
      n += 1;
    }
  }
  return [sum[0] / n, sum[1] / n, sum[2] / n];
}

export const colourDistance = (a: Rgb, b: Rgb) =>
  Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));

/** The four quadrant centres of a decoded image, read tag-blind. */
export async function quadrantColours(bytes: Buffer) {
  const at = (cx: number, cy: number) => meanRgb(bytes, { x0: cx - 0.1, y0: cy - 0.1, x1: cx + 0.1, y1: cy + 0.1 });
  return {
    topLeft: await at(0.25, 0.25),
    topRight: await at(0.75, 0.25),
    bottomLeft: await at(0.25, 0.75),
    bottomRight: await at(0.75, 0.75),
  };
}

/** True when a tag-blind decode of `bytes` looks like `upright()`. */
export async function looksUpright(bytes: Buffer, tolerance = 12): Promise<boolean> {
  const q = await quadrantColours(bytes);
  return (Object.keys(QUADRANTS) as (keyof typeof QUADRANTS)[]).every(
    (k) => colourDistance(q[k], QUADRANTS[k]) <= tolerance,
  );
}

/** True when two images, both decoded tag-blind, have the same quadrant
 *  colours (and so the same layout on screen). */
export async function sameQuadrants(a: Buffer, b: Buffer, tolerance = 12): Promise<boolean> {
  const [qa, qb] = [await quadrantColours(a), await quadrantColours(b)];
  return (Object.keys(QUADRANTS) as (keyof typeof QUADRANTS)[]).every(
    (k) => colourDistance(qa[k], qb[k]) <= tolerance,
  );
}
