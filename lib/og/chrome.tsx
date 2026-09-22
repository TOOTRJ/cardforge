import type { ReactNode } from "react";
import { BRAND, MANA_PIPS, OG_SIZE } from "@/lib/brand/constants";
import { BrandMarkTile } from "@/lib/brand/glyph";

// ---------------------------------------------------------------------------
// The visual language every PipGlyph Open Graph image shares: the site-wide
// card (app/opengraph-image.tsx — EDGE runtime), the card composite
// (lib/og/card-social.tsx) and the deck / set / challenge / profile / article
// fallbacks (composed through OgShell). Pure JSX with brand-constant deps
// only, so the edge route can import it; the image pre-fetch (sharp) lives in
// lib/og/shell.tsx, which re-exports everything here for the route files.
//
// Satori rules apply: display:flex on every multi-child <div>, literal colors
// from BRAND, no CSS variables.
// ---------------------------------------------------------------------------

export { MANA_PIPS, OG_SIZE };

export const OG_FONT = "system-ui, sans-serif";

/** The dark brand gradient behind every canvas. */
export const OG_BACKGROUND = `linear-gradient(135deg, ${BRAND.navy} 0%, ${BRAND.surface} 50%, ${BRAND.navy} 100%)`;

/** Cut long copy for the canvas ("…" past `max` characters). */
export function ogExcerpt(text: string, max = 120): string {
  return text.length > max ? `${text.slice(0, max - 3)}…` : text;
}

/** The Astral Rose mark + wordmark. The home card runs it larger. */
export function BrandLockup({
  markSize = 56,
  fontSize = 26,
  gap = 16,
}: {
  markSize?: number;
  fontSize?: number;
  gap?: number;
} = {}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap }}>
      <BrandMarkTile size={markSize} />
      <span
        style={{
          fontSize,
          letterSpacing: 5,
          textTransform: "uppercase",
          color: BRAND.gold,
          fontWeight: 600,
        }}
      >
        PipGlyph
      </span>
    </div>
  );
}

/** Soft radial glow in a corner of the canvas (purple by default; the card
 *  composite tints it with the card's accent). */
export function OgGlow({
  top,
  left,
  right,
  size = 600,
  color = "rgba(107,77,154,0.28)",
}: {
  top: number;
  left?: number;
  right?: number;
  size?: number;
  color?: string;
}) {
  // Satori throws on an `undefined` style value (it .trim()s every value),
  // so only the anchor that was given may appear in the style object.
  const anchor = left !== undefined ? { left } : { right: right ?? -80 };
  return (
    <div
      style={{
        position: "absolute",
        top,
        ...anchor,
        width: size,
        height: size,
        borderRadius: "50%",
        background: `radial-gradient(circle, ${color} 0%, transparent 70%)`,
        display: "flex",
      }}
    />
  );
}

/** The WUBRG strip along the bottom edge — on every PipGlyph OG image. */
export function OgPipStrip() {
  return (
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
  );
}

/** "pipglyph.com" — pinned bottom-right, or inline inside a column. */
export function OgDomainStamp({
  children = "pipglyph.com",
  inline = false,
}: {
  children?: ReactNode;
  inline?: boolean;
}) {
  return (
    <div
      style={{
        ...(inline ? {} : { position: "absolute", right: 96, bottom: 36 }),
        display: "flex",
        alignItems: "center",
        fontSize: 18,
        color: BRAND.bronze,
        letterSpacing: 2,
        textTransform: "uppercase",
      }}
    >
      {children}
    </div>
  );
}

/** The standard left-aligned canvas: glow, pip strip, lockup, content,
 *  domain stamp. */
export function OgShell({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "64px 96px",
        gap: 22,
        background: OG_BACKGROUND,
        color: BRAND.foreground,
        fontFamily: OG_FONT,
        position: "relative",
        overflow: "hidden",
      }}
    >
      <OgGlow top={-120} left={-80} />
      <OgPipStrip />
      <BrandLockup />
      {children}
      <OgDomainStamp />
    </div>
  );
}

export function OgEyebrow({ children }: { children: ReactNode }) {
  return (
    <span
      style={{
        fontSize: 22,
        letterSpacing: 4,
        textTransform: "uppercase",
        color: BRAND.purple,
        fontWeight: 600,
      }}
    >
      {children}
    </span>
  );
}

/** Pill chip for tags / status rows. */
export function OgChip({
  children,
  tone = "gold",
}: {
  children: ReactNode;
  tone?: "gold" | "muted";
}) {
  const palette =
    tone === "gold"
      ? { border: BRAND.gold, color: BRAND.gold, bg: "rgba(216,178,110,0.12)" }
      : { border: "#3a4256", color: BRAND.muted, bg: "rgba(154,163,181,0.10)" };
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        padding: "10px 22px",
        borderRadius: 999,
        border: `2px solid ${palette.border}`,
        background: palette.bg,
        color: palette.color,
        fontSize: 24,
        fontWeight: 600,
      }}
    >
      {children}
    </div>
  );
}

/** Headline with a length-aware font size so long titles stay inside the
 *  canvas instead of overflowing it. */
export function OgTitle({ text }: { text: string }) {
  const fontSize = text.length > 52 ? 48 : text.length > 30 ? 60 : 76;
  return (
    <h1
      style={{
        margin: 0,
        display: "flex",
        fontSize,
        lineHeight: 1.08,
        letterSpacing: -1.5,
        fontWeight: 700,
        maxWidth: 1000,
      }}
    >
      {text}
    </h1>
  );
}

/** Secondary copy under the title — descriptions ("muted") and bylines
 *  ("dim"). */
export function OgBody({
  children,
  tone = "muted",
  maxWidth = 880,
}: {
  children: ReactNode;
  tone?: "muted" | "dim";
  maxWidth?: number;
}) {
  return (
    <p
      style={{
        margin: 0,
        fontSize: tone === "dim" ? 24 : 26,
        lineHeight: 1.45,
        color: tone === "dim" ? BRAND.dim : BRAND.muted,
        maxWidth,
      }}
    >
      {children}
    </p>
  );
}

/** Full-bleed cover with a legibility scrim and the title block — deck and
 *  set pages that have an uploaded cover. `cover` is a data URI
 *  (fetchImageAsDataUri); Satori must never fetch mid-render. */
export function OgCoverHero({
  cover,
  eyebrow,
  title,
  byline,
}: {
  cover: string;
  eyebrow: string;
  title: string;
  byline: string;
}) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        position: "relative",
        fontFamily: OG_FONT,
        background: BRAND.navy,
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={cover}
        alt=""
        width={OG_SIZE.width}
        height={OG_SIZE.height}
        style={{ objectFit: "cover" }}
      />
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: 320,
          display: "flex",
          background:
            "linear-gradient(180deg, rgba(13,19,32,0) 0%, rgba(13,19,32,0.92) 70%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 72,
          right: 72,
          bottom: 48,
          display: "flex",
          flexDirection: "column",
          gap: 10,
          color: BRAND.foreground,
        }}
      >
        <span
          style={{
            fontSize: 20,
            letterSpacing: 4,
            textTransform: "uppercase",
            color: BRAND.gold,
            fontWeight: 600,
          }}
        >
          {eyebrow}
        </span>
        <span
          style={{
            fontSize: title.length > 36 ? 52 : 64,
            fontWeight: 700,
            lineHeight: 1.08,
            letterSpacing: -1,
          }}
        >
          {title}
        </span>
        <span style={{ fontSize: 24, color: BRAND.muted }}>{byline}</span>
      </div>
    </div>
  );
}
