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
import { rulesFontTier, RULES_SIZE_PCT_BY_TIER } from "@/lib/cards/render-tiers";
import { tokenize, tokenSuffix } from "@/components/cards/mana-cost-glyphs";
import { tokenizeRulesText, inlineManaTintKey } from "@/lib/cards/rules-text";
import { pickFrameColorKey } from "@/components/cards/frame-layer";
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
  DISPLAY_FONT_BYTES,
  KEYRUNE_DEFAULT_GLYPH,
  KEYRUNE_FONT_BYTES,
  MANA_FONT_BYTES,
  MPLANTIN_FONT_BYTES,
  getManaCodepoint,
} from "@/lib/render/card-fonts";
import {
  getFrameDataUrl,
  getPlateDataUrlForPath,
} from "@/lib/render/card-frames";
import {
  getFrameProfile,
  type FrameProfile,
  type Rect,
  type SlotAlign,
  type StatSlot,
  type TextSlot,
} from "@/lib/cards/template-layout";
import type { CardPreviewData } from "@/components/cards/card-preview";
import type { CardBackFace, ColorIdentity, Rarity } from "@/types/card";

// ---------------------------------------------------------------------------
// Sizing presets — 5:7 card aspect ratio, matching the live preview.
// "default" suits OG/social previews; "hd" is the user-facing download.
// ---------------------------------------------------------------------------

export const RENDER_PRESETS = {
  default: { width: 750, height: 1050 },
  hd: { width: 1500, height: 2100 },
} as const;

export type RenderPreset = keyof typeof RENDER_PRESETS;

