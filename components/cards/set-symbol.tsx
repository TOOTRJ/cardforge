import { cn } from "@/lib/utils";
import type { Rarity } from "@/types/card";
import { RARITY_INK, RARITY_SET_MARK } from "@/lib/brand/constants";
import {
  ROSE_GEM_BOLD_PATH,
  ROSE_STAR_BOLD_PATH,
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

export function setSymbolColor(rarity: Rarity | null): string {
  return rarity ? RARITY_COLOR[rarity] : RARITY_COLOR.common;
}

type SetSymbolProps = {
  rarity: Rarity | null;
  /** A set's uploaded icon image URL. Highest priority; rendered as-is. */
  iconUrl?: string | null;
  /** A preset Keyrune set code (e.g. "dom", "mh3"). Rarity-tinted glyph. */
  setCode?: string | null;
  /** Glyph size — a number (px) or any CSS length. Pass a container-relative
   *  value (e.g. a `cqw` string) so the symbol scales with the card. */
  size?: number | string;
  className?: string;
};

// The PipGlyph house mark as a two-tone emblem: the bold Astral Rose star
// in the rarity ink over a contrast keyline (light behind common's dark
// ink, dark behind silver/gold/orange), with the gem heart in the keyline
// color — so the mark stays legible on any frame ink, the way printed set
// symbols wear an outline. Geometry + palette come from lib/brand — the
// bake side (lib/render/card-image.tsx) imports the same constants, so
// preview and export can't drift.
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
      <path
        d={ROSE_STAR_BOLD_PATH}
        fill={keyline}
        stroke={keyline}
        strokeWidth={2.4}
        strokeLinejoin="round"
      />
      <path d={ROSE_STAR_BOLD_PATH} fill={ink} />
      <path d={ROSE_GEM_BOLD_PATH} fill={keyline} opacity={0.92} />
    </svg>
  );
}

export function SetSymbol({
  rarity,
  iconUrl,
  setCode,
  size = 14,
  className,
}: SetSymbolProps) {
  const color = setSymbolColor(rarity);

  // 1. Uploaded image — drawn as-is (the owner's design carries its own color).
  if (iconUrl) {
    return (
      /* eslint-disable-next-line @next/next/no-img-element */
      <img
        src={iconUrl}
        alt="Set icon"
        className={className}
        style={{ width: size, height: size, objectFit: "contain" }}
      />
    );
  }

  // 2. Preset Keyrune glyph — rarity-tinted, with the metallic gradient on the
  //    higher rarities like a real rare/mythic stamp.
  if (setCode) {
    const useGradient =
      rarity === "rare" || rarity === "mythic" || rarity === "uncommon";
    return (
      <i
        aria-label={rarity ? `${rarity} rarity` : "Set symbol"}
        className={cn("ss", `ss-${setCode.toLowerCase()}`, useGradient && "ss-grad", className)}
        style={{ fontSize: size, color }}
      />
    );
  }

  // 3. Default — the PipGlyph mark, two-tone rarity emblem.
  return (
    <PipGlyphSetMark
      rarity={rarity}
      className={className}
      style={{ width: size, height: size, flexShrink: 0 }}
    />
  );
}
