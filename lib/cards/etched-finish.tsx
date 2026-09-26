import type { CSSProperties } from "react";

// ---------------------------------------------------------------------------
// Etched finish — ONE inline SVG shared by the live preview
// (components/cards/card-preview.tsx) and the Satori bake
// (lib/render/card-image.tsx), so both draw the same markup: parity by
// construction, not by keeping two CSS approximations in step.
//
// Real foil-etched cards (Commander Legends, Double Masters 2022, Modern
// Horizons 2 retro) keep the plain black border and the art untouched and
// give the FRAME a fine metallic etched texture — there is no inset gold
// outline. So: a fine white cross-hatch plus a soft diagonal sheen, masked by
// the frame PNG's own LUMINANCE:
//   * black border (luminance 0)      → untouched
//   * art window (alpha 0)            → untouched
//   * pale text box / title bars      → white-on-pale, barely visible
//   * the coloured rim + bars' metal  → the etched sheen
// SVG <mask> is luminance by default in Chromium, librsvg (what next/og
// rasterises with through sharp in the Node bake) and resvg (its fallback),
// so no mask-mode / mask-type property is needed anywhere.
//
// Geometry is in the HD card's pixel space (1500×2100, or 2100×1500 for the
// landscape Battle frame) and the SVG stretches to the card, so the pattern
// period is a fixed fraction of the card at every size.
//
// Satori rules this respects: numeric width/height on the <svg> (the preview
// passes "100%"), camelCase SVG props, `href` on <image>, no CSS classes.
// ---------------------------------------------------------------------------

/** Pattern period in HD px: 18 / 1500 = 1.2 % of the card width. */
const ETCH_PERIOD = 18;
/** Hairline width in HD px (0.1 % of the card width). */
const ETCH_STROKE = 1.5;
/** A split frame's left half runs this far past the seam, under the right
 *  half: 2 viewBox units (2 px at HD, 1 px at the 750 px default bake). It
 *  plays the same role as FrameLayer's FRAME_SPLIT_OVERLAP_PX — a fractional
 *  seam never dips the mask — without being the same value. */
const SPLIT_OVERLAP = 2;

export function EtchedSheen({
  id,
  frameHref,
  landscape = false,
  width,
  height,
  style,
  split = null,
}: {
  /** Unique per rendered face — the preview can show several cards (and a
   *  DFC renders two faces), and SVG ids are document-global. */
  id: string;
  /** The SAME frame image the face draws: the bake's PNG data URL, the
   *  preview's frame URL (WebP; the frames bucket sends ACAO *). For a
   *  two-colour split frame, the LEFT colour's image. */
  frameHref: string;
  landscape?: boolean;
  width: number | string;
  height: number | string;
  style?: CSSProperties;
  /** A two-colour split frame (frameSplitFor): the right colour's image and
   *  the seam (% of the card's width). The mask then holds `frameHref` left
   *  of the seam and this image right of it — exactly the frame the face
   *  painted, so the sheen follows each half's own wings. */
  split?: { href: string; atPct: number } | null;
}) {
  const vw = landscape ? 2100 : 1500;
  const vh = landscape ? 1500 : 2100;
  const seamX = split ? (vw * split.atPct) / 100 : 0;
  const p = ETCH_PERIOD;
  const h = p / 2;
  // Two diagonals per tile, each continued across the tile edges so the
  // repeat is seamless (both renderers clip the tile to its box).
  const rising = `M${-h} ${h}L${h} ${-h}M0 ${p}L${p} 0M${h} ${p + h}L${p + h} ${h}`;
  const falling = `M${-h} ${h}L${h} ${p + h}M0 0L${p} ${p}M${h} ${-h}L${p + h} ${h}`;
  return (
    <svg
      viewBox={`0 0 ${vw} ${vh}`}
      width={width}
      height={height}
      preserveAspectRatio="none"
      aria-hidden
      style={{ position: "absolute", top: 0, left: 0, ...style }}
    >
      <defs>
        <pattern id={`${id}-hatch`} width={p} height={p} patternUnits="userSpaceOnUse">
          <path d={rising} stroke="#ffffff" strokeOpacity={0.3} strokeWidth={ETCH_STROKE} fill="none" />
          <path d={falling} stroke="#ffffff" strokeOpacity={0.18} strokeWidth={ETCH_STROKE} fill="none" />
        </pattern>
        <linearGradient id={`${id}-sheen`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity={0} />
          <stop offset="0.38" stopColor="#ffffff" stopOpacity={0.06} />
          <stop offset="0.5" stopColor="#ffffff" stopOpacity={0.2} />
          <stop offset="0.62" stopColor="#ffffff" stopOpacity={0.06} />
          <stop offset="1" stopColor="#ffffff" stopOpacity={0} />
        </linearGradient>
        {split ? (
          <clipPath id={`${id}-left`}>
            <rect x="0" y="0" width={seamX + SPLIT_OVERLAP} height={vh} />
          </clipPath>
        ) : null}
        {split ? (
          <clipPath id={`${id}-right`}>
            <rect x={seamX} y="0" width={vw - seamX} height={vh} />
          </clipPath>
        ) : null}
        <mask id={`${id}-frame`} maskUnits="userSpaceOnUse" x="0" y="0" width={vw} height={vh}>
          {split ? (
            <image
              href={frameHref}
              x="0"
              y="0"
              width={vw}
              height={vh}
              preserveAspectRatio="none"
              clipPath={`url(#${id}-left)`}
            />
          ) : (
            <image href={frameHref} x="0" y="0" width={vw} height={vh} preserveAspectRatio="none" />
          )}
          {split ? (
            <image
              href={split.href}
              x="0"
              y="0"
              width={vw}
              height={vh}
              preserveAspectRatio="none"
              clipPath={`url(#${id}-right)`}
            />
          ) : null}
        </mask>
      </defs>
      <g mask={`url(#${id}-frame)`}>
        <rect x="0" y="0" width={vw} height={vh} fill={`url(#${id}-hatch)`} />
        <rect x="0" y="0" width={vw} height={vh} fill={`url(#${id}-sheen)`} />
      </g>
    </svg>
  );
}
