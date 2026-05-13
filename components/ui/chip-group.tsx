"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// ChipGroup — a horizontal row of toggle chips. Generic over the value type
// so it can drive any enum-like select. Replaces our many bespoke <select>
// fields with something visually consistent with the existing color and
// visibility pickers.
//
// Single-select today; if we need multi-select later we can add a
// `multiSelect` prop and switch the chip role to "checkbox" — the rest of
// the markup is the same.
// ---------------------------------------------------------------------------

export type ChipOption<T extends string> = {
  value: T;
  label: string;
  description?: string;
  /** Lucide-style icon component. Optional. */
  icon?: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  /** Inline element (e.g. swatch dot, gem SVG) rendered before the label. */
  leading?: ReactNode;
  /** Active-state tint class. Falls back to the primary color. */
  activeClass?: string;
};

type ChipGroupProps<T extends string> = {
  value: T | null | "";
  onChange: (next: T) => void;
  options: ChipOption<T>[];
  /** Optional CSS grid layout. Defaults to a flex-wrap row. */
  layout?: "wrap" | "grid-2" | "grid-3" | "grid-4";
  /** Render as larger card-style chips (with description). */
  size?: "sm" | "md";
  className?: string;
  ariaLabel?: string;
};

const LAYOUT_CLASS: Record<NonNullable<ChipGroupProps<string>["layout"]>, string> = {
  wrap: "flex flex-wrap gap-2",
  "grid-2": "grid grid-cols-2 gap-2",
  "grid-3": "grid grid-cols-2 sm:grid-cols-3 gap-2",
  "grid-4": "grid grid-cols-2 sm:grid-cols-4 gap-2",
};

export function ChipGroup<T extends string>({
  value,
  onChange,
  options,
  layout = "wrap",
  size = "sm",
  className,
  ariaLabel,
}: ChipGroupProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(LAYOUT_CLASS[layout], className)}
    >
      {options.map((option) => {
        const active = option.value === value;
        const Icon = option.icon;
        const activeClass = option.activeClass ?? "border-primary bg-primary/15 text-primary";
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "group/chip flex items-center gap-2 rounded-md border bg-elevated/60 text-left transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              size === "sm"
                ? "px-3 py-1.5 text-xs font-medium"
                : "px-3 py-2.5 text-sm",
              active
                ? activeClass
                : "border-border text-muted hover:border-border-strong hover:text-foreground",
            )}
          >
            {option.leading ? (
              <span className="shrink-0">{option.leading}</span>
            ) : null}
            {Icon ? (
              <Icon
                className={cn(
                  "h-3.5 w-3.5",
                  active ? "" : "text-subtle group-hover/chip:text-muted",
                )}
                aria-hidden
              />
            ) : null}
            <span className="flex flex-col">
              <span className="capitalize">{option.label}</span>
              {option.description && size === "md" ? (
                <span
                  className={cn(
                    "text-[11px] font-normal normal-case leading-4",
                    active ? "text-foreground/80" : "text-subtle",
                  )}
                >
                  {option.description}
                </span>
              ) : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}
