import { ImageResponse } from "next/og";

// Next.js convention: app/icon.tsx generates the favicon on demand via
// next/og. Same anvil-style mark as the in-app Logo component, but rendered
// as a flat PNG so it shows in browser tabs and shortcut bars.

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
          background: "linear-gradient(135deg, #8b5cf6, #fbbf24)",
          borderRadius: 8,
          color: "#0a0a0f",
          fontSize: 22,
          fontWeight: 700,
          letterSpacing: -1,
          fontFamily: "system-ui, sans-serif",
        }}
      >
        C
      </div>
    ),
    size,
  );
}
