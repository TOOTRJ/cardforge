// Server-side card renderer. Satori + sharp through lib/render/satori-png.ts
// (next/og's ImageResponse pipeline without its render-time Google Fonts /
// Twemoji fetches) so the same card produces a PNG you can:
//   * serve as <meta og:image="..."> on public card pages, and
//   * upload to the card-renders bucket on save / download.
//
// This mirrors the live preview (components/cards/card-preview.tsx) exactly:
// both read the per-frame layout profile (lib/cards/template-layout.ts) and
// position every region at the same card-relative percent coordinates. The
// preview scales fonts with `cqw` container units; here we scale them by the
// card's known pixel width — same fractions, identical result.
//
// Satori has limited CSS support: no Tailwind, no container queries, no
// animations. Every style is inline + hex-coded, every multi-child element
// declares `display: flex`.

import { pngImageResponse } from "@/lib/render/satori-png";
import type { SatoriNode } from "satori";
import { cardCornerRadiusPx, type CardCornerFills } from "@/lib/cards/card-corner";
import { squareCornerFills } from "@/lib/frames/square-corners";
import type { CardCorners } from "@/lib/cards/output-corners";
import { foilMaskSource, imageNaturalSize, resolveRenderableImage } from "@/lib/render/art-source";
import {
  COST_PIP_GAP,
  NAME_COST_GAP_PCT,
  fitSplitTypeSizePct,
  fitTypeLineBand,
  inlineSymbolPullPct,
  measuredLinePx,
  secondFaceLineSizes,
} from "@/lib/cards/render-tiers";
import { fitStatSizePct, ptValue, STAT_BADGE_INSET } from "@/lib/cards/stat-fit";
import { orientationFromAspect, type CardOrientation } from "@/lib/cards/typography";
import {
  adventureRulesLayout,
  hasRulesLines,
  mainRulesLayout,
  rulesDraw,
  rulesWordText,
  secondFaceRulesLayout,
  type RulesDraw,
} from "@/lib/cards/rules-box";
import { drawsRulesBackdrop } from "@/lib/cards/rules-backdrop";
import { tokenize, tokenSuffix } from "@/components/cards/mana-cost-glyphs";
import { ROSE_STAR_PATH, SET_MARK_GEM_PATH, SET_MARK_RING, SET_MARK_STAR_PATH } from "@/lib/brand/geometry";
import { RARITY_INK, RARITY_SET_MARK } from "@/lib/brand/constants";
import {
  pipOverrideForSuffix,
  pipOverrideForToken,
  type PipOverrides,
} from "@/lib/pips/override";
import {
  hybridHalves,
  inlineManaTintKey,
  type RulesItem,
} from "@/lib/cards/rules-text";
import {
  FRAME_SPLIT_OVERLAP_PX,
  frameColorKeysFor,
  frameMasterKey,
  frameSplitFor,
  pickFrameColorKey,
} from "@/components/cards/frame-layer";
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
  basicLandManaKey,
  resolveWatermark,
  watermarkHeightFraction,
  watermarkInk,
  watermarkOpacity,
} from "@/lib/cards/watermark";
import { getWatermarkDataUrl } from "@/lib/render/card-frames";
import {
  BASIC_SYMBOL_DISC_FILL,
  BASIC_SYMBOL_GLYPH_SCALE,
  BASIC_SYMBOL_HALO,
  BASIC_SYMBOL_INK,
  basicSymbolAssetPath,
  basicSymbolAssetPaths,
  basicSymbolBox,
  basicSymbolFor,
  basicSymbolGlyphSizePct,
  type BasicSymbolPlan,
} from "@/lib/cards/basic-symbol";
import {
  DISPLAY_FONT_BYTES,
  KEYRUNE_DEFAULT_GLYPH,
  KEYRUNE_FONT_BYTES,
  MANA_FONT_BYTES,
  MPLANTIN_FONT_BYTES,
  MPLANTIN_ITALIC_FONT_BYTES,
  getKeyruneCodepoint,
  getManaCodepoint,
} from "@/lib/render/card-fonts";
import { displayRunPx } from "@/lib/render/satori-text";
import {
  setSymbolDrawnPx,
  setSymbolSize,
  setSymbolSource,
} from "@/lib/cards/set-symbol-size";
import {
  getFrameAssetDataUrl,
  getFrameDataUrl,
  getFrameOverlayDataUrl,
  getPlateDataUrlForPath,
  plateAssetPath,
  preloadFrame,
  preloadFrameAssets,
} from "@/lib/render/card-frames";
import {
  plateKeyFor,
  resolveFrameOverlays,
  resolveTwoColor,
} from "@/lib/cards/anatomy";
import {
  BRAND_MARK_PILL,
  bandTextStyle,
  brandMarkLayout,
  footerInk,
  textShadowCopies,
  loyaltyBadgeAssetFor,
  SAGA_MARKER_POINTS,
  loyaltyBadgeShapeFor,
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
import { resolveFrameProfile } from "@/lib/cards/profile-override";
import { EtchedSheen } from "@/lib/cards/etched-finish";
import {
  FoilBackdropSheen,
  FoilSheen,
  FoilStripeSheen,
  artWindowPlacement,
  foilArtLayers,
  loyaltyStripeRects,
  type FoilArtSource,
} from "@/lib/cards/foil-finish";
import {
  layoutProfileLoyaltyRows,
  loyaltyRowsDrawing,
  type LoyaltyRowsLayout,
} from "@/lib/cards/loyalty-rows";
import {
  rulesTargetFor,
  type RulesBlock,
  type RulesLayout,
  type RulesMetrics,
  type RulesTarget,
} from "@/lib/cards/rules-layout";
import {
  layoutSagaRail,
  sagaBadgeWidthPx,
  sagaRailMetrics,
  sagaRailPx,
  type SagaRailLayout,
} from "@/lib/cards/saga-rail";
import { fitTitleBand } from "@/lib/cards/title-band";
import type { CardPreviewData } from "@/components/cards/card-preview";
import type { CardBackFace, ColorIdentity, Rarity } from "@/types/card";
import { clamp } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Sizing presets — 5:7 card aspect ratio, matching the live preview.
// "default" suits OG/social previews; "hd" is the user-facing download.
// ---------------------------------------------------------------------------

export const RENDER_PRESETS = {
  default: { width: 750, height: 1050 },
  hd: { width: 1500, height: 2100 },
} as const;

export type RenderPreset = keyof typeof RENDER_PRESETS;

/**
 * The output's corner (TODO 3.26, one radius — lib/cards/card-corner.ts;
 * the choice — lib/cards/output-corners.ts):
 *
 *   "round"  — renderCardImage's default, and every DISPLAY bake: the card's
 *              rounded corner is cut into the PNG's alpha at
 *              cardCornerRadiusPx (64.5 px at HD in both orientations), RGB
 *              kept — the shape the CSS clip draws, so the stored PNG is the
 *              card wherever it is shown unclipped (raw OG, oEmbed, Google
 *              Images, the download).
 *   "square" — print (the PDF card and sheets, the deck export) and the
 *              square PNG: the full rectangle, opaque. The same render, cut
 *              round and then squared again (lib/cards/card-corner.ts
 *              squareCardCorners): outside the arc each corner shows its
 *              border colour — the border black (#000, owner decision
 *              2026-09-27), or the root's #101015 where the master's edge
 *              band is see-through (the rings) — or, where art or frame
 *              design runs into the corner, what was drawn there
 *              (squareCornerFillsOf, lib/frames/square-corners.ts).
 */
export type { CardCorners };

// Real-card rarity inks for the set symbol — the SAME table the preview's
// components/cards/set-symbol.tsx reads (lib/brand/constants RARITY_INK), so
// a stored PNG and the editor agree on every rarity (uncommon used to be a
// different grey here).
const RARITY_SET_SYMBOL_COLOR: Record<Rarity, string> = RARITY_INK;

// Rules/flavor body text uses MPlantin (the real MTG body face); titles, type
// lines, footer, and stat values use CardDisplay (an OFL Beleren stand-in),
// falling back to MPlantin. A TextSlot's `font` field selects which.
const BODY_FONT = '"MPlantin"';
const DISPLAY_FONT = '"CardDisplay", "MPlantin"';

function fontFamilyFor(font: TextSlot["font"]): string {
  return font === "display" ? DISPLAY_FONT : BODY_FONT;
}

// ---------------------------------------------------------------------------
// Geometry helpers — shared shape with the live preview's rectStyle(), but
// font sizes resolve to px against the known card width.
// ---------------------------------------------------------------------------

/** The facts one card's anatomy depends on (lib/cards/anatomy.ts) — the
 *  preview's face fields. */
function anatomyFactsOf(card: CardPreviewData) {
  return {
    colors: card.colorIdentity as ColorIdentity[] | undefined,
    cost: card.cost,
    cardType: card.cardType,
    supertype: card.supertype,
  };
}

/** The overlays a finish masks with: the ones the card actually drew. */
function drawnOverlays(overlays: readonly { href: string | null; rect: Rect }[]): { href: string; rect: Rect }[] {
  return overlays.flatMap((overlay) => (overlay.href ? [{ href: overlay.href, rect: overlay.rect }] : []));
}

function slotBox(rect: Rect) {
  return {
    position: "absolute" as const,
    top: `${rect.topPct}%`,
    left: `${rect.leftPct}%`,
    width: `${rect.widthPct}%`,
    height: `${rect.heightPct}%`,
  };
}

function fpx(sizePct: number, cardWidth: number): number {
  return Math.round(sizePct * cardWidth);
}

/** TextSlot.dy (TODO 4.20): the slot's text span — never its band, pips or
 *  set symbol — moved vertically by the whole px nearest dy × width
 *  (negative = up), as CostGlyphs moves the pips by costDy; a measured line
 *  the fit shrank to `drawnSizePct` (its whole-px size) also keeps its
 *  baseline (slotTextDy). Front-face title and type line only; the
 *  preview's textDy twin translates by the same dy in cqw. */
function textDyBake(slot: TextSlot, cardWidth: number, drawnSizePct = slot.sizePct): { transform?: string } {
  const dyPct = slotTextDy(slot, drawnSizePct);
  const dy = dyPct ? fpx(dyPct, cardWidth) : 0;
  return dy ? { transform: `translate(0px, ${dy}px)` } : {};
}

/** A stat value's font size in px (TODO 3.18): the profile size, rounded as
 *  every slot is, when the value fits its face; otherwise the preview's
 *  fitStatSizePct() rounded DOWN — rounding up could push its ink past the
 *  face again. */
function statPx(
  slot: StatSlot,
  value: string,
  orientation: CardOrientation,
  cardWidth: number,
  upsideDown = false,
): number {
  const fitted = fitStatSizePct(slot, value, orientation, upsideDown);
  return fitted < slot.sizePct ? Math.floor(fitted * cardWidth) : fpx(slot.sizePct, cardWidth);
}

function vJustify(align: SlotAlign | undefined): string {
  return align === "center"
    ? "center"
    : align === "end"
      ? "flex-end"
      : "flex-start";
}


// MPlantin (the bake's body font) has no U+2212 MINUS SIGN glyph and Satori has
// no font fallback, so a raw "−2:" loyalty ability would lose its sign. Map it
// to a hyphen-minus, which the font does have. (The em-dash in type lines is
// fine — MPlantin includes it.)
function bakeText(text: string): string {
  return text.replace(/−/g, "-");
}

/** One half of a two-colour split frame: the full-card PNG shifted inside an
 *  overflow:hidden box spanning columns [x0, x1). Whole-pixel box edges, so
 *  Satori cuts the seam hard — the bake's form of FrameLayer's clip-path. */
function FrameSlice({
  src,
  x0,
  x1,
  width,
  height,
}: {
  src: string;
  x0: number;
  x1: number;
  width: number;
  height: number;
}) {
  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: x0,
        width: x1 - x0,
        height,
        overflow: "hidden",
        display: "flex",
        zIndex: 5,
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        style={{
          position: "absolute",
          top: 0,
          left: -x0,
          width,
          height,
          objectFit: "fill",
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card JSX
// ---------------------------------------------------------------------------

function CardImage({
  card,
  width,
  height,
  brandMark,
  watermarkText,
  foilArt,
  secondArtSize,
  omitArt = false,
}: {
  card: CardPreviewData;
  width: number;
  height: number;
  /** The free-tier pipglyph.com BRAND mark (billing-gated) — distinct from
   *  card.watermark, the user's design watermark behind the rules text. */
  brandMark: boolean;
  /** The owner's custom footer mark (paid perk). Prints in the footer-right
   *  slot where the hardcoded "PipGlyph" used to sit; null = blank. */
  watermarkText: string | null;
  /** Foil only: the art copies the foil's luminance mask redraws (see
   *  foilMaskSource) — resolved up front because they need sharp (async). */
  foilArt?: { art: FoilArtSource | null; secondArt: FoilArtSource | null };
  /** A rotated second art window's picture size (imageNaturalSize) — the
   *  bake places that art in px (RotatedArtBake). */
  secondArtSize?: { width: number; height: number } | null;
  /** A PRINT layer (lib/render/card-print.ts, TODO 6.10): the card's art
   *  (its window and the under-frame copy) is left out and the root is
   *  see-through; each empty art box carries printArtMarker's data-* props
   *  so the print path can composite the full-resolution art under this
   *  layer with the same fit. Off for every stored/display render. */
  omitArt?: boolean;
  /** NEVER rendered — Satori's image preload list (see renderCardImage). */
  children?: React.ReactNode;
}) {
  const template = normalizeFrameTemplate(card.frameStyle?.template);
  const layout = resolveFrameProfile(template, card.profileOverrides);
  const markLayout = brandMarkLayout(layout);
  // A textless frame (TODO 3.24) prints no type line and no text box — but
  // the full-art token's textless height keeps its type line (4.48,
  // FrameProfile.textlessTypeLine).
  const textless = Boolean(layout.textless);
  const hidesTypeLine = textless && !layout.textlessTypeLine;
  const finish = card.frameStyle?.finish ?? "regular";
  const isFoil = finish === "foil";
  const isEtched = finish === "etched";
  const isShowcase = finish === "showcase";

  // The card's colour (plates, watermark tint) and the frame master it
  // paints — the same, but where the profile dresses a colour by type:
  // Alpha's colourless artifact paints the artifact card "a" (frameMasterKey,
  // the preview's twin).
  const colorKey = pickFrameColorKey(
    card.colorIdentity as ColorIdentity[] | undefined,
  );
  const masterKey = frameMasterKey(
    layout,
    card.colorIdentity as ColorIdentity[] | undefined,
    card,
    card.frameStyle,
  );
  // The two-colour look's stat plate and the anatomy overlays (the crown
  // band) — the preview's twins (lib/cards/anatomy.ts). Nothing until a
  // profile declares pair masters / an overlay and the card's switch is on.
  const plateKey = plateKeyFor(colorKey, resolveTwoColor(layout, card.frameStyle, anatomyFactsOf(card)));
  const overlays = resolveFrameOverlays(layout, card.frameStyle, { ...anatomyFactsOf(card), colorKey }).map(
    (overlay) => ({ ...overlay, href: getFrameOverlayDataUrl(overlay.path) }),
  );
  // A two-colour Dragon Wing card draws BOTH colours' frames split down the
  // seam (FrameProfile.twoColorSplit); the plates keep colorKey ("m").
  const frameSplit = frameSplitFor(
    layout,
    card.colorIdentity as ColorIdentity[] | undefined,
  );
  const frameDataUrl = getFrameDataUrl(template, frameSplit?.leftKey ?? masterKey);
  const splitDataUrl = frameSplit ? getFrameDataUrl(template, frameSplit.rightKey) : null;
  // Whole pixels: the seam is a hard edge in both renderers.
  const splitX = frameSplit ? Math.round((width * frameSplit.atPct) / 100) : 0;
  // Per-frame-master footer ink — the same footerInk() the preview resolves
  // (outlined when the profile prints it on the art, footerOnArt).
  const footerInkResolved = layout.footer ? footerInk(layout.footer, masterKey, layout) : null;
  // …and the name's and type line's (the text spans only, not the pips or
  // the set symbol) — the preview's bandTextStyle() twins.
  const titleInk = bandTextStyle(layout.title, masterKey);
  const typeInk = bandTextStyle(layout.type, masterKey);

  // No bake-only truncation: titles up to the validated 120 chars ellipsize
  // in the band exactly as the preview does.
  const title = card.title?.trim() || "Untitled Card";
  const showCost =
    !layout.hideCost && card.cardType !== "land" && Boolean(card.cost?.trim());
  const typeLine = buildTypeLine(card);
  // A two-box type line (TextSlot.split, TODO 3.24): split at the em dash,
  // one size for both halves — the preview's twin.
  const typeSplit = layout.type.split ? splitTypeLine(typeLine) : null;
  const orientation: CardOrientation = layout.orientation === "landscape" ? "landscape" : "portrait";
  // The set symbol's size and drawn width (lib/cards/set-symbol-size.ts) —
  // the preview's twin: the same box, glyph fit and width in both renderers.
  const setSymbol = setSymbolSize(layout, setSymbolSource(card.setIconUrl, card.setIconCode));
  // The preview's twin: the old estimate, or (a measured slot, the M15-era
  // family) the room before the set symbol's ink as drawn — its size, its
  // text (cut with a "…" only past the floor) and its width. A measured
  // line that shrank is set at measuredLinePx, the whole pixel BELOW its
  // fitted size (never below the floor's), like the name.
  const typeFit =
    layout.type.split && typeSplit
      ? null
      : fitTypeLineBand({
          layout,
          text: typeLine,
          symbolWidthPct: setSymbol.drawnWidthPct,
          symbolInkLeftPct: setSymbol.inkLeftPct,
          orientation,
        });
  const typeFitPct =
    layout.type.split && typeSplit
      ? fitSplitTypeSizePct({
          left: typeSplit[0],
          right: typeSplit[1],
          leftRect: layout.type.split.leftRect,
          rightRect: layout.type.split.rightRect,
          baseSizePct: layout.type.sizePct,
        })
      : (typeFit?.sizePct ?? layout.type.sizePct);
  const typeMeasured = layout.type.fit === "measured";
  const typeSlot: TextSlot = {
    ...layout.type,
    sizePct:
      typeMeasured && typeFitPct < layout.type.sizePct
        ? measuredLinePx(typeFitPct, layout.type.sizePct, width, orientation) / width
        : typeFitPct,
  };
  const typeText = typeFit ? typeFit.text : typeLine;
  // A measured band's inline set symbol is pulled left over the band gap (it
  // stays where it was): the line's room ends a print's gap before its ink
  // (inlineSymbolPullPct) — the preview's twin. It never shrinks.
  const symbolPull = inlineSymbolPullPct(layout, setSymbol);
  const inlineSymbolWrap = typeMeasured
    ? { flexShrink: 0, ...(symbolPull ? { marginLeft: -Math.round(symbolPull * width) } : {}) }
    : undefined;
  // Room a centred title / type line may fill before it ellipsizes: the band
  // less the set symbol + gap beside it (see alignedText; a cost in the
  // title band is never centred, so 0 = don't judge).
  const titleRoom =
    showCost && card.cost && !layout.costRect ? 0 : bandWidth(layout.title, width);
  const typeRoom = !isAligned(typeSlot)
    ? 0
    : bandWidth(typeSlot, width) -
      (layout.symbolRect ? 0 : fpx(0.02, width) + setSymbolDrawnPx(setSymbol, width));

  // Same gating as the preview (shared helpers) — and only when the frame
  // actually defines a slot for that stat.
  const showPT = Boolean(layout.pt) && printsPowerToughness(card);
  const showLoyalty =
    Boolean(layout.loyalty) &&
    showsLoyalty(card.cardType) &&
    Boolean(card.loyalty);
  const showDefense =
    Boolean(layout.defense) &&
    showsDefense(card.cardType) &&
    Boolean(card.defense);

  const focalX = clamp(card.artPosition?.focalX ?? 0.5, 0, 1) * 100;
  const focalY = clamp(card.artPosition?.focalY ?? 0.5, 0, 1) * 100;
  const scale = clamp(card.artPosition?.scale ?? 1, 0.5, 4);

  const aspect = layout.orientation === "landscape" ? 5 / 7 : 7 / 5;
  // The rules layout's target this bake draws (layout v33): the HD bake, or
  // the 750 px one (OG images, live free downloads) at exactly half its px —
  // the lines are the same at both; each draws its own whole px.
  const rulesTarget = rulesTargetFor(width, orientation);
  // The stat badges the card draws — the rules boxes keep their lines out of
  // them (lib/cards/rules-box.ts), the preview's twin.
  const drawnStats = {
    pt: showPT,
    loyalty: showLoyalty,
    defense: showDefense,
    secondFacePt: Boolean(layout.secondFace?.pt && card.backFace && (card.backFace.power || card.backFace.toughness)),
  };
  // Planeswalker ability rows when the frame defines them and the card is a
  // planeswalker; a walker with no abilities draws the plain box (below).
  const usesLoyaltyRows =
    Boolean(layout.loyaltyRows) && showsLoyalty(card.cardType) && !textless;
  // Planeswalker ability rows (badged loyalty costs, striped rows) when the
  // frame defines them and the card actually is a planeswalker. Structured
  // rows first, rules_text parsing as the legacy fallback — identical
  // resolution to the live preview (lib/cards/face-content.ts).
  const loyaltyAbilities = usesLoyaltyRows
    ? resolveLoyaltyRows(card.faceContent, card.rulesText)
    : [];
  // Their text size and content-sized row heights, the last row's text short
  // of the loyalty shield when it would reach it — the preview's twin
  // (lib/cards/loyalty-rows.ts).
  const loyaltyLayout = layoutProfileLoyaltyRows(layout, loyaltyAbilities, aspect);
  // Saga chapter rail content — same structured-first resolution — and its
  // text laid out in lines at today's size (lib/cards/saga-rail.ts, the
  // preview's twin).
  const sagaContent = layout.chapters
    ? resolveSagaChapters(card.faceContent, card.rulesText)
    : null;
  const sagaRail =
    layout.chapters && sagaContent
      ? layoutSagaRail(layout.chapters, sagaContent.intro, sagaContent.chapters)
      : null;
  // The name's fit (the preview's twin, lib/cards/title-band.ts): before a
  // detached cost box (costRect) it stops before the pips, shrinking to fit
  // there when it is long; on a measured slot (the M15-era family, layout
  // v32) it shrinks to the room its band leaves it wherever the cost is.
  // A shrunk name is set at the whole pixel BELOW its fitted size: rounding
  // up could push a name that fits back into its ellipsis.
  // A measured name that shrank is set at measuredLinePx (never below the
  // floor's whole pixel) and keeps its baseline (textDyBake).
  const titleFit = fitTitleBand(layout, title, showCost ? card.cost : null, orientation);
  const titleSlot =
    titleFit && titleFit.sizePct < layout.title.sizePct
      ? {
          ...layout.title,
          sizePct:
            layout.title.fit === "measured"
              ? measuredLinePx(titleFit.sizePct, layout.title.sizePct, width, orientation) / width
              : Math.floor(titleFit.sizePct * width) / width,
        }
      : layout.title;
  // Explicit watermark wins; basic lands automatically get the large mana
  // symbol — identical resolution to the live preview.
  const basicLandFace = {
    cardType: card.cardType,
    supertype: card.supertype,
    subtypes: card.subtypes,
    title: card.title,
    rulesText: card.rulesText,
  };
  const effectiveWatermark = resolveWatermark(card.watermark, basicLandFace);
  // A profile with a basic-land symbol slot (TODO 3.24) prints a basic's
  // symbol there instead of the rules-box watermark — the preview's twin
  // (lib/cards/basic-symbol.ts).
  const basicSymbolPlan = basicSymbolFor(layout, basicLandFace, card.watermark);
  // BASIC lands (Basic supertype — see lib/cards/watermark.ts) print NO
  // rules text, just the big symbol. Keyed on the card's identity, not the
  // watermark, so an explicit override icon suppresses the text too
  // (identical to the live preview); nonbasic lands print their text.
  const isBasicLand = basicLandManaKey(basicLandFace) !== null;
  const hasRulesContent =
    !isBasicLand &&
    !textless &&
    hasRulesBoxText(card);
  // The plain rules box's ONE layout (layout v33, lib/cards/rules-box.ts):
  // its size, every line (rules and flavor) and every position, fitted at
  // both bake targets, clear of the drawn stat badges — a walker drawn here
  // (no abilities) keeps out of its loyalty shield — the preview's twin. Not
  // on a textless frame, a basic land, the saga rail or ability rows.
  const drawsRulesBox =
    !textless && !isBasicLand && !layout.chapters && !(layout.loyaltyRows && loyaltyAbilities.length > 0);
  const rulesLayout = drawsRulesBox
    ? mainRulesLayout({ layout, rulesText: card.rulesText, flavorText: card.flavorText, aspect, show: drawnStats })
    : null;
  // The adventure page's and a second face's rules — the same layout.
  const adventureRules =
    layout.adventure && card.backFace
      ? adventureRulesLayout({ layout, rulesText: card.backFace.rules_text, aspect, show: drawnStats })
      : null;
  const secondFaceRules =
    layout.secondFace && card.backFace
      ? secondFaceRulesLayout({ layout, rulesText: card.backFace.rules_text, aspect, show: drawnStats })
      : null;

  // Where the art is painted on this master (artLayersFor — the preview's
  // and the foil mask's rects): the window's slot (a see-through master's
  // own, under art) and the see-through master's under-frame rect.
  const artLayers = artLayersFor(layout, masterKey, Boolean(card.artUrl));
  const underArtRect = artLayers.under;
  const artSlot = artLayers.slot;
  const artW = Math.round((artSlot.widthPct / 100) * width);
  const artH = Math.round((artSlot.heightPct / 100) * height);

  // Split's right-half art (back-face art in the second art window).
  const secondArtSlot = layout.secondFace?.artSlot;
  const secondArtUrl = card.backFace?.art_url;
  const secondArtPos = (card.backFace?.art_position ?? {}) as {
    focalX?: number;
    focalY?: number;
    scale?: number;
  };
  // Foil plates (P/T, loyalty, defense), planeswalker ability stripes and the
  // rules backdrop — printed layers drawn above the full-card sheen — carry
  // their own.
  const plateFoil = isFoil ? { cardHeight: height, landscape: layout.orientation === "landscape" } : null;
  // The rules backdrop's corner radius — its foil sheen rounds the same.
  const backdropRadius = Math.round(width * 0.015);

  const focalX2 = clamp(secondArtPos.focalX ?? 0.5, 0, 1) * 100;
  const focalY2 = clamp(secondArtPos.focalY ?? 0.5, 0, 1) * 100;
  const scale2 = clamp(secondArtPos.scale ?? 1, 0.5, 4);

  return (
    <div
      style={{
        display: "flex",
        width: "100%",
        height: "100%",
        position: "relative",
        background: omitArt ? "transparent" : "#101015",
        fontFamily: BODY_FONT,
        color: layout.title.colorHex,
      }}
    >
      {/* See-through frames: the art also runs under the whole frame
          (TODO 4.17) — same cover fit at the focal point as the preview; not
          when the window's slot is that rect (one picture). */}
      {underArtRect && card.artUrl ? (
        <div
          {...(omitArt ? printArtMarker("under", focalX, focalY, 1) : {})}
          style={{ ...slotBox(underArtRect), display: "flex", overflow: "hidden" }}
        >
          {omitArt ? null : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={card.artUrl}
              width={Math.round((underArtRect.widthPct / 100) * width)}
              height={Math.round((underArtRect.heightPct / 100) * height)}
              alt=""
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                objectPosition: `${focalX}% ${focalY}%`,
              }}
            />
          )}
        </div>
      ) : null}
      {/* Art — below the frame, in the transparent cut-out. */}
      <div
        {...(omitArt && card.artUrl ? printArtMarker("main", focalX, focalY, scale) : {})}
        style={{ ...slotBox(artSlot), display: "flex", overflow: "hidden" }}
      >
        {card.artUrl ? (
          omitArt ? null : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={card.artUrl}
              width={artW}
              height={artH}
              alt=""
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                objectPosition: `${focalX}% ${focalY}%`,
                transform: `scale(${scale})`,
                transformOrigin: `${focalX}% ${focalY}%`,
              }}
            />
          )
        ) : (
          <div
            style={{
              display: "flex",
              width: "100%",
              height: "100%",
              background:
                "radial-gradient(circle at 50% 40%, #2a2a33, #16161c 70%)",
            }}
          />
        )}
      </div>

      {/* Second art — the second face's own window (split's right half,
          aftermath's sideways bottom window). Rotates in place with the face;
          a rotated one is placed in px (RotatedArtBake) — the object-fit box
          below is kept for split, and for art whose size couldn't be read. */}
      {secondArtSlot && secondArtUrl && layout.secondFace!.rotation && secondArtSize ? (
        <RotatedArtBake
          slot={secondArtSlot}
          rotation={layout.secondFace!.rotation}
          src={secondArtUrl}
          natural={secondArtSize}
          focalX={clamp(secondArtPos.focalX ?? 0.5, 0, 1)}
          focalY={clamp(secondArtPos.focalY ?? 0.5, 0, 1)}
          scale={scale2}
          cardWidth={width}
          cardHeight={height}
        />
      ) : secondArtSlot && secondArtUrl ? (
        <div
          style={{
            ...slotBox(secondArtSlot),
            display: "flex",
            overflow: "hidden",
            transform: `rotate(${layout.secondFace!.rotation}deg)`,
            transformOrigin: "center",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={secondArtUrl}
            width={Math.round((secondArtSlot.widthPct / 100) * width)}
            height={Math.round((secondArtSlot.heightPct / 100) * height)}
            alt=""
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              objectPosition: `${focalX2}% ${focalY2}%`,
              transform: `scale(${scale2})`,
              transformOrigin: `${focalX2}% ${focalY2}%`,
            }}
          />
        </div>
      ) : null}

      {/* A basic land's symbol disc (FrameProfile.basicSymbol "disc", TODO
          3.24): after the art, before the frame, so a see-through socket's
          painted ring overlaps its edge (the preview's z-1 twin). */}
      {basicSymbolPlan && basicSymbolPlan.slot.style === "disc"
        ? BasicSymbolDiscBake({ plan: basicSymbolPlan, colorKey, cardWidth: width, cardHeight: height })
        : null}

      {/* Frame PNG — above the art. A two-colour split frame draws its two
          halves as FrameSlice boxes instead (the preview's FrameLayer clips
          the same two images with clip-path) — plain sibling divs, never a
          Fragment. */}
      {splitDataUrl ? (
        <FrameSlice
          src={frameDataUrl}
          x0={0}
          x1={splitX + FRAME_SPLIT_OVERLAP_PX}
          width={width}
          height={height}
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={frameDataUrl}
          alt=""
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            objectFit: "fill",
            zIndex: 5,
          }}
        />
      )}
      {splitDataUrl ? (
        <FrameSlice src={splitDataUrl} x0={splitX} x1={width} width={width} height={height} />
      ) : null}

      {/* Anatomy overlays (the legendary crown band, TODO 4.6.0) — right
          after the frame, before the finishes and every text layer: the
          preview's FrameOverlayLayer twin. Sibling <img>s, never a
          Fragment; none at all when the card draws none. */}
      {overlays.map((overlay) =>
        overlay.href ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={`${overlay.anatomy}-${overlay.key}`}
            src={overlay.href}
            alt=""
            style={{ ...slotBox(overlay.rect), objectFit: "fill", zIndex: 5 }}
          />
        ) : null,
      )}

      {/* Premium finish: etched — a fine cross-hatch + sheen on the FRAME
          only (masked by the frame's own luminance), directly above the
          frame so every text/stat layer stays crisp on top of it. The SAME
          SVG the preview draws (lib/cards/etched-finish.tsx, preview z-6).
          Never wrap bake overlays in a Fragment: Satori lays a Fragment
          out as a zero-width flex item, so %-positioned children collapse
          to x=0 (the old gold "inset border" baked as an 18 px strip down
          the card's left edge). */}
      {isEtched ? (
        <EtchedSheen
          id="etched"
          frameHref={frameDataUrl}
          split={
            frameSplit && splitDataUrl
              ? { href: splitDataUrl, atPct: frameSplit.atPct }
              : null
          }
          overlays={drawnOverlays(overlays)}
          landscape={layout.orientation === "landscape"}
          width={width}
          height={height}
        />
      ) : null}

      {/* Premium finish: foil — a holographic rainbow + glint painted through
          a luminance mask of what the card shows under its text (art layers,
          then the frame), so it is strongest on light areas and absent on
          black. The SAME SVG the preview draws at z-6
          (lib/cards/foil-finish.tsx): above art + frame, below every
          text/stat layer — on a real foil the ink sits on top of the foil.
          (The old overlay here was `inset: 0` + mixBlendMode; Satori drew
          neither, so a foil bake was byte-identical to a regular one.) */}
      {isFoil ? (
        <FoilSheen
          id="foil"
          frameHref={frameDataUrl}
          // Split frames: the right half masks with the right colour's master
          // (already drawn by its FrameSlice), like the etched sheen.
          split={frameSplit && splitDataUrl ? { href: splitDataUrl, atPct: frameSplit.atPct } : null}
          art={foilArtLayers({
            layout,
            colorKey: masterKey,
            art: card.artUrl ? (foilArt?.art ?? null) : null,
            artPosition: card.artPosition,
            secondArt: secondArtSlot && secondArtUrl ? (foilArt?.secondArt ?? null) : null,
            secondArtPosition: secondArtPos,
          })}
          overlays={drawnOverlays(overlays)}
          landscape={layout.orientation === "landscape"}
          width={width}
          height={height}
        />
      ) : null}

      {/* Rules-box backdrop — own layer under the watermark and the title /
          type bands (see the preview's twin comment: z9 under their z20).
          Satori paints in document order, so it comes BEFORE the bands:
          where a rules box overlaps the type bar (Expedition, 60.5 %H) the
          backdrop used to dim the bake's type line and set symbol only.
          WHEN it is drawn is the preview's rule too (drawsRulesBackdrop). */}
      {layout.rules.backdropHex &&
      drawsRulesBackdrop(layout.rules, {
        hasRulesContent,
        textless,
        chapters: Boolean(layout.chapters),
        rowsDrawn: Boolean(layout.loyaltyRows) && loyaltyAbilities.length > 0,
      }) ? (
        <div
          style={{
            ...slotBox(layout.rules.rect),
            // Satori refuses a div with an element child unless it's flex.
            display: "flex",
            zIndex: 9,
            background: layout.rules.backdropHex,
            borderRadius: backdropRadius,
          }}
        >
          {/* Foil: the backdrop's own sheen, masked by its colour — its only
              child, so Satori paints it over the backdrop and under the
              watermark + text. Satori clips an image to its own shape, not
              to its parent's rounded corners, so it rounds its own. */}
          {plateFoil ? (
            <FoilBackdropSheen
              id="foil-backdrop"
              region={layout.rules.rect}
              fill={layout.rules.backdropHex}
              landscape={plateFoil.landscape}
              width={Math.round((layout.rules.rect.widthPct / 100) * width)}
              height={Math.round((layout.rules.rect.heightPct / 100) * height)}
              style={{ width: "100%", height: "100%", borderRadius: backdropRadius }}
            />
          ) : null}
        </div>
      ) : null}

      {/* Title band — name + mana cost. A centred title (tokens) has no
          cost beside it: no filler span either, or the band's gap pushed
          the name half a gap left of the preview's. Nor a measured band
          (layout v32) with no inline cost: the preview never draws one, and
          the name's room runs to the band's end (titleBandRoomPct). */}
      <Band slot={titleSlot} cardWidth={width} italic={isShowcase}>
        <span
          style={{
            ...alignedText(titleSlot, displayLine(titleFit ? titleFit.text : title), fpx(titleSlot.sizePct, width), titleRoom),
            ...titleInk,
            ...textDyBake(layout.title, width, titleSlot.sizePct),
            ...(titleFit ? { maxWidth: Math.round(titleFit.widthPct * width) } : {}),
          }}
        >
          {displayLine(titleFit ? titleFit.text : title)}
        </span>
        {showCost && card.cost && !layout.costRect ? (
          <CostGlyphs
            cost={card.cost}
            fontSize={fpx(layout.costSizePct ?? layout.title.sizePct, width)}
            overrides={card.pipOverrides}
            dy={layout.costDy ? fpx(layout.costDy, width) : 0}
          />
        ) : isAligned(layout.title) || layout.title.fit === "measured" ? null : (
          <span style={{ display: "flex" }} />
        )}
      </Band>
      {/* Independent cost box (profile.costRect) — mirrors the live preview:
          right-aligned, vertically centered, movable apart from the name. */}
      {showCost && card.cost && layout.costRect ? (
        <div
          style={{
            ...slotBox(layout.costRect),
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
          }}
        >
          <CostGlyphs
            cost={card.cost}
            fontSize={fpx(layout.costSizePct ?? layout.title.sizePct, width)}
            overrides={card.pipOverrides}
            dy={layout.costDy ? fpx(layout.costDy, width) : 0}
          />
        </div>
      ) : null}

      {/* Type band — type line + rarity set-symbol. Long type lines shrink
          to fit on one line, same math as the live preview. With a
          symbolRect the symbol gets its own absolute box (mirrors the
          preview) so it can be aligned independently of the type line. */}
      {/* A textless frame (TODO 3.24) prints no type line — nor the set
          symbol beside it (a symbolRect box still prints, below) — unless
          it keeps its type line (textlessTypeLine, the full-art token). A split
          type line (TODO 3.24) prints its two halves in their own boxes. */}
      {hidesTypeLine ? null : layout.type.split && typeSplit ? (
        SplitTypeBake({ slot: typeSlot, split: layout.type.split, parts: typeSplit, ink: typeInk, cardWidth: width })
      ) : (
      <Band slot={typeSlot} cardWidth={width}>
        <span
          style={{
            ...alignedText(typeSlot, displayLine(typeText), fpx(typeSlot.sizePct, width), typeRoom),
            ...typeInk,
            ...textDyBake(layout.type, width, typeSlot.sizePct),
            ...(typeFit?.widthPct != null ? { maxWidth: Math.round(typeFit.widthPct * width) } : {}),
          }}
        >
          {displayLine(typeText)}
        </span>
        {!layout.symbolRect ? (
          <SetSymbolGlyph
            rarity={(card.rarity as Rarity | null) ?? "common"}
            iconUrl={card.setIconUrl}
            setCode={card.setIconCode}
            fontSize={fpx(setSymbol.sizePct, width)}
            keyline={layout.setSymbolKeyline}
            wrap={inlineSymbolWrap}
          />
        ) : isAligned(typeSlot) ? null : (
          <span style={{ display: "flex" }} />
        )}
      </Band>
      )}
      {layout.symbolRect ? (
        <div
          style={{
            ...slotBox(layout.symbolRect),
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
          }}
        >
          <SetSymbolGlyph
            rarity={(card.rarity as Rarity | null) ?? "common"}
            iconUrl={card.setIconUrl}
            setCode={card.setIconCode}
            fontSize={fpx(setSymbol.sizePct, width)}
            keyline={layout.setSymbolKeyline}
          />
        </div>
      ) : null}

      {/* Design watermark — mirrors the preview layer exactly: centered in
          the rules rect, z above the frame / below text, suppressed where a
          rail replaces the box. Satori-safe: flat img / font glyph +
          opacity only. */}
      {effectiveWatermark &&
      !textless &&
      !basicSymbolPlan &&
      !layout.chapters &&
      !(layout.loyaltyRows && loyaltyAbilities.length > 0) ? (
        <div
          style={{
            ...slotBox(layout.rules.rect),
            zIndex: 10,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
            opacity: watermarkOpacity(effectiveWatermark),
          }}
        >
          {effectiveWatermark.kind === "mana" ? (
            <span
              style={{
                fontFamily: '"Mana"',
                fontSize: Math.round(
                  (layout.rules.rect.heightPct / 100) *
                    height *
                    watermarkHeightFraction(effectiveWatermark),
                ),
                color: watermarkInk(colorKey),
                lineHeight: 1,
              }}
            >
              {getManaCodepoint(effectiveWatermark.key) ?? ""}
            </span>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={
                effectiveWatermark.kind === "custom"
                  ? effectiveWatermark.url
                  : getWatermarkDataUrl(effectiveWatermark.key)
              }
              alt=""
              style={{
                height: Math.round(
                  (layout.rules.rect.heightPct / 100) *
                    height *
                    watermarkHeightFraction(effectiveWatermark),
                ),
                // Same 86%-of-the-rules-box width cap as the preview: a wide
                // custom upload shrinks instead of overflowing (then clipping)
                // in the stored PNG.
                maxWidth: Math.round((layout.rules.rect.widthPct / 100) * width * 0.86),
                objectFit: "contain",
              }}
            />
          )}
        </div>
      ) : null}

      {/* A basic land's symbol in its slot (FrameProfile.basicSymbol, TODO
          3.24) — above the frame, in place of the rules-box watermark. */}
      {basicSymbolPlan && basicSymbolPlan.slot.style !== "none"
        ? BasicSymbolBake({
            plan: basicSymbolPlan,
            cardWidth: width,
            cardHeight: height,
          })
        : null}

      {/* Rules — Saga chapter rail or planeswalker ability rows, otherwise the
          normal rules + flavor box. A textless frame prints none of them. */}
      {textless
        ? null
        : layout.chapters
        ? ChapterBake({
            slot: layout.chapters,
            rail: sagaRail!,
            target: rulesTarget,
            pipOverrides: card.pipOverrides,
          })
        : layout.loyaltyRows && loyaltyAbilities.length > 0
          ? LoyaltyRowsBake({
              slot: layout.rules,
              rows: layout.loyaltyRows,
              abilities: loyaltyAbilities,
              rowsLayout: loyaltyLayout,
              target: rulesTarget,
              pipOverrides: card.pipOverrides,
              cardWidth: width,
              foil: plateFoil,
            })
          : hasRulesLines(rulesLayout)
            ? RulesBoxBake({
                layout: rulesLayout,
                target: rulesTarget,
                colorHex: layout.rules.colorHex,
                font: layout.rules.font,
                overrides: card.pipOverrides,
              })
            : null}

      {/* Adventure spell — the left storybook page (Adventure frames). */}
      {layout.adventure && card.backFace
        ? AdventureBake({
            slot: layout.adventure,
            back: card.backFace,
            cardWidth: width,
            pipOverrides: card.pipOverrides,
            rules: adventureRules,
            target: rulesTarget,
          })
        : null}

      {/* Second face — the rotated bottom/right card (flip/split/aftermath). */}
      {layout.secondFace && card.backFace
        ? SecondFaceBake({
            slot: layout.secondFace,
            back: card.backFace,
            cardWidth: width,
            aspect,
            pipOverrides: card.pipOverrides,
            rules: secondFaceRules,
            target: rulesTarget,
          })
        : null}

      {/* Stat overlays — AFTER the text blocks: Satori paints in document
          order, and printed cards draw the P/T plate / starting-loyalty
          shield OVER the text box edge, never under it (mirrors the
          preview's z22). */}
      {showPT && layout.pt
        ? StatBake({
            slot: layout.pt,
            value: ptValue(card.power, card.toughness),
            colorKey: plateKey,
            masterKey,
            cardWidth: width,
            orientation: orientationFromAspect(aspect),
            foil: plateFoil,
          })
        : null}
      {showLoyalty && layout.loyalty
        ? StatBake({
            slot: layout.loyalty,
            value: String(card.loyalty ?? "—"),
            colorKey: plateKey,
            masterKey,
            cardWidth: width,
            orientation: orientationFromAspect(aspect),
            foil: plateFoil,
          })
        : null}
      {showDefense && layout.defense
        ? StatBake({
            slot: layout.defense,
            value: String(card.defense ?? "—"),
            colorKey: plateKey,
            masterKey,
            cardWidth: width,
            orientation: orientationFromAspect(aspect),
            foil: plateFoil,
          })
        : null}

      {/* Footer — artist + brand. A multi-layer outline (ON_ART_OUTLINE on
          a footer printed on the art) is drawn as offset copies under it:
          see FooterBake. */}
      {layout.footer && footerInkResolved
        ? FooterBake({
            slot: layout.footer,
            ink: footerInkResolved,
            artist: card.artistCredit?.trim() ? `Art: ${card.artistCredit}` : "Art: Unknown",
            watermarkText,
            cardWidth: width,
          })
        : null}

      {/* Showcase tints the title italic via the Band `italic` prop above. */}
      {isShowcase ? null : null}

      {/* Free-tier BRAND mark — pipglyph.com, baked into the pixels so it
          can't be stripped client-side. Paid exports pass brandMark=false.
          Never a WotC mark; the MTG-style frame itself is always free. */}
      {brandMark ? (
        <div
          style={{
            position: "absolute",
            // Per-frame placement (thin-border frames centre it in their own
            // border); sized off the short side — preview mirrors both.
            right: `${markLayout.rightPct}%`,
            bottom: `${markLayout.bottomPct}%`,
            zIndex: 40,
            display: "flex",
            alignItems: "center",
            fontFamily: DISPLAY_FONT,
            fontSize: fpx(0.026 * markLayout.scale, width),
            fontWeight: 600,
            letterSpacing: "0.02em",
            color: "rgba(255,255,255,0.82)",
            textShadow: "0 1px 3px rgba(0,0,0,0.8)",
            // On the art (BRAND_MARK_ON_ART): a dark pill behind it — the
            // preview's twin (brandMarkPillStyle).
            ...(markLayout.pill ? brandMarkPillBake(markLayout.scale, width) : {}),
          }}
        >
          <svg
            width={Math.round(fpx(0.03 * markLayout.scale, width))}
            height={Math.round(fpx(0.03 * markLayout.scale, width))}
            viewBox="0 0 32 32"
            style={{ marginRight: Math.round(fpx(0.008 * markLayout.scale, width)) }}
          >
            <path d={ROSE_STAR_PATH} fill="rgba(255,255,255,0.82)" />
          </svg>
          pipglyph.com
        </div>
      ) : null}
    </div>
  );
}

