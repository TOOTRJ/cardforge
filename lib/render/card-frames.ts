import "server-only";

import fs from "node:fs";
import path from "node:path";
import type { FrameTemplate } from "@/types/card";

// ---------------------------------------------------------------------------
// Server-side loader for the placeholder frame PNGs that ship in
// public/frames/{template}/{color}.png. Mirrors the live preview's
// FrameLayer component — same file paths, same color resolution rules —
// so the baked PNG and the editor preview match.
//
// Satori (next/og) needs an inline source for backgrounds; it can't refer
// to a public/ URL the way the browser can. We read the PNG bytes at
// module load and expose them as a data: URL so the renderer JSX can pass
// them directly to an <img src=...>.
// ---------------------------------------------------------------------------

const FRAME_COLOR_KEYS = ["w", "u", "b", "r", "g", "c", "m"] as const;
type FrameColorKey = (typeof FRAME_COLOR_KEYS)[number];

function loadFrame(template: FrameTemplate, color: FrameColorKey): string {
  const filePath = path.join(
    process.cwd(),
    "public",
    "frames",
    template,
    `${color}.png`,
  );
  const bytes = fs.readFileSync(filePath);
  return `data:image/png;base64,${bytes.toString("base64")}`;
}

// Eagerly load all 7 frame variants at module import time. ~700 KB total —
// well under any serverless function memory budget, and reading once at
// cold start is cheaper than re-reading on every render.
const REGULAR_FRAMES: Record<FrameColorKey, string> = {
  w: loadFrame("regular", "w"),
  u: loadFrame("regular", "u"),
  b: loadFrame("regular", "b"),
  r: loadFrame("regular", "r"),
  g: loadFrame("regular", "g"),
  c: loadFrame("regular", "c"),
  m: loadFrame("regular", "m"),
};

const FRAMES_BY_TEMPLATE: Record<FrameTemplate, Record<FrameColorKey, string>> = {
  regular: REGULAR_FRAMES,
};

export function getFrameDataUrl(
  template: FrameTemplate,
  colorKey: string,
): string {
  const set = FRAMES_BY_TEMPLATE[template] ?? FRAMES_BY_TEMPLATE.regular;
  const key = (FRAME_COLOR_KEYS as readonly string[]).includes(colorKey)
    ? (colorKey as FrameColorKey)
    : "c";
  return set[key];
}
