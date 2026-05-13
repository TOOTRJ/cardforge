import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { ManaCostGlyphs } from "@/components/cards/mana-cost-glyphs";
import type {
  ArtPosition,
  CardType,
  ColorIdentity,
  FrameStyle,
  Rarity,
} from "@/types/card";

// ---------------------------------------------------------------------------
// Public props — match the cards table fields used in the live preview.
// All fields are optional so the form can mount the preview before any
// values are typed.
// ---------------------------------------------------------------------------

export type CardPreviewData = {
  title?: string | null;
  cost?: string | null;
  cardType?: CardType | null;
  supertype?: string | null;
  subtypes?: string[];
  rarity?: Rarity | null;
  colorIdentity?: ColorIdentity[];
  rulesText?: string | null;
  flavorText?: string | null;
  power?: string | null;
  toughness?: string | null;
  loyalty?: string | null;
  defense?: string | null;
  artistCredit?: string | null;
  artUrl?: string | null;
  artPosition?: ArtPosition;
  frameStyle?: FrameStyle;
};

type CardPreviewProps = CardPreviewData & {
  className?: string;
  /** When true, suppress hover lift / cursor cues (used inside the editor). */
  staticInEditor?: boolean;
};

// ---------------------------------------------------------------------------
// Visual mapping — color identity drives the ambient halo + frame tint;
// rarity drives the gem in the type line and (for mythic) a foil shimmer.
// All of it is CSS gradients; no proprietary symbols or frames.
// ---------------------------------------------------------------------------

const COLOR_GRADIENT: Record<ColorIdentity, string> = {
  white: "from-amber-200/40 via-amber-100/15",
  blue: "from-sky-400/40 via-sky-300/15",
  black: "from-zinc-700/45 via-zinc-500/10",
  red: "from-rose-500/40 via-rose-400/15",
  green: "from-emerald-500/40 via-emerald-400/15",
  multicolor: "from-fuchsia-400/40 via-amber-300/20",
  colorless: "from-slate-500/35 via-slate-400/15",
};

// Halo colors used behind the entire card frame — softer, larger radius
// than the in-art gradient.
const COLOR_HALO: Record<ColorIdentity, string> = {
  white:
    "radial-gradient(ellipse 120% 80% at 50% 0%, color-mix(in oklab, #f5e6b8 30%, transparent), transparent 60%)",
  blue:
    "radial-gradient(ellipse 120% 80% at 50% 0%, color-mix(in oklab, #7cc3ee 30%, transparent), transparent 60%)",
  black:
    "radial-gradient(ellipse 120% 80% at 50% 0%, color-mix(in oklab, #2a2a2e 50%, transparent), transparent 60%)",
  red:
    "radial-gradient(ellipse 120% 80% at 50% 0%, color-mix(in oklab, #ec6f4c 30%, transparent), transparent 60%)",
  green:
    "radial-gradient(ellipse 120% 80% at 50% 0%, color-mix(in oklab, #79b664 30%, transparent), transparent 60%)",
  multicolor:
    "radial-gradient(ellipse 120% 80% at 50% 0%, color-mix(in oklab, #f5e6b8 28%, transparent), transparent 55%), radial-gradient(ellipse 120% 80% at 50% 100%, color-mix(in oklab, #c98cf7 25%, transparent), transparent 60%)",
  colorless:
    "radial-gradient(ellipse 120% 80% at 50% 0%, color-mix(in oklab, #c8c8cc 28%, transparent), transparent 60%)",
};

const RARITY_COLOR: Record<Rarity, string> = {
  common: "#cfcfd4",
  uncommon: "#c6e2f5",
  rare: "#f3d57c",
  mythic: "#f08a4a",
};

const BORDER_STYLE: Record<NonNullable<FrameStyle["border"]>, string> = {
  thin: "border",
  thick: "border-2",
  ornate: "border-[3px]",
};

const ACCENT_STYLE: Record<NonNullable<FrameStyle["accent"]>, string> = {
  warm: "border-accent/50",
  cool: "border-primary/45",
  neutral: "border-border-strong/80",
};

