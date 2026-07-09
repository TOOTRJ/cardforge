import { ImageResponse } from "next/og";
import { BRAND, MANA_HEX, MANA_PIPS, OG_SIZE } from "@/lib/brand/constants";
import { BrandMarkTile } from "@/lib/brand/glyph";
import type { ColorIdentity } from "@/types/card";

// ---------------------------------------------------------------------------
// CardSocialImage — the 1200×630 landscape unfurl for card pages.
//
// The raw baked card is 750×1050 portrait; served directly as og:image it
// gets center-cropped by X's summary_large_image, letterboxed by Bluesky/
// Facebook, and (at ~780 KB) rejected outright by WhatsApp's 600 KB cap.
// This composite puts the WHOLE card on a branded landscape canvas so every
// platform renders it uncropped: card render on the right, name + creator +
// brand lockup on the left, per-card color-identity accent.
//
// Satori rules apply (see .claude/skills/pipglyph-brand): display:flex on
// every multi-child <div>, literal colors from BRAND, no CSS variables.
// The card render itself is passed in as a data URI — Satori must never do
// its own network fetch mid-render.
// ---------------------------------------------------------------------------

export { OG_SIZE as CARD_SOCIAL_SIZE };

// Fills the 630px canvas height minus 40px of breathing room, at the card's
// 5:7 aspect: 590 × (5/7) ≈ 421.
const CARD_HEIGHT = 590;
const CARD_WIDTH = Math.round(CARD_HEIGHT * (5 / 7));

/** Discord's embed accent bar (theme-color) + the composite's accent line:
 *  the card's mana color, gold for multicolor, neutral for colorless. */
export function cardAccentColor(colorIdentity: string[]): string {
  const pips = colorIdentity.filter(
    (c): c is ColorIdentity => c in MANA_HEX,
  );
  if (pips.length === 1) return MANA_HEX[pips[0] as keyof typeof MANA_HEX];
  if (pips.length > 1) return BRAND.gold;
  return MANA_HEX.C;
}

/** PNG ImageResponse of the composite — kept here so the (JSX-free)
 *  route handler at app/api/cards/[id]/og/route.ts can stay a .ts file. */
export function renderCardSocialImage(
  props: Parameters<typeof CardSocialImage>[0],
): ImageResponse {
  return new ImageResponse(<CardSocialImage {...props} />, OG_SIZE);
}

function CardSocialImage({
  title,
  typeLine,
  creatorHandle,
  cardImageDataUri,
  accent,
}: {
  title: string;
  typeLine: string;
  creatorHandle: string | null;
  cardImageDataUri: string;
  accent: string;
}) {
  const titleSize = title.length > 40 ? 44 : title.length > 24 ? 54 : 64;
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        padding: "0 64px",
        gap: 56,
        background: `linear-gradient(135deg, ${BRAND.navy} 0%, ${BRAND.surface} 55%, ${BRAND.navy} 100%)`,
        color: BRAND.foreground,
        fontFamily: "system-ui, sans-serif",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Decorative radial glow behind the card, tinted by the accent */}
      <div
        style={{
          position: "absolute",
          top: -140,
          right: -60,
          width: 640,
          height: 640,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${hexToRgba(accent, 0.22)} 0%, transparent 70%)`,
          display: "flex",
        }}
      />

      {/* WUBRG pip strip — same bottom bar as every other PipGlyph OG */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          height: 6,
          display: "flex",
        }}
      >
        {MANA_PIPS.map((pip) => (
          <div
            key={pip.label}
            style={{
              flex: 1,
              background: pip.color,
              opacity: 0.7,
              display: "flex",
            }}
          />
        ))}
      </div>

      {/* Left column: lockup, title, type line, creator, domain */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          gap: 22,
          flex: 1,
          minWidth: 0,
          paddingBottom: 8,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <BrandMarkTile size={52} />
          <span
            style={{
              fontSize: 24,
              letterSpacing: 5,
              textTransform: "uppercase",
              color: BRAND.gold,
              fontWeight: 600,
            }}
          >
            PipGlyph
          </span>
        </div>

        <div
          style={{
            display: "flex",
            width: 76,
            height: 5,
            borderRadius: 3,
            background: accent,
          }}
        />

        <h1
          style={{
            margin: 0,
            display: "flex",
            fontSize: titleSize,
            lineHeight: 1.1,
            letterSpacing: -1,
            fontWeight: 700,
            maxWidth: 620,
          }}
        >
          {title}
        </h1>

        {typeLine ? (
          <span
            style={{
              fontSize: 26,
              color: BRAND.muted,
              letterSpacing: 0.5,
            }}
          >
            {typeLine}
          </span>
        ) : null}

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 10,
            marginTop: 6,
          }}
        >
          {creatorHandle ? (
            <span style={{ fontSize: 24, color: BRAND.foreground }}>
              forged by @{creatorHandle}
            </span>
          ) : null}
          <span
            style={{
              fontSize: 18,
              color: BRAND.bronze,
              letterSpacing: 2,
              textTransform: "uppercase",
            }}
          >
            pipglyph.com · make your own
          </span>
        </div>
      </div>

      {/* Right column: the full card, uncropped */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={cardImageDataUri}
        alt=""
        width={CARD_WIDTH}
        height={CARD_HEIGHT}
        style={{
          width: CARD_WIDTH,
          height: CARD_HEIGHT,
          borderRadius: 22,
          boxShadow: "0 24px 60px rgba(0,0,0,0.55)",
        }}
      />
    </div>
  );
}

function hexToRgba(hex: string, alpha: number): string {
  const value = hex.replace("#", "");
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
