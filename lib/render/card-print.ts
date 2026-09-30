import "server-only";

import sharp, { type OverlayOptions } from "sharp";
import type { CardPreviewData } from "@/components/cards/card-preview";
import { applyCardCornerMask, cardCornerRadiusPx, squareCardCorners } from "@/lib/cards/card-corner";
import { normalizeFrameTemplate } from "@/lib/cards/card-display";
import {
  bleedPxPerAxis,
  printScale,
  printTurnsPortrait,
  type BleedInches,
  type PrintBleed,
  type PrintPpi,
} from "@/lib/cards/print-export";
import { EDGE_CONTRACTS, EDGE_NAMES, type EdgeContract, type EdgeName } from "@/lib/frames/edge-contract";
import { browserAppliesOrientation } from "@/lib/media/orientation";
import { fetchImageBytes, TRANSPARENT_PIXEL_DATA_URL, toSatoriDataUrl } from "@/lib/render/art-source";
import {
  isLandscapeRender,
  readPrintArtBox,
  renderCardImage,
  RENDER_PRESETS,
  squareCornerFillsOf,
  type PrintArtBox,
} from "@/lib/render/card-image";

// ---------------------------------------------------------------------------
// PRINT renders of one card (TODO 6.10 full-resolution art, 6.1a bleed,
// 6.1b 800 ppi) — live downloads only: the PDF, the bleed PNG/PDF and the
// 800 ppi PNG. NEVER the stored bake, a thumb or an OG image (those stay on
// renderCardImage's own art path, byte for byte).
//
// Why a separate path (6.10): the bake inlines the art into Satori's SVG as
// a data: URL fitted to MAX_INLINE_EDGE (1600 px) — resvg's XML buffer caps
// what can be inlined — so a full-height slot (full art, ~2100 px at HD,
// 2800 at 800 ppi) is drawn from an upsampled copy. Here Satori draws the
// card WITHOUT the art (renderCardImage printLayer + CardImage omitArt: the
// art boxes stay empty on a see-through root) and sharp composites the
// ORIGINAL art bytes underneath with the SAME fit — object-fit: cover at the
// focal point, then scale() about it, in the box Satori laid out (its
// onNodeDetected hands the boxes back, readPrintArtBox) — resampling the
// source straight to the output's pixels. A source as large as the slot is
// drawn 1:1 (tests/unit/render/card-print.test.ts: a 2000 × 2800 source on
// a full-card slot at 800 ppi comes out pixel for pixel).
//
// Paint order is kept: CardImage paints the root's #101015, the under-frame
// art (see-through frames, 4.17), the art, then everything else; the
// composite is #101015 → under-frame art → art → the layer, and "over" is
// associative, so the layer's frame, finishes and text land on the art
// exactly as they do in one Satori pass. The second face's art (split,
// aftermath) stays in the layer on the bake's own path — its window is a
// fraction of the card, well inside the 1600 px inline fit.
//
// 800 ppi (6.1b) is the HD LAYOUT (every fit, line break and whole-pixel
// rule of the 1500 × 2100 bake) rasterized at 4/3: sharp re-renders the
// SVG's vectors at the target scale, so text, pips and symbols are drawn at
// 800 ppi, not upsampled. The frame masters are 1500 × 2100 today, so the
// frame is resampled (lib/cards/print-export.ts PRINT_NATIVE_800_TEMPLATES).
//
// Corners: print is square (TODO 3.26). The layer is rasterized uncut; the
// composite is cut and squared with the same corner fills a square bake uses
// (squareCornerFillsOf, squareCardCorners), so an art-to-edge corner keeps
// the art.
//
// Bleed (6.1a): the trim box is exactly the export without bleed, and each
// edge extends by the frame's declared edge (lib/frames/edge-contract.ts,
// the "vocabulary of 6.1a's bleed recipe"):
//   border — the trim edge's outer pixels copied out (the border colour);
//   bar    — the same (a borderless bottom bar's edge row, copied out);
//   art    — the art keeps the TRIM transform and is drawn unclipped into
//            the bleed (never re-covered to the bigger box), mirrored where
//            the source runs out; any frame pixels on that edge (a
//            borderless frame's fins, a bar crossing it) are copied out on
//            top, so they continue into the bleed too.
// Corners are square whenever the bleed is on.
//
// The bleed is PER AXIS (TODO 6.1): `x` on the portrait card's left and
// right edges, `y` on its top and bottom — the 1/8 in bleed is 1/8 in on
// both, MakePlayingCards' is MPC_BLEED_IN (lib/cards/print-export.ts), and
// any other per-axis bleed is drawn the same way. A landscape render
// (Battle, Split) IS the portrait card turned, so its left and right edges
// take `y` and its top and bottom `x`. MPC's file is always PORTRAIT: the
// landscape card is drawn with its bleed, then turned 90° anticlockwise into
// the portrait card — as every print turns it (lib/render/card-pdf.ts
// cardSlotPlacement: its top edge up the card's left side, the title reading
// bottom to top).
// ---------------------------------------------------------------------------

