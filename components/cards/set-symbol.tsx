import { cn } from "@/lib/utils";
import type { Rarity } from "@/types/card";

// ---------------------------------------------------------------------------
// SetSymbol — the small set-symbol pip at the right end of the type line.
// Three sources, in priority order:
//   1. iconUrl   — a set's uploaded icon image, drawn as-is (the owner's art).
//   2. setCode   — a preset Keyrune set glyph (ss-dom, ss-mh3, …), rarity-tinted.
//   3. default   — the Spellwright mark, rarity-tinted like a printed set symbol.
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

// The Spellwright house mark, drawn as a solid rarity-tintable silhouette: a
// pentagon (the 5-color wheel) filled with `currentColor` so the rarity ink
// shows through, with the quill nib knocked out in translucent black so the
// mark reads on silver, gold, or orange alike.
export function SpellwrightSetMark({
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
      aria-label="Spellwright set"
    >
      <polygon points="16,3 28.4,12 23.6,26.8 8.4,26.8 3.6,12" fill="currentColor" />
      <g
        stroke="rgba(0,0,0,0.5)"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      >
        <line x1="16" y1="8.5" x2="16" y2="21" strokeWidth="1.7" />
        <path d="M16 21 L12 18.4" strokeWidth="1.6" />
        <path d="M16 21 L20 18.4" strokeWidth="1.6" />
      </g>
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

  // 3. Default — the Spellwright mark, rarity-tinted.
  return (
    <SpellwrightSetMark
      className={className}
      style={{ width: size, height: size, color, flexShrink: 0 }}
    />
  );
}
