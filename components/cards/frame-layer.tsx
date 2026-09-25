import { cn } from "@/lib/utils";
import { frameUrl } from "@/lib/frames/frame-url";
import { canonicalColorSequence } from "@/lib/cards/mana-order";
import type { TwoColorSplit } from "@/lib/cards/template-layout";
import { DEFAULT_FRAME_TEMPLATE } from "@/types/card";
import type { ColorIdentity, FrameTemplate } from "@/types/card";

// ---------------------------------------------------------------------------
// FrameLayer — bottom-most z-index layer in CardPreview. Loads the chosen
// frame from public/frames/{template}/{colorKey}.{webp,png} (WebP variant
// preferred in the browser via a plain url(); the PNG is the master) and
// stretches it across the whole card. Sections (title, art, type, rules,
// footer) sit on top with their own translucent backgrounds.
//
// Color resolution rule:
//   - 0 colors → colorless "c"
//   - 1 color  → that color's key
//   - 2+       → multicolor "m"
//   - exactly 2 on a profile with `twoColorSplit` (Dragon Wing) → BOTH
//     colours' frames, split down a vertical seam (frameSplitFor)
//
// The PNGs are MSE-derived frames converted by scripts/convert-mse-frame.mjs
// and its siblings (build-era-frames / build-variation-frames); see the
// template notes in types/card.ts. Each template's geometry lives in
// lib/cards/template-layout.ts, and a (template, color) combo is only offered
// once verified in /admin/frame-compare — swapping a PNG is not a drop-in
// change.
// ---------------------------------------------------------------------------

const COLOR_KEY_LETTER: Record<ColorIdentity, string> = {
  white: "w",
  blue: "u",
  black: "b",
  red: "r",
  green: "g",
  colorless: "c",
  multicolor: "m",
};

/** Human word for a frame colour key — toast/error copy ("blue", "multicolor"). */
export const COLOR_KEY_WORDS: Record<string, string> = {
  w: "white",
  u: "blue",
  b: "black",
  r: "red",
  g: "green",
  c: "colorless",
  m: "multicolor",
};

export function colorWord(colorKey: string): string {
  return COLOR_KEY_WORDS[colorKey] ?? colorKey;
}

/** The single-select identity a frame colour key stands for (the inverse of
 *  pickFrameColorKey for one-colour identities; "m" → multicolor). */
export function colorIdentityForKey(colorKey: string): ColorIdentity {
  const found = (Object.entries(COLOR_KEY_LETTER) as [ColorIdentity, string][]).find(
    ([, letter]) => letter === colorKey,
  );
  return found?.[0] ?? "colorless";
}

export function pickFrameColorKey(
  colors: readonly ColorIdentity[] | null | undefined,
): string {
  if (!colors || colors.length === 0) return "c";
  if (colors.length > 1) return "m";
  return COLOR_KEY_LETTER[colors[0]] ?? "c";
}

/** The [first, second] frame colour keys of an exactly-two-colour identity,
 *  in printed pair order — the guild sequence the cost pips already use
 *  (canonicalColorSequence: WU WB UB UR BR BG RG RW GW GU), whatever order
 *  the identity was stored in — or null for anything else: mono, colourless,
 *  3+ colours and the single-select "multicolor" dress. */
export function twoColorFrameKeys(
  colors: readonly ColorIdentity[] | null | undefined,
): [string, string] | null {
  if (!colors) return null;
  const distinct = [...new Set(colors)];
  if (distinct.length !== 2) return null;
  const sequence = canonicalColorSequence(
    distinct.map((c) => (COLOR_KEY_LETTER[c] ?? "").toUpperCase()),
  );
  return sequence.length === 2
    ? [sequence[0].toLowerCase(), sequence[1].toLowerCase()]
    : null;
}

/** A frame drawn in two halves: `leftKey`'s PNG left of `atPct` (% of the
 *  card's width), `rightKey`'s right of it. */
export type FrameSplit = { leftKey: string; rightKey: string; atPct: number };

/** How far the LEFT half runs past the seam, in px (CSS px in the preview,
 *  image px in the bake). It sits under the right half there, so a seam on
 *  a fractional pixel never leaves an anti-aliased see-through column. Each
 *  half is otherwise CLIPPED, never stacked over the whole other frame:
 *  drawing one frame over the other doubles the alpha of their soft edges
 *  (art-window anti-aliasing), so a half would no longer match that
 *  colour's own card. */
export const FRAME_SPLIT_OVERLAP_PX = 1;

/** The two halves' CSS clip-paths (FrameLayer, the creator's FrameThumb). */
export function frameSplitClipPaths(split: FrameSplit): { left: string; right: string } {
  return {
    left: `inset(0 calc(${100 - split.atPct}% - ${FRAME_SPLIT_OVERLAP_PX}px) 0 0)`,
    right: `inset(0 0 0 ${split.atPct}%)`,
  };
}

