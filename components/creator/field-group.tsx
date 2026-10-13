"use client";

// Generic form-field building blocks shared by the card-creator step
// components: the captioned FieldGroup wrapper (a label or a named group), the "More options" collapsible,
// the shared input/textarea class builders, and form-wide option constants
// used by more than one step. Extracted from card-creator-form.tsx.

import {
  Children,
  cloneElement,
  createContext,
  isValidElement,
  useContext,
  useEffect,
  useId,
  useRef,
} from "react";
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

const WRAPPER_CLASS = "flex flex-col gap-1.5";
const CAPTION_CLASS = "text-xs font-semibold uppercase tracking-wider text-subtle";

/**
 * What a FieldGroup hands the ONE control it captions (`kind="field"` and
 * `kind="control"`): its name is the caption alone, the helper — or the
 * error that replaces it — is its DESCRIPTION, and an error marks it
 * invalid. Spread it on the control.
 */
export type FieldAria = {
  "aria-labelledby": string;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
};

/** `a b` from id lists, without blanks or repeats; undefined when empty. */
export function joinIds(...ids: (string | null | undefined)[]): string | undefined {
  const all = [...new Set(ids.flatMap((id) => (id ? id.split(/\s+/) : [])).filter(Boolean))];
  return all.length > 0 ? all.join(" ") : undefined;
}

const TEXT_CONTROLS = new Set(["input", "select", "textarea"]);

type ControlProps = {
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false";
};

type FieldChildren = React.ReactNode | ((aria: FieldAria) => React.ReactNode);

/**
 * `kind="field"`: tie the field's text control to its caption and its note.
 * A function child spreads the attributes itself (a control inside a
 * wrapper, a Controller, a component); a plain `<input>` / `<select>` /
 * `<textarea>` written as the FIRST child gets them here — what the control
 * already says about itself (a name of its own, a note of its own) is kept.
 */
function withFieldAria(children: FieldChildren, aria: FieldAria): React.ReactNode {
  if (typeof children === "function") return children(aria);
  const nodes = Children.toArray(children);
  const at = nodes.findIndex((node) => isValidElement(node));
  const first = nodes[at];
  if (!isValidElement<ControlProps>(first) || typeof first.type !== "string" || !TEXT_CONTROLS.has(first.type)) {
    return children;
  }
  const own = first.props;
  const named = own["aria-label"] !== undefined || own["aria-labelledby"] !== undefined;
  nodes[at] = cloneElement(first, {
    "aria-labelledby": named ? own["aria-labelledby"] : aria["aria-labelledby"],
    "aria-describedby": joinIds(aria["aria-describedby"], own["aria-describedby"]),
    "aria-invalid": own["aria-invalid"] ?? aria["aria-invalid"],
  });
  return nodes;
}

/**
 * A captioned field of a form. Three shapes, ONE look:
 *
 *  - `kind="field"` (default) — the field is ONE text input, select or
 *    textarea (extra buttons beside it are fine as long as that control comes
 *    first). The wrapper is a real `<label>`, so a click on the caption
 *    focuses the control; the control's NAME is the caption alone
 *    (`aria-labelledby`) and the helper or the error is its DESCRIPTION
 *    (`aria-describedby`; an error also sets `aria-invalid`) — never part of
 *    the name, which a `<label>` alone would make it (TODO 3b.19). A control
 *    that is not the first child as a plain element takes them from a
 *    function child: `{(aria) => <div><input {...aria} /></div>}`.
 *  - `kind="control"` — the field is ONE control that is not a text input
 *    and has a role of its own: a chip row (a radiogroup), the rules editor
 *    under its symbol toolbar (a textbox). The wrapper is a plain `<div>`
 *    with NO role: a group around one control says the field twice ("Rarity,
 *    group — Rarity, radio group"; TODO 3b.24). The control is named and
 *    described through the function child's attributes.
 *  - `kind="group"` — the field is a SET of controls with names of their
 *    own: the cost picker, switches, ticks, an uploader beside its chips.
 *    The wrapper is a `role="group"` named by the caption
 *    (`aria-labelledby`) and described by the helper or the error
 *    (`aria-describedby`). Never a `<label>` there: a label names its FIRST
 *    button with the caption (plus the helper and every other chip's words),
 *    names nothing else, and hands that button every click on its plain
 *    content.
 *
 * Rule of thumb: the first control inside is not an input / select /
 * textarea → `kind="control"` when it is the only one, `kind="group"` when
 * there are several.
 *
 * An error is not a live region here: a blocked save moves the focus to the
 * first refused field (which reads its description) and a refusal from the
 * server is announced once by the form's own alert — an alert per field
 * would say it twice.
 */
export function FieldGroup({
  label,
  helper,
  error,
  showFace = false,
  kind = "field",
  children,
}: {
  label: string;
  helper?: string;
  error?: string;
  /** Inside a FaceScope: show the face's words before the label instead of
   *  keeping them for screen readers only. */
  showFace?: boolean;
  kind?: "field" | "control" | "group";
  children: FieldChildren;
}) {
  const face = useContext(FaceLabelContext);
  const faceWords = face ? <span className={showFace ? undefined : "sr-only"}>{face} — </span> : null;
  const id = useId();
  const captionId = `${id}-caption`;
  const noteId = `${id}-note`;
  const hasNote = Boolean(error || helper);
  const aria: FieldAria = {
    "aria-labelledby": captionId,
    "aria-describedby": hasNote ? noteId : undefined,
    "aria-invalid": error ? true : undefined,
  };
  const caption = (
    <span id={captionId} data-fieldgroup-text className={CAPTION_CLASS}>
      {faceWords}
      {label}
    </span>
  );
  const note = error ? (
    <span id={noteId} data-fieldgroup-text className="text-xs text-danger">{error}</span>
  ) : helper ? (
    <span id={noteId} data-fieldgroup-text className="text-xs text-muted">{helper}</span>
  ) : null;
  if (kind === "group" || kind === "control") {
    const group = kind === "group";
    return (
      <div
        role={group ? "group" : undefined}
        aria-labelledby={group ? captionId : undefined}
        aria-describedby={group && hasNote ? noteId : undefined}
        className={WRAPPER_CLASS}
      >
        {caption}
        {typeof children === "function" ? children(aria) : children}
        {note}
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
      {caption}
      {withFieldAria(children, aria)}
      {note}
    </label>
  );
}

// The field looks live in components/ui/field-classes (the deck editor
// and admin dialogs use them too); re-exported for the creator's importers.
export { inputClass, textareaClass } from "@/components/ui/field-classes";
