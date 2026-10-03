// ---------------------------------------------------------------------------
// The transform icon glyphs (TODO 5.1a; design 2026-10-02 §2.1, frames.md
// §1.4 / §4.6): which glyph each icon FAMILY prints on each face — the icon
// rider's key (`/frames/dfcicon/<glyph>.png`; scripts/lib/cc-frames.mjs
// DFC_ICON_FILES, lowercase like every frames-bucket key; a unit test holds
// the two lists together). The arrows' ▼ is baked into the ▼-right back's
// master (m15dfcback), so `downarrow` is published but drawn by no wave-1
// body — a left well never prints a ▼. The walker families' `spark` /
// `planeswalker` ship with the walker bodies (5.13).
//
// Import-free (types only): lib/cards/anatomy.ts resolves the rider from it
// and lib/cards/dfc.ts re-exports it — dfc.ts reaches the preview's
// frame-layer, which reaches anatomy.ts, so the map lives below both.
// ---------------------------------------------------------------------------

import type { DfcIconFamily } from "@/types/card";

/** A face's role on a double-faced card (FrameProfile.dfc.role). */
export type DfcIconRole = "front" | "back";

export const DFC_ICON_GLYPHS: Readonly<Record<DfcIconFamily, Readonly<Record<DfcIconRole, string>>>> = {
  arrows: { front: "default", back: "downarrow" },
  sunmoon: { front: "sun", back: "moon" },
  moon: { front: "fullmoon", back: "emrakul" },
  compass: { front: "compass", back: "land" },
  fan: { front: "fanclosed", back: "fanopen" },
};

/** Every glyph the riders publish, in the importer's order. */
export const DFC_ICON_GLYPH_KEYS = [
  "default", "downarrow", "sun", "moon", "fullmoon", "emrakul", "compass", "land", "spark", "planeswalker", "fanclosed", "fanopen",
] as const;

/** The rider key a face draws: the family's glyph for the face's role. */
export function dfcIconGlyph(family: DfcIconFamily, role: DfcIconRole): string {
  return DFC_ICON_GLYPHS[family][role];
}