/** CardImage's root background (the ring colour of a see-through edge). */
const ROOT_BACKGROUND = { r: 0x10, g: 0x10, b: 0x15, alpha: 1 } as const;

/** A box edge within this many LAYOUT px of the card edge "touches" it —
 *  only such a box is drawn on into the bleed of an `art` edge. */
const TOUCH_TOLERANCE_PX = 1;

const ALL_BORDER: EdgeContract = {
  top: { kind: "border" },
  right: { kind: "border" },
  bottom: { kind: "border" },
  left: { kind: "border" },
};

export type PrintRenderOptions = {
  ppi: PrintPpi;
  /** None (false), the 1/8 in bleed (true), MakePlayingCards' ("mpc" — also
   *  turns a landscape card portrait), or a bleed per axis in inches. */
  bleed: PrintBleed | BleedInches;
  /** The free-tier brand mark (downloadBrandMark — the VIEWER's plan). */
  brandMark: boolean;
  /** The owner's custom footer mark (paid perk), or null. */
  watermarkText: string | null;
};

/** The decoded art source: bytes sharp reads (the original file, or raw
 *  RGBA when it had to be turned upright first), and the file itself. */
type ArtSource = {
  input: Buffer;
  raw?: { width: number; height: number; channels: 4 };
  width: number;
  height: number;
  /** The original file (a foil card's mask copy is made from it). */
  bytes: Buffer;
};

/**
 * The full-resolution art could not be drawn — sharp read the header but not
 * the pixels (a truncated upload, a corrupt chunk), which the bake's own
 * decoder (librsvg's) may still show. renderCardPrint then prints the card
 * with the art as the bake draws it rather than failing the download.
 */
class PrintArtError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "PrintArtError";
  }
}

/** Run one step that decodes the art; its failure is a PrintArtError. */
async function artStep<T>(step: () => Promise<T>): Promise<T> {
  try {
    return await step();
  } catch (err) {
    throw new PrintArtError(err);
  }
}

/** The declared edges of a card's frame (EDGE_CONTRACTS), all `border` for a
 *  template the table doesn't know. */
export function printEdgesOf(card: CardPreviewData): EdgeContract {
  return EDGE_CONTRACTS[normalizeFrameTemplate(card.frameStyle?.template)] ?? ALL_BORDER;
}

/**
 * The art's bytes, turned upright the way the creator shows them
 * (browserAppliesOrientation — the rule toSatoriDataUrl applies), or null
 * when there is none or it can't be read (the layer then draws the art its
 * usual way).
 */
