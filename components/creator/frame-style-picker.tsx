"use client";

// ---------------------------------------------------------------------------
// FrameStylePicker
//
// Replaces the two raw dropdowns (border + accent) with named preset chips.
// Each preset maps to a canonical { border, accent } FrameStyle pair.
//
// Presets:
//   Classic   — thin border, neutral accent  (safe default)
//   Modern    — thick border, cool accent    (crisp, high-contrast)
//   Showcase  — ornate border, warm accent   (premium treatment)
//   Promo     — thin border, warm accent     (event / special feel)
// ---------------------------------------------------------------------------

import { cn } from "@/lib/utils";
import type { FrameStyle } from "@/types/card";

export type FramePresetKey = "classic" | "modern" | "showcase" | "promo";

export type FramePreset = {
  key: FramePresetKey;
  label: string;
  description: string;
  style: Required<FrameStyle>;
};

export const FRAME_PRESETS: FramePreset[] = [
  {
    key: "classic",
    label: "Classic",
    description: "Clean border, neutral tone.",
    style: { border: "thin", accent: "neutral" },
  },
  {
    key: "modern",
    label: "Modern",
    description: "Bold border, cool blue edge.",
    style: { border: "thick", accent: "cool" },
  },
  {
    key: "showcase",
    label: "Showcase",
    description: "Ornate border, warm gold edge.",
    style: { border: "ornate", accent: "warm" },
  },
  {
    key: "promo",
    label: "Promo",
    description: "Slim border, warm accent.",
    style: { border: "thin", accent: "warm" },
  },
];

// Reverse lookup: given a FrameStyle, return the matching preset key (or null
// if none matches — lets us still display custom values gracefully).
export function styleToPreset(style: FrameStyle): FramePresetKey | null {
  const match = FRAME_PRESETS.find(
    (p) => p.style.border === style.border && p.style.accent === style.accent,
  );
  return match?.key ?? null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FrameStylePicker({
  value,
  onChange,
}: {
  value: FrameStyle;
  onChange: (next: FrameStyle) => void;
}) {
  const activeKey = styleToPreset(value);

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {FRAME_PRESETS.map((preset) => {
        const active = activeKey === preset.key;
        return (
          <button
            key={preset.key}
            type="button"
            onClick={() => onChange(preset.style)}
            aria-pressed={active}
            className={cn(
              "flex flex-col gap-1 rounded-lg border bg-background/40 p-3 text-left transition-colors",
              active
                ? "border-primary bg-primary/10"
                : "border-border hover:border-border-strong",
            )}
          >
            {/* Mini frame thumbnail */}
            <FrameThumbnail preset={preset} active={active} />
            <span className="mt-1 text-xs font-semibold text-foreground">
              {preset.label}
            </span>
            <span className="text-[10px] leading-4 text-muted">
              {preset.description}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small visual thumbnail representing the frame style
// ---------------------------------------------------------------------------

const ACCENT_COLOR: Record<string, string> = {
  neutral: "border-border-strong/80",
  cool: "border-primary/70",
  warm: "border-accent/70",
};

const BORDER_THICKNESS: Record<string, string> = {
  thin: "border",
  thick: "border-2",
  ornate: "border-[3px]",
};

function FrameThumbnail({
  preset,
  active,
}: {
  preset: FramePreset;
  active: boolean;
}) {
  const borderClass = BORDER_THICKNESS[preset.style.border];
  const accentClass = ACCENT_COLOR[preset.style.accent];

  return (
    <div
      className={cn(
        "h-10 w-full rounded-sm bg-elevated",
        borderClass,
        accentClass,
        active && "shadow-[0_0_8px_-2px_var(--color-primary)]",
      )}
      aria-hidden
    >
      {/* Decorative inner lines mimicking card zones */}
      <div className="flex h-full flex-col gap-1 p-1 opacity-40">
        <div className="h-1.5 w-3/4 rounded-full bg-foreground/40" />
        <div className="flex-1 rounded-sm bg-foreground/10" />
        <div className="h-1 w-1/2 rounded-full bg-foreground/30" />
      </div>
    </div>
  );
}
