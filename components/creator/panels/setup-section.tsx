"use client";

// Collapsible chooser section: the summary always shows the CURRENT value,
// so a collapsed step still reads as a complete sentence. All sections start
// CLOSED (new cards carry sensible defaults) and close themselves once a
// selection lands. Extracted from card-setup-panel.tsx (TODO 5.2) so the
// back-face panel's colour chips read like the Card step's.

import { useState } from "react";
import { ChevronDown } from "lucide-react";

export function SetupSection({
  title,
  value,
  children,
  autoClose = true,
  testId,
}: {
  title: string;
  value: string;
  children: React.ReactNode;
  /** False for a section of toggles (the token's types): several picks in a
   *  row, so it stays open until the user folds it. */
  autoClose?: boolean;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  // Auto-close on selection: the summary value changing while the section is
  // open means the user just picked something — collapse so the step reads
  // as its result. (Derived during render — no effect — so the kind-change
  // confirm dialog closes the section only when the change actually lands.)
  const [prevValue, setPrevValue] = useState(value);
  if (value !== prevValue) {
    setPrevValue(value);
    if (open && autoClose) setOpen(false);
  }
  return (
    <details
      open={open}
      className="rounded-lg border border-border/60 bg-elevated/30"
      data-testid={testId}
    >
      <summary
        onClick={(e) => {
          e.preventDefault();
          setOpen((v) => !v);
        }}
        className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 [&::-webkit-details-marker]:hidden"
      >
        <span className="text-xs font-semibold uppercase tracking-wider text-subtle">
          {title}
        </span>
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">
            {value}
          </span>
          <ChevronDown
            aria-hidden
            className={`h-4 w-4 shrink-0 text-subtle transition-transform ${open ? "rotate-180" : ""}`}
          />
        </span>
      </summary>
      <div className="flex flex-col gap-3 px-4 pb-4 pt-1">{children}</div>
    </details>
  );
}
