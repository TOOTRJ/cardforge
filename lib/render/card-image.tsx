// Server-side card renderer. Uses Next.js `ImageResponse` (Satori +
// resvg-wasm under the hood) so the same JSX produces a PNG you can:
//   * serve as <meta og:image="..."> on public card pages, and
//   * upload to the card-exports bucket on user request.
//
// Satori has limited CSS support — Tailwind classes don't work and not all
// transforms are honored. Every style here is inline + hex-coded so the
// renderer is portable and doesn't pull on the app's CSS variables.

import { ImageResponse } from "next/og";
import { rulesFontTier, type RulesFontTier } from "@/lib/cards/render-tiers";
import { tokenize, tokenSuffix } from "@/components/cards/mana-cost-glyphs";
import {
  KEYRUNE_DEFAULT_GLYPH,
  KEYRUNE_FONT_BYTES,
  MANA_FONT_BYTES,
  MANA_GLYPH_COLOR,
  MPLANTIN_FONT_BYTES,
  getManaCodepoint,
} from "@/lib/render/card-fonts";
import type { CardPreviewData } from "@/components/cards/card-preview";
import type { Rarity } from "@/types/card";

// ---------------------------------------------------------------------------
// Sizing presets — 5:7 card aspect ratio, matching the live preview.
// "default" is good enough for OG/social previews; "hd" is the user-facing
// download default.
// ---------------------------------------------------------------------------

export const RENDER_PRESETS = {
  default: { width: 750, height: 1050 },
  hd: { width: 1500, height: 2100 },
} as const;

export type RenderPreset = keyof typeof RENDER_PRESETS;

// ---------------------------------------------------------------------------
// Theme — hand-picked hex equivalents of the OKLCH tokens in globals.css.
// Updating one place here keeps the export in sync with the live preview.
// ---------------------------------------------------------------------------

const COLORS = {
  background: "#15151d",
  surface: "#1c1c25",
  elevated: "#23232e",
  border: "#3a3a4a",
  borderStrong: "#525266",
  foreground: "#f4f4f5",
  muted: "#a4a4b0",
  subtle: "#71717a",
  primary: "#a78bfa",
  accent: "#fbbf24",
} as const;

const COLOR_GRADIENTS: Record<string, [string, string]> = {
  white: ["#fde68a44", "#fef3c722"],
  blue: ["#38bdf844", "#7dd3fc22"],
  black: ["#3f3f46", "#71717a22"],
  red: ["#fb718544", "#fda4af22"],
  green: ["#34d39944", "#86efac22"],
  multicolor: ["#e879f944", "#fbbf2422"],
  colorless: ["#94a3b833", "#94a3b822"],
};

