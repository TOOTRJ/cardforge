import "server-only";

import fs from "node:fs";
import path from "node:path";
import type { ReactNode } from "react";
import { pngImageResponse } from "@/lib/render/satori-png";

// ---------------------------------------------------------------------------
// `new ImageResponse(element, size)` for the Node-runtime OG images (deck,
// profile, challenge, article, the card social composite) — minus next/og's
// render-time fetches (TODO 6.16a). Those images print user text (deck and
// card titles, descriptions), and next/og answers any character its default
// font lacks from Twemoji on jsDelivr or Noto on fonts.googleapis.com, on
// every render. lib/render/satori-png.ts answers from disk instead.
//
// The face is next/og's own default — the Geist Regular file it ships and
// registers as "geist" — read from the same place, so these images keep
// their pixels and nothing extra is traced into the functions (Next already
// traces that file). tests/unit/render/satori-pipeline.test.ts fails if a
// Next upgrade moves it.
// ---------------------------------------------------------------------------

const NEXT_OG_DEFAULT_FONT_PATH = path.join(
  process.cwd(),
  "node_modules",
  "next",
  "dist",
  "compiled",
  "@vercel",
  "og",
  "Geist-Regular.ttf",
);

let geistRegular: Buffer | null = null;

export function ogImageResponse(
  element: ReactNode,
  size: { width: number; height: number },
): Response {
  geistRegular ??= fs.readFileSync(NEXT_OG_DEFAULT_FONT_PATH);
  return pngImageResponse(element, {
    width: size.width,
    height: size.height,
    fonts: [{ name: "geist", data: geistRegular, weight: 400, style: "normal" }],
  });
}