// Real-card rarity inks for the Keyrune set-symbol glyph in the type line.
const RARITY_SET_SYMBOL_COLOR: Record<Rarity, string> = {
  common: "#0f0f12",
  uncommon: "#9a9aa8",
  rare: "#c9a14a",
  mythic: "#d35327",
};

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

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
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
  watermark,
}: {
  card: CardPreviewData;
  width: number;
  height: number;
  watermark: boolean;
}) {
  const template = normalizeFrameTemplate(card.frameStyle?.template);
  const layout = getFrameProfile(template);
  const finish = card.frameStyle?.finish ?? "regular";
  const isFoil = finish === "foil";
  const isEtched = finish === "etched";
  const isShowcase = finish === "showcase";

  const colorKey = pickFrameColorKey(
    card.colorIdentity as ColorIdentity[] | undefined,
  );
  const frameDataUrl = getFrameDataUrl(template, colorKey);

  const title = (card.title?.trim() || "Untitled Card").slice(0, 80);
  const showCost =
    !layout.hideCost && card.cardType !== "land" && Boolean(card.cost?.trim());
  const typeLine = buildTypeLine(card);

  // Same gating as the preview (shared helpers) — and only when the frame
  // actually defines a slot for that stat.
  const showPT =
    Boolean(layout.pt) &&
    showsPowerToughness(card.cardType) &&
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

  const rulesSizePct =
    RULES_SIZE_PCT_BY_TIER[rulesFontTier(card.rulesText, card.flavorText)];
  const hasRulesContent = Boolean(
    card.rulesText?.trim() || card.flavorText?.trim(),
  );

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

      {/* Second art — the right half's art window (Split). Below the frame. */}
      {secondArtSlot && secondArtUrl ? (
        <div style={{ ...slotBox(secondArtSlot), display: "flex", overflow: "hidden" }}>
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

      {/* Stat overlays. */}
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

      {/* Title band — name + mana cost. */}
      <Band slot={layout.title} cardWidth={width} italic={isShowcase}>
        <span style={ELLIPSIS}>{title}</span>
        {showCost && card.cost ? (
          <CostGlyphs
            cost={card.cost}
            fontSize={fpx(layout.costSizePct ?? layout.title.sizePct, width)}
          />
        ) : (
          <span style={{ display: "flex" }} />
        )}
      </Band>

      {/* Type band — type line + rarity set-symbol. */}
      <Band slot={layout.type} cardWidth={width}>
        <span style={ELLIPSIS}>{typeLine}</span>
        <SetSymbolGlyph
          rarity={(card.rarity as Rarity | null) ?? "common"}
          iconUrl={card.setIconUrl}
          setCode={card.setIconCode}
          fontSize={fpx(layout.symbolSizePct ?? layout.type.sizePct * 1.1, width)}
        />
      </Band>

      {/* Rules — Saga chapter rail, otherwise the normal rules + flavor box. */}
      {layout.chapters
        ? ChapterBake({
            slot: layout.chapters,
            chapters: parseChapters(card.rulesText),
            cardWidth: width,
          })
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
          lineHeight: layout.rules.lineHeight ?? 1.3,
          color: layout.rules.colorHex,
          textAlign: "left",
          zIndex: 20,
          ...(layout.rules.backdropHex && hasRulesContent
            ? {
                background: layout.rules.backdropHex,
                borderRadius: Math.round(width * 0.015),
              }
            : {}),
        }}
      >
        {card.rulesText?.trim() ? (
          <RulesBodyBake
            text={card.rulesText}
            size={fpx(rulesSizePct, width)}
          />
        ) : null}
        {card.flavorText?.trim() ? (
          <div
            style={{
              display: "flex",
              fontStyle: "italic",
              opacity: 0.85,
              marginTop: Math.round(width * 0.012),
              paddingTop: Math.round(width * 0.012),
              borderTop: `1px solid ${layout.rules.colorHex}44`,
            }}
          >
            {card.flavorText}
          </div>
        ) : null}
      </div>
        )}

      {/* Adventure spell — the left storybook page (Adventure frames). */}
      {layout.adventure && card.backFace
        ? AdventureBake({
            slot: layout.adventure,
            back: card.backFace,
            cardWidth: width,
          })
        : null}

      {/* Second face — the rotated bottom/right card (flip/split/aftermath). */}
      {layout.secondFace && card.backFace
        ? SecondFaceBake({
            slot: layout.secondFace,
            back: card.backFace,
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
          <span style={{ display: "flex", flexShrink: 0 }}>Spellwright</span>
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

      {/* Free-tier watermark — OUR brand mark, baked into the pixels so it
          can't be stripped client-side. Paid exports pass watermark=false.
          Never a WotC mark; the MTG-style frame itself is always free. */}
      {watermark ? (
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
          spellwright.app
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

// ManaGem — one mana pip the way it prints: a colored disc with the dark symbol
// centered on top (mirrors mana-font's `.ms-cost`). `size` is the disc diameter.
function ManaGem({
  suffix,
  size,
  style,
}: {
  suffix: string;
  size: number;
  style?: Record<string, unknown>;
}) {
  const cp = getManaCodepoint(suffix);
  if (!cp) return null;
  const bg = MANA_GEM_BG[inlineManaTintKey(suffix)] ?? MANA_GEM_BG.c;
  const shadow = Math.max(1, Math.round(size * 0.05));
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
        boxShadow: `0 ${Math.max(1, Math.round(size * 0.04))}px ${shadow}px rgba(0,0,0,0.4)`,
        ...style,
      }}
    >
      <span
        style={{
          display: "flex",
          fontFamily: '"Mana"',
          fontSize: Math.round(size * 0.66),
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

function CostGlyphs({ cost, fontSize }: { cost: string; fontSize: number }) {
  const tokens = tokenize(cost);
  if (tokens.length === 0) return <span style={{ display: "flex" }} />;

  return (
    <span style={{ display: "flex", alignItems: "center", gap: 2 }}>
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
        const suffix = tokenSuffix(token);
        if (!suffix) return null;
        return <ManaGem key={`g-${i}`} suffix={suffix} size={fontSize} />;
      })}
    </span>
  );
}

// RulesBodyBake — Satori-side rules renderer. Consumes the SAME tokenizer the
// preview's RulesBody uses (lib/cards/rules-text.ts), laying each paragraph out
// as a flex-wrap row of word + inline-mana items. Inline {T}/{G} render as Mana-
// font glyphs (tinted, like the cost pips); reminder text + ability words are
// italicized. Word color is inherited from the rules container.
function RulesBodyBake({ text, size }: { text: string; size: number }) {
  const paragraphs = tokenizeRulesText(text);
  const glyph = Math.round(size * 0.92);
  const paraGap = Math.round(size * 0.5);
  const colGap = Math.round(size * 0.26);
  const lineGap = Math.round(size * 0.12);
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
            // Per-item margins instead of container `gap`: Satori's gap shifts
            // the row's content left (it uses negative margins under the hood),
            // which `overflow: hidden` then clips. Margins avoid that.
            minHeight: items.length === 0 ? Math.round(size * 0.7) : 0,
          }}
        >
          {items.map((it, i) => {
            if (it.t === "m") {
              return (
                <ManaGem
                  key={i}
                  suffix={it.suffix}
                  size={glyph}
                  style={{ marginRight: colGap, marginBottom: lineGap }}
                />
              );
            }
            return (
              <span
                key={i}
                style={{
                  display: "flex",
                  fontStyle: it.em ? "italic" : "normal",
                  opacity: it.em === "reminder" ? 0.7 : 1,
                  marginRight: colGap,
                  marginBottom: lineGap,
                }}
              >
                {bakeText(it.v)}
              </span>
            );
          })}
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

  // 2. A preset Keyrune set glyph, rarity-tinted. (Specific-code glyph mapping
  //    in the bake is a follow-up; the default Keyrune glyph stands in for now.)
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
        {KEYRUNE_DEFAULT_GLYPH}
      </span>
    );
  }

  // 3. Default — the Spellwright mark, rarity-tinted (matches the preview's
  //    SpellwrightSetMark). Inline SVG so Satori renders it without a font.
  const s = Math.round(fontSize);
  return (
    <span style={{ display: "flex" }}>
      <svg width={s} height={s} viewBox="0 0 32 32">
        <polygon points="16,3 28.4,12 23.6,26.8 8.4,26.8 3.6,12" fill={color} />
        <line
          x1="16"
          y1="8.5"
          x2="16"
          y2="21"
          stroke="rgba(0,0,0,0.5)"
          strokeWidth="1.7"
          strokeLinecap="round"
        />
        <path
          d="M16 21 L12 18.4"
          stroke="rgba(0,0,0,0.5)"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
        <path
          d="M16 21 L20 18.4"
          stroke="rgba(0,0,0,0.5)"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
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
  return (
    <div
      style={{
        ...slotBox(slot.rect),
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 15,
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
          ...(slot.shadowCss ? { textShadow: slot.shadowCss } : {}),
        }}
      >
        {value}
      </span>
    </div>
  );
}

