import type { CSSProperties } from "react";
import type { FrameProfile, Rect } from "@/lib/cards/template-layout";
import { underFrameArtRect } from "@/lib/cards/template-layout";

// ---------------------------------------------------------------------------
// Foil finish — ONE inline SVG shared by the live preview
// (components/cards/card-preview.tsx) and the Satori bake
// (lib/render/card-image.tsx), the same way the etched finish is
// (lib/cards/etched-finish.tsx): parity by construction.
//
// The old treatment never reached a saved image: the bake's overlay was a
// div with `inset: 0` (Satori ignores inset → a zero-size box) and
// `mixBlendMode` (never emitted by Satori), so a foil bake was byte-identical
// to a regular one, while the preview spun a blend-mode conic gradient.
//
// A traditional foil is printed on a metallised sheet: the rainbow shows
// through wherever the ink is thin (white/pale areas, light parts of the
// art) and is swallowed by heavy ink (the black border, dark art, the text).
// No blend modes are available in the bake, so that behaviour is built from
// a LUMINANCE MASK instead: the mask redraws what the card shows under the
// text — the art layers (window art, see-through under-frame art, a split's
// second window) with the exact object-fit: cover + focal + scale geometry
// both renderers use, then the frame image on top — and a holographic
// rainbow + a soft specular glint are painted through it. So the sheen is
// strongest on light areas, absent on black, and follows the art.
//
// Stacking: directly above the frame (preview z-6, bake right after the
// frame <img>), below every text/pip/stat layer — on a real foil the ink
// sits on top of the foil, so the text stays exactly as crisp and dark as on
// a regular card.
//
// SVG <mask> is luminance by default in Chromium, librsvg (what next/og
// rasterises with when sharp is installed — the Node bake) and resvg (its
// fallback), so no mask-type property is needed. Satori rules this
// respects: numeric width/height on the <svg> (the preview passes "100%"),
// camelCase SVG props, `href` on <image>, no CSS classes, no Fragments, no
// inset, no blend modes.
//
// Geometry is in the HD card's pixel space (1500×2100, or 2100×1500 for the
// landscape Battle frame) and the SVG stretches to the card.
// ---------------------------------------------------------------------------

/** An image the foil mask redraws. `href` is what the MASK draws (the bake
 *  hands it a small downscaled copy of the art — the mask only needs its
 *  luminance, and the full art inlined twice would push the SVG towards
 *  librsvg's 10 MB attribute limit); `naturalWidth`/`naturalHeight` are the
 *  intrinsic size of the image the card's own art layer draws, which is what
 *  object-fit: cover is computed from. */
export type FoilArtSource = {
  href: string;
  naturalWidth: number;
  naturalHeight: number;
};

export type FoilArtLayer = FoilArtSource & {
  rect: Rect;
  /** Focal point 0–1 (object-position + transform-origin). */
  focalX: number;
  focalY: number;
  /** CSS transform scale around the focal point. */
  scale: number;
  /** Degrees, around the rect's centre (a split's second window). */
  rotation: number;
};

type ArtPosition = { focalX?: number; focalY?: number; scale?: number } | null | undefined;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * The art layers a face draws UNDER its frame, in paint order, exactly as
 * both renderers place them: see-through frames' under-frame art (cover at
 * the focal point, scale 1), the art window (cover + focal + scale), and a
 * split's second window (rotated with its face). A missing source (art not
 * loaded yet in the preview, an unresolvable URL in the bake) just drops its
 * layer — the foil then follows the frame alone there.
 */
