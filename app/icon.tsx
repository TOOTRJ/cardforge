import { ImageResponse } from "next/og";

// PipGlyph favicon — compass-star mark on the deep-navy brand surface,
// rendered as a flat 32×32 PNG via next/og for browser tabs and shortcut
// bars.

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
          background: "#0d1320",
          borderRadius: 7,
        }}
      >
        <svg
          width="26"
          height="26"
          viewBox="0 0 32 32"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          {/* Ring */}
          <circle
            cx="16"
            cy="16"
            r="13.5"
            stroke="#d8b26e"
            strokeWidth="1.4"
            opacity="0.6"
          />
          {/* Cardinal compass star */}
          <path
            d="M16 3.4 L18.3 13.7 L28.6 16 L18.3 18.3 L16 28.6 L13.7 18.3 L3.4 16 L13.7 13.7 Z"
            fill="#d8b26e"
          />
          {/* Ordinal ticks */}
          <path
            d="M22.2 9.8 L24.4 7.6 M9.8 22.2 L7.6 24.4 M22.2 22.2 L24.4 24.4 M9.8 9.8 L7.6 7.6"
            stroke="#8e72c9"
            strokeWidth="1.6"
            strokeLinecap="round"
            opacity="0.9"
          />
        </svg>
      </div>
    ),
    size,
  );
}
