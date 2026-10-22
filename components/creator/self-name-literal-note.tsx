"use client";

import { useRef } from "react";
import { useFormContext, useWatch } from "react-hook-form";
import type { FormValues } from "@/lib/creator/form-types";
import { hasSelfNameToken } from "@/lib/cards/self-name";

// ---------------------------------------------------------------------------
// A card stored before CARDNAME / `~` drew as its name (TODO 6.2): migration
// 0142 flags it `frame_style.selfName: "literal"` and it prints its `~` as
// typed. EVERY rules area that holds a token — the rules text, a walker's
// rows, a saga's rows, a station's tiers, a back face's rules — shows this
// note with the one switch (owner Round 80): one way only, the edit sends
// `frame_anatomy.selfName: "name"` (lib/creator/revise.ts). The flag is the
// card's, so one press takes every note away.
//
// The button removes itself, so it hands the focus on (CLAUDE.md "a control
// that removes itself hands the focus on"): to the next control after the
// note — the area's own editor — never to <body>.
// ---------------------------------------------------------------------------

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [contenteditable]:not([contenteditable="false"]), [tabindex]:not([tabindex="-1"])';

/** The first focusable element after `el` in document order (not inside it). */
function nextFocusable(el: HTMLElement | null): HTMLElement | null {
  if (!el) return null;
  for (const candidate of Array.from(document.querySelectorAll<HTMLElement>(FOCUSABLE))) {
    if (el.contains(candidate)) continue;
    if (el.compareDocumentPosition(candidate) & Node.DOCUMENT_POSITION_FOLLOWING) return candidate;
  }
  return null;
}

export const SELF_NAME_SWITCH_LABEL = "Print ~ as the card’s name";

export function SelfNameLiteralNote({ texts }: { texts: ReadonlyArray<string | null | undefined> }) {
  const { control, setValue } = useFormContext<FormValues>();
  const selfName = useWatch({ control, name: "frame_style.selfName" });
  const ref = useRef<HTMLParagraphElement>(null);
  if (selfName !== "literal" || !texts.some((text) => hasSelfNameToken(text))) return null;
  return (
    <p ref={ref} data-testid="self-name-literal-note" className="flex flex-wrap items-center gap-2 text-xs text-muted">
      This card was saved before ~ printed as the card’s name, so its ~ prints as typed.
      <button
        type="button"
        onClick={() => {
          const target = nextFocusable(ref.current);
          setValue("frame_style.selfName", undefined, { shouldDirty: true });
          // After the note has gone: only when the focus went with it.
          window.setTimeout(() => {
            const active = document.activeElement;
            if (!active || active === document.body || !active.isConnected) target?.focus();
          }, 0);
        }}
        className="rounded-md border border-border/60 px-2 py-0.5 font-medium text-foreground transition-colors hover:border-border-strong"
      >
        {SELF_NAME_SWITCH_LABEL}
      </button>
    </p>
  );
}
