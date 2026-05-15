import { ImageResponse } from "next/og";

// Spellwright favicon — pentagon icon mark with quill nib, rendered as a
// flat 32×32 PNG via next/og for browser tabs and shortcut bars.

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
          background: "#13121a",
          borderRadius: 7,
        }}
      >
        {/* SVG pentagon + quill mark */}
        <svg
          width="26"
          height="26"
          viewBox="0 0 32 32"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          {/* Pentagon */}
          <polygon
            points="16,2 29,11 24,27 8,27 3,11"
            fill="#1e1b2a"
            stroke="#c8a84b"
            strokeWidth="1.8"
          />
          {/* Quill barrel */}
          <line x1="16" y1="7" x2="16" y2="22" stroke="#c8a84b" strokeWidth="1.6" strokeLinecap="round" />
          {/* Nib left */}
          <line x1="16" y1="22" x2="11" y2="19" stroke="#c8a84b" strokeWidth="1.4" strokeLinecap="round" />
          {/* Nib right */}
          <line x1="16" y1="22" x2="21" y2="19" stroke="#c8a84b" strokeWidth="1.4" strokeLinecap="round" />
          {/* Vane left */}
          <path d="M16 9 Q10 12 12 17" stroke="#e8c96b" strokeWidth="1.1" strokeLinecap="round" fill="none" opacity="0.7" />
          {/* Vane right */}
          <path d="M16 9 Q22 12 20 17" stroke="#e8c96b" strokeWidth="1.1" strokeLinecap="round" fill="none" opacity="0.7" />
        </svg>
      </div>
    ),
    size,
  );
}