async function loadArt(bytes: Buffer | null): Promise<ArtSource | null> {
  if (!bytes) return null;
  try {
    const meta = await sharp(bytes, { animated: false }).metadata();
    if (!meta.width || !meta.height) return null;
    if (browserAppliesOrientation(meta)) {
      const { data, info } = await sharp(bytes, { animated: false })
        .autoOrient()
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      return {
        input: data,
        raw: { width: info.width, height: info.height, channels: 4 },
        width: info.width,
        height: info.height,
        bytes,
      };
    }
    const height = meta.pageHeight && meta.pages && meta.pages > 1 ? meta.pageHeight : meta.height;
    return { input: bytes, width: meta.width, height, bytes };
  } catch {
    return null;
  }
}

function source(art: ArtSource) {
  return sharp(art.input, art.raw ? { raw: art.raw } : { animated: false });
}

const clampInt = (value: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, value));

/**
 * The art of one box as a raw RGBA overlay on a canvas whose trim sits
 * `offsetX` × `offsetY` px in (0, or the bleed on each axis), at `scale`
 * output px per layout px. The fit is
 * CSS's (and Satori's): cover the box at the focal point, then scale() about
 * the focal point; the box is the clip. On each edge in `extend` that the
 * box touches, the clip runs on to the canvas edge (the bleed) with the SAME
 * transform, and where the source runs out there — having covered the trim
 * edge — it is mirrored. Null when nothing of the art lands in the clip.
 */
export async function artOverlay(
  art: ArtSource,
  box: PrintArtBox,
  frame: {
    scale: number;
    /** The trim's offset on the canvas: 0, or the bleed on each axis. */
    offsetX: number;
    offsetY: number;
    canvasWidth: number;
    canvasHeight: number;
    /** The card's layout size (the touch test). */
    layoutWidth: number;
    layoutHeight: number;
    extend: ReadonlySet<EdgeName>;
  },
): Promise<OverlayOptions | null> {
  const { scale: s, offsetX: ox0, offsetY: oy0 } = frame;
  const bx = ox0 + s * box.left;
  const by = oy0 + s * box.top;
  const bw = s * box.width;
  const bh = s * box.height;
  if (!(bw > 0 && bh > 0)) return null;
  const cover = Math.max(bw / art.width, bh / art.height);
  const k = cover * box.scale;
  const ox = bx + bw * box.focalX;
  const oy = by + bh * box.focalY;
  const x = ox + (bx + (bw - art.width * cover) * box.focalX - ox) * box.scale;
  const y = oy + (by + (bh - art.height * cover) * box.focalY - oy) * box.scale;

  const touches: Record<EdgeName, boolean> = {
    left: box.left <= TOUCH_TOLERANCE_PX,
    top: box.top <= TOUCH_TOLERANCE_PX,
    right: box.left + box.width >= frame.layoutWidth - TOUCH_TOLERANCE_PX,
    bottom: box.top + box.height >= frame.layoutHeight - TOUCH_TOLERANCE_PX,
  };
  const open = (edge: EdgeName) => frame.extend.has(edge) && touches[edge];
  const box0 = { x0: Math.round(bx), y0: Math.round(by), x1: Math.round(bx + bw), y1: Math.round(by + bh) };
  const clip = {
    x0: open("left") ? 0 : box0.x0,
    y0: open("top") ? 0 : box0.y0,
    x1: open("right") ? frame.canvasWidth : box0.x1,
    y1: open("bottom") ? frame.canvasHeight : box0.y1,
  };

  // The source pixels whose image lands in the clip.
  const sx0 = clampInt(Math.floor((clip.x0 - x) / k), 0, art.width);
  const sx1 = clampInt(Math.ceil((clip.x1 - x) / k), 0, art.width);
  const sy0 = clampInt(Math.floor((clip.y0 - y) / k), 0, art.height);
  const sy1 = clampInt(Math.ceil((clip.y1 - y) / k), 0, art.height);
  if (sx1 <= sx0 || sy1 <= sy0) return null;
  const regionW = sx1 - sx0;
  const regionH = sy1 - sy0;
  let w = Math.max(1, Math.round(regionW * k));
  let h = Math.max(1, Math.round(regionH * k));
  let px = Math.round(x + sx0 * k);
  let py = Math.round(y + sy0 * k);

  let pipeline = source(art).extract({ left: sx0, top: sy0, width: regionW, height: regionH }).ensureAlpha();
  // 1:1 (a source the size of its slot at this resolution) is copied, not
  // resampled.
  if (w !== regionW || h !== regionH) pipeline = pipeline.resize(w, h, { fit: "fill", kernel: "lanczos3" });
  let data = await pipeline.raw().toBuffer();

  // Where the source runs out inside the bleed, mirror it — only on an
  // opened edge whose trim edge the art covers (else the trim edge shows
  // the root there, and so does the bleed).
  const pad = {
    left: open("left") && sx0 === 0 && x <= box0.x0 + 0.5 ? Math.max(0, px - clip.x0) : 0,
    top: open("top") && sy0 === 0 && y <= box0.y0 + 0.5 ? Math.max(0, py - clip.y0) : 0,
    right:
      open("right") && sx1 === art.width && x + art.width * k >= box0.x1 - 0.5 ? Math.max(0, clip.x1 - (px + w)) : 0,
    bottom:
      open("bottom") && sy1 === art.height && y + art.height * k >= box0.y1 - 0.5
        ? Math.max(0, clip.y1 - (py + h))
        : 0,
  };
  if (pad.left || pad.top || pad.right || pad.bottom) {
    data = await sharp(data, { raw: { width: w, height: h, channels: 4 } })
      .extend({ ...pad, extendWith: "mirror" })
      .raw()
      .toBuffer();
    px -= pad.left;
    py -= pad.top;
    w += pad.left + pad.right;
    h += pad.top + pad.bottom;
  }

  // Cut to the clip.
  const ix0 = Math.max(px, clip.x0);
  const iy0 = Math.max(py, clip.y0);
  const ix1 = Math.min(px + w, clip.x1);
  const iy1 = Math.min(py + h, clip.y1);
  if (ix1 <= ix0 || iy1 <= iy0) return null;
  if (ix0 !== px || iy0 !== py || ix1 !== px + w || iy1 !== py + h) {
    data = await sharp(data, { raw: { width: w, height: h, channels: 4 } })
      .extract({ left: ix0 - px, top: iy0 - py, width: ix1 - ix0, height: iy1 - iy0 })
      .raw()
      .toBuffer();
  }
  return { input: data, raw: { width: ix1 - ix0, height: iy1 - iy0, channels: 4 }, left: ix0, top: iy0 };
}

