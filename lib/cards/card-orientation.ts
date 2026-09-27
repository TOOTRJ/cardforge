import { normalizeFrameTemplate } from "@/lib/cards/card-display";
import { getFrameProfile } from "@/lib/cards/template-layout";

// ---------------------------------------------------------------------------
// Which way up a saved card's box is, and the display corner class for it
// (TODO 3.26). Pure and client-safe — display surfaces (tiles, the render-
// update compare view, the creator's overlays, the marketing strips) import
// it; the Satori renderer keeps its own isLandscapeTemplate beside the bake.
//
// The corner classes live in app/globals.css (the CSS twin of
// lib/cards/card-corner.ts): `.card-corners` is circular ONLY on a 5:7 box
// and `.card-corners-landscape` only on a 7:5 box. A percentage radius on
// any other box draws an ellipse, so only put these on an exact card box.
// ---------------------------------------------------------------------------

/** True for a frame whose card is 7:5 (Battle, Split), from a `frame_style`
 *  column or any object carrying `template`. Profile overrides never change
 *  a frame's orientation, so the base profile answers. */
export function isLandscapeFrame(frameStyle: unknown): boolean {
  const template =
    frameStyle && typeof frameStyle === "object" && "template" in frameStyle
      ? (frameStyle as { template?: unknown }).template
      : undefined;
  return (
    getFrameProfile(
      normalizeFrameTemplate(typeof template === "string" ? template : undefined),
    ).orientation === "landscape"
  );
}

/** The corner class for an exact card box: 5:7 portrait or 7:5 landscape. */
export function cardCornersClass(
  landscape: boolean,
): "card-corners" | "card-corners-landscape" {
  return landscape ? "card-corners-landscape" : "card-corners";
}
