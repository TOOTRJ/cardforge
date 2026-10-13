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
//
// Keyboard (TODO 3b.10):
//   * A chip that cannot be picked is `aria-disabled`, never `disabled`: it
//     stays reachable, so a keyboard or screen-reader user finds it and hears
//     why (its description / badge are part of its name). It ignores clicks.
//   * A single-select row is ONE tab stop — the picked chip, or the first
//     when none is picked (roving tabindex). The arrow keys, Home and End
//     move the FOCUS between its chips, wrapping; Space or Enter picks the
//     focused one. The arrows do not pick by themselves: several of these
//     rows change the whole card on a pick (its kind, its frame), which must
//     not happen while someone is only reading the choices.
//   * A multi-select row is independent toggles: every chip is a tab stop.
// ---------------------------------------------------------------------------

export type ChipOption<T extends string> = {
  value: T;
  label: string;
  description?: string;
  /** Lucide-style icon component. Optional. */
  icon?: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  /** Inline element (e.g. swatch dot, gem SVG) rendered before the label. */
  leading?: ReactNode;
  /** Trailing element pinned to the right edge (e.g. a "Soon" badge). */
  badge?: ReactNode;
  /** Non-selectable chip — dimmed, ignores clicks (e.g. roadmap "coming soon"
   *  frames). Still rendered so users can see what's coming. */
  disabled?: boolean;
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
  /** Id(s) of the helper / error text that describes the row. */
  ariaDescribedBy?: string;
  /** The row's value was refused (a field error). Single-select only. */
  ariaInvalid?: boolean;
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
    ariaDescribedBy,
    ariaInvalid,
  } = props;
  const multi = props.multiSelect === true;
  // Single-select: the one chip Tab lands on.
  const tabStop = multi
    ? null
    : (options.find((option) => isActive(props.value, option.value, false)) ?? options[0])?.value;

  const moveFocus = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const step =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    if (step === 0 && event.key !== "Home" && event.key !== "End") return;
    const chips = [...event.currentTarget.querySelectorAll<HTMLElement>(":scope > [role='radio']")];
    const from = chips.indexOf(event.target as HTMLElement);
    if (from < 0) return;
    const to =
      event.key === "Home" ? 0 : event.key === "End" ? chips.length - 1 : (from + step + chips.length) % chips.length;
    event.preventDefault();
    chips[to]?.focus();
  };

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
      // semantics. Single-select chips behave as a radio group. A toggle row
      // nobody named is no group at all: an unnamed group is only noise.
      role={multi ? (ariaLabel ? "group" : undefined) : "radiogroup"}
      aria-label={ariaLabel}
      aria-describedby={ariaDescribedBy}
      aria-invalid={!multi && ariaInvalid ? true : undefined}
      onKeyDown={multi ? undefined : moveFocus}
      className={cn(LAYOUT_CLASS[layout], className)}
    >
      {options.map((option) => {
        const active = isActive(props.value, option.value, multi);
        const disabled = option.disabled === true;
        const Icon = option.icon;
        const activeClass =
          option.activeClass ?? "border-primary bg-primary/15 text-primary-bright";
        const ariaProps = multi
          ? { "aria-pressed": active }
          : { "aria-checked": active, role: "radio" as const };
        return (
          <button
            key={option.value}
            type="button"
            aria-disabled={disabled ? true : undefined}
            tabIndex={multi || option.value === tabStop ? undefined : -1}
            {...ariaProps}
            onClick={disabled ? undefined : () => handleClick(option.value)}
            className={cn(
              "group/chip flex items-center gap-2 rounded-md border bg-elevated/60 text-left transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              size === "sm"
                ? "px-3 py-1.5 text-xs font-medium"
                : "px-3 py-2.5 text-sm",
              disabled
                ? "cursor-not-allowed border-border/60 text-subtle opacity-55"
                : active
                  ? activeClass
                  : "border-border text-muted hover:border-border-strong hover:text-foreground",
            )}
          >
            {option.leading ? (
              <span className={cn("shrink-0", disabled && "opacity-60")}>
                {option.leading}
              </span>
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
            {option.badge ? (
              <span className="ml-auto shrink-0 pl-1">{option.badge}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
