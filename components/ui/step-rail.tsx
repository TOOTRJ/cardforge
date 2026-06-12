"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { StepperStep } from "@/components/ui/stepper";

// ---------------------------------------------------------------------------
// StepRail — the vertical icon rail from the PipGlyph editor mockups. Same
// fully-controlled contract as Stepper (steps / current / onStepSelect /
// isStepEnabled); the parent renders this at xl+ and keeps the horizontal
// Stepper below that breakpoint. Purely presentational.
//
// States: purple pill for the active step, gold corner tick when complete,
// danger for errored steps, subtle for upcoming.
// ---------------------------------------------------------------------------

type StepRailProps = {
  steps: StepperStep[];
  current: number;
  onStepSelect?: (index: number) => void;
  /** Defaults to "already visited" like Stepper. */
  isStepEnabled?: (index: number) => boolean;
  /** Icon per step key (lucide nodes). Falls back to the step number. */
  icons?: Record<string, React.ReactNode>;
  className?: string;
};

type StepState = "complete" | "active" | "upcoming" | "error";

export function StepRail({
  steps,
  current,
  onStepSelect,
  isStepEnabled,
  icons = {},
  className,
}: StepRailProps) {
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
    <nav aria-label="Card editor steps" className={className}>
      <ol className="flex flex-col">
        {steps.map((step, i) => {
          const state = stateOf(i, step);
          const canSelect =
            Boolean(onStepSelect) && enabled(i) && i !== current;

          const tile = (
            <span
              className={cn(
                "relative flex h-9 w-9 shrink-0 items-center justify-center rounded-md border transition-colors [&_svg]:size-4",
                state === "active" &&
                  "border-primary bg-primary/20 text-primary-bright",
                state === "complete" && "border-border text-muted",
                state === "error" && "border-danger bg-danger/10 text-danger",
                state === "upcoming" && "border-border bg-elevated/60 text-subtle",
              )}
            >
              {icons[step.key] ?? (
                <span className="text-xs font-semibold">{i + 1}</span>
              )}
              {state === "complete" ? (
                <span
                  aria-hidden
                  className="absolute -right-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-gold text-background"
                >
                  <Check className="h-2.5 w-2.5" strokeWidth={3} />
                </span>
              ) : null}
            </span>
          );

          const label = (
            <span
              className={cn(
                "text-xs font-medium leading-tight transition-colors",
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
            <li key={step.key} className="flex flex-col">
              {/* Vertical connector from the previous tile. */}
              {i > 0 ? (
                <span
                  aria-hidden
                  className={cn(
                    "ml-[27px] h-3.5 w-px",
                    i <= current ? "bg-primary/40" : "bg-border",
                  )}
                />
              ) : null}

              {canSelect && onStepSelect ? (
                <button
                  type="button"
                  onClick={() => onStepSelect(i)}
                  title={`Go to ${step.label}`}
                  className={cn(
                    "group flex items-center gap-3 rounded-lg border border-transparent px-2 py-1.5 text-left transition-colors",
                    "hover:border-border hover:bg-elevated/60",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                  )}
                >
                  {tile}
                  {label}
                </button>
              ) : (
                <span
                  aria-current={i === current ? "step" : undefined}
                  className={cn(
                    "flex items-center gap-3 rounded-lg border px-2 py-1.5",
                    state === "active"
                      ? "border-primary/50 bg-primary/15"
                      : "border-transparent",
                  )}
                >
                  {tile}
                  {label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
