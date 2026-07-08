import { BRAND, MANA_PIPS } from "@/lib/brand/constants";
import { BrandMarkTile } from "@/lib/brand/glyph";

// ---------------------------------------------------------------------------
// The site-wide social card body, shared by app/opengraph-image.tsx and
// app/twitter-image.tsx (thin ImageResponse shells). Satori rules apply:
// display:flex on every multi-child <div>, literal colors from BRAND.
// ---------------------------------------------------------------------------

export const HOME_OG_ALT = "PipGlyph — Precision tools for legendary ideas.";

export function HomeOgCard() {
  return (
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
        background: `linear-gradient(135deg, ${BRAND.navy} 0%, ${BRAND.surface} 50%, ${BRAND.navy} 100%)`,
        color: BRAND.foreground,
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

      {/* Brand lockup — Astral Rose mark + wordmark */}
      <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
        <BrandMarkTile size={64} />
        <span
          style={{
            fontSize: 30,
            letterSpacing: 5,
            textTransform: "uppercase",
            color: BRAND.gold,
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
            backgroundImage: `linear-gradient(90deg, ${BRAND.gold} 0%, ${BRAND.lilac} 60%, ${BRAND.purple} 100%)`,
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
          color: BRAND.muted,
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
