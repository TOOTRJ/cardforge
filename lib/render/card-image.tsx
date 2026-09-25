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
import { resolveRenderableImage } from "@/lib/render/art-source";
import { fitRulesSizePct, fitSingleLineSizePct } from "@/lib/cards/render-tiers";
import { RULES_TEXT } from "@/lib/cards/typography";
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
import { pickFrameColorKey } from "@/components/cards/frame-layer";
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
import {
  getFrameDataUrl,
  getPlateDataUrlForPath,
  plateAssetPath,
  preloadFrame,
  preloadFrameAssets,
} from "@/lib/render/card-frames";
import {
  loyaltyBadgeAssetFor,
  SAGA_MARKER_POINTS,
  loyaltyBadgeShapeFor,
  type FrameProfile,
  type Rect,
  type SlotAlign,
  type StatSlot,
  underFrameArtRect,
  type TextSlot,
} from "@/lib/cards/template-layout";
import { resolveFrameProfile } from "@/lib/cards/profile-override";
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

// ---------------------------------------------------------------------------
// Card JSX
// ---------------------------------------------------------------------------

function CardImage({
  card,
  width,
  height,
  brandMark,
  watermarkText,
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
}) {
  const template = normalizeFrameTemplate(card.frameStyle?.template);
  const layout = resolveFrameProfile(template, card.profileOverrides);
  const finish = card.frameStyle?.finish ?? "regular";
  const isFoil = finish === "foil";
  const isEtched = finish === "etched";
  const isShowcase = finish === "showcase";

  const colorKey = pickFrameColorKey(
    card.colorIdentity as ColorIdentity[] | undefined,
  );
  const frameDataUrl = getFrameDataUrl(template, colorKey);

  // No bake-only truncation: titles up to the validated 120 chars ellipsize
  // in the band exactly as the preview does.
  const title = card.title?.trim() || "Untitled Card";
  const showCost =
    !layout.hideCost && card.cardType !== "land" && Boolean(card.cost?.trim());
  const typeLine = buildTypeLine(card);

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

  const underArtRect = underFrameArtRect(layout, colorKey);
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

      {/* Frame PNG — above the art. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
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

      {/* Title band — name + mana cost. */}
      <Band slot={layout.title} cardWidth={width} italic={isShowcase}>
        <span style={ELLIPSIS}>{title}</span>
        {showCost && card.cost && !layout.costRect ? (
          <CostGlyphs
            cost={card.cost}
            fontSize={fpx(layout.costSizePct ?? layout.title.sizePct, width)}
            overrides={card.pipOverrides}
          />
        ) : (
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
          />
        </div>
      ) : null}

      {/* Type band — type line + rarity set-symbol. Long type lines shrink
          to fit on one line, same math as the live preview. With a
          symbolRect the symbol gets its own absolute box (mirrors the
          preview) so it can be aligned independently of the type line. */}
      <Band
        slot={{
          ...layout.type,
          sizePct: fitSingleLineSizePct({
            text: typeLine,
            rect: layout.type.rect,
            baseSizePct: layout.type.sizePct,
            reservedPct: layout.symbolRect
              ? 0
              : (layout.symbolSizePct ?? layout.type.sizePct * 1.1) * 1.3,
          }),
        }}
        cardWidth={width}
      >
        <span style={ELLIPSIS}>{typeLine}</span>
        {!layout.symbolRect ? (
          <SetSymbolGlyph
            rarity={(card.rarity as Rarity | null) ?? "common"}
            iconUrl={card.setIconUrl}
            setCode={card.setIconCode}
            fontSize={fpx(layout.symbolSizePct ?? layout.type.sizePct * 1.1, width)}
          />
        ) : (
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
            zIndex: 9,
            background: layout.rules.backdropHex,
            borderRadius: Math.round(width * 0.015),
          }}
        />
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
            value: `${card.power ?? "—"}/${card.toughness ?? "—"}`,
            colorKey,
            cardWidth: width,
          })
        : null}
      {showLoyalty && layout.loyalty
        ? StatBake({
            slot: layout.loyalty,
            value: String(card.loyalty ?? "—"),
            colorKey,
            cardWidth: width,
          })
        : null}
      {showDefense && layout.defense
        ? StatBake({
            slot: layout.defense,
            value: String(card.defense ?? "—"),
            colorKey,
            cardWidth: width,
          })
        : null}

      {/* Footer — artist + brand. */}
      {layout.footer ? (
        <div
          style={{
            ...slotBox(layout.footer.rect),
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontFamily: fontFamilyFor(layout.footer.font),
            fontSize: fpx(layout.footer.sizePct, width),
            color: layout.footer.colorHex,
            letterSpacing: layout.footer.letterSpacingEm
              ? `${layout.footer.letterSpacingEm}em`
              : 0,
            textTransform: layout.footer.uppercase ? "uppercase" : "none",
            zIndex: 20,
          }}
        >
          <span style={ELLIPSIS}>
            {card.artistCredit?.trim()
              ? `Art: ${card.artistCredit}`
              : "Art: Unknown"}
          </span>
          {/* Footer-right: the owner's custom mark, or nothing. (The old
              hardcoded "PipGlyph" doubled up with the brand-mark overlay —
              layout v19 removed it.) */}
          {watermarkText ? (
            <span style={{ display: "flex", flexShrink: 0 }}>
              {watermarkText}
            </span>
          ) : null}
        </div>
      ) : null}

      {/* Premium finish: foil specular sheen (static — Satori has no anim). */}
      {isFoil ? (
        <div
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 30,
            background:
              "linear-gradient(115deg, rgba(255,200,120,0.35) 0%, rgba(255,255,255,0.4) 35%, rgba(190,170,255,0.4) 55%, rgba(120,210,255,0.35) 75%, rgba(255,255,255,0.3) 100%)",
            mixBlendMode: "overlay",
          }}
        />
      ) : null}

      {/* Premium finish: etched gold inner border + cross-hatch. */}
      {isEtched ? (
        <>
          <div
            style={{
              position: "absolute",
              top: "3%",
              left: "3%",
              right: "3%",
              bottom: "3%",
              zIndex: 30,
              border: `${Math.round(width * 0.006)}px solid #d4a64a`,
              borderRadius: Math.round(width * 0.03),
            }}
          />
          <div
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 30,
              backgroundImage:
                "repeating-linear-gradient(45deg, rgba(255,255,255,0.10) 0 1px, transparent 1px 7px), repeating-linear-gradient(-45deg, rgba(255,255,255,0.08) 0 1px, transparent 1px 7px)",
            }}
          />
        </>
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
            right: "3.5%",
            bottom: "1.8%",
            zIndex: 40,
            display: "flex",
            alignItems: "center",
            fontFamily: DISPLAY_FONT,
            fontSize: fpx(0.026, width),
            fontWeight: 600,
            letterSpacing: "0.02em",
            color: "rgba(255,255,255,0.82)",
            textShadow: "0 1px 3px rgba(0,0,0,0.8)",
          }}
        >
          <svg
            width={Math.round(fpx(0.03, width))}
            height={Math.round(fpx(0.03, width))}
            viewBox="0 0 32 32"
            style={{ marginRight: Math.round(fpx(0.008, width)) }}
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
}: {
  cost: string;
  fontSize: number;
  /** Card owner's custom pip icons — see lib/pips/override.ts. */
  overrides?: PipOverrides | null;
}) {
  const tokens = tokenize(cost);
  if (tokens.length === 0) return <span style={{ display: "flex" }} />;

  return (
    <span
      style={{
        display: "flex",
        alignItems: "center",
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
}: {
  slot: TextSlot;
  rows: NonNullable<FrameProfile["loyaltyRows"]>;
  abilities: LoyaltyAbility[];
  sizePct: number;
  cardWidth: number;
  pipOverrides?: PipOverrides | null;
}) {
  const size = fpx(sizePct, cardWidth);
  const badgeW = Math.round(size * 2.3);
  const badgeH = Math.round(size * 1.5);
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
        borderRadius: Math.round(cardWidth * 0.012),
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
            padding: `${Math.round(size * 0.22)}px ${Math.round(size * 0.4)}px`,
          }}
        >
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
  cardWidth,
}: {
  slot: StatSlot;
  value: string;
  colorKey: string;
  cardWidth: number;
}) {
  const plateUrl = slot.plateAssetPathTemplate
    ? getPlateDataUrlForPath(slot.plateAssetPathTemplate, colorKey)
    : null;
  // A separate plate box (TODO 4.18): plate in plateRect, digits centred in
  // rect — the same split as the preview's StatOverlay.
  if (slot.plateRect && plateUrl) {
    return (
      <div style={{ position: "absolute", left: 0, top: 0, width: "100%", height: "100%", display: "flex", zIndex: 22 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={plateUrl} alt="" style={{ ...slotBox(slot.plateRect), objectFit: "fill" }} />
        {StatBake({
          slot: { ...slot, plateAssetPathTemplate: undefined, plateRect: undefined },
          value,
          colorKey,
          cardWidth,
        })}
      </div>
    );
  }
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
            top: "8%",
            left: "12%",
            right: "12%",
            bottom: "8%",
            background: slot.badgeColorHex,
            borderRadius: "42%",
          }}
        />
      ) : null}
      <span
        style={{
          position: "relative",
          fontFamily: DISPLAY_FONT,
          color: slot.colorHex,
          fontWeight: slot.weight ?? 700,
          fontSize: fpx(slot.sizePct, cardWidth),
          // Same nudge as the preview's translate(${valueDxEm}em, ${valueDyEm}em);
          // computed in px here since Satori doesn't resolve em in transforms.
          ...(slot.valueDxEm || slot.valueDyEm
            ? {
                transform: `translate(${Math.round(
                  (slot.valueDxEm ?? 0) * fpx(slot.sizePct, cardWidth),
                )}px, ${Math.round(
                  (slot.valueDyEm ?? 0) * fpx(slot.sizePct, cardWidth),
                )}px)`,
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
        <span style={ELLIPSIS}>{name}</span>
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
        <span style={ELLIPSIS}>{typeLine}</span>
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
        <span style={ELLIPSIS}>{name}</span>
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
        <span style={ELLIPSIS}>{typeLine}</span>
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
            fontSize: fpx(slot.pt.sizePct, cardWidth),
            fontWeight: slot.pt.weight ?? 700,
            color: slot.pt.colorHex,
            ...(slot.pt.shadowCss ? { textShadow: slot.pt.shadowCss } : {}),
            zIndex: 20,
          }}
        >
          {`${back.power ?? "—"}/${back.toughness ?? "—"}`}
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
 * Every public/frames asset (frame master aside — preloadFrame handles that
 * one and its template fallback) a render of `card` asks for synchronously:
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
  // Frame PNGs are not in the function bundle on Vercel — warm the loader's
  // cache with exactly what this card needs so the sync getters inside the
  // JSX below hit the cache (a miss renders a transparent pixel, logged).
  await Promise.all([
    preloadFrame(
      normalizeFrameTemplate(card.frameStyle?.template),
      pickFrameColorKey(card.colorIdentity as ColorIdentity[] | undefined),
    ),
    preloadFrameAssets(frameAssetPathsFor(card)),
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
    />,
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
