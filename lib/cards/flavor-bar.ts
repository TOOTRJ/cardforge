import { RULES_TEXT } from "@/lib/cards/typography";

// ---------------------------------------------------------------------------
// The flavor bar (layout v74, TODO 3.19): the line between a card's rules
// and its flavor text, as the prints draw it — ≈ 0.2 % of the card's height
// (RULES_TEXT.flavorBarPx: 4 HD px, 2 at the 750 px bake), 96 % of the text
// column, centred, its ends faded (DOM #33, M19 #38; Card Conjurer's
// `bar.png`). Until v74 both renderers drew a 1 px line across the whole
// column — a CSS px in the preview (0.2 % of a 750 px card) but ONE px of the
// 1500 px HD bake (0.05 %), so the stored PNG's bar was a quarter of the
// preview's.
//
// ONE picture for both renderers: an inline SVG `data:` URL (the station
// art's pattern, lib/cards/station-art.ts) — a linear gradient of the rules
// ink, transparent at both ends, RULES_TEXT.flavorBarOpacity in the middle,
// on the bar's own px box (rules-layout.ts placement `bar`; the preview draws
// the HD box's px in cqw, the bake its target's). Pure and isomorphic.
// ---------------------------------------------------------------------------

const cache = new Map<string, string>();

/** The bar's picture, `widthPx` × `heightPx` (its box at the target that
 *  draws it), in the rules text's colour `colorHex`. */
export function flavorBarArt(colorHex: string, widthPx: number, heightPx: number): string {
  const key = `${colorHex}/${widthPx}/${heightPx}`;
  let url = cache.get(key);
  if (!url) {
    const fade = RULES_TEXT.flavorBarFade;
    const opacity = RULES_TEXT.flavorBarOpacity;
    const stop = (offset: number, a: number) => `<stop offset="${offset}" stop-color="${colorHex}" stop-opacity="${a}"/>`;
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${heightPx}" viewBox="0 0 ${widthPx} ${heightPx}">` +
      `<defs><linearGradient id="b" x1="0" y1="0" x2="1" y2="0">` +
      `${stop(0, 0)}${stop(fade, opacity)}${stop(1 - fade, opacity)}${stop(1, 0)}` +
      `</linearGradient></defs>` +
      `<rect x="0" y="0" width="${widthPx}" height="${heightPx}" fill="url(#b)"/></svg>`;
    url = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
    cache.set(key, url);
  }
  return url;
}

/** Whether a URL is a flavor bar's picture — as flavorBarArt writes it, or
 *  as Satori re-encodes it (base64) in its SVG, where the no-clip tests
 *  find it by this. */
export function isFlavorBarArt(url: string): boolean {
  const svg = url.startsWith("data:image/svg+xml;utf8,")
    ? decodeURIComponent(url.slice("data:image/svg+xml;utf8,".length))
    : url.startsWith("data:image/svg+xml;base64,")
      ? atob(url.slice("data:image/svg+xml;base64,".length))
      : "";
  return svg.includes('<linearGradient id="b" x1="0" y1="0" x2="1" y2="0">');
}