/** The two-colour split a (resolved) profile draws for an identity, or null
 *  — the ONE rule the preview (FrameLayer), the bake, the etched sheen, the
 *  bake's frame preload and the creator's frame thumbnails share. Only
 *  profiles with `twoColorSplit` (Dragon Wing) ever split. */
export function frameSplitFor(
  profile: { twoColorSplit?: TwoColorSplit },
  colors: readonly ColorIdentity[] | null | undefined,
): FrameSplit | null {
  if (!profile.twoColorSplit) return null;
  const keys = twoColorFrameKeys(colors);
  return keys
    ? { leftKey: keys[0], rightKey: keys[1], atPct: profile.twoColorSplit.atPct }
    : null;
}

/** Every frame master a render of this identity paints: both halves of a
 *  split, else pickFrameColorKey's one key. What the bake preloads. Stat
 *  plates are NOT frame masters — they keep pickFrameColorKey ("m" for a
 *  split card, like the printed gold plate). */
export function frameColorKeysFor(
  profile: { twoColorSplit?: TwoColorSplit },
  colors: readonly ColorIdentity[] | null | undefined,
): string[] {
  const split = frameSplitFor(profile, colors);
  return split ? [split.leftKey, split.rightKey] : [pickFrameColorKey(colors)];
}

export function frameAssetPath(
  template: FrameTemplate,
  colorKey: string,
): string {
  return `/frames/${template}/${colorKey}.png`;
}

/** Sibling WebP variant of a /frames/**.png path (generated by
 *  scripts/generate-frame-webp.mjs — ~10× smaller, browser-only). */
export function webpVariant(pngPath: string): string {
  return pngPath.replace(/\.png$/, ".webp");
}

/** CSS background-image value for the small WebP variant. Plain url() on
 *  purpose: WebP decode has been universal since ~2020, while
 *  image-set(... type(...)) only landed ~2023 — and a browser too old for
 *  image-set would drop the whole declaration and render NO frame, so the
 *  "PNG fallback" inside image-set protects nobody. BROWSER ONLY — the
 *  server-side Satori bake never sees this: it reads the PNG bytes straight
 *  from disk (lib/render/card-frames.ts) and must stay on PNG. */
export function frameBackgroundImage(
  template: FrameTemplate,
  colorKey: string,
): string {
  return `url("${frameImageUrl(template, colorKey)}")`;
}

/** The browser URL of a frame's WebP variant — what FrameLayer paints and
 *  what the etched finish masks with (same URL → one cached download).
 *  BROWSER ONLY, like frameBackgroundImage. */
export function frameImageUrl(template: FrameTemplate, colorKey: string): string {
  // frameUrl: a frame listed in lib/frames/frame-manifest.json lives in the
  // frames bucket (content-addressed; it sends ACAO *); anything else is
  // still /frames/…
  return frameUrl(webpVariant(frameAssetPath(template, colorKey)));
}

export function FrameLayer({
  template = DEFAULT_FRAME_TEMPLATE,
  colorIdentity,
  className,
  zIndex,
  split = null,
}: {
  template?: FrameTemplate;
  colorIdentity: ColorIdentity[] | undefined;
  className?: string;
  /** Optional inline z-index override. Templates that render a separate
   *  art layer beneath the frame (cut-out slot) pass a positive value so
   *  the frame sits on top of the art. Defaults to the base z-0 layer. */
  zIndex?: number;
  /** frameSplitFor(layout, colorIdentity): the layer then holds the two
   *  colours' frames as clipped halves (frameSplitClipPaths) — the bake
   *  draws the same halves as overflow:hidden boxes (FrameSlice in
   *  lib/render/card-image.tsx). Children, so the pair stays one layer at
   *  one z-index. */
  split?: FrameSplit | null;
}) {
  const layerClass = cn(
    "pointer-events-none absolute inset-0",
    zIndex === undefined ? "z-0" : "",
    className,
  );
  const zStyle = zIndex === undefined ? {} : { zIndex };
  if (split) {
    const clips = frameSplitClipPaths(split);
    const half = (side: "left" | "right", key: string, clipPath: string) => (
      <div
        data-frame-split={side}
        data-frame-key={key}
        className="absolute inset-0"
        style={{
          backgroundImage: frameBackgroundImage(template, key),
          backgroundSize: "100% 100%",
          backgroundRepeat: "no-repeat",
          clipPath,
        }}
      />
    );
    return (
      <div aria-hidden className={layerClass} style={zStyle}>
        {half("left", split.leftKey, clips.left)}
        {half("right", split.rightKey, clips.right)}
      </div>
    );
  }
  return (
    <div
      aria-hidden
      className={layerClass}
      style={{
        backgroundImage: frameBackgroundImage(template, pickFrameColorKey(colorIdentity)),
        backgroundSize: "100% 100%",
        backgroundRepeat: "no-repeat",
        ...zStyle,
      }}
    />
  );
}
