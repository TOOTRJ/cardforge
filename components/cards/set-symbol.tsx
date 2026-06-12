import { cn } from "@/lib/utils";
import type { Rarity } from "@/types/card";

// ---------------------------------------------------------------------------
// SetSymbol — the small set-symbol pip at the right end of the type line.
// Three sources, in priority order:
//   1. iconUrl   — a set's uploaded icon image, drawn as-is (the owner's art).
//   2. setCode   — a preset Keyrune set glyph (ss-dom, ss-mh3, …), rarity-tinted.
//   3. default   — the PipGlyph mark, rarity-tinted like a printed set symbol.
// Keyrune (https://keyrune.andrewgioia.com/) is an open-source pictographic
// font; its CSS is imported globally in app/globals.css.
// ---------------------------------------------------------------------------

const RARITY_COLOR: Record<Rarity, string> = {
  // Standard real-card rarity inks. Common a flat dark stamp, uncommon polished
  // silver, rare gold, mythic the orange-red of recent sets.
  common: "#0f0f12",
  uncommon: "#a5a5b5",
  rare: "#c9a14a",
  mythic: "#d35327",
};

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

// The PipGlyph house mark, drawn as a solid rarity-tintable silhouette: the
// compass star filled with `currentColor` so the rarity ink shows through,
// with the hub knocked out in translucent black so the mark reads on silver,
// gold, or orange alike. KEEP GEOMETRY IN SYNC with the inline SVG in
// lib/render/card-image.tsx (bake side) — preview and export must match.
export function PipGlyphSetMark({
  className,
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={className}
      style={style}
      role="img"
      aria-label="PipGlyph set"
    >
      <path
        d="M16 2.6 L18.5 13.5 L29.4 16 L18.5 18.5 L16 29.4 L13.5 18.5 L2.6 16 L13.5 13.5 Z"
        fill="currentColor"
      />
      <circle cx="16" cy="16" r="2.7" fill="rgba(0,0,0,0.5)" />
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

  // 3. Default — the PipGlyph mark, rarity-tinted.
  return (
    <PipGlyphSetMark
      className={className}
      style={{ width: size, height: size, color, flexShrink: 0 }}
    />
  );
}
