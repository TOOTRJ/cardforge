// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FieldGroup } from "@/components/creator/field-group";

// ---------------------------------------------------------------------------
// FieldGroup is a <label>, and a label forwards a click on any of its
// non-interactive content to its first labelable descendant. In a group that
// opens with the symbol toolbar that descendant is the {W} button: a mouse
// click inside the empty rules-text box (a contenteditable — not a form
// control) dropped a {W} pip into it. The browser's forwarding is what a
// cancelled click stops, so these tests read `defaultPrevented`: the real
// activation is covered by tests/e2e/rules-text-editor.spec.ts.
// ---------------------------------------------------------------------------

afterEach(() => cleanup());

/** True when the group let the click through to the browser's label forwarding. */
function forwards(target: Element): boolean {
  return fireEvent.click(target);
}

function ToolbarGroup({ onInsert = () => {} }: { onInsert?: () => void }) {
  return (
    <FieldGroup label="Rules text" helper="Click a symbol to drop it in.">
      <div data-testid="body">
        <div data-testid="toolbar">
          <button type="button" aria-label="Insert {W}" onClick={onInsert} />
          <button type="button" aria-label="Insert {U}" />
          <details>
            <summary>More symbols…</summary>
          </details>
        </div>
        <div role="textbox" aria-label="Rules text" contentEditable suppressContentEditableWarning />
        <input type="checkbox" aria-label="Reminder text" />
      </div>
    </FieldGroup>
  );
}

describe("FieldGroup — a group that opens with a button", () => {
  it("does not forward a click inside the rules-text box to the first button", () => {
    render(<ToolbarGroup />);
    expect(forwards(screen.getByRole("textbox", { name: "Rules text" }))).toBe(false);
  });

  it("does not forward a click on the gap between two buttons, the caption or the helper", () => {
    render(<ToolbarGroup />);
    expect(forwards(screen.getByTestId("toolbar"))).toBe(false);
    expect(forwards(screen.getByTestId("body"))).toBe(false);
    expect(forwards(screen.getByText("Rules text", { selector: "span" }))).toBe(false);
    expect(forwards(screen.getByText("Click a symbol to drop it in."))).toBe(false);
  });

  it("leaves a click ON a control alone: buttons press, a checkbox ticks, a summary toggles", () => {
    const onInsert = vi.fn();
    render(<ToolbarGroup onInsert={onInsert} />);
    expect(forwards(screen.getByRole("button", { name: "Insert {W}" }))).toBe(true);
    expect(onInsert).toHaveBeenCalledTimes(1);
    expect(forwards(screen.getByRole("button", { name: "Insert {U}" }))).toBe(true);
    expect(forwards(screen.getByText("More symbols…"))).toBe(true);
    const checkbox = screen.getByRole("checkbox", { name: "Reminder text" }) as HTMLInputElement;
    expect(forwards(checkbox)).toBe(true);
    expect(checkbox.checked).toBe(true);
  });
});

describe("FieldGroup — a label of its own inside a group that opens with a button", () => {
  it("lets the nested label's words reach its own control (the watermark's Large tick)", () => {
    render(
      <FieldGroup label="Watermark">
        <div>
          <button type="button">White</button>
          <label>
            <input type="checkbox" aria-label="Large" />
            <span>Large (the classic treatment)</span>
          </label>
        </div>
      </FieldGroup>,
    );
    expect(forwards(screen.getByText("Large (the classic treatment)"))).toBe(true);
    // The group's own caption is still cancelled.
    expect(forwards(screen.getByText("Watermark", { selector: "span" }))).toBe(false);
  });
});

describe("FieldGroup — a group that opens with a form control", () => {
  it("keeps the label's click-to-focus forwarding", () => {
    render(
      <FieldGroup label="Flavor text" helper="Optional.">
        <textarea aria-label="Flavor text" />
      </FieldGroup>,
    );
    expect(forwards(screen.getByText("Flavor text", { selector: "span" }))).toBe(true);
    expect(forwards(screen.getByText("Optional."))).toBe(true);
  });
});
