"use client";

// Generic form-field building blocks shared by the card-creator step
// components: the captioned FieldGroup wrapper (a label or a named group), the "More options" collapsible,
// the shared input/textarea class builders, and form-wide option constants
// used by more than one step. Extracted from card-creator-form.tsx.

import { useEffect, useId, useRef } from "react";
import {
  Box,
  Coins,
  Crown,
  Mountain,
  Shield,
  Sparkles,
  Swords,
  Wand2,
  Zap,
} from "lucide-react";
import { type ChipOption } from "@/components/ui/chip-group";
import type { CardType } from "@/types/card";

// Modern MTG card type picker. The legacy "spell" value is still accepted
// by the DB (migration 0018 keeps it in the check constraint) so existing
// rows render fine, but new cards pick a more specific instant/sorcery.
// Shared by the Frame step (front face) and the Extra step (back face).
export const CARD_TYPE_OPTIONS: ChipOption<CardType>[] = [
  { value: "creature", label: "Creature", icon: Swords },
  { value: "instant", label: "Instant", icon: Zap },
  { value: "sorcery", label: "Sorcery", icon: Wand2 },
  { value: "artifact", label: "Artifact", icon: Box },
  { value: "enchantment", label: "Enchantment", icon: Sparkles },
  { value: "land", label: "Land", icon: Mountain },
  { value: "planeswalker", label: "Planeswalker", icon: Crown },
  { value: "battle", label: "Battle", icon: Shield },
  { value: "token", label: "Token", icon: Coins },
];

// Per-step "More options" collapsible — the Detailed-create surface. Quick
// creators never need to open it; everything inside persists like any other
// field. Mirrors the Publish step's Advanced <details> styling.
export function MoreOptions({
  summary,
  children,
  openWhen = false,
  expandWhen = false,
}: {
  summary: string;
  children: React.ReactNode;
  /** True while a field inside has an error: the section opens (and never
   *  snaps shut as the user fixes it) — a folded-away error is an invisible
   *  one (TODO 3b.5). */
  openWhen?: boolean;
  /** True while a field inside is required but still empty (the Save hint
   *  names it): the section opens in place, without scrolling to it. */
  expandWhen?: boolean;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const details = ref.current;
    if (!openWhen || !details || details.open) return;
    details.open = true;
    details.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, [openWhen]);
  useEffect(() => {
    const details = ref.current;
    if (expandWhen && details && !details.open) details.open = true;
  }, [expandWhen]);
  return (
    <details ref={ref} className="rounded-lg border border-border/60 bg-elevated/30">
      <summary className="cursor-pointer list-none px-4 py-2 text-xs font-semibold uppercase tracking-wider text-subtle transition-colors hover:text-muted [&::-webkit-details-marker]:hidden">
        {summary}
      </summary>
      <div className="flex flex-col gap-4 px-4 pb-4 pt-2">{children}</div>
    </details>
  );
}

/** Elements whose own click does something a FieldGroup must not cancel. */
const NATIVE_CLICK_TARGETS = "a, button, input, select, textarea, summary";

const WRAPPER_CLASS = "flex flex-col gap-1.5";
const CAPTION_CLASS = "text-xs font-semibold uppercase tracking-wider text-subtle";

/**
 * A captioned field of a form. Two shapes, ONE look:
 *
 *  - `kind="field"` (default) — the field is ONE text input, select or
 *    textarea (extra buttons beside it are fine as long as that control comes
 *    first). The wrapper is a real `<label>`: the caption names the control
 *    and a click on it focuses the control.
 *  - `kind="group"` — the field is a SET of controls: a chip row, a symbol
 *    toolbar over an editor, switches, ticks, an uploader. The wrapper is a
 *    `role="group"` named by the caption (`aria-labelledby`) and described
 *    by the helper or the error (`aria-describedby`). Never a `<label>`
 *    there: a label names its FIRST button with the caption (plus the helper
 *    and every other chip's words), names nothing else, and hands that
 *    button every click on its plain content.
 *
 * Rule of thumb: the first control inside is not an input / select /
 * textarea → `kind="group"`.
 */
export function FieldGroup({
  label,
  helper,
  error,
  kind = "field",
  children,
}: {
  label: string;
  helper?: string;
  error?: string;
  kind?: "field" | "group";
  children: React.ReactNode;
}) {
  const id = useId();
  if (kind === "group") {
    const captionId = `${id}-caption`;
    const noteId = `${id}-note`;
    const note = error || helper;
    return (
      <div
        role="group"
        aria-labelledby={captionId}
        aria-describedby={note ? noteId : undefined}
        className={WRAPPER_CLASS}
      >
        <span id={captionId} data-fieldgroup-text className={CAPTION_CLASS}>
          {label}
        </span>
        {children}
        {error ? (
          <span id={noteId} data-fieldgroup-text className="text-xs text-danger">{error}</span>
        ) : helper ? (
          <span id={noteId} data-fieldgroup-text className="text-xs text-muted">{helper}</span>
        ) : null}
      </div>
    );
  }
  return (
    <label
      className={WRAPPER_CLASS}
      onClick={(event) => {
        // A <label> forwards a click on ANY of its non-interactive content
        // to its first labelable descendant — and a BUTTON is labelable.
        // A set of controls belongs in `kind="group"`; this is the net for a
        // field that still opens with a button: clicking the caption, the
        // helper text or a gap must not press it. Only forward to real form
        // controls; inputs keep the click-to-focus behaviour, and a click ON
        // a control is left alone (cancelling it would undo a checkbox tick
        // or a <summary> toggle).
        const target = event.target as HTMLElement;
        if (target.closest(NATIVE_CLICK_TARGETS)) return;
        // A label of its own inside the field forwards to ITS control: leave
        // it alone.
        const inner = target.closest("label");
        if (inner && inner !== event.currentTarget) return;
        const first = event.currentTarget.querySelector(
          "input, textarea, select, button, [role='radio'], [role='switch']",
        );
        if (first && first.tagName !== "INPUT" && first.tagName !== "TEXTAREA" && first.tagName !== "SELECT") {
          event.preventDefault();
        }
      }}
    >
      <span data-fieldgroup-text className={CAPTION_CLASS}>
        {label}
      </span>
      {children}
      {error ? (
        <span data-fieldgroup-text className="text-xs text-danger">{error}</span>
      ) : helper ? (
        <span data-fieldgroup-text className="text-xs text-muted">{helper}</span>
      ) : null}
    </label>
  );
}

// The field looks live in components/ui/field-classes (the deck editor
// and admin dialogs use them too); re-exported for the creator's importers.
export { inputClass, textareaClass } from "@/components/ui/field-classes";
