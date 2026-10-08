"use client";

import { createContext, useContext, useEffect, useId, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { frameUrl } from "@/lib/frames/frame-url";
import { RotateCw } from "lucide-react";
import { cn, clamp } from "@/lib/utils";
import { isBillingEnabled } from "@/lib/billing/flags";
import { ROSE_STAR_PATH } from "@/lib/brand/geometry";
import {
  CardPip,
  cardPipDraws,
  ManaCostGlyphs,
} from "@/components/cards/mana-cost-glyphs";
import {
  pipOverrideForSuffix,
  type PipOverrides,
} from "@/lib/pips/override";
import { SetSymbol } from "@/components/cards/set-symbol";
import { cardTypeHasRarity } from "@/lib/cards/emblem";
import { drawableCardMedia } from "@/lib/cards/drawable-media";
import {
  FrameLayer,
  frameImageUrl,
  frameMasterKey,
  frameSplitFor,
  FrameOverlayLayer,
  frameOverlayImageUrl,
  pickFrameColorKey,
  webpVariant,
} from "@/components/cards/frame-layer";
import { EtchedSheen } from "@/lib/cards/etched-finish";
import { HOLO_STAMP_OVAL_ART } from "@/lib/cards/holo-stamp-art";
import {
  FoilBackdropSheen,
  FoilSheen,
  FoilStripeSheen,
  foilArtLayers,
  loyaltyStripeRects,
  type FoilArtSource,
} from "@/lib/cards/foil-finish";
import {
  layoutProfileLoyaltyRows,
  loyaltyRowsDrawing,
  type LoyaltyRowsLayout,
} from "@/lib/cards/loyalty-rows";
import { wordWidthPx, type RulesBlock, type RulesLayout, type RulesMetrics } from "@/lib/cards/rules-layout";
import { flipsideStrip, type FlipsideLine } from "@/lib/cards/flipside-strip";
import {
  profileSagaRail,
  sagaRailDrawing,
  sagaRailPieces,
  type ChapterSlot,
  type SagaRailDrawing,
} from "@/lib/cards/saga-rail";
import {
  NAME_COST_GAP_PCT,
  costRowHdPx,
  fitSplitTypeSizePct,
  fitTypeLineBand,
  inlineSymbolPullPct,
  measuredLinePreviewPct,
  secondFaceLineSizes,
} from "@/lib/cards/render-tiers";
import { endAlignedStatKeepOut, fitStatSizePct, ptValue } from "@/lib/cards/stat-fit";
import { fitTitleBand } from "@/lib/cards/title-band";
import { setSymbolSize, setSymbolSource } from "@/lib/cards/set-symbol-size";
import { collectorLayout, type CollectorLayout, type CollectorMarkAnchor } from "@/lib/cards/collector-layout";
import {
  COLLECTOR_BRUSH_PATH,
  COLLECTOR_BRUSH_VIEWBOX,
  COLLECTOR_STAR_PATH,
  COLLECTOR_STAR_VIEWBOX,
} from "@/lib/cards/collector-line";
import {
  PLACEHOLDER_FLAVOR_TEXT,
  PLACEHOLDER_RULES_TEXT,
  RULES_HD_WIDTH,
  orientationFromAspect,
  type CardOrientation,
} from "@/lib/cards/typography";
import {
  adventureRulesLayout,
  hasRulesLines,
  mainRulesLayout,
  rulesDraw,
  rulesWordText,
  secondFaceRulesLayout,
  type DrawnStats,
  type RulesDraw,
} from "@/lib/cards/rules-box";
import { drawsRulesBackdrop } from "@/lib/cards/rules-backdrop";
import type { RulesItem } from "@/lib/cards/rules-text";
import {
  buildTypeLine,
  displayLine,
  footerArtistLine,
  hasRulesBoxText,
  normalizeFrameTemplate,
  showsDefense,
  showsLoyalty,
  printsPowerToughness,
  slotLine,
  splitTypeLine,
  type LoyaltyAbility,
} from "@/lib/cards/card-display";
import {
  BRAND_MARK_LIGHT_INK,
  BRAND_MARK_LIGHT_SHADOW,
  copyrightSlotLayout,
  type CopyrightMarkInk,
  type CopyrightSlotLayout,
} from "@/lib/cards/copyright-slot";
import { symbolStyle, symbolStyleOf, type SymbolStyleSpec } from "@/lib/cards/symbol-style";
import { BRAND_FACE, TYPE_FACES, faceOf, footerFace, slotFace } from "@/lib/cards/type-faces";
import {
  resolveLoyaltyRows,
  resolveSagaChapters,
} from "@/lib/cards/face-content";
import {
  BRAND_MARK_PILL,
  bandTextStyle,
  brandMarkLayout,
  footerInk,
  loyaltyBadgeAssetFor,
  loyaltyBadgeShapeFor,
  resolveColorAsset,
  slotInk,
  slotTextDy,
  type FrameProfile,
  type Rect,
  type SlotAlign,
  type StatSlot,
  artLayersFor,
  unturnedRect,
  type FlipsideSlots,
  type TextSlot,
  type TypeLineSplit,
} from "@/lib/cards/template-layout";
import {
  resolveFrameProfile,
  type FrameProfileOverridesMap,
} from "@/lib/cards/profile-override";
import { backBodyOf, backPreviewData, frontPreviewData, type DfcFace } from "@/lib/cards/faces";
import {
  COLOR_INDICATOR,
  COLOR_INDICATOR_VIEW,
  colorIndicatorBox,
  colorIndicatorFills,
  colorIndicatorOutlineRadius,
  colorIndicatorWedges,
  drawsColorIndicator,
  typeRectWithIndicator,
} from "@/lib/cards/color-indicator";
import {
  plateKeyFor,
  resolveFrameOverlays,
  resolveHoloStamp,
  type ResolvedHoloStamp,
  resolveTwoColor,
  type FrameAnatomyStyle,
} from "@/lib/cards/anatomy";
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
import {
  BASIC_SYMBOL_DISC_FILL,
  BASIC_SYMBOL_GLYPH_SCALE,
  BASIC_SYMBOL_HALO,
  BASIC_SYMBOL_INK,
  basicSymbolAssetPath,
  basicSymbolBox,
  basicSymbolFor,
  basicSymbolGlyphSizePct,
  type BasicSymbolPlan,
} from "@/lib/cards/basic-symbol";

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
  /** Set symbol the card displays (a plain card field). An uploaded image
   *  (setIconUrl) wins over a preset Keyrune code (setIconCode); when both are
   *  absent the default rarity-tinted PipGlyph mark renders. */
  setIconUrl?: string | null;
  setIconCode?: string | null;
  /** The collector fields (cards.set_code / collector_number / lang,
   *  migration 0133, TODO 4.9a): the PRINTED set code ("DMU" — a token set
   *  prints its parent), the collector number ("107/281", "1") and the
   *  printing's language ("en", "es" …). Carried by both mappers so the
   *  preview and the bake receive the same data; NOTHING draws them yet —
   *  4.9b draws the collector line, opt-in per card. */
  setCode?: string | null;
  collectorNumber?: string | null;
  lang?: string | null;
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
  /** The cross-face block of a double-faced card's face (TODO 5.0a,
   *  lib/cards/faces.ts): which layout and role this face is, the icon
   *  family, and what the OTHER face puts on it (the back's P/T for the
   *  front's tab, the other face's type word and cost for the modal strip).
   *  Derived at render by frontPreviewData / backPreviewData, never stored;
   *  NOTHING reads it yet — 5.1a / 5.1b's bodies draw from it in both
   *  renderers. Absent / null on every card today. */
  dfc?: DfcFace | null;
  /** The card OWNER's custom pip icons — cost pips render these instead of
   *  the standard mana-font glyphs (preview AND bake read this field). */
  pipOverrides?: PipOverrides | null;
  /** Admin frame-layout overrides (frame_profile_overrides table), keyed by
   *  template — merged over the code profiles by resolveFrameProfile so the
   *  live preview and the Satori bake always agree. Absent = code defaults. */
  profileOverrides?: FrameProfileOverridesMap | null;
  /** The OWNER's custom footer mark (profiles.export_watermark_text, paid
   *  perk) — prints footer-right where the hardcoded "PipGlyph" used to sit
   *  (removed in layout v19). Null/absent = blank. Since layout v20 display
   *  surfaces pass nothing here: the text prints on paid downloads only. */
  footerWatermark?: string | null;
  /** The pipglyph.com brand mark, bottom-right — mirrors the bake's overlay
   *  (lib/render/card-image.tsx). Defaults to "on whenever billing is on":
   *  every display surface is watermarked (layout v20); only the paid
   *  download renders clean. */
  brandMark?: boolean;
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

// Which face a text is set in is decided by ONE resolver both renderers read
// (lib/cards/type-faces.ts, TODO 4.8.0): slotFace(slot) for a slot that
// carries `font`, faceOf(profile, role) for a role without one, BRAND_FACE
// for the pipglyph.com mark — each face's `previewFamily` is the bake's
// chain plus the browser's serifs for the moment before the web font loads
// (the faces are declared in globals.css). No site here names a display
// family itself, so the preview and the PNG cannot disagree about a slot.
// Rules / flavor / walker-row / saga text is the body face — MPlantin, the
// one lib/cards/rules-layout.ts lays every line out in.
const CARD_FONT = TYPE_FACES.body.previewFamily;

// The frame's symbol style (FrameProfile.symbolStyle, TODO 4.8.0 —
// lib/cards/symbol-style.ts), resolved ONCE per face by CardFace and read by
// every pip the card draws: the cost rows (ManaCostGlyphs' `symbols` prop —
// a prop of the CARD's uses only), the inline pips (RulesPip) and the fits
// that measure a cost row. The bake hands the same spec down as a prop.
const SymbolStyleContext = createContext<SymbolStyleSpec>(symbolStyle(undefined));

// The collector line's face (TODO 4.9b; the "CollectorLine" @font-face in
// globals.css — the same subset TTF the bake registers).
const COLLECTOR_FONT = '"CollectorLine", "MPlantin", Georgia, "Times New Roman", serif';

/** A collector run's face as the preview sets it — the bake's
 *  collectorFaceBake twin (lib/render/card-image.tsx). */
function collectorFaceStyle(face: "collector" | "display" | "body"): { fontFamily: string; fontWeight: number } {
  return face === "collector"
    ? { fontFamily: COLLECTOR_FONT, fontWeight: 500 }
    : face === "display"
      ? { fontFamily: TYPE_FACES.display.previewFamily, fontWeight: 600 }
      : { fontFamily: TYPE_FACES.body.previewFamily, fontWeight: 400 };
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
  /** The collector fields (TODO 4.9b) — the front face's, or a v2 back
   *  card's own; a legacy jsonb back face carries none. */
  setCode?: string | null;
  collectorNumber?: string | null;
  lang?: string | null;
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

/** A symbolRect's symbol: never shrunk to the rect (see its use). */
const SYMBOL_RECT_STYLE: CSSProperties = { flexShrink: 0 };

export function CardPreview(rawProps: CardPreviewProps) {
  // Only pictures lib/media/media-urls.ts accepts (migration 0127): a row
  // written before it could point its art, icon, watermark or pips at any
  // host. The bake drops the same ones (lib/cards/drawable-media.ts).
  const drawable = drawableCardMedia(rawProps);
  const {
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
    setCode,
    collectorNumber,
    lang,
    faceContent,
    watermark,
    backFace,
    pipOverrides,
    profileOverrides,
    footerWatermark,
    brandMark = isBillingEnabled(),
    face,
    onFaceChange,
    flipOnClick = false,
    backCard,
    className,
    staticInEditor = false,
  } = drawable;
  const template = normalizeFrameTemplate(frameStyle?.template, { rulesText, flavorText });
  const layout = resolveFrameProfile(template, profileOverrides);
  const finish: CardFinish = frameStyle?.finish ?? "regular";
  // The two faces of a double-faced card (TODO 5.1a, lib/cards/faces.ts):
  // the front's `dfc` block (the back's P/T for the grey tab, the icon
  // family) and — for a back with a BODY of its own — the back face drawn
  // on that body and colour, with the twin block. A legacy back (no body)
  // keeps today's flip below, byte-identical.
  const frontDfc = frontPreviewData(drawable).dfc ?? null;
  const backBody = backBodyOf(drawable);
  const backBodyData = backBody ? backPreviewData(drawable) : null;

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
    setCode: setCode ?? null,
    collectorNumber: collectorNumber ?? null,
    lang: lang ?? null,
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
        setCode: backCard.setCode ?? null,
        collectorNumber: backCard.collectorNumber ?? null,
        lang: backCard.lang ?? null,
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
        brandMark,
        anatomy: backCard.frameStyle ?? null,
      } as const)
    : null;

  // A back face with its own BODY (TODO 5.1a): its content, body, colour
  // and `dfc` block from backPreviewData — the card's rarity, finish, set
  // symbol, collector fields, watermark and switches (design D8 / D18).
  const backBodyFace: FaceData | null = backBodyData
    ? {
        title: backBodyData.title ?? null,
        cost: backBodyData.cost ?? null,
        cardType: backBodyData.cardType ?? null,
        supertype: backBodyData.supertype ?? null,
        subtypes: backBodyData.subtypes ?? [],
        rulesText: backBodyData.rulesText ?? null,
        flavorText: backBodyData.flavorText ?? null,
        power: backBodyData.power ?? null,
        toughness: backBodyData.toughness ?? null,
        loyalty: backBodyData.loyalty ?? null,
        defense: backBodyData.defense ?? null,
        artistCredit: backBodyData.artistCredit ?? null,
        artUrl: backBodyData.artUrl ?? null,
        artPosition: backBodyData.artPosition ?? {},
        faceContent: null,
        watermark: backBodyData.watermark ?? null,
        setCode: backBodyData.setCode ?? null,
        collectorNumber: backBodyData.collectorNumber ?? null,
        lang: backBodyData.lang ?? null,
      }
    : null;
  const backBodyTemplate = normalizeFrameTemplate(backBodyData?.frameStyle?.template);
  const backBodyFaceProps = backBodyData
    ? ({
        template: backBodyTemplate,
        colorIdentity: (backBodyData.colorIdentity ?? []) as ColorIdentity[],
        rarity: rarity ?? null,
        layout: resolveFrameProfile(backBodyTemplate, profileOverrides),
        finish,
        staticInEditor,
        setIconUrl: setIconUrl ?? null,
        setIconCode: setIconCode ?? null,
        pipOverrides: pipOverrides ?? null,
        footerWatermark: footerWatermark ?? null,
        brandMark,
        anatomy: frameStyle ?? null,
        dfc: backBodyData.dfc ?? null,
      } as const)
    : null;

  // The flippable second face: prefer the referenced card, then a back with
  // its own body (5.1a), then the legacy jsonb. Adventure/multi-panel frames
  // render inline, so no flip.
  const flipBackFace = backCardFace ?? backBodyFace ?? backFaceData;
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
    brandMark,
    anatomy: frameStyle ?? null,
    dfc: frontDfc,
  } as const;

  return (
    <div
      className={cn(
        "group relative w-full overflow-hidden bg-[#101015] shadow-[0_18px_60px_-30px_rgba(0,0,0,0.85)] transition-transform",
        // Battle frames are landscape (7:5); every other frame is the 5:7 card.
        // card-corners* cut the ONE card corner (4.3% of the short side,
        // lib/cards/card-corner.ts) — the same radius the bake masks, so the
        // preview and the stored image share an outline.
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
                {...(backCardFaceProps ?? backBodyFaceProps ?? faceProps)}
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
          onKeyDown={(event) => {
            // As components/cards/baked-card-flip.tsx: a tile body that
            // handles keys itself (the dashboard tile opens the card on
            // Enter) must not see the button's activation keys.
            if (event.key === "Enter" || event.key === " ") event.stopPropagation();
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
    </div>
  );
}

/**
 * The intrinsic pixel size of an image URL, once it has loaded (null before,
 * and for a null URL). The foil finish needs it: its luminance mask redraws
 * the art with the same object-fit: cover geometry the art <img> gets, and
 * SVG can't express cover at an arbitrary focal point without the size.
 * The URL is the one the art <img> already loads, so this is a cache hit.
 */
function useNaturalSize(src: string | null | undefined): FoilArtSource | null {
  const [loaded, setLoaded] = useState<FoilArtSource | null>(null);
  useEffect(() => {
    if (!src) return;
    let live = true;
    const img = new Image();
    img.onload = () => {
      if (live && img.naturalWidth > 0 && img.naturalHeight > 0) {
        setLoaded({ href: src, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight });
      }
    };
    img.src = src;
    return () => {
      live = false;
    };
  }, [src]);
  // A stale size (the art was just swapped) is never used for the new URL.
  return src && loaded?.href === src ? loaded : null;
}

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
  layout: layoutProp,
  finish,
  staticInEditor,
  setIconUrl = null,
  setIconCode = null,
  pipOverrides = null,
  adventure = null,
  secondFace = null,
  footerWatermark = null,
  brandMark = false,
  anatomy = null,
  dfc = null,
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
  /** pipglyph.com overlay bottom-right — the bake's brand mark. */
  brandMark?: boolean;
  /** The card's anatomy switches (FrameStyle.crown / twoColor, TODO 4.6.0):
   *  a piece draws only when its switch is true — absent is today's look. */
  anatomy?: FrameAnatomyStyle | null;
  /** This face's double-faced block (TODO 5.1a, lib/cards/faces.ts): the
   *  icon family the rider draws, and what the OTHER face puts on this one
   *  (the back's P/T in the front's grey tab). Null on every other card. */
  dfc?: DfcFace | null;
}) {
  // The colour-indicator dot (TODO 5.1a, lib/cards/color-indicator.ts): a
  // body that declares it draws it for a coloured identity, and the type
  // line starts past it — the bake's twin (the profile the rest of this
  // face reads is the indented one).
  const indicatorFills = drawsColorIndicator(layoutProp.indicator, colorIdentity) ? colorIndicatorFills(colorIdentity) : [];
  const layout = useMemo(
    () => (indicatorFills.length ? { ...layoutProp, type: { ...layoutProp.type, rect: typeRectWithIndicator(layoutProp.type.rect) } } : layoutProp),
    [layoutProp, indicatorFills.length],
  );
  // The card's colour (plates, watermark tint) and the frame master it
  // paints — the same, but where the profile dresses a colour by type:
  // Alpha's colourless artifact paints the artifact card "a", and a stored
  // pair with the two-colour frame on its pair master (frameMasterKey, the
  // bake's twin).
  // The frame's symbol style — one resolution per face, handed to every pip
  // this face draws (SymbolStyleContext; the bake's `symbols`).
  const symbols = symbolStyleOf(layout);
  const colorKey = pickFrameColorKey(colorIdentity);
  const masterKey = frameMasterKey(layout, colorIdentity, face, anatomy);
  // The two-colour look (TODO 4.6b) picks the stat plate (plateKeyFor: a
  // hybrid's grey "c"), and the anatomy overlays (the crown, 4.6a) are drawn
  // over the master — the bake's twins. Both are nothing until a profile
  // declares pair masters / an overlay and the card's switch is on.
  const anatomyFacts = {
    colors: colorIdentity,
    cost: face.cost,
    cardType: face.cardType,
    supertype: face.supertype,
    // The icon rider's family and this face's role (TODO 5.1a); the modal
    // strip rider's key, the other face's (TODO 5.1c).
    dfc: dfc ? { role: dfc.role, icon: dfc.icon, stripKey: dfc.otherFace.stripKey } : null,
    // The holofoil stamp's "auto" reads the rarity (TODO 4.9c).
    rarity,
  };
  const plateKey = plateKeyFor(colorKey, resolveTwoColor(layout, anatomy, anatomyFacts));
  const overlays = resolveFrameOverlays(layout, anatomy, { ...anatomyFacts, colorKey });
  // The holofoil stamp (TODO 4.9c): its notch is one of the overlays; the
  // oval is our bitmap over the sheens (HoloStampOval), and its arch keeps
  // the rules lines out while drawn — the bake's twins.
  const holoStamp = resolveHoloStamp(layout, anatomy, { ...anatomyFacts, colorKey });
  // A two-colour Dragon Wing card draws BOTH colours' frames split down the
  // seam (FrameProfile.twoColorSplit); the plates keep colorKey ("m").
  const frameSplit = frameSplitFor(layout, colorIdentity);
  const safeTitle = face.title?.trim() || "Untitled Card";
  const markLayout = brandMarkLayout(layout);
  // A textless frame (TODO 3.24) prints no type line and no text box — but
  // the full-art token's textless height keeps its type line (4.48,
  // FrameProfile.textlessTypeLine).
  const textless = Boolean(layout.textless);
  const hidesTypeLine = textless && !layout.textlessTypeLine;
  // The set symbol's size and drawn width (lib/cards/set-symbol-size.ts) —
  // the bake's twin: the same box, glyph fit and width in both renderers.
  const setSymbol = setSymbolSize(layout, setSymbolSource(setIconUrl, setIconCode));
  // Per-frame-master footer ink (Alpha: silver on every frame but white) —
  // the same footerInk() the bake resolves (outlined when the profile prints
  // it on the art, footerOnArt).
  const footerInkResolved = layout.footer ? footerInk(layout.footer, masterKey, layout) : null;
  // …and the name's and type line's (the text spans only, not the pips or
  // the set symbol) — the bake's bandTextStyle() twins.
  const titleInk = bandTextStyle(layout.title, masterKey);
  const typeInk = bandTextStyle(layout.type, masterKey);
  const showCost =
    !layout.hideCost && face.cardType !== "land" && Boolean(face.cost?.trim());

  const showPT = Boolean(layout.pt) && printsPowerToughness(face);
  // In the editor the starting-loyalty shield shows even before a value is
  // typed (empty plate > invisible element); the gallery/bake require one.
  const showLoyalty =
    Boolean(layout.loyalty) &&
    showsLoyalty(face.cardType) &&
    Boolean(face.loyalty || staticInEditor);
  const showDefense =
    Boolean(layout.defense) && showsDefense(face.cardType) && Boolean(face.defense);
  // The collector line (TODO 4.9b): drawn in place of the footer when the
  // card's switch names a style and the frame has the slot (lib/cards/
  // collector-layout.ts, the bake's twin). With the brand mark it is a
  // display surface (the mark in the © slot); without it the subscriber's
  // download preview (the footer mark in the slot). The © slot's line
  // follows the stat plate THIS preview draws — the editor's empty loyalty
  // shield included.
  const collector = useMemo(
    () =>
      collectorLayout(
        layout,
        {
          cardType: face.cardType,
          supertype: face.supertype,
          rarity,
          setCode: face.setCode,
          collectorNumber: face.collectorNumber,
          lang: face.lang,
          artistCredit: face.artistCredit,
          finish,
          star: anatomy?.star,
          collector: anatomy?.collector,
          plates: { pt: showPT, loyalty: showLoyalty, defense: showDefense },
        },
        brandMark ? { kind: "display" } : { kind: "download", footerText: footerWatermark },
      ),
    [layout, face, rarity, finish, anatomy?.star, anatomy?.collector, showPT, showLoyalty, showDefense, brandMark, footerWatermark],
  );
  // A centred footer's © slot (TODO 4.10a; lib/cards/copyright-slot.ts, the
  // bake's twin): the mark on display, a clean download's footer text —
  // never beside a collector line, which has its own.
  const copyright = collector
    ? null
    : copyrightSlotLayout(layout, masterKey, brandMark ? { kind: "display" } : { kind: "download", footerText: footerWatermark });

  const isFoil = finish === "foil";
  const isEtched = finish === "etched";
  const isShowcase = finish === "showcase";
  // SVG ids are document-global: one per rendered face (a page can show
  // several previews, and a DFC renders two faces). useId's punctuation is
  // stripped so it is safe inside url(#…).
  const etchedId = `etched-${useId().replace(/[^A-Za-z0-9_-]/g, "")}`;
  const foilId = `foil-${useId().replace(/[^A-Za-z0-9_-]/g, "")}`;
  // Foil only: the art's intrinsic size for the foil mask's cover geometry.
  const foilArt = useNaturalSize(isFoil ? face.artUrl : null);
  const foilSecondArt = useNaturalSize(
    isFoil && layout.secondFace?.artSlot ? secondFace?.artUrl : null,
  );
  // Printed layers drawn above the full-card sheen — the stat plates, the
  // planeswalker ability stripes and the rules backdrop — carry their own
  // (the bake's twins).
  const plateFoil = isFoil ? { landscape: layout.orientation === "landscape" } : null;

  const focalX = clamp(face.artPosition?.focalX ?? 0.5, 0, 1);
  const focalY = clamp(face.artPosition?.focalY ?? 0.5, 0, 1);
  const scale = clamp(face.artPosition?.scale ?? 1, 0.5, 4);

  const aspect = layout.orientation === "landscape" ? 5 / 7 : 7 / 5;
  // The stat badges this face draws — the rules boxes keep their lines out
  // of them (lib/cards/rules-box.ts), the bake's twin.
  const secondFacePtShown = Boolean(secondFace?.power || secondFace?.toughness);
  const stampKeepOut = holoStamp?.keepOut ?? null;
  // The modal strip (5.1b): the lines keep out of the painted tab.
  const stripKeepOut = layout.flipside?.keepOut ?? null;
  // The transform front's reverse P/T digits (5.1d): the lines wrap round
  // the back's P/T in the grey tab while it is drawn — the bake's twin
  // (lib/cards/stat-fit.ts endAlignedStatKeepOut).
  const reversePtValue = layout.reversePt && dfc?.otherFace.printsPt ? ptValue(dfc.otherFace.power, dfc.otherFace.toughness) : null;
  const reversePtKeepOut = useMemo(
    () => (layout.reversePt && reversePtValue !== null ? endAlignedStatKeepOut(layout.reversePt, reversePtValue, orientationFromAspect(aspect)) : null),
    [layout.reversePt, reversePtValue, aspect],
  );
  const drawnStats: DrawnStats = useMemo(
    () => ({
      pt: showPT,
      loyalty: showLoyalty,
      defense: showDefense,
      secondFacePt: Boolean(layout.secondFace?.pt && secondFacePtShown),
      stamp: stampKeepOut,
      strip: stripKeepOut,
      reversePt: reversePtKeepOut,
    }),
    [showPT, showLoyalty, showDefense, layout.secondFace?.pt, secondFacePtShown, stampKeepOut, stripKeepOut, reversePtKeepOut],
  );
  // Planeswalker ability rows when the frame defines them and the card is a
  // planeswalker; a walker with no abilities draws the plain box (below).
  const usesLoyaltyRows =
    Boolean(layout.loyaltyRows) && showsLoyalty(face.cardType) && !textless;
  // Planeswalker ability rows (badged loyalty costs, striped rows) when the
  // frame defines them and the card actually is a planeswalker. Structured
  // rows first, rules_text parsing as the legacy fallback.
  const loyaltyAbilities = useMemo(
    () => (usesLoyaltyRows ? resolveLoyaltyRows(face.faceContent, face.rulesText) : []),
    [usesLoyaltyRows, face.faceContent, face.rulesText],
  );
  // Their text size and content-sized row heights, the last row's text short
  // of the loyalty shield when it would reach it — the bake's twin
  // (lib/cards/loyalty-rows.ts). The editor-only empty walker lays out its
  // hint rows the same way. (Memoised like the rules layouts below: a long
  // walker's rows take a few ms to fit.)
  const loyaltyRowsLayout = useMemo(
    () => (loyaltyAbilities.length > 0 ? layoutProfileLoyaltyRows(layout, loyaltyAbilities, aspect) : null),
    [layout, loyaltyAbilities, aspect],
  );
  const showsHintRows = usesLoyaltyRows && staticInEditor && loyaltyAbilities.length === 0;
  const hintRowsLayout = useMemo(
    () => (showsHintRows ? layoutProfileLoyaltyRows(layout, EDITOR_LOYALTY_HINT, aspect) : null),
    [showsHintRows, layout, aspect],
  );
  // Saga chapter rail content — same structured-first resolution — and the
  // printed rail laid out for it (lib/cards/saga-rail.ts sagaRail: the
  // reminder block, the content-sized rows, the badge stacks), drawn at the
  // HD bake's px — the bake's twin. A textless frame prints none of it.
  const sagaRail = useMemo(() => {
    if (!layout.chapters || textless) return null;
    const rail = profileSagaRail(layout, resolveSagaChapters(face.faceContent, face.rulesText), aspect);
    return rail ? sagaRailDrawing(rail, "hd") : null;
  }, [layout, textless, face.faceContent, face.rulesText, aspect]);
  // Its badges and dividers: frame pieces, drawn with the frame and under
  // both finishes (the bake's railPieces).
  const railPieces = useMemo(
    () => (sagaRail && layout.chapters ? sagaRailPieces(sagaRail, layout.chapters) : []),
    [sagaRail, layout.chapters],
  );
  // The name's fit (the bake's twin, lib/cards/title-band.ts): before a
  // detached cost box (costRect) it stops before the pips, shrinking to fit
  // there when it is long; on a measured slot (the M15-era family, layout
  // v32) it shrinks to the room its band leaves it wherever the cost is.
  const titleFit = fitTitleBand(layout, safeTitle, showCost ? face.cost : null, orientationFromAspect(aspect));
  // A measured name the fit shrank shows at the stored HD bake's whole px
  // (measuredLinePreviewPct); the old path keeps its fitted size.
  const titleSizePct = !titleFit
    ? layout.title.sizePct
    : layout.title.fit === "measured"
      ? measuredLinePreviewPct(titleFit.sizePct, layout.title.sizePct, orientationFromAspect(aspect))
      : titleFit.sizePct;
  // Explicit watermark wins; basic lands (Plains/Island/…) automatically get
  // the authentic large mana symbol in the text box.
  const basicLandFace = {
    cardType: face.cardType,
    supertype: face.supertype,
    subtypes: face.subtypes,
    title: face.title,
    rulesText: face.rulesText,
  };
  const effectiveWatermark = resolveWatermark(face.watermark, basicLandFace);
  // A profile with a basic-land symbol slot (TODO 3.24) prints a basic's
  // symbol there instead of the rules-box watermark — the bake's twin
  // (lib/cards/basic-symbol.ts).
  const basicSymbolPlan = basicSymbolFor(layout, basicLandFace, face.watermark);
  // BASIC lands (Basic supertype — see lib/cards/watermark.ts) print NO
  // rules text, just the big symbol. Keyed on the card's identity, not the
  // watermark, so an explicit override icon suppresses the text the same
  // way the automatic one does; nonbasic lands always print their text.
  const isBasicLand = basicLandManaKey(basicLandFace) !== null;
  const hasRulesContent =
    !isBasicLand &&
    !textless &&
    hasRulesBoxText(face);
  // The plain rules box's ONE layout (layout v33, lib/cards/rules-box.ts) —
  // the bake's twin: its size, every line and every position, clear of the
  // drawn stat badges. The editor shows a sample (real type, size and pips)
  // in a card with no text yet; never the gallery or the bake. Not on a
  // textless frame, a basic land, the saga rail or ability rows (an empty
  // walker in the editor shows hint rows instead).
  const rulesPlaceholder = staticInEditor && !face.rulesText?.trim() && !face.flavorText?.trim();
  const drawsRulesBox =
    !textless &&
    !isBasicLand &&
    !layout.chapters &&
    !(layout.loyaltyRows && (loyaltyAbilities.length > 0 || (usesLoyaltyRows && staticInEditor)));
  // (Memoised: a long text's fit takes a millisecond or two, and a face
  // re-renders on every flip and hover.)
  // The card's text alignment (FrameStyle.rulesAlign, TODO 4.21e) — the
  // bake's twin: every rules box of the card alike, applied by the layout
  // only on a frame that offers the choice (rulesAlignOf).
  const rulesAlign = anatomy?.rulesAlign;
  const rulesLayout = useMemo(
    () =>
      drawsRulesBox
        ? mainRulesLayout({
            layout,
            rulesText: rulesPlaceholder ? PLACEHOLDER_RULES_TEXT : face.rulesText,
            flavorText: rulesPlaceholder ? PLACEHOLDER_FLAVOR_TEXT : face.flavorText,
            aspect,
            show: drawnStats,
            rulesAlign,
          })
        : null,
    [drawsRulesBox, layout, rulesPlaceholder, face.rulesText, face.flavorText, aspect, drawnStats, rulesAlign],
  );
  // The adventure page's and a second face's rules — the same layout. The
  // editor's empty adventure page shows a hint, laid out like flavor text.
  const adventurePlaceholder = staticInEditor && !adventure?.rulesText?.trim();
  const hasAdventure = Boolean(adventure);
  const adventureText = adventure?.rulesText;
  const adventureRules = useMemo(
    () =>
      layout.adventure && hasAdventure
        ? adventureRulesLayout({
            layout,
            rulesText: adventurePlaceholder ? null : adventureText,
            flavorText: adventurePlaceholder ? ADVENTURE_RULES_HINT : null,
            aspect,
            show: drawnStats,
            rulesAlign,
          })
        : null,
    [layout, hasAdventure, adventurePlaceholder, adventureText, aspect, drawnStats, rulesAlign],
  );
  const hasSecondFace = Boolean(secondFace);
  const secondFaceText = secondFace?.rulesText;
  const secondFaceRules = useMemo(
    () =>
      layout.secondFace && hasSecondFace
        ? secondFaceRulesLayout({ layout, rulesText: secondFaceText, aspect, show: drawnStats, rulesAlign })
        : null,
    [layout, hasSecondFace, secondFaceText, aspect, drawnStats, rulesAlign],
  );
  // The type line, and its two halves on a split type line (TextSlot.split,
  // TODO 3.24) — one size for both, the bake's twin.
  const typeLine = buildTypeLine({
    supertype: face.supertype,
    cardType: face.cardType,
    subtypes: face.subtypes,
  });
  const typeSplit = layout.type.split ? splitTypeLine(typeLine) : null;
  // The type line's fit (the bake's twin): the old estimate, or (a measured
  // slot) the room before the set symbol's ink as drawn — its size, its text
  // (cut with a "…" only past the floor) and its width.
  const typeFit = fitTypeLineBand({
    layout,
    text: typeLine,
    symbolWidthPct: setSymbol.drawnWidthPct,
    symbolInkLeftPct: setSymbol.inkLeftPct,
    orientation: orientationFromAspect(aspect),
  });
  const typeSizePct =
    layout.type.fit === "measured"
      ? measuredLinePreviewPct(typeFit.sizePct, layout.type.sizePct, orientationFromAspect(aspect))
      : typeFit.sizePct;
  // A measured band's inline set symbol is pulled left over the band gap
  // (inlineSymbolPullPct; it stays where it was) and never shrinks.
  const symbolPull = inlineSymbolPullPct(layout, setSymbol);
  const inlineSymbolStyle: CSSProperties | undefined =
    layout.type.fit === "measured"
      ? { flexShrink: 0, ...(symbolPull ? { marginLeft: `-${cqw(symbolPull)}` } : {}) }
      : undefined;

  // See-through frames (colourless Eldrazi, devoid, colourless token and
  // walker): the art also runs under the whole frame (TODO 4.17). Same
  // object-fit cover at the card's focal point in both renderers; the window
  // keeps its crop — in the master's own slot when it has one, and one
  // picture when that slot is the under-frame rect (artLayersFor, the
  // bake's rects).
  const artLayers = artLayersFor(layout, masterKey, Boolean(face.artUrl));
  const underArtRect = artLayers.under;

  return (
    <SymbolStyleContext.Provider value={symbols}>
    <div className="absolute inset-0">
      {underArtRect && face.artUrl ? (
        <div
          aria-hidden
          className="absolute overflow-hidden"
          style={{ ...rectStyle(underArtRect), zIndex: 0 }}
          data-testid="under-frame-art"
        >
          <ArtImage src={face.artUrl} focalX={focalX} focalY={focalY} scale={1} alt="" />
        </div>
      ) : null}
      {/* Art — below the frame, in the transparent cut-out. */}
      <div
        aria-hidden
        className="absolute overflow-hidden"
        style={{ ...rectStyle(artLayers.slot), zIndex: 0 }}
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

      {/* A basic land's symbol disc (FrameProfile.basicSymbol "disc", TODO
          3.24): above the art, under the frame, so a see-through socket's
          painted ring overlaps its edge (the bake's twin). */}
      {basicSymbolPlan && basicSymbolPlan.slot.style === "disc" ? (
        <BasicSymbolDisc plan={basicSymbolPlan} colorKey={colorKey} aspect={aspect} />
      ) : null}

      {/* Frame PNG — above the art so its painted slot border is on top. */}
      <FrameLayer
        template={template}
        masterKey={masterKey}
        zIndex={5}
        split={frameSplit}
      />
      {/* Anatomy overlays (the legendary crown band, TODO 4.6.0) — over the
          master at its z-index, under every text layer: the bake draws them
          right after its frame image. Nothing when the card draws none. */}
      <FrameOverlayLayer overlays={overlays} zIndex={5} />
      {/* The saga rail's bitmaps (TODO 4.21c): dividers and chapter badges
          at the layout's boxes — printed frame, under both finishes; the
          bake's railPieces twin. Nothing off a saga. */}
      <SagaRailPieces pieces={railPieces} />
      {/* The colour-indicator dot (TODO 5.1a): over the master, under every
          text layer — the bake's twin (ColorIndicatorBake). */}
      {indicatorFills.length ? <ColorIndicatorOverlay fills={indicatorFills} /> : null}

      {/* Premium finish: etched — fine cross-hatch + sheen on the FRAME only
          (masked by the frame's own luminance), just above the frame and
          below every text/stat layer. The SAME SVG the bake draws right
          after its frame <img> (lib/cards/etched-finish.tsx). */}
      {isEtched ? (
        <EtchedSheen
          id={etchedId}
          frameHref={frameImageUrl(template, frameSplit?.leftKey ?? masterKey)}
          split={
            frameSplit
              ? {
                  href: frameImageUrl(template, frameSplit.rightKey),
                  atPct: frameSplit.atPct,
                }
              : null
          }
          overlays={[...overlays, ...railPieces].map((overlay) => ({ href: frameOverlayImageUrl(overlay.path), rect: overlay.rect }))}
          landscape={layout.orientation === "landscape"}
          width="100%"
          height="100%"
          style={{ zIndex: 6, pointerEvents: "none" }}
        />
      ) : null}

      {/* Premium finish: foil — holographic rainbow + glint through a
          luminance mask of the art layers + frame: strongest on light areas,
          none on black, under every text/stat layer (the ink sits on the
          foil). The SAME SVG the bake draws right after its frame <img>
          (lib/cards/foil-finish.tsx). Static, like the bake. */}
      {isFoil ? (
        <FoilSheen
          id={foilId}
          // Split frames mask with the two halves the face paints (like the
          // etched sheen); plates below keep the gold "m" key.
          frameHref={frameImageUrl(template, frameSplit?.leftKey ?? masterKey)}
          split={
            frameSplit
              ? { href: frameImageUrl(template, frameSplit.rightKey), atPct: frameSplit.atPct }
              : null
          }
          art={foilArtLayers({
            layout,
            colorKey: masterKey,
            art: foilArt,
            artPosition: face.artPosition,
            secondArt: foilSecondArt,
            secondArtPosition: secondFace?.artPosition,
          })}
          overlays={[...overlays, ...railPieces].map((overlay) => ({ href: frameOverlayImageUrl(overlay.path), rect: overlay.rect }))}
          landscape={layout.orientation === "landscape"}
          width="100%"
          height="100%"
          style={{ zIndex: 6, pointerEvents: "none" }}
        />
      ) : null}

      {/* The holofoil stamp's oval (TODO 4.9c): our silver oval bitmap over
          the notch and above the sheens, at the bake's rect. */}
      {holoStamp ? <HoloStampOval stamp={holoStamp} /> : null}

      {/* Stat overlays — P/T, loyalty, defense. */}
      {showPT && layout.pt ? (
        <StatOverlay
          slot={layout.pt}
          value={ptValue(face.power, face.toughness)}
          colorKey={plateKey}
          masterKey={masterKey}
          orientation={orientationFromAspect(aspect)}
          foil={plateFoil && { ...plateFoil, id: `${foilId}-pt` }}
        />
      ) : null}
      {showLoyalty && layout.loyalty ? (
        <StatOverlay
          slot={layout.loyalty}
          value={String(face.loyalty ?? "")}
          colorKey={plateKey}
          masterKey={masterKey}
          orientation={orientationFromAspect(aspect)}
          foil={plateFoil && { ...plateFoil, id: `${foilId}-loyalty` }}
        />
      ) : null}
      {showDefense && layout.defense ? (
        <StatOverlay
          slot={layout.defense}
          value={String(face.defense)}
          colorKey={plateKey}
          masterKey={masterKey}
          orientation={orientationFromAspect(aspect)}
          foil={plateFoil && { ...plateFoil, id: `${foilId}-defense` }}
        />
      ) : null}
      {/* The transform front's reverse P/T (TODO 5.1a): the BACK's P/T in
          the grey tab the master paints — only when the back prints one;
          the tab prints empty otherwise (owner decision Q7). No plate. */}
      {layout.reversePt && dfc?.otherFace.printsPt ? (
        <StatOverlay
          slot={layout.reversePt}
          testId="reverse-pt"
          value={ptValue(dfc.otherFace.power, dfc.otherFace.toughness)}
          colorKey={plateKey}
          masterKey={masterKey}
          orientation={orientationFromAspect(aspect)}
        />
      ) : null}
      {/* The modal flipside strip's texts (TODO 5.1b): the OTHER face's type
          word and its cost / mana line in the strip the master paints —
          the bake's FlipsideBake twin. */}
      {layout.flipside && dfc ? (
        <FlipsideOverlay slots={layout.flipside} other={dfc.otherFace} orientation={orientationFromAspect(aspect)} overrides={pipOverrides} />
      ) : null}

      {/* Title band — name (left) + mana cost (right). When the profile
          defines a costRect, the pips render in their OWN absolutely
          positioned box (right-aligned, vertically centered) so name and
          cost can be aligned independently in the layout editor. */}
      <BandSlot
        slot={titleFit ? { ...layout.title, sizePct: titleSizePct } : layout.title}
        italic={isShowcase}
      >
        <span
          style={
            titleFit
              ? { ...ELLIPSIS, ...titleInk, ...textDy(layout.title, titleSizePct), maxWidth: cqw(titleFit.widthPct) }
              : { ...ELLIPSIS, ...titleInk, ...textDy(layout.title) }
          }
          title={safeTitle}
        >
          {displayLine(titleFit ? titleFit.text : safeTitle)}
        </span>
        {showCost && !layout.costRect ? (
          <ManaCostGlyphs
            cost={face.cost}
            disc={costDisc(layout.costSizePct ?? layout.title.sizePct, orientationFromAspect(aspect))}
            overrides={pipOverrides}
            symbols={symbols}
            offsetY={layout.costDy ? cqw(layout.costDy) : undefined}
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
            disc={costDisc(layout.costSizePct ?? layout.title.sizePct, orientationFromAspect(aspect))}
            overrides={pipOverrides}
            symbols={symbols}
            offsetY={layout.costDy ? cqw(layout.costDy) : undefined}
          />
        </div>
      ) : null}

      {/* Type band — type line (left) + rarity set-symbol (right). Long type
          lines shrink to fit on one line (fitTypeLine), matching how
          real cards condense e.g. "Legendary Artifact Creature — …". When the
          profile defines a symbolRect, the symbol renders in its OWN
          absolutely positioned box so it can be aligned independently. */}
      {/* A textless frame (TODO 3.24) prints no type line — nor the set
          symbol beside it (a symbolRect box still prints, below) — unless
          it keeps its type line (textlessTypeLine, the full-art token). A split
          type line prints its two halves in their own boxes. */}
      {hidesTypeLine ? null : layout.type.split && typeSplit ? (
        <SplitTypeLine
          slot={{
            ...layout.type,
            sizePct: fitSplitTypeSizePct({
              left: typeSplit[0],
              right: typeSplit[1],
              leftRect: layout.type.split.leftRect,
              rightRect: layout.type.split.rightRect,
              baseSizePct: layout.type.sizePct,
            }),
          }}
          split={layout.type.split}
          parts={typeSplit}
          ink={typeInk}
        />
      ) : (
      <BandSlot slot={{ ...layout.type, sizePct: typeSizePct }}>
        <span
          data-testid="type-line"
          style={{
            ...ELLIPSIS,
            ...typeInk,
            ...textDy(layout.type, typeSizePct),
            ...(typeFit.widthPct !== null ? { maxWidth: cqw(typeFit.widthPct) } : {}),
          }}
        >
          {displayLine(typeFit.text)}
        </span>
        {!layout.symbolRect ? (
          <SetSymbol
            rarity={rarity}
            namesRarity={cardTypeHasRarity(face.cardType)}
            iconUrl={setIconUrl}
            setCode={setIconCode}
            size={cqw(setSymbol.sizePct)}
            width={cqw(setSymbol.drawnWidthPct)}
            keyline={layout.setSymbolKeyline}
            style={inlineSymbolStyle}
          />
        ) : null}
      </BandSlot>
      )}
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
          {/* Never shrunk: a symbol wider than the rect (the core-set pills
              at their print's 188 px, v36) ends at its right edge and
              reaches out on the left — the bake's SYMBOL_RECT_WRAP. */}
          <SetSymbol
            rarity={rarity}
            namesRarity={cardTypeHasRarity(face.cardType)}
            iconUrl={setIconUrl}
            setCode={setIconCode}
            size={cqw(setSymbol.sizePct)}
            width={cqw(setSymbol.drawnWidthPct)}
            keyline={layout.setSymbolKeyline}
            style={SYMBOL_RECT_STYLE}
          />
        </div>
      ) : null}

      {/* Rules — Saga chapter rail or planeswalker ability rows, otherwise the
          normal rules + flavor box. */}
      {/* Rules-box backdrop — split into its OWN layer so the watermark can
          sit between it and the text (backdrop z9 < watermark z10 < text
          z20). Previously the backdrop was the text container's background,
          which painted over the watermark — basic lands' big mana symbol
          vanished behind the tinted land text box. WHEN it is drawn is the
          bake's rule too (drawsRulesBackdrop). */}
      {layout.rules.backdropHex &&
      drawsRulesBackdrop(layout.rules, {
        hasRulesContent,
        textless,
        chapters: Boolean(layout.chapters),
        rowsDrawn: Boolean(layout.loyaltyRows) && (loyaltyAbilities.length > 0 || hintRowsLayout !== null),
      }) ? (
        <div
          aria-hidden
          style={{
            ...rectStyle(layout.rules.rect),
            zIndex: 9,
            background: layout.rules.backdropHex,
            borderRadius: "1.5cqw",
            // Foil: clip the sheen to the rounded corners.
            ...(plateFoil ? { overflow: "hidden" } : {}),
          }}
        >
          {/* Foil: the backdrop's own sheen, masked by its colour, over the
              backdrop and under the watermark + text (the bake's twin). */}
          {plateFoil ? (
            <FoilBackdropSheen
              id={`${foilId}-backdrop`}
              region={layout.rules.rect}
              fill={layout.rules.backdropHex}
              landscape={plateFoil.landscape}
              width="100%"
              height="100%"
              style={{ pointerEvents: "none" }}
            />
          ) : null}
        </div>
      ) : null}

      {/* Design watermark — faint mark centered in the rules box, above the
          frame PNG but below every text layer. Suppressed where a rail
          replaces the box (saga chapters, planeswalker rows) — printed cards
          do the same (Scars watermarked everything EXCEPT basics + walkers). */}
      {/* Match the bake (card-image.tsx) and the backdrop condition above:
          suppress the watermark only when loyalty ROWS actually render, i.e.
          there's at least one parsed loyalty ability — not merely because the
          frame supports them. */}
      {effectiveWatermark &&
      !textless &&
      !basicSymbolPlan &&
      !layout.chapters &&
      !(layout.loyaltyRows && loyaltyAbilities.length > 0) ? (
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

      {/* A basic land's symbol in its slot (FrameProfile.basicSymbol, TODO
          3.24) — above the frame, in place of the rules-box watermark. */}
      {basicSymbolPlan && basicSymbolPlan.slot.style !== "none" ? (
        <BasicSymbol plan={basicSymbolPlan} aspect={aspect} />
      ) : null}

      {/* A textless frame (TODO 3.24) prints no rules, flavour, rows or
          rail — nor the editor's sample text. */}
      {textless ? null : layout.chapters ? (
        sagaRail ? <ChapterRail slot={layout.chapters} rail={sagaRail} pipOverrides={pipOverrides} /> : null
      ) : layout.loyaltyRows && loyaltyRowsLayout ? (
        <LoyaltyRows
          pipOverrides={pipOverrides}
          slot={layout.rules}
          rows={layout.loyaltyRows}
          abilities={loyaltyAbilities}
          rowsLayout={loyaltyRowsLayout}
          foil={plateFoil && { ...plateFoil, id: `${foilId}-rows` }}
        />
      ) : layout.loyaltyRows && hintRowsLayout ? (
        // Editor-only: an empty planeswalker still shows the striped ability
        // rows (with a hint) instead of the bare art cut-out reading as a
        // black box. Never rendered in the gallery or the bake.
        <LoyaltyRows
          pipOverrides={pipOverrides}
          slot={layout.rules}
          rows={layout.loyaltyRows}
          abilities={EDITOR_LOYALTY_HINT}
          rowsLayout={hintRowsLayout}
          placeholder
          foil={plateFoil && { ...plateFoil, id: `${foilId}-rows` }}
        />
      ) : hasRulesLines(rulesLayout) ? (
        <RulesBox
          layout={rulesLayout}
          colorHex={layout.rules.colorHex}
          overrides={pipOverrides}
          opacity={rulesPlaceholder ? 0.5 : undefined}
        />
      ) : null}

      {/* Adventure spell — the left storybook page (Adventure frames). */}
      {layout.adventure && adventure ? (
        <AdventurePanel
          slot={layout.adventure}
          data={adventure}
          rules={adventureRules}
          rulesPlaceholder={adventurePlaceholder}
          pipOverrides={pipOverrides}
        />
      ) : null}

      {/* Second face — the rotated bottom/right card (flip / split / aftermath). */}
      {layout.secondFace && secondFace ? (
        <SecondFacePanel
          slot={layout.secondFace}
          data={secondFace}
          aspect={aspect}
          rules={secondFaceRules}
          plateKey={plateKey}
          foil={plateFoil && { ...plateFoil, id: `${foilId}-pt2` }}
          pipOverrides={pipOverrides}
        />
      ) : null}

      {/* Footer — artist credit + brand. The collector line (TODO 4.9b)
          replaces it when the card's switch is on: CollectorBlock. */}
      {collector ? (
        <CollectorBlock layout={collector} ink={footerInkResolved?.colorHex ?? layout.footer?.colorHex ?? "#f4eee2"} />
      ) : null}
      {/* A TURNED footer (FrameProfile.footerTurn, TODO 4.21b): a landscape
          card's artist credit runs down its left border — the slot's rect is
          the band it covers, drawn as its unturned box and turned in place
          (unturnedRect, the bake's FooterBake twin). */}
      {!collector && layout.footer && footerInkResolved ? (
        <div
          data-testid="card-footer"
          style={{
            ...rectStyle(layout.footerTurn ? unturnedRect(layout.footer.rect, layout.footerTurn, aspect) : layout.footer.rect),
            ...(layout.footerTurn ? { transform: `rotate(${layout.footerTurn}deg)`, transformOrigin: "center" } : {}),
            zIndex: 20,
            display: "flex",
            alignItems: "center",
            // The slot's alignment (TODO 4.8.0; the bake's FooterBake twin):
            // unset = the line at the start, a custom mark at the end.
            justifyContent: layout.footer.align === "center" ? "center" : layout.footer.align === "end" ? "flex-end" : "space-between",
            gap: "2cqw",
            fontFamily: footerFace(layout.footer).previewFamily,
            fontSize: cqw(layout.footer.sizePct),
            color: footerInkResolved.colorHex,
            ...(footerInkResolved.shadowCss
              ? { textShadow: footerInkResolved.shadowCss }
              : {}),
            letterSpacing: `${layout.footer.letterSpacingEm ?? 0}em`,
            textTransform: layout.footer.uppercase ? "uppercase" : "none",
          }}
        >
          <span style={ELLIPSIS}>
            {slotLine(footerFace(layout.footer).id, footerArtistLine(layout.footer, face.artistCredit))}
          </span>
          {/* Footer-right: the owner's custom mark, or nothing — mirrors the
              bake (lib/render/card-image.tsx, layout v19). */}
          {footerWatermark && layout.footer.align !== "center" && layout.footer.align !== "end" ? (
            <span style={{ flexShrink: 0 }}>
              {slotLine(footerFace(layout.footer).id, footerWatermark)}
            </span>
          ) : null}
        </div>
      ) : null}

      {/* Brand mark — pipglyph.com, bottom-right, mirroring the bake's
          overlay (lib/render/card-image.tsx): placement + short-side scale
          from brandMarkLayout(layout), 2.6% of a portrait card's width,
          display font. Display surfaces always show it (layout v20); only a
          paid download renders without it. On a collector card (TODO 4.9b)
          the same mark sits in the line's © slot — the bake's twin. */}
      {brandMark && collector?.mark.kind === "brand" ? (
        <BrandMarkInCollectorSlot anchor={collector.mark.anchor} />
      ) : null}
      {/* A centred footer's © slot (TODO 4.10a: the 1997 frame): the mark on
          display — in place of the border mark below — and a clean
          download's footer text; the bake's twin. */}
      {copyright?.kind === "brand" ? <BrandMarkInCollectorSlot anchor={copyright.anchor} ink={copyright.ink} slot="copyright" /> : null}
      {copyright?.kind === "text" ? <CopyrightSlotText layout={copyright} /> : null}
      {brandMark && collector?.mark.kind !== "brand" && !copyright ? (
        <div
          aria-hidden
          className="pointer-events-none absolute z-40 flex items-center"
          style={{
            right: `${markLayout.rightPct}%`,
            bottom: `${markLayout.bottomPct}%`,
            // Satori's line box is the font's hhea "normal" (1.2056em for
            // Beleren); without this the mark inherits the page's 1.5 and
            // sits ~0.3% of the card height (6 px at 1500 wide) above the
            // bake. With it the two agree within ~1 px at 1500 wide.
            lineHeight: "normal",
            // Always the brand's face, whatever the frame's (faceOf "mark").
            fontFamily: faceOf(layout, "mark").previewFamily,
            // cqw() takes a FRACTION of the card width (0.026 = 2.6%).
            fontSize: cqw(0.026 * markLayout.scale),
            fontWeight: 600,
            letterSpacing: "0.02em",
            color: "rgba(255,255,255,0.82)",
            textShadow: "0 1px 3px rgba(0,0,0,0.8)",
            // On the art (BRAND_MARK_ON_ART): a dark pill behind it — the
            // bake's twin (brandMarkPillBake).
            ...(markLayout.pill ? brandMarkPillStyle(markLayout.scale) : {}),
          }}
        >
          <svg
            viewBox="0 0 32 32"
            style={{
              width: cqw(0.03 * markLayout.scale),
              height: cqw(0.03 * markLayout.scale),
              marginRight: cqw(0.008 * markLayout.scale),
            }}
          >
            <path d={ROSE_STAR_PATH} fill="rgba(255,255,255,0.82)" />
          </svg>
          pipglyph.com
        </div>
      ) : null}
    </div>
    </SymbolStyleContext.Provider>
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
        fontFamily: slotFace(slot).previewFamily,
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

/**
 * The collector line (TODO 4.9b): every run of lib/cards/collector-layout.ts
 * at its x (% of the width) and its line-box top (% of the height), its
 * size in cqw and the face's own line height, so the ink sits on the
 * layout's baseline — the bake's CollectorBake twin. The ★ and the brush
 * are the layout's path runs, scaled to their boxes.
 */
/** The holofoil stamp's oval (TODO 4.9c): the generated bitmap
 *  (lib/cards/holo-stamp-art.ts) stretched over the stamp's art rect — the
 *  oval and its black margin — above the finish sheens (z 7), as the bake
 *  draws it. The notch under it is one of the FrameOverlayLayer's images. */
function HoloStampOval({ stamp }: { stamp: ResolvedHoloStamp }) {
  const r = stamp.artRect;
  return (
    <div
      aria-hidden
      data-holo-stamp={stamp.shape}
      data-stamp-key={stamp.notch.key}
      className="pointer-events-none absolute"
      style={{
        top: `${r.topPct}%`,
        left: `${r.leftPct}%`,
        width: `${r.widthPct}%`,
        height: `${r.heightPct}%`,
        zIndex: 7,
        backgroundImage: `url("${HOLO_STAMP_OVAL_ART.dataUri}")`,
        backgroundSize: "100% 100%",
        backgroundRepeat: "no-repeat",
      }}
    />
  );
}

function CollectorBlock({ layout, ink }: { layout: CollectorLayout; ink: string }) {
  return (
    <div aria-hidden data-collector-line={layout.style} className="pointer-events-none absolute inset-0 z-20">
      {layout.runs.map((run, i) =>
        run.kind === "path" ? (
          <svg
            key={i}
            data-collector-run={run.role}
            viewBox={run.path === "star" ? COLLECTOR_STAR_VIEWBOX : COLLECTOR_BRUSH_VIEWBOX}
            preserveAspectRatio="none"
            style={{
              position: "absolute",
              left: `${run.xPct}%`,
              top: `${run.topPct}%`,
              width: `${run.widthPct}%`,
              height: `${run.heightPct}%`,
            }}
          >
            <path d={run.path === "star" ? COLLECTOR_STAR_PATH : COLLECTOR_BRUSH_PATH} fill={ink} fillRule="evenodd" />
          </svg>
        ) : (
          <span
            key={i}
            data-collector-run={run.role}
            style={{
              position: "absolute",
              left: `${run.xPct}%`,
              top: `${run.topPct}%`,
              ...collectorFaceStyle(run.face),
              fontSize: cqw(run.sizePct),
              lineHeight: run.lineHeight,
              letterSpacing: `${run.letterSpacingEm}em`,
              color: ink,
              whiteSpace: "nowrap",
            }}
          >
            {run.text}
          </span>
        ),
      )}
    </div>
  );
}

/** The brand mark in a collector card's © slot (TODO 4.9b): the mark
 *  block below, unchanged in face, size, ink and shadow, with its line box's
 *  top on the slot's baseline less the display face's ascent and its right
 *  edge on the slot's — the bake's BrandMarkInCollectorSlotBake twin. */
function BrandMarkInCollectorSlot({
  anchor,
  ink = { kind: "light" },
  slot = "collector",
}: {
  anchor: CollectorMarkAnchor;
  /** A centred footer's © slot (TODO 4.10a) may ask for the line's printed
   *  ink, flat (lib/cards/copyright-slot.ts); the collector slot never does. */
  ink?: CopyrightMarkInk;
  slot?: "collector" | "copyright";
}) {
  const scale = anchor.sizePct / 0.026;
  const color = ink.kind === "flat" ? ink.colorHex : BRAND_MARK_LIGHT_INK;
  return (
    <div
      aria-hidden
      data-brand-mark={slot}
      className="pointer-events-none absolute z-40 flex items-center"
      style={{
        right: `${100 - anchor.rightPct}%`,
        top: `${anchor.topPct}%`,
        lineHeight: anchor.lineHeight,
        fontFamily: BRAND_FACE.previewFamily,
        fontSize: cqw(anchor.sizePct),
        fontWeight: 600,
        letterSpacing: "0.02em",
        color,
        ...(ink.kind === "light" ? { textShadow: BRAND_MARK_LIGHT_SHADOW } : {}),
      }}
    >
      <svg
        viewBox="0 0 32 32"
        style={{
          width: cqw(0.03 * scale),
          height: cqw(0.03 * scale),
          marginRight: cqw(0.008 * scale),
        }}
      >
        <path d={ROSE_STAR_PATH} fill={color} />
      </svg>
      pipglyph.com
    </div>
  );
}

/** A centred footer's © slot on a clean download (TODO 4.10a): the card's
 *  footer text at the layout's pen x and line-box top, in the line's printed
 *  ink — the bake's CopyrightTextBake twin. */
function CopyrightSlotText({ layout }: { layout: Extract<CopyrightSlotLayout, { kind: "text" }> }) {
  return (
    <span
      data-copyright-slot="text"
      className="pointer-events-none absolute z-20"
      style={{
        left: `${layout.xPct}%`,
        top: `${layout.topPct}%`,
        fontFamily: layout.face.previewFamily,
        fontSize: cqw(layout.sizePct),
        lineHeight: layout.lineHeight,
        color: layout.colorHex,
        whiteSpace: "nowrap",
      }}
    >
      {layout.text}
    </span>
  );
}

/** The brand mark's pill on the art (BRAND_MARK_PILL, TODO 3.23) — the same
 *  fractions the bake sets in px (brandMarkPillBake). */
function brandMarkPillStyle(scale: number): CSSProperties {
  const padY = cqw(BRAND_MARK_PILL.padYPct * scale);
  return {
    background: BRAND_MARK_PILL.fill,
    padding: `${padY} ${cqw(BRAND_MARK_PILL.padXPct * scale)}`,
    borderRadius: `calc(${BRAND_MARK_PILL.radiusEm}em + ${padY})`,
  };
}

// ---------------------------------------------------------------------------
// SplitTypeLine — a type line printed in two boxes, split at the em dash
// (TextSlot.split, TODO 3.24): "Basic Land" left, the subtype right, at one
// size. The bake's SplitTypeBake twin; the set symbol prints only in the
// profile's symbolRect.
// ---------------------------------------------------------------------------

function SplitTypeLine({
  slot,
  split,
  parts,
  ink,
}: {
  slot: TextSlot;
  split: TypeLineSplit;
  parts: [string, string];
  ink: CSSProperties;
}) {
  return (
    <>
      <BandSlot slot={{ ...slot, rect: split.leftRect, align: split.leftAlign ?? "start" }}>
        <span style={{ ...ELLIPSIS, ...ink, ...textDy(slot) }} data-type-half="left">
          {displayLine(parts[0])}
        </span>
      </BandSlot>
      {parts[1] ? (
        <BandSlot slot={{ ...slot, rect: split.rightRect, align: split.rightAlign ?? "center" }}>
          <span style={{ ...ELLIPSIS, ...ink, ...textDy(slot) }} data-type-half="right">
            {displayLine(parts[1])}
          </span>
        </BandSlot>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// BasicSymbolDisc / BasicSymbol — a basic land's symbol in the profile's
// slot (FrameProfile.basicSymbol, TODO 3.24; lib/cards/basic-symbol.ts). The
// disc sits under the frame (z-1) so a see-through socket's ring overlaps
// its edge; the symbol sits above the frame (z-10, where the rules-box
// watermark would be). The bake's BasicSymbolDiscBake / BasicSymbolBake.
// ---------------------------------------------------------------------------

function BasicSymbolDisc({
  plan,
  colorKey,
  aspect,
}: {
  plan: BasicSymbolPlan;
  colorKey: string;
  aspect: number;
}) {
  return (
    <div
      aria-hidden
      data-testid="basic-symbol-disc"
      style={{
        ...rectStyle(basicSymbolBox(plan.slot.rect, aspect)),
        zIndex: 1,
        borderRadius: "50%",
        background: BASIC_SYMBOL_DISC_FILL[colorKey] ?? BASIC_SYMBOL_DISC_FILL.c,
      }}
    />
  );
}

function BasicSymbol({ plan, aspect }: { plan: BasicSymbolPlan; aspect: number }) {
  const { mark } = plan;
  const assetPath = mark.kind === "mana" ? basicSymbolAssetPath(plan.slot, mark.key) : null;
  const imageSrc =
    mark.kind === "custom"
      ? mark.url
      : mark.kind === "preset"
        ? `/watermarks/${mark.key}.png`
        : assetPath
          ? frameUrl(webpVariant(assetPath))
          : null;
  const innerPct = `${BASIC_SYMBOL_GLYPH_SCALE * 100}%`;
  return (
    <div
      aria-hidden
      data-testid="basic-symbol"
      style={{
        ...rectStyle(basicSymbolBox(plan.slot.rect, aspect)),
        zIndex: 10,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        pointerEvents: "none",
        opacity: plan.opacity,
      }}
    >
      {imageSrc ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={imageSrc}
          alt=""
          style={{
            width: assetPath ? "100%" : innerPct,
            height: assetPath ? "100%" : innerPct,
            objectFit: "contain",
          }}
        />
      ) : mark.kind === "mana" ? (
        <i
          className={`ms ms-${mark.key}`}
          style={{
            fontSize: cqw(basicSymbolGlyphSizePct(plan.slot.rect, aspect)),
            lineHeight: 1,
            color: BASIC_SYMBOL_INK[mark.key] ?? BASIC_SYMBOL_INK.c,
            textShadow: BASIC_SYMBOL_HALO,
          }}
        />
      ) : null}
    </div>
  );
}

/** A stat value's horizontal alignment in its rect (StatSlot.align) — the
 *  bake's twin. */
function statJustify(slot: Pick<StatSlot, "align">): CSSProperties["justifyContent"] {
  return slot.align === "end" ? "flex-end" : slot.align === "start" ? "flex-start" : "center";
}

// ---------------------------------------------------------------------------
// FlipsideOverlay — the modal strip's two texts (TODO 5.1b; lib/cards/
// flipside-strip.ts), the bake's FlipsideBake twin: the other face's type
// word in the display face from the box's left edge, and its cost / mana
// line as ONE nowrap row of runs at the HD bake's px in cqw (RulesBoxLine's
// construction: every word its ceiled box, word gaps as margins, each pip
// at the layout's pipTopPx) set against the box's right edge.
function FlipsideOverlay({
  slots,
  other,
  orientation,
  overrides,
}: {
  slots: FlipsideSlots;
  other: DfcFace["otherFace"];
  orientation: CardOrientation;
  overrides: PipOverrides | null;
}) {
  const symbols = useContext(SymbolStyleContext);
  const strip = flipsideStrip(slots, other, "hd", symbols.id);
  if (!strip) return null;
  return (
    <>
      {strip.word ? (
        <div
          data-testid="flipside-word"
          style={{
            ...rectStyle(slots.word.rect),
            zIndex: 22,
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-start",
            fontFamily: slotFace(slots.word).previewFamily,
            fontSize: cqw(slots.word.sizePct),
            fontWeight: slots.word.weight ?? 700,
            color: slots.word.colorHex,
            whiteSpace: "nowrap",
          }}
        >
          {strip.word}
        </div>
      ) : null}
      {strip.line ? <FlipsideLineOverlay slot={slots.line} line={strip.line} orientation={orientation} overrides={overrides} /> : null}
    </>
  );
}

function FlipsideLineOverlay({ slot, line, orientation, overrides }: { slot: TextSlot; line: FlipsideLine; orientation: CardOrientation; overrides: PipOverrides | null }) {
  const m = line.metrics;
  const hd = (px: number) => hdCqw(px, orientation);
  return (
    <div
      data-testid="flipside-line"
      style={{
        ...rectStyle(slot.rect),
        zIndex: 22,
        display: "flex",
        flexWrap: "nowrap",
        alignItems: "center",
        justifyContent: "flex-end",
        // The strip's cost / mana line is rules text: the body face.
        fontFamily: CARD_FONT,
        fontSize: hd(m.fontPx),
        color: slot.colorHex,
      }}
    >
      {line.runs.map((run, ri) => (
        <span
          key={ri}
          style={{
            display: "flex",
            alignItems: "center",
            flexShrink: 0,
            height: hd(m.linePx),
            ...(ri > 0 ? { marginLeft: hd(m.wordGapPx) } : {}),
          }}
        >
          {run.map((item, i) =>
            item.t === "m" ? (
              <RulesPip
                key={i}
                suffix={item.suffix}
                disc={hd(m.pipPx)}
                discPx={m.pipPx}
                top={hd(m.pipTopPx)}
                gapBefore={i > 0 && run[i - 1].t === "m" ? hd(m.pipGapPx) : null}
                overrides={overrides}
              />
            ) : (
              <span
                key={i}
                style={{
                  display: "inline-block",
                  flexShrink: 0,
                  whiteSpace: "nowrap",
                  width: hd(wordWidthPx(item, m)),
                  lineHeight: hd(m.linePx),
                  ...(item.em ? { fontStyle: "italic" } : {}),
                }}
              >
                {rulesWordText(item.v)}
              </span>
            ),
          )}
        </span>
      ))}
    </div>
  );
}

// ColorIndicatorOverlay — the colour-indicator dot (TODO 5.1a; lib/cards/
// color-indicator.ts): the outline disc, then the fills — one disc, two
// halves split on the diagonal, else wedges — in ONE inline SVG at the dot's
// box. The bake draws the same geometry (ColorIndicatorBake).
// ---------------------------------------------------------------------------

function ColorIndicatorOverlay({ fills }: { fills: readonly string[] }) {
  const box = colorIndicatorBox();
  const c = COLOR_INDICATOR_VIEW / 2;
  return (
    <svg
      aria-hidden
      data-testid="color-indicator"
      viewBox={`0 0 ${COLOR_INDICATOR_VIEW} ${COLOR_INDICATOR_VIEW}`}
      className="pointer-events-none absolute"
      style={{ ...rectStyle(box), zIndex: 8 }}
    >
      <circle cx={c} cy={c} r={colorIndicatorOutlineRadius()} fill={COLOR_INDICATOR.outlineHex} />
      {colorIndicatorWedges(fills).map((wedge, i) => (
        <path key={i} d={wedge.d} fill={wedge.fill} />
      ))}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// StatOverlay — P/T, loyalty, or defense. Renders the optional plate PNG
// behind the value, then the value centered on top (the battle's defense
// has no plate: its shield is the frame master's own paint).
// ---------------------------------------------------------------------------

function StatOverlay({
  slot,
  value,
  colorKey,
  masterKey,
  orientation,
  foil = null,
  testId,
}: {
  slot: StatSlot;
  value: string;
  /** A test hook for one stat among several (the reverse P/T) — never keyed
   *  on `slot.align`: the 1997 frame's own P/T is end-aligned too. */
  testId?: string;
  /** The card's colour key — picks the plate. */
  colorKey: string;
  /** The frame master the value prints on (frameMasterKey) — picks the ink. */
  masterKey: string;
  /** The card's orientation — the shrink-to-fit floor is a point size. */
  orientation: CardOrientation;
  /** Foil finish: the plate gets the card's sheen too (the full-card foil
   *  layer sits below the plates) — the bake's StatBake twin. */
  foil?: { id: string; landscape: boolean } | null;
}) {
  // The plate's own foil: the SAME SVG the bake draws between the plate and
  // its digits, masked by the plate image the browser shows (its WebP).
  const plateFoil = (rect: Rect, style: CSSProperties) =>
    foil && slot.plateAssetPathTemplate ? (
      <FoilSheen
        id={foil.id}
        frameHref={frameUrl(webpVariant(resolveColorAsset(slot.plateAssetPathTemplate, colorKey)))}
        region={rect}
        landscape={foil.landscape}
        width="100%"
        height="100%"
        style={{ ...style, pointerEvents: "none" }}
      />
    ) : null;
  // A separate plate box (TODO 4.18): the plate draws in plateRect, the
  // digits centre in rect — same split in the bake (StatBake).
  if (slot.plateRect && slot.plateAssetPathTemplate) {
    const plateSrc = resolveColorAsset(slot.plateAssetPathTemplate, colorKey);
    return (
      <>
        <picture>
          <source srcSet={frameUrl(webpVariant(plateSrc))} type="image/webp" />
          <img
            src={frameUrl(plateSrc)}
            alt=""
            aria-hidden
            className="pointer-events-none absolute object-fill"
            style={{ ...rectStyle(slot.plateRect), zIndex: 22 }}
          />
        </picture>
        {plateFoil(slot.plateRect, { ...rectStyle(slot.plateRect), zIndex: 22 })}
        <StatOverlay
          slot={{ ...slot, plateAssetPathTemplate: undefined, plateRect: undefined }}
          value={value}
          colorKey={colorKey}
          masterKey={masterKey}
          orientation={orientation}
        />
      </>
    );
  }
  // Per-frame-master ink (Alpha: silver on every frame but white) — the
  // same slotInk() the bake's StatBake resolves.
  const ink = slotInk(slot, masterKey);
  // A value whose ink would run off its face shrinks to fit (TODO 3.18);
  // one that fits keeps the profile size — the same fitStatSizePct() as the
  // bake.
  const sizePct = fitStatSizePct(slot, value, orientation);
  return (
    <div
      className="pointer-events-none absolute flex items-center"
      data-testid={testId}
      // Above the text layers (z20/21): printed cards draw the P/T plate and
      // the starting-loyalty shield OVER the text box edge, never under it.
      // Centred, or set against an edge (StatSlot.align — the transform
      // front's reverse P/T, TODO 5.1a) — the bake's StatBake twin.
      style={{ ...rectStyle(slot.rect), zIndex: 22, justifyContent: statJustify(slot) }}
    >
      {slot.plateAssetPathTemplate ? (
        // Browser-side WebP variant with PNG fallback; the bake resolves the
        // same template to the PNG master (lib/render/card-frames.ts).
        <picture>
          <source
            srcSet={frameUrl(
              webpVariant(resolveColorAsset(slot.plateAssetPathTemplate, colorKey)),
            )}
            type="image/webp"
          />
          <img
            src={frameUrl(resolveColorAsset(slot.plateAssetPathTemplate, colorKey))}
            alt=""
            aria-hidden
            className="absolute inset-0 h-full w-full object-fill"
          />
        </picture>
      ) : null}
      {plateFoil(slot.rect, { top: 0, left: 0, width: "100%", height: "100%" })}
      <span
        className="relative"
        style={{
          fontFamily: slotFace(slot).previewFamily,
          fontSize: cqw(sizePct),
          // One line, centred, always — the bake's StatBake twin: a value
          // wider than its rect (its face may be wider) overflows it evenly
          // instead of wrapping after a slash.
          whiteSpace: "nowrap",
          flexShrink: 0,
          fontWeight: slot.weight ?? 700,
          color: ink.colorHex,
          ...(slot.valueDxEm || slot.valueDyEm
            ? {
                transform: `translate(${slot.valueDxEm ?? 0}em, ${slot.valueDyEm ?? 0}em)`,
              }
            : {}),
          ...(ink.shadowCss ? { textShadow: ink.shadowCss } : {}),
        }}
      >
        {value}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The saga rail (TODO 4.21c) — the bake's twins, drawn at the HD bake's px
// (lib/cards/saga-rail.ts sagaRailDrawing "hd") scaled to the card.
//
// SagaRailPieces: the dividers and chapter badges, the pack's bitmaps at the
// layout's boxes — frame pieces, right after the frame and under the
// finishes (the bake's railPieces). ChapterRail: the INK — the reminder block
// and each chapter's lines (rules layouts, drawn by RulesBox in their own
// boxes) and each badge's numeral, a one-line box the badge's width, one em
// tall, from the layout's top.
// ---------------------------------------------------------------------------

function SagaRailPieces({ pieces }: { pieces: readonly { path: string; rect: Rect }[] }) {
  if (pieces.length === 0) return null;
  return (
    <div aria-hidden data-saga-rail-pieces="" className="pointer-events-none absolute inset-0" style={{ zIndex: 5 }}>
      {pieces.map((piece, i) => (
        <div
          key={i}
          data-saga-piece={piece.path.includes("divider") ? "divider" : "badge"}
          className="absolute"
          style={{
            ...rectStyle(piece.rect),
            position: "absolute",
            backgroundImage: `url("${frameOverlayImageUrl(piece.path)}")`,
            backgroundSize: "100% 100%",
            backgroundRepeat: "no-repeat",
          }}
        />
      ))}
    </div>
  );
}

function ChapterRail({
  slot,
  rail,
  pipOverrides = null,
}: {
  slot: ChapterSlot;
  /** The rail at the HD bake's px (sagaRailDrawing "hd"). */
  rail: SagaRailDrawing;
  pipOverrides?: PipOverrides | null;
}) {
  const hdX = (px: number) => `${((px * 100) / rail.cardWidth).toFixed(4)}%`;
  const hdY = (px: number) => `${((px * 100) / rail.cardHeight).toFixed(4)}%`;
  const empty = rail.rows.length === 0 && !(rail.intro && hasRulesLines(rail.intro));
  return (
    <>
      {rail.intro && hasRulesLines(rail.intro) ? (
        <RulesBox layout={rail.intro} colorHex={slot.textColorHex} overrides={pipOverrides} />
      ) : null}
      {rail.rows.map((row, i) =>
        hasRulesLines(row.text) ? (
          <RulesBox key={`text-${i}`} layout={row.text} colorHex={slot.textColorHex} overrides={pipOverrides} />
        ) : null,
      )}
      {rail.rows.flatMap((row, i) =>
        row.badges.map((badge, j) => (
          <div
            key={`numeral-${i}-${j}`}
            data-saga-numeral={badge.label}
            style={{
              position: "absolute",
              left: hdX(badge.left),
              top: hdY(badge.labelTop),
              width: hdX(badge.width),
              height: hdCqw(badge.fontPx),
              zIndex: 20,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: faceOf({ chapters: slot }, "numeral").previewFamily,
              fontSize: hdCqw(badge.fontPx),
              lineHeight: 1,
              color: slot.badge.numeralColorHex,
              whiteSpace: "nowrap",
            }}
          >
            {badge.label}
          </div>
        )),
      )}
      {empty ? (
        <div
          style={{
            ...rectStyle(slot.rect),
            zIndex: 20,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <span
            style={{
              padding: "0 2cqw",
              fontStyle: "italic",
              fontFamily: CARD_FONT,
              fontSize: cqw(slot.sizePct * 0.7),
              color: slot.textColorHex,
              opacity: 0.5,
              textAlign: "center",
            }}
          >
            Add chapters as I — / II — / III — lines.
          </span>
        </div>
      ) : null}
    </>
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
  rules,
  rulesPlaceholder,
  pipOverrides = null,
}: {
  slot: NonNullable<FrameProfile["adventure"]>;
  data: AdventureData;
  /** The page's rules layout (lib/cards/rules-box.ts adventureRulesLayout) —
   *  the editor's hint when `rulesPlaceholder`. */
  rules: RulesLayout | null;
  rulesPlaceholder: boolean;
  pipOverrides?: PipOverrides | null;
}) {
  const name = data.title?.trim() || "Adventure";
  const typeLine = buildTypeLine({
    supertype: data.supertype,
    cardType: data.cardType,
    subtypes: data.subtypes,
  });
  const showCost = Boolean(data.cost?.trim());
  // A measured panel (the M15-era family, layout v32) fits its name before
  // its inline cost and its type line to its bar — the bake's twins
  // (AdventureBake); the pips keep their size. Otherwise the slots' sizes.
  const symbols = useContext(SymbolStyleContext);
  const titleFit = fitTitleBand(
    { title: slot.title, costSizePct: slot.costSizePct, symbolStyle: symbols.id },
    name,
    showCost ? data.cost : null,
  );
  const typeFit =
    slot.type.fit === "measured"
      ? fitTypeLineBand({ layout: { type: slot.type }, text: typeLine, symbolWidthPct: null })
      : null;
  // A shrunk line at the stored HD bake's whole px (measuredLinePreviewPct).
  const panelPct = (fitted: number, base: number, measured: boolean) =>
    measured ? measuredLinePreviewPct(fitted, base) : fitted;
  return (
    <>
      <BandSlot
        slot={
          titleFit
            ? { ...slot.title, sizePct: panelPct(titleFit.sizePct, slot.title.sizePct, slot.title.fit === "measured") }
            : slot.title
        }
      >
        <span
          style={titleFit ? { ...ELLIPSIS, maxWidth: cqw(titleFit.widthPct) } : ELLIPSIS}
          title={name}
        >
          {displayLine(titleFit ? titleFit.text : name)}
        </span>
        {showCost ? (
          <ManaCostGlyphs
            cost={data.cost}
            disc={costDisc(slot.costSizePct ?? slot.title.sizePct)}
            overrides={pipOverrides}
            symbols={symbols}
          />
        ) : null}
      </BandSlot>
      <BandSlot slot={typeFit ? { ...slot.type, sizePct: panelPct(typeFit.sizePct, slot.type.sizePct, true) } : slot.type}>
        <span style={typeFit?.widthPct != null ? { ...ELLIPSIS, maxWidth: cqw(typeFit.widthPct) } : ELLIPSIS}>
          {displayLine(typeFit ? typeFit.text : typeLine)}
        </span>
      </BandSlot>
      {/* The page's rules, line by line (layout v33); the editor's hint on
          an empty page. */}
      {hasRulesLines(rules) ? (
        <RulesBox
          layout={rules}
          colorHex={slot.rules.colorHex}
          overrides={pipOverrides}
          opacity={rulesPlaceholder ? 0.55 : undefined}
        />
      ) : null}
    </>
  );
}

/** The editor's hint on an empty adventure page (never baked). */
const ADVENTURE_RULES_HINT = "Adventure rules (the back face).";

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
  rules,
  plateKey,
  foil = null,
  pipOverrides = null,
}: {
  slot: NonNullable<FrameProfile["secondFace"]>;
  data: FaceData;
  aspect: number;
  /** The face's rules layout, in its own unturned frame
   *  (lib/cards/rules-box.ts secondFaceRulesLayout). */
  rules: RulesLayout | null;
  /** The card's plate key (plateKeyFor) — picks the face's P/T plate. */
  plateKey: string;
  /** Foil finish: the plate gets the card's sheen too (StatOverlay's twin). */
  foil?: { id: string; landscape: boolean } | null;
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
  // Same math as SecondFaceBake: a `fitLines` face's name bar (name + cost)
  // and type line shrink to fit their bars (aftermath's short sideways ones,
  // flip's upside-down ones), down to the card's own 5 pt floor.
  const symbols = useContext(SymbolStyleContext);
  const lineSizes = secondFaceLineSizes({
    slot,
    name,
    typeLine,
    cost: showCost ? data.cost : null,
    orientation: orientationFromAspect(aspect),
    symbols: symbols.id,
  });
  // A `fitLines` face's shrunk lines at the stored HD bake's whole px, as the
  // bake sets them (measuredLinePx); a face without it as before.
  const linePct = (fitted: number, base: number) =>
    slot.fitLines ? measuredLinePreviewPct(fitted, base, orientationFromAspect(aspect)) : fitted;
  // An UNTURNED second face whose slots are measured (split's right half,
  // TODO 4.21b) draws its name and type bands exactly as the front draws
  // its own (CardFace's title / type BandSlot): fitTitleBand /
  // fitTypeLineBand on its own slots, a shrunk line at the stored HD bake's
  // whole px on its kept baseline (textDy), the pips at their own size — so
  // both halves of a split card are set alike. It draws no set symbol (TODO
  // 3.9). The bake's SecondFaceBake twin.
  const orientation = orientationFromAspect(aspect);
  const measured = slot.rotation === 0 && slot.title.fit === "measured";
  const faceTitleFit = measured
    ? fitTitleBand({ title: slot.title, costSizePct: slot.costSizePct, symbolStyle: symbols.id }, name, showCost ? data.cost : null, orientation)
    : null;
  const faceTitleSizePct = faceTitleFit
    ? measuredLinePreviewPct(faceTitleFit.sizePct, slot.title.sizePct, orientation)
    : slot.title.sizePct;
  const faceTypeFit =
    measured && slot.type.fit === "measured"
      ? fitTypeLineBand({ layout: { type: slot.type }, text: typeLine, symbolWidthPct: null, orientation })
      : null;
  const faceTypeSizePct = faceTypeFit
    ? measuredLinePreviewPct(faceTypeFit.sizePct, slot.type.sizePct, orientation)
    : slot.type.sizePct;
  return (
    <>
      {faceTitleFit ? (
        <BandSlot slot={{ ...slot.title, sizePct: faceTitleSizePct }}>
          <span
            data-testid="second-face-title"
            style={{ ...ELLIPSIS, ...textDy(slot.title, faceTitleSizePct), maxWidth: cqw(faceTitleFit.widthPct) }}
            title={name}
          >
            {displayLine(faceTitleFit.text)}
          </span>
          {showCost ? (
            <ManaCostGlyphs
              cost={data.cost}
              disc={costDisc(slot.costSizePct ?? slot.title.sizePct, orientation)}
              overrides={pipOverrides}
            symbols={symbols}
            />
          ) : null}
        </BandSlot>
      ) : (
      <div
        style={{
          ...rectStyle(slot.title.rect),
          zIndex: 21,
          transform: rot,
          transformOrigin: "center",
          display: "flex",
          alignItems: "center",
          justifyContent: showCost ? "space-between" : "flex-start",
          gap: cqw(NAME_COST_GAP_PCT),
          fontFamily: slotFace(slot.title).previewFamily,
          fontSize: cqw(linePct(lineSizes.titleSizePct, slot.title.sizePct)),
          fontWeight: slot.title.weight ?? 600,
          color: slot.title.colorHex,
        }}
      >
        <span style={ELLIPSIS} title={name}>
          {displayLine(lineSizes.titleText)}
        </span>
        {showCost ? (
          <ManaCostGlyphs
            cost={data.cost}
            disc={costDisc(lineSizes.costSizePct, orientation)}
            overrides={pipOverrides}
            symbols={symbols}
          />
        ) : null}
      </div>
      )}
      {faceTypeFit ? (
        <BandSlot slot={{ ...slot.type, sizePct: faceTypeSizePct }}>
          <span
            data-testid="second-face-type"
            style={{
              ...ELLIPSIS,
              ...textDy(slot.type, faceTypeSizePct),
              ...(faceTypeFit.widthPct !== null ? { maxWidth: cqw(faceTypeFit.widthPct) } : {}),
            }}
          >
            {displayLine(faceTypeFit.text)}
          </span>
        </BandSlot>
      ) : (
      <div
        style={{
          ...rectStyle(slot.type.rect),
          zIndex: 21,
          transform: rot,
          transformOrigin: "center",
          display: "flex",
          alignItems: "center",
          fontFamily: slotFace(slot.type).previewFamily,
          fontSize: cqw(linePct(lineSizes.typeSizePct, slot.type.sizePct)),
          fontWeight: slot.type.weight ?? 600,
          color: slot.type.colorHex,
        }}
      >
        <span style={ELLIPSIS}>{displayLine(lineSizes.typeText)}</span>
      </div>
      )}
      {/* The face's rules, line by line in its own frame, turned in place
          with it (layout v33) — at the slot's own alignment. */}
      {hasRulesLines(rules) ? (
        <RulesBox
          layout={rules}
          colorHex={slot.rules.colorHex}
          overrides={pipOverrides}
          zIndex={21}
          rotation={slot.rotation}
        />
      ) : null}
      {/* The face's P/T plate (flip, layout v38): drawn at its own box
          UNTURNED — the bottom plate is upside-down in the source, as the
          printed card shows it — under the value, which turns with the face.
          Only when the half has a P/T (showPT), as on M15. The bake's
          SecondFaceBake twin. */}
      {showPT && slot.pt?.plateAssetPathTemplate && slot.pt.plateRect ? (
        <>
          <picture>
            <source srcSet={frameUrl(webpVariant(resolveColorAsset(slot.pt.plateAssetPathTemplate, plateKey)))} type="image/webp" />
            <img
              src={frameUrl(resolveColorAsset(slot.pt.plateAssetPathTemplate, plateKey))}
              alt=""
              aria-hidden
              data-testid="second-face-plate"
              className="pointer-events-none absolute object-fill"
              style={{ ...rectStyle(slot.pt.plateRect), zIndex: 21 }}
            />
          </picture>
          {foil ? (
            <FoilSheen
              id={foil.id}
              frameHref={frameUrl(webpVariant(resolveColorAsset(slot.pt.plateAssetPathTemplate, plateKey)))}
              region={slot.pt.plateRect}
              landscape={foil.landscape}
              width="100%"
              height="100%"
              style={{ ...rectStyle(slot.pt.plateRect), zIndex: 21, pointerEvents: "none" }}
            />
          ) : null}
        </>
      ) : null}
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
            fontFamily: slotFace(slot.pt).previewFamily,
            // Shrinks to fit, on one line, like the front's StatOverlay (TODO 3.18).
            fontSize: cqw(
              fitStatSizePct(
                slot.pt,
                ptValue(data.power, data.toughness),
                orientationFromAspect(aspect),
                slot.rotation === 180,
              ),
            ),
            whiteSpace: "nowrap",
            fontWeight: slot.pt.weight ?? 700,
            color: slot.pt.colorHex,
            ...(slot.pt.shadowCss ? { textShadow: slot.pt.shadowCss } : {}),
          }}
        >
          {/* The same nudge as the front's StatOverlay (valueDxEm /
              valueDyEm), on the value's own span inside the turned box, so
              it moves in the value's frame — the bake's twin. */}
          <span
            className="relative"
            style={
              slot.pt.valueDxEm || slot.pt.valueDyEm
                ? { transform: `translate(${slot.pt.valueDxEm ?? 0}em, ${slot.pt.valueDyEm ?? 0}em)` }
                : undefined
            }
          >
            {ptValue(data.power, data.toughness)}
          </span>
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

/** TextSlot.dy (TODO 4.20): the slot's text span — never its band, pips or
 *  set symbol — moved vertically by a fraction of the card width (negative
 *  = up), as costDy moves the pips; a measured line the fit shrank to
 *  `drawnSizePct` also keeps its baseline (slotTextDy). Front-face title and
 *  type line only; the bake's textDyBake twin moves it by the same amount in
 *  whole px. */
function textDy(slot: TextSlot, drawnSizePct = slot.sizePct): CSSProperties {
  const dy = slotTextDy(slot, drawnSizePct);
  return dy ? { transform: `translateY(${cqw(dy)})` } : {};
}

// A cost row's disc and pip gap (ManaCostGlyphs' `disc`): the stored HD
// bake's whole px in cqw (costRowHdPx — CostGlyphs' disc and gap at that
// width), so the row is the PNG's at every preview size. The stylesheet's
// `.ms-cost { font-size: 0.95em }` made a disc sized through its PARENT's
// font 5 % smaller than the bake's, and an em gap on that parent narrower
// still: a six-pip cost began ~30 HD px right of the PNG's (found
// 2026-10-07, in every frame).
function costDisc(
  discPct: number,
  orientation: CardOrientation = "portrait",
): { size: string; gap: string; px: number } {
  const { discPx, gapPx } = costRowHdPx(discPct, orientation);
  return { size: hdCqw(discPx, orientation), gap: hdCqw(gapPx, orientation), px: discPx };
}

function vJustify(align: SlotAlign): string {
  return align === "center" ? "center" : align === "end" ? "flex-end" : "flex-start";
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

/** An HD px length (lib/cards/rules-layout.ts) as the preview draws it: the
 *  same fraction of the card's width as on the stored HD bake, in cqw. */
function hdCqw(px: number, orientation: CardOrientation = "portrait"): string {
  return `${((px * 100) / RULES_HD_WIDTH[orientation]).toFixed(4)}cqw`;
}

// RulesLines — the lines lib/cards/rules-layout.ts broke a text into (layout
// v33), drawn at the HD bake's px (metricsFor "hd", in cqw) so the preview's
// geometry is the stored bake's: the walker rows' abilities and the saga
// rail's text. The browser never wraps them: each line is a `nowrap` flex
// row one line box tall, its runs `flexShrink: 0`, a word gap as the
// marginLeft of every run after the first, every word its ceiled box
// (wordWidthPx — the width Satori gives it), each run the line box tall and
// its pips at the layout's pipTopPx (layout v36). U+2212 draws as
// the hyphen MPlantin has (the bake's bakeText) — the advance the layout
// measured. Mirrors RulesLinesBake.
function RulesLines({
  blocks,
  metrics: m,
  orientation = "portrait",
  overrides = null,
}: {
  blocks: readonly RulesBlock[];
  metrics: RulesMetrics;
  orientation?: CardOrientation;
  overrides?: PipOverrides | null;
}) {
  const px = (v: number) => hdCqw(v, orientation);
  const lineHeight = m.linePx / m.fontPx;
  const rows: ReactNode[] = [];
  blocks.forEach((block, bi) => {
    const gap = bi === 0 ? 0 : block.kind === "flavor" ? m.flavorGapNoBarPx : m.paragraphGapPx;
    if (block.kind === "blank") {
      rows.push(<div key={`blank-${bi}`} style={{ flexShrink: 0, height: px(m.blankLinePx), marginTop: gap ? px(gap) : undefined }} />);
      return;
    }
    block.lines.forEach((line, li) => {
      rows.push(
        <div
          key={`${bi}-${li}`}
          data-rules-line=""
          style={{
            display: "flex",
            flexWrap: "nowrap",
            alignItems: "center",
            flexShrink: 0,
            whiteSpace: "nowrap",
            height: px(m.linePx),
            ...(li === 0 && gap ? { marginTop: px(gap) } : {}),
          }}
        >
          {line.runs.map((run, ri) => (
            <span
              key={ri}
              style={{
                display: "inline-flex",
                alignItems: "center",
                flexShrink: 0,
                height: px(m.linePx),
                ...(ri > 0 ? { marginLeft: px(m.wordGapPx) } : {}),
              }}
            >
              {run.map((it, i) => (
                <RulesLineItem
                  key={i}
                  item={it}
                  metrics={m}
                  orientation={orientation}
                  lineHeight={lineHeight}
                  pipGapBefore={i > 0 && it.t === "m" && run[i - 1].t === "m"}
                  overrides={overrides}
                />
              ))}
            </span>
          ))}
        </div>,
      );
    });
  });
  return (
    <div style={{ display: "flex", flexDirection: "column", flexShrink: 0, fontSize: px(m.fontPx) }}>{rows}</div>
  );
}

// One item of a RulesLines run: a word at the line box's height (italic for
// any emphasis) in its ceiled box, or an inline pip whose disc is
// metrics.pipPx (RulesPip draws it as the bake's ManaGem, CardPip).
function RulesLineItem({
  item,
  metrics: m,
  orientation,
  lineHeight,
  pipGapBefore,
  overrides,
}: {
  item: RulesItem;
  metrics: RulesMetrics;
  orientation: CardOrientation;
  lineHeight: number;
  pipGapBefore: boolean;
  overrides: PipOverrides | null;
}) {
  if (item.t === "m") {
    return (
      <RulesPip
        suffix={item.suffix}
        disc={hdCqw(m.pipPx, orientation)}
        discPx={m.pipPx}
        top={hdCqw(m.pipTopPx, orientation)}
        gapBefore={pipGapBefore ? hdCqw(m.pipGapPx, orientation) : null}
        overrides={overrides}
      />
    );
  }
  // The word's ceiled box (the bake's width for it), so every run after it
  // starts where the bake starts it.
  return (
    <span
      style={{
        display: "inline-block",
        flexShrink: 0,
        width: hdCqw(wordWidthPx(item, m), orientation),
        lineHeight,
        ...(item.em ? { fontStyle: "italic" } : {}),
      }}
    >
      {rulesWordText(item.v)}
    </span>
  );
}

// One inline pip of a rules line: the layout's disc, drawn as the bake's
// ManaGem (CardPip: the glyph and the shadow at the stored bake's px), a
// hairline after an adjacent pip. The pip sits in a wrapper whose font size
// is the disc, that carries that gap as PADDING and has no margin of its
// own: mana-font styles `.ms-2 { margin-left: inherit !important }`, so a
// {2} disc whose parent was a run with a word gap took that gap again and
// pushed the rest of its line a word gap right of the bake (layout v33
// review: "equip cost {2} destroy" drew 11 HD px apart). The bake has no
// such rule.
function RulesPip({
  suffix,
  disc,
  discPx,
  top,
  gapBefore,
  overrides,
}: {
  suffix: string;
  /** The disc's diameter (RulesMetrics.pipPx, in cqw). */
  disc: string;
  /** That disc in the HD bake's px. */
  discPx: number;
  /** The disc's top in its line box (RulesMetrics.pipTopPx, in cqw): the
   *  run is the line box tall, so the wrapper sits at exactly that top. */
  top: string;
  gapBefore: string | null;
  overrides: PipOverrides | null;
}) {
  const symbols = useContext(SymbolStyleContext);
  const overrideSrc = pipOverrideForSuffix(suffix, overrides);
  // A symbol the font has no glyph for: the bake draws no disc and keeps
  // neither its room nor its gap (ManaGem) — nor does this.
  if (!cardPipDraws(suffix, symbols, overrideSrc)) return null;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        alignSelf: "flex-start",
        marginTop: top,
        flexShrink: 0,
        fontSize: disc,
        ...(gapBefore ? { paddingLeft: gapBefore } : {}),
      }}
    >
      <CardPip suffix={suffix} discPx={discPx} symbols={symbols} overrideSrc={overrideSrc} />
    </span>
  );
}

// RulesBox — the preview's rules box (layout v33, TODO 3.29): a fitted
// lib/cards/rules-layout.ts layout drawn line by line — the bake's
// RulesBoxBake twin, at the HD bake's px in cqw (px × 100 ÷ the HD card
// width), so its geometry is the stored PNG's. The browser never wraps: each
// line is a nowrap flex row exactly its line box tall, its runs never
// shrink, each word is its own box with the line box as its line height,
// word gaps are margins, pips are the layout's discs. Rules paragraphs,
// blank lines, and the flavor with its 1 px bar where the frame prints one,
// all at the layout's fixed gaps. The main box on every template, the
// adventure page and the second faces (turned in place by `rotation`).
function RulesBox({
  layout,
  colorHex,
  overrides = null,
  zIndex = 20,
  rotation = 0,
  opacity,
}: {
  layout: RulesLayout;
  colorHex: string;
  overrides?: PipOverrides | null;
  zIndex?: number;
  rotation?: number;
  /** An editor placeholder's muted ink. */
  opacity?: number;
}) {
  const d = rulesDraw(layout, "hd");
  const hd = (px: number) => cqw(px / RULES_HD_WIDTH[layout.orientation]);
  return (
    <div
      data-testid="rules-box"
      data-rules-size={layout.sizePx}
      style={{
        ...rectStyle(layout.input.rect),
        zIndex,
        display: "flex",
        flexDirection: "column",
        alignItems: "stretch",
        justifyContent: vJustify(d.vAlign),
        overflow: "hidden",
        padding: `${hd(d.pad.top)} ${hd(d.pad.right)} ${hd(d.pad.bottom)} ${hd(d.pad.left)}`,
        fontFamily: CARD_FONT,
        fontSize: hd(d.fontPx),
        color: colorHex,
        ...(rotation ? { transform: `rotate(${rotation}deg)`, transformOrigin: "center" } : {}),
        ...(opacity !== undefined ? { opacity } : {}),
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flexShrink: 0,
          paddingTop: hd(d.insetTop),
          paddingBottom: hd(d.insetBottom),
        }}
      >
        {d.blocks.map((b, bi) =>
          b.kind === "blank" ? (
            <div key={bi} style={{ flexShrink: 0, height: hd(b.height), marginTop: hd(b.marginTop) }} />
          ) : (
            <div
              key={bi}
              style={{
                display: "flex",
                flexDirection: "column",
                flexShrink: 0,
                ...(b.bar
                  ? {
                      marginTop: hd(b.bar.above),
                      // The bar stays a 1 CSS px line, but the layout
                      // reserved one HD px for it: the padding makes up the
                      // difference, so the flavor lands where the bake puts
                      // it at every editor width (a 1 px border alone set it
                      // up to 3 HD px low at 330 px).
                      paddingTop: `calc(${hd(b.bar.below + b.bar.thickness)} - ${b.bar.thickness}px)`,
                      borderTop: `${b.bar.thickness}px solid ${colorHex}44`,
                    }
                  : { marginTop: hd(b.marginTop) }),
              }}
            >
              {b.lines.map((runs, li) => (
                <RulesBoxLine key={li} runs={runs} indent={b.indents[li]} d={d} hd={hd} overrides={overrides} />
              ))}
            </div>
          ),
        )}
      </div>
    </div>
  );
}

// One drawn line: a nowrap row of runs, the line box tall, each run the line
// box tall too (its pips at the layout's pipTopPx, layout v36), centred on it
// — indented from the column's left by the layout's whole px when it is a
// centred single line (TextSlot.alignSingleLine), as the bake draws it.
function RulesBoxLine({
  runs,
  indent,
  d,
  hd,
  overrides,
}: {
  runs: RulesItem[][];
  indent: number;
  d: RulesDraw;
  hd: (px: number) => string;
  overrides: PipOverrides | null;
}) {
  // The layout's disc; RulesPip sets the glyph and the shadow in it (CardPip).
  const pipDisc = hd(d.pipPx);
  return (
    <div
      data-testid="rules-line"
      style={{
        display: "flex",
        flexWrap: "nowrap",
        alignItems: "center",
        height: hd(d.linePx),
        flexShrink: 0,
        ...(indent > 0 ? { marginLeft: hd(indent) } : {}),
      }}
    >
      {runs.map((run, ri) => (
        <span
          key={ri}
          style={{
            display: "flex",
            alignItems: "center",
            flexShrink: 0,
            height: hd(d.linePx),
            ...(ri > 0 ? { marginLeft: hd(d.wordGapPx) } : {}),
          }}
        >
          {run.map((item, i) => {
            if (item.t === "m") {
              return (
                <RulesPip
                  key={i}
                  suffix={item.suffix}
                  disc={pipDisc}
                  discPx={d.pipPx}
                  top={hd(d.pipTopPx)}
                  gapBefore={i > 0 && run[i - 1].t === "m" ? hd(d.pipGapPx) : null}
                  overrides={overrides}
                />
              );
            }
            // Each word in its ceiled box — the width Satori gives it
            // (wordWidthPx) — so every run after it starts where the bake
            // starts it; the browser would lay the word out at its exact
            // advances and drift up to 9 HD px left along a line.
            return (
              <span
                key={i}
                style={{
                  display: "inline-block",
                  flexShrink: 0,
                  whiteSpace: "nowrap",
                  width: hd(wordWidthPx(item, d)),
                  lineHeight: hd(d.linePx),
                  ...(item.em ? { fontStyle: "italic" } : {}),
                }}
              >
                {rulesWordText(item.v)}
              </span>
            );
          })}
        </span>
      ))}
    </div>
  );
}

// The editor-only empty walker's hint rows.
const EDITOR_LOYALTY_HINT: LoyaltyAbility[] = [
  { cost: null, text: "Loyalty abilities appear here — add them on the Text & stats step." },
  { cost: null, text: "" },
  { cost: null, text: "" },
];

// LoyaltyRows — printed-planeswalker ability rows: a loyalty-cost badge in the
// left rail + the ability text, alternating translucent row shading. Static
// abilities (no leading cost) render unbadged. Mirrors LoyaltyRowsBake; both
// draw the rows layoutLoyaltyRows sized from their text.
function LoyaltyRows({
  slot,
  rows,
  abilities,
  rowsLayout,
  pipOverrides = null,
  placeholder = false,
  foil = null,
}: {
  slot: TextSlot;
  rows: NonNullable<FrameProfile["loyaltyRows"]>;
  abilities: LoyaltyAbility[];
  rowsLayout: LoyaltyRowsLayout;
  pipOverrides?: PipOverrides | null;
  /** Editor-only empty state — mutes the row text into a hint. */
  placeholder?: boolean;
  /** Foil finish: each stripe gets its own sheen (FoilStripeSheen) — the
   *  translucent stripes sit above the full-card layer. The bake's
   *  LoyaltyRowsBake twin. */
  foil?: { id: string; landscape: boolean } | null;
}) {
  const { rowFractions } = rowsLayout;
  // The HD bake's px (loyaltyRowsDrawing "hd"), drawn in cqw: the rows'
  // anatomy and each ability's column, lines and ink headroom.
  const draw = loyaltyRowsDrawing(rowsLayout, "hd");
  const a = draw.row;
  const stripe = (i: number) => (i % 2 === 0 ? rows.stripeAHex : rows.stripeBHex);
  const stripeRects = foil ? loyaltyStripeRects(slot.rect, rowsLayout.rowFractions) : null;
  // Foil: rows contain their sheen, and the badge + text after it are
  // positioned so they paint on top (the bake's document order).
  const onTop = foil ? { position: "relative" as const } : {};
  return (
    <div
      style={{
        ...rectStyle(slot.rect),
        zIndex: 20,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        fontFamily: CARD_FONT,
        color: slot.colorHex,
        borderRadius: "1.2cqw",
      }}
    >
      {abilities.map((ab, i) => (
        <div
          key={i}
          style={{
            display: "flex",
            // The shared row height, never content-grown (min-height: auto
            // is what let the browser's rows drift from the bake's).
            flex: "none",
            height: `${rowFractions[i] * 100}%`,
            minHeight: 0,
            alignItems: "center",
            background: stripe(i),
            paddingTop: hdCqw(a.padY),
            paddingBottom: hdCqw(a.padY),
            paddingLeft: hdCqw(a.padX),
            ...onTop,
          }}
        >
          {/* Foil: the stripe's sheen — the row's first child. */}
          {foil && stripeRects ? (
            <FoilStripeSheen
              id={`${foil.id}-${i}`}
              region={stripeRects[i]}
              fill={stripe(i)}
              landscape={foil.landscape}
              width="100%"
              height="100%"
              style={{ pointerEvents: "none" }}
            />
          ) : null}
          <div
            style={{
              position: "relative",
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: hdCqw(a.badgeWidth),
              height: hdCqw(a.badgeHeight),
              // The text column starts where the rail ends: the column the
              // ability's lines were broken for.
              marginRight: hdCqw(a.rail - a.padX - a.badgeWidth),
            }}
          >
            {ab.cost ? (
              // The printed loyalty shield asset: peaked top for +, pointed
              // bottom for -, flat hexagon for 0. WebP in the browser, PNG
              // fallback (the bake reads the PNG master directly).
              <picture>
                <source
                  srcSet={frameUrl(webpVariant(loyaltyBadgeAssetFor(ab.cost)))}
                  type="image/webp"
                />
                <img
                  src={frameUrl(loyaltyBadgeAssetFor(ab.cost))}
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
                fontFamily: faceOf({ loyaltyRows: rows }, "badge").previewFamily,
                fontSize: hdCqw(a.badgeText),
                fontWeight: 700,
                // Optically center inside the shield's flat region.
                ...(ab.cost
                  ? loyaltyBadgeShapeFor(ab.cost) === "up"
                    ? { paddingTop: hdCqw(a.badgeNudge) }
                    : loyaltyBadgeShapeFor(ab.cost) === "down"
                      ? { paddingBottom: hdCqw(a.badgeNudge) }
                      : {}
                  : {}),
              }}
            >
              {ab.cost ?? ""}
            </span>
          </div>
          {/* The ability's lines, in the column they were broken for — the
              last one short of the loyalty shield when its text would reach
              it (lastRowInsetPct) — centred in the row, with the ink
              headroom an accented first capital needs. */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              flexShrink: 0,
              width: hdCqw(draw.text[i].column),
              paddingTop: hdCqw(draw.text[i].insetTop),
              paddingBottom: hdCqw(draw.text[i].insetBottom),
              ...onTop,
              ...(placeholder ? { opacity: 0.55 } : {}),
            }}
          >
            <RulesLines blocks={rowsLayout.text[i].blocks} metrics={draw.text[i].metrics} overrides={pipOverrides} />
          </div>
        </div>
      ))}
    </div>
  );
}
