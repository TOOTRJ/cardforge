import { cn } from "@/lib/utils";
import type { Rarity } from "@/types/card";

// ---------------------------------------------------------------------------
// SetSymbol — renders the small set-symbol pip that sits at the right end of
// the type line on a real MTG card. Uses Keyrune (https://keyrune.andrewgioia.com/),
// an open-source pictographic font for every Magic set symbol (SIL OFL 1.1).
// The CSS is imported globally in app/globals.css.
//
// Phase 1 ships a single default set symbol — Keyrune's generic Magic glyph
// rendered from the `.ss` base class — colorized by the card's rarity using
// the standard rarity ink (common silver, uncommon silver, rare gold, mythic
// orange). A future phase lets users pick a real set code (ss-dom, ss-mh3,
// etc.) and stores it on the card row.
// ---------------------------------------------------------------------------

const RARITY_COLOR: Record<Rarity, string> = {
  // Standard real-card rarity colors. Common is a flat dark stamp, uncommon
  // a polished silver, rare gold, mythic the orange-red of recent sets.
  common: "#0f0f12",
  uncommon: "#a5a5b5",
  rare: "#c9a14a",
  mythic: "#d35327",
};

type SetSymbolProps = {
  rarity: Rarity | null;
  /** Specific set code (e.g. "dom", "mh3"). When null/undefined, falls back
   *  to Keyrune's default glyph. */
  setCode?: string | null;
  /** Glyph size — a number (px) or any CSS length. Pass a container-relative
   *  value (e.g. a `cqw` string) so the symbol scales with the card instead of
   *  staying a fixed pixel size. Defaults to 14px. */
  size?: number | string;
  className?: string;
};

export function SetSymbol({
  rarity,
  setCode,
  size = 14,
  className,
}: SetSymbolProps) {
  // `ss-grad` adds Keyrune's built-in subtle gradient, which reads as the
  // metallic finish on real rare/mythic stamps. Common stays flat.
  const useGradient = rarity === "rare" || rarity === "mythic" || rarity === "uncommon";

  const color = rarity ? RARITY_COLOR[rarity] : RARITY_COLOR.common;

  // ss-{code} when a specific set is given, otherwise the bare ss class
  // produces Keyrune's default Magic glyph.
  const setClass = setCode ? `ss-${setCode.toLowerCase()}` : "";

  return (
    <i
      aria-label={rarity ? `${rarity} rarity` : "Set symbol"}
      title={rarity ? rarity.charAt(0).toUpperCase() + rarity.slice(1) : undefined}
      className={cn("ss", setClass, useGradient && "ss-grad", className)}
      style={{ fontSize: size, color }}
    />
  );
}
