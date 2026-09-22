import { BRAND, MANA_PIPS } from "@/lib/brand/constants";
import {
  BrandLockup,
  OG_BACKGROUND,
  OG_FONT,
  OgDomainStamp,
  OgGlow,
  OgPipStrip,
} from "@/lib/og/chrome";

// ---------------------------------------------------------------------------
// The site-wide social card body, shared by app/opengraph-image.tsx and
// app/twitter-image.tsx (thin ImageResponse shells on the EDGE runtime —
// hence lib/og/chrome, not lib/og/shell). Satori rules apply: display:flex
// on every multi-child <div>, literal colors from BRAND.
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
        background: OG_BACKGROUND,
        color: BRAND.foreground,
        fontFamily: OG_FONT,
        position: "relative",
        overflow: "hidden",
      }}
    >
      <OgGlow top={-120} left={-80} />
      <OgPipStrip />
      <BrandLockup markSize={64} fontSize={30} gap={18} />

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

      <OgDomainStamp />
    </div>
  );
}
