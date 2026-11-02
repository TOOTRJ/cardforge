// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { entryShortcutOf, isAddBoxShortcut, isTypingTarget } from "@/lib/decks/entry-shortcuts";

// ---------------------------------------------------------------------------
// The deck page's keys (TODO DK5.2 / DK5.4, lib/decks/entry-shortcuts.ts):
// + − M S on a focused card, "/" for the add box — never with Ctrl, ⌘ or
// Alt (the browser's and the system's), never mid-composition, and "/"
// never while typing in a field.
// ---------------------------------------------------------------------------

describe("the entry keys", () => {
  it("+ (or =) one more, − one fewer, M the Move menu, S the sideboard — Shift allowed", () => {
    expect(entryShortcutOf({ key: "+" })).toBe("increment");
    expect(entryShortcutOf({ key: "+" , shiftKey: true } as never)).toBe("increment");
    expect(entryShortcutOf({ key: "=" })).toBe("increment");
    expect(entryShortcutOf({ key: "Add" })).toBe("increment");
    expect(entryShortcutOf({ key: "-" })).toBe("decrement");
    expect(entryShortcutOf({ key: "Subtract" })).toBe("decrement");
    expect(entryShortcutOf({ key: "m" })).toBe("move");
    expect(entryShortcutOf({ key: "M" })).toBe("move");
    expect(entryShortcutOf({ key: "s" })).toBe("side");
    expect(entryShortcutOf({ key: "S" })).toBe("side");
  });

  it("never with Ctrl, ⌘ or Alt (zoom, save, menus), never mid-composition, never another key", () => {
    expect(entryShortcutOf({ key: "+", ctrlKey: true })).toBeNull();
    expect(entryShortcutOf({ key: "-", metaKey: true })).toBeNull();
    expect(entryShortcutOf({ key: "s", metaKey: true })).toBeNull();
    expect(entryShortcutOf({ key: "m", altKey: true })).toBeNull();
    expect(entryShortcutOf({ key: "s", isComposing: true })).toBeNull();
    for (const key of ["Enter", " ", "x", "Delete", "Backspace", "ArrowDown"]) expect(entryShortcutOf({ key })).toBeNull();
  });
});

describe("the add box's /", () => {
  const input = (type = "text") => Object.assign(document.createElement("input"), { type });

  it("is the add box's outside a field", () => {
    expect(isAddBoxShortcut({ key: "/", target: document.body })).toBe(true);
    expect(isAddBoxShortcut({ key: "/", target: document.createElement("button") })).toBe(true);
    expect(isAddBoxShortcut({ key: "/", target: input("checkbox") })).toBe(true);
  });

  it("is a character while typing — a text input, a search box, a textarea, a select, an editable element", () => {
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    for (const target of [input(), input("search"), input("number"), document.createElement("textarea"), document.createElement("select"), editable]) {
      expect(isTypingTarget(target)).toBe(true);
      expect(isAddBoxShortcut({ key: "/", target })).toBe(false);
    }
  });

  it("is never the add box's with a modifier", () => {
    expect(isAddBoxShortcut({ key: "/", target: document.body, ctrlKey: true })).toBe(false);
    expect(isAddBoxShortcut({ key: "/", target: document.body, metaKey: true })).toBe(false);
    expect(isAddBoxShortcut({ key: "?", target: document.body })).toBe(false);
  });
});
