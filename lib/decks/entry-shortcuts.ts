// ---------------------------------------------------------------------------
// The deck page's keys (TODO DK5.2 / DK5.4). Pure: the page's handlers ask
// these, and the unit tests read the same table.
//
//   on an entry (its opener holds the focus — never anywhere else):
//     +  (or =)   one copy more
//     −  (- key)  one copy fewer (never under 1: Remove takes it out)
//     M           the "Move to" menu
//     S           to the sideboard — from the sideboard, back to the deck
//   anywhere on the owner's page, except while typing in a field:
//     /           the add box
//
// A key held with Ctrl, ⌘ or Alt is the browser's or the system's (Ctrl +
// zooms, ⌘ S saves): never ours. Shift is allowed — "+" is Shift + "=" on
// most keyboards.
// ---------------------------------------------------------------------------

export type EntryShortcut = "increment" | "decrement" | "move" | "side";

type KeyLike = {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  /** An IME composition in progress: the key is a character's. */
  isComposing?: boolean;
};

const ENTRY_KEYS: Record<string, EntryShortcut> = {
  "+": "increment",
  "=": "increment",
  Add: "increment",
  "-": "decrement",
  Subtract: "decrement",
  m: "move",
  M: "move",
  s: "side",
  S: "side",
};

/** The entry key `event` is, or null. */
export function entryShortcutOf(event: KeyLike): EntryShortcut | null {
  if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return null;
  return ENTRY_KEYS[event.key] ?? null;
}

/** The text fields a key belongs to while the reader types. */
const TEXT_INPUT_TYPES: ReadonlySet<string> = new Set([
  "text",
  "search",
  "email",
  "url",
  "tel",
  "password",
  "number",
  "date",
  "datetime-local",
  "month",
  "time",
  "week",
]);

/** The focus is in a place that takes typed characters: a text-like input,
 *  a textarea, a select (it searches by letter) or an editable element. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).tagName !== "string") return false;
  const element = target as HTMLElement;
  const tag = element.tagName.toLowerCase();
  if (tag === "textarea" || tag === "select") return true;
  if (tag === "input") return TEXT_INPUT_TYPES.has(((element as HTMLInputElement).type || "text").toLowerCase());
  return element.isContentEditable === true || element.getAttribute?.("contenteditable") === "true";
}

/** "/" pressed outside a field, with no modifier: focus the add box. */
export function isAddBoxShortcut(event: KeyLike & { target: EventTarget | null }): boolean {
  if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return false;
  return !isTypingTarget(event.target);
}
