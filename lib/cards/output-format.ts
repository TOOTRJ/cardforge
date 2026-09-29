import { z } from "zod";
import type { CardCorners } from "@/lib/cards/output-corners";

// ---------------------------------------------------------------------------
// The FILE TYPE of a card image download (TODO 6.18). The corner choice is
// lib/cards/output-corners.ts; this is the format.
//
//   "png"  — what /api/cards/[id]/png always served, with either corner.
//            The default: a request that names no (or an unknown) `format`
//            gets exactly the PNG it always got.
//   "jpeg" — the SQUARE card, always: JPEG has no alpha, so the corners are
//            the Square PNG's (the border's colour, lib/frames/square-
//            corners.ts), then encoded at lib/render/card-jpeg.ts's settings
//            (quality 92, sRGB, no metadata). `corners` is ignored.
//
// The same tier rules as the PNG: a free viewer's JPEG is the stored
// watermarked bake (or, where that can't be squared, a live render), a paid
// viewer's a live clean render. Shared by the route and the download modal
// (client-safe), so the link, the file name and the served bytes agree.
// ---------------------------------------------------------------------------

export const CARD_IMAGE_FORMATS = ["png", "jpeg"] as const;
export type CardImageFormat = (typeof CARD_IMAGE_FORMATS)[number];

/** What the png route serves when the request names no (or an unknown)
 *  `format`. */
export const API_DEFAULT_IMAGE_FORMAT: CardImageFormat = "png";

const formatParam = z.enum(CARD_IMAGE_FORMATS);

/** The png route's `format` query value → the file type it serves. */
export function parseFormatParam(value: string | null | undefined): CardImageFormat {
  const parsed = formatParam.safeParse(value);
  return parsed.success ? parsed.data : API_DEFAULT_IMAGE_FORMAT;
}

/** The corner a download of `format` actually has: a JPEG is always square. */
export function effectiveCorners(format: CardImageFormat, corners: CardCorners): CardCorners {
  return format === "jpeg" ? "square" : corners;
}

/** A card's JPEG download URL (always square, so no `corners`). */
export function cardJpegHref(cardId: string, opts: { preset: "hd" | "default" }): string {
  return `/api/cards/${cardId}/png?preset=${opts.preset}&format=jpeg`;
}

/** The saved file's name: `<slug>.png`, `<slug>-square.png` (both PNG corners
 *  can sit side by side) or `<slug>.jpg`. The route's Content-Disposition
 *  and the modal's `download` attribute both come from here. */
export function cardImageFilename(
  slug: string,
  opts: { format: CardImageFormat; corners: CardCorners },
): string {
  if (opts.format === "jpeg") return `${slug}.jpg`;
  return opts.corners === "square" ? `${slug}-square.png` : `${slug}.png`;
}
