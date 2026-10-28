// Enter never saves the card (TODO 3b.21, owner decision 2026-10-28).
//
// A browser SUBMITS a form when Enter is pressed in one of its single-line
// inputs ("implicit submission") — so Enter in the creator's title, a
// subtype, a stat, the tags… saved the card whenever Save was enabled. ONE
// rule for every single-line input of the creator's form: its Enter is
// cancelled at the form (card-creator-form.tsx `onKeyDown`), after the
// input's own handler has had it (the cost picker's Generic number box adds
// its number on Enter, #507). Nothing else changes: Enter in the rules text
// (a contenteditable box) and in a textarea still makes a new line, Enter on
// a button still presses it, and the Save button saves.

/** Input types a browser never submits a form from on Enter, or whose Enter
 *  presses them (a button) — left alone. */
const NOT_SINGLE_LINE = new Set(["button", "submit", "reset", "image", "checkbox", "radio", "file", "color", "range"]);

/** True for a single-line input — one whose Enter would submit the form. */
export function isSingleLineInput(target: EventTarget | null): target is HTMLInputElement {
  if (typeof HTMLInputElement === "undefined" || !(target instanceof HTMLInputElement)) return false;
  return !NOT_SINGLE_LINE.has((target.type || "text").toLowerCase());
}

/** True when this keydown is an Enter that would save the card from a
 *  single-line input OF THE CREATOR'S FORM (`form`): the form cancels it.
 *  An input of another form — a dialog's own, whose Enter the React tree
 *  still bubbles through the creator from its portal — is left alone, and
 *  so is an Enter that ends an IME composition (the composition's, never a
 *  submit). */
export function cancelsImplicitSubmit(event: {
  key: string;
  target: EventTarget | null;
  form: HTMLFormElement | null;
  isComposing?: boolean;
}): boolean {
  return (
    event.key === "Enter" &&
    !event.isComposing &&
    isSingleLineInput(event.target) &&
    event.form !== null &&
    event.target.form === event.form
  );
}
