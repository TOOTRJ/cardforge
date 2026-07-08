import type { ReactNode } from "react";
import { BRAND, MANA_PIPS, OG_SIZE } from "@/lib/brand/constants";
import { BrandMarkTile } from "@/lib/brand/glyph";

// ---------------------------------------------------------------------------
// Shared chrome for dynamic Open Graph images (challenge / set / profile
// fallbacks). Mirrors the visual language of the site-wide
// app/opengraph-image.tsx: dark gradient, gold brand lockup, WUBRG pip
// strip. Rendered by Satori via next/og — every multi-child <div> must
// declare display:flex, and colors are literal (no CSS variables); the
// brand literals live in lib/brand/constants.
// ---------------------------------------------------------------------------

export { MANA_PIPS, OG_SIZE };

/** Fetch a remote image into a data URI so Satori never does its own
 *  network fetch (which would fail the whole render on a dead URL).
 *  Returns null on any failure — callers fall back to branded chrome. */
export async function fetchImageAsDataUri(
  url: string,
): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "image/png";
    if (!contentType.startsWith("image/")) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    return `data:${contentType};base64,${buffer.toString("base64")}`;
  } catch {
    return null;
  }
}

export function BrandLockup() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
      <BrandMarkTile size={56} />
      <span
        style={{
          fontSize: 26,
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
        background:
          `linear-gradient(135deg, ${BRAND.navy} 0%, ${BRAND.surface} 50%, ${BRAND.navy} 100%)`,
        color: BRAND.foreground,
        fontFamily: "system-ui, sans-serif",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: -120,
          left: -80,
          width: 600,
          height: 600,
          borderRadius: "50%",
          background:
            "radial-gradient(circle, rgba(107,77,154,0.28) 0%, transparent 70%)",
          display: "flex",
        }}
      />
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

      <BrandLockup />

      {children}

      <div
        style={{
          position: "absolute",
          right: 96,
          bottom: 36,
          display: "flex",
          alignItems: "center",
          fontSize: 18,
          color: BRAND.bronze,
          letterSpacing: 2,
          textTransform: "uppercase",
        }}
      >
        pipglyph.com
      </div>
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
