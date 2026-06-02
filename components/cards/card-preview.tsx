"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import { RotateCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { ManaCostGlyphs } from "@/components/cards/mana-cost-glyphs";
import { SetSymbol } from "@/components/cards/set-symbol";
import { FrameLayer, pickFrameColorKey } from "@/components/cards/frame-layer";
import { rulesFontTier, RULES_SIZE_PCT_BY_TIER } from "@/lib/cards/render-tiers";
import {
  buildTypeLine,
  normalizeFrameTemplate,
  parseChapters,
  showsDefense,
  showsLoyalty,
  showsPowerToughness,
  type SagaChapter,
} from "@/lib/cards/card-display";
import {
  getFrameProfile,
  resolveColorAsset,
  type FrameProfile,
  type Rect,
  type SlotAlign,
  type StatSlot,
  type TextSlot,
} from "@/lib/cards/template-layout";
import type {
  ArtPosition,
  CardBackFace,
  CardFinish,
  CardType,
  ColorIdentity,
  FrameStyle,
  FrameTemplate,
  Rarity,
} from "@/types/card";

// ---------------------------------------------------------------------------
// CardPreview — the canonical card visual, shared by the creator + gallery.
//
// Every region (title, type line, rules box, P/T, loyalty, footer) is drawn at
// the exact card-relative coordinates the chosen MSE frame paints its plates,
// pulled from the per-frame profile in lib/cards/template-layout.ts. The card
// root is a CSS container, so font sizes given as a fraction of card width
// (`cqw`) scale with the card — and the Satori bake (card-image.tsx) reads the
// SAME profile, so the editor preview and the exported PNG match pixel for
// pixel.
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
  /** Optional back-face content. When set, the preview renders a flip button
   *  and supports a 3D flip animation between the two faces. */
  backFace?: CardBackFace | null;
};

