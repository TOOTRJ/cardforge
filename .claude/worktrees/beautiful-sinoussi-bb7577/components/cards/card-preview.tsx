"use client";

import { useState, type ReactNode } from "react";
import { RotateCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { ManaCostGlyphs } from "@/components/cards/mana-cost-glyphs";
import type {
  ArtPosition,
  CardBackFace,
  CardFinish,
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
  /** Optional back-face content. When set, the preview renders a flip
   *  button in the corner and supports a 3D flip animation between the
   *  two faces. */
  backFace?: CardBackFace | null;
};

type CardPreviewProps = CardPreviewData & {
  className?: string;
  /** When true, suppress hover lift / cursor cues (used inside the editor). */
  staticInEditor?: boolean;
  /** When provided, the displayed face is controlled by the parent and
   *  the flip button calls `onFaceChange`. When omitted, the preview
   *  manages its own face state via the flip button. */
  face?: "front" | "back";
  onFaceChange?: (next: "front" | "back") => void;
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
}: {
  supertype: string | null | undefined;
  cardType: CardType | null | undefined;
  subtypes: string[] | undefined;
}): string {
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
  return rarity === "mythic";
}

// ---------------------------------------------------------------------------
// Per-face data — the slice of props that differs between the front and
// the back of a DFC. Built once per face inside CardPreview, then passed
// into InnerCardPanel.
// ---------------------------------------------------------------------------

type FaceData = {
  title: string | null;
  cost: string | null;
  cardType: CardType | null;
  supertype: string | null;
  subtypes: string[];
  rulesText: string | null;
  flavorText: string | null;
  power: string | null;
  toughness: string | null;
  loyalty: string | null;
  defense: string | null;
  artistCredit: string | null;
  artUrl: string | null;
  artPosition: ArtPosition;
};

