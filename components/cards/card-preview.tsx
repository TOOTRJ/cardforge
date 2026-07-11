"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import { RotateCw } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ManaCostGlyphs,
  PipOverrideImg,
} from "@/components/cards/mana-cost-glyphs";
import {
  pipOverrideForSuffix,
  type PipOverrides,
} from "@/lib/pips/override";
import { SetSymbol } from "@/components/cards/set-symbol";
import {
  FrameLayer,
  pickFrameColorKey,
  webpVariant,
} from "@/components/cards/frame-layer";
import { fitRulesSizePct, fitSingleLineSizePct } from "@/lib/cards/render-tiers";
import {
  tokenizeRulesText,
  groupTightRuns,
  type RulesItem,
} from "@/lib/cards/rules-text";
import {
  buildTypeLine,
  normalizeFrameTemplate,
  showsDefense,
  showsLoyalty,
  showsPowerToughness,
  type LoyaltyAbility,
  type SagaChapter,
} from "@/lib/cards/card-display";
import {
  resolveLoyaltyRows,
  resolveSagaChapters,
} from "@/lib/cards/face-content";
import {
  SAGA_MARKER_POINTS,
  loyaltyBadgeAssetFor,
  loyaltyBadgeShapeFor,
  resolveColorAsset,
  type FrameProfile,
  type Rect,
  type SlotAlign,
  type StatSlot,
  type TextSlot,
} from "@/lib/cards/template-layout";
import {
  resolveFrameProfile,
  type FrameProfileOverridesMap,
} from "@/lib/cards/profile-override";
import type {
  ArtPosition,
  CardBackFace,
  CardFinish,
  CardType,
  CardWatermark,
  ColorIdentity,
  FaceContent,
  FrameStyle,
  FrameTemplate,
  Rarity,
} from "@/types/card";
import {
  basicLandManaKey,
  resolveWatermark,
  watermarkHeightFraction,
  watermarkInk,
  watermarkOpacity,
} from "@/lib/cards/watermark";

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
  /** Set symbol the card displays (from its primary set). An uploaded image
   *  (setIconUrl) wins over a preset Keyrune code (setIconCode); when both are
   *  absent the default rarity-tinted PipGlyph mark renders. */
  setIconUrl?: string | null;
  setIconCode?: string | null;
  /** Structured loyalty/saga rows (cards.face_content). When present, the
   *  chapter rail / loyalty rows render from it; absent/null falls back to
   *  parsing rulesText — the two are round-trip equivalent
   *  (lib/cards/face-content.ts), so legacy cards render identically. */
  faceContent?: FaceContent | null;
  /** Design watermark behind the rules text (cards.watermark). Front face
   *  only; suppressed on saga (chapter rail) and planeswalker (ability rows)
   *  frames, matching printed cards. */
  watermark?: CardWatermark | null;
  /** Optional back-face content. When set, the preview renders a flip button
   *  and supports a 3D flip animation between the two faces. */
  backFace?: CardBackFace | null;
  /** v2 back face: a full referenced card rendered on the flip with its OWN
   *  frame / colour / rarity / art (complete customisation). Takes precedence
   *  over the legacy `backFace` jsonb, which shares the front's frame. */
  backCard?: CardPreviewData | null;
  /** The card OWNER's custom pip icons — cost pips render these instead of
   *  the standard mana-font glyphs (preview AND bake read this field). */
  pipOverrides?: PipOverrides | null;
  /** Admin frame-layout overrides (frame_profile_overrides table), keyed by
   *  template — merged over the code profiles by resolveFrameProfile so the
   *  live preview and the Satori bake always agree. Absent = code defaults. */
  profileOverrides?: FrameProfileOverridesMap | null;
  /** The OWNER's custom footer mark (profiles.export_watermark_text, paid
   *  perk) — prints footer-right where the hardcoded "PipGlyph" used to sit
   *  (removed in layout v19). Null/absent = blank. */
  footerWatermark?: string | null;
};

type CardPreviewProps = CardPreviewData & {
  className?: string;
  /** When true, suppress hover lift / animations (used inside the editor). */
  staticInEditor?: boolean;
  /** Controlled face. When omitted, the preview manages its own flip state. */
  face?: "front" | "back";
  onFaceChange?: (next: "front" | "back") => void;
  /** When true (and the card has a flippable back face), the WHOLE card is a
   *  click/tap target that flips it, with a hover hint prompting the user —
   *  instead of the small corner flip button. Used in the editor preview. */
  flipOnClick?: boolean;
};

// MPlantin is the real MTG card font, loaded as a web font in globals.css. The
// Satori bake renders every piece of card text in MPlantin, so the preview uses
// it for ALL card text too (title, type, rules, footer, stats) — keeping the
// editor preview and the exported PNG pixel-identical. The serifs are fallbacks
// for the brief moment before the web font loads.
const CARD_FONT = '"MPlantin", Georgia, "Times New Roman", serif';

// Display face for titles, type lines, footer, and stat values — an OFL
// Beleren stand-in (CardDisplay, declared in globals.css), falling back to
// MPlantin then serifs before it loads. A slot's `font` field selects display
// vs the MPlantin body font; the Satori bake reads the same `font` field, so
// preview and PNG stay identical.
const DISPLAY_FONT = '"CardDisplay", "MPlantin", Georgia, "Times New Roman", serif';