async function artOverlays(
  art: ArtSource | null,
  boxes: readonly PrintArtBox[],
  frame: Parameters<typeof artOverlay>[2],
): Promise<OverlayOptions[]> {
  if (!art) return [];
  // CardImage's order: the under-frame copy, then the art window.
  const ordered = [...boxes].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "under" ? -1 : 1));
  const overlays: OverlayOptions[] = [];
  for (const box of ordered) {
    const overlay = await artStep(() => artOverlay(art, box, frame));
    if (overlay) overlays.push(overlay);
  }
  return overlays;
}

/** Copy the rect [x0, x1) × [y0, y1) of `from` into `to` (same-size RGBA). */
function copyRect(from: Buffer, to: Buffer, width: number, rect: { x0: number; y0: number; x1: number; y1: number }): void {
  for (let yy = rect.y0; yy < rect.y1; yy += 1) {
    const start = (yy * width + rect.x0) * 4;
    from.copy(to, start, start, (yy * width + rect.x1) * 4);
  }
}

/**
 * Render a card for print: square corners, the art at full resolution, at
 * `ppi` (600 = the HD layout's 1500 × 2100, 800 = 2000 × 2800), with an
 * optional bleed — 1/8 in on every side, MakePlayingCards' (turned portrait),
 * or any bleed per axis. Returns opaque RGB PNG bytes tagged with the
 * resolution (pHYs = ppi, sRGB).
 *
 * Art sharp can't decode in full (a truncated or corrupt file whose header
 * reads fine) is drawn the way the bake draws it — Satori's inlined copy in
 * the layer — so the download matches the card on the site instead of
 * failing (the PDF rendered it that way before the print path existed).
 */