const ELLIPSIS = {
  display: "flex",
  overflow: "hidden",
  whiteSpace: "nowrap" as const,
  textOverflow: "ellipsis" as const,
  minWidth: 0,
};

// ---------------------------------------------------------------------------
// Band — title/type line: left text + optional right glyph, same baseline.
// ---------------------------------------------------------------------------

function Band({
  slot,
  cardWidth,
  italic,
  children,
}: {
  slot: TextSlot;
  cardWidth: number;
  italic?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        ...slotBox(slot.rect),
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
        // The preview's `gap: 2cqw` between name and cost — without it a long
        // title ellipsized ~2% of the card width later in the bake.
        gap: fpx(0.02, cardWidth),
        fontFamily: DISPLAY_FONT,
        fontSize: fpx(slot.sizePct, cardWidth),
        fontWeight: slot.weight ?? 600,
        fontStyle: italic || slot.italic ? "italic" : "normal",
        letterSpacing: slot.letterSpacingEm ? `${slot.letterSpacingEm}em` : 0,
        textTransform: slot.uppercase ? "uppercase" : "none",
        color: slot.colorHex,
        zIndex: 20,
        ...(slot.shadowCss ? { textShadow: slot.shadowCss } : {}),
      }}
    >
      {children}
    </div>
  );
}

