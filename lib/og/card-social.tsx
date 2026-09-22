import { ImageResponse } from "next/og";
import { BRAND, OG_SIZE } from "@/lib/brand/constants";
import {
  BrandLockup,
  OG_BACKGROUND,
  OG_FONT,
  OgDomainStamp,
  OgGlow,
  OgPipStrip,
} from "@/lib/og/chrome";

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
// 5:7 aspect: 590 × (5/7) ≈ 421. A landscape render (Battle frames, 7:5)
// keeps the same 590 long edge, so the card box is 590 × 421 instead — it
// used to be squeezed into the portrait box.
const CARD_LONG_EDGE = 590;
const CARD_SHORT_EDGE = Math.round(CARD_LONG_EDGE * (5 / 7));

/** The card box in the composite for a portrait or landscape render. */
export function socialCardBox(landscape: boolean): { width: number; height: number } {
  return landscape
    ? { width: CARD_LONG_EDGE, height: CARD_SHORT_EDGE }
    : { width: CARD_SHORT_EDGE, height: CARD_LONG_EDGE };
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
  landscape = false,
}: {
  title: string;
  typeLine: string;
  creatorHandle: string | null;
  cardImageDataUri: string;
  accent: string;
  /** The render is a landscape frame (Battle): draw it 7:5, not 5:7. */
  landscape?: boolean;
}) {
  const titleSize = title.length > 40 ? 44 : title.length > 24 ? 54 : 64;
  const box = socialCardBox(landscape);
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
        background: OG_BACKGROUND,
        color: BRAND.foreground,
        fontFamily: OG_FONT,
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Glow behind the card, tinted by the accent */}
      <OgGlow top={-140} right={-60} size={640} color={hexToRgba(accent, 0.22)} />
      <OgPipStrip />

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
        <BrandLockup markSize={52} fontSize={24} />

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
          <OgDomainStamp inline>pipglyph.com · make your own</OgDomainStamp>
        </div>
      </div>

      {/* Right column: the full card, uncropped */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={cardImageDataUri}
        alt=""
        width={box.width}
        height={box.height}
        style={{
          width: box.width,
          height: box.height,
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
