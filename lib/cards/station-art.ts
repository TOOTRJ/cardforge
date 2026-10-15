import { STATION, STATION_COLOURS, type StationKey } from "@/lib/cards/station";

// ---------------------------------------------------------------------------
// The station frame's DRAWN pieces (TODO 4.27a): the tier band, the charge
// badge and the P/T plate — PipGlyph's own art, inline SVG `data:` URLs built
// from the numbers measured on the prints (lib/cards/station.ts). The SAME
// string is the preview's <img>, the bake's <img> and both finish masks'
// overlay (the white border's pattern, lib/cards/white-border.ts): no bucket
// object, nothing for frameAssetPathsFor() to warm, nothing to promote.
//
// Pure and isomorphic (no Buffer): solid fills and simple gradients only —
// what a browser and resvg rasterise alike — on whole HD px; every piece is
// drawn at an even HD box, so it lands on whole px at the 750 px target too.
//
// The bevel (owner round 54, decision 3 — the one drawing round inside the
// build): the prints' ring and rim are lit from above (a lighter upper edge,
// a darker lower one, a thin dark seam against the face) and the dark face
// has a soft lighter middle. PR 2 (owner round 55, decision 1) keeps that
// shape and darkens it toward print: the ring's mean is the printed ring's
// tone (STATION_COLOURS.rim), the highlight and the shade half as strong —
// print's ring is nearly flat. `flat` is kept for the review sheet's
// print / flat / bevelled comparison and for nothing else.
// ---------------------------------------------------------------------------

export type StationArtStyle = "bevel" | "flat";

const svgUrl = (svg: string) => `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
const rgb = (c: readonly number[], gain = 1) => `rgb(${c.map((v) => clamp(v * gain)).join(",")})`;
const toward = (c: readonly number[], to: number, t: number) => c.map((v) => v + (to - v) * t);

/** A crowned twin's suffix (lib/cards/frame-reference-registry.ts
 *  LEGENDARY_MASTER_SUFFIX; this module stays import-light). */
const LEGENDARY_SUFFIX = "-legendary";

/** The colours of a master key — any key the table doesn't know (an
 *  artifact "a", a land "l") reads as colourless. A crowned twin's key
 *  ("m-legendary": the borderless dress, FrameProfile.crownMasters) is its
 *  colour's. */
export function stationColours(key: string) {
  const colour = key.endsWith(LEGENDARY_SUFFIX) ? key.slice(0, -LEGENDARY_SUFFIX.length) : key;
  return STATION_COLOURS[(colour in STATION_COLOURS ? colour : "c") as StationKey];
}

const cache = new Map<string, string>();
function cached(id: string, build: () => string): string {
  let url = cache.get(id);
  if (!url) {
    url = svgUrl(build());
    cache.set(id, url);
  }
  return url;
}

/** One tier's wash: a flat rect of the key's colour at the tier's opacity
 *  (0.25 / 0.57 / 0.78 — owner round 54). No edge, no line, no gradient. */
export function stationBandArt(key: string, tierIndex: number): string {
  const opacity = STATION.tierOpacity[Math.min(Math.max(tierIndex, 0), STATION.tierOpacity.length - 1)]!;
  return cached(`band/${key}/${opacity}`, () => {
    const fill = rgb(stationColours(key).tier);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 8 8" preserveAspectRatio="none"><rect width="8" height="8" fill="${fill}" fill-opacity="${opacity}"/></svg>`;
  });
}

/** The dark face both pieces share: a soft lighter middle, darker rim. */
const FACE = { mid: [58, 55, 55], edge: [30, 28, 28], seam: [14, 12, 12], flat: [41, 39, 39] } as const;

/** The charge badge: a dark disc (r 50) in a 10 px ring of the pinline's
 *  colour (to r 60). 120 × 120 at HD. */
