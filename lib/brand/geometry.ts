// ---------------------------------------------------------------------------
// The Astral Rose — PipGlyph's mark. A compass rose become astrolabe:
// graduation ticks for the craft of measurement, a violet plane riding the
// ring (the walk between worlds), a wake of three stars behind it, and a
// cut gem at the heart. One 32-unit grid drives every render: the web logo,
// the favicon, Satori OG art, and the static exports in public/brand.
//
// Dependency-free, erasable-syntax-only (see constants.ts for why).
// ---------------------------------------------------------------------------

export const MARK_VIEWBOX = "0 0 32 32";

/** Seal ring the star arms sit inside (the astrolabe's mater). */
export const ROSE_RING = { cx: 16, cy: 16, r: 13.6 } as const;

/** Graduation ticks crossing the ring at the cardinals. */
export const ROSE_TICKS_PATH =
  "M16 1.4 V4.6 M27.4 16 H30.6 M16 27.4 V30.6 M1.4 16 H4.6";

/** Four-point quill-curved star (points r10.5, waist r4.2). */
export const ROSE_STAR_PATH =
  "M16 5.5 Q16.69 15.31 26.5 16 Q16.69 16.69 16 26.5 Q15.31 16.69 5.5 16 Q15.31 15.31 16 5.5 Z";

/** Cut-gem heart (outer diamond) and its bright facet (inner diamond). */
export const ROSE_GEM_PATH = "M16 12.4 L19.6 16 L16 19.6 L12.4 16 Z";
export const ROSE_GEM_FACET_PATH = "M16 13.9 L18.1 16 L16 18.1 L13.9 16 Z";

/** Star with the gem cut out — for one-color (mono) renders; use with
 *  fill-rule="evenodd". */
export const ROSE_STAR_CUT_PATH = `${ROSE_STAR_PATH} ${ROSE_GEM_PATH}`;

/** The violet plane in orbit on the ring (lower-right, 45°). */
export const ROSE_ORBIT_PIP = { cx: 25.62, cy: 25.62, r: 1.9 } as const;

/** Three-star wake trailing the orbit on the far side (upper-left). */
export const ROSE_WAKE = [
  { cx: 5.37, cy: 13.15, r: 0.7 },
  { cx: 6.99, cy: 9.69, r: 0.95 },
  { cx: 9.69, cy: 6.99, r: 1.2 },
] as const;