function fontFor(font: TextSlot["font"]): string {
  return font === "display" ? DISPLAY_FONT : CARD_FONT;
}

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
  /** Structured loyalty/saga rows — null falls back to rulesText parsing.
   *  Only the FRONT face (and a v2 back card) carries this; inline second
   *  faces never render loyalty/chapter rails. */
  faceContent: FaceContent | null;
  /** Design watermark — front face (and v2 back card) only. */
  watermark: CardWatermark | null;
};

// The adventure spell shown inline on an Adventure frame's left page. Sourced
// from the card's back-face content (name / cost / type / rules) — no art or
// P/T, since the adventure shares the creature's art and is an instant/sorcery.
type AdventureData = {
  title: string | null;
  cost: string | null;
  cardType: CardType | null;
  supertype: string | null;
  subtypes: string[];
  rulesText: string | null;
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
  setIconUrl,
  setIconCode,
  faceContent,
  watermark,
  backFace,
  pipOverrides,
  profileOverrides,
  footerWatermark,
  face,
  onFaceChange,
  flipOnClick = false,
  backCard,
  className,
  staticInEditor = false,
}: CardPreviewProps) {
  const template = normalizeFrameTemplate(frameStyle?.template);
  const layout = resolveFrameProfile(template, profileOverrides);
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
    faceContent: faceContent ?? null,
    watermark: watermark ?? null,
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
        // Inline second faces never carry structured loyalty/saga content
        // or their own watermark.
        faceContent: null,
        watermark: null,
      }
    : null;

  // Adventure frames render their back-face content as an inline sub-panel (the
  // left storybook page), NOT as a flippable second face — both show at once.
  const isAdventure = Boolean(layout.adventure);
  const adventureData: AdventureData | null =
    isAdventure && backFace
      ? {
          title: backFace.title ?? null,
          cost: backFace.cost ?? null,
          cardType: backFace.card_type ?? null,
          supertype: backFace.supertype ?? null,
          subtypes: backFace.subtypes ?? [],
          rulesText: backFace.rules_text ?? null,
        }
      : null;
  // Multi-panel frames (flip / split / aftermath) also render their back-face
  // content inline (rotated), not as a flippable face.
  const secondFaceData: FaceData | null = layout.secondFace
    ? backFaceData
    : null;

  // v2 back face: a full referenced card, drawn with its OWN frame/colour/
  // rarity/art. Built here so the flip's second face is fully independent.
  const backCardFace: FaceData | null = backCard
    ? {
        title: backCard.title ?? null,
        cost: backCard.cost ?? null,
        cardType: backCard.cardType ?? null,
        supertype: backCard.supertype ?? null,
        subtypes: backCard.subtypes ?? [],
        rulesText: backCard.rulesText ?? null,
        flavorText: backCard.flavorText ?? null,
        power: backCard.power ?? null,
        toughness: backCard.toughness ?? null,
        loyalty: backCard.loyalty ?? null,
        defense: backCard.defense ?? null,
        artistCredit: backCard.artistCredit ?? null,
        artUrl: backCard.artUrl ?? null,
        artPosition: backCard.artPosition ?? {},
        faceContent: backCard.faceContent ?? null,
        watermark: backCard.watermark ?? null,
      }
    : null;
  const backCardTemplate = normalizeFrameTemplate(backCard?.frameStyle?.template);
  const backCardFaceProps = backCard
    ? ({
        template: backCardTemplate,
        colorIdentity: backCard.colorIdentity ?? [],
        rarity: backCard.rarity ?? null,
        layout: resolveFrameProfile(backCardTemplate, backCard.profileOverrides ?? profileOverrides),
        finish: backCard.frameStyle?.finish ?? "regular",
        staticInEditor,
        setIconUrl: backCard.setIconUrl ?? null,
        setIconCode: backCard.setIconCode ?? null,
        pipOverrides: backCard.pipOverrides ?? pipOverrides ?? null,
        footerWatermark: backCard.footerWatermark ?? footerWatermark ?? null,
      } as const)
    : null;

  // The flippable second face: prefer the referenced card, fall back to the
  // legacy jsonb. Adventure/multi-panel frames render inline, so no flip.
  const flipBackFace = backCardFace ?? backFaceData;
  const showFlip =
    Boolean(flipBackFace) && !isAdventure && !layout.secondFace;

  const [internalFace, setInternalFace] = useState<"front" | "back">("front");
  const currentFace = face ?? internalFace;
  const toggleFace = () => {
    const next = currentFace === "front" ? "back" : "front";
    if (onFaceChange) onFaceChange(next);
    else setInternalFace(next);
  };
  // Whole-card click-to-flip (editor preview) vs the small corner button
  // (gallery / detail). Only meaningful when there's a flippable back face.
  const clickToFlip = showFlip && flipOnClick;

  const faceProps = {
    template,
    colorIdentity: colorIdentity ?? [],
    rarity: rarity ?? null,
    layout,
    finish,
    staticInEditor,
    setIconUrl: setIconUrl ?? null,
    setIconCode: setIconCode ?? null,
    pipOverrides: pipOverrides ?? null,
    footerWatermark: footerWatermark ?? null,
  } as const;

  return (
    <div
      className={cn(
        "group relative w-full overflow-hidden bg-[#101015] shadow-[0_18px_60px_-30px_rgba(0,0,0,0.85)] transition-transform",
        // Battle frames are landscape (7:5); every other frame is the 5:7 card.
        // card-corners* round only as much as a real card (~3.5%) so the frame's
        // own corner shows — no hard web-UI rounding cutting into the card.
        layout.orientation === "landscape"
          ? "aspect-[7/5] card-corners-landscape"
          : "aspect-[5/7] card-corners",
        staticInEditor
          ? ""
          : "hover:-translate-y-1 hover:shadow-[0_24px_80px_-30px_rgba(120,80,220,0.4)]",
        clickToFlip &&
          "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        className,
      )}
      style={{ containerType: "inline-size" }}
      {...(clickToFlip
        ? {
            role: "button",
            tabIndex: 0,
            "aria-label":
              currentFace === "front"
                ? "Show the back face"
                : "Show the front face",
            onClick: () => toggleFace(),
            onKeyDown: (event: React.KeyboardEvent) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                toggleFace();
              }
            },
          }
        : {})}
    >
      {showFlip && flipBackFace ? (
        <div
          className="relative h-full w-full"
          style={{ perspective: "1400px" }}
        >
          <div
            className="relative h-full w-full transition-transform duration-700 ease-[cubic-bezier(0.16,1,0.3,1)]"
            style={{
              transformStyle: "preserve-3d",
              transform:
                currentFace === "back" ? "rotateY(180deg)" : "rotateY(0deg)",
              willChange: "transform",
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
              <CardFace
                face={flipBackFace}
                {...(backCardFaceProps ?? faceProps)}
              />
            </div>
          </div>
        </div>
      ) : (
        <CardFace
          face={frontFace}
          adventure={adventureData}
          secondFace={secondFaceData}
          {...faceProps}
        />
      )}

      {/* Whole-card click-to-flip (editor): a hover hint prompts the user; the
          click itself is handled on the root element above. pointer-events-none
          so it never intercepts the click. */}
      {clickToFlip ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 z-40 flex justify-center px-3 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-background/85 px-3 py-1.5 text-[11px] font-medium text-foreground shadow-lg backdrop-blur-sm">
            <RotateCw className="h-3.5 w-3.5" aria-hidden />
            {currentFace === "front"
              ? "Click to see the back"
              : "Click to see the front"}
          </span>
        </div>
      ) : null}

      {/* Small corner flip button — gallery / detail pages (no whole-card click). */}
      {showFlip && !clickToFlip ? (
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
          className="absolute bottom-3 right-3 z-40 flex h-8 w-8 items-center justify-center rounded-full border border-border/80 bg-background/85 text-muted shadow-lg transition-colors hover:border-border-strong hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60"
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
  setIconUrl = null,
  setIconCode = null,
  pipOverrides = null,
  adventure = null,
  secondFace = null,
  footerWatermark = null,
}: {
  face: FaceData;
  template: FrameTemplate;
  colorIdentity: ColorIdentity[];
  rarity: Rarity | null;
  layout: FrameProfile;
  finish: CardFinish;
  staticInEditor: boolean;
  setIconUrl?: string | null;
  setIconCode?: string | null;
  pipOverrides?: PipOverrides | null;
  /** Adventure spell shown on the left storybook page (Adventure frames only). */
  adventure?: AdventureData | null;
  /** Back-face content for a rotated second face (flip / split / aftermath). */
  secondFace?: FaceData | null;
  /** The owner's custom footer mark; null = blank (layout v19). */
  footerWatermark?: string | null;
}) {
  const colorKey = pickFrameColorKey(colorIdentity);
  const safeTitle = face.title?.trim() || "Untitled Card";
  const showCost =
    !layout.hideCost && face.cardType !== "land" && Boolean(face.cost?.trim());

  const showPT =
    Boolean(layout.pt) &&
    showsPowerToughness(face.cardType, face.subtypes) &&
    Boolean(face.power || face.toughness);
  // In the editor the starting-loyalty shield shows even before a value is
  // typed (empty plate > invisible element); the gallery/bake require one.
  const showLoyalty =
    Boolean(layout.loyalty) &&
    showsLoyalty(face.cardType) &&
    Boolean(face.loyalty || staticInEditor);
  const showDefense =
    Boolean(layout.defense) && showsDefense(face.cardType) && Boolean(face.defense);

  const isFoil = finish === "foil";
  const isEtched = finish === "etched";
  const isShowcase = finish === "showcase";

  const focalX = clamp(face.artPosition?.focalX ?? 0.5, 0, 1);
  const focalY = clamp(face.artPosition?.focalY ?? 0.5, 0, 1);
  const scale = clamp(face.artPosition?.scale ?? 1, 0.5, 4);

  const aspect = layout.orientation === "landscape" ? 5 / 7 : 7 / 5;
  // Planeswalker ability rows spend ~20% of the box on the badge rail plus
  // per-row padding; narrow the rect handed to the fit estimate accordingly
  // (the same correction in both renderers keeps preview == bake).
  const usesLoyaltyRows =
    Boolean(layout.loyaltyRows) && showsLoyalty(face.cardType);
  const fitRect = usesLoyaltyRows
    ? {
        ...layout.rules.rect,
        widthPct: layout.rules.rect.widthPct * 0.78,
        heightPct: layout.rules.rect.heightPct * 0.88,
      }
    : layout.rules.rect;
  const rulesSizePct = fitRulesSizePct({
    rulesText: face.rulesText,
    flavorText: face.flavorText,
    rect: fitRect,
    baseSizePct: layout.rules.sizePct,
    lineHeight: layout.rules.lineHeight ?? 1.3,
    aspect,
  });
  // Planeswalker ability rows (badged loyalty costs, striped rows) when the
  // frame defines them and the card actually is a planeswalker. Structured
  // rows first, rules_text parsing as the legacy fallback.
  const loyaltyAbilities = usesLoyaltyRows
    ? resolveLoyaltyRows(face.faceContent, face.rulesText)
    : [];
  // Saga chapter rail content — same structured-first resolution.
  const sagaContent = layout.chapters
    ? resolveSagaChapters(face.faceContent, face.rulesText)
    : null;
  // Explicit watermark wins; basic lands (Plains/Island/…) automatically get
  // the authentic large mana symbol in the text box.
  const effectiveWatermark = resolveWatermark(
    face.watermark,
    face.cardType,
    face.subtypes,
  );
  // Basic lands (by subtype) print NO rules text — just the big symbol.
  // Keyed on the subtype, not the watermark, so an explicit override icon
  // suppresses the text the same way the automatic one does.
  const isBasicLand =
    basicLandManaKey(face.cardType, face.subtypes) !== null;
  const hasRulesContent =
    !isBasicLand &&
    Boolean(face.rulesText?.trim() || face.flavorText?.trim());

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

      {/* Second art — the second face's own window (split's right half,
          aftermath's sideways bottom window). Below the frame; rotates in
          place with the face, same as its text slots. */}
      {layout.secondFace?.artSlot && secondFace?.artUrl ? (
        <div
          aria-hidden
          className="absolute overflow-hidden"
          style={{
            ...rectStyle(layout.secondFace.artSlot),
            zIndex: 0,
            transform: `rotate(${layout.secondFace.rotation}deg)`,
            transformOrigin: "center",
          }}
        >
          <ArtImage
            src={secondFace.artUrl}
            focalX={clamp(secondFace.artPosition?.focalX ?? 0.5, 0, 1)}
            focalY={clamp(secondFace.artPosition?.focalY ?? 0.5, 0, 1)}
            scale={clamp(secondFace.artPosition?.scale ?? 1, 0.5, 4)}
            alt=""
          />
        </div>
      ) : null}

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
          value={String(face.loyalty ?? "")}
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

      {/* Title band — name (left) + mana cost (right). When the profile
          defines a costRect, the pips render in their OWN absolutely
          positioned box (right-aligned, vertically centered) so name and
          cost can be aligned independently in the layout editor. */}
      <BandSlot slot={layout.title} italic={isShowcase}>
        <span style={ELLIPSIS} title={safeTitle}>
          {safeTitle}
        </span>
        {showCost && !layout.costRect ? (
          <ManaCostGlyphs
            cost={face.cost}
            fontSize={pipFont(layout.costSizePct ?? layout.title.sizePct)}
            overrides={pipOverrides}
          />
        ) : null}
      </BandSlot>
      {showCost && layout.costRect ? (
        <div
          style={{
            ...rectStyle(layout.costRect),
            zIndex: 20,
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
          }}
        >
          <ManaCostGlyphs
            cost={face.cost}
            fontSize={pipFont(layout.costSizePct ?? layout.title.sizePct)}
            overrides={pipOverrides}
          />
        </div>
      ) : null}

      {/* Type band — type line (left) + rarity set-symbol (right). Long type
          lines shrink to fit on one line (fitSingleLineSizePct), matching how
          real cards condense e.g. "Legendary Artifact Creature — …". When the
          profile defines a symbolRect, the symbol renders in its OWN
          absolutely positioned box so it can be aligned independently. */}
      <BandSlot
        slot={{
          ...layout.type,
          sizePct: fitSingleLineSizePct({
            text: buildTypeLine({
              supertype: face.supertype,
              cardType: face.cardType,
              subtypes: face.subtypes,
            }),
            rect: layout.type.rect,
            baseSizePct: layout.type.sizePct,
            reservedPct: layout.symbolRect
              ? 0
              : (layout.symbolSizePct ?? layout.type.sizePct * 1.1) * 1.3,
          }),
        }}
      >
        <span style={ELLIPSIS}>
          {buildTypeLine({
            supertype: face.supertype,
            cardType: face.cardType,
            subtypes: face.subtypes,
          })}
        </span>
        {!layout.symbolRect ? (
          <SetSymbol
            rarity={rarity}
            iconUrl={setIconUrl}
            setCode={setIconCode}
            size={cqw(layout.symbolSizePct ?? layout.type.sizePct * 1.1)}
          />
        ) : null}
      </BandSlot>
      {layout.symbolRect ? (
        <div
          style={{
            ...rectStyle(layout.symbolRect),
            zIndex: 20,
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
          }}
        >
          <SetSymbol
            rarity={rarity}
            iconUrl={setIconUrl}
            setCode={setIconCode}
            size={cqw(layout.symbolSizePct ?? layout.type.sizePct * 1.1)}
          />
        </div>
      ) : null}

      {/* Rules — Saga chapter rail or planeswalker ability rows, otherwise the
          normal rules + flavor box. */}
      {/* Rules-box backdrop — split into its OWN layer so the watermark can
          sit between it and the text (backdrop z9 < watermark z10 < text
          z20). Previously the backdrop was the text container's background,
          which painted over the watermark — basic lands' big mana symbol
          vanished behind the tinted land text box. */}
      {layout.rules.backdropHex &&
      hasRulesContent &&
      !layout.chapters &&
      !(layout.loyaltyRows && loyaltyAbilities.length > 0) ? (
        <div
          aria-hidden
          style={{
            ...rectStyle(layout.rules.rect),
            zIndex: 9,
            background: layout.rules.backdropHex,
            borderRadius: "1.5cqw",
          }}
        />
      ) : null}

      {/* Design watermark — faint mark centered in the rules box, above the
          frame PNG but below every text layer. Suppressed where a rail
          replaces the box (saga chapters, planeswalker rows) — printed cards
          do the same (Scars watermarked everything EXCEPT basics + walkers). */}
      {effectiveWatermark && !layout.chapters && !usesLoyaltyRows ? (
        <div
          aria-hidden
          style={{
            ...rectStyle(layout.rules.rect),
            zIndex: 10,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "none",
            overflow: "hidden",
            opacity: watermarkOpacity(effectiveWatermark),
          }}
        >
          {effectiveWatermark.kind === "mana" ? (
            <i
              className={`ms ms-${effectiveWatermark.key}`}
              style={{
                fontSize: cqw(
                  // cqw() takes a width FRACTION (it does the ×100 itself);
                  // heightPct is % of card height, so scale by 0.01 and
                  // correct by the card aspect (ms glyphs are ~1em tall).
                  layout.rules.rect.heightPct *
                    0.01 *
                    watermarkHeightFraction(effectiveWatermark) *
                    (layout.orientation === "landscape" ? 5 / 7 : 7 / 5),
                ),
                color: watermarkInk(colorKey),
                lineHeight: 1,
              }}
            />
          ) : (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={
                effectiveWatermark.kind === "custom"
                  ? effectiveWatermark.url
                  : `/watermarks/${effectiveWatermark.key}.png`
              }
              alt=""
              style={{
                height: `${watermarkHeightFraction(effectiveWatermark) * 100}%`,
                width: "auto",
                maxWidth: "86%",
                objectFit: "contain",
              }}
            />
          )}
        </div>
      ) : null}

      {layout.chapters ? (
        <ChapterRail
          slot={layout.chapters}
          intro={sagaContent?.intro ?? null}
          chapters={sagaContent?.chapters ?? []}
        />
      ) : layout.loyaltyRows && loyaltyAbilities.length > 0 ? (
        <LoyaltyRows
          pipOverrides={pipOverrides}
          slot={layout.rules}
          rows={layout.loyaltyRows}
          abilities={loyaltyAbilities}
          sizePct={rulesSizePct}
        />
      ) : layout.loyaltyRows && usesLoyaltyRows && staticInEditor ? (
        // Editor-only: an empty planeswalker still shows the striped ability
        // rows (with a hint) instead of the bare art cut-out reading as a
        // black box. Never rendered in the gallery or the bake.
        <LoyaltyRows
          pipOverrides={pipOverrides}
          slot={layout.rules}
          rows={layout.loyaltyRows}
          abilities={[
            {
              cost: null,
              text: "Loyalty abilities appear here — add them on the Text & stats step.",
            },
            { cost: null, text: "" },
            { cost: null, text: "" },
          ]}
          sizePct={rulesSizePct}
          placeholder
        />
      ) : isBasicLand ? null : (
      <div
        style={{
          ...rectStyle(layout.rules.rect),
          zIndex: 20,
          display: "flex",
          flexDirection: "column",
          alignItems: "stretch",
          justifyContent: vJustify(layout.rules.vAlign ?? "start"),
          overflow: "hidden",
          padding: "1.2cqw 0.6cqw",
          gap: "1.2cqw",
          fontFamily: CARD_FONT,
          fontSize: cqw(rulesSizePct),
          lineHeight: layout.rules.lineHeight ?? 1.3,
          color: layout.rules.colorHex,
          textAlign: "left",
        }}
      >
        {face.rulesText?.trim() ? (
          <RulesBody text={face.rulesText} overrides={pipOverrides} />
        ) : staticInEditor ? (
          // Editor-only hint; never shown in the gallery preview or the bake.
          <span style={{ fontStyle: "italic", opacity: 0.55 }}>
            Rules text appears here.
          </span>
        ) : null}
        {face.flavorText?.trim() ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              rowGap: "0.4cqw",
              fontStyle: "italic",
              borderTop: `1px solid ${layout.rules.colorHex}44`,
              paddingTop: "1.2cqw",
              marginTop: "0.4cqw",
            }}
          >
            {face.flavorText.split(/\n/).filter((l) => l.trim()).map((line, i) => (
              <span key={i}>{line}</span>
            ))}
          </div>
        ) : null}
      </div>
      )}

      {/* Adventure spell — the left storybook page (Adventure frames). */}
      {layout.adventure && adventure ? (
        <AdventurePanel
          slot={layout.adventure}
          data={adventure}
          staticInEditor={staticInEditor}
          pipOverrides={pipOverrides}
        />
      ) : null}

      {/* Second face — the rotated bottom/right card (flip / split / aftermath). */}
      {layout.secondFace && secondFace ? (
        <SecondFacePanel
          slot={layout.secondFace}
          data={secondFace}
          aspect={aspect}
          pipOverrides={pipOverrides}
        />
      ) : null}

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
            fontFamily: fontFor(layout.footer.font),
            fontSize: cqw(layout.footer.sizePct),
            color: layout.footer.colorHex,
            letterSpacing: `${layout.footer.letterSpacingEm ?? 0}em`,
            textTransform: layout.footer.uppercase ? "uppercase" : "none",
          }}
        >
          <span style={ELLIPSIS}>
            {face.artistCredit?.trim() ? `Art: ${face.artistCredit}` : "Art: Unknown"}
          </span>
          {/* Footer-right: the owner's custom mark, or nothing — mirrors the
              bake (lib/render/card-image.tsx, layout v19). */}
          {footerWatermark ? (
            <span style={{ flexShrink: 0 }}>{footerWatermark}</span>
          ) : null}
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
        fontFamily: fontFor(slot.font),
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
      // Above the text layers (z20/21): printed cards draw the P/T plate and
      // the starting-loyalty shield OVER the text box edge, never under it.
      style={{ ...rectStyle(slot.rect), zIndex: 22 }}
    >
      {slot.plateAssetPathTemplate ? (
        // Browser-side WebP variant with PNG fallback; the bake resolves the
        // same template to the PNG master (lib/render/card-frames.ts).
        <picture>
          <source
            srcSet={webpVariant(
              resolveColorAsset(slot.plateAssetPathTemplate, colorKey),
            )}
            type="image/webp"
          />
          <img
            src={resolveColorAsset(slot.plateAssetPathTemplate, colorKey)}
            alt=""
            aria-hidden
            className="absolute inset-0 h-full w-full object-fill"
          />
        </picture>
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
          fontFamily: DISPLAY_FONT,
          fontSize: cqw(slot.sizePct),
          fontWeight: slot.weight ?? 700,
          color: slot.colorHex,
          ...(slot.valueDxEm || slot.valueDyEm
            ? {
                transform: `translate(${slot.valueDxEm ?? 0}em, ${slot.valueDyEm ?? 0}em)`,
              }
            : {}),
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
  intro,
  chapters,
}: {
  slot: NonNullable<FrameProfile["chapters"]>;
  intro: string | null;
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
      {intro ? (
        <div
          style={{
            flexShrink: 0,
            padding: `${cqw(slot.sizePct * 0.4)} ${cqw(slot.sizePct * 0.3)}`,
            borderBottom: `1px solid ${slot.dividerHex}`,
            fontFamily: CARD_FONT,
            fontStyle: "italic",
            fontSize: cqw(slot.sizePct * 0.9),
            lineHeight: 1.2,
            color: slot.textColorHex,
          }}
        >
          {intro}
        </div>
      ) : null}
      {chapters.length > 0 ? (
        chapters.map((ch, i) => (
          <div
            key={i}
            style={{
              flex: 1,
              minHeight: 0,
              display: "flex",
              alignItems: "center",
              // Size-relative so spacing matches the bake's ChapterBake exactly.
              gap: cqw(slot.sizePct * 0.6),
              padding: `${cqw(slot.sizePct * 0.3)} ${cqw(slot.sizePct * 0.2)}`,
              overflow: "hidden",
              borderBottom:
                i < chapters.length - 1
                  ? `1px solid ${slot.dividerHex}`
                  : "none",
            }}
          >
            <div
              style={{
                position: "relative",
                flexShrink: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                minWidth: cqw(slot.sizePct * 1.7),
                height: cqw(slot.sizePct * 1.9),
                padding: `0 ${cqw(slot.sizePct * 0.32)}`,
              }}
            >
              {/* The printed saga milestone crest: flat top, pointed bottom. */}
              <svg
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                aria-hidden
                style={{
                  position: "absolute",
                  inset: 0,
                  width: "100%",
                  height: "100%",
                }}
              >
                <polygon points={SAGA_MARKER_POINTS} fill={slot.markerFillHex} />
              </svg>
              <span
                style={{
                  position: "relative",
                  paddingBottom: cqw(slot.sizePct * 0.3),
                  color: slot.markerTextHex,
                  fontFamily: DISPLAY_FONT,
                  fontSize: cqw(slot.sizePct * 0.82),
                  fontWeight: 700,
                }}
              >
                {ch.marker}
              </span>
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
// AdventurePanel — the left storybook page of an Adventure frame. The adventure
// spell's name (+ cost) and type line sit on the page's colored bars (light ink
// with a soft shadow), and its rules sit on the cream page below (dark ink).
// Rendered inline beside the creature's own (right) rules box — both visible at
// once, so there's no flip.
// ---------------------------------------------------------------------------

function AdventurePanel({
  slot,
  data,
  staticInEditor,
  pipOverrides = null,
}: {
  slot: NonNullable<FrameProfile["adventure"]>;
  data: AdventureData;
  staticInEditor: boolean;
  pipOverrides?: PipOverrides | null;
}) {
  const name = data.title?.trim() || "Adventure";
  const typeLine = buildTypeLine({
    supertype: data.supertype,
    cardType: data.cardType,
    subtypes: data.subtypes,
  });
  const showCost = Boolean(data.cost?.trim());
  return (
    <>
      <BandSlot slot={slot.title}>
        <span style={ELLIPSIS} title={name}>
          {name}
        </span>
        {showCost ? (
          <ManaCostGlyphs
            cost={data.cost}
            fontSize={pipFont(slot.costSizePct ?? slot.title.sizePct)}
            overrides={pipOverrides}
          />
        ) : null}
      </BandSlot>
      <BandSlot slot={slot.type}>
        <span style={ELLIPSIS}>{typeLine}</span>
      </BandSlot>
      <div
        style={{
          ...rectStyle(slot.rules.rect),
          zIndex: 20,
          display: "flex",
          flexDirection: "column",
          justifyContent: vJustify(slot.rules.vAlign ?? "start"),
          overflow: "hidden",
          padding: "1cqw 0.6cqw",
          fontFamily: CARD_FONT,
          fontSize: cqw(
            fitRulesSizePct({
              rulesText: data.rulesText,
              flavorText: null,
              rect: slot.rules.rect,
              baseSizePct: slot.rules.sizePct,
              lineHeight: slot.rules.lineHeight ?? 1.25,
              aspect: 7 / 5,
            }),
          ),
          lineHeight: slot.rules.lineHeight ?? 1.25,
          color: slot.rules.colorHex,
          textAlign: "center",
        }}
      >
        {data.rulesText?.trim() ? (
          <RulesBody text={data.rulesText} overrides={pipOverrides} />
        ) : staticInEditor ? (
          <span style={{ fontStyle: "italic", opacity: 0.55 }}>
            Adventure rules (the back face).
          </span>
        ) : null}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// SecondFacePanel — the back-face content of a multi-panel frame, drawn inline
// and ROTATED in place (flip 180° / aftermath 90°). Each slot sits at its card
// coordinates; the transform spins the content without moving the box, matching
// how MSE prints a second card on the same piece of cardboard.
// ---------------------------------------------------------------------------

function SecondFacePanel({
  slot,
  data,
  aspect,
  pipOverrides = null,
}: {
  slot: NonNullable<FrameProfile["secondFace"]>;
  data: FaceData;
  aspect: number;
  pipOverrides?: PipOverrides | null;
}) {
  const rot = `rotate(${slot.rotation}deg)`;
  const name = data.title?.trim() || "Untitled";
  const typeLine = buildTypeLine({
    supertype: data.supertype,
    cardType: data.cardType,
    subtypes: data.subtypes,
  });
  const showCost = Boolean(slot.costSizePct) && Boolean(data.cost?.trim());
  const showPT = Boolean(slot.pt) && Boolean(data.power || data.toughness);
  const rulesSizePct = fitRulesSizePct({
    rulesText: data.rulesText,
    flavorText: null,
    rect: slot.rules.rect,
    baseSizePct: slot.rules.sizePct,
    lineHeight: slot.rules.lineHeight ?? 1.25,
    aspect,
  });
  return (
    <>
      <div
        style={{
          ...rectStyle(slot.title.rect),
          zIndex: 21,
          transform: rot,
          transformOrigin: "center",
          display: "flex",
          alignItems: "center",
          justifyContent: showCost ? "space-between" : "flex-start",
          gap: "2cqw",
          fontFamily: DISPLAY_FONT,
          fontSize: cqw(slot.title.sizePct),
          fontWeight: slot.title.weight ?? 600,
          color: slot.title.colorHex,
        }}
      >
        <span style={ELLIPSIS} title={name}>
          {name}
        </span>
        {showCost ? (
          <ManaCostGlyphs
            cost={data.cost}
            fontSize={pipFont(slot.costSizePct ?? slot.title.sizePct)}
            overrides={pipOverrides}
          />
        ) : null}
      </div>
      <div
        style={{
          ...rectStyle(slot.type.rect),
          zIndex: 21,
          transform: rot,
          transformOrigin: "center",
          display: "flex",
          alignItems: "center",
          fontFamily: DISPLAY_FONT,
          fontSize: cqw(slot.type.sizePct),
          fontWeight: slot.type.weight ?? 600,
          color: slot.type.colorHex,
        }}
      >
        <span style={ELLIPSIS}>{typeLine}</span>
      </div>
      <div
        style={{
          ...rectStyle(slot.rules.rect),
          zIndex: 21,
          transform: rot,
          transformOrigin: "center",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          overflow: "hidden",
          padding: "0.8cqw 1.2cqw",
          fontFamily: CARD_FONT,
          fontSize: cqw(rulesSizePct),
          lineHeight: slot.rules.lineHeight ?? 1.25,
          color: slot.rules.colorHex,
          textAlign: "center",
        }}
      >
        {data.rulesText?.trim() ? (
          <RulesBody text={data.rulesText} overrides={pipOverrides} />
        ) : null}
      </div>
      {showPT && slot.pt ? (
        <div
          style={{
            ...rectStyle(slot.pt.rect),
            zIndex: 21,
            transform: rot,
            transformOrigin: "center",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: DISPLAY_FONT,
            fontSize: cqw(slot.pt.sizePct),
            fontWeight: slot.pt.weight ?? 700,
            color: slot.pt.colorHex,
            ...(slot.pt.shadowCss ? { textShadow: slot.pt.shadowCss } : {}),
          }}
        >
          {`${data.power ?? "—"}/${data.toughness ?? "—"}`}
        </div>
      ) : null}
    </>
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

// mana-font's `.ms-cost` disc renders at 1.3em for a given font-size; profiles
// specify the DISC diameter, so the CSS font-size is the diameter ÷ 1.3. The
// bake's ManaGem draws the disc at the diameter directly — same visual size.
const MS_COST_DISC_EM = 1.3;
function pipFont(discPct: number): string {
  return cqw(discPct / MS_COST_DISC_EM);
}

function vJustify(align: SlotAlign): string {
  return align === "center" ? "center" : align === "end" ? "flex-end" : "flex-start";
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

// RulesBody — the shared rules-text renderer. Lays each paragraph out as a
// flex-wrap row of word + inline-mana items (lib/cards/rules-text.ts), so inline
// {T}/{G} render as real pips and reminder text / ability words are italicized.
// The Satori bake (RulesBodyBake) consumes the SAME item stream, so the editor
// preview and the exported PNG match.
function RulesBody({
  text,
  overrides = null,
}: {
  text: string;
  overrides?: PipOverrides | null;
}) {
  const paragraphs = tokenizeRulesText(text);
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        rowGap: "0.5em",
        width: "100%",
      }}
    >
      {paragraphs.map((items, pi) => (
        <div
          key={pi}
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "flex-start",
            columnGap: "0.26em",
            rowGap: "0.1em",
            minHeight: items.length === 0 ? "0.7em" : undefined,
          }}
        >
          {groupTightRuns(items).map((run, ri) => (
            <span
              key={ri}
              style={{
                display: "inline-flex",
                alignItems: "center",
                whiteSpace: "nowrap",
              }}
            >
              {run.map((it, i) => (
                <RulesRunItem
                  key={i}
                  item={it}
                  overrides={overrides}
                  pipGapBefore={i > 0 && it.t === "m" && run[i - 1].t === "m"}
                />
              ))}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

// One item inside an unbreakable run. Inline pips size so the visible disc is
// 0.92em (mana-font's 1.3em disc ÷ the 0.708em font), matching the bake's
// ManaGem; reminder/ability emphasis is italic at full ink, like print.
function RulesRunItem({
  item,
  pipGapBefore,
  overrides = null,
}: {
  item: RulesItem;
  pipGapBefore: boolean;
  overrides?: PipOverrides | null;
}) {
  if (item.t === "m") {
    const overrideSrc = pipOverrideForSuffix(item.suffix, overrides);
    if (overrideSrc) {
      return (
        <PipOverrideImg
          src={overrideSrc}
          fontSizeEm={0.92 / MS_COST_DISC_EM}
          style={pipGapBefore ? { marginLeft: "0.08em" } : undefined}
        />
      );
    }
    return (
      <i
        aria-hidden
        className={cn("ms ms-cost ms-shadow", `ms-${item.suffix}`)}
        style={{
          fontSize: `${(0.92 / MS_COST_DISC_EM).toFixed(4)}em`,
          ...(pipGapBefore ? { marginLeft: "0.08em" } : {}),
        }}
      />
    );
  }
  return (
    <span style={item.em ? { fontStyle: "italic" } : undefined}>{item.v}</span>
  );
}

// LoyaltyRows — printed-planeswalker ability rows: a loyalty-cost badge in the
// left rail + the ability text, alternating translucent row shading. Static
// abilities (no leading cost) render unbadged. Mirrors LoyaltyRowsBake.
function LoyaltyRows({
  slot,
  rows,
  abilities,
  sizePct,
  pipOverrides = null,
  placeholder = false,
}: {
  slot: TextSlot;
  rows: NonNullable<FrameProfile["loyaltyRows"]>;
  abilities: LoyaltyAbility[];
  sizePct: number;
  pipOverrides?: PipOverrides | null;
  /** Editor-only empty state — mutes the row text into a hint. */
  placeholder?: boolean;
}) {
  return (
    <div
      style={{
        ...rectStyle(slot.rect),
        zIndex: 20,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        overflow: "hidden",
        fontFamily: CARD_FONT,
        fontSize: cqw(sizePct),
        lineHeight: slot.lineHeight ?? 1.25,
        color: slot.colorHex,
        borderRadius: "1.2cqw",
      }}
    >
      {abilities.map((ab, i) => (
        <div
          key={i}
          style={{
            display: "flex",
            flex: 1,
            alignItems: "center",
            background: i % 2 === 0 ? rows.stripeAHex : rows.stripeBHex,
            padding: `${cqw(sizePct * 0.22)} ${cqw(sizePct * 0.4)}`,
          }}
        >
          <div
            style={{
              position: "relative",
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: cqw(sizePct * 2.3),
              height: cqw(sizePct * 1.6),
              marginRight: cqw(sizePct * 0.5),
            }}
          >
            {ab.cost ? (
              // The printed loyalty shield asset: peaked top for +, pointed
              // bottom for -, flat hexagon for 0. WebP in the browser, PNG
              // fallback (the bake reads the PNG master directly).
              <picture>
                <source
                  srcSet={webpVariant(loyaltyBadgeAssetFor(ab.cost))}
                  type="image/webp"
                />
                <img
                  src={loyaltyBadgeAssetFor(ab.cost)}
                  alt=""
                  aria-hidden
                  style={{
                    position: "absolute",
                    inset: 0,
                    width: "100%",
                    height: "100%",
                    objectFit: "fill",
                  }}
                />
              </picture>
            ) : null}
            <span
              style={{
                position: "relative",
                color: rows.badgeTextHex,
                fontFamily: DISPLAY_FONT,
                fontSize: cqw(sizePct * 0.88),
                fontWeight: 700,
                // Optically center inside the shield's flat region.
                ...(ab.cost
                  ? loyaltyBadgeShapeFor(ab.cost) === "up"
                    ? { paddingTop: cqw(sizePct * 0.18) }
                    : loyaltyBadgeShapeFor(ab.cost) === "down"
                      ? { paddingBottom: cqw(sizePct * 0.18) }
                      : {}
                  : {}),
              }}
            >
              {ab.cost ?? ""}
            </span>
          </div>
          <div
            style={{
              flex: 1,
              minWidth: 0,
              ...(placeholder ? { fontStyle: "italic", opacity: 0.55 } : {}),
            }}
          >
            <RulesBody text={ab.text} overrides={pipOverrides} />
          </div>
        </div>
      ))}
    </div>
  );
}
