// @vitest-environment happy-dom
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { InlinePips } from "@/components/cards/inline-pips";
import { PipTextEditor } from "@/components/creator/pip-text-editor";
import { MORE_SYMBOLS } from "@/lib/cards/more-symbols";
import { pipName, pipNameOfInner } from "@/lib/cards/pip-names";

// ---------------------------------------------------------------------------
// TODO 6.7: a pip shown as text in the UI (InlinePips — idea chips, the
// import's text — and the rules editor's chips) is a picture named by what
// it IS, never by its brace code (which a screen reader spelled out). Card
// renders never name a pip; nothing here reaches them.
// ---------------------------------------------------------------------------

afterEach(cleanup);

describe("pipName", () => {
  it.each([
    ["{T}", "tap"],
    ["{Q}", "untap"],
    ["{W}", "white mana"],
    ["{u}", "blue mana"],
    ["{C}", "colorless mana"],
    ["{2}", "2 generic mana"],
    ["{10}", "10 generic mana"],
    ["{X}", "X generic mana"],
    ["{S}", "snow mana"],
    ["{E}", "energy"],
    ["{W/U}", "white or blue mana"],
    ["{2/G}", "two generic or green mana"],
    ["{B/P}", "black Phyrexian mana"],
    ["{G/U/P}", "green or blue Phyrexian mana"],
    ["{U/G/P}", "blue or green Phyrexian mana"],
  ])("%s is %s", (code, name) => {
    expect(pipName(code)).toBe(name);
  });

  it("says the same words as the 'more symbols' group, symbol for symbol", () => {
    for (const symbol of MORE_SYMBOLS) expect(pipName(symbol.token), symbol.token).toBe(symbol.name);
  });

  it("falls back to the code for one it has no words for", () => {
    expect(pipNameOfInner("W/W/P")).toBeNull();
    expect(pipName("{foo}")).toBe("{foo}");
  });
});

describe("pips shown as text (6.7)", () => {
  it("InlinePips names each pip by what it is; the code is its tooltip", () => {
    render(<InlinePips text="{T}: Add {G}{G}. Pay {2/W}." />);
    expect(screen.getByRole("img", { name: "tap" }).getAttribute("title")).toBe("{T}");
    expect(screen.getAllByRole("img", { name: "green mana" })).toHaveLength(2);
    expect(screen.getByRole("img", { name: "two generic or white mana" })).toBeTruthy();
    expect(screen.queryByRole("img", { name: "{T}" })).toBeNull();
  });

  it("the rules editor's pip chips are named the same way", () => {
    function Harness() {
      const [value, setValue] = useState("{T}: Add {R}.");
      return <PipTextEditor aria-label="Rules text" value={value} onChange={setValue} />;
    }
    render(<Harness />);
    const tap = screen.getByRole("img", { name: "tap" });
    expect(tap.getAttribute("data-pip")).toBe("{T}");
    expect(tap.getAttribute("title")).toBe("{T}");
    expect(screen.getByRole("img", { name: "red mana" }).getAttribute("data-pip")).toBe("{R}");
  });
});
