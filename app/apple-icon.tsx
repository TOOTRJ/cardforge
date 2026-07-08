import { ImageResponse } from "next/og";
import { BRAND } from "@/lib/brand/constants";
import { AstralRose } from "@/lib/brand/glyph";

// Apple touch icon — solid navy square (iOS applies its own corner mask,
// so no transparency and no border radius), Astral Rose at ~62% with
// generous padding.

export const size = { width: 180, height: 180 };
export const contentType = "image/png";
export const runtime = "edge";

export default function AppleIcon() {
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
        }}
      >
        <AstralRose size={112} />
      </div>
    ),
    size,
  );
}