export function stationBadgeArt(key: string, style: StationArtStyle = "bevel"): string {
  return cached(`badge/${key}/${style}`, () => {
    const rim = stationColours(key).rim;
    const { rFill, rRing } = STATION.badge;
    const s = rRing * 2;
    const c = rRing;
    const open = `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">`;
    if (style === "flat") {
      return `${open}<circle cx="${c}" cy="${c}" r="${rRing}" fill="${rgb(rim)}"/><circle cx="${c}" cy="${c}" r="${rFill}" fill="${rgb(FACE.flat)}"/></svg>`;
    }
    return (
      open +
      `<defs>` +
      `<linearGradient id="r" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${rgb(toward(rim, 255, 0.14))}"/><stop offset="0.5" stop-color="${rgb(rim)}"/><stop offset="1" stop-color="${rgb(rim, 0.84)}"/></linearGradient>` +
      `<linearGradient id="h" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${rgb(toward(rim, 255, 0.34))}"/><stop offset="0.55" stop-color="${rgb(toward(rim, 255, 0.06))}"/><stop offset="1" stop-color="${rgb(rim, 0.94)}"/></linearGradient>` +
      `<radialGradient id="f" cx="0.5" cy="0.46" r="0.56"><stop offset="0" stop-color="${rgb(FACE.mid)}"/><stop offset="0.7" stop-color="${rgb(FACE.flat)}"/><stop offset="1" stop-color="${rgb(FACE.edge)}"/></radialGradient>` +
      `</defs>` +
      `<circle cx="${c}" cy="${c}" r="${rRing}" fill="${rgb(rim, 0.5)}"/>` +
      `<circle cx="${c}" cy="${c}" r="${rRing - 1}" fill="url(#r)"/>` +
      `<circle cx="${c}" cy="${c}" r="${rRing - 3.5}" fill="none" stroke="url(#h)" stroke-width="3"/>` +
      `<circle cx="${c}" cy="${c}" r="${rFill + 1.5}" fill="${rgb(FACE.seam)}"/>` +
      `<circle cx="${c}" cy="${c}" r="${rFill}" fill="url(#f)"/>` +
      `</svg>`
    );
  });
}

/** The P/T plate: a dark face inside a 14 px rim of the pinline's colour,
 *  its two ends arcs (sagitta 15 px). STATION.plate.outerW × outerH at HD. */
export function stationPlateArt(key: string, style: StationArtStyle = "bevel"): string {
  return cached(`plate/${key}/${style}`, () => {
    const rim = stationColours(key).rim;
    const { outerW: w, outerH: h, rim: t, endSagitta } = STATION.plate;
    const shape = (inset: number) => {
      const x0 = inset;
      const x1 = w - inset;
      const y0 = inset;
      const y1 = h - inset;
      const half = (y1 - y0) / 2;
      const sag = Math.max(2, endSagitta - inset * 0.35);
      const r = (half * half + sag * sag) / (2 * sag);
      return `M ${x0 + sag} ${y0} L ${x1 - sag} ${y0} A ${r} ${r} 0 0 1 ${x1 - sag} ${y1} L ${x0 + sag} ${y1} A ${r} ${r} 0 0 1 ${x0 + sag} ${y0} Z`;
    };
    const open = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`;
    if (style === "flat") {
      return `${open}<path d="${shape(0)}" fill="${rgb(rim)}"/><path d="${shape(t)}" fill="${rgb(FACE.flat)}"/></svg>`;
    }
    return (
      open +
      `<defs>` +
      `<linearGradient id="r" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${rgb(toward(rim, 255, 0.14))}"/><stop offset="0.5" stop-color="${rgb(rim)}"/><stop offset="1" stop-color="${rgb(rim, 0.84)}"/></linearGradient>` +
      `<linearGradient id="h" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${rgb(toward(rim, 255, 0.34))}"/><stop offset="0.55" stop-color="${rgb(toward(rim, 255, 0.06))}"/><stop offset="1" stop-color="${rgb(rim, 0.94)}"/></linearGradient>` +
      `<radialGradient id="f" cx="0.5" cy="0.5" r="0.62"><stop offset="0" stop-color="${rgb(FACE.mid)}"/><stop offset="0.65" stop-color="${rgb(FACE.flat)}"/><stop offset="1" stop-color="${rgb(FACE.edge)}"/></radialGradient>` +
      `</defs>` +
      `<path d="${shape(0)}" fill="${rgb(rim, 0.5)}"/>` +
      `<path d="${shape(1)}" fill="url(#r)"/>` +
      `<path d="${shape(5)}" fill="none" stroke="url(#h)" stroke-width="4"/>` +
      `<path d="${shape(t - 1.5)}" fill="${rgb(FACE.seam)}"/>` +
      `<path d="${shape(t)}" fill="url(#f)"/>` +
      `</svg>`
    );
  });
}
