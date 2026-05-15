import { ImageResponse } from "next/og";

// Site-wide Open Graph image for Spellwright — used as the social preview on
// any page that doesn't define its own (gallery, profiles, legal pages).
// Individual card pages have their own /api/cards/[id]/og asset.

export const alt = "Spellwright — Custom MTG Card Creator";
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
            "linear-gradient(135deg, #13121a 0%, #1c1828 50%, #13121a 100%)",
          color: "#f0eadc",
          fontFamily: "system-ui, sans-serif",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Decorative radial glow — gold tinted */}
        <div
          style={{
            position: "absolute",
            top: -120,
            left: -80,
            width: 600,
            height: 600,
            borderRadius: "50%",
            background:
              "radial-gradient(circle, rgba(200,168,75,0.18) 0%, transparent 70%)",
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

        {/* Brand lockup — pentagon icon + wordmark */}
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          {/* Pentagon icon mark */}
          <div
            style={{
              width: 64,
              height: 64,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "#1e1b2a",
              borderRadius: 14,
              border: "2px solid #c8a84b",
            }}
          >
            <svg width="40" height="40" viewBox="0 0 32 32" fill="none">
              <polygon
                points="16,2 29,11 24,27 8,27 3,11"
                fill="#1e1b2a"
                stroke="#c8a84b"
                strokeWidth="1.5"
              />
              <line x1="16" y1="7" x2="16" y2="22" stroke="#c8a84b" strokeWidth="1.6" strokeLinecap="round" />
              <line x1="16" y1="22" x2="11" y2="19" stroke="#c8a84b" strokeWidth="1.4" strokeLinecap="round" />
              <line x1="16" y1="22" x2="21" y2="19" stroke="#c8a84b" strokeWidth="1.4" strokeLinecap="round" />
              <path d="M16 9 Q10 12 12 17" stroke="#e8c96b" strokeWidth="1.1" strokeLinecap="round" fill="none" opacity="0.75" />
              <path d="M16 9 Q22 12 20 17" stroke="#e8c96b" strokeWidth="1.1" strokeLinecap="round" fill="none" opacity="0.75" />
            </svg>
          </div>
          <span
            style={{
              fontSize: 30,
              letterSpacing: 5,
              textTransform: "uppercase",
              color: "#c8a84b",
              fontWeight: 600,
            }}
          >
            Spellwright
          </span>
        </div>

        {/* Main headline */}
        <h1
          style={{
            margin: 0,
            fontSize: 84,
            lineHeight: 1.06,
            letterSpacing: -2,
            fontWeight: 700,
            maxWidth: 900,
          }}
        >
          Design your own
          <span
            style={{
              display: "block",
              backgroundImage:
                "linear-gradient(90deg, #e8c96b 0%, #c8a84b 40%, #9b72cf 100%)",
              backgroundClip: "text",
              color: "transparent",
            }}
          >
            Magic cards.
          </span>
        </h1>

        {/* Sub-copy */}
        <p
          style={{
            margin: 0,
            fontSize: 26,
            lineHeight: 1.45,
            color: "#8a7a6a",
            maxWidth: 720,
          }}
        >
          Creatures, instants, planeswalkers, full sets — built by fans, for
          fans. No account required to start.
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
            color: "#4a3a2a",
            letterSpacing: 2,
            textTransform: "uppercase",
          }}
        >
          spellwright.gg
        </div>
      </div>
    ),
    size,
  );
}
