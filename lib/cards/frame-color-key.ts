import type { ColorIdentity } from "@/types/card";

// ---------------------------------------------------------------------------
// The frame colour key a colour identity paints — a leaf module (types only),
// so server code that only needs the pick (lib/cards/layout-version.ts's sweep
// scopes, read by API routes and the dashboard) doesn't pull the frame layer's
// URL resolver and the frame manifest in with it.
// components/cards/frame-layer.tsx re-exports both for everything else.
// ---------------------------------------------------------------------------

export const COLOR_KEY_LETTER: Record<ColorIdentity, string> = {
  white: "w",
  blue: "u",
  black: "b",
  red: "r",
  green: "g",
  colorless: "c",
  multicolor: "m",
};

/** One colour → its letter, none → "c", several → "m". */
export function pickFrameColorKey(
  colors: readonly ColorIdentity[] | null | undefined,
): string {
  if (!colors || colors.length === 0) return "c";
  if (colors.length > 1) return "m";
  return COLOR_KEY_LETTER[colors[0]] ?? "c";
}
