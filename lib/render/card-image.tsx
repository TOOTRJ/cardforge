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
import { pickFrameColorKey } from "@/components/cards/frame-layer";
import {
  buildTypeLine,
  normalizeFrameTemplate,
  showsDefense,
  showsLoyalty,
  showsPowerToughness,
} from "@/lib/cards/card-display";
import {
  KEYRUNE_DEFAULT_GLYPH,
  KEYRUNE_FONT_BYTES,
  MANA_FONT_BYTES,
  MANA_GLYPH_COLOR,
  MPLANTIN_FONT_BYTES,
  getManaCodepoint,
} from "@/lib/render/card-fonts";
import {
  getFrameDataUrl,
  getPlateDataUrlForPath,
} from "@/lib/render/card-frames";
import {
  getFrameProfile,
  type Rect,
  type SlotAlign,
  type StatSlot,
  type TextSlot,
} from "@/lib/cards/template-layout";
import type { CardPreviewData } from "@/components/cards/card-preview";
import type { ColorIdentity, Rarity } from "@/types/card";

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

const DISPLAY_FONT = '"MPlantin"';

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
}: {
  card: CardPreviewData;
  width: number;
  height: number;
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

  return (
    <div
      style={{
        display: "flex",
        width: "100%",
        height: "100%",
        position: "relative",
        background: "#101015",
        fontFamily: DISPLAY_FONT,
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
        {card.rarity ? (
          <SetSymbolGlyph
            rarity={card.rarity as Rarity}
            fontSize={fpx(layout.symbolSizePct ?? layout.type.sizePct * 1.1, width)}
          />
        ) : (
          <span style={{ display: "flex" }} />
        )}
      </Band>

      {/* Rules + flavor box. */}
      <div
        style={{
          ...slotBox(layout.rules.rect),
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: vJustify(layout.rules.vAlign ?? "start"),
          overflow: "hidden",
          padding: `${Math.round(width * 0.012)}px ${Math.round(width * 0.006)}px`,
          fontFamily: DISPLAY_FONT,
          fontSize: fpx(rulesSizePct, width),
          lineHeight: layout.rules.lineHeight ?? 1.3,
          color: layout.rules.colorHex,
          textAlign: "center",
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
          <div style={{ display: "flex", whiteSpace: "pre-wrap" }}>
            {bakeText(card.rulesText)}
          </div>
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

      {/* Footer — artist + brand. */}
      {layout.footer ? (
        <div
          style={{
            ...slotBox(layout.footer.rect),
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
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

// ---------------------------------------------------------------------------
// CostGlyphs — Satori-side mana-cost renderer (Mana font, monochrome → tinted).
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
        const codepoint = suffix ? getManaCodepoint(suffix) : null;
        if (!codepoint) return null;
        const tintKey =
          token.kind === "solid" && /^[wubrgc]$/.test(token.label.toLowerCase())
            ? token.label.toLowerCase()
            : "c";
        const color = MANA_GLYPH_COLOR[tintKey] ?? MANA_GLYPH_COLOR.c;
        return (
          <span
            key={`g-${i}`}
            style={{
              display: "flex",
              fontFamily: '"Mana"',
              fontSize,
              lineHeight: 1,
              color,
            }}
          >
            {codepoint}
          </span>
        );
      })}
    </span>
  );
}

function SetSymbolGlyph({
  rarity,
  fontSize,
}: {
  rarity: Rarity;
  fontSize: number;
}) {
  return (
    <span
      style={{
        display: "flex",
        fontFamily: '"Keyrune"',
        fontSize,
        lineHeight: 1,
        color: RARITY_SET_SYMBOL_COLOR[rarity],
      }}
    >
      {KEYRUNE_DEFAULT_GLYPH}
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

// ---------------------------------------------------------------------------
// Public renderer
// ---------------------------------------------------------------------------

export function renderCardImage(
  card: CardPreviewData,
  preset: RenderPreset = "default",
): ImageResponse {
  const { width, height } = RENDER_PRESETS[preset];
  return new ImageResponse(
    <CardImage card={card} width={width} height={height} />,
    {
      width,
      height,
      // MPlantin is the real MTG body font (ships with mana-font); Mana +
      // Keyrune supply the cost pips and set symbol. Satori has no auto-
      // fallback once explicit fonts are provided, so all three are registered.
      fonts: [
        { name: "MPlantin", data: MPLANTIN_FONT_BYTES, weight: 400, style: "normal" },
        { name: "Mana", data: MANA_FONT_BYTES, weight: 400, style: "normal" },
        { name: "Keyrune", data: KEYRUNE_FONT_BYTES, weight: 400, style: "normal" },
      ],
    },
  );
}
