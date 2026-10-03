"use client";

import type { ReactNode } from "react";
import { ChipGroup, type ChipOption } from "@/components/ui/chip-group";
import type { SheetCardSize, SheetGap, SheetMarks, SheetPlan } from "@/lib/render/sheet-layout";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// The print options every print surface shares (TODO 6.15): My Cards'
// selection dialog, the Pro deck export and the single-card download modal.
// One look and one wording for the sheet's spacing, cut guides and card
// size, for the 1/8″ bleed checkbox and for the "Include back faces"
// checkbox (TODO 5.3: a double-faced card's back printed beside its front);
// the geometry is lib/render/sheet-layout.ts, the remembered values
// lib/cards/print-selection.ts.
// ---------------------------------------------------------------------------

export type SheetOptionValues = { gap: SheetGap; marks: SheetMarks; cardSize: SheetCardSize };

export const GAP_OPTIONS: ChipOption<SheetGap>[] = [
  { value: "none", label: "No gap" },
  { value: "sixteenth", label: "1/16″ gap" },
];

export const MARK_OPTIONS: ChipOption<SheetMarks>[] = [
  { value: "corners", label: "Corner marks" },
  { value: "lines", label: "Full-length lines" },
];

export const SIZE_OPTIONS: ChipOption<SheetCardSize>[] = [
  { value: "in", label: "2.5 × 3.5 in" },
  { value: "mm", label: "63 × 88 mm" },
];

/** A labelled option group. */
export function PrintField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="text-xs font-semibold uppercase tracking-wider text-subtle">{label}</span>
      {children}
    </div>
  );
}

/** Spacing, cut guides and card size of a sheet. */
export function SheetOptionsFields({
  value,
  onChange,
  className,
}: {
  value: SheetOptionValues;
  onChange: (patch: Partial<SheetOptionValues>) => void;
  className?: string;
}) {
  return (
    <div className={cn("grid gap-4 sm:grid-cols-3", className)} data-testid="sheet-options">
      <PrintField label="Spacing">
        <ChipGroup ariaLabel="Spacing" options={GAP_OPTIONS} value={value.gap} onChange={(gap) => onChange({ gap })} />
      </PrintField>
      <PrintField label="Cut guides">
        <ChipGroup
          ariaLabel="Cut guides"
          options={MARK_OPTIONS}
          value={value.marks}
          onChange={(marks) => onChange({ marks })}
        />
      </PrintField>
      <PrintField label="Card size">
        <ChipGroup
          ariaLabel="Card size"
          options={SIZE_OPTIONS}
          value={value.cardSize}
          onChange={(cardSize) => onChange({ cardSize })}
        />
      </PrintField>
    </div>
  );
}

/** The 1/8″ bleed checkbox. */
export function PrintBleedCheckbox({
  checked,
  onChange,
  disabled = false,
  testId,
  hint,
  className,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  testId: string;
  hint: string;
  className?: string;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-lg border border-border/60 bg-elevated/30 px-4 py-3 text-sm text-foreground has-[:checked]:border-primary/50 has-[:checked]:bg-primary/5",
        disabled && "cursor-not-allowed opacity-60",
        className,
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 h-4 w-4 accent-[var(--color-primary)]"
        data-testid={testId}
      />
      <span className="flex flex-col gap-0.5">
        <span className="font-medium">Add a 1/8″ bleed</span>
        <span className="text-xs leading-5 text-muted">{hint}</span>
      </span>
    </label>
  );
}

/** The "Include back faces" checkbox (TODO 5.3): a double-faced card's
 *  back as its own image / page, or beside its front on a sheet. Shown only
 *  where a selection has one (the caller decides); default on. */
export function PrintBacksCheckbox({
  checked,
  onChange,
  disabled = false,
  testId,
  hint,
  className,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  testId: string;
  hint: string;
  className?: string;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-lg border border-border/60 bg-elevated/30 px-4 py-3 text-sm text-foreground has-[:checked]:border-primary/50 has-[:checked]:bg-primary/5",
        disabled && "cursor-not-allowed opacity-60",
        className,
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 h-4 w-4 accent-[var(--color-primary)]"
        data-testid={testId}
      />
      <span className="flex flex-col gap-0.5">
        <span className="font-medium">Include back faces</span>
        <span className="text-xs leading-5 text-muted">{hint}</span>
      </span>
    </label>
  );
}

/** "9 per sheet", "6 per sheet (landscape page)". */
export function perSheetLabel(plan: Pick<SheetPlan, "perPage" | "orientation">): string {
  return `${plan.perPage} per sheet${plan.orientation === "landscape" ? " (landscape page)" : ""}`;
}
