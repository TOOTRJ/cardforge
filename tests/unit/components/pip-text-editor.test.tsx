// @vitest-environment happy-dom
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PipTextEditor } from "@/components/creator/pip-text-editor";

// ---------------------------------------------------------------------------
// PipTextEditor's line breaks. A trailing break only shows as an empty line
// when a "filler" <br> follows it; without one the caret stays on the line
// above and the next characters are typed in FRONT of the break.
//   • Enter at the end of a text: Range.insertNode splits the text node and
//     leaves an empty one behind the new <br>, which hid the break from the
//     filler check — "Aa", Enter, "Bb" read "AaBb\n".
//   • A browser keeps an emptied last line open with a <br> of its own; read
//     as a break it gave the text a line nobody typed ("Cc\nD", Backspace →
//     "Cc\n\n").
// Real typing is covered by tests/e2e/rules-text-editor.spec.ts.
// ---------------------------------------------------------------------------

afterEach(() => cleanup());

function Harness({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <PipTextEditor aria-label="Rules text" value={value} onChange={setValue} />
      <output data-testid="value">{JSON.stringify(value)}</output>
    </>
  );
}

function setup(initial: string) {
  render(<Harness initial={initial} />);
  const box = screen.getByRole("textbox", { name: "Rules text" });
  box.focus();
  return box;
}

const valueOf = () => JSON.parse(screen.getByTestId("value").textContent ?? '""') as string;

/** The box as tags: text, "<br>" for a break of ours, "<filler>", "<bare>". */
function shape(box: HTMLElement): string {
  return Array.from(box.childNodes)
    .map((node) => {
      if (node.nodeType === Node.TEXT_NODE) return node.nodeValue === "" ? "<empty>" : node.nodeValue;
      const el = node as Element;
      if (el.tagName !== "BR") return el.getAttribute("data-pip") ?? el.tagName;
      if (el.hasAttribute("data-filler")) return "<filler>";
      return el.hasAttribute("data-br") ? "<br>" : "<bare>";
    })
    .join("");
}

function caretAt(node: Node, offset: number) {
  const range = document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
}

describe("PipTextEditor — Enter", () => {
  it("opens a new line at the end of a text (no empty text node hides the break)", () => {
    const box = setup("Aa");
    caretAt(box.firstChild!, 2);
    fireEvent.keyDown(box, { key: "Enter" });
    expect(shape(box)).toBe("Aa<br><filler>");
    expect(valueOf()).toBe("Aa\n");
    // The caret sits on the new line: between the break and its filler.
    const selection = window.getSelection()!;
    expect(selection.anchorNode).toBe(box);
    expect(selection.anchorOffset).toBe(2);
  });

  it("splits a line in the middle and at its start", () => {
    const box = setup("AaBb");
    caretAt(box.firstChild!, 2);
    fireEvent.keyDown(box, { key: "Enter" });
    expect(shape(box)).toBe("Aa<br>Bb");
    expect(valueOf()).toBe("Aa\nBb");
    caretAt(box.firstChild!, 0);
    fireEvent.keyDown(box, { key: "Enter" });
    expect(shape(box)).toBe("<br>Aa<br>Bb");
    expect(valueOf()).toBe("\nAa\nBb");
  });

  it("opens a line in an empty box", () => {
    const box = setup("");
    caretAt(box, 0);
    fireEvent.keyDown(box, { key: "Enter" });
    expect(shape(box)).toBe("<br><filler>");
    expect(valueOf()).toBe("\n");
  });
});

describe("PipTextEditor — the browser's own placeholder break", () => {
  it("is the filler of an emptied last line, never a second break", () => {
    const box = setup("Cc\nD");
    expect(shape(box)).toBe("Cc<br>D");
    // What Chrome leaves after Backspace deletes the "D".
    box.lastChild!.remove();
    box.appendChild(document.createElement("br"));
    fireEvent.input(box);
    expect(shape(box)).toBe("Cc<br><filler>");
    expect(valueOf()).toBe("Cc\n");
  });

  it("is dropped after a line that still has text", () => {
    const box = setup("Cc");
    box.appendChild(document.createElement("br"));
    fireEvent.input(box);
    expect(shape(box)).toBe("Cc");
    expect(valueOf()).toBe("Cc");
  });

  it("clears a box that holds nothing else", () => {
    const box = setup("C");
    box.replaceChildren(document.createElement("br"));
    fireEvent.input(box);
    expect(shape(box)).toBe("");
    expect(valueOf()).toBe("");
  });
});

describe("PipTextEditor — a value from outside", () => {
  it("draws its breaks as the editor's own, with a filler after a trailing one", () => {
    const box = setup("Aa\n{T}: Add {G}.\n");
    expect(shape(box)).toBe("Aa<br>{T}: Add {G}.<br><filler>");
    expect(valueOf()).toBe("Aa\n{T}: Add {G}.\n");
  });
});
