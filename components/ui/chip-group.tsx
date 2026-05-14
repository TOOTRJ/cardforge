"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// ChipGroup — a row of toggle chips. Two modes:
//
//   1. Single-select (default): radio-group semantics. `value` is one of T.
//   2. Multi-select: checkbox semantics. `value` is an array of T.
//
// The two modes use a discriminated union on the `multiSelect` prop so the
// TypeScript compiler picks the correct `value` / `onChange` signature.
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

type Layout = "wrap" | "grid-2" | "grid-3" | "grid-4";
type Size = "sm" | "md";

type CommonProps<T extends string> = {
  options: ChipOption<T>[];
  layout?: Layout;
  size?: Size;
  className?: string;
  ariaLabel?: string;
};

type SingleProps<T extends string> = CommonProps<T> & {
  multiSelect?: false;
  value: T | null | "";
  onChange: (next: T) => void;
};

type MultiProps<T extends string> = CommonProps<T> & {
  multiSelect: true;
  value: T[];
  onChange: (next: T[]) => void;
};

type ChipGroupProps<T extends string> = SingleProps<T> | MultiProps<T>;

const LAYOUT_CLASS: Record<Layout, string> = {
  wrap: "flex flex-wrap gap-2",
  "grid-2": "grid grid-cols-2 gap-2",
  "grid-3": "grid grid-cols-2 sm:grid-cols-3 gap-2",
  "grid-4": "grid grid-cols-2 sm:grid-cols-4 gap-2",
};

function isActive<T extends string>(
  value: ChipGroupProps<T>["value"],
  candidate: T,
  multiSelect: boolean | undefined,
): boolean {
  if (multiSelect) {
    return Array.isArray(value) && value.includes(candidate);
  }
  return value === candidate;
}

export function ChipGroup<T extends string>(props: ChipGroupProps<T>) {
  const {
    options,
    layout = "wrap",
    size = "sm",
    className,
    ariaLabel,
  } = props;
  const multi = props.multiSelect === true;

  const handleClick = (next: T) => {
    if (multi) {
      const current = (props.value as T[]) ?? [];
      const exists = current.includes(next);
      const nextValue = exists
        ? current.filter((v) => v !== next)
        : [...current, next];
      props.onChange(nextValue);
    } else {
      (props.onChange as (next: T) => void)(next);
    }
  };

  return (
    <div
      // Multi-select chips are a row of independent toggles → no radiogroup
      // semantics. Single-select chips behave as a radio group.
      role={multi ? "group" : "radiogroup"}
      aria-label={ariaLabel}
      className={cn(LAYOUT_CLASS[layout], className)}
    >
      {options.map((option) => {
        const active = isActive(props.value, option.value, multi);
        const Icon = option.icon;
        const activeClass =
          option.activeClass ?? "border-primary bg-primary/15 text-primary";
        const ariaProps = multi
          ? { "aria-pressed": active }
          : { "aria-checked": active, role: "radio" as const };
        return (
          <button
            key={option.value}
            type="button"
            {...ariaProps}
            onClick={() => handleClick(option.value)}
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