// ---------------------------------------------------------------------------
// CardPreview — canonical visual component used by the creator + gallery.
//
// When `backFace` is provided, the inner panel is rendered twice inside a
// CSS 3D flip container with a flip button in the corner. When omitted,
// the back-face DOM never mounts and the component behaves exactly as
// before.
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
  backFace,
  face,
  onFaceChange,
  className,
  staticInEditor = false,
}: CardPreviewProps) {
  const halo = pickHalo(colorIdentity);

  const borderClass =
    BORDER_STYLE[frameStyle?.border ?? "thin"] +
    " " +
    ACCENT_STYLE[frameStyle?.accent ?? "neutral"];

  const finish: CardFinish = frameStyle?.finish ?? "regular";
  const isFoil = finish === "foil";
  const isEtched = finish === "etched";

  // Build the two face datasets up front. The back is only computed if a
  // backFace prop was provided; missing fields fall through to null /
  // empty so the InnerCardPanel never crashes on undefined.
  const frontFace: FaceData = {
    title: title ?? null,
    cost: cost ?? null,
    cardType: cardType ?? null,
    supertype: supertype ?? null,
    subtypes: subtypes ?? [],
    rulesText: rulesText ?? null,
    flavorText: flavorText ?? null,
    power: power ?? null,
    toughness: toughness ?? null,
    loyalty: loyalty ?? null,
    defense: defense ?? null,
    artistCredit: artistCredit ?? null,
    artUrl: artUrl ?? null,
    artPosition: artPosition ?? {},
  };

  const backFaceData: FaceData | null = backFace
    ? {
        title: backFace.title ?? null,
        cost: backFace.cost ?? null,
        cardType: backFace.card_type ?? null,
        supertype: backFace.supertype ?? null,
        subtypes: backFace.subtypes ?? [],
        rulesText: backFace.rules_text ?? null,
        flavorText: backFace.flavor_text ?? null,
        power: backFace.power ?? null,
        toughness: backFace.toughness ?? null,
        loyalty: backFace.loyalty ?? null,
        defense: backFace.defense ?? null,
        artistCredit: backFace.artist_credit ?? null,
        artUrl: backFace.art_url ?? null,
        artPosition: backFace.art_position ?? {},
      }
    : null;

  // Face state: controlled when `face` is provided, internal otherwise.
  const [internalFace, setInternalFace] = useState<"front" | "back">("front");
  const currentFace = face ?? internalFace;
  const toggleFace = () => {
    const next = currentFace === "front" ? "back" : "front";
    if (onFaceChange) onFaceChange(next);
    else setInternalFace(next);
  };

  return (
    <div
      className={cn(
        "group relative aspect-[5/7] w-full overflow-hidden rounded-frame bg-linear-to-br from-elevated via-surface to-background p-3 shadow-[0_18px_60px_-30px_rgba(0,0,0,0.85),inset_0_1px_0_rgba(255,255,255,0.06)] transition-transform",
        borderClass,
        staticInEditor ? "" : "hover:-translate-y-1 hover:shadow-[0_24px_80px_-30px_rgba(120,80,220,0.4),inset_0_1px_0_rgba(255,255,255,0.08)]",
        className,
      )}
    >
      {/* Ambient color halo — shared by both faces. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-90"
        style={{ background: halo }}
      />

      {/* Foil shimmer overlay — shared. */}
      {isFoil ? (
        <div
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-0 z-30 mix-blend-overlay opacity-35",
            staticInEditor ? "" : "animate-[card-shimmer_6s_linear_infinite]",
          )}
          style={{
            background:
              "conic-gradient(from 0deg, transparent, rgba(255,200,120,0.55), transparent 30%, rgba(255,255,255,0.45) 50%, transparent 70%, rgba(190,170,255,0.5) 85%, transparent 100%)",
          }}
        />
      ) : null}

      {/* Etched overlay — shared. */}
      {isEtched ? (
        <>
          <div
            aria-hidden
            className="pointer-events-none absolute inset-2 z-20 rounded-card border-2"
            style={{
              borderImage:
                "linear-gradient(135deg, #f3d57c 0%, #d4a64a 50%, #f3d57c 100%) 1",
              borderImageSlice: 1,
            }}
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 z-10 mix-blend-overlay opacity-20"
            style={{
              backgroundImage:
                "repeating-linear-gradient(45deg, rgba(255,255,255,0.18) 0 1px, transparent 1px 6px), repeating-linear-gradient(-45deg, rgba(255,255,255,0.12) 0 1px, transparent 1px 6px)",
            }}
          />
        </>
      ) : null}

      {/* Flip container.
          - Single-face cards: render InnerCardPanel directly to keep the
            DOM stable (no extra 3D layer).
          - DFC: wrap both faces in a CSS 3D rotor that flips on
            currentFace change.
          We always set perspective on the outer card so a future flip
          doesn't snap into perspective on first click. */}
      {backFaceData ? (
        <div
          className="relative h-full w-full"
          style={{ perspective: "1200px" }}
        >
          <div
            className="relative h-full w-full transition-transform duration-500"
            style={{
              transformStyle: "preserve-3d",
              transform:
                currentFace === "back" ? "rotateY(180deg)" : "rotateY(0deg)",
            }}
          >
            <div
              className="absolute inset-0"
              style={{ backfaceVisibility: "hidden" }}
              aria-hidden={currentFace === "back"}
            >
              <InnerCardPanel
                face={frontFace}
                rarity={rarity ?? null}
                colorIdentity={colorIdentity ?? []}
                finish={finish}
              />
            </div>
            <div
              className="absolute inset-0"
              style={{
                backfaceVisibility: "hidden",
                transform: "rotateY(180deg)",
              }}
              aria-hidden={currentFace === "front"}
            >
              <InnerCardPanel
                face={backFaceData}
                rarity={rarity ?? null}
                colorIdentity={colorIdentity ?? []}
                finish={finish}
              />
            </div>
          </div>
        </div>
      ) : (
        <InnerCardPanel
          face={frontFace}
          rarity={rarity ?? null}
          colorIdentity={colorIdentity ?? []}
          finish={finish}
        />
      )}

      {/* Flip button — only when a back face is present. */}
      {backFaceData ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            event.preventDefault();
            toggleFace();
          }}
          aria-label={
            currentFace === "front" ? "Flip to back face" : "Flip to front face"
          }
          aria-pressed={currentFace === "back"}
          className="absolute bottom-3 right-3 z-40 flex h-8 w-8 items-center justify-center rounded-full border border-border/80 bg-background/85 text-muted shadow-lg transition-colors hover:border-border-strong hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
        >
          <RotateCw className="h-4 w-4" aria-hidden />
        </button>
      ) : null}

      <style>{shimmerKeyframes}</style>
    </div>
  );
}