// Real-card rarity inks for the Keyrune set-symbol glyph in the type line.
// Common is the dark stamp; uncommon/rare/mythic use the metallic finishes.
const RARITY_SET_SYMBOL_COLOR: Record<Rarity, string> = {
  common: "#0f0f12",
  uncommon: "#a5a5b5",
  rare: "#c9a14a",
  mythic: "#d35327",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function capitalize(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : "";
}

function buildTypeLine(card: CardPreviewData): string {
  const left = [card.supertype, card.cardType ? capitalize(card.cardType) : null]
    .filter(Boolean)
    .join(" ");
  const right = card.subtypes?.filter(Boolean).join(" ") ?? "";
  if (left && right) return `${left} — ${right}`;
  return left || right || "Type";
}

function pickGradient(colors: string[] | undefined): [string, string] {
  if (!colors || colors.length === 0) return COLOR_GRADIENTS.colorless;
  if (colors.length > 1) return COLOR_GRADIENTS.multicolor;
  return COLOR_GRADIENTS[colors[0]] ?? COLOR_GRADIENTS.colorless;
}

function showsPowerToughness(cardType: string | null | undefined): boolean {
  return cardType === "creature" || cardType === "token";
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

// ---------------------------------------------------------------------------
// JSX layout — mirrors CardPreview's structure but uses inline styles only.
//
// Satori notes:
//   * no Tailwind, only inline styles
//   * no CSS animations — foil is a static specular gradient here
//   * `position: absolute` IS supported, used for the borderless backdrop
//   * `background-image` with multiple stops IS supported, used for the
//     etched cross-hatch + the foil specular sheen
// ---------------------------------------------------------------------------

// Font sizes for the rules+flavor box, indexed by the same tier the live
// preview uses (rulesFontTier in card-preview.tsx). Values are calibrated
// for the 750×1050 default preset; the renderer scales them up for HD.
const RULES_FONT_PX_BY_TIER: Record<RulesFontTier, number> = {
  0: 20,
  1: 17,
  2: 14,
  3: 12,
};

function CardImage({
  card,
  height,
}: {
  card: CardPreviewData;
  /** Total render canvas height in pixels — needed because Satori does
   *  not honor `aspectRatio`, so the art well height is computed up front
   *  as a fixed proportion of the card height. */
  height: number;
}) {
  const title = (card.title?.trim() || "Untitled Card").slice(0, 80);
  const showCost = card.cardType !== "land" && card.cost?.trim();
  const showPT = showsPowerToughness(card.cardType) && (card.power || card.toughness);
  const showLoyalty = card.rarity === "mythic" && Boolean(card.loyalty);
  const showDefense = Boolean(card.defense);
  const [gradFrom, gradTo] = pickGradient(card.colorIdentity);
  const focalX = clamp(card.artPosition?.focalX ?? 0.5, 0, 1) * 100;
  const focalY = clamp(card.artPosition?.focalY ?? 0.5, 0, 1) * 100;
  const scale = clamp(card.artPosition?.scale ?? 1, 0.5, 4);

  const typeLine = buildTypeLine(card);

  const rulesFontPx = RULES_FONT_PX_BY_TIER[rulesFontTier(card.rulesText, card.flavorText)];

  // Art well height is 46% of the total card height. This is the same
  // proportion the live preview gets via aspect-[3/2] (which Satori
  // doesn't support); computing in pixels here keeps both renderers
  // visually identical at any preset size.
  const artHeight = Math.floor(height * 0.46);

  // Read the finish from the persisted frame_style. Defaults to "regular"
  // so any historic card without an explicit finish renders unchanged.
  const finish = card.frameStyle?.finish ?? "regular";
  const isFoil = finish === "foil";
  const isEtched = finish === "etched";
  const isBorderless = finish === "borderless";
  const isShowcase = finish === "showcase";

  // Section background colors. Borderless makes them translucent so the
  // full-bleed art shows through; everything else uses the surface tint.
  const sectionBg = isBorderless ? `${COLORS.background}66` : `${COLORS.surface}cc`;
  const sectionBorder = isBorderless
    ? `1px solid ${COLORS.borderStrong}55`
    : `1px solid ${COLORS.border}66`;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        background: `linear-gradient(135deg, ${COLORS.elevated}, ${COLORS.surface}, ${COLORS.background})`,
        padding: 18,
        boxSizing: "border-box",
        // MPlantin is the only general-text font Satori has loaded (see the
        // fonts: [...] block in renderCardImage). Setting it as the root
        // default means title/type/rules/footer all render even though
        // they don't opt into a specific family.
        fontFamily: '"MPlantin"',
        color: COLORS.foreground,
        position: "relative",
      }}
    >
      {/* Foil: static specular sheen. Satori doesn't run animations, so we
          freeze the conic foil from the live preview into a linear rainbow
          band that still reads as "holographic" in a still PNG. */}
      {isFoil ? (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "linear-gradient(115deg, rgba(255,200,120,0.35) 0%, rgba(255,255,255,0.4) 35%, rgba(190,170,255,0.4) 55%, rgba(120,210,255,0.35) 75%, rgba(255,255,255,0.3) 100%)",
            mixBlendMode: "overlay",
            pointerEvents: "none",
          }}
        />
      ) : null}

      {/* Etched: gold-leaf inner border + fine cross-hatch overlay. Both
          are static so they translate cleanly to PNG. */}
      {isEtched ? (
        <>
          <div
            style={{
              position: "absolute",
              top: 12,
              left: 12,
              right: 12,
              bottom: 12,
              border: "4px solid #d4a64a",
              borderRadius: 24,
              pointerEvents: "none",
            }}
          />
          <div
            style={{
              position: "absolute",
              inset: 0,
              backgroundImage:
                "repeating-linear-gradient(45deg, rgba(255,255,255,0.10) 0 1px, transparent 1px 7px), repeating-linear-gradient(-45deg, rgba(255,255,255,0.08) 0 1px, transparent 1px 7px)",
              pointerEvents: "none",
            }}
          />
        </>
      ) : null}

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          padding: 14,
          borderRadius: 22,
          background: `${COLORS.background}66`,
          border: `1px solid ${COLORS.border}99`,
          gap: 10,
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Borderless: full-bleed art behind every section + a vignette so
            the floating glass panels stay readable on busy images. */}
        {isBorderless ? (
          <>
            <div
              style={{
                display: "flex",
                position: "absolute",
                inset: 0,
                background: `linear-gradient(to bottom, ${gradFrom}, ${gradTo}, ${COLORS.background}cc)`,
                overflow: "hidden",
              }}
            >
              {card.artUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={card.artUrl}
                  width={1500}
                  height={2100}
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
              ) : null}
            </div>
            <div
              style={{
                position: "absolute",
                inset: 0,
                background:
                  "linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0) 22%, rgba(0,0,0,0) 62%, rgba(0,0,0,0.75) 100%)",
                pointerEvents: "none",
              }}
            />
          </>
        ) : null}

        {/* Title bar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "10px 18px",
            borderRadius: 10,
            background: sectionBg,
            border: sectionBorder,
            position: "relative",
            zIndex: 10,
          }}
        >
          <span
            style={{
              fontSize: 28,
              fontWeight: 600,
              letterSpacing: 0.4,
              color: COLORS.foreground,
              maxWidth: "75%",
              overflow: "hidden",
              whiteSpace: "nowrap",
              textOverflow: "ellipsis",
              fontStyle: isShowcase ? "italic" : "normal",
            }}
          >
            {title}
          </span>
          {showCost && card.cost ? (
            <CostGlyphs cost={card.cost} fontSize={26} />
          ) : null}
        </div>

        {/* Showcase ornate hairline below the title plate. */}
        {isShowcase ? (
          <div
            style={{
              display: "flex",
              height: 2,
              background: `linear-gradient(90deg, transparent 0%, ${COLORS.accent} 50%, transparent 100%)`,
              position: "relative",
              zIndex: 10,
            }}
          />
        ) : null}

        {/* Art well — fixed 3:2 aspect ratio so the art window stays the
            same proportional size regardless of how long the card's rules
            text is. Mirrors the live preview (card-preview.tsx). The
            borderless variant still uses a flex spacer because the
            full-bleed backdrop sits behind every section. */}
        {isBorderless ? (
          <div
            style={{
              display: "flex",
              flexShrink: 0,
              width: "100%",
              height: artHeight,
              position: "relative",
              zIndex: 0,
            }}
          />
        ) : (
          <div
            style={{
              display: "flex",
              position: "relative",
              flexShrink: 0,
              width: "100%",
              height: artHeight,
              borderRadius: 10,
              overflow: "hidden",
              border: `1px solid ${COLORS.border}66`,
              background: `linear-gradient(to bottom, ${gradFrom}, ${gradTo}, ${COLORS.background}cc)`,
              justifyContent: "center",
              alignItems: "center",
              zIndex: 10,
            }}
          >
            {card.artUrl ? (
              // next/og's Satori renderer does not support `next/image` — only
              // a plain `<img>` element is allowed inside ImageResponse JSX.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={card.artUrl}
                width={1500}
                height={1050}
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
              <span
                style={{
                  fontSize: 14,
                  letterSpacing: 4,
                  textTransform: "uppercase",
                  color: COLORS.subtle,
                }}
              >
                Artwork preview
              </span>
            )}
          </div>
        )}

        {/* Type line */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "8px 16px",
            borderRadius: 10,
            background: sectionBg,
            border: sectionBorder,
            color: COLORS.muted,
            fontSize: 18,
            position: "relative",
            zIndex: 10,
          }}
        >
          <span
            style={{
              maxWidth: "85%",
              overflow: "hidden",
              whiteSpace: "nowrap",
              textOverflow: "ellipsis",
            }}
          >
            {typeLine}
          </span>
          {card.rarity ? (
            <SetSymbolGlyph rarity={card.rarity as Rarity} fontSize={20} />
          ) : null}
        </div>

        {/* Rules + flavor — takes whatever vertical space is left after
            the fixed-height sections. overflow:hidden clips long text
            instead of warping the layout; rulesFontPx auto-shrinks the
            font in 4 tiers based on character count so most cards fit. */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            minHeight: 0,
            overflow: "hidden",
            padding: "12px 16px",
            borderRadius: 10,
            background: isBorderless ? `${COLORS.background}aa` : `${COLORS.surface}99`,
            border: sectionBorder,
            color: COLORS.muted,
            fontSize: rulesFontPx,
            lineHeight: 1.4,
            gap: 10,
            position: "relative",
            zIndex: 10,
          }}
        >
          {card.rulesText?.trim() ? (
            <p
              style={{
                margin: 0,
                whiteSpace: "pre-wrap",
                color: COLORS.foreground,
              }}
            >
              {card.rulesText}
            </p>
          ) : (
            <span style={{ fontStyle: "italic", color: COLORS.subtle }}>
              Rules text appears here.
            </span>
          )}

          {card.flavorText?.trim() ? (
            <p
              style={{
                margin: 0,
                paddingTop: 10,
                borderTop: `1px solid ${COLORS.border}66`,
                fontStyle: "italic",
                color: COLORS.subtle,
              }}
            >
              {card.flavorText}
            </p>
          ) : null}

          {(showPT || showLoyalty || showDefense) && (
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 8,
                marginTop: "auto",
                paddingTop: 10,
                borderTop: `1px solid ${COLORS.border}66`,
              }}
            >
              {showPT ? (
                <Pill
                  label="P/T"
                  value={`${card.power ?? "—"} / ${card.toughness ?? "—"}`}
                />
              ) : null}
              {showLoyalty ? (
                <Pill label="Loyalty" value={card.loyalty ?? "—"} />
              ) : null}
              {showDefense ? (
                <Pill label="Defense" value={card.defense ?? "—"} />
              ) : null}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontSize: 12,
            letterSpacing: 2,
            textTransform: "uppercase",
            color: isBorderless ? COLORS.muted : COLORS.subtle,
            position: "relative",
            zIndex: 10,
          }}
        >
          <span style={{ maxWidth: "70%", overflow: "hidden" }}>
            {card.artistCredit?.trim()
              ? `Art: ${card.artistCredit}`
              : "Art: Unknown"}
          </span>
          <span>Spellwright</span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CostGlyphs — Satori-side renderer for mana cost strings. Tokenizes the cost
