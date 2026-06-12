import type { ReactNode } from "react";

// ---------------------------------------------------------------------------
// Shared chrome for dynamic Open Graph images (challenge / set / profile
// fallbacks). Mirrors the visual language of the site-wide
// app/opengraph-image.tsx: dark gradient, gold brand lockup, WUBRG pip
// strip. Rendered by Satori via next/og — every multi-child <div> must
// declare display:flex, and colors are literal (no CSS variables).
// ---------------------------------------------------------------------------

export const OG_SIZE = { width: 1200, height: 630 };

export const MANA_PIPS = [
  { color: "#f0ede0", label: "W" },
  { color: "#4a90d9", label: "U" },
  { color: "#9b72cf", label: "B" },
  { color: "#e05252", label: "R" },
  { color: "#4caf72", label: "G" },
];

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
      <div
        style={{
          width: 56,
          height: 56,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#111827",
          borderRadius: 12,
          border: "2px solid #d8b26e",
        }}
      >
        <svg width="34" height="34" viewBox="0 0 32 32" fill="none">
          <circle
            cx="16"
            cy="16"
            r="13.5"
            stroke="#d8b26e"
            strokeWidth="1.2"
            opacity="0.55"
          />
          <path
            d="M16 3.4 L18.3 13.7 L28.6 16 L18.3 18.3 L16 28.6 L13.7 18.3 L3.4 16 L13.7 13.7 Z"
            fill="#d8b26e"
          />
          <path
            d="M22.2 9.8 L24.4 7.6 M9.8 22.2 L7.6 24.4 M22.2 22.2 L24.4 24.4 M9.8 9.8 L7.6 7.6"
            stroke="#8e72c9"
            strokeWidth="1.5"
            strokeLinecap="round"
            opacity="0.9"
          />
        </svg>
      </div>
      <span
        style={{
          fontSize: 26,
          letterSpacing: 5,
          textTransform: "uppercase",
          color: "#d8b26e",
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
          "linear-gradient(135deg, #0d1320 0%, #1a2030 50%, #0d1320 100%)",
        color: "#f2f3f5",
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
          color: "#6e6248",
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
        color: "#8e72c9",
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
      ? { border: "#d8b26e", color: "#d8b26e", bg: "rgba(216,178,110,0.12)" }
      : { border: "#3a4256", color: "#9aa3b5", bg: "rgba(154,163,181,0.10)" };
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