// Simple set of keyword abilities we italicize in the rules text. Not
// exhaustive — just enough to make the preview feel typeset rather than
// raw. Lowercased on match.
const KEYWORD_ABILITIES = new Set([
  "flying",
  "trample",
  "haste",
  "vigilance",
  "lifelink",
  "deathtouch",
  "reach",
  "menace",
  "first strike",
  "double strike",
  "indestructible",
  "hexproof",
  "ward",
  "flash",
  "defender",
]);

function pickGradient(colors: ColorIdentity[] | undefined): string {
  if (!colors || colors.length === 0) return COLOR_GRADIENT.colorless;
  if (colors.length > 1) return COLOR_GRADIENT.multicolor;
  return COLOR_GRADIENT[colors[0]];
}

function pickHalo(colors: ColorIdentity[] | undefined): string {
  if (!colors || colors.length === 0) return COLOR_HALO.colorless;
  if (colors.length > 1) return COLOR_HALO.multicolor;
  return COLOR_HALO[colors[0]];
}

function buildTypeLine({
  supertype,
  cardType,
  subtypes,
}: Pick<CardPreviewData, "supertype" | "cardType" | "subtypes">): string {
  const left = [supertype, cardType ? capitalize(cardType) : null]
    .filter(Boolean)
    .join(" ");
  const right = subtypes?.filter(Boolean).join(" ") ?? "";
  if (left && right) return `${left} — ${right}`;
  return left || right || "Type";
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function showsPowerToughness(cardType: CardType | null | undefined): boolean {
  return cardType === "creature" || cardType === "token";
}

function showsLoyalty(rarity: Rarity | null | undefined): boolean {
  // Reserved for planeswalker-like future templates; off by default.
  return rarity === "mythic";
}

// ---------------------------------------------------------------------------
// CardPreview — canonical visual component used by the creator + gallery.
// ---------------------------------------------------------------------------

export function CardPreview({
  title,
  cost,
  cardType,
  supertype,
  subtypes,
  rarity,
  colorIdentity,
  rulesText,
  flavorText,
  power,
  toughness,
  loyalty,
  defense,
  artistCredit,
  artUrl,
  artPosition,
  frameStyle,
  className,
  staticInEditor = false,
}: CardPreviewProps) {
  const safeTitle = title?.trim() || "Untitled Card";
  const showCost = cardType !== "land" && cost?.trim();
  const showPT = showsPowerToughness(cardType) && (power || toughness);
  const showLoyalty = showsLoyalty(rarity) && Boolean(loyalty);
  const showDefense = Boolean(defense);
  const gradient = pickGradient(colorIdentity);
  const halo = pickHalo(colorIdentity);
  const focalX = clamp(artPosition?.focalX ?? 0.5, 0, 1);
  const focalY = clamp(artPosition?.focalY ?? 0.5, 0, 1);
  const scale = clamp(artPosition?.scale ?? 1, 0.5, 4);

  const borderClass =
    BORDER_STYLE[frameStyle?.border ?? "thin"] +
    " " +
    ACCENT_STYLE[frameStyle?.accent ?? "neutral"];

  const isMythicFoil = rarity === "mythic" || rarity === "rare";
  const accentTitleColor =
    rarity === "mythic" || rarity === "rare"
      ? RARITY_COLOR[rarity]
      : undefined;

  return (
    <div
      className={cn(
        "group relative aspect-[5/7] w-full overflow-hidden rounded-frame bg-linear-to-br from-elevated via-surface to-background p-3 shadow-[0_18px_60px_-30px_rgba(0,0,0,0.85),inset_0_1px_0_rgba(255,255,255,0.06)] transition-transform",
        borderClass,
        staticInEditor ? "" : "hover:-translate-y-1 hover:shadow-[0_24px_80px_-30px_rgba(120,80,220,0.4),inset_0_1px_0_rgba(255,255,255,0.08)]",
        className,
      )}
    >
      {/* Ambient color halo — sits between the outer frame and inner card
          and tints the whole composition by the card's color identity. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-90"
        style={{ background: halo }}
      />

      {/* Optional mythic/rare foil shimmer — a slow conic sweep gated by
          mix-blend so it doesn't blow out the underlying colors. Static in
          editor mode to keep typing focus on the form. */}
      {isMythicFoil ? (
        <div
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-0 mix-blend-overlay opacity-30",
            staticInEditor ? "" : "animate-[card-shimmer_6s_linear_infinite]",
          )}
          style={{
            background:
              rarity === "mythic"
                ? "conic-gradient(from 0deg, transparent, rgba(255,200,120,0.55), transparent 40%, rgba(255,255,255,0.35) 60%, transparent 80%)"
                : "conic-gradient(from 0deg, transparent, rgba(255,235,180,0.4), transparent 50%)",
          }}
        />
      ) : null}

      <div className="relative flex h-full flex-col gap-2 rounded-card border border-border/60 bg-background/40 p-2 backdrop-blur-sm">
        {/* Title bar */}
        <div className="flex items-center justify-between gap-2 rounded-md border border-border/40 bg-surface/80 px-3 py-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
          <span
            className="truncate font-display text-base font-semibold tracking-wide text-foreground"
            style={accentTitleColor ? { color: accentTitleColor } : undefined}
            title={safeTitle}
          >
            {safeTitle}
          </span>
          {showCost ? <ManaCostGlyphs cost={cost} size="sm" /> : null}
        </div>

        {/* Art well */}
        <div
          className={cn(
            "relative flex-1 overflow-hidden rounded-md border border-border/40 bg-linear-to-b to-background/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]",
            gradient,
          )}
        >
          {artUrl ? (
            <ArtImage
              src={artUrl}
              focalX={focalX}
              focalY={focalY}
              scale={scale}
              alt={`Artwork for ${safeTitle}`}
            />
          ) : (
            <>
              <div className="absolute inset-0 bg-grid opacity-25" aria-hidden />
              <div
                className="absolute inset-0"
                aria-hidden
                style={{
                  background:
                    "radial-gradient(circle at 50% 45%, color-mix(in oklab, var(--color-primary) 18%, transparent), transparent 60%)",
                }}
              />
              <div className="relative flex h-full items-center justify-center p-4 text-center">
                <span className="font-display text-[11px] uppercase tracking-[0.3em] text-subtle">
                  Awaiting art
                </span>
              </div>
            </>
          )}
        </div>

        {/* Type line + rarity gem */}
        <div className="flex items-center justify-between gap-2 rounded-md border border-border/40 bg-surface/80 px-3 py-1.5 text-[11px] text-muted shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
          <span className="truncate font-display tracking-wide">
            {buildTypeLine({ supertype, cardType, subtypes })}
          </span>
          {rarity ? (
            <RarityGem rarity={rarity} />
          ) : null}
        </div>

        {/* Rules + flavor */}
        <div className="flex flex-1 flex-col gap-2 rounded-md border border-border/40 bg-surface/60 px-3 py-2 text-xs leading-5 text-foreground/85 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
          <p className="whitespace-pre-line">
            {rulesText?.trim() ? (
              renderRulesText(rulesText)
            ) : (
              <span className="text-subtle italic">Rules text appears here.</span>
            )}
          </p>
          {flavorText?.trim() ? (
            <p className="border-t border-border/40 pt-2 italic text-subtle">
              {flavorText}
            </p>
          ) : null}
          {(showPT || showLoyalty || showDefense) && (
            <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-border/40 pt-2">
              {showPT ? (
                <Stat
                  label="P/T"
                  value={`${power ?? "—"} / ${toughness ?? "—"}`}
                />
              ) : null}
              {showLoyalty ? <Stat label="Loyalty" value={loyalty ?? "—"} /> : null}
              {showDefense ? <Stat label="Defense" value={defense ?? "—"} /> : null}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-subtle">
          <span className="truncate">
            {artistCredit?.trim() ? `Art: ${artistCredit}` : "Art: Unknown"}
          </span>
          <span className="font-display tracking-widest">CardForge</span>
        </div>
      </div>

      {/* Shimmer keyframes — kept inline so this component doesn't depend
          on a global @keyframes registration. Browsers de-dupe identical
          @keyframes by name, so multiple previews share the same animation. */}
      <style>{shimmerKeyframes}</style>
    </div>
  );
}

const shimmerKeyframes = `@keyframes card-shimmer { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`;

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-elevated/80 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-foreground">
      <span className="text-subtle">{label}</span>
      <span>{value}</span>
    </span>
  );
}