/** A band that centres (or end-aligns) its content — the token title and
 *  type line — rather than spreading it from the start. */
function isAligned(slot: TextSlot): boolean {
  return slot.align === "center" || slot.align === "end";
}

function bandWidth(slot: TextSlot, cardWidth: number): number {
  return (slot.rect.widthPct / 100) * cardWidth;
}

// The ELLIPSIS style for a Band's display line. In a centred (or end-aligned)
// band it also carries a negative right margin: Satori sizes the text node
// from each glyph's own advance but draws the displayLine run kerned
// (lib/render/satori-text.ts), so it centred a box wider than the ink and
// set the line left of the preview by half the run's kerning (20 px on an
// HD "Astronomy Tower" token). The margin makes the flex item the drawn
// width, which is what the browser centres. Only while the kerned line fits
// `roomPx` (the band less whatever shares it; 0 = don't judge): past that
// the node shrinks and ellipsizes, and the margin would let it run over the
// band. Start-aligned lines keep the plain style.
function alignedText(
  slot: TextSlot,
  line: string,
  fontPx: number,
  roomPx: number,
): typeof ELLIPSIS & { marginRight?: number } {
  if (!isAligned(slot)) return ELLIPSIS;
  const { box, ink } = displayRunPx(
    slot.uppercase ? line.toUpperCase() : line,
    fontPx,
    (slot.letterSpacingEm ?? 0) * fontPx,
  );
  return ink > roomPx || box === ink ? ELLIPSIS : { ...ELLIPSIS, marginRight: ink - box };
}

