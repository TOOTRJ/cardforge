// ---------------------------------------------------------------------------
// Put the cursor in a form field by its name (TODO 5.14, quick fix 2: each
// "still needed" item is a link to its field).
//
// A field is found by its `name` attribute (react-hook-form's register
// writes it) or, for a control that is not an input — the art uploader's
// button — by `data-field-anchor`. Every closed <details> above it is
// opened first (the second part of a split / aftermath / flip / adventure
// card lives inside the Identity step's "More options" fold), then the
// field is scrolled into view and focused. DOM only; called from an effect
// after the step that holds the field has rendered.
// ---------------------------------------------------------------------------

/** The element a field name points at inside `root`, or null. */
export function findFieldElement(root: ParentNode | null | undefined, field: string): HTMLElement | null {
  if (!root) return null;
  const candidates = root.querySelectorAll<HTMLElement>("[name], [data-field-anchor]");
  for (const el of candidates) {
    if (el.getAttribute("data-field-anchor") === field || el.getAttribute("name") === field) return el;
  }
  return null;
}

/** Open the folds above the field, scroll it into view and focus it. False
 *  when the field is not on the page. */
export function revealAndFocusField(root: ParentNode | null | undefined, field: string): boolean {
  const el = findFieldElement(root, field);
  if (!el) return false;
  for (let parent = el.parentElement; parent; parent = parent.parentElement) {
    if (parent.tagName === "DETAILS" && !(parent as HTMLDetailsElement).open) {
      (parent as HTMLDetailsElement).open = true;
    }
  }
  const reduced =
    typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
  el.scrollIntoView?.({ block: "center", behavior: reduced ? "auto" : "smooth" });
  el.focus({ preventScroll: true });
  return true;
}