export async function renderCardPrint(card: CardPreviewData, opts: PrintRenderOptions): Promise<Buffer> {
  const art = await loadArt(await fetchImageBytes(card.artUrl));
  if (art) {
    try {
      return await renderPrint(card, opts, art);
    } catch (err) {
      if (!(err instanceof PrintArtError)) throw err;
      console.warn(`[print] full-resolution art failed (${err.message}); drawing the bake's copy instead`);
    }
  }
  return renderPrint(card, opts, null);
}

async function renderPrint(card: CardPreviewData, opts: PrintRenderOptions, art: ArtSource | null): Promise<Buffer> {
  const landscape = isLandscapeRender(card);
  const hd = RENDER_PRESETS.hd;
  const layoutWidth = landscape ? hd.height : hd.width;
  const layoutHeight = landscape ? hd.width : hd.height;
  const scale = printScale(opts.ppi);
  const trimW = Math.round(layoutWidth * scale);
  const trimH = Math.round(layoutHeight * scale);

  // The layer never draws the art; it only needs to know there is one (the
  // art boxes are laid out) — and a foil card's sheen masks with the art's
  // lightness, so a foil card keeps a Satori-sized copy for the mask. With
  // no decodable art (null) the layer draws the card's art itself, as the
  // bake does.
  const layerCard: CardPreviewData = art
    ? {
        ...card,
        artUrl:
          card.frameStyle?.finish === "foil"
            ? await artStep(() => toSatoriDataUrl(art.bytes))
            : TRANSPARENT_PIXEL_DATA_URL,
      }
    : card;

  const boxes: PrintArtBox[] = [];
  const response = await renderCardImage(layerCard, "hd", {
    brandMark: opts.brandMark,
    watermarkText: opts.watermarkText,
    corners: "square",
    printLayer: {
      omitArt: Boolean(art),
      outputWidth: trimW,
      onNodeDetected: (node) => {
        const box = readPrintArtBox(node);
        if (box) boxes.push(box);
      },
    },
  });
  const layer = Buffer.from(await response.arrayBuffer());

  const trimFrame = {
    scale,
    offsetX: 0,
    offsetY: 0,
    canvasWidth: trimW,
    canvasHeight: trimH,
    layoutWidth,
    layoutHeight,
    extend: new Set<EdgeName>(),
  };
  const trim = await sharp({ create: { width: trimW, height: trimH, channels: 4, background: ROOT_BACKGROUND } })
    .composite([...(await artOverlays(art, boxes, trimFrame)), { input: layer, left: 0, top: 0 }])
    .raw()
    .toBuffer();
  // Square, as every print is: cut the corner and fill it the way a square
  // bake does (the art stays where it runs into the corner).
  const radius = cardCornerRadiusPx(trimW, trimH);
  const cornerFills = squareCornerFillsOf(card);
  applyCardCornerMask(trim, trimW, trimH, radius);
  squareCardCorners(trim, trimW, trimH, cornerFills, radius);

  // Opaque (squared) → RGB, no alpha channel for print software to guess
  // about; tagged sRGB with the resolution (pHYs), so 2000 px reads as
  // 2.5 in. A file that is always portrait (MPC) turns a landscape card 90°
  // anticlockwise into it.
  const turn = landscape && printTurnsPortrait(opts.bleed);
  const encode = (data: Buffer, width: number, height: number) => {
    const rgb = sharp(data, { raw: { width, height, channels: 4 } }).removeAlpha();
    return (turn ? rgb.rotate(270) : rgb).withMetadata({ density: opts.ppi }).png().toBuffer();
  };

  // The bleed per side in the RENDER's orientation: a landscape render is
  // the portrait card turned, so its left and right edges take the card's y.
  const axis = bleedPxPerAxis(opts.ppi, opts.bleed);
  const bleedH = landscape ? axis.y : axis.x;
  const bleedV = landscape ? axis.x : axis.y;
  if (bleedH === 0 && bleedV === 0) return encode(trim, trimW, trimH);

  // The bleed: the trim card with its edge pixels copied out (border, bar)…
  const width = trimW + 2 * bleedH;
  const height = trimH + 2 * bleedV;
  const out = await sharp(trim, { raw: { width: trimW, height: trimH, channels: 4 } })
    .extend({ top: bleedV, bottom: bleedV, left: bleedH, right: bleedH, extendWith: "copy" })
    .raw()
    .toBuffer();

  // …and, on each `art` edge, the art drawn on with the trim transform, the
  // layer's edge pixels (fins, bars) copied out over it.
  const edges = printEdgesOf(card);
  const artEdges = new Set(EDGE_NAMES.filter((edge) => edges[edge].kind === "art"));
  if (art && artEdges.size > 0) {
    const copied = Buffer.from(out);
    const layerOut = await sharp(layer)
      .extend({ top: bleedV, bottom: bleedV, left: bleedH, right: bleedH, extendWith: "copy" })
      .png()
      .toBuffer();
    const bleedFrame = {
      ...trimFrame,
      offsetX: bleedH,
      offsetY: bleedV,
      canvasWidth: width,
      canvasHeight: height,
      extend: artEdges,
    };
    const drawn = await sharp({ create: { width, height, channels: 4, background: ROOT_BACKGROUND } })
      .composite([...(await artOverlays(art, boxes, bleedFrame)), { input: layerOut, left: 0, top: 0 }])
      .raw()
      .toBuffer();
    const bands: Record<EdgeName, { x0: number; y0: number; x1: number; y1: number }> = {
      top: { x0: 0, y0: 0, x1: width, y1: bleedV },
      bottom: { x0: 0, y0: height - bleedV, x1: width, y1: height },
      left: { x0: 0, y0: bleedV, x1: bleedH, y1: height - bleedV },
      right: { x0: width - bleedH, y0: bleedV, x1: width, y1: height - bleedV },
    };
    for (const edge of artEdges) copyRect(drawn, out, width, bands[edge]);
    // Beside a corner the square filled (the border black, a bar's colour —
    // not art or design, which keep what was drawn), the trim edge there is
    // that fill: continue it (copied out) rather than the uncut layer, whose
    // rounded master shows the root there.
    const r = Math.ceil(radius);
    const [tl, tr, bl, br] = cornerFills.map((fill) => fill !== null);
    const zones: Record<EdgeName, [boolean, { x0: number; y0: number; x1: number; y1: number }][]> = {
      top: [
        [tl, { x0: 0, y0: 0, x1: bleedH + r, y1: bleedV }],
        [tr, { x0: width - bleedH - r, y0: 0, x1: width, y1: bleedV }],
      ],
      bottom: [
        [bl, { x0: 0, y0: height - bleedV, x1: bleedH + r, y1: height }],
        [br, { x0: width - bleedH - r, y0: height - bleedV, x1: width, y1: height }],
      ],
      left: [
        [tl, { x0: 0, y0: bleedV, x1: bleedH, y1: bleedV + r }],
        [bl, { x0: 0, y0: height - bleedV - r, x1: bleedH, y1: height - bleedV }],
      ],
      right: [
        [tr, { x0: width - bleedH, y0: bleedV, x1: width, y1: bleedV + r }],
        [br, { x0: width - bleedH, y0: height - bleedV - r, x1: width, y1: height - bleedV }],
      ],
    };
    for (const edge of artEdges) {
      for (const [filled, zone] of zones[edge]) if (filled) copyRect(copied, out, width, zone);
    }
  }
  return encode(out, width, height);
}