/** The footer — artist line + the owner's custom mark (the preview's footer
 *  div twin). Its ink's text shadow is CSS, except a multi-layer zero-blur
 *  outline (ON_ART_OUTLINE on a footer printed on the art, footerOnArt):
 *  Satori merges one feDropShadow per layer and the rasteriser (librsvg)
 *  keeps only the last, so the bake drew a one-sided shadow where the
 *  browser draws a ring (new-frames review 2026-09-26). That outline is
 *  drawn as one copy of the footer per layer, in the shadow's colour and
 *  offset by the layer, UNDER the footer (paint order = DOM order). Each
 *  copy clips its artist line to the unshifted line box, as the browser
 *  clips a text-shadow to the ellipsizing span's box. */
function FooterBake({
  slot,
  ink,
  artist,
  watermarkText,
  cardWidth,
}: {
  slot: TextSlot;
  ink: { colorHex: string; shadowCss?: string };
  artist: string;
  watermarkText: string | null | undefined;
  cardWidth: number;
}) {
  const fontPx = fpx(slot.sizePct, cardWidth);
  const copies = ink.shadowCss ? textShadowCopies(ink.shadowCss, fontPx) : null;
  const line = slotLine(slot.font, artist);
  const mark = watermarkText ? slotLine(slot.font, watermarkText) : null;
  const box = (color: string, textShadow?: string) => ({
    ...slotBox(slot.rect),
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    fontFamily: fontFamilyFor(slot.font),
    fontSize: fontPx,
    color,
    ...(textShadow ? { textShadow } : {}),
    letterSpacing: slot.letterSpacingEm ? `${slot.letterSpacingEm}em` : 0,
    textTransform: slot.uppercase ? ("uppercase" as const) : ("none" as const),
    zIndex: 20,
  });
  const footer = (
    <div style={box(ink.colorHex, copies ? undefined : ink.shadowCss)}>
      <span style={ELLIPSIS}>{line}</span>
      {/* Footer-right: the owner's custom mark, or nothing. (The old
          hardcoded "PipGlyph" doubled up with the brand-mark overlay —
          layout v19 removed it.) */}
      {mark ? <span style={{ display: "flex", flexShrink: 0 }}>{mark}</span> : null}
    </div>
  );
  if (!copies) return footer;
  // One wrapper (never a Fragment: Satori lays one out as a zero-width flex
  // item) the size of the card, so the copies and the footer keep their
  // card-percent boxes.
  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: "100%", height: "100%", display: "flex", zIndex: 20 }}>
      {copies.map((copy, i) => (
        <div key={i} style={box(copy.color)}>
          <span style={ELLIPSIS}>
            <span style={{ ...ELLIPSIS, position: "relative", left: copy.dx, top: copy.dy }}>{line}</span>
          </span>
          {mark ? (
            <span style={{ display: "flex", flexShrink: 0, position: "relative", left: copy.dx, top: copy.dy }}>
              {mark}
            </span>
          ) : null}
        </div>
      ))}
      {footer}
    </div>
  );
}

/** The brand mark's pill on the art (BRAND_MARK_PILL, TODO 3.23) in px —
 *  the preview sets the same fractions in cqw / em. */
function brandMarkPillBake(scale: number, width: number) {
  const fontPx = fpx(0.026 * scale, width);
  const padX = Math.round(BRAND_MARK_PILL.padXPct * scale * width);
  const padY = Math.round(BRAND_MARK_PILL.padYPct * scale * width);
  return {
    background: BRAND_MARK_PILL.fill,
    padding: `${padY}px ${padX}px`,
    borderRadius: Math.round(fontPx * BRAND_MARK_PILL.radiusEm) + padY,
  };
}

/** A split type line (TextSlot.split, TODO 3.24): the two halves in their
 *  own bands at one size — the preview's SplitTypeLine twin. A centred half
 *  centres on its kerned width (alignedText). One wrapper div, never a
 *  Fragment (Satori lays a Fragment out as a zero-width flex item). */
function SplitTypeBake({
  slot,
  split,
  parts,
  ink,
  cardWidth,
}: {
  slot: TextSlot;
  split: TypeLineSplit;
  parts: [string, string];
  ink: { color?: string; textShadow?: string };
  cardWidth: number;
}) {
  const half = (rect: Rect, align: SlotAlign, text: string) => {
    const band: TextSlot = { ...slot, rect, align };
    const line = displayLine(text);
    return (
      <Band slot={band} cardWidth={cardWidth}>
        <span
          style={{
            ...alignedText(band, line, fpx(slot.sizePct, cardWidth), bandWidth(band, cardWidth)),
            ...ink,
            ...textDyBake(slot, cardWidth),
          }}
        >
          {line}
        </span>
      </Band>
    );
  };
  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: "100%", height: "100%", display: "flex", zIndex: 20 }}>
      {half(split.leftRect, split.leftAlign ?? "start", parts[0])}
      {parts[1] ? half(split.rightRect, split.rightAlign ?? "center", parts[1]) : null}
    </div>
  );
}

/** The drawn disc of a "disc" basic-symbol slot, in the frame colour's
 *  fill — drawn before the frame so a see-through socket's ring overlaps its
 *  edge (the preview's BasicSymbolDisc twin). */
function BasicSymbolDiscBake({
  plan,
  colorKey,
  cardWidth,
  cardHeight,
}: {
  plan: BasicSymbolPlan;
  colorKey: string;
  cardWidth: number;
  cardHeight: number;
}) {
  const box = basicSymbolBox(plan.slot.rect, cardHeight / cardWidth);
  const d = Math.round((box.widthPct / 100) * cardWidth);
  return (
    <div
      style={{
        position: "absolute",
        left: Math.round((box.leftPct / 100) * cardWidth),
        top: Math.round((box.topPct / 100) * cardHeight),
        width: d,
        height: d,
        borderRadius: d / 2,
        background: BASIC_SYMBOL_DISC_FILL[colorKey] ?? BASIC_SYMBOL_DISC_FILL.c,
      }}
    />
  );
}

/** A basic land's symbol in its slot (TODO 3.24): the mana glyph in the
 *  printed ink with its halo, the slot's symbol image for that key, or an
 *  explicit preset / custom watermark contained in the box — the preview's
 *  BasicSymbol twin. */
function BasicSymbolBake({
  plan,
  cardWidth,
  cardHeight,
}: {
  plan: BasicSymbolPlan;
  cardWidth: number;
  cardHeight: number;
}) {
  const box = basicSymbolBox(plan.slot.rect, cardHeight / cardWidth);
  const d = Math.round((box.widthPct / 100) * cardWidth);
  const inner = Math.round(d * BASIC_SYMBOL_GLYPH_SCALE);
  const { mark } = plan;
  const assetPath = mark.kind === "mana" ? basicSymbolAssetPath(plan.slot, mark.key) : null;
  const assetUrl = assetPath ? getFrameAssetDataUrl(assetPath) : null;
  const imageSrc =
    mark.kind === "custom" ? mark.url : mark.kind === "preset" ? getWatermarkDataUrl(mark.key) : assetUrl;
  return (
    <div
      style={{
        position: "absolute",
        left: Math.round((box.leftPct / 100) * cardWidth),
        top: Math.round((box.topPct / 100) * cardHeight),
        width: d,
        height: d,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        opacity: plan.opacity,
        zIndex: 10,
      }}
    >
      {imageSrc ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageSrc}
          alt=""
          width={assetUrl ? d : inner}
          height={assetUrl ? d : inner}
          style={{ objectFit: "contain" }}
        />
      ) : mark.kind === "mana" ? (
        <span
          style={{
            fontFamily: '"Mana"',
            fontSize: Math.round(basicSymbolGlyphSizePct(plan.slot.rect, cardHeight / cardWidth) * cardWidth),
            lineHeight: 1,
            color: BASIC_SYMBOL_INK[mark.key] ?? BASIC_SYMBOL_INK.c,
            textShadow: BASIC_SYMBOL_HALO,
          }}
        >
          {getManaCodepoint(mark.key) ?? ""}
        </span>
      ) : null}
    </div>
  );
}

