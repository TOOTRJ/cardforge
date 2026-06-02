"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Stepper — a presentational, fully-controlled step indicator. It owns NO state
// and no validation: the parent passes the active index and decides which steps
// can be jumped to. Two responsive layouts from one set of props:
//
//   • Desktop (sm+): a horizontal rail of numbered markers + labels joined by
//     connectors, with complete / active / upcoming / error states.
//   • Mobile (<sm): a compact "Step X of N · Label" header + a segmented
//     progress bar (Back/Next live in the form's sticky action bar).
// ---------------------------------------------------------------------------

export type StepperStep = {
  key: string;
  label: string;
  description?: string;
  hasError?: boolean;
};

type StepperProps = {
  steps: StepperStep[];
  /** Active step index. */
  current: number;
  /** Jump to a step. When omitted, markers are not clickable. */
  onStepSelect?: (index: number) => void;
  /** Whether a step can be jumped to. Defaults to "already visited" (index ≤
   *  current) so the flow stays linear unless the parent opts into free jumps. */
  isStepEnabled?: (index: number) => boolean;
  className?: string;
};

type StepState = "complete" | "active" | "upcoming" | "error";

export function Stepper({
  steps,
  current,
  onStepSelect,
  isStepEnabled,
  className,
}: StepperProps) {
  const total = steps.length;
  const active = steps[current];
  const enabled = (i: number) =>
    isStepEnabled ? isStepEnabled(i) : i <= current;

  const stateOf = (i: number, step: StepperStep): StepState =>
    step.hasError && i !== current
      ? "error"
      : i < current
        ? "complete"
        : i === current
          ? "active"
          : "upcoming";

  return (
    <div className={className}>
      {/* Desktop rail */}
      <ol className="hidden items-start sm:flex">
        {steps.map((step, i) => {
          const state = stateOf(i, step);
          const canSelect = Boolean(onStepSelect) && enabled(i) && i !== current;

          const marker = (
            <span
              className={cn(
                "relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-semibold transition-colors",
                "group-hover:border-primary/60 group-hover:text-foreground",
                state === "active" &&
                  "border-primary bg-primary/15 text-primary",
                state === "complete" &&
                  "border-primary/60 bg-primary/10 text-primary",
                state === "error" && "border-danger bg-danger/10 text-danger",
                state === "upcoming" &&
                  "border-border bg-elevated/80 text-subtle",
              )}
            >
              {state === "complete" ? (
                <Check className="h-4 w-4" aria-hidden />
              ) : (
                i + 1
              )}
            </span>
          );

          const label = (
            <span
              className={cn(
                "mt-1.5 max-w-[8rem] text-center text-[11px] font-medium leading-tight transition-colors group-hover:text-foreground",
                state === "active"
                  ? "text-foreground"
                  : state === "error"
                    ? "text-danger"
                    : state === "upcoming"
                      ? "text-subtle"
                      : "text-muted",
              )}
            >
              {step.label}
            </span>
          );

          return (
            <li
              key={step.key}
              className="relative flex flex-1 flex-col items-center"
            >
              {/* Connector to the next marker (sits behind the markers). */}
              {i < total - 1 ? (
                <span
                  aria-hidden
                  className={cn(
                    "absolute left-1/2 top-4 -z-0 h-px w-full -translate-y-1/2",
                    i < current ? "bg-primary/40" : "bg-border",
                  )}
                />
              ) : null}

              {canSelect && onStepSelect ? (
                <button
                  type="button"
                  onClick={() => onStepSelect(i)}
                  aria-current={i === current ? "step" : undefined}
                  title={`Go to ${step.label}`}
                  className="group flex cursor-pointer flex-col items-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  {marker}
                  {label}
                </button>
              ) : (
                <span
                  aria-current={i === current ? "step" : undefined}
                  className="flex flex-col items-center"
                >
                  {marker}
                  {label}
                </span>
              )}
            </li>
          );
        })}
      </ol>

      {/* Mobile header + progress */}
      <div className="flex flex-col gap-2 sm:hidden">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-sm font-semibold text-foreground">
            {active?.label}
          </span>
          <span className="shrink-0 text-xs text-subtle">
            Step {current + 1} of {total}
          </span>
        </div>
        <div className="flex gap-1" aria-hidden>
          {steps.map((step, i) => (
            <span
              key={step.key}
              className={cn(
                "h-1.5 flex-1 rounded-full transition-colors",
                step.hasError && i !== current
                  ? "bg-danger"
                  : i <= current
                    ? "bg-primary"
                    : "bg-border",
              )}
            />
          ))}
        </div>
        {active?.description ? (
          <span className="text-xs text-muted">{active.description}</span>
        ) : null}
      </div>
    </div>
  );
}
