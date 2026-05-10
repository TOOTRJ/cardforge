import { cn } from "@/lib/utils";
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
// Visual mapping — color identity drives an ambient gradient on the art well,
// rarity drives a small pip color. No proprietary symbols or frames.
// ---------------------------------------------------------------------------

const COLOR_GRADIENT: Record<ColorIdentity, string> = {
  white: "from-amber-200/35 via-amber-100/15",
  blue: "from-sky-400/35 via-sky-300/15",
  black: "from-zinc-700/40 via-zinc-500/10",
  red: "from-rose-500/35 via-rose-400/15",
  green: "from-emerald-500/35 via-emerald-400/15",
  multicolor: "from-fuchsia-400/35 via-amber-300/20",
  colorless: "from-slate-500/30 via-slate-400/15",
};

const RARITY_DOT: Record<Rarity, string> = {
  common: "bg-zinc-300",
  uncommon: "bg-sky-300",
  rare: "bg-amber-300",
  mythic: "bg-orange-400",
};

const BORDER_STYLE: Record<NonNullable<FrameStyle["border"]>, string> = {
  thin: "border",
  thick: "border-2",
  ornate: "border-[3px]",
};

const ACCENT_STYLE: Record<NonNullable<FrameStyle["accent"]>, string> = {
  warm: "border-accent/45",
  cool: "border-primary/40",
  neutral: "border-border-strong/80",
};

function pickGradient(colors: ColorIdentity[] | undefined): string {
  if (!colors || colors.length === 0) return COLOR_GRADIENT.colorless;
  if (colors.length > 1) return COLOR_GRADIENT.multicolor;
  return COLOR_GRADIENT[colors[0]];
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
  const focalX = clamp(artPosition?.focalX ?? 0.5, 0, 1);
  const focalY = clamp(artPosition?.focalY ?? 0.5, 0, 1);
  const scale = clamp(artPosition?.scale ?? 1, 0.5, 4);

  const borderClass =
    BORDER_STYLE[frameStyle?.border ?? "thin"] +
    " " +
    ACCENT_STYLE[frameStyle?.accent ?? "neutral"];

  return (
    <div
      className={cn(
        "group relative aspect-[5/7] w-full overflow-hidden rounded-frame bg-linear-to-br from-elevated via-surface to-background p-3 shadow-[0_18px_60px_-30px_rgba(0,0,0,0.8)] transition-transform",
        borderClass,
        staticInEditor ? "" : "hover:-translate-y-1",
        className,
      )}
    >
      <div className="flex h-full flex-col gap-2 rounded-card border border-border/60 bg-background/40 p-2 backdrop-blur-sm">
        {/* Title bar */}
        <div className="flex items-center justify-between gap-2 rounded-md border border-border/40 bg-surface/80 px-3 py-1.5">
          <span className="truncate font-display text-sm font-semibold tracking-wide text-foreground">
            {safeTitle}
          </span>
          {showCost ? (
            <span className="rounded-full border border-border/60 bg-elevated px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted">
              {cost}
            </span>
          ) : null}
        </div>

        {/* Art well */}
        <div
          className={cn(
            "relative flex-1 overflow-hidden rounded-md border border-border/40 bg-linear-to-b to-background/80",
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
              <div className="absolute inset-0 bg-grid opacity-30" aria-hidden />
              <div className="relative flex h-full items-center justify-center p-4 text-center">
                <span className="text-[10px] uppercase tracking-[0.2em] text-subtle">
                  Artwork preview
                </span>
              </div>
            </>
          )}
        </div>

        {/* Type line */}
        <div className="flex items-center justify-between gap-2 rounded-md border border-border/40 bg-surface/80 px-3 py-1.5 text-[11px] text-muted">
          <span className="truncate">
            {buildTypeLine({ supertype, cardType, subtypes })}
          </span>
          {rarity ? (
            <span
              className={cn(
                "h-2 w-2 shrink-0 rounded-full",
                RARITY_DOT[rarity],
              )}
              title={capitalize(rarity)}
              aria-label={`${capitalize(rarity)} rarity`}
            />
          ) : null}
        </div>

        {/* Rules + flavor */}
        <div className="flex flex-1 flex-col gap-2 rounded-md border border-border/40 bg-surface/60 px-3 py-2 text-[11px] leading-5 text-muted">
          <p className="whitespace-pre-line">
            {rulesText?.trim() || (
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
          <span>CardForge</span>
        </div>
      </div>
    </div>
  );
}

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