type CardPreviewProps = CardPreviewData & {
  className?: string;
  /** When true, suppress hover lift / animations (used inside the editor). */
  staticInEditor?: boolean;
  /** Controlled face. When omitted, the preview manages its own flip state. */
  face?: "front" | "back";
  onFaceChange?: (next: "front" | "back") => void;
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

// MPlantin is the real MTG card font, loaded as a web font in globals.css. The
// Satori bake renders every piece of card text in MPlantin, so the preview uses
// it for ALL card text too (title, type, rules, footer, stats) — keeping the
// editor preview and the exported PNG pixel-identical. The serifs are fallbacks
// for the brief moment before the web font loads.
const CARD_FONT = '"MPlantin", Georgia, "Times New Roman", serif';

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
  const template = normalizeFrameTemplate(frameStyle?.template);
  const layout = getFrameProfile(template);
  const finish: CardFinish = frameStyle?.finish ?? "regular";

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

  const [internalFace, setInternalFace] = useState<"front" | "back">("front");
  const currentFace = face ?? internalFace;
  const toggleFace = () => {
    const next = currentFace === "front" ? "back" : "front";
    if (onFaceChange) onFaceChange(next);
    else setInternalFace(next);
  };

  const faceProps = {
    template,
    colorIdentity: colorIdentity ?? [],
    rarity: rarity ?? null,
    layout,
    finish,
    staticInEditor,
  } as const;

  return (
    <div
      className={cn(
        "group relative w-full overflow-hidden bg-[#101015] shadow-[0_18px_60px_-30px_rgba(0,0,0,0.85)] transition-transform",
        // Battle frames are landscape (7:5); every other frame is the 5:7 card.
        layout.orientation === "landscape" ? "aspect-[7/5]" : "aspect-[5/7]",
        staticInEditor
          ? ""
          : "hover:-translate-y-1 hover:shadow-[0_24px_80px_-30px_rgba(120,80,220,0.4)]",
        className,
      )}
      style={{ containerType: "inline-size", borderRadius: "4.7cqw" }}
    >
      {backFaceData ? (
        <div
          className="relative h-full w-full"
          style={{ perspective: "1400px" }}
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
              <CardFace face={frontFace} {...faceProps} />
            </div>
            <div
              className="absolute inset-0"
              style={{
                backfaceVisibility: "hidden",
                transform: "rotateY(180deg)",
              }}
              aria-hidden={currentFace === "front"}
            >
              <CardFace face={backFaceData} {...faceProps} />
            </div>
          </div>
        </div>
      ) : (
        <CardFace face={frontFace} {...faceProps} />
      )}

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
// CardFace — one complete face: art (under frame), the frame PNG, the painted-
// slot text + stats, and the premium-finish overlays. Rendered once for a
// single-face card, twice inside the flip rotor for a DFC.
// ---------------------------------------------------------------------------

function CardFace({
  face,
  template,
  colorIdentity,
  rarity,
  layout,
  finish,
  staticInEditor,
}: {
  face: FaceData;
  template: FrameTemplate;
  colorIdentity: ColorIdentity[];
  rarity: Rarity | null;
  layout: FrameProfile;
  finish: CardFinish;
  staticInEditor: boolean;
}) {
  const colorKey = pickFrameColorKey(colorIdentity);
  const safeTitle = face.title?.trim() || "Untitled Card";
  const showCost =
    !layout.hideCost && face.cardType !== "land" && Boolean(face.cost?.trim());

  const showPT =
    Boolean(layout.pt) &&
    showsPowerToughness(face.cardType) &&
    Boolean(face.power || face.toughness);
  const showLoyalty =
    Boolean(layout.loyalty) && showsLoyalty(face.cardType) && Boolean(face.loyalty);
  const showDefense =
    Boolean(layout.defense) && showsDefense(face.cardType) && Boolean(face.defense);

  const isFoil = finish === "foil";
  const isEtched = finish === "etched";
  const isShowcase = finish === "showcase";

  const focalX = clamp(face.artPosition?.focalX ?? 0.5, 0, 1);
  const focalY = clamp(face.artPosition?.focalY ?? 0.5, 0, 1);
  const scale = clamp(face.artPosition?.scale ?? 1, 0.5, 4);

  const rulesSizePct =
    RULES_SIZE_PCT_BY_TIER[rulesFontTier(face.rulesText, face.flavorText)];
  const hasRulesContent = Boolean(
    face.rulesText?.trim() || face.flavorText?.trim(),
  );

  return (
    <div className="absolute inset-0">
      {/* Art — below the frame, in the transparent cut-out. */}
      <div
        aria-hidden
        className="absolute overflow-hidden"
        style={{ ...rectStyle(layout.artSlot), zIndex: 0 }}
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
          <div
            className="flex h-full w-full items-center justify-center"
            style={{
              background:
                "radial-gradient(circle at 50% 40%, #2a2a33, #16161c 70%)",
            }}
          >
            <span
              className="font-display uppercase text-subtle"
              style={{ fontSize: cqw(0.022), letterSpacing: "0.3em" }}
            >
              Add art
            </span>
          </div>
        )}
      </div>

      {/* Frame PNG — above the art so its painted slot border is on top. */}
      <FrameLayer template={template} colorIdentity={colorIdentity} zIndex={5} />

      {/* Stat overlays — P/T, loyalty, defense. */}
      {showPT && layout.pt ? (
        <StatOverlay
          slot={layout.pt}
          value={`${face.power ?? "—"}/${face.toughness ?? "—"}`}
          colorKey={colorKey}
        />
      ) : null}
      {showLoyalty && layout.loyalty ? (
        <StatOverlay
          slot={layout.loyalty}
          value={String(face.loyalty)}
          colorKey={colorKey}
        />
      ) : null}
      {showDefense && layout.defense ? (
        <StatOverlay
          slot={layout.defense}
          value={String(face.defense)}
          colorKey={colorKey}
        />
      ) : null}

      {/* Title band — name (left) + mana cost (right). */}
      <BandSlot slot={layout.title} italic={isShowcase}>
        <span style={ELLIPSIS} title={safeTitle}>
          {safeTitle}
        </span>
        {showCost ? <ManaCostGlyphs cost={face.cost} size="sm" /> : null}
      </BandSlot>

      {/* Type band — type line (left) + rarity set-symbol (right). */}
      <BandSlot slot={layout.type}>
        <span style={ELLIPSIS}>
          {buildTypeLine({
            supertype: face.supertype,
            cardType: face.cardType,
            subtypes: face.subtypes,
          })}
        </span>
        {rarity ? <SetSymbol rarity={rarity} size={symbolPx(layout)} /> : null}
      </BandSlot>

      {/* Rules — Saga chapter rail, otherwise the normal rules + flavor box. */}
      {layout.chapters ? (
        <ChapterRail
          slot={layout.chapters}
          chapters={parseChapters(face.rulesText)}
        />
      ) : (
      <div
        style={{
          ...rectStyle(layout.rules.rect),
          zIndex: 20,
          display: "flex",
          flexDirection: "column",
          alignItems: "stretch",
          justifyContent: vJustify(layout.rules.vAlign ?? "start"),
          overflow: "hidden",
          padding: "1.5cqw 0.5cqw",
          gap: "1.4cqw",
          fontFamily: CARD_FONT,
          fontSize: cqw(rulesSizePct),
          lineHeight: layout.rules.lineHeight ?? 1.3,
          color: layout.rules.colorHex,
          textAlign: "center",
          ...(layout.rules.backdropHex && hasRulesContent
            ? {
                background: layout.rules.backdropHex,
                borderRadius: "1.5cqw",
              }
            : {}),
        }}
      >
        {face.rulesText?.trim() ? (
          <div style={{ whiteSpace: "pre-line" }}>
            {renderRulesText(face.rulesText)}
          </div>
        ) : staticInEditor ? (
          // Editor-only hint; never shown in the gallery preview or the bake.
          <span style={{ fontStyle: "italic", opacity: 0.55 }}>
            Rules text appears here.
          </span>
        ) : null}
        {face.flavorText?.trim() ? (
          <div
            style={{
              fontStyle: "italic",
              opacity: 0.85,
              borderTop: `1px solid ${layout.rules.colorHex}44`,
              paddingTop: "1.2cqw",
              marginTop: "0.4cqw",
            }}
          >
            {face.flavorText}
          </div>
        ) : null}
      </div>
      )}

      {/* Footer — artist credit + brand. */}
      {layout.footer ? (
        <div
          style={{
            ...rectStyle(layout.footer.rect),
            zIndex: 20,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "2cqw",
            fontFamily: CARD_FONT,
            fontSize: cqw(layout.footer.sizePct),
            color: layout.footer.colorHex,
            letterSpacing: `${layout.footer.letterSpacingEm ?? 0}em`,
            textTransform: layout.footer.uppercase ? "uppercase" : "none",
          }}
        >
          <span style={ELLIPSIS}>
            {face.artistCredit?.trim() ? `Art: ${face.artistCredit}` : "Art: Unknown"}
          </span>
          <span style={{ flexShrink: 0 }}>Spellwright</span>
        </div>
      ) : null}

      {/* Premium finish: foil shimmer. */}
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

      {/* Premium finish: etched gold inner border + faint cross-hatch. */}
      {isEtched ? (
        <>
          <div
            aria-hidden
            className="pointer-events-none absolute inset-[3%] z-30 rounded-[3cqw] border-2"
            style={{
              borderImage:
                "linear-gradient(135deg, #f3d57c 0%, #d4a64a 50%, #f3d57c 100%) 1",
              borderImageSlice: 1,
            }}
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 z-30 mix-blend-overlay opacity-20"
            style={{
              backgroundImage:
                "repeating-linear-gradient(45deg, rgba(255,255,255,0.18) 0 1px, transparent 1px 6px), repeating-linear-gradient(-45deg, rgba(255,255,255,0.12) 0 1px, transparent 1px 6px)",
            }}
          />
        </>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// BandSlot — a single-line band (title or type) with a left text element and
// an optional right element (mana cost / set symbol) at the same baseline.
// ---------------------------------------------------------------------------

function BandSlot({
  slot,
  italic,
  children,
}: {
  slot: TextSlot;
  italic?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        ...rectStyle(slot.rect),
        zIndex: 20,
        display: "flex",
        alignItems: "center",
        // "center"/"end" align the single element (e.g. a centered token title);
        // the default spreads the name + cost / type + symbol to the edges.
        justifyContent:
          slot.align === "center"
            ? "center"
            : slot.align === "end"
              ? "flex-end"
              : "space-between",
        gap: "2cqw",
        fontFamily: CARD_FONT,
        fontSize: cqw(slot.sizePct),
        fontWeight: slot.weight ?? 600,
        fontStyle: italic || slot.italic ? "italic" : "normal",
        letterSpacing: `${slot.letterSpacingEm ?? 0}em`,
        textTransform: slot.uppercase ? "uppercase" : "none",
        color: slot.colorHex,
        ...(slot.shadowCss ? { textShadow: slot.shadowCss } : {}),
      }}
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// StatOverlay — P/T, loyalty, or defense. Renders the optional plate PNG or a
// drawn badge behind the value, then the value centered on top.
// ---------------------------------------------------------------------------

function StatOverlay({
  slot,
  value,
  colorKey,
}: {
  slot: StatSlot;
  value: string;
  colorKey: string;
}) {
  return (
    <div
      className="pointer-events-none absolute flex items-center justify-center"
      style={{ ...rectStyle(slot.rect), zIndex: 15 }}
    >
      {slot.plateAssetPathTemplate ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={resolveColorAsset(slot.plateAssetPathTemplate, colorKey)}
          alt=""
          aria-hidden
          className="absolute inset-0 h-full w-full object-fill"
        />
      ) : slot.badgeColorHex ? (
        <div
          aria-hidden
          className="absolute"
          style={{
            inset: "8% 12%",
            background: slot.badgeColorHex,
            borderRadius: "42%",
            boxShadow: "0 0.4cqw 1cqw rgba(0,0,0,0.45)",
          }}
        />
      ) : null}
      <span
        className="relative"
        style={{
          fontFamily: CARD_FONT,
          fontSize: cqw(slot.sizePct),
          fontWeight: slot.weight ?? 700,
          color: slot.colorHex,
          ...(slot.shadowCss ? { textShadow: slot.shadowCss } : {}),
        }}
      >
        {value}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ChapterRail — the Saga left rail. Each parsed chapter is an equal-height row:
// a Roman-numeral marker badge + the ability text, with dividers between rows.
// ---------------------------------------------------------------------------

function ChapterRail({
  slot,
  chapters,
}: {
  slot: NonNullable<FrameProfile["chapters"]>;
  chapters: SagaChapter[];
}) {
  return (
    <div
      style={{
        ...rectStyle(slot.rect),
        zIndex: 20,
        display: "flex",
        flexDirection: "column",
      }}
    >
      {chapters.length > 0 ? (
        chapters.map((ch, i) => (
          <div
            key={i}
            style={{
              flex: 1,
              minHeight: 0,
              display: "flex",
              alignItems: "center",
              gap: "2cqw",
              padding: "0.8cqw 0.4cqw",
              overflow: "hidden",
              borderBottom:
                i < chapters.length - 1
                  ? `1px solid ${slot.dividerHex}`
                  : "none",
            }}
          >
            <div
              style={{
                flexShrink: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                minWidth: cqw(slot.sizePct * 1.7),
                height: cqw(slot.sizePct * 1.7),
                padding: "0 0.8cqw",
                borderRadius: "999px",
                background: slot.markerFillHex,
                color: slot.markerTextHex,
                fontFamily: CARD_FONT,
                fontSize: cqw(slot.sizePct * 0.82),
                fontWeight: 700,
              }}
            >
              {ch.marker}
            </div>
            <div
              style={{
                flex: 1,
                minWidth: 0,
                fontFamily: CARD_FONT,
                fontSize: cqw(slot.sizePct),
                lineHeight: 1.22,
                color: slot.textColorHex,
                overflow: "hidden",
              }}
            >
              {ch.text}
            </div>
          </div>
        ))
      ) : (
        <span
          style={{
            margin: "auto",
            padding: "0 4cqw",
            fontStyle: "italic",
            fontFamily: CARD_FONT,
            fontSize: cqw(slot.sizePct),
            color: slot.textColorHex,
            opacity: 0.5,
            textAlign: "center",
          }}
        >
          Add chapters as I — / II — / III — lines.
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

const ELLIPSIS: CSSProperties = {
  overflow: "hidden",
  whiteSpace: "nowrap",
  textOverflow: "ellipsis",
  minWidth: 0,
};

function rectStyle(rect: Rect): CSSProperties {
  return {
    position: "absolute",
    top: `${rect.topPct}%`,
    left: `${rect.leftPct}%`,
    width: `${rect.widthPct}%`,
    height: `${rect.heightPct}%`,
  };
}

// Font size as container-query width units, so text scales with the card.
function cqw(pct: number): string {
  return `${(pct * 100).toFixed(3)}cqw`;
}

function vJustify(align: SlotAlign): string {
  return align === "center" ? "center" : align === "end" ? "flex-end" : "flex-start";
}

// The set-symbol component takes a pixel size; approximate from the type-band
// font (the preview rescales responsively, so this only needs to be close).
function symbolPx(layout: FrameProfile): number {
  return Math.round((layout.symbolSizePct ?? layout.type.sizePct) * 360);
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
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
      <em key="kw" className="font-medium not-italic text-current">
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
      <span key={`r-${n++}`} className="italic opacity-70">
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
