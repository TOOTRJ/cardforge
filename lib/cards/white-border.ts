// ---------------------------------------------------------------------------
// The white border (TODO 4.30; era design 2026-10-06 §5, step E8) — the
// printed border of the core sets up to Ninth Edition (Fifth, Sixth and
// Seventh Edition, Anthologies, Battle Royale, Beatdown and Deckmasters on
// the 1997 frame; Eighth and Ninth Edition on the 2003 frame), as a per-card
// switch: FrameStyle.border "white" (absent = black, today's look).
//
// DRAWN, not an asset (decision D13): one inline SVG of two flat shapes over
// the frame master, the SAME bytes in the browser preview, the Satori bake
// and both finish masks —
//   • the WHITE over the master's black border, from the card's edge to the
//     frame box (FrameProfile.whiteBorder.insetPx: each master's own
//     measured box, never Card Conjurer's border mask — on the 8th pack it
//     sits on the frame's edge and erases the keyline);
//   • the black KEYLINE just inside it, `keylinePx` wide, over the frame's
//     outermost pixels. On the prints the white ends where the black border
//     of the same frame ends, and the keyline is printed inside that edge:
//     a 7ED / 8ED / 9ED card and its own black-bordered foil printing put
//     the frame's first light pixel on the same px, 3–4 px inside the white
//     (era-e8 proof, 2026-10-12: 36 prints on the 1997 frame, 18 on 2003).
//
// The white's colour is ONE value for every frame, #ececea: Scryfall's
// scans do not carry the print's white — every white-bordered scan has the
// same regenerated border (two templates, #ededef and #edecea, identical to
// two decimals across sets and years) — so this is the white a PipGlyph card
// is compared against, not a measurement of paper (ΔE 0.2 from the 8ED /
// 9ED template, 2.0 from the other). Off-white on purpose: a pure #ffffff border has no edge
// on a white page.
//
// Client-safe, no imports: lib/cards/template-layout.ts reads the slot type,
// and both renderers, the corner fills and the anatomy read the functions.
// ---------------------------------------------------------------------------

/** The white of a white-bordered card ON SCREEN — every display surface:
 *  the stored bake, its thumb, the OG image, the live preview and the plain
 *  PNG download (round or square). */
export const WHITE_BORDER_HEX = "#ececea";
/** …as the RGB a square corner fills with (lib/frames/square-corners.ts). */
export const WHITE_BORDER_RGB = [0xec, 0xec, 0xea] as const;
/** The white in a PRINT file (owner 2026-10-12): pure white. The printed
 *  cards' border was bare card stock, and a printer lays the screen's
 *  off-white down as a faint grey tint (16 % under paper white in
 *  luminance). Everything lib/render/card-print.ts makes — the PDF card and
 *  sheets, the bleed files, MakePlayingCards', 800 ppi, the Pro exports'
 *  `print=1` — draws the ring, squares its corners and extends its bleed in
 *  this one; nothing else does. The keyline is the same black in both. */
export const WHITE_BORDER_PRINT_HEX = "#ffffff";
export const WHITE_BORDER_PRINT_RGB = [0xff, 0xff, 0xff] as const;

/** Which white a render draws: `print` = a lib/render/card-print.ts file. */
export type WhiteBorderMedium = "screen" | "print";
export function whiteBorderHex(medium: WhiteBorderMedium = "screen"): string {
  return medium === "print" ? WHITE_BORDER_PRINT_HEX : WHITE_BORDER_HEX;
}
export function whiteBorderRgb(medium: WhiteBorderMedium = "screen"): readonly [number, number, number] {
  return medium === "print" ? WHITE_BORDER_PRINT_RGB : WHITE_BORDER_RGB;
}
/** The keyline between the white and the frame. */
export const WHITE_BORDER_KEYLINE_HEX = "#000000";

/** A template's white border (FrameProfile.whiteBorder), in the px of its
 *  1500 × 2100 master (2100 × 1500 on a landscape one). */
export type WhiteBorderSlot = {
  /** The master's black border on each edge: the white covers exactly it. */
  insetPx: { top: number; right: number; bottom: number; left: number };
  /** The keyline's width, drawn inside the white over the frame's edge. */
  keylinePx: number;
};

/** True when a frame style asks for the white border (the ONE render rule:
 *  exactly "white" — absent, "black" and anything else are the black one). */
export function wantsWhiteBorder(style: { border?: unknown } | null | undefined): boolean {
  return style?.border === "white";
}

/** The white border a card draws on a profile, or null: the profile declares
 *  the piece AND the card's switch says white. Both renderers, the finish
 *  masks, the square-corner fills and the creator read this. */
export function resolveWhiteBorder(
  profile: { whiteBorder?: WhiteBorderSlot },
  style: { border?: unknown } | null | undefined,
): WhiteBorderSlot | null {
  return profile.whiteBorder && wantsWhiteBorder(style) ? profile.whiteBorder : null;
}

/** The HD canvas of an orientation. */
function canvasOf(landscape: boolean): { w: number; h: number } {
  return landscape ? { w: 2100, h: 1500 } : { w: 1500, h: 2100 };
}

/** A rectangular ring as ONE even-odd path: the outer box, then the inner. */
function ring(outer: readonly [number, number, number, number], inner: readonly [number, number, number, number]): string {
  const box = ([x0, y0, x1, y1]: readonly [number, number, number, number]) => `M${x0} ${y0}H${x1}V${y1}H${x0}Z`;
  return box(outer) + box(inner);
}

/**
 * The border as an SVG document on the HD canvas: the white ring from the
 * card's edge to the frame box, and the keyline ring inside it. Stretched
 * over the whole card by both renderers (`preserveAspectRatio="none"`, like
 * the frame master), so it scales with the card at every size. The white
 * runs to the canvas edge: the bake's corner cut and the display clip round
 * it, a square output fills its corners with the same white
 * (squareCornerFillsOf) and a bleed copies it out. `medium` picks the white:
 * the screen's off-white, or a print file's pure white — the bytes are
 * today's for "screen".
 */
export function whiteBorderSvg(slot: WhiteBorderSlot, landscape = false, medium: WhiteBorderMedium = "screen"): string {
  const { w, h } = canvasOf(landscape);
  const { top, right, bottom, left } = slot.insetPx;
  const k = slot.keylinePx;
  const box = [left, top, w - right, h - bottom] as const;
  const inner = [left + k, top + k, w - right - k, h - bottom - k] as const;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" preserveAspectRatio="none">` +
    `<path fill="${whiteBorderHex(medium)}" fill-rule="evenodd" d="${ring([0, 0, w, h], box)}"/>` +
    `<path fill="${WHITE_BORDER_KEYLINE_HEX}" fill-rule="evenodd" d="${ring(box, inner)}"/>` +
    `</svg>`
  );
}

const cache = new Map<string, string>();

/** whiteBorderSvg as a data: URL — what an <img> and an SVG <image> take.
 *  Memoized by its text (a handful of values exist). */
export function whiteBorderDataUrl(slot: WhiteBorderSlot, landscape = false, medium: WhiteBorderMedium = "screen"): string {
  const svg = whiteBorderSvg(slot, landscape, medium);
  let url = cache.get(svg);
  if (!url) {
    url = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
    cache.set(svg, url);
  }
  return url;
}

/** The full-card rect the border image is stretched over. */
export const WHITE_BORDER_RECT = { topPct: 0, leftPct: 0, widthPct: 100, heightPct: 100 } as const;
