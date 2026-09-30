import { cn } from "@/lib/utils";
import { drawableMediaUrl } from "@/lib/media/media-urls";
import type { Rarity } from "@/types/card";
import { RARITY_INK, RARITY_SET_MARK } from "@/lib/brand/constants";
import {
  SET_MARK_GEM_PATH,
  SET_MARK_RING,
  SET_MARK_STAR_PATH,
} from "@/lib/brand/geometry";

// ---------------------------------------------------------------------------
// SetSymbol — the small set-symbol pip at the right end of the type line.
// Three sources, in priority order:
//   1. iconUrl   — a set's uploaded icon image, drawn as-is (the owner's art).
//   2. setCode   — a preset Keyrune set glyph (ss-dom, ss-mh3, …), rarity-tinted.
//   3. default   — the PipGlyph mark, rarity-tinted like a printed set symbol.
// Keyrune (https://keyrune.andrewgioia.com/) is an open-source pictographic
// font; its CSS is imported globally in app/globals.css.
// ---------------------------------------------------------------------------

// Standard real-card rarity inks (see lib/brand/constants for why this is
// a different palette than the identity panel's gem tints).
const RARITY_COLOR: Record<Rarity, string> = RARITY_INK;

function setSymbolColor(rarity: Rarity | null): string {
  return rarity ? RARITY_COLOR[rarity] : RARITY_COLOR.common;
}

type SetSymbolProps = {
  rarity: Rarity | null;
  /** A set's uploaded icon image URL. Highest priority; rendered as-is. */
  iconUrl?: string | null;
  /** A preset Keyrune set code (e.g. "dom", "mh3"). Rarity-tinted glyph. */
  setCode?: string | null;
  /** Glyph size — a number (px) or any CSS length. Pass a container-relative
   *  value (e.g. a `cqw` string) so the symbol scales with the card. For an
   *  icon or the mark it is the square's side; for a Keyrune glyph, its font
   *  size (lib/cards/set-symbol-size.ts fits each glyph by its ink). */
  size?: number | string;
  /** A Keyrune glyph's laid-out width — its advance at `size`, from
   *  lib/cards/keyrune-metrics.ts (setSymbolSize's drawnWidthPct): the width
   *  the bake gives it, so both renderers leave the type line the same room.
   *  Unset, the browser sizes it from the font. An icon and the mark are
   *  `size` wide. */
  width?: number | string;
  /** A keyline around a preset Keyrune glyph (FrameProfile.setSymbolKeyline:
   *  a zero-blur multi-layer text shadow, e.g. SET_SYMBOL_KEYLINE), drawn as
   *  its CSS text-shadow; the bake draws the same layers as offset copies.
   *  Ignored for an uploaded icon and the default mark. */
  keyline?: string;
  className?: string;
  /** Extra style on the symbol's own element — a measured type band's
   *  (layout v32): never shrink, and the pull over the band gap
   *  (lib/cards/render-tiers.ts inlineSymbolPullPct), as the bake draws it. */
  style?: React.CSSProperties;
  /** Whether the symbol's label names the card's rarity ("common rarity").
   *  False for a card type without one — an emblem (CR 114;
   *  lib/cards/emblem.ts cardTypeHasRarity): its stored "common" only inks
   *  the symbol, so the label says "Set symbol". The ink is the same. */
  namesRarity?: boolean;
};

// The PipGlyph house mark as a ringed two-tone emblem — the rose star
// inside the logo's ring, like a minted seal. Rarity ink over a contrast
// keyline (light behind common's dark ink, dark behind silver/gold/orange)
// with the gem heart in the keyline color, so the mark stays legible on
// any frame ink the way printed set symbols wear an outline. Geometry +
// palette come from lib/brand — the bake side (lib/render/card-image.tsx)
// imports the same constants, so preview and export can't drift.
export function PipGlyphSetMark({
  rarity,
  className,
  style,
}: {
  rarity: Rarity | null;
  className?: string;
  style?: React.CSSProperties;
}) {
  const { ink, keyline } = RARITY_SET_MARK[rarity ?? "common"];
  return (
    <svg
      viewBox="0 0 32 32"
      className={className}
      style={style}
      role="img"
      aria-label="PipGlyph set"
    >
      {/* keyline underlay first, then ink — the outline hugs every edge */}
      <circle
        cx={SET_MARK_RING.cx}
        cy={SET_MARK_RING.cy}
        r={SET_MARK_RING.r}
        stroke={keyline}
        strokeWidth={4.2}
        fill="none"
      />
      {/* Screen hinting: the star's keyline halo and an ink outline are
          drawn in DEVICE pixels (non-scaling) rather than mark units. At
          the editor preview's ~14–24 px the halo used to swallow the thin
          quill arms and the emblem read as a ring with a dot; at the HD
          bake's ~64 px these strokes are sub-pixel and the look is the
          same as the bake's mark (lib/render/card-image.tsx, unchanged —
          no layout-version bump). */}
      <path
        d={SET_MARK_STAR_PATH}
        fill={keyline}
        stroke={keyline}
        strokeWidth={1.5}
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle
        cx={SET_MARK_RING.cx}
        cy={SET_MARK_RING.cy}
        r={SET_MARK_RING.r}
        stroke={ink}
        strokeWidth={2}
        fill="none"
      />
      <path
        d={SET_MARK_STAR_PATH}
        fill={ink}
        stroke={ink}
        strokeWidth={1.1}
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      <path d={SET_MARK_GEM_PATH} fill={keyline} opacity={0.92} />
    </svg>
  );
}

export function SetSymbol({
  rarity,
  iconUrl,
  setCode,
  size = 14,
  width,
  keyline,
  className,
  style,
  namesRarity = true,
}: SetSymbolProps) {
  const color = setSymbolColor(rarity);

  // 1. Uploaded image — drawn as-is (the owner's design carries its own
  //    color), and only when it is one of our stored icons (migration 0127,
  //    lib/media/media-urls.ts): an older row could name any host. Anything
  //    else falls through to the preset / the default mark.
  const drawableIcon = drawableMediaUrl("set-icon", iconUrl);
  if (drawableIcon) {
    return (
      /* eslint-disable-next-line @next/next/no-img-element */
      <img
        src={drawableIcon}
        alt="Set icon"
        className={className}
        style={{ width: size, height: size, objectFit: "contain", ...style }}
      />
    );
  }

  // 2. Preset Keyrune glyph — flat rarity ink, exactly as the stored render
  //    draws it (lib/render/card-image.tsx). Keyrune's metallic `text gradient`
  //    text gradient can't be reproduced by Satori, so the preview must not
  //    show what the bake can't: preview and bake stay pixel-identical. A
  //    profile's keyline (dark type bars) is the glyph's text-shadow.
  if (setCode) {
    return (
      <i
        aria-label={rarity && namesRarity ? `${rarity} rarity` : "Set symbol"}
        className={cn("ss", `ss-${setCode.toLowerCase()}`, className)}
        style={{
          fontSize: size,
          ...(width !== undefined ? { width } : {}),
          color,
          ...(keyline ? { textShadow: keyline } : {}),
          ...style,
        }}
      />
    );
  }

  // 3. Default — the PipGlyph mark, two-tone rarity emblem.
  return (
    <PipGlyphSetMark
      rarity={rarity}
      className={className}
      style={{ width: size, height: size, flexShrink: 0, ...style }}
    />
  );
}