function RarityGem({ rarity }: { rarity: Rarity }) {
  // Diamond-shaped gem, tinted by rarity. Inline SVG so there's no asset
  // pipeline and the gem inherits the same OKLCH palette as everything else.
  const fill = RARITY_COLOR[rarity];
  const isMythic = rarity === "mythic";
  return (
    <span
      aria-label={`${capitalize(rarity)} rarity`}
      title={capitalize(rarity)}
      className={cn(
        "inline-flex h-3.5 w-3.5 items-center justify-center",
        isMythic ? "drop-shadow-[0_0_4px_rgba(240,138,74,0.45)]" : "",
      )}
    >
      <svg viewBox="0 0 12 12" className="h-full w-full" aria-hidden>
        <defs>
          <linearGradient id={`gem-${rarity}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="white" stopOpacity="0.85" />
            <stop offset="40%" stopColor={fill} />
            <stop offset="100%" stopColor={fill} stopOpacity="0.7" />
          </linearGradient>
        </defs>
        <polygon
          points="6,1 11,6 6,11 1,6"
          fill={`url(#gem-${rarity})`}
          stroke="rgba(0,0,0,0.35)"
          strokeWidth="0.5"
        />
      </svg>
    </span>
  );
}

function ArtImage({
  src,
  focalX,
  focalY,
  scale,
  alt,
}: {
  src: string;
  focalX: number;
  focalY: number;
  scale: number;
  alt: string;
}) {
  // Plain <img> — no Next.js Image, since the user-uploaded card-art origin
  // is dynamic and we don't want to wedge the editor on remoteImage config
  // misses. A proper Image setup arrives in the export/render phase.
  return (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      src={src}
      alt={alt}
      className="h-full w-full object-cover"
      style={{
        objectPosition: `${focalX * 100}% ${focalY * 100}%`,
        transform: `scale(${scale})`,
        transformOrigin: `${focalX * 100}% ${focalY * 100}%`,
      }}
      loading="lazy"
    />
  );
}

// ---------------------------------------------------------------------------
// Rules-text typography — italicize the first-word keyword on each line if
// it matches a known keyword ability, and italicize reminder text in
// parentheses. Keeps the preview feeling typeset without a full templater.
// ---------------------------------------------------------------------------

function renderRulesText(raw: string): ReactNode {
  const lines = raw.split(/\n+/);
  return lines.map((line, i) => (
    <span key={i}>
      {renderLine(line)}
      {i < lines.length - 1 ? <br /> : null}
    </span>
  ));
}

function renderLine(line: string): ReactNode[] {
  // First-word keyword detection. Accepts multi-word keywords like
  // "first strike" / "double strike".
  const lower = line.toLowerCase();
  let prefixLen = 0;
  for (const keyword of KEYWORD_ABILITIES) {
    if (lower.startsWith(keyword)) {
      const afterChar = line.charAt(keyword.length);
      if (afterChar === "" || /[\s,.;:]/.test(afterChar)) {
        prefixLen = keyword.length;
        break;
      }
    }
  }

  const remainder = prefixLen > 0 ? line.slice(prefixLen) : line;
  const keywordNode =
    prefixLen > 0 ? (
      <em key="kw" className="not-italic font-medium text-foreground">
        {line.slice(0, prefixLen)}
      </em>
    ) : null;

  // Now split the remainder on parenthetical reminder text.
  const parts: ReactNode[] = keywordNode ? [keywordNode] : [];
  const reminderPattern = /\(([^)]+)\)/g;
  let cursor = 0;
  let n = 0;
  for (const match of remainder.matchAll(reminderPattern)) {
    if (match.index === undefined) continue;
    if (match.index > cursor) {
      parts.push(remainder.slice(cursor, match.index));
    }
    parts.push(
      <span key={`r-${n++}`} className="italic text-subtle">
        ({match[1]})
      </span>,
    );
    cursor = match.index + match[0].length;
  }
  if (cursor < remainder.length) {
    parts.push(remainder.slice(cursor));
  }
  return parts;
}
