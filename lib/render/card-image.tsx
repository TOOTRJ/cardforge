// Server-side card renderer. Uses Next.js `ImageResponse` (Satori +
// resvg-wasm under the hood) so the same JSX produces a PNG you can:
//   * serve as <meta og:image="..."> on public card pages, and
//   * upload to the card-exports bucket on user request.
//
// Satori has limited CSS support — Tailwind classes don't work and not all
// transforms are honored. Every style here is inline + hex-coded so the
// renderer is portable and doesn't pull on the app's CSS variables.

import { ImageResponse } from "next/og";
import type { CardPreviewData } from "@/components/cards/card-preview";

// ---------------------------------------------------------------------------
// Sizing presets — 5:7 card aspect ratio, matching the live preview.
// "default" is good enough for OG/social previews; "hd" is the user-facing
// download default.
// ---------------------------------------------------------------------------

export const RENDER_PRESETS = {
  default: { width: 750, height: 1050 },
  hd: { width: 1500, height: 2100 },
} as const;

export type RenderPreset = keyof typeof RENDER_PRESETS;

// ---------------------------------------------------------------------------
// Theme — hand-picked hex equivalents of the OKLCH tokens in globals.css.
// Updating one place here keeps the export in sync with the live preview.
// ---------------------------------------------------------------------------

const COLORS = {
  background: "#15151d",
  surface: "#1c1c25",
  elevated: "#23232e",
  border: "#3a3a4a",
  borderStrong: "#525266",
  foreground: "#f4f4f5",
  muted: "#a4a4b0",
  subtle: "#71717a",
  primary: "#a78bfa",
  accent: "#fbbf24",
} as const;

const COLOR_GRADIENTS: Record<string, [string, string]> = {
  white: ["#fde68a44", "#fef3c722"],
  blue: ["#38bdf844", "#7dd3fc22"],
  black: ["#3f3f46", "#71717a22"],
  red: ["#fb718544", "#fda4af22"],
  green: ["#34d39944", "#86efac22"],
  multicolor: ["#e879f944", "#fbbf2422"],
  colorless: ["#94a3b833", "#94a3b822"],
};