// ChapterBake — Satori-side Saga chapter rail (mirrors ChapterRail in the
// preview). Equal-height rows, each a Roman-numeral badge + ability text.
function ChapterBake({
  slot,
  chapters,
  cardWidth,
}: {
  slot: NonNullable<FrameProfile["chapters"]>;
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
              display: "flex",
              flexShrink: 0,
              alignItems: "center",
              justifyContent: "center",
              minWidth: badge,
              height: badge,
              marginRight: Math.round(size * 0.6),
              padding: `0 ${Math.round(size * 0.32)}px`,
              borderRadius: 9999,
              background: slot.markerFillHex,
              color: slot.markerTextHex,
              fontFamily: DISPLAY_FONT,
              fontSize: Math.round(size * 0.82),
              fontWeight: 700,
            }}
          >
            {ch.marker}
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
}: {
  slot: NonNullable<FrameProfile["adventure"]>;
  back: CardBackFace;
  cardWidth: number;
}) {
  const name = back.title?.trim() || "Adventure";
  const typeLine = buildTypeLine({
    supertype: back.supertype,
    cardType: back.card_type ?? null,
    subtypes: back.subtypes,
  });
  const showCost = Boolean(back.cost?.trim());
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
          fontSize: fpx(slot.rules.sizePct, cardWidth),
          lineHeight: slot.rules.lineHeight ?? 1.25,
          color: slot.rules.colorHex,
          textAlign: "center",
          zIndex: 20,
        }}
      >
        {back.rules_text?.trim() ? (
          <RulesBodyBake
            text={back.rules_text}
            size={fpx(slot.rules.sizePct, cardWidth)}
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
}: {
  slot: NonNullable<FrameProfile["secondFace"]>;
  back: CardBackFace;
  cardWidth: number;
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
          fontSize: fpx(slot.rules.sizePct, cardWidth),
          lineHeight: slot.rules.lineHeight ?? 1.25,
          color: slot.rules.colorHex,
          textAlign: "center",
          zIndex: 20,
        }}
      >
        {back.rules_text?.trim() ? (
          <RulesBodyBake
            text={back.rules_text}
            size={fpx(slot.rules.sizePct, cardWidth)}
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

export function renderCardImage(
  card: CardPreviewData,
  preset: RenderPreset = "default",
  opts: { watermark?: boolean } = {},
): ImageResponse {
  const base = RENDER_PRESETS[preset];
  // Landscape (Battle) frames swap the canvas to 7:5 so the bake matches the
  // preview's landscape container. All slot rects are % of the card, so they
  // resolve correctly against the swapped dimensions.
  const landscape =
    getFrameProfile(normalizeFrameTemplate(card.frameStyle?.template))
      .orientation === "landscape";
  const width = landscape ? base.height : base.width;
  const height = landscape ? base.width : base.height;
  return new ImageResponse(
    <CardImage
      card={card}
      width={width}
      height={height}
      watermark={opts.watermark ?? true}
    />,
    {
      width,
      height,
      // MPlantin is the real MTG body font (ships with mana-font); Mana +
      // Keyrune supply the cost pips and set symbol. Satori has no auto-
      // fallback once explicit fonts are provided, so all three are registered.
      fonts: [
        { name: "MPlantin", data: MPLANTIN_FONT_BYTES, weight: 400, style: "normal" },
        { name: "CardDisplay", data: DISPLAY_FONT_BYTES, weight: 400, style: "normal" },
        { name: "Mana", data: MANA_FONT_BYTES, weight: 400, style: "normal" },
        { name: "Keyrune", data: KEYRUNE_FONT_BYTES, weight: 400, style: "normal" },
      ],
    },
  );
}
