"use client";

import { useEffect, useId, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { frameUrl } from "@/lib/frames/frame-url";
import { RotateCw } from "lucide-react";
import { cn, clamp } from "@/lib/utils";
import { isBillingEnabled } from "@/lib/billing/flags";
import { ROSE_STAR_PATH } from "@/lib/brand/geometry";
import {
  ManaCostGlyphs,
  PipOverrideImg,
} from "@/components/cards/mana-cost-glyphs";
import {
  pipOverrideForSuffix,
  type PipOverrides,
} from "@/lib/pips/override";
import { SetSymbol } from "@/components/cards/set-symbol";
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
import {
  layoutSagaRail,
  sagaBadgeWidthPx,
  sagaRailMetrics,
  sagaRailPx,
  type SagaRailLayout,
} from "@/lib/cards/saga-rail";
import {
  NAME_COST_GAP_PCT,
  fitSplitTypeSizePct,
  fitTypeLineBand,
  inlineSymbolPullPct,
  measuredLinePreviewPct,
  secondFaceLineSizes,
} from "@/lib/cards/render-tiers";
import { fitStatSizePct, ptValue, STAT_BADGE_INSET } from "@/lib/cards/stat-fit";
import { fitTitleBand } from "@/lib/cards/title-band";
import { setSymbolSize, setSymbolSource } from "@/lib/cards/set-symbol-size";
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
import type { RulesItem } from "@/lib/cards/rules-text";
import {
  buildTypeLine,
  displayLine,
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
  resolveLoyaltyRows,
  resolveSagaChapters,
} from "@/lib/cards/face-content";
import {
  BRAND_MARK_PILL,
  SAGA_MARKER_POINTS,
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
  type TextSlot,
  type TypeLineSplit,
} from "@/lib/cards/template-layout";
import {
  resolveFrameProfile,
  type FrameProfileOverridesMap,
} from "@/lib/cards/profile-override";
import {
  plateKeyFor,
  resolveFrameOverlays,
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

export function CardPreview(rawProps: CardPreviewProps) {
  // Only pictures lib/media/media-urls.ts accepts (migration 0127): a row
  // written before it could point its art, icon, watermark or pips at any
  // host. The bake drops the same ones (lib/cards/drawable-media.ts).
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
  } = drawableCardMedia(rawProps);
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
        brandMark,
        anatomy: backCard.frameStyle ?? null,
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
    brandMark,
    anatomy: frameStyle ?? null,
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
  layout,
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
}) {
  // The card's colour (plates, watermark tint) and the frame master it
  // paints — the same, but where the profile dresses a colour by type:
  // Alpha's colourless artifact paints the artifact card "a", and a stored
  // pair with the two-colour frame on its pair master (frameMasterKey, the
  // bake's twin).
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
  };
  const plateKey = plateKeyFor(colorKey, resolveTwoColor(layout, anatomy, anatomyFacts));
  const overlays = resolveFrameOverlays(layout, anatomy, { ...anatomyFacts, colorKey });
  // A two-colour Dragon Wing card draws BOTH colours' frames split down the
  // seam (FrameProfile.twoColorSplit); the plates keep colorKey ("m").
  const frameSplit = frameSplitFor(layout, colorIdentity);
  const safeTitle = face.title?.trim() || "Untitled Card";
  const markLayout = brandMarkLayout(layout);
  // A textless frame (TODO 3.24) prints no type line and no text box.
  const textless = Boolean(layout.textless);
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
  const drawnStats: DrawnStats = useMemo(
    () => ({
      pt: showPT,
      loyalty: showLoyalty,
      defense: showDefense,
      secondFacePt: Boolean(layout.secondFace?.pt && secondFacePtShown),
    }),
    [showPT, showLoyalty, showDefense, layout.secondFace?.pt, secondFacePtShown],
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
  // Saga chapter rail content — same structured-first resolution — and its
  // text laid out in lines at today's size (lib/cards/saga-rail.ts, the
  // bake's twin).
  const sagaRail = useMemo(() => {
    if (!layout.chapters) return null;
    const sagaContent = resolveSagaChapters(face.faceContent, face.rulesText);
    return sagaContent ? layoutSagaRail(layout.chapters, sagaContent.intro, sagaContent.chapters) : null;
  }, [layout.chapters, face.faceContent, face.rulesText]);
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
  const rulesLayout = useMemo(
    () =>
      drawsRulesBox
        ? mainRulesLayout({
            layout,
            rulesText: rulesPlaceholder ? PLACEHOLDER_RULES_TEXT : face.rulesText,
            flavorText: rulesPlaceholder ? PLACEHOLDER_FLAVOR_TEXT : face.flavorText,
            aspect,
            show: drawnStats,
          })
        : null,
    [drawsRulesBox, layout, rulesPlaceholder, face.rulesText, face.flavorText, aspect, drawnStats],
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
          })
        : null,
    [layout, hasAdventure, adventurePlaceholder, adventureText, aspect, drawnStats],
  );
  const hasSecondFace = Boolean(secondFace);
  const secondFaceText = secondFace?.rulesText;
  const secondFaceRules = useMemo(
    () =>
      layout.secondFace && hasSecondFace
        ? secondFaceRulesLayout({ layout, rulesText: secondFaceText, aspect, show: drawnStats })
        : null,
    [layout, hasSecondFace, secondFaceText, aspect, drawnStats],
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
          overlays={overlays.map((overlay) => ({ href: frameOverlayImageUrl(overlay.path), rect: overlay.rect }))}
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
          overlays={overlays.map((overlay) => ({ href: frameOverlayImageUrl(overlay.path), rect: overlay.rect }))}
          landscape={layout.orientation === "landscape"}
          width="100%"
          height="100%"
          style={{ zIndex: 6, pointerEvents: "none" }}
        />
      ) : null}

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
            fontSize={pipFont(layout.costSizePct ?? layout.title.sizePct)}
            overrides={pipOverrides}
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
            fontSize={pipFont(layout.costSizePct ?? layout.title.sizePct)}
            overrides={pipOverrides}
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
          symbol beside it (a symbolRect box still prints, below). A split
          type line prints its two halves in their own boxes. */}
      {textless ? null : layout.type.split && typeSplit ? (
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
          <SetSymbol
            rarity={rarity}
            iconUrl={setIconUrl}
            setCode={setIconCode}
            size={cqw(setSymbol.sizePct)}
            width={cqw(setSymbol.drawnWidthPct)}
            keyline={layout.setSymbolKeyline}
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
      {textless ? null : layout.chapters && sagaRail ? (
        <ChapterRail slot={layout.chapters} rail={sagaRail} pipOverrides={pipOverrides} />
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
          pipOverrides={pipOverrides}
        />
      ) : null}

      {/* Footer — artist credit + brand. */}
      {layout.footer && footerInkResolved ? (
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
            color: footerInkResolved.colorHex,
            ...(footerInkResolved.shadowCss
              ? { textShadow: footerInkResolved.shadowCss }
              : {}),
            letterSpacing: `${layout.footer.letterSpacingEm ?? 0}em`,
            textTransform: layout.footer.uppercase ? "uppercase" : "none",
          }}
        >
          <span style={ELLIPSIS}>
            {slotLine(
              layout.footer.font,
              face.artistCredit?.trim() ? `Art: ${face.artistCredit}` : "Art: Unknown",
            )}
          </span>
          {/* Footer-right: the owner's custom mark, or nothing — mirrors the
              bake (lib/render/card-image.tsx, layout v19). */}
          {footerWatermark ? (
            <span style={{ flexShrink: 0 }}>
              {slotLine(layout.footer.font, footerWatermark)}
            </span>
          ) : null}
        </div>
      ) : null}

      {/* Brand mark — pipglyph.com, bottom-right, mirroring the bake's
          overlay (lib/render/card-image.tsx): placement + short-side scale
          from brandMarkLayout(layout), 2.6% of a portrait card's width,
          display font. Display surfaces always show it (layout v20); only a
          paid download renders without it. */}
      {brandMark ? (
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
            fontFamily: DISPLAY_FONT,
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

// ---------------------------------------------------------------------------
// StatOverlay — P/T, loyalty, or defense. Renders the optional plate PNG or a
// drawn badge behind the value, then the value centered on top.
// ---------------------------------------------------------------------------

function StatOverlay({
  slot,
  value,
  colorKey,
  masterKey,
  orientation,
  foil = null,
}: {
  slot: StatSlot;
  value: string;
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
      ) : slot.badgeColorHex ? (
        <div
          aria-hidden
          className="absolute"
          style={{
            inset: `${STAT_BADGE_INSET.yPct}% ${STAT_BADGE_INSET.xPct}%`,
            background: slot.badgeColorHex,
            borderRadius: "42%",
            boxShadow: "0 0.4cqw 1cqw rgba(0,0,0,0.45)",
          }}
        />
      ) : null}
      {plateFoil(slot.rect, { top: 0, left: 0, width: "100%", height: "100%" })}
      <span
        className="relative"
        style={{
          fontFamily: DISPLAY_FONT,
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
// ChapterRail — the Saga left rail. Each parsed chapter is an equal-height row:
// a Roman-numeral marker badge + the ability text, with dividers between rows.
// ---------------------------------------------------------------------------

function ChapterRail({
  slot,
  rail,
  pipOverrides = null,
}: {
  slot: NonNullable<FrameProfile["chapters"]>;
  /** The rail's text in lines (lib/cards/saga-rail.ts layoutSagaRail). */
  rail: SagaRailLayout;
  pipOverrides?: PipOverrides | null;
}) {
  // The HD bake's anatomy and text metrics (layout v33, the bake's
  // ChapterBake twin): the intro's and the chapters' lines drawn by
  // RulesLines — real pips, reminder italics, U+2212 as a hyphen — at v32's
  // sizes (owner decision 2026-09-28: correctness only; TODO 4.21).
  const px = sagaRailPx(slot, "hd");
  const metrics = sagaRailMetrics(rail, "hd");
  const { chapters } = rail;
  // Nothing leaves the rail (the bake's twin): an intro too tall for it
  // gives way and is clipped at the rail's foot.
  return (
    <div
      style={{
        ...rectStyle(slot.rect),
        zIndex: 20,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {rail.intro ? (
        <div
          style={{
            flexShrink: 1,
            minHeight: 0,
            overflow: "hidden",
            display: "flex",
            padding: `${hdCqw(px.introPadY)} ${hdCqw(px.introPadX)}`,
            borderBottom: `1px solid ${slot.dividerHex}`,
            fontFamily: CARD_FONT,
            color: slot.textColorHex,
          }}
        >
          <RulesLines blocks={rail.intro} metrics={metrics.intro} overrides={pipOverrides} />
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
              padding: `${hdCqw(px.rowPadY)} ${hdCqw(px.rowPadX)}`,
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
                // The width the chapter's lines were broken beside (its
                // numeral + padding, or the minimum), as the bake draws it.
                width: hdCqw(sagaBadgeWidthPx(ch.marker, px)),
                height: hdCqw(px.badgeHeight),
                marginRight: hdCqw(px.badgeGap),
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
                  paddingBottom: hdCqw(px.markerLift),
                  color: slot.markerTextHex,
                  fontFamily: DISPLAY_FONT,
                  fontSize: hdCqw(px.markerText),
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
                display: "flex",
                flexDirection: "column",
                fontFamily: CARD_FONT,
                color: slot.textColorHex,
              }}
            >
              <RulesLines blocks={ch.blocks} metrics={metrics.chapter} overrides={pipOverrides} />
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
  const titleFit = fitTitleBand(
    { title: slot.title, costSizePct: slot.costSizePct },
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
            fontSize={pipFont(slot.costSizePct ?? slot.title.sizePct)}
            overrides={pipOverrides}
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
  pipOverrides = null,
}: {
  slot: NonNullable<FrameProfile["secondFace"]>;
  data: FaceData;
  aspect: number;
  /** The face's rules layout, in its own unturned frame
   *  (lib/cards/rules-box.ts secondFaceRulesLayout). */
  rules: RulesLayout | null;
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
  const lineSizes = secondFaceLineSizes({
    slot,
    name,
    typeLine,
    cost: showCost ? data.cost : null,
    orientation: orientationFromAspect(aspect),
  });
  // A `fitLines` face's shrunk lines at the stored HD bake's whole px, as the
  // bake sets them (measuredLinePx); a face without it as before.
  const linePct = (fitted: number, base: number) =>
    slot.fitLines ? measuredLinePreviewPct(fitted, base, orientationFromAspect(aspect)) : fitted;
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
          gap: cqw(NAME_COST_GAP_PCT),
          fontFamily: DISPLAY_FONT,
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
            fontSize={pipFont(lineSizes.costSizePct)}
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
          fontSize: cqw(linePct(lineSizes.typeSizePct, slot.type.sizePct)),
          fontWeight: slot.type.weight ?? 600,
          color: slot.type.colorHex,
        }}
      >
        <span style={ELLIPSIS}>{displayLine(lineSizes.typeText)}</span>
      </div>
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
          {ptValue(data.power, data.toughness)}
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
// (wordWidthPx — the width Satori gives it), pips centred. U+2212 draws as
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
// metrics.pipPx (mana-font draws its disc at 1.3 em of the font size, hence
// the division).
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
        fontSize={hdCqw(m.pipPx / MS_COST_DISC_EM, orientation)}
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

// One inline pip of a rules line: the layout's disc (mana-font draws it at
// 1.3 em of the pip's font size), a hairline after an adjacent pip. The pip
// sits in a wrapper that carries that gap as PADDING and has no margin of its
// own: mana-font styles `.ms-2 { margin-left: inherit !important }`, so a
// {2} disc whose parent was a run with a word gap took that gap again and
// pushed the rest of its line a word gap right of the bake (layout v33
// review: "equip cost {2} destroy" drew 11 HD px apart). The bake has no
// such rule.
function RulesPip({
  suffix,
  fontSize,
  gapBefore,
  overrides,
}: {
  suffix: string;
  fontSize: string;
  gapBefore: string | null;
  overrides: PipOverrides | null;
}) {
  const overrideSrc = pipOverrideForSuffix(suffix, overrides);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", flexShrink: 0, ...(gapBefore ? { paddingLeft: gapBefore } : {}) }}>
      {overrideSrc ? (
        <PipOverrideImg src={overrideSrc} style={{ fontSize, flexShrink: 0 }} />
      ) : (
        <i aria-hidden className={cn("ms ms-cost ms-shadow", `ms-${suffix}`)} style={{ fontSize, flexShrink: 0 }} />
      )}
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

// One drawn line: a nowrap row of runs, the line box tall, runs centred on it
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
  // mana-font draws its disc at 1.3 em of the pip's font size.
  const pipFontSize = hd(d.pipPx / MS_COST_DISC_EM);
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
            ...(ri > 0 ? { marginLeft: hd(d.wordGapPx) } : {}),
          }}
        >
          {run.map((item, i) => {
            if (item.t === "m") {
              return (
                <RulesPip
                  key={i}
                  suffix={item.suffix}
                  fontSize={pipFontSize}
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
                fontFamily: DISPLAY_FONT,
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
