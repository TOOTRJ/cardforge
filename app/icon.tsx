import { ImageResponse } from "next/og";
import { BRAND } from "@/lib/brand/constants";
import { AstralRose } from "@/lib/brand/glyph";

// PipGlyph favicon — the Astral Rose (compact detail: ticks and star wake
// are sub-pixel at 32px) on the deep-navy brand chip, rendered as a flat
// PNG via next/og for browser tabs and shortcut bars.

export const size = { width: 32, height: 32 };
export const contentType = "image/png";
export const runtime = "edge";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: BRAND.navy,
          borderRadius: 7,
        }}
      >
        <AstralRose size={28} detail="compact" />
      </div>
    ),
    size,
  );
}
