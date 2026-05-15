import { ImageResponse } from "next/og";

// Site-wide Open Graph image, used as the social preview on any page that
// doesn't define its own (i.e. everything except individual cards, which
// already get their own /api/cards/[id]/og asset). The marketing landing,
// gallery, profile, and legal pages all fall through to this.

export const alt = "CardForge — design custom trading cards";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const runtime = "edge";

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
          padding: "80px 96px",
          gap: 24,
          background:
            "linear-gradient(135deg, #15151d 0%, #1a1626 55%, #15151d 100%)",
          color: "#f4f4f5",
          fontFamily: "system-ui, sans-serif",
          position: "relative",
        }}
      >
        {/* Brand pill */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
          }}
        >
          <div
            style={{
              width: 64,
              height: 64,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 14,
              background: "linear-gradient(135deg, #a78bfa, #fbbf24)",
              color: "#0a0a0f",
              fontSize: 36,
              fontWeight: 800,
            }}
          >
            C
          </div>
          <span
            style={{
              fontSize: 28,
              letterSpacing: 4,
              textTransform: "uppercase",
              color: "#a4a4b0",
            }}
          >
            CardForge
          </span>
        </div>

        <h1
          style={{
            margin: 0,
            fontSize: 88,
            lineHeight: 1.05,
            letterSpacing: -2,
            fontWeight: 700,
            maxWidth: 920,
          }}
        >
          Forge custom trading cards
          <span
            style={{
              display: "block",
              backgroundImage:
                "linear-gradient(90deg, #a78bfa, #a78bfa, #fbbf24)",
              backgroundClip: "text",
              color: "transparent",
            }}
          >
            fast, beautiful, yours.
          </span>
        </h1>

        <p
          style={{
            margin: 0,
            fontSize: 28,
            lineHeight: 1.4,
            color: "#a4a4b0",
            maxWidth: 760,
          }}
        >
          A modern platform for designing, sharing, and remixing original
          custom trading cards.
        </p>

        {/* Bottom-right ribbon */}
        <div
          style={{
            position: "absolute",
            right: 96,
            bottom: 64,
            display: "flex",
            alignItems: "center",
            gap: 12,
            fontSize: 18,
            color: "#71717a",
            letterSpacing: 2,
            textTransform: "uppercase",
          }}
        >
          <span>cardforge.app</span>
        </div>
      </div>
    ),
    size,
  );
}