const shimmerKeyframes = `@keyframes card-shimmer { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`;

// ---------------------------------------------------------------------------
// InnerCardPanel — the inner rounded card body. Renders the 5 sections
// (title bar, art well, type line, rules + flavor, footer) for one face.
// Shared finish/halo/foil overlays live on CardPreview's outer wrapper.
// ---------------------------------------------------------------------------

function InnerCardPanel({
  face,
  rarity,
  colorIdentity,
  finish,
}: {
  face: FaceData;
  rarity: Rarity | null;
  colorIdentity: ColorIdentity[];
  finish: CardFinish;
}) {
  const safeTitle = face.title?.trim() || "Untitled Card";
  const showCost = face.cardType !== "land" && face.cost?.trim();
  const showPT =
    showsPowerToughness(face.cardType) && (face.power || face.toughness);
  const showLoyalty = showsLoyalty(rarity) && Boolean(face.loyalty);
  const showDefense = Boolean(face.defense);
  const gradient = pickGradient(colorIdentity);
  const focalX = clamp(face.artPosition?.focalX ?? 0.5, 0, 1);
  const focalY = clamp(face.artPosition?.focalY ?? 0.5, 0, 1);
  const scale = clamp(face.artPosition?.scale ?? 1, 0.5, 4);

  const isBorderless = finish === "borderless";
  const isShowcase = finish === "showcase";

  const accentTitleColor =
    rarity === "mythic" || rarity === "rare"
      ? RARITY_COLOR[rarity]
      : undefined;

  const titleBarClass = isBorderless
    ? "border border-white/10 bg-background/35 backdrop-blur-md"
    : "border border-border/40 bg-surface/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]";
  const typeLineClass = isBorderless
    ? "border border-white/10 bg-background/35 backdrop-blur-md text-foreground/85"
    : "border border-border/40 bg-surface/80 text-muted shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]";
  const rulesPanelClass = isBorderless
    ? "border border-white/10 bg-background/60 backdrop-blur-md text-foreground"
    : "border border-border/40 bg-surface/60 text-foreground/85 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]";
  const footerTextClass = isBorderless ? "text-foreground/80" : "text-subtle";

  return (
    <div className="relative flex h-full flex-col gap-2 overflow-hidden rounded-card border border-border/60 bg-background/40 p-2 backdrop-blur-sm">
      {/* Borderless: full-bleed art sits behind every section. */}
      {isBorderless ? (
        <>
          <div
            aria-hidden
            className={cn(
              "absolute inset-0 z-0 overflow-hidden bg-linear-to-b to-background/80",
              gradient,
            )}
          >
            {face.artUrl ? (
              <ArtImage
                src={face.artUrl}
                focalX={focalX}
                focalY={focalY}
                scale={scale}
                alt={`Artwork for ${safeTitle}`}
              />
            ) : (
              <>
                <div className="absolute inset-0 bg-grid opacity-25" />
                <div
                  className="absolute inset-0"
                  style={{
                    background:
                      "radial-gradient(circle at 50% 45%, color-mix(in oklab, var(--color-primary) 18%, transparent), transparent 60%)",
                  }}
                />
              </>
            )}
          </div>
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 z-0"
            style={{
              background:
                "linear-gradient(180deg, rgba(0,0,0,0.5) 0%, transparent 22%, transparent 62%, rgba(0,0,0,0.75) 100%)",
            }}
          />
        </>
      ) : null}

      {/* Title bar */}
      <div
        className={cn(
          "relative z-10 flex items-center justify-between gap-2 rounded-md px-3 py-1.5",
          titleBarClass,
        )}
      >
        <span
          className={cn(
            "truncate font-display font-semibold tracking-wide text-foreground",
            isShowcase ? "text-base italic" : "text-base",
          )}
          style={accentTitleColor ? { color: accentTitleColor } : undefined}
          title={safeTitle}
        >
          {safeTitle}
        </span>
        {showCost ? <ManaCostGlyphs cost={face.cost} size="sm" /> : null}
      </div>

      {/* Showcase ornate underline */}
      {isShowcase ? (
        <div
          aria-hidden
          className="relative z-10 h-px"
          style={{
            background:
              "linear-gradient(90deg, transparent 0%, color-mix(in oklab, var(--color-accent) 60%, transparent) 50%, transparent 100%)",
          }}
        />
      ) : null}

      {/* Art well */}
      {isBorderless ? (
        <div className="relative z-0 flex-1" aria-hidden />
      ) : (
        <div
          className={cn(
            "relative z-10 flex-1 overflow-hidden rounded-md border border-border/40 bg-linear-to-b to-background/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]",
            gradient,
          )}
        >
          {face.artUrl ? (
            <ArtImage
              src={face.artUrl}
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
      )}

      {/* Type line + rarity gem */}
      <div
        className={cn(
          "relative z-10 flex items-center justify-between gap-2 rounded-md px-3 py-1.5 text-[11px]",
          typeLineClass,
        )}
      >
        <span className="truncate font-display tracking-wide">
          {buildTypeLine({
            supertype: face.supertype,
            cardType: face.cardType,
            subtypes: face.subtypes,
          })}
        </span>
        {rarity ? <RarityGem rarity={rarity} /> : null}
      </div>

      {/* Rules + flavor */}
      <div
        className={cn(
          "relative z-10 flex flex-1 flex-col gap-2 rounded-md px-3 py-2 text-xs leading-5",
          rulesPanelClass,
        )}
      >
        <p className="whitespace-pre-line">
          {face.rulesText?.trim() ? (
            renderRulesText(face.rulesText)
          ) : (
            <span className="text-subtle italic">Rules text appears here.</span>
          )}
        </p>
        {face.flavorText?.trim() ? (
          <p className="border-t border-border/40 pt-2 italic text-subtle">
            {face.flavorText}
          </p>
        ) : null}
        {(showPT || showLoyalty || showDefense) && (
          <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-border/40 pt-2">
            {showPT ? (
              <Stat
                label="P/T"
                value={`${face.power ?? "—"} / ${face.toughness ?? "—"}`}
              />
            ) : null}
            {showLoyalty ? (
              <Stat label="Loyalty" value={face.loyalty ?? "—"} />
            ) : null}
            {showDefense ? (
              <Stat label="Defense" value={face.defense ?? "—"} />
            ) : null}
          </div>
        )}
      </div>

      {/* Footer */}
      <div
        className={cn(
          "relative z-10 flex items-center justify-between text-[10px] uppercase tracking-wider",
          footerTextClass,
        )}
      >
        <span className="truncate">
          {face.artistCredit?.trim() ? `Art: ${face.artistCredit}` : "Art: Unknown"}
        </span>
        <span className="font-display tracking-widest">CardForge</span>
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

function RarityGem({ rarity }: { rarity: Rarity }) {
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
