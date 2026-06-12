import { ImageResponse } from "next/og";

// Site-wide Open Graph image for PipGlyph — used as the social preview on
// any page that doesn't define its own (gallery, profiles, legal pages).
// Individual card pages have their own /api/cards/[id]/og asset.

export const alt = "PipGlyph — Precision tools for legendary ideas.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const runtime = "edge";

// WUBRG mana color dots for the decorative motif
const MANA_PIPS = [
  { color: "#f0ede0", label: "W" }, // White
  { color: "#4a90d9", label: "U" }, // Blue
  { color: "#9b72cf", label: "B" }, // Black
  { color: "#e05252", label: "R" }, // Red
  { color: "#4caf72", label: "G" }, // Green
];

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          justifyContent: "center",
          padding: "72px 96px",
          gap: 20,
          background:
            "linear-gradient(135deg, #0d1320 0%, #1a2030 50%, #0d1320 100%)",
          color: "#f2f3f5",
          fontFamily: "system-ui, sans-serif",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Decorative radial glow — purple tinted */}
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

        {/* WUBRG pip strip — decorative bottom bar */}
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

        {/* Brand lockup — compass-star mark + wordmark */}
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div
            style={{
              width: 64,
              height: 64,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "#111827",
              borderRadius: 14,
              border: "2px solid #d8b26e",
            }}
          >
            <svg width="40" height="40" viewBox="0 0 32 32" fill="none">
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
              fontSize: 30,
              letterSpacing: 5,
              textTransform: "uppercase",
              color: "#d8b26e",
              fontWeight: 600,
            }}
          >
            PipGlyph
          </span>
        </div>

        {/* Main headline — explicit column flex; Satori won't reliably break
            a display:block span inside flowing h1 text. */}
        <h1
          style={{
            margin: 0,
            display: "flex",
            flexDirection: "column",
            fontSize: 80,
            lineHeight: 1.06,
            letterSpacing: -2,
            fontWeight: 700,
            maxWidth: 980,
          }}
        >
          <span>Custom MTG cards</span>
          <span
            style={{
              backgroundImage:
                "linear-gradient(90deg, #d8b26e 0%, #b794e6 60%, #8e72c9 100%)",
              backgroundClip: "text",
              color: "transparent",
            }}
          >
            with perfect pips.
          </span>
        </h1>

        {/* Sub-copy */}
        <p
          style={{
            margin: 0,
            fontSize: 26,
            lineHeight: 1.45,
            color: "#9aa3b5",
            maxWidth: 760,
          }}
        >
          Precision mana pips, advanced text tools, and beautiful frames —
          built for storytellers, deck builders, and worldbuilders.
        </p>

        {/* Mana pips row */}
        <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
          {MANA_PIPS.map((pip) => (
            <div
              key={pip.label}
              style={{
                width: 36,
                height: 36,
                borderRadius: "50%",
                background: pip.color,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 16,
                fontWeight: 900,
                color: pip.label === "W" ? "#1a1420" : "#fff",
                opacity: 0.85,
              }}
            >
              {pip.label}
            </div>
          ))}
        </div>

        {/* Bottom-right domain */}
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
    ),
    size,
  );
}