export function foilArtLayers({
  layout,
  colorKey,
  art,
  artPosition,
  secondArt,
  secondArtPosition,
}: {
  layout: FrameProfile;
  colorKey: string;
  art: FoilArtSource | null;
  artPosition: ArtPosition;
  secondArt?: FoilArtSource | null;
  secondArtPosition?: ArtPosition;
}): FoilArtLayer[] {
  const layers: FoilArtLayer[] = [];
  const focalX = clamp(artPosition?.focalX ?? 0.5, 0, 1);
  const focalY = clamp(artPosition?.focalY ?? 0.5, 0, 1);
  if (art) {
    const under = underFrameArtRect(layout, colorKey);
    if (under) layers.push({ ...art, rect: under, focalX, focalY, scale: 1, rotation: 0 });
    layers.push({
      ...art,
      rect: layout.artSlot,
      focalX,
      focalY,
      scale: clamp(artPosition?.scale ?? 1, 0.5, 4),
      rotation: 0,
    });
  }
  const second = layout.secondFace;
  if (secondArt && second?.artSlot) {
    layers.push({
      ...secondArt,
      rect: second.artSlot,
      focalX: clamp(secondArtPosition?.focalX ?? 0.5, 0, 1),
      focalY: clamp(secondArtPosition?.focalY ?? 0.5, 0, 1),
      scale: clamp(secondArtPosition?.scale ?? 1, 0.5, 4),
      rotation: second.rotation,
    });
  }
  return layers;
}

/** Round to 1/100 px so the markup is stable and compact. */
const r2 = (v: number) => Math.round(v * 100) / 100;

/**
 * object-fit: cover + object-position focal% + transform: scale(s) with
 * transform-origin focal% — the CSS both renderers apply to an art <img>
 * filling `box` — as an SVG <image> box + transform. Satori's cover math
 * (x = left + p·(boxW − drawnW)) is the CSS spec's.
 */
export function coverPlacement(
  box: { x: number; y: number; width: number; height: number },
  natural: { width: number; height: number },
  focalX: number,
  focalY: number,
  scale: number,
) {
  const s0 = Math.max(box.width / natural.width, box.height / natural.height);
  const width = natural.width * s0;
  const height = natural.height * s0;
  const x = box.x + focalX * (box.width - width);
  const y = box.y + focalY * (box.height - height);
  const ox = box.x + focalX * box.width;
  const oy = box.y + focalY * box.height;
  return {
    x,
    y,
    width,
    height,
    /** scale(s) about (ox, oy) — identity when s = 1. */
    transform: scale === 1 ? undefined : `matrix(${scale} 0 0 ${scale} ${r2(ox * (1 - scale))} ${r2(oy * (1 - scale))})`,
  };
}

// The holographic ramp: a pastel-saturated hue cycle along the card
// diagonal (about 1.6 cycles corner to corner), its opacity breathing so
// the bands read as interference rather than a flat wash.
// Peak opacity 0.27 on pure white (the mask scales it down with lightness):
// a pale text box turns a clear pastel rainbow while black text on it keeps
// its contrast (text is drawn above the foil anyway).
const RAINBOW: ReadonlyArray<readonly [offset: number, color: string, opacity: number]> = [
  [0, "#ff6f9c", 0.27],
  [0.08, "#ffb067", 0.21],
  [0.16, "#ffe86a", 0.27],
  [0.25, "#86f2a0", 0.2],
  [0.34, "#62dcff", 0.27],
  [0.43, "#8a8cff", 0.21],
  [0.52, "#dc84ff", 0.27],
  [0.61, "#ff6f9c", 0.2],
  [0.7, "#ffb067", 0.27],
  [0.79, "#ffe86a", 0.21],
  [0.88, "#86f2a0", 0.27],
  [1, "#62dcff", 0.21],
];

// Specular glint: a soft white band across the upper third plus a fainter
// echo low on the card, like a light source catching the sheet.
const GLINT: ReadonlyArray<readonly [offset: number, opacity: number]> = [
  [0, 0],
  [0.22, 0],
  [0.33, 0.2],
  [0.44, 0],
  [0.68, 0],
  [0.75, 0.09],
  [0.82, 0],
  [1, 0],
];

