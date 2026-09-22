"use client";

// Generic form-field building blocks shared by the card-creator step
// components: the labeled FieldGroup wrapper, the "More options" collapsible,
// the shared input/textarea class builders, and form-wide option constants
// used by more than one step. Extracted from card-creator-form.tsx.

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
}: {
  summary: string;
  children: React.ReactNode;
}) {
  return (
    <details className="rounded-lg border border-border/60 bg-elevated/30">
      <summary className="cursor-pointer list-none px-4 py-2 text-xs font-semibold uppercase tracking-wider text-subtle transition-colors hover:text-muted [&::-webkit-details-marker]:hidden">
        {summary}
      </summary>
      <div className="flex flex-col gap-4 px-4 pb-4 pt-2">{children}</div>
    </details>
  );
}

export function FieldGroup({
  label,
  helper,
  error,
  children,
}: {
  label: string;
  helper?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label
      className="flex flex-col gap-1.5"
      onClick={(event) => {
        // A <label> forwards a click to its first labelable descendant — and
        // a BUTTON is labelable. For groups that wrap a toolbar or chip row,
        // clicking the caption or helper text used to press the first
        // button (change the card type, add a mana pip…). Only forward to
        // real form controls; inputs keep the click-to-focus behaviour.
        const target = event.target as HTMLElement;
        if (!target.closest("[data-fieldgroup-text]")) return;
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
