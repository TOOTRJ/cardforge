"use client";

import { inputClass } from "@/components/creator/field-group";

// Shared style presets + free-text input used by every AI generation panel.

export const AI_STYLE_PRESETS = [
  "Anime",
  "Pixel art",
  "Oil painting",
  "Watercolor",
  "Comic book",
  "Dark fantasy",
];

export function StylePicker({
  value,
  onChange,
  disabled,
  placeholder = "e.g. stained glass",
}: {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5">
        {AI_STYLE_PRESETS.map((preset) => {
          const active = value.toLowerCase() === preset.toLowerCase();
          return (
            <button
              key={preset}
              type="button"
              disabled={disabled}
              onClick={() => onChange(active ? "" : preset)}
              className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                active
                  ? "border-accent/70 bg-accent/15 text-foreground"
                  : "border-border bg-elevated/50 text-muted hover:border-border-strong hover:text-foreground"
              }`}
            >
              {preset}
            </button>
          );
        })}
      </div>
      <input
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        maxLength={200}
        placeholder={placeholder}
        className={inputClass(false)}
        disabled={disabled}
      />
    </div>
  );
}