/** A Keyrune set glyph with its profile's keyline (FrameProfile
 *  .setSymbolKeyline; the preview's twin is the glyph's CSS text-shadow). A
 *  multi-layer zero-blur keyline is drawn as one copy of the glyph per
 *  layer, in the layer's colour and offset, UNDER the glyph (paint order =
 *  DOM order) — Satori merges a multi-layer text-shadow into one filter and
 *  librsvg keeps only the last layer (FooterBake, TODO 3.25). The copies are
 *  absolute, so the glyph's box — and the type band's layout and the drawn
 *  width setSymbolDrawnPx reads from lib/cards/keyrune-metrics.ts — is the
 *  plain glyph's. Any other shadow stays CSS. */
function KeylinedKeyruneGlyph({
  glyph,
  fontSize,
  color,
  keyline,
  wrap,
}: {
  glyph: string;
  fontSize: number;
  color: string;
  keyline: string;
  /** SetSymbolGlyph's `wrap`, on the outer element. */
  wrap?: React.CSSProperties;
}) {
  const style = { display: "flex", fontFamily: '"Keyrune"', fontSize, lineHeight: 1, color, ...wrap };
  const copies = textShadowCopies(keyline, fontSize);
  if (!copies) return <span style={{ ...style, textShadow: keyline }}>{glyph}</span>;
  return (
    <span style={{ ...style, position: "relative" }}>
      {copies.map((copy, i) => (
        <span key={i} style={{ display: "flex", position: "absolute", left: copy.dx, top: copy.dy, color: copy.color }}>
          {glyph}
        </span>
      ))}
      <span style={{ display: "flex" }}>{glyph}</span>
    </span>
  );
}

// Mana-pip gem disc colors — the mana-font `.ms-cost` background-colors from
// mana.css. The live preview gets the gem from that CSS; Satori can't, so we
// draw the disc ourselves and put the dark symbol on top (matching real cards).
const MANA_GEM_BG: Record<string, string> = {
  w: "#f0f2c0",
  u: "#b5cde3",
  b: "#aca29a",
  r: "#db8664",
  g: "#93b483",
  c: "#beb9b2",
};
const MANA_SYMBOL_INK = "#150d08";

// ManaGem — one mana pip the way it prints: a colored disc with the dark
// symbol centered on top (mirrors mana-font's `.ms-cost`, where the glyph is
// 0.95em inside a 1.3em disc and `.ms-shadow` is a hard offset shadow).
// `size` is the disc diameter. Hybrid/twobrid pips render the printed split
// disc: a 135° two-color fill with the two half-symbols offset to the top-left
// and bottom-right, exactly like mana-font's `::before`/`::after` halves.
function ManaGem({
  suffix,
  size,
  style,
}: {
  suffix: string;
  size: number;
  style?: Record<string, unknown>;
}) {
  const halves = hybridHalves(suffix);
  const shadow = `${-Math.max(1, Math.round(size * 0.06))}px ${Math.max(1, Math.round(size * 0.07))}px 0 #111`;

  if (halves) {
    const topCp = getManaCodepoint(halves.top);
    const bottomCp = getManaCodepoint(halves.bottom);
    const topBg = MANA_GEM_BG[halves.top] ?? MANA_GEM_BG.c;
    const bottomBg = MANA_GEM_BG[halves.bottom] ?? MANA_GEM_BG.c;
    const half = Math.round(size * 0.42);
    return (
      <span
        style={{
          display: "flex",
          position: "relative",
          width: size,
          height: size,
          borderRadius: size,
          background: `linear-gradient(135deg, ${topBg} 50%, ${bottomBg} 50%)`,
          boxShadow: shadow,
          overflow: "hidden",
          ...style,
        }}
      >
        {topCp ? (
          <span
            style={{
              position: "absolute",
              top: Math.round(size * 0.07),
              left: Math.round(size * 0.1),
              display: "flex",
              fontFamily: '"Mana"',
              fontSize: half,
              lineHeight: 1,
              color: MANA_SYMBOL_INK,
            }}
          >
            {topCp}
          </span>
        ) : null}
        {bottomCp ? (
          <span
            style={{
              position: "absolute",
              top: Math.round(size * 0.5),
              left: Math.round(size * 0.52),
              display: "flex",
              fontFamily: '"Mana"',
              fontSize: half,
              lineHeight: 1,
              color: MANA_SYMBOL_INK,
            }}
          >
            {bottomCp}
          </span>
        ) : null}
      </span>
    );
  }

  const cp = getManaCodepoint(suffix);
  if (!cp) return null;
  const bg = MANA_GEM_BG[inlineManaTintKey(suffix)] ?? MANA_GEM_BG.c;
  return (
    <span
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        borderRadius: size,
        background: bg,
        boxShadow: shadow,
        ...style,
      }}
    >
      <span
        style={{
          display: "flex",
          // mana-font: 0.95em glyph in a 1.3em disc.
          fontFamily: '"Mana"',
          fontSize: Math.round(size * 0.73),
          lineHeight: 1,
          color: MANA_SYMBOL_INK,
        }}
      >
        {cp}
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// CostGlyphs — Satori-side mana-cost renderer (gem discs, like real cards).
// ---------------------------------------------------------------------------

function CostGlyphs({
  cost,
  fontSize,
  overrides,
  dy = 0,
}: {
  cost: string;
  fontSize: number;
  /** Card owner's custom pip icons — see lib/pips/override.ts. */
  overrides?: PipOverrides | null;
  /** Vertical nudge in px (profile.costDy) — the preview's translateY. */
  dy?: number;
}) {
  const tokens = tokenize(cost);
  if (tokens.length === 0) return <span style={{ display: "flex" }} />;

  return (
    <span
      style={{
        display: "flex",
        alignItems: "center",
        ...(dy ? { transform: `translate(0px, ${dy}px)` } : {}),
        // Mirrors the preview's 0.12em pip gap (scales with the disc size
        // instead of a fixed 2px that vanished at HD resolution); a fitted
        // bar measures a cost with the same gap (costRowWidthPct).
        gap: Math.max(1, Math.round(fontSize * COST_PIP_GAP)),
      }}
    >
      {tokens.map((token, i) => {
        if (token.kind === "text") {
          return (
            <span
              key={`t-${i}`}
              style={{
                color: "#a4a4b0",
                fontSize: Math.round(fontSize * 0.6),
                letterSpacing: 1,
                textTransform: "uppercase",
              }}
            >
              {token.value}
            </span>
          );
        }
        const overrideSrc = pipOverrideForToken(token, overrides);
        if (overrideSrc) {
          // Same box + hard shadow as the ManaGem disc it replaces, so
          // custom pips line up exactly with standard ones beside them.
          const shadow = `${-Math.max(1, Math.round(fontSize * 0.06))}px ${Math.max(1, Math.round(fontSize * 0.07))}px 0 #111`;
          return (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              key={`g-${i}`}
              src={overrideSrc}
              alt=""
              width={fontSize}
              height={fontSize}
              style={{
                width: fontSize,
                height: fontSize,
                borderRadius: fontSize,
                objectFit: "cover",
                boxShadow: shadow,
              }}
            />
          );
        }
        const suffix = tokenSuffix(token);
        if (!suffix) return null;
        return <ManaGem key={`g-${i}`} suffix={suffix} size={fontSize} />;
      })}
    </span>
  );
}

// One rules item inside a run — a word or an inline pip. Real cards print
// reminder text full-ink italic (no dimming), so emphasis is italics only.
function RulesItemBake({
  item,
  glyph,
  gapBefore,
  overrides,
}: {
  item: RulesItem;
  glyph: number;
  gapBefore: number;
  overrides?: PipOverrides | null;
}) {
  if (item.t === "m") {
    const overrideSrc = pipOverrideForSuffix(item.suffix, overrides);
    if (overrideSrc) {
      // Same box + hard shadow as the ManaGem disc it replaces.
      const shadow = `${-Math.max(1, Math.round(glyph * 0.06))}px ${Math.max(1, Math.round(glyph * 0.07))}px 0 #111`;
      return (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={overrideSrc}
          alt=""
          width={glyph}
          height={glyph}
          style={{
            width: glyph,
            height: glyph,
            borderRadius: glyph,
            objectFit: "cover",
            boxShadow: shadow,
            ...(gapBefore ? { marginLeft: gapBefore } : {}),
          }}
        />
      );
    }
    return (
      <ManaGem
        suffix={item.suffix}
        size={glyph}
        style={gapBefore ? { marginLeft: gapBefore } : undefined}
      />
    );
  }
  return (
    <span
      style={{
        display: "flex",
        fontStyle: item.em ? "italic" : "normal",
        ...(gapBefore ? { marginLeft: gapBefore } : {}),
      }}
    >
      {bakeText(item.v)}
    </span>
  );
}

// RulesLinesBake — the lines lib/cards/rules-layout.ts broke a text into
// (layout v33), drawn at one target's whole px (metricsFor): the walker
// rows' abilities and the saga rail's text. Satori never wraps them: each
// line is a `nowrap` flex row exactly one line box tall, its runs
// `flexShrink: 0`, a word gap as the marginLeft of every run after the first
// (no container `gap` — Satori does that with negative margins), every word
// its own span (Satori ceils each text node's width, which is how the layout
// measured it) set at the line box's height, pips centred. A paragraph
// starts the fixed gap below the last. The preview's RulesLines draws the
// same lines.
function RulesLinesBake({
  blocks,
  metrics: m,
  overrides,
}: {
  blocks: readonly RulesBlock[];
  metrics: RulesMetrics;
  overrides?: PipOverrides | null;
}) {
  const lineHeight = m.linePx / m.fontPx;
  const rows: React.ReactNode[] = [];
  blocks.forEach((block, bi) => {
    const gap = bi === 0 ? 0 : block.kind === "flavor" ? m.flavorGapNoBarPx : m.paragraphGapPx;
    if (block.kind === "blank") {
      rows.push(
        <div key={`blank-${bi}`} style={{ display: "flex", flexShrink: 0, height: m.blankLinePx, marginTop: gap }} />,
      );
      return;
    }
    block.lines.forEach((line, li) => {
      rows.push(
        <div
          key={`${bi}-${li}`}
          style={{
            display: "flex",
            flexDirection: "row",
            flexWrap: "nowrap",
            alignItems: "center",
            flexShrink: 0,
            height: m.linePx,
            ...(li === 0 && gap ? { marginTop: gap } : {}),
          }}
        >
          {line.runs.map((run, ri) => (
            <div
              key={ri}
              style={{
                display: "flex",
                flexDirection: "row",
                alignItems: "center",
                flexShrink: 0,
                ...(ri > 0 ? { marginLeft: m.wordGapPx } : {}),
              }}
            >
              {run.map((it, i) =>
                it.t === "m" ? (
                  <RulesItemBake
                    key={i}
                    item={it}
                    glyph={m.pipPx}
                    overrides={overrides}
                    gapBefore={i > 0 && run[i - 1].t === "m" ? m.pipGapPx : 0}
                  />
                ) : (
                  <span
                    key={i}
                    style={{
                      display: "flex",
                      flexShrink: 0,
                      whiteSpace: "nowrap",
                      lineHeight,
                      fontStyle: it.em ? "italic" : "normal",
                    }}
                  >
                    {bakeText(it.v)}
                  </span>
                ),
              )}
            </div>
          ))}
        </div>,
      );
    });
  });
  return (
    <div style={{ display: "flex", flexDirection: "column", flexShrink: 0, fontSize: m.fontPx }}>
      {rows}
    </div>
  );
}

// RulesBoxBake — the bake's rules box (layout v33, TODO 3.29): a fitted
// lib/cards/rules-layout.ts layout drawn line by line at one target
// (lib/cards/rules-box.ts rulesDraw) — the preview's RulesBox twin. The
// renderer never wraps: each line is a nowrap flex row exactly its line box
// tall, its runs never shrink, each word is its own text node (Satori
// measures it ceiled to the px, as the layout does) with the line box as its
// line height, word gaps are margins (never a container `gap`, which Satori
// lays out with negative margins), pips are whole-px discs. Rules paragraphs,
// blank lines, and the flavor text with its 1 px bar where the frame prints
// one, all at the layout's fixed gaps. Used for the main box on every
// template, the adventure page and the second faces (turned in place by
// `rotation`, laid out in their own frame). `clip: false` draws past the box
// (the no-clip tests only).
export function RulesBoxBake({
  layout,
  target,
  colorHex,
  font,
  zIndex = 20,
  rotation = 0,
  overrides,
  clip = true,
}: {
  layout: RulesLayout;
  target: RulesTarget;
  colorHex: string;
  font?: TextSlot["font"];
  zIndex?: number;
  rotation?: number;
  overrides?: PipOverrides | null;
  clip?: boolean;
}) {
  const d = rulesDraw(layout, target);
  return (
    <div
      style={{
        ...slotBox(layout.input.rect),
        display: "flex",
        flexDirection: "column",
        alignItems: "stretch",
        justifyContent: vJustify(d.vAlign),
        overflow: clip ? "hidden" : "visible",
        paddingTop: d.pad.top,
        paddingRight: d.pad.right,
        paddingBottom: d.pad.bottom,
        paddingLeft: d.pad.left,
        fontFamily: fontFamilyFor(font),
        fontSize: d.fontPx,
        color: colorHex,
        zIndex,
        ...(rotation ? { transform: `rotate(${rotation}deg)`, transformOrigin: "50% 50%" } : {}),
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flexShrink: 0,
          paddingTop: d.insetTop,
          paddingBottom: d.insetBottom,
        }}
      >
        {d.blocks.flatMap((b, bi) =>
          b.kind === "blank"
            ? [<div key={bi} style={{ display: "flex", flexShrink: 0, height: b.height, marginTop: b.marginTop }} />]
            : [
                // The flavor bar is its own 1 px box, never the block's
                // border: Satori clips a border with its own clip path, so a
                // border past the box (text clipped at the floor) drew on the
                // frame; a box's background stays inside the overflow clip.
                // Same pixels as the border wherever it is in the box.
                ...(b.bar
                  ? [
                      <div
                        key={`bar-${bi}`}
                        style={{
                          display: "flex",
                          flexShrink: 0,
                          height: b.bar.thickness,
                          marginTop: b.bar.above,
                          background: `${colorHex}44`,
                        }}
                      />,
                    ]
                  : []),
                <div
                  key={bi}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    flexShrink: 0,
                    marginTop: b.bar ? b.bar.below : b.marginTop,
                  }}
                >
                  {b.lines.map((runs, li) => (
                    <RulesBoxLineBake key={li} runs={runs} indent={b.indents[li]} d={d} overrides={overrides} />
                  ))}
                </div>,
              ],
        )}
      </div>
    </div>
  );
}