// the same way the live preview does, then emits one styled <span> per token
// using the Mana font (fontFamily: "Mana"). Unknown tokens render as plain
// fallback text so weird inputs never break the bake.
// ---------------------------------------------------------------------------

function CostGlyphs({
  cost,
  fontSize,
}: {
  cost: string;
  fontSize: number;
}) {
  const tokens = tokenize(cost);
  if (tokens.length === 0) return null;

  return (
    <span style={{ display: "flex", alignItems: "center", gap: 2 }}>
      {tokens.map((token, i) => {
        if (token.kind === "text") {
          return (
            <span
              key={`t-${i}`}
              style={{
                color: COLORS.muted,
                fontSize: fontSize * 0.6,
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
        // The Mana font is monochrome; tint by the relevant color so the pip
        // reads as W/U/B/R/G/C the same way the live preview's CSS does.
        // For hybrid and twobrid pips, fall back to the colorless hue — the
        // glyph itself encodes the two-color split.
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

function Pill({ label, value }: { label: string; value: string }) {
  return (
    <span
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 10px",
        borderRadius: 9999,
        border: `1px solid ${COLORS.border}99`,
        background: `${COLORS.elevated}cc`,
        color: COLORS.foreground,
        fontFamily: '"Geist Mono", ui-monospace, monospace',
        fontSize: 14,
        letterSpacing: 1,
        textTransform: "uppercase",
      }}
    >
      <span style={{ color: COLORS.subtle }}>{label}</span>
      <span>{value}</span>
    </span>
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
  return new ImageResponse(<CardImage card={card} height={height} />, {
    width,
    height,
    // Mana + Keyrune are loaded so the cost glyphs and set symbol render
    // with the open-source pictographic fonts (SIL OFL 1.1) the live
    // preview uses via CSS. Without this, Satori has no glyphs for the
    // PUA codepoints we emit and falls back to .notdef boxes.
    // Satori has no auto-fallback when explicit fonts are provided, so the
    // body font (MPlantin, the actual MTG body-text font that ships with
    // mana-font) is registered alongside the icon fonts. MPlantin is the
    // default; Mana / Keyrune are opted into on the spans that render
    // their glyphs.
    fonts: [
      {
        name: "MPlantin",
        data: MPLANTIN_FONT_BYTES,
        weight: 400,
        style: "normal",
      },
      {
        name: "Mana",
        data: MANA_FONT_BYTES,
        weight: 400,
        style: "normal",
      },
      {
        name: "Keyrune",
        data: KEYRUNE_FONT_BYTES,
        weight: 400,
        style: "normal",
      },
    ],
  });
}