const RARITY_DOT: Record<string, string> = {
  common: "#d4d4d8",
  uncommon: "#7dd3fc",
  rare: "#fcd34d",
  mythic: "#fb923c",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function capitalize(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : "";
}

function buildTypeLine(card: CardPreviewData): string {
  const left = [card.supertype, card.cardType ? capitalize(card.cardType) : null]
    .filter(Boolean)
    .join(" ");
  const right = card.subtypes?.filter(Boolean).join(" ") ?? "";
  if (left && right) return `${left} — ${right}`;
  return left || right || "Type";
}

function pickGradient(colors: string[] | undefined): [string, string] {
  if (!colors || colors.length === 0) return COLOR_GRADIENTS.colorless;
  if (colors.length > 1) return COLOR_GRADIENTS.multicolor;
  return COLOR_GRADIENTS[colors[0]] ?? COLOR_GRADIENTS.colorless;
}

function showsPowerToughness(cardType: string | null | undefined): boolean {
  return cardType === "creature" || cardType === "token";
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

// ---------------------------------------------------------------------------
// JSX layout — mirrors CardPreview's structure but uses inline styles only.
// ---------------------------------------------------------------------------

function CardImage({ card }: { card: CardPreviewData }) {
  const title = (card.title?.trim() || "Untitled Card").slice(0, 80);
  const showCost = card.cardType !== "land" && card.cost?.trim();
  const showPT = showsPowerToughness(card.cardType) && (card.power || card.toughness);
  const showLoyalty = card.rarity === "mythic" && Boolean(card.loyalty);
  const showDefense = Boolean(card.defense);
  const [gradFrom, gradTo] = pickGradient(card.colorIdentity);
  const focalX = clamp(card.artPosition?.focalX ?? 0.5, 0, 1) * 100;
  const focalY = clamp(card.artPosition?.focalY ?? 0.5, 0, 1) * 100;
  const scale = clamp(card.artPosition?.scale ?? 1, 0.5, 4);

  const typeLine = buildTypeLine(card);
  const rarityColor = card.rarity ? RARITY_DOT[card.rarity] : null;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        background: `linear-gradient(135deg, ${COLORS.elevated}, ${COLORS.surface}, ${COLORS.background})`,
        padding: 18,
        boxSizing: "border-box",
        fontFamily: '"Geist", "Inter", system-ui, sans-serif',
        color: COLORS.foreground,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          padding: 14,
          borderRadius: 22,
          background: `${COLORS.background}66`,
          border: `1px solid ${COLORS.border}99`,
          gap: 10,
        }}
      >
        {/* Title bar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "10px 18px",
            borderRadius: 10,
            background: `${COLORS.surface}cc`,
            border: `1px solid ${COLORS.border}66`,
          }}
        >
          <span
            style={{
              fontSize: 28,
              fontWeight: 600,
              letterSpacing: 0.4,
              color: COLORS.foreground,
              maxWidth: "75%",
              overflow: "hidden",
              whiteSpace: "nowrap",
              textOverflow: "ellipsis",
            }}
          >
            {title}
          </span>
          {showCost ? (
            <span
              style={{
                display: "flex",
                alignItems: "center",
                fontFamily: '"Geist Mono", ui-monospace, monospace',
                fontSize: 16,
                color: COLORS.muted,
                background: COLORS.elevated,
                border: `1px solid ${COLORS.border}99`,
                borderRadius: 9999,
                padding: "4px 12px",
                letterSpacing: 1,
                textTransform: "uppercase",
              }}
            >
              {card.cost}
            </span>
          ) : null}
        </div>

        {/* Art well */}
        <div
          style={{
            display: "flex",
            position: "relative",
            flex: 1,
            borderRadius: 10,
            overflow: "hidden",
            border: `1px solid ${COLORS.border}66`,
            background: `linear-gradient(to bottom, ${gradFrom}, ${gradTo}, ${COLORS.background}cc)`,
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          {card.artUrl ? (
            // next/og's Satori renderer does not support `next/image` — only
            // a plain `<img>` element is allowed inside ImageResponse JSX.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={card.artUrl}
              width={1500}
              height={1050}
              alt=""
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                objectPosition: `${focalX}% ${focalY}%`,
                transform: `scale(${scale})`,
                transformOrigin: `${focalX}% ${focalY}%`,
              }}
            />
          ) : (
            <span
              style={{
                fontSize: 14,
                letterSpacing: 4,
                textTransform: "uppercase",
                color: COLORS.subtle,
              }}
            >
              Artwork preview
            </span>
          )}
        </div>

        {/* Type line */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "8px 16px",
            borderRadius: 10,
            background: `${COLORS.surface}cc`,
            border: `1px solid ${COLORS.border}66`,
            color: COLORS.muted,
            fontSize: 18,
          }}
        >
          <span
            style={{
              maxWidth: "85%",
              overflow: "hidden",
              whiteSpace: "nowrap",
              textOverflow: "ellipsis",
            }}
          >
            {typeLine}
          </span>
          {rarityColor ? (
            <span
              style={{
                width: 12,
                height: 12,
                borderRadius: 9999,
                background: rarityColor,
                display: "block",
              }}
            />
          ) : null}
        </div>

        {/* Rules + flavor */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            padding: "12px 16px",
            borderRadius: 10,
            background: `${COLORS.surface}99`,
            border: `1px solid ${COLORS.border}66`,
            color: COLORS.muted,
            fontSize: 18,
            lineHeight: 1.45,
            gap: 10,
          }}
        >
          {card.rulesText?.trim() ? (
            <p
              style={{
                margin: 0,
                whiteSpace: "pre-wrap",
                color: COLORS.foreground,
              }}
            >
              {card.rulesText}
            </p>
          ) : (
            <span style={{ fontStyle: "italic", color: COLORS.subtle }}>
              Rules text appears here.
            </span>
          )}

          {card.flavorText?.trim() ? (
            <p
              style={{
                margin: 0,
                paddingTop: 10,
                borderTop: `1px solid ${COLORS.border}66`,
                fontStyle: "italic",
                color: COLORS.subtle,
              }}
            >
              {card.flavorText}
            </p>
          ) : null}

          {(showPT || showLoyalty || showDefense) && (
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 8,
                marginTop: "auto",
                paddingTop: 10,
                borderTop: `1px solid ${COLORS.border}66`,
              }}
            >
              {showPT ? (
                <Pill
                  label="P/T"
                  value={`${card.power ?? "—"} / ${card.toughness ?? "—"}`}
                />
              ) : null}
              {showLoyalty ? (
                <Pill label="Loyalty" value={card.loyalty ?? "—"} />
              ) : null}
              {showDefense ? (
                <Pill label="Defense" value={card.defense ?? "—"} />
              ) : null}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontSize: 12,
            letterSpacing: 2,
            textTransform: "uppercase",
            color: COLORS.subtle,
          }}
        >
          <span style={{ maxWidth: "70%", overflow: "hidden" }}>
            {card.artistCredit?.trim()
              ? `Art: ${card.artistCredit}`
              : "Art: Unknown"}
          </span>
          <span>CardForge</span>
        </div>
      </div>
    </div>
  );
}

function Pill({ label, value }: { label: string; value: string }) {
  return (
    <span
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 10px",
        borderRadius: 9999,
        border: `1px solid ${COLORS.border}99`,
        background: `${COLORS.elevated}cc`,
        color: COLORS.foreground,
        fontFamily: '"Geist Mono", ui-monospace, monospace',
        fontSize: 14,
        letterSpacing: 1,
        textTransform: "uppercase",
      }}
    >
      <span style={{ color: COLORS.subtle }}>{label}</span>
      <span>{value}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Public renderer
// ---------------------------------------------------------------------------

export function renderCardImage(
  card: CardPreviewData,
  preset: RenderPreset = "default",
): ImageResponse {
  const { width, height } = RENDER_PRESETS[preset];
  return new ImageResponse(<CardImage card={card} />, {
    width,
    height,
  });
}
