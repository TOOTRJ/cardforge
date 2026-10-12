// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { RulesSymbolToolbar } from "@/components/creator/rules-symbol-toolbar";
import { PipTextEditor, type PipTextEditorHandle } from "@/components/creator/pip-text-editor";
import { PRINT_TYPOGRAPHY_CHARACTERS } from "@/lib/validation/print-typography";

// ---------------------------------------------------------------------------
// TODO 6.11 — the symbol toolbar's print characters: an em dash and a bullet
// (the two a plain keyboard has no key for), inserted at the caret like a
// symbol — as TEXT, never as a pip. No minus sign: the rules face has no ink
// for U+2212 (tests/unit/validation/print-typography.test.ts).
// ---------------------------------------------------------------------------

afterEach(() => cleanup());

describe("the rules toolbar's print characters", () => {
  it("offers an em dash and a bullet, and hands each to onInsert", () => {
    const onInsert = vi.fn();
    render(<RulesSymbolToolbar onInsert={onInsert} />);
    fireEvent.click(screen.getByRole("button", { name: "Insert em dash" }));
    fireEvent.click(screen.getByRole("button", { name: "Insert bullet" }));
    expect(onInsert.mock.calls.map((c) => c[0])).toEqual(["—", "•"]);
    expect(screen.queryByRole("button", { name: /minus/i })).toBeNull();
    // Both are characters the rules faces draw (the conversion's own table).
    for (const [char] of onInsert.mock.calls) expect(PRINT_TYPOGRAPHY_CHARACTERS.rules).toContain(char);
  });

  it("a character lands in the editor as text, at the end when it has no caret", () => {
    const onChange = vi.fn();
    const handle: { current: PipTextEditorHandle | null } = { current: null };
    render(
      <>
        <RulesSymbolToolbar onInsert={(token) => handle.current?.insertToken(token)} />
        <PipTextEditor ref={(h) => void (handle.current = h)} value="Choose one " onChange={onChange} aria-label="Rules text" />
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Insert em dash" }));
    expect(onChange).toHaveBeenLastCalledWith("Choose one —");
    expect(screen.getByLabelText("Rules text").querySelector("[data-pip]")).toBeNull();
  });
});