export function FoilSheen({
  id,
  frameHref,
  art = [],
  region,
  landscape = false,
  width,
  height,
  style,
}: {
  /** Unique per rendered instance (SVG ids are document-global). */
  id: string;
  /** The SAME image the face draws on top of the art: the frame (the bake's
   *  PNG data URL, the preview's WebP URL — the frames bucket sends ACAO *),
   *  or, with `region`, a P/T / loyalty plate. */
  frameHref: string;
  /** From foilArtLayers(). */
  art?: FoilArtLayer[];
  /** Draw only this part of the card (the plates, which sit above the text
   *  layers): the SVG covers `region`, `frameHref` fills it, and the
   *  rainbow keeps its card-space position, so the plate's sheen continues
   *  the card's. The caller positions the SVG on that box. */
  region?: Rect;
  landscape?: boolean;
  width: number | string;
  height: number | string;
  style?: CSSProperties;
}) {
  const vw = landscape ? 2100 : 1500;
  const vh = landscape ? 1500 : 2100;
  const pct = (rect: Rect) => ({
    x: (rect.leftPct / 100) * vw,
    y: (rect.topPct / 100) * vh,
    width: (rect.widthPct / 100) * vw,
    height: (rect.heightPct / 100) * vh,
  });
  const box = region ? pct(region) : null;
  const view = box
    ? { x: r2(box.x), y: r2(box.y), width: r2(box.width), height: r2(box.height) }
    : { x: 0, y: 0, width: vw, height: vh };
  return (
    <svg
      viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`}
      width={width}
      height={height}
      preserveAspectRatio="none"
      aria-hidden
      style={{ position: "absolute", top: 0, left: 0, ...style }}
    >
      <defs>
        {art.map((layer, i) => {
          const box = pct(layer.rect);
          return (
            <clipPath key={i} id={`${id}-clip${i}`} clipPathUnits="userSpaceOnUse">
              <rect x={r2(box.x)} y={r2(box.y)} width={r2(box.width)} height={r2(box.height)} />
            </clipPath>
          );
        })}
        <linearGradient id={`${id}-holo`} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2={vw} y2={vh}>
          {RAINBOW.map(([offset, color, opacity]) => (
            <stop key={offset} offset={offset} stopColor={color} stopOpacity={opacity} />
          ))}
        </linearGradient>
        <linearGradient id={`${id}-glint`} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2={vw} y2={vh}>
          {GLINT.map(([offset, opacity]) => (
            <stop key={offset} offset={offset} stopColor="#ffffff" stopOpacity={opacity} />
          ))}
        </linearGradient>
        <mask id={`${id}-lum`} maskUnits="userSpaceOnUse" x={view.x} y={view.y} width={view.width} height={view.height}>
          {art.map((layer, i) => {
            const box = pct(layer.rect);
            const place = coverPlacement(
              box,
              { width: layer.naturalWidth, height: layer.naturalHeight },
              layer.focalX,
              layer.focalY,
              layer.scale,
            );
            return (
              // Satori serialises every prop it is given (an undefined one
              // becomes transform="undefined"), so optional attributes are
              // spread in only when present.
              <g
                key={i}
                {...(layer.rotation
                  ? { transform: `rotate(${layer.rotation} ${r2(box.x + box.width / 2)} ${r2(box.y + box.height / 2)})` }
                  : {})}
              >
                <g clipPath={`url(#${id}-clip${i})`}>
                  <image
                    href={layer.href}
                    x={r2(place.x)}
                    y={r2(place.y)}
                    width={r2(place.width)}
                    height={r2(place.height)}
                    preserveAspectRatio="none"
                    {...(place.transform ? { transform: place.transform } : {})}
                  />
                </g>
              </g>
            );
          })}
          <image
            href={frameHref}
            x={view.x}
            y={view.y}
            width={view.width}
            height={view.height}
            preserveAspectRatio="none"
          />
        </mask>
      </defs>
      <g mask={`url(#${id}-lum)`}>
        <rect x={view.x} y={view.y} width={view.width} height={view.height} fill={`url(#${id}-holo)`} />
        <rect x={view.x} y={view.y} width={view.width} height={view.height} fill={`url(#${id}-glint)`} />
      </g>
    </svg>
  );
}
