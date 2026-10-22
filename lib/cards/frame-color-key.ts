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

/**
 * True when a card's frame paints its PLAIN LAND master instead of its gold
 * one (TODO 4.11, owner 2026-10-22; FrameStyle.plainLandMaster): the frame
 * declares the stand-in (FrameProfile.plainLandStandIn — the Expeditions),
 * the card's frame_style names it, and the card's colour key is gold — a
 * card recoloured to one colour, or colourless, paints its own master
 * whatever the stored key says. The ONE test the renderers
 * (components/cards/frame-layer.tsx frameMasterKey) and the gate
 * (frameGateColors) read.
 */
export function plainLandMasterDrawn(
  profile: { plainLandStandIn?: true },
  frameStyle: { plainLandMaster?: true } | null | undefined,
  colors: readonly ColorIdentity[] | null | undefined,
): boolean {
  return profile.plainLandStandIn === true && frameStyle?.plainLandMaster === true && pickFrameColorKey(colors) === "m";
}
