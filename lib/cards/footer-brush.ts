// ---------------------------------------------------------------------------
// The paintbrush before the artist on the 2003 frame (TODO 4.10b; era design
// 2026-10-06 §2.2) — FrameProfile.footerBrush. Eighth Edition → Journey into
// Nyx print a long brush (a thin handle rising to the right, a ferrule, a
// leaf of bristles ending in a point) left of the artist's name, in the
// line's ink. The MSE masters this frame used until 4.10b had it PAINTED IN
// (dark, so on the black frame and on lands only the brush showed); Card
// Conjurer's masters have none and its pack draws its own bitmap. Ours is a
// flat path of our own (the COLLECTOR_BRUSH_PATH pattern — that one is the
// M15 line's short leaf, another glyph), drawn identically by both
// renderers at the profile's rect, in the footer's ink on that master.
//
// Measured on the per-pixel median of 34 white prints (the brush is the
// same on every card): ink 118–227 × 1946–1969 px of the HD card. Client-
// safe, no imports.
// ---------------------------------------------------------------------------

/** The brush on a 110 × 24 box: the handle from its rounded end (bottom
 *  left) up to the ferrule's collar, the bristles to their point (top
 *  right). The ferrule's glint and the bristles' are holes: draw with
 *  fill-rule evenodd (both renderers do; Satori keeps it). */
export const FOOTER_BRUSH_VIEWBOX = "0 0 110 24";
export const FOOTER_BRUSH_PATH =
  "M3.2 15.6 L57 7.6 L58.5 5.6 L71 4 C76 0.9 91 0.2 100 1.3 L109.5 0.6 L104.2 6.8 C102 14 94 20.2 85 20.2 C78.5 20.2 74 17.4 71.5 14.4 " +
  "L59 13.6 L57.5 11.8 L5 22.6 C1.6 23.2 -0.3 20.4 0.5 18.2 C0.9 16.9 1.9 16 3.2 15.6 Z " +
  "M60.5 8.8 L69.5 7.5 L69.5 10 L60.5 11.1 Z " +
  "M76.5 6.2 C82 3.6 92 3.2 98.5 4.8 C94 8.8 84 10.6 77.5 9.8 Z";
