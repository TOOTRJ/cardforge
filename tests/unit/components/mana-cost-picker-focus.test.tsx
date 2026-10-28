// @vitest-environment happy-dom
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ManaCostPicker } from "@/components/cards/mana-cost-picker";

// ---------------------------------------------------------------------------
// TODO 3b.32: "Remove last" and "Clear" go off on an empty cost. A press of
// either that empties the cost hands the keyboard focus on to the generic
// amount — never leaves it on a disabled button (which a browser drops to
// <body>), and never takes it from somewhere else on the page.
// ---------------------------------------------------------------------------

afterEach(cleanup);

function Harness({ initial }: { initial: string }) {
  const [cost, setCost] = useState(initial);
  return (
    <>
      <ManaCostPicker value={cost} onChange={setCost} />
      <button type="button">Elsewhere</button>
      <span data-testid="cost">{cost}</span>
    </>
  );
}
const button = (name: string) => screen.getByRole("button", { name });
const amount = () => screen.getByRole("spinbutton", { name: "Generic mana amount" });

describe("the cost picker's focus when the cost empties (3b.32)", () => {
  it("Remove last on the last symbol hands the focus to the generic amount", () => {
    render(<Harness initial="{R}" />);
    const remove = button("Remove last mana symbol");
    remove.focus();
    fireEvent.click(remove);
    expect(screen.getByTestId("cost").textContent).toBe("");
    expect(remove).toHaveProperty("disabled", true);
    expect(document.activeElement).toBe(amount());
  });

  it("Remove last that leaves a symbol keeps the focus where it is", () => {
    render(<Harness initial="{1}{R}" />);
    const remove = button("Remove last mana symbol");
    remove.focus();
    fireEvent.click(remove);
    expect(screen.getByTestId("cost").textContent).toBe("{1}");
    expect(document.activeElement).toBe(remove);
  });

  it("Clear hands the focus to the generic amount", () => {
    render(<Harness initial="{2}{U}{U}" />);
    const clear = button("Clear cost");
    clear.focus();
    fireEvent.click(clear);
    expect(screen.getByTestId("cost").textContent).toBe("");
    expect(document.activeElement).toBe(amount());
  });

  it("a focus lost to <body> is handed on too", () => {
    render(<Harness initial="{G}" />);
    const clear = button("Clear cost");
    clear.focus();
    clear.blur();
    expect(document.activeElement).toBe(document.body);
    fireEvent.click(clear);
    expect(document.activeElement).toBe(amount());
  });

  it("never moves a focus that is somewhere else on the page", () => {
    render(<Harness initial="{G}" />);
    const elsewhere = button("Elsewhere");
    elsewhere.focus();
    fireEvent.click(button("Clear cost"));
    expect(screen.getByTestId("cost").textContent).toBe("");
    expect(document.activeElement).toBe(elsewhere);
  });
});
