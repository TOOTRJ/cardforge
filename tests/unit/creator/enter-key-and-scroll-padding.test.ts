// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { cancelsImplicitSubmit, isSingleLineInput } from "@/lib/creator/enter-key";
import { creatorScrollPadding } from "@/components/creator/use-scroll-padding";

// TODO 3b.21 — the rule the creator's form applies to every keydown.
describe("cancelsImplicitSubmit", () => {
  const form = document.createElement("form");
  const other = document.createElement("form");
  const input = (type: string, owner: HTMLFormElement = form) => {
    const el = document.createElement("input");
    el.type = type;
    owner.appendChild(el);
    return el;
  };

  it("cancels Enter in a single-line input of the creator's form", () => {
    for (const type of ["text", "number", "url", "search", "email"]) {
      expect(cancelsImplicitSubmit({ key: "Enter", target: input(type), form }), type).toBe(true);
    }
  });

  it("leaves buttons, checkboxes, a textarea, a contenteditable box and other keys alone", () => {
    for (const type of ["button", "submit", "checkbox", "radio", "file"]) {
      expect(cancelsImplicitSubmit({ key: "Enter", target: input(type), form }), type).toBe(false);
    }
    expect(cancelsImplicitSubmit({ key: "Enter", target: document.createElement("textarea"), form })).toBe(false);
    const box = document.createElement("div");
    box.contentEditable = "true";
    expect(cancelsImplicitSubmit({ key: "Enter", target: box, form })).toBe(false);
    expect(cancelsImplicitSubmit({ key: "a", target: input("text"), form })).toBe(false);
  });

  it("leaves an input of another form (a dialog's own) and an IME composition's Enter alone", () => {
    expect(cancelsImplicitSubmit({ key: "Enter", target: input("text", other), form })).toBe(false);
    expect(cancelsImplicitSubmit({ key: "Enter", target: input("text"), form, isComposing: true })).toBe(false);
  });

  it("isSingleLineInput reads an input with no type as text", () => {
    const el = document.createElement("input");
    expect(isSingleLineInput(el)).toBe(true);
    expect(isSingleLineInput(null)).toBe(false);
  });
});

// TODO 3b.28 — the page's scroll padding for the bars' heights.
describe("creatorScrollPadding", () => {
  it("keeps a field clear of the header + Face switch at the top and the Save bar at the bottom", () => {
    expect(creatorScrollPadding({ faceSwitchPx: 64.4, saveBarPx: 131.2 })).toEqual({
      top: "calc(4.25rem + 77px)",
      bottom: "144px",
    });
    expect(creatorScrollPadding({ faceSwitchPx: 0, saveBarPx: 0 })).toEqual({
      top: "calc(4.25rem + 12px)",
      bottom: "12px",
    });
  });
});
