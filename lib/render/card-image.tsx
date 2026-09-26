// Server-side card renderer. Uses Next.js `ImageResponse` (Satori +
// resvg-wasm under the hood) so the same card produces a PNG you can:
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

import { ImageResponse } from "next/og";
import { foilMaskSource, resolveRenderableImage } from "@/lib/render/art-source";
import { fitRulesSizePct, fitSingleLineSizePct } from "@/lib/cards/render-tiers";
import { fitStatSizePct, ptValue, STAT_BADGE_INSET } from "@/lib/cards/stat-fit";
import { RULES_TEXT, orientationFromAspect, type CardOrientation } from "@/lib/cards/typography";
import { tokenize, tokenSuffix } from "@/components/cards/mana-cost-glyphs";
import { ROSE_STAR_PATH, SET_MARK_GEM_PATH, SET_MARK_RING, SET_MARK_STAR_PATH } from "@/lib/brand/geometry";
import { RARITY_INK, RARITY_SET_MARK } from "@/lib/brand/constants";
import {
  pipOverrideForSuffix,
  pipOverrideForToken,
  type PipOverrides,
} from "@/lib/pips/override";
import {
  tokenizeRulesText,
  groupTightRuns,
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
  normalizeFrameTemplate,
  showsDefense,
  showsLoyalty,
  showsPowerToughness,
  slotLine,
  type LoyaltyAbility,
  type SagaChapter,
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
  DISPLAY_FONT_BYTES,
  KEYRUNE_DEFAULT_GLYPH,
  KEYRUNE_FONT_BYTES,
  MANA_FONT_BYTES,
  MPLANTIN_FONT_BYTES,
  MPLANTIN_ITALIC_FONT_BYTES,
  getKeyruneCodepoint,
  getManaCodepoint,
} from "@/lib/render/card-fonts";
import { displayRunPx, keyruneAdvancePx } from "@/lib/render/satori-text";
import {
  getFrameDataUrl,
  getPlateDataUrlForPath,
  plateAssetPath,
  preloadFrame,
  preloadFrameAssets,
} from "@/lib/render/card-frames";
import {
  bandTextStyle,
  brandMarkLayout,
  footerInk,
  loyaltyBadgeAssetFor,
  SAGA_MARKER_POINTS,
  loyaltyBadgeShapeFor,
  slotInk,
  type FrameProfile,
  type Rect,
  type SlotAlign,
  type StatSlot,
  underFrameArtRect,
  type TextSlot,
} from "@/lib/cards/template-layout";
import { resolveFrameProfile } from "@/lib/cards/profile-override";
import { EtchedSheen } from "@/lib/cards/etched-finish";
import {
  FoilBackdropSheen,
  FoilSheen,
  FoilStripeSheen,
  foilArtLayers,
  loyaltyStripeRects,
  type FoilArtSource,
} from "@/lib/cards/foil-finish";
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
  /** NEVER rendered — Satori's image preload list (see renderCardImage). */
  children?: React.ReactNode;
}) {
  const template = normalizeFrameTemplate(card.frameStyle?.template);
  const layout = resolveFrameProfile(template, card.profileOverrides);
  const markLayout = brandMarkLayout(layout);
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
  // Per-frame-master footer ink — the same footerInk() the preview resolves.
  const footerInkResolved = layout.footer ? footerInk(layout.footer, masterKey) : null;
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
  const typeSlot: TextSlot = {
    ...layout.type,
    sizePct: fitSingleLineSizePct({
      text: typeLine,
      rect: layout.type.rect,
      baseSizePct: layout.type.sizePct,
      reservedPct: layout.symbolRect
        ? 0
        : (layout.symbolSizePct ?? layout.type.sizePct * 1.1) * 1.3,
    }),
  };
  // Room a centred title / type line may fill before it ellipsizes: the band
  // less the set symbol + gap beside it (see alignedText; a cost in the
  // title band is never centred, so 0 = don't judge).
  const titleRoom =
    showCost && card.cost && !layout.costRect ? 0 : bandWidth(layout.title, width);
  const typeRoom = !isAligned(typeSlot)
    ? 0
    : bandWidth(typeSlot, width) -
      (layout.symbolRect
        ? 0
        : fpx(0.02, width) +
          setSymbolWidth({
            iconUrl: card.setIconUrl,
            setCode: card.setIconCode,
            fontSize: fpx(layout.symbolSizePct ?? layout.type.sizePct * 1.1, width),
          }));

  // Same gating as the preview (shared helpers) — and only when the frame
  // actually defines a slot for that stat.
  const showPT =
    Boolean(layout.pt) &&
    showsPowerToughness(card.cardType, card.subtypes) &&
    Boolean(card.power || card.toughness);
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
  // Planeswalker ability rows spend ~20% of the box on the badge rail plus
  // per-row padding; narrow the rect handed to the fit estimate accordingly
  // (the same correction in both renderers keeps preview == bake).
  const usesLoyaltyRows =
    Boolean(layout.loyaltyRows) && showsLoyalty(card.cardType);
  const fitRect = usesLoyaltyRows
    ? {
        ...layout.rules.rect,
        widthPct: layout.rules.rect.widthPct * 0.78,
        heightPct: layout.rules.rect.heightPct * 0.88,
      }
    : layout.rules.rect;
  const rulesSizePct = fitRulesSizePct({
    rulesText: card.rulesText,
    flavorText: card.flavorText,
    rect: fitRect,
    baseSizePct: layout.rules.sizePct,
    lineHeight: layout.rules.lineHeight ?? RULES_TEXT.lineHeight,
    aspect,
  });
  // Planeswalker ability rows (badged loyalty costs, striped rows) when the
  // frame defines them and the card actually is a planeswalker. Structured
  // rows first, rules_text parsing as the legacy fallback — identical
  // resolution to the live preview (lib/cards/face-content.ts).
  const loyaltyAbilities = usesLoyaltyRows
    ? resolveLoyaltyRows(card.faceContent, card.rulesText)
    : [];
  // Saga chapter rail content — same structured-first resolution.
  const sagaContent = layout.chapters
    ? resolveSagaChapters(card.faceContent, card.rulesText)
    : null;
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
  // BASIC lands (Basic supertype — see lib/cards/watermark.ts) print NO
  // rules text, just the big symbol. Keyed on the card's identity, not the
  // watermark, so an explicit override icon suppresses the text too
  // (identical to the live preview); nonbasic lands print their text.
  const isBasicLand = basicLandManaKey(basicLandFace) !== null;
  const hasRulesContent =
    !isBasicLand &&
    Boolean(card.rulesText?.trim() || card.flavorText?.trim());

  const underArtRect = underFrameArtRect(layout, masterKey);
  const artW = Math.round((layout.artSlot.widthPct / 100) * width);
  const artH = Math.round((layout.artSlot.heightPct / 100) * height);

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
        background: "#101015",
        fontFamily: BODY_FONT,
        color: layout.title.colorHex,
      }}
    >
      {/* See-through frames: the art also runs under the whole frame
          (TODO 4.17) — same cover fit at the focal point as the preview. */}
      {underArtRect && card.artUrl ? (
        <div style={{ ...slotBox(underArtRect), display: "flex", overflow: "hidden" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
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
        </div>
      ) : null}
      {/* Art — below the frame, in the transparent cut-out. */}
      <div style={{ ...slotBox(layout.artSlot), display: "flex", overflow: "hidden" }}>
        {card.artUrl ? (
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
          aftermath's sideways bottom window). Rotates in place with the face. */}
      {secondArtSlot && secondArtUrl ? (
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
          landscape={layout.orientation === "landscape"}
          width={width}
          height={height}
        />
      ) : null}

      {/* Title band — name + mana cost. A centred title (tokens) has no
          cost beside it: no filler span either, or the band's gap pushed
          the name half a gap left of the preview's. */}
      <Band slot={layout.title} cardWidth={width} italic={isShowcase}>
        <span
          style={{
            ...alignedText(layout.title, displayLine(title), fpx(layout.title.sizePct, width), titleRoom),
            ...titleInk,
          }}
        >
          {displayLine(title)}
        </span>
        {showCost && card.cost && !layout.costRect ? (
          <CostGlyphs
            cost={card.cost}
            fontSize={fpx(layout.costSizePct ?? layout.title.sizePct, width)}
            overrides={card.pipOverrides}
            dy={layout.costDy ? fpx(layout.costDy, width) : 0}
          />
        ) : isAligned(layout.title) ? null : (
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
      <Band slot={typeSlot} cardWidth={width}>
        <span
          style={{
            ...alignedText(typeSlot, displayLine(typeLine), fpx(typeSlot.sizePct, width), typeRoom),
            ...typeInk,
          }}
        >
          {displayLine(typeLine)}
        </span>
        {!layout.symbolRect ? (
          <SetSymbolGlyph
            rarity={(card.rarity as Rarity | null) ?? "common"}
            iconUrl={card.setIconUrl}
            setCode={card.setIconCode}
            fontSize={fpx(layout.symbolSizePct ?? layout.type.sizePct * 1.1, width)}
          />
        ) : isAligned(typeSlot) ? null : (
          <span style={{ display: "flex" }} />
        )}
      </Band>
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
            fontSize={fpx(layout.symbolSizePct ?? layout.type.sizePct * 1.1, width)}
          />
        </div>
      ) : null}

      {/* Rules-box backdrop — own layer under the watermark (see the
          preview's twin comment). */}
      {layout.rules.backdropHex &&
      hasRulesContent &&
      !layout.chapters &&
      !(layout.loyaltyRows && loyaltyAbilities.length > 0) ? (
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

      {/* Design watermark — mirrors the preview layer exactly: centered in
          the rules rect, z above the frame / below text, suppressed where a
          rail replaces the box. Satori-safe: flat img / font glyph +
          opacity only. */}
      {effectiveWatermark && !layout.chapters && !(layout.loyaltyRows && loyaltyAbilities.length > 0) ? (
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

      {/* Rules — Saga chapter rail or planeswalker ability rows, otherwise the
          normal rules + flavor box. */}
      {layout.chapters
        ? ChapterBake({
            slot: layout.chapters,
            intro: sagaContent?.intro ?? null,
            chapters: sagaContent?.chapters ?? [],
            cardWidth: width,
          })
        : layout.loyaltyRows && loyaltyAbilities.length > 0
          ? LoyaltyRowsBake({
              slot: layout.rules,
              rows: layout.loyaltyRows,
              abilities: loyaltyAbilities,
              sizePct: rulesSizePct,
              pipOverrides: card.pipOverrides,
              cardWidth: width,
              foil: plateFoil,
            })
          : isBasicLand
            ? null
            : (
      <div
        style={{
          ...slotBox(layout.rules.rect),
          display: "flex",
          flexDirection: "column",
          alignItems: "stretch",
          justifyContent: vJustify(layout.rules.vAlign ?? "start"),
          overflow: "hidden",
          padding: `${Math.round(width * 0.012)}px ${Math.round(width * 0.006)}px`,
          fontFamily: fontFamilyFor(layout.rules.font),
          fontSize: fpx(rulesSizePct, width),
          lineHeight: layout.rules.lineHeight ?? RULES_TEXT.lineHeight,
          color: layout.rules.colorHex,
          textAlign: "left",
          zIndex: 20,

        }}
      >
        {card.rulesText?.trim() ? (
          <RulesBodyBake
            text={card.rulesText}
            size={fpx(rulesSizePct, width)}
            overrides={card.pipOverrides}
          />
        ) : null}
        {card.flavorText?.trim() ? (
          <FlavorBake
            text={card.flavorText}
            size={fpx(rulesSizePct, width)}
            afterRules={Boolean(card.rulesText?.trim())}
            divider={layout.flavorDivider !== false}
            dividerHex={`${layout.rules.colorHex}44`}
          />
        ) : null}
      </div>
        )}

      {/* Adventure spell — the left storybook page (Adventure frames). */}
      {layout.adventure && card.backFace
        ? AdventureBake({
            slot: layout.adventure,
            back: card.backFace,
            cardWidth: width,
            pipOverrides: card.pipOverrides,
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
            colorKey,
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
            colorKey,
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
            colorKey,
            masterKey,
            cardWidth: width,
            orientation: orientationFromAspect(aspect),
            foil: plateFoil,
          })
        : null}

      {/* Footer — artist + brand. */}
      {layout.footer && footerInkResolved ? (
        <div
          style={{
            ...slotBox(layout.footer.rect),
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontFamily: fontFamilyFor(layout.footer.font),
            fontSize: fpx(layout.footer.sizePct, width),
            color: footerInkResolved.colorHex,
            ...(footerInkResolved.shadowCss
              ? { textShadow: footerInkResolved.shadowCss }
              : {}),
            letterSpacing: layout.footer.letterSpacingEm
              ? `${layout.footer.letterSpacingEm}em`
              : 0,
            textTransform: layout.footer.uppercase ? "uppercase" : "none",
            zIndex: 20,
          }}
        >
          <span style={ELLIPSIS}>
            {slotLine(
              layout.footer.font,
              card.artistCredit?.trim() ? `Art: ${card.artistCredit}` : "Art: Unknown",
            )}
          </span>
          {/* Footer-right: the owner's custom mark, or nothing. (The old
              hardcoded "PipGlyph" doubled up with the brand-mark overlay —
              layout v19 removed it.) */}
          {watermarkText ? (
            <span style={{ display: "flex", flexShrink: 0 }}>
              {slotLine(layout.footer.font, watermarkText)}
            </span>
          ) : null}
        </div>
      ) : null}

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

/** SetSymbolGlyph's laid-out width at `fontSize` (its three branches). */
function setSymbolWidth({
  iconUrl,
  setCode,
  fontSize,
}: {
  iconUrl?: string | null;
  setCode?: string | null;
  fontSize: number;
}): number {
  if (iconUrl || !setCode) return Math.round(fontSize);
  return keyruneAdvancePx(getKeyruneCodepoint(setCode) ?? KEYRUNE_DEFAULT_GLYPH, fontSize);
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
        // instead of a fixed 2px that vanished at HD resolution).
        gap: Math.max(1, Math.round(fontSize * 0.12)),
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

// RulesBodyBake — Satori-side rules renderer. Consumes the SAME tokenizer the
// preview's RulesBody uses (lib/cards/rules-text.ts): each paragraph is a
// flex-wrap row of unbreakable RUNS (groupTightRuns), so "({T}:" or "{2}{U}"
// never split across lines and punctuation hugs its pip exactly like print.
function RulesBodyBake({
  text,
  size,
  overrides,
}: {
  text: string;
  size: number;
  overrides?: PipOverrides | null;
}) {
  const paragraphs = tokenizeRulesText(text);
  // Spacing from the shared typography standard, rounded to whole pixels
  // (Satori lays out on the pixel grid; the preview uses the same em values).
  const glyph = Math.round(size * RULES_TEXT.pipDiscEm);
  const paraGap = Math.round(size * RULES_TEXT.paragraphGapEm);
  const runGap = Math.round(size * RULES_TEXT.wordGapEm);
  const lineGap = Math.round(size * RULES_TEXT.wrapGapEm);
  const pipGap = Math.max(1, Math.round(size * RULES_TEXT.pipGapEm));
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        rowGap: paraGap,
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
            // Per-run margins instead of container `gap`: Satori's gap shifts
            // the row's content left (it uses negative margins under the hood),
            // which `overflow: hidden` then clips. Margins avoid that.
            minHeight: items.length === 0 ? Math.round(size * RULES_TEXT.blankLineEm) : 0,
          }}
        >
          {groupTightRuns(items).map((run, ri) => (
            <span
              key={ri}
              style={{
                display: "flex",
                alignItems: "center",
                marginRight: runGap,
                marginBottom: lineGap,
              }}
            >
              {run.map((it, i) => (
                <RulesItemBake
                  key={i}
                  item={it}
                  glyph={glyph}
                  overrides={overrides}
                  // Adjacent pips ("{G}{G}") keep a hairline gap inside the
                  // run; words glued to a pip ("{T}:") get none.
                  gapBefore={
                    i > 0 && it.t === "m" && run[i - 1].t === "m" ? pipGap : 0
                  }
                />
              ))}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

// FlavorBake — italic flavor text under the rules, with source line breaks
// preserved (real cards put quote attributions on their own line). M15-family
// frames print a hairline between rules and flavor; pre-M15 frames leave a
// gap only. Spacing is in em of the rules size, like the preview's FlavorBlock.
function FlavorBake({
  text,
  size,
  afterRules,
  divider,
  dividerHex,
}: {
  text: string;
  size: number;
  afterRules: boolean;
  divider: boolean;
  dividerHex: string;
}) {
  const lines = text.split(/\n/).filter((l) => l.trim().length > 0);
  const gap = Math.round(size * RULES_TEXT.flavorGapEm);
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        fontStyle: "italic",
        lineHeight: RULES_TEXT.lineHeight,
        rowGap: Math.round(size * RULES_TEXT.wrapGapEm),
        ...(afterRules
          ? divider
            ? { marginTop: gap, paddingTop: gap, borderTop: `1px solid ${dividerHex}` }
            : { marginTop: gap * 2 }
          : {}),
      }}
    >
      {lines.map((line, i) => (
        <span key={i} style={{ display: "flex" }}>
          {bakeText(line)}
        </span>
      ))}
    </div>
  );
}

// LoyaltyRowsBake — printed-planeswalker ability rows: a loyalty-cost badge in
// the left rail + the ability text, with alternating translucent row shading.
// Static abilities (no leading cost) render unbadged. Mirrors LoyaltyRows in
// the preview.
function LoyaltyRowsBake({
  slot,
  rows,
  abilities,
  sizePct,
  cardWidth,
  pipOverrides,
  foil = null,
}: {
  slot: TextSlot;
  rows: NonNullable<FrameProfile["loyaltyRows"]>;
  abilities: LoyaltyAbility[];
  sizePct: number;
  cardWidth: number;
  pipOverrides?: PipOverrides | null;
  /** Foil finish: each stripe gets its own sheen (FoilStripeSheen) — the
   *  translucent stripes sit above the full-card layer. */
  foil?: { cardHeight: number; landscape: boolean } | null;
}) {
  const size = fpx(sizePct, cardWidth);
  const badgeW = Math.round(size * 2.3);
  const badgeH = Math.round(size * 1.5);
  const stripe = (i: number) => (i % 2 === 0 ? rows.stripeAHex : rows.stripeBHex);
  const stripeRects = foil ? loyaltyStripeRects(slot.rect, abilities.length) : null;
  const radius = Math.round(cardWidth * 0.012);
  // Satori clips an image (the sheen SVG) to its own shape and only to the
  // bounding rectangle of the box's rounded overflow, so the outer rows'
  // sheens round their own outer corners to the box's radius (the browser
  // already clips the preview's).
  const sheenCorners = (i: number) => ({
    ...(i === 0 ? { borderTopLeftRadius: radius, borderTopRightRadius: radius } : {}),
    ...(i === abilities.length - 1 ? { borderBottomLeftRadius: radius, borderBottomRightRadius: radius } : {}),
  });
  return (
    <div
      style={{
        ...slotBox(slot.rect),
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        overflow: "hidden",
        fontFamily: fontFamilyFor(slot.font),
        fontSize: size,
        lineHeight: slot.lineHeight ?? RULES_TEXT.lineHeight,
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
            flex: 1,
            alignItems: "center",
            background: stripe(i),
            padding: `${Math.round(size * 0.22)}px ${Math.round(size * 0.4)}px`,
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
              height={Math.round((stripeRects[i].heightPct / 100) * foil.cardHeight)}
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
              width: badgeW,
              height: badgeH,
              marginRight: Math.round(size * 0.5),
            }}
          >
            {ab.cost ? (
              // The printed loyalty shield — same MSE asset as the preview.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={getPlateDataUrlForPath(loyaltyBadgeAssetFor(ab.cost), "c") ?? ""}
                width={badgeW}
                height={badgeH}
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
                fontSize: Math.round(size * 0.88),
                fontWeight: 700,
                ...(ab.cost
                  ? loyaltyBadgeShapeFor(ab.cost) === "up"
                    ? { paddingTop: Math.round(size * 0.18) }
                    : loyaltyBadgeShapeFor(ab.cost) === "down"
                      ? { paddingBottom: Math.round(size * 0.18) }
                      : {}
                  : {}),
              }}
            >
              {ab.cost ? bakeText(ab.cost) : ""}
            </span>
          </div>
          <div style={{ display: "flex", flex: 1 }}>
            <RulesBodyBake text={ab.text} size={size} overrides={pipOverrides} />
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
}: {
  rarity: Rarity;
  fontSize: number;
  iconUrl?: string | null;
  setCode?: string | null;
}) {
  const color = RARITY_SET_SYMBOL_COLOR[rarity];

  // 1. A set's uploaded icon image — drawn as-is.
  if (iconUrl) {
    return (
      <span style={{ display: "flex" }}>
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
  if (setCode) {
    return (
      <span
        style={{
          display: "flex",
          fontFamily: '"Keyrune"',
          fontSize,
          lineHeight: 1,
          color,
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
    <span style={{ display: "flex" }}>
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
  intro,
  chapters,
  cardWidth,
}: {
  slot: NonNullable<FrameProfile["chapters"]>;
  intro: string | null;
  chapters: SagaChapter[];
  cardWidth: number;
}) {
  const size = fpx(slot.sizePct, cardWidth);
  const badge = Math.round(size * 1.7);
  return (
    <div
      style={{
        ...slotBox(slot.rect),
        display: "flex",
        flexDirection: "column",
        zIndex: 20,
      }}
    >
      {intro ? (
        <div
          style={{
            display: "flex",
            flexShrink: 0,
            padding: `${Math.round(size * 0.4)}px ${Math.round(size * 0.3)}px`,
            borderBottom: `1px solid ${slot.dividerHex}`,
            fontFamily: BODY_FONT,
            fontStyle: "italic",
            fontSize: Math.round(size * 0.9),
            lineHeight: 1.2,
            color: slot.textColorHex,
          }}
        >
          {bakeText(intro)}
        </div>
      ) : null}
      {chapters.map((ch, i) => (
        <div
          key={i}
          style={{
            display: "flex",
            flex: 1,
            alignItems: "center",
            padding: `${Math.round(size * 0.3)}px ${Math.round(size * 0.2)}px`,
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
              minWidth: badge,
              height: Math.round(badge * 1.12),
              marginRight: Math.round(size * 0.6),
              padding: `0 ${Math.round(size * 0.32)}px`,
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
                paddingBottom: Math.round(size * 0.3),
                color: slot.markerTextHex,
                fontFamily: DISPLAY_FONT,
                fontSize: Math.round(size * 0.82),
                fontWeight: 700,
              }}
            >
              {ch.marker}
            </span>
          </div>
          <div
            style={{
              display: "flex",
              flex: 1,
              fontFamily: BODY_FONT,
              fontSize: size,
              lineHeight: 1.22,
              color: slot.textColorHex,
              overflow: "hidden",
            }}
          >
            {ch.text}
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
}: {
  slot: NonNullable<FrameProfile["adventure"]>;
  back: CardBackFace;
  cardWidth: number;
  pipOverrides?: PipOverrides | null;
}) {
  const name = back.title?.trim() || "Adventure";
  const typeLine = buildTypeLine({
    supertype: back.supertype,
    cardType: back.card_type ?? null,
    subtypes: back.subtypes,
  });
  const showCost = Boolean(back.cost?.trim());
  const rulesSize = fitRulesSizePct({
    rulesText: back.rules_text,
    flavorText: null,
    rect: slot.rules.rect,
    baseSizePct: slot.rules.sizePct,
    lineHeight: slot.rules.lineHeight ?? RULES_TEXT.lineHeight,
    aspect: 7 / 5,
  });
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
      <Band slot={slot.title} cardWidth={cardWidth}>
        <span style={ELLIPSIS}>{displayLine(name)}</span>
        {showCost && back.cost ? (
          <CostGlyphs
            cost={back.cost}
            fontSize={fpx(slot.costSizePct ?? slot.title.sizePct, cardWidth)}
            overrides={pipOverrides}
          />
        ) : (
          <span style={{ display: "flex" }} />
        )}
      </Band>
      <Band slot={slot.type} cardWidth={cardWidth}>
        <span style={ELLIPSIS}>{displayLine(typeLine)}</span>
        <span style={{ display: "flex" }} />
      </Band>
      <div
        style={{
          ...slotBox(slot.rules.rect),
          display: "flex",
          flexDirection: "column",
          alignItems: "stretch",
          justifyContent: vJustify(slot.rules.vAlign ?? "start"),
          overflow: "hidden",
          padding: `${Math.round(cardWidth * 0.01)}px ${Math.round(cardWidth * 0.006)}px`,
          fontFamily: fontFamilyFor(slot.rules.font),
          fontSize: fpx(rulesSize, cardWidth),
          lineHeight: slot.rules.lineHeight ?? RULES_TEXT.lineHeight,
          color: slot.rules.colorHex,
          textAlign: "center",
          zIndex: 20,
        }}
      >
        {back.rules_text?.trim() ? (
          <RulesBodyBake
            text={back.rules_text}
            size={fpx(rulesSize, cardWidth)}
            overrides={pipOverrides}
          />
        ) : null}
      </div>
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
}: {
  slot: NonNullable<FrameProfile["secondFace"]>;
  back: CardBackFace;
  cardWidth: number;
  aspect: number;
  pipOverrides?: PipOverrides | null;
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
  const rulesSize = fitRulesSizePct({
    rulesText: back.rules_text,
    flavorText: null,
    rect: slot.rules.rect,
    baseSizePct: slot.rules.sizePct,
    lineHeight: slot.rules.lineHeight ?? RULES_TEXT.lineHeight,
    aspect,
  });
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
          transform: rot,
          transformOrigin: "50% 50%",
          fontFamily: DISPLAY_FONT,
          fontSize: fpx(slot.title.sizePct, cardWidth),
          fontWeight: slot.title.weight ?? 600,
          color: slot.title.colorHex,
          zIndex: 20,
        }}
      >
        <span style={ELLIPSIS}>{displayLine(name)}</span>
        {showCost && back.cost ? (
          <CostGlyphs
            cost={back.cost}
            fontSize={fpx(slot.costSizePct ?? slot.title.sizePct, cardWidth)}
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
          fontSize: fpx(slot.type.sizePct, cardWidth),
          fontWeight: slot.type.weight ?? 600,
          color: slot.type.colorHex,
          zIndex: 20,
        }}
      >
        <span style={ELLIPSIS}>{displayLine(typeLine)}</span>
      </div>
      <div
        style={{
          ...slotBox(slot.rules.rect),
          display: "flex",
          flexDirection: "column",
          alignItems: "stretch",
          justifyContent: "center",
          overflow: "hidden",
          padding: `${Math.round(cardWidth * 0.008)}px ${Math.round(cardWidth * 0.012)}px`,
          transform: rot,
          transformOrigin: "50% 50%",
          fontFamily: fontFamilyFor(slot.rules.font),
          fontSize: fpx(rulesSize, cardWidth),
          lineHeight: slot.rules.lineHeight ?? RULES_TEXT.lineHeight,
          color: slot.rules.colorHex,
          textAlign: "center",
          zIndex: 20,
        }}
      >
        {back.rules_text?.trim() ? (
          <RulesBodyBake
            text={back.rules_text}
            size={fpx(rulesSize, cardWidth)}
            overrides={pipOverrides}
          />
        ) : null}
      </div>
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
  const paths: string[] = [];
  for (const slot of [layout.pt, layout.loyalty, layout.defense]) {
    if (slot?.plateAssetPathTemplate) {
      paths.push(plateAssetPath(slot.plateAssetPathTemplate, colorKey));
    }
  }
  if (layout.loyaltyRows && showsLoyalty(card.cardType)) {
    for (const ability of resolveLoyaltyRows(card.faceContent, card.rulesText)) {
      if (ability.cost) paths.push(loyaltyBadgeAssetFor(ability.cost));
    }
  }
  return Array.from(new Set(paths));
}

export async function renderCardImage(
  source: CardPreviewData,
  preset: RenderPreset = "default",
  opts: { brandMark?: boolean; watermarkText?: string | null } = {},
): Promise<ImageResponse> {
  const card = await withRenderableImages(source);
  const isFoil = card.frameStyle?.finish === "foil";
  // Frame PNGs are not in the function bundle on Vercel — warm the loader's
  // cache with exactly what this card needs so the sync getters inside the
  // JSX below hit the cache (a miss renders a transparent pixel, logged).
  // A two-colour split frame paints two masters — warm both. A foil card
  // also needs its art's mask copies (foilMaskSource, sharp).
  const frameTemplate = normalizeFrameTemplate(card.frameStyle?.template);
  const frameLayout = resolveFrameProfile(frameTemplate, card.profileOverrides);
  const frameKeys = frameColorKeysFor(frameLayout, card.colorIdentity as ColorIdentity[] | undefined, card);
  const [, , foilArt, foilSecondArt] = await Promise.all([
    Promise.all(frameKeys.map((key) => preloadFrame(frameTemplate, key))),
    preloadFrameAssets(frameAssetPathsFor(card)),
    isFoil ? foilMaskSource(card.artUrl) : null,
    // Only a layout with a second art window (split) draws the back face's
    // art; DFC/adventure backs share the front art, so skip the decode.
    isFoil && frameLayout.secondFace?.artSlot ? foilMaskSource(card.backFace?.art_url) : null,
  ]);
  const base = RENDER_PRESETS[preset];
  // Landscape (Battle) frames swap the canvas to 7:5 so the bake matches the
  // preview's landscape container. All slot rects are % of the card, so they
  // resolve correctly against the swapped dimensions.
  const landscape = isLandscapeRender(card);
  const width = landscape ? base.height : base.width;
  const height = landscape ? base.width : base.height;
  return new ImageResponse(
    <CardImage
      card={card}
      width={width}
      height={height}
      brandMark={opts.brandMark ?? true}
      watermarkText={opts.watermarkText?.trim() || null}
      foilArt={isFoil ? { art: foilArt, secondArt: foilSecondArt } : undefined}
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
      // MPlantin is the real MTG body font (ships with mana-font); Mana +
      // Keyrune supply the cost pips and set symbol. Satori has no auto-
      // fallback once explicit fonts are provided, so all three are registered.
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