// One drawn line: a nowrap row of runs, `linePx` tall, runs centred on it —
// indented by the layout's whole px when it is a centred single line
// (TextSlot.alignSingleLine), as the preview's RulesBoxLine draws it.
function RulesBoxLineBake({
  runs,
  indent,
  d,
  overrides,
}: {
  runs: RulesItem[][];
  indent: number;
  d: RulesDraw;
  overrides?: PipOverrides | null;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        flexWrap: "nowrap",
        alignItems: "center",
        height: d.linePx,
        flexShrink: 0,
        ...(indent > 0 ? { marginLeft: indent } : {}),
      }}
    >
      {runs.map((run, ri) => (
        <div
          key={ri}
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            flexShrink: 0,
            ...(ri > 0 ? { marginLeft: d.wordGapPx } : {}),
          }}
        >
          {run.map((item, i) => {
            // Adjacent pips ("{G}{G}") keep a hairline inside the run; a
            // word glued to a pip ("{T}:") none.
            const gapBefore = i > 0 && item.t === "m" && run[i - 1].t === "m" ? d.pipGapPx : 0;
            if (item.t === "m") {
              return <RulesItemBake key={i} item={item} glyph={d.pipPx} gapBefore={gapBefore} overrides={overrides} />;
            }
            return (
              <span
                key={i}
                style={{
                  display: "flex",
                  flexShrink: 0,
                  whiteSpace: "nowrap",
                  fontStyle: item.em ? "italic" : "normal",
                  lineHeight: d.lineHeight,
                }}
              >
                {rulesWordText(item.v)}
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// LoyaltyRowsBake — printed-planeswalker ability rows: a loyalty-cost badge in
// the left rail + the ability text, with alternating translucent row shading.
// Static abilities (no leading cost) render unbadged. Mirrors LoyaltyRows in
// the preview; both draw the rows layoutLoyaltyRows sized from their text,
// and each ability's lines as the rules layout broke them (layout v33), at
// this bake's target px (loyaltyRowsDrawing).
function LoyaltyRowsBake({
  slot,
  rows,
  abilities,
  rowsLayout,
  target,
  cardWidth,
  pipOverrides,
  foil = null,
}: {
  slot: TextSlot;
  rows: NonNullable<FrameProfile["loyaltyRows"]>;
  abilities: LoyaltyAbility[];
  rowsLayout: LoyaltyRowsLayout;
  /** The bake's target: its whole px for every row value. */
  target: RulesTarget;
  cardWidth: number;
  pipOverrides?: PipOverrides | null;
  /** Foil finish: each stripe gets its own sheen (FoilStripeSheen) — the
   *  translucent stripes sit above the full-card layer. */
  foil?: { cardHeight: number; landscape: boolean } | null;
}) {
  const draw = loyaltyRowsDrawing(rowsLayout, target);
  const a = draw.row;
  // Whole-pixel row heights from shared edges: Yoga rounds each row's top and
  // height separately, so flex-sized rows could open a 1 px seam. The last
  // row takes whatever the box has left (flex: 1), so the stripes always
  // reach its bottom edge.
  const { edges } = draw;
  const rowHeight = (i: number) => edges[i + 1] - edges[i];
  const last = abilities.length - 1;
  const stripe = (i: number) => (i % 2 === 0 ? rows.stripeAHex : rows.stripeBHex);
  const stripeRects = foil ? loyaltyStripeRects(slot.rect, rowsLayout.rowFractions) : null;
  const radius = Math.round(cardWidth * 0.012);
  // Satori clips an image (the sheen SVG) to its own shape and only to the
  // bounding rectangle of the box's rounded overflow, so the outer rows'
  // sheens round their own outer corners to the box's radius (the browser
  // already clips the preview's).
  const sheenCorners = (i: number) => ({
    ...(i === 0 ? { borderTopLeftRadius: radius, borderTopRightRadius: radius } : {}),
    ...(i === last ? { borderBottomLeftRadius: radius, borderBottomRightRadius: radius } : {}),
  });
  return (
    <div
      style={{
        ...slotBox(slot.rect),
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        fontFamily: fontFamilyFor(slot.font),
        color: slot.colorHex,
        zIndex: 20,
        borderRadius: radius,
      }}
    >
      {abilities.map((ab, i) => (
        <div
          key={i}
          style={{
            display: "flex",
            ...(i === last ? { flex: 1 } : { height: rowHeight(i), flexShrink: 0 }),
            alignItems: "center",
            background: stripe(i),
            paddingTop: a.padY,
            paddingBottom: a.padY,
            paddingLeft: a.padX,
          }}
        >
          {/* Foil: the stripe's sheen — the row's first child, so Satori
              paints it over the stripe and under the badge + text. */}
          {foil && stripeRects ? (
            <FoilStripeSheen
              id={`foil-row-${i}`}
              region={stripeRects[i]}
              fill={stripe(i)}
              landscape={foil.landscape}
              width={Math.round((stripeRects[i].widthPct / 100) * cardWidth)}
              height={rowHeight(i)}
              style={{ width: "100%", height: "100%", ...sheenCorners(i) }}
            />
          ) : null}
          <div
            style={{
              position: "relative",
              display: "flex",
              flexShrink: 0,
              alignItems: "center",
              justifyContent: "center",
              width: a.badgeWidth,
              height: a.badgeHeight,
              // The text column starts where the rail ends: the column the
              // ability's lines were broken for.
              marginRight: a.rail - a.padX - a.badgeWidth,
            }}
          >
            {ab.cost ? (
              // The printed loyalty shield — same MSE asset as the preview.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={getPlateDataUrlForPath(loyaltyBadgeAssetFor(ab.cost), "c") ?? ""}
                width={a.badgeWidth}
                height={a.badgeHeight}
                alt=""
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: "100%",
                  objectFit: "fill",
                }}
              />
            ) : null}
            <span
              style={{
                position: "relative",
                display: "flex",
                color: rows.badgeTextHex,
                fontFamily: DISPLAY_FONT,
                fontSize: a.badgeText,
                fontWeight: 700,
                ...(ab.cost
                  ? loyaltyBadgeShapeFor(ab.cost) === "up"
                    ? { paddingTop: a.badgeNudge }
                    : loyaltyBadgeShapeFor(ab.cost) === "down"
                      ? { paddingBottom: a.badgeNudge }
                      : {}
                  : {}),
              }}
            >
              {ab.cost ? bakeText(ab.cost) : ""}
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
              width: draw.text[i].column,
              paddingTop: draw.text[i].insetTop,
              paddingBottom: draw.text[i].insetBottom,
            }}
          >
            <RulesLinesBake blocks={rowsLayout.text[i].blocks} metrics={draw.text[i].metrics} overrides={pipOverrides} />
          </div>
        </div>
      ))}
    </div>
  );
}

function SetSymbolGlyph({
  rarity,
  fontSize,
  iconUrl,
  setCode,
  keyline,
  wrap,
}: {
  rarity: Rarity;
  fontSize: number;
  iconUrl?: string | null;
  setCode?: string | null;
  /** FrameProfile.setSymbolKeyline — the preview's text-shadow on the glyph. */
  keyline?: string;
  /** Extra style on the symbol's own flex item — a measured type band's
   *  (layout v32): never shrink, and the pull over the band gap
   *  (inlineSymbolPullPct). Unset, the element is exactly as before. */
  wrap?: React.CSSProperties;
}) {
  const color = RARITY_SET_SYMBOL_COLOR[rarity];

  // 1. A set's uploaded icon image — drawn as-is.
  if (iconUrl) {
    return (
      <span style={{ display: "flex", ...wrap }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={iconUrl}
          width={Math.round(fontSize)}
          height={Math.round(fontSize)}
          style={{ objectFit: "contain" }}
          alt=""
        />
      </span>
    );
  }

  // 2. A preset Keyrune set glyph, rarity-tinted — the SAME glyph the
  //    preview's `ss ss-{code}` class shows (codepoint parsed from
  //    keyrune.css), falling back to the generic Keyrune mark for unknown
  //    codes.
  //    A profile's keyline (dark type bars) rings it: KeylinedKeyruneGlyph.
  if (setCode && keyline) {
    return (
      <KeylinedKeyruneGlyph
        glyph={getKeyruneCodepoint(setCode) ?? KEYRUNE_DEFAULT_GLYPH}
        fontSize={fontSize}
        color={color}
        keyline={keyline}
        wrap={wrap}
      />
    );
  }
  if (setCode) {
    return (
      <span
        style={{
          display: "flex",
          fontFamily: '"Keyrune"',
          fontSize,
          lineHeight: 1,
          color,
          ...wrap,
        }}
      >
        {getKeyruneCodepoint(setCode) ?? KEYRUNE_DEFAULT_GLYPH}
      </span>
    );
  }

  // 3. Default — the PipGlyph ringed seal emblem: rose star inside the
  //    logo's ring, rarity ink over a contrast keyline (same lib/brand
  //    constants as the preview's PipGlyphSetMark, so the two can't
  //    drift). Inline SVG so Satori renders it without a font.
  const s = Math.round(fontSize);
  const mark = RARITY_SET_MARK[rarity];
  return (
    <span style={{ display: "flex", ...wrap }}>
      <svg width={s} height={s} viewBox="0 0 32 32">
        <circle
          cx={SET_MARK_RING.cx}
          cy={SET_MARK_RING.cy}
          r={SET_MARK_RING.r}
          stroke={mark.keyline}
          strokeWidth={4.2}
          fill="none"
        />
        <path
          d={SET_MARK_STAR_PATH}
          fill={mark.keyline}
          stroke={mark.keyline}
          strokeWidth={2.4}
          strokeLinejoin="round"
        />
        <circle
          cx={SET_MARK_RING.cx}
          cy={SET_MARK_RING.cy}
          r={SET_MARK_RING.r}
          stroke={mark.ink}
          strokeWidth={2}
          fill="none"
        />
        <path d={SET_MARK_STAR_PATH} fill={mark.ink} />
        <path d={SET_MARK_GEM_PATH} fill={mark.keyline} opacity={0.92} />
      </svg>
    </span>
  );
}

// StatBake — P/T, loyalty, or defense. Returns a JSX element (not a component
// instance) so it slots into the outer flex layout cleanly.
function StatBake({
  slot,
  value,
  colorKey,
  masterKey,
  cardWidth,
  orientation,
  foil = null,
}: {
  slot: StatSlot;
  value: string;
  /** The card's colour key — picks the plate. */
  colorKey: string;
  /** The frame master the value prints on (frameMasterKey) — picks the ink. */
  masterKey: string;
  cardWidth: number;
  /** The card's orientation — the shrink-to-fit floor is a point size. */
  orientation: CardOrientation;
  /** Foil finish: the plate is part of the printed sheet, so it gets the
   *  card's sheen too (the full-card layer sits below the plates). */
  foil?: { cardHeight: number; landscape: boolean } | null;
}) {
  const plateUrl = slot.plateAssetPathTemplate
    ? getPlateDataUrlForPath(slot.plateAssetPathTemplate, colorKey)
    : null;
  // The plate's own foil — the SAME SVG as the preview's StatOverlay draws,
  // on the plate's box, between the plate and its digits.
  const plateFoil = (rect: Rect, style: React.CSSProperties) =>
    foil && plateUrl ? (
      <FoilSheen
        id="foil-plate"
        frameHref={plateUrl}
        region={rect}
        landscape={foil.landscape}
        width={Math.round((rect.widthPct / 100) * cardWidth)}
        height={Math.round((rect.heightPct / 100) * foil.cardHeight)}
        style={style}
      />
    ) : null;
  // A separate plate box (TODO 4.18): plate in plateRect, digits centred in
  // rect — the same split as the preview's StatOverlay.
  if (slot.plateRect && plateUrl) {
    return (
      <div style={{ position: "absolute", left: 0, top: 0, width: "100%", height: "100%", display: "flex", zIndex: 22 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={plateUrl} alt="" style={{ ...slotBox(slot.plateRect), objectFit: "fill" }} />
        {plateFoil(slot.plateRect, slotBox(slot.plateRect))}
        {StatBake({
          slot: { ...slot, plateAssetPathTemplate: undefined, plateRect: undefined },
          value,
          colorKey,
          masterKey,
          cardWidth,
          orientation,
        })}
      </div>
    );
  }
  // Per-frame-master ink (Alpha: silver on every frame but white) — the
  // same slotInk() the preview's StatOverlay resolves.
  const ink = slotInk(slot, masterKey);
  const size = statPx(slot, value, orientation, cardWidth);
  return (
    <div
      style={{
        ...slotBox(slot.rect),
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        // Above the text layers (z20/21): printed cards draw the P/T plate
        // and the starting-loyalty shield OVER the text box edge.
        zIndex: 22,
      }}
    >
      {plateUrl ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={plateUrl}
          alt=""
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            objectFit: "fill",
          }}
        />
      ) : slot.badgeColorHex ? (
        <div
          style={{
            position: "absolute",
            top: `${STAT_BADGE_INSET.yPct}%`,
            left: `${STAT_BADGE_INSET.xPct}%`,
            right: `${STAT_BADGE_INSET.xPct}%`,
            bottom: `${STAT_BADGE_INSET.yPct}%`,
            background: slot.badgeColorHex,
            borderRadius: "42%",
          }}
        />
      ) : null}
      {plateFoil(slot.rect, { top: 0, left: 0, width: "100%", height: "100%" })}
      <span
        style={{
          position: "relative",
          fontFamily: DISPLAY_FONT,
          color: ink.colorHex,
          fontWeight: slot.weight ?? 700,
          fontSize: size,
          // One line, centred, always — like the preview's span: a value wider
          // than its rect (its face may be wider) overflows it evenly. Satori
          // shrank the span to the rect instead, so such a value wrapped after
          // its slash (`X/X+1`) or ran off to the right only (`40/40`).
          whiteSpace: "nowrap",
          flexShrink: 0,
          // Same nudge as the preview's translate(${valueDxEm}em, ${valueDyEm}em);
          // computed in px here since Satori doesn't resolve em in transforms.
          ...(slot.valueDxEm || slot.valueDyEm
            ? {
                transform: `translate(${Math.round(
                  (slot.valueDxEm ?? 0) * size,
                )}px, ${Math.round(
                  (slot.valueDyEm ?? 0) * size,
                )}px)`,
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

// ChapterBake — Satori-side Saga chapter rail (mirrors ChapterRail in the
// preview). An optional italic intro row (the saga's reminder text, printed
// above chapter I on real cards), then equal-height rows of Roman-numeral
// badge + ability text.
function ChapterBake({
  slot,
  rail,
  target,
  pipOverrides,
}: {
  slot: NonNullable<FrameProfile["chapters"]>;
  /** The rail's text in lines (lib/cards/saga-rail.ts layoutSagaRail). */
  rail: SagaRailLayout;
  target: RulesTarget;
  pipOverrides?: PipOverrides | null;
}) {
  // Today's (v32) anatomy at this target, and the text's metrics: the
  // intro's and the chapters' lines drawn by RulesLinesBake (real pips,
  // reminder italics, U+2212 as a hyphen) at v32's sizes (owner decision
  // 2026-09-28: correctness only — TODO 4.21 re-sources the rail).
  const px = sagaRailPx(slot, target);
  const metrics = sagaRailMetrics(rail, target);
  const { chapters } = rail;
  // Nothing leaves the rail: an intro too tall for it (a saga typed with no
  // chapter markers is ALL intro) gives way and is clipped at the rail's
  // foot instead of running over the type line and the border below (layout
  // v33 review). An intro that fits keeps its height, so every other saga
  // bakes as before.
  return (
    <div
      style={{
        ...slotBox(slot.rect),
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        zIndex: 20,
      }}
    >
      {rail.intro ? (
        <div
          style={{
            display: "flex",
            flexShrink: 1,
            minHeight: 0,
            overflow: "hidden",
            padding: `${px.introPadY}px ${px.introPadX}px`,
            borderBottom: `1px solid ${slot.dividerHex}`,
            fontFamily: BODY_FONT,
            color: slot.textColorHex,
          }}
        >
          <RulesLinesBake blocks={rail.intro} metrics={metrics.intro} overrides={pipOverrides} />
        </div>
      ) : null}
      {chapters.map((ch, i) => (
        <div
          key={i}
          style={{
            display: "flex",
            flex: 1,
            alignItems: "center",
            padding: `${px.rowPadY}px ${px.rowPadX}px`,
            overflow: "hidden",
            borderBottom:
              i < chapters.length - 1 ? `1px solid ${slot.dividerHex}` : "none",
          }}
        >
          <div
            style={{
              position: "relative",
              display: "flex",
              flexShrink: 0,
              alignItems: "center",
              justifyContent: "center",
              // The width the chapter's lines were broken beside (its
              // numeral + padding, or the minimum) — v32's content width.
              width: sagaBadgeWidthPx(ch.marker, px),
              height: px.badgeHeight,
              marginRight: px.badgeGap,
            }}
          >
            {/* The printed saga milestone crest — same polygon as preview. */}
            <svg
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              width="100%"
              height="100%"
              style={{ position: "absolute", top: 0, left: 0 }}
            >
              <polygon points={SAGA_MARKER_POINTS} fill={slot.markerFillHex} />
            </svg>
            <span
              style={{
                position: "relative",
                display: "flex",
                paddingBottom: px.markerLift,
                color: slot.markerTextHex,
                fontFamily: DISPLAY_FONT,
                fontSize: px.markerText,
                fontWeight: 700,
              }}
            >
              {ch.marker}
            </span>
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              flex: 1,
              minWidth: 0,
              fontFamily: BODY_FONT,
              color: slot.textColorHex,
            }}
          >
            <RulesLinesBake blocks={ch.blocks} metrics={metrics.chapter} overrides={pipOverrides} />
          </div>
        </div>
      ))}
    </div>
  );
}

// AdventureBake — Satori-side adventure sub-panel (mirrors AdventurePanel in the
// preview). The adventure's name (+ cost) and type line sit on the left page's
// colored bars; its rules sit on the cream page below. Wrapped in an inset:0
// absolute box so the three absolutely-positioned slots resolve against the
// card, exactly like the preview's percent coordinates.
function AdventureBake({
  slot,
  back,
  cardWidth,
  pipOverrides,
  rules,
  target,
}: {
  slot: NonNullable<FrameProfile["adventure"]>;
  back: CardBackFace;
  cardWidth: number;
  pipOverrides?: PipOverrides | null;
  /** The page's rules layout (lib/cards/rules-box.ts adventureRulesLayout). */
  rules: RulesLayout | null;
  target: RulesTarget;
}) {
  const name = back.title?.trim() || "Adventure";
  const typeLine = buildTypeLine({
    supertype: back.supertype,
    cardType: back.card_type ?? null,
    subtypes: back.subtypes,
  });
  const showCost = Boolean(back.cost?.trim());
  // A measured panel (the M15-era family, layout v32) fits its name before
  // its inline cost and its type line to its bar — the preview's twins
  // (AdventurePanel); the pips keep their size. A shrunk line is set at the
  // whole pixel below its fitted size. Otherwise the slots' sizes.
  const titleFit = fitTitleBand(
    { title: slot.title, costSizePct: slot.costSizePct },
    name,
    showCost ? back.cost : null,
  );
  const wholePxBelow = (fitted: number, base: number) =>
    fitted < base ? measuredLinePx(fitted, base, cardWidth) / cardWidth : base;
  const titleSlot = titleFit ? { ...slot.title, sizePct: wholePxBelow(titleFit.sizePct, slot.title.sizePct) } : slot.title;
  const typeFit =
    slot.type.fit === "measured"
      ? fitTypeLineBand({ layout: { type: slot.type }, text: typeLine, symbolWidthPct: null })
      : null;
  const typeSlot = typeFit ? { ...slot.type, sizePct: wholePxBelow(typeFit.sizePct, slot.type.sizePct) } : slot.type;
  // Full-size positioned wrapper so the three % slots resolve against the card
  // (Satori needs a definite height — `inset:0` alone collapses to auto).
  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        display: "flex",
        zIndex: 20,
      }}
    >
      <Band slot={titleSlot} cardWidth={cardWidth}>
        <span style={titleFit ? { ...ELLIPSIS, maxWidth: Math.round(titleFit.widthPct * cardWidth) } : ELLIPSIS}>
          {displayLine(titleFit ? titleFit.text : name)}
        </span>
        {showCost && back.cost ? (
          <CostGlyphs
            cost={back.cost}
            fontSize={fpx(slot.costSizePct ?? slot.title.sizePct, cardWidth)}
            overrides={pipOverrides}
          />
        ) : slot.title.fit === "measured" ? null : (
          // (A measured panel name with no cost has the whole band —
          // titleBandRoomPct — as in the preview: no filler takes a gap.)
          <span style={{ display: "flex" }} />
        )}
      </Band>
      <Band slot={typeSlot} cardWidth={cardWidth}>
        <span style={typeFit?.widthPct != null ? { ...ELLIPSIS, maxWidth: Math.round(typeFit.widthPct * cardWidth) } : ELLIPSIS}>
          {displayLine(typeFit ? typeFit.text : typeLine)}
        </span>
        <span style={{ display: "flex" }} />
      </Band>
      {/* The page's rules, drawn line by line (layout v33). */}
      {hasRulesLines(rules)
        ? RulesBoxBake({
            layout: rules,
            target,
            colorHex: slot.rules.colorHex,
            font: slot.rules.font,
            overrides: pipOverrides,
          })
        : null}
    </div>
  );
}

// RotatedArtBake — a ROTATED art window (aftermath's sideways second art),
// the preview's rotate(N) box around an object-fit: cover + scale(s) <img>.
// Satori loses that art: the rotated box's overflow mask reaches its <img>
// as a bounding-box mask whose region comes out of the img's UNROTATED box,
// which cut an art-free strip across the sideways window (and the foil
// sheen painted over it) — a scale in a non-rotated inner wrapper hits the
// same mask. So nothing here clips: the window box rotates about its centre
// as in the preview, and a child at the visible rect paints the art as a
// background placed in px (artWindowPlacement — the foil mask draws this
// layer from the same numbers). The default repeat keeps each pattern tile
// the picture's own size (no-repeat makes it the canvas's, which cuts a
// zoomed picture wider than the card); the visible rect lies inside the
// picture, so no second copy ever shows. Yoga rounds a box's two edges to
// whole px, so a fractional size can land up to 1 px past a picture edge
// that the visible rect shares (a zoomed-out picture's), where the repeat
// paints the picture's OPPOSITE edge: the child takes a whole-px size that
// never reaches past the picture (a whole-px box keeps its exact size).
function RotatedArtBake({
  slot,
  rotation,
  src,
  natural,
  focalX,
  focalY,
  scale,
  cardWidth,
  cardHeight,
}: {
  slot: Rect;
  rotation: number;
  src: string;
  natural: { width: number; height: number };
  focalX: number;
  focalY: number;
  scale: number;
  cardWidth: number;
  cardHeight: number;
}) {
  const box = {
    x: 0,
    y: 0,
    width: (slot.widthPct / 100) * cardWidth,
    height: (slot.heightPct / 100) * cardHeight,
  };
  const { image, visible } = artWindowPlacement(box, natural, focalX, focalY, scale);
  // Nearest whole px, but never past the picture's far edge (`room`; the
  // epsilon absorbs float error on an edge the two share).
  const whole = (size: number, room: number) => Math.max(0, Math.min(Math.round(size), Math.floor(room + 1e-6)));
  return (
    <div
      style={{
        ...slotBox(slot),
        display: "flex",
        transform: `rotate(${rotation}deg)`,
        transformOrigin: "center",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: visible.x,
          top: visible.y,
          width: whole(visible.width, image.x + image.width - visible.x),
          height: whole(visible.height, image.y + image.height - visible.y),
          display: "flex",
          backgroundImage: `url(${src})`,
          backgroundSize: `${image.width}px ${image.height}px`,
          backgroundPosition: `${image.x - visible.x}px ${image.y - visible.y}px`,
        }}
      />
    </div>
  );
}

// SecondFaceBake — Satori-side rotated second face (mirrors SecondFacePanel).
// Each slot is positioned in card coords then rotated in place; Satori honors
// transform + transformOrigin, so flip/aftermath bake identically to preview.
function SecondFaceBake({
  slot,
  back,
  cardWidth,
  aspect,
  pipOverrides,
  rules,
  target,
}: {
  slot: NonNullable<FrameProfile["secondFace"]>;
  back: CardBackFace;
  cardWidth: number;
  aspect: number;
  pipOverrides?: PipOverrides | null;
  /** The face's rules layout, in its own unturned frame
   *  (lib/cards/rules-box.ts secondFaceRulesLayout). */
  rules: RulesLayout | null;
  target: RulesTarget;
}) {
  const name = back.title?.trim() || "Untitled";
  const typeLine = buildTypeLine({
    supertype: back.supertype,
    cardType: back.card_type ?? null,
    subtypes: back.subtypes,
  });
  const rot = `rotate(${slot.rotation}deg)`;
  const showCost = Boolean(slot.costSizePct) && Boolean(back.cost?.trim());
  const showPT = Boolean(slot.pt) && Boolean(back.power || back.toughness);
  // Same math as SecondFacePanel: a `fitLines` face's name bar (name + cost)
  // and type line shrink to fit their bars (aftermath's short sideways ones,
  // flip's upside-down ones), down to the card's own 5 pt floor.
  const orientation = orientationFromAspect(aspect);
  const lineSizes = secondFaceLineSizes({
    slot,
    name,
    typeLine,
    cost: showCost ? back.cost : null,
    orientation,
  });
  // A `fitLines` face's shrunk name and type line are set at measuredLinePx
  // (the whole pixel below the fit, never below the floor's), as the front's
  // are; rounding a fitted size up drew a line wider than its fit.
  const linePx = (fitted: number, base: number) =>
    slot.fitLines ? measuredLinePx(fitted, base, cardWidth, orientation) : fpx(fitted, cardWidth);
  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        display: "flex",
        zIndex: 20,
      }}
    >
      <div
        style={{
          ...slotBox(slot.title.rect),
          display: "flex",
          alignItems: "center",
          justifyContent: showCost ? "space-between" : "flex-start",
          // The preview's name–cost gap, which secondFaceLineSizes measures
          // the bar with — between a name and its cost only: with no cost
          // the preview draws the name alone, so the empty filler span must
          // not take a gap from it (a flip face, an aftermath half without
          // a cost). Split keeps its gap-less band for now (TODO 4.21).
          ...(slot.fitLines && showCost ? { gap: fpx(NAME_COST_GAP_PCT, cardWidth) } : {}),
          transform: rot,
          transformOrigin: "50% 50%",
          fontFamily: DISPLAY_FONT,
          fontSize: linePx(lineSizes.titleSizePct, slot.title.sizePct),
          fontWeight: slot.title.weight ?? 600,
          color: slot.title.colorHex,
          zIndex: 20,
        }}
      >
        <span style={ELLIPSIS}>{displayLine(lineSizes.titleText)}</span>
        {showCost && back.cost ? (
          <CostGlyphs
            cost={back.cost}
            fontSize={fpx(lineSizes.costSizePct, cardWidth)}
            overrides={pipOverrides}
          />
        ) : (
          <span style={{ display: "flex" }} />
        )}
      </div>
      <div
        style={{
          ...slotBox(slot.type.rect),
          display: "flex",
          alignItems: "center",
          transform: rot,
          transformOrigin: "50% 50%",
          fontFamily: DISPLAY_FONT,
          fontSize: linePx(lineSizes.typeSizePct, slot.type.sizePct),
          fontWeight: slot.type.weight ?? 600,
          color: slot.type.colorHex,
          zIndex: 20,
        }}
      >
        <span style={ELLIPSIS}>{displayLine(lineSizes.typeText)}</span>
      </div>
      {/* The face's rules, drawn line by line in its own frame and turned in
          place with it (layout v33) — at the slot's own alignment (split's
          right half is top-aligned like its left). */}
      {hasRulesLines(rules)
        ? RulesBoxBake({
            layout: rules,
            target,
            colorHex: slot.rules.colorHex,
            font: slot.rules.font,
            rotation: slot.rotation,
            overrides: pipOverrides,
          })
        : null}
      {showPT && slot.pt ? (
        <div
          style={{
            ...slotBox(slot.pt.rect),
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transform: rot,
            transformOrigin: "50% 50%",
            fontFamily: DISPLAY_FONT,
            // Shrinks to fit, on one line, like the front's StatBake (TODO 3.18).
            // Its ink span lies inside the rect, so a fitted value never
            // overflows the rect (the case StatBake's flexShrink: 0 centres).
            fontSize: statPx(
              slot.pt,
              ptValue(back.power, back.toughness),
              orientationFromAspect(aspect),
              cardWidth,
              slot.rotation === 180,
            ),
            whiteSpace: "nowrap",
            fontWeight: slot.pt.weight ?? 700,
            color: slot.pt.colorHex,
            ...(slot.pt.shadowCss ? { textShadow: slot.pt.shadowCss } : {}),
            zIndex: 20,
          }}
        >
          {ptValue(back.power, back.toughness)}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Print layer markers (TODO 6.10, lib/render/card-print.ts)
// ---------------------------------------------------------------------------

/** Which art box a print layer left empty: the under-frame copy of a
 *  see-through frame (4.17) or the art window. */
export type PrintArtKind = "under" | "main";

/** One empty art box of a print layer, as Satori laid it out: its box in
 *  LAYOUT px (the render's width × height, before `outputWidth` scales it)
 *  and the art's fit — focal point (0–1) and zoom — exactly as CardImage
 *  resolved them for the <img> it would have drawn there (object-fit: cover
 *  at the focal point, then scale() about it). */
export type PrintArtBox = {
  kind: PrintArtKind;
  left: number;
  top: number;
  width: number;
  height: number;
  focalX: number;
  focalY: number;
  scale: number;
};

/** The data-* props an empty art box carries in a print layer (focal in
 *  percent, as CardImage holds it). Satori draws nothing for them; its
 *  onNodeDetected hands them back with the box (readPrintArtBox). */
function printArtMarker(kind: PrintArtKind, focalXPct: number, focalYPct: number, scale: number) {
  return {
    "data-print-art": kind,
    "data-focal-x": String(focalXPct),
    "data-focal-y": String(focalYPct),
    "data-art-scale": String(scale),
  };
}

/** A laid-out node → the print art box it marks, or null. */
export function readPrintArtBox(node: {
  left: number;
  top: number;
  width: number;
  height: number;
  props: Record<string, unknown>;
}): PrintArtBox | null {
  const kind = node.props["data-print-art"];
  if (kind !== "under" && kind !== "main") return null;
  const num = (key: string, fallback: number) => {
    const value = Number(node.props[key]);
    return Number.isFinite(value) ? value : fallback;
  };
  return {
    kind,
    left: node.left,
    top: node.top,
    width: node.width,
    height: node.height,
    focalX: num("data-focal-x", 50) / 100,
    focalY: num("data-focal-y", 50) / 100,
    scale: num("data-art-scale", 1),
  };
}

// ---------------------------------------------------------------------------
// Public renderer
// ---------------------------------------------------------------------------

/**
 * Every raster the card embeds, resolved to a Satori-decodable data: URL
 * (lib/render/art-source.ts): the art (front + inline second face), a custom
 * design watermark, an uploaded set icon, and the owner's custom pips. WebP
 * and GIF sources used to throw inside Satori and fail the whole render.
 */
async function withRenderableImages(
  card: CardPreviewData,
): Promise<CardPreviewData> {
  const pipEntries = Object.entries(card.pipOverrides ?? {});
  const [artUrl, secondArtUrl, watermarkUrl, setIconUrl, ...pipUrls] =
    await Promise.all([
      resolveRenderableImage(card.artUrl),
      resolveRenderableImage(card.backFace?.art_url),
      resolveRenderableImage(
        card.watermark?.kind === "custom" ? card.watermark.url : null,
      ),
      resolveRenderableImage(card.setIconUrl),
      ...pipEntries.map(([, url]) => resolveRenderableImage(url)),
    ]);
  const pipOverrides =
    pipEntries.length > 0
      ? (Object.fromEntries(
          pipEntries.map(([symbol], i) => [symbol, pipUrls[i] ?? null]),
        ) as CardPreviewData["pipOverrides"])
      : card.pipOverrides;
  return {
    ...card,
    artUrl: artUrl ?? card.artUrl,
    setIconUrl: setIconUrl ?? card.setIconUrl,
    pipOverrides,
    backFace: card.backFace
      ? { ...card.backFace, art_url: secondArtUrl ?? card.backFace.art_url }
      : card.backFace,
    watermark:
      card.watermark?.kind === "custom" && watermarkUrl
        ? { ...card.watermark, url: watermarkUrl }
        : card.watermark,
  };
}

/** A square output's four corner fills for this card (TODO 3.26,
 *  lib/frames/square-corners.ts): the border black, the root's #101015, or
 *  null where the art (an art-to-edge frame) or the frame's own design runs
 *  into the corner — keep what was drawn. The keys are the masters painted
 *  on the card's left and right halves (a two-colour split paints two). The
 *  png route squares a free Square from the stored round bake with these
 *  unless one is null (it renders those live: the downscaled bake no longer
 *  carries the pixels outside the arc). */
export function squareCornerFillsOf(card: CardPreviewData): CardCornerFills {
  const template = normalizeFrameTemplate(card.frameStyle?.template);
  const layout = resolveFrameProfile(template, card.profileOverrides);
  const colors = card.colorIdentity as ColorIdentity[] | undefined;
  const split = frameSplitFor(layout, colors);
  const key = frameMasterKey(layout, colors, card, card.frameStyle);
  return squareCornerFills(template, layout.artSlot, {
    left: split?.leftKey ?? key,
    right: split?.rightKey ?? key,
  });
}

/** True for frames (Battle) whose canvas is 7:5 instead of 5:7. */
export function isLandscapeRender(card: CardPreviewData): boolean {
  return isLandscapeTemplate(card.frameStyle, card.profileOverrides);
}

/** Same answer from a raw `frame_style` column (or any object carrying
 *  `template`) — for routes that don't build full preview data (oEmbed). */
export function isLandscapeTemplate(
  frameStyle: unknown,
  profileOverrides?: CardPreviewData["profileOverrides"],
): boolean {
  const template =
    frameStyle && typeof frameStyle === "object" && "template" in frameStyle
      ? (frameStyle as { template?: unknown }).template
      : undefined;
  return (
    resolveFrameProfile(
      normalizeFrameTemplate(typeof template === "string" ? template : undefined),
      profileOverrides,
    ).orientation === "landscape"
  );
}

/** The DISPLAY render's pixel size: the default preset, rotated for a
 *  landscape frame (lib/render/stored-render.ts fits landscape bakes the
 *  same way). */
export function naturalRenderSize(landscape: boolean): { width: number; height: number } {
  const { width, height } = RENDER_PRESETS.default;
  return landscape ? { width: height, height: width } : { width, height };
}

/**
 * Every public/frames asset (frame masters aside — preloadFrame handles them,
 * both halves of a two-colour split and a type-dressed master (Alpha's
 * colourless artifact, "a") included, via frameColorKeysFor, and
 * their template fallback) a render of `card` asks for synchronously:
 * the color-keyed stat plates the frame profile defines and the loyalty
 * badges of a planeswalker's ability rows. On Vercel these are fetched, not
 * bundled (lib/render/card-frames.ts), so they must be warmed before the JSX
 * is built. Exported for tests — keep it in step with the
 * getPlateDataUrlForPath call sites in CardImage.
 */
export function frameAssetPathsFor(card: CardPreviewData): string[] {
  const template = normalizeFrameTemplate(card.frameStyle?.template);
  const layout = resolveFrameProfile(template, card.profileOverrides);
  const colorKey = pickFrameColorKey(
    card.colorIdentity as ColorIdentity[] | undefined,
  );
  // The plate key the card paints (plateKeyFor — a hybrid pair's grey "c")
  // and its anatomy overlays (the crown band), as CardImage resolves them.
  const plateKey = plateKeyFor(colorKey, resolveTwoColor(layout, card.frameStyle, anatomyFactsOf(card)));
  const paths: string[] = [];
  for (const slot of [layout.pt, layout.loyalty, layout.defense]) {
    if (slot?.plateAssetPathTemplate) {
      paths.push(plateAssetPath(slot.plateAssetPathTemplate, plateKey));
    }
  }
  for (const overlay of resolveFrameOverlays(layout, card.frameStyle, { ...anatomyFactsOf(card), colorKey })) {
    paths.push(overlay.path);
  }
  if (layout.loyaltyRows && showsLoyalty(card.cardType) && !layout.textless) {
    for (const ability of resolveLoyaltyRows(card.faceContent, card.rulesText)) {
      if (ability.cost) paths.push(loyaltyBadgeAssetFor(ability.cost));
    }
  }
  // A basic land's symbol image in its slot (FrameProfile.basicSymbol with
  // an assetPathTemplate, TODO 3.24) — BasicSymbolBake reads it synchronously.
  paths.push(
    ...basicSymbolAssetPaths(
      basicSymbolFor(
        layout,
        {
          cardType: card.cardType,
          supertype: card.supertype,
          subtypes: card.subtypes,
          title: card.title,
          rulesText: card.rulesText,
        },
        card.watermark,
      ),
    ),
  );
  return Array.from(new Set(paths));
}

export async function renderCardImage(
  source: CardPreviewData,
  preset: RenderPreset = "default",
  opts: {
    brandMark?: boolean;
    watermarkText?: string | null;
    /** The output's corner — "round" (default) or "square" for print; see
     *  CardCorners. */
    corners?: CardCorners;
    /** A PRINT layer (lib/render/card-print.ts, TODO 6.10 / 6.1a / 6.1b):
     *  the same layout, rasterized at `outputWidth`, with no corner cut
     *  (`corners` is ignored — the print path cuts and squares the
     *  composite) and, with `omitArt`, the art left out on a see-through
     *  root (CardImage omitArt) for the print path to composite at full
     *  resolution. `onNodeDetected` reports the empty art boxes
     *  (readPrintArtBox). Never set for a stored or display render. */
    printLayer?: {
      omitArt: boolean;
      outputWidth: number;
      onNodeDetected?: (node: SatoriNode) => void;
    };
  } = {},
): Promise<Response> {
  const corners: CardCorners = opts.corners ?? "round";
  const card = await withRenderableImages(source);
  const isFoil = card.frameStyle?.finish === "foil";
  // Frame PNGs are not in the function bundle on Vercel — warm the loader's
  // cache with exactly what this card needs so the sync getters inside the
  // JSX below hit the cache (a miss renders a transparent pixel, logged).
  // A two-colour split frame paints two masters — warm both. A foil card
  // also needs its art's mask copies (foilMaskSource, sharp).
  const frameTemplate = normalizeFrameTemplate(card.frameStyle?.template);
  const frameLayout = resolveFrameProfile(frameTemplate, card.profileOverrides);
  const frameKeys = frameColorKeysFor(frameLayout, card.colorIdentity as ColorIdentity[] | undefined, card, card.frameStyle);
  const [, , foilArt, foilSecondArt, secondArtSize] = await Promise.all([
    Promise.all(frameKeys.map((key) => preloadFrame(frameTemplate, key))),
    preloadFrameAssets(frameAssetPathsFor(card)),
    isFoil ? foilMaskSource(card.artUrl) : null,
    // Only a layout with a second art window (split, aftermath) draws the
    // back face's art; DFC/adventure backs share the front art, so skip the
    // decode.
    isFoil && frameLayout.secondFace?.artSlot ? foilMaskSource(card.backFace?.art_url) : null,
    // A ROTATED second window (aftermath) is placed in px from the art's size.
    frameLayout.secondFace?.artSlot && frameLayout.secondFace.rotation
      ? imageNaturalSize(card.backFace?.art_url)
      : null,
  ]);
  const base = RENDER_PRESETS[preset];
  // Landscape (Battle) frames swap the canvas to 7:5 so the bake matches the
  // preview's landscape container. All slot rects are % of the card, so they
  // resolve correctly against the swapped dimensions.
  const landscape = isLandscapeRender(card);
  const width = landscape ? base.height : base.width;
  const height = landscape ? base.width : base.height;
  return pngImageResponse(
    <CardImage
      card={card}
      width={width}
      height={height}
      brandMark={opts.brandMark ?? true}
      watermarkText={opts.watermarkText?.trim() || null}
      foilArt={isFoil ? { art: foilArt, secondArt: foilSecondArt } : undefined}
      secondArtSize={secondArtSize}
      omitArt={opts.printLayer?.omitArt}
    >
      {/* Satori serialises an inline SVG's <image href> from its image
          cache, which it fills by pre-walking the ROOT element's children
          (never a component's output) or when an <img> with that URL was
          laid out earlier. The foil mask's small art copies are drawn by
          nothing else, so they are listed here — CardImage never renders
          its children. Empty for every other finish. */}
      {[foilArt, foilSecondArt].map((source, i) =>
        isFoil && source ? <image key={i} href={source.href} /> : null,
      )}
    </CardImage>,
    {
      width,
      height,
      // The rounded corner, cut after rasterizing (lib/render/satori-png.ts):
      // 4.3 % of the SHORT side — circular in both orientations, fractional
      // (64.5 px at HD, 32.25 at 750). A square output is the same raster
      // squared again with each corner's fill (squareCornerFillsOf).
      cornerRadiusPx: opts.printLayer ? undefined : cardCornerRadiusPx(width, height),
      squareCornerFills: !opts.printLayer && corners === "square" ? squareCornerFillsOf(source) : undefined,
      outputWidth: opts.printLayer?.outputWidth,
      onNodeDetected: opts.printLayer?.onNodeDetected,
      // MPlantin is the real MTG body font (ships with mana-font); Mana +
      // Keyrune supply the cost pips and set symbol. Satori has no auto-
      // fallback once explicit fonts are provided, so all three are registered.
      // A character none of these has goes to lib/render/fallback-assets.ts
      // (bundled Noto Sans for extra Latin/Greek/Cyrillic, emoji stripped,
      // other scripts drawn as missing glyphs) — never to the network.
      fonts: [
        { name: "MPlantin", data: MPLANTIN_FONT_BYTES, weight: 400, style: "normal" },
        { name: "MPlantin", data: MPLANTIN_ITALIC_FONT_BYTES, weight: 400, style: "italic" },
        { name: "CardDisplay", data: DISPLAY_FONT_BYTES, weight: 400, style: "normal" },
        { name: "Mana", data: MANA_FONT_BYTES, weight: 400, style: "normal" },
        { name: "Keyrune", data: KEYRUNE_FONT_BYTES, weight: 400, style: "normal" },
      ],
    },
  );
}
