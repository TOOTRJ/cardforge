"use client";

// Generic form-field building blocks shared by the card-creator step
// components: the labeled FieldGroup wrapper, the "More options" collapsible,
// the shared input/textarea class builders, and form-wide option constants
// used by more than one step. Extracted from card-creator-form.tsx.

import { createContext, useContext, useEffect, useRef } from "react";
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

// The face a group of fields belongs to on a card with Face tabs (TODO
// 5.14): "Front face" / "Back face" from the kind's words. Every FieldGroup
// inside names itself with it — "Back face — Title" — so a field is heard
// with its face; the words are visually hidden except where a FieldGroup
// asks for them (`showFace`: the name and the artwork, as the approved
// mock-up). No scope (every one-faced card): nothing is added.
const FaceLabelContext = createContext<string | null>(null);

export function FaceScope({ label, children }: { label: string | null; children: React.ReactNode }) {
  return <FaceLabelContext.Provider value={label}>{children}</FaceLabelContext.Provider>;
}

/** The face label of the enclosing FaceScope, or null. */
export function useFaceLabel(): string | null {
  return useContext(FaceLabelContext);
}

/** Elements whose own click does something a FieldGroup must not cancel. */
const NATIVE_CLICK_TARGETS = "a, button, input, select, textarea, summary";

export function FieldGroup({
  label,
  helper,
  error,
  showFace = false,
  children,
}: {
  label: string;
  helper?: string;
  error?: string;
  /** Inside a FaceScope: show the face's words before the label instead of
   *  keeping them for screen readers only. */
  showFace?: boolean;
  children: React.ReactNode;
}) {
  const face = useContext(FaceLabelContext);
  return (
    <label
      className="flex flex-col gap-1.5"
      onClick={(event) => {
        // A <label> forwards a click on ANY of its non-interactive content
        // to its first labelable descendant — and a BUTTON is labelable.
        // For groups that wrap a toolbar or chip row, clicking the caption,
        // the helper text, a gap between two buttons or the rules-text box
        // (a contenteditable, which is not a form control) used to press
        // the first button: change the card type, drop a {W} into the empty
        // rules box… Only forward to real form controls; inputs keep the
        // click-to-focus behaviour, and a click ON a control is left alone
        // (cancelling it would undo a checkbox tick or a <summary> toggle).
        const target = event.target as HTMLElement;
        if (target.closest(NATIVE_CLICK_TARGETS)) return;
        // A label of its own inside the group (the watermark's "Large" tick
        // and "Opacity" slider) forwards to ITS control: leave it alone.
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
      <span
        data-fieldgroup-text
        className="text-xs font-semibold uppercase tracking-wider text-subtle"
      >
        {face ? <span className={showFace ? undefined : "sr-only"}>{face} — </span> : null}
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
