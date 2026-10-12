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
// And its pips: to Chrome a line that STARTS with a contenteditable=false
// node has no caret place in front of it, so Backspace / Delete on a pip — and
// on the break in front of one — are the editor's own ("Cc", Enter, "{t}",
// Backspace did nothing).
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

describe("PipTextEditor — Backspace and Delete on a pip", () => {
  const caret = () => {
    const selection = window.getSelection()!;
    return [selection.anchorNode, selection.anchorOffset] as const;
  };

  it("Backspace removes a pip that is all the last line holds, and keeps the line", () => {
    const box = setup("Cc\n{T}");
    caretAt(box, 3);
    expect(fireEvent.keyDown(box, { key: "Backspace" })).toBe(false);
    expect(shape(box)).toBe("Cc<br><filler>");
    expect(valueOf()).toBe("Cc\n");
    // Still on the emptied line: between the break and its filler.
    expect(caret()).toEqual([box, 2]);
  });

  it("Backspace removes the pip in front of a text the caret starts", () => {
    const box = setup("a{T}b");
    caretAt(box.lastChild!, 0);
    fireEvent.keyDown(box, { key: "Backspace" });
    expect(shape(box)).toBe("ab");
    expect(valueOf()).toBe("ab");
    expect(caret()).toEqual([box.firstChild, 1]);
  });

  it("empties a box that held one pip", () => {
    const box = setup("{T}");
    caretAt(box, 1);
    fireEvent.keyDown(box, { key: "Backspace" });
    expect(shape(box)).toBe("");
    expect(valueOf()).toBe("");
  });

  it("Delete removes the pip a line starts with, and keeps the break above it", () => {
    const box = setup("Cc\n{T}");
    caretAt(box, 2);
    expect(fireEvent.keyDown(box, { key: "Delete" })).toBe(false);
    expect(shape(box)).toBe("Cc<br><filler>");
    expect(valueOf()).toBe("Cc\n");
    expect(caret()).toEqual([box, 2]);
  });

  it("Delete removes the pip behind a text the caret ends", () => {
    const box = setup("a{T}{G}");
    caretAt(box.firstChild!, 1);
    fireEvent.keyDown(box, { key: "Delete" });
    expect(shape(box)).toBe("a{G}");
    expect(valueOf()).toBe("a{G}");
  });

  // Home on a line a pip starts leaves Chrome's caret inside that pip.
  it("reads a caret inside a pip as the place in front of it", () => {
    const box = setup("Cc\n{T}ab");
    caretAt(box.childNodes[2], 0);
    fireEvent.keyDown(box, { key: "Delete" });
    expect(shape(box)).toBe("Cc<br>ab");
    expect(valueOf()).toBe("Cc\nab");
    expect(caret()).toEqual([box.lastChild, 0]);
  });

  it("joins the lines when the break in front of a pip is deleted from either side", () => {
    // Chrome's own Delete here took the break AND the pip.
    const above = setup("Cc\n{T}\ndd");
    caretAt(above.firstChild!, 2);
    fireEvent.keyDown(above, { key: "Delete" });
    expect(shape(above)).toBe("Cc{T}<br>dd");
    expect(valueOf()).toBe("Cc{T}\ndd");
    expect(caret()).toEqual([above.firstChild, 2]);
    cleanup();

    const below = setup("Cc\n{T}ab");
    caretAt(below.childNodes[2], 0);
    fireEvent.keyDown(below, { key: "Backspace" });
    expect(shape(below)).toBe("Cc{T}ab");
    expect(valueOf()).toBe("Cc{T}ab");
  });

  it("leaves characters, other breaks, selections and Cmd+Backspace to the browser", () => {
    const box = setup("Aa\nBb{T}");
    // Not prevented: fireEvent returns true.
    caretAt(box.firstChild!, 1);
    expect(fireEvent.keyDown(box, { key: "Backspace" })).toBe(true);
    expect(fireEvent.keyDown(box, { key: "Delete" })).toBe(true);
    caretAt(box.firstChild!, 2);
    expect(fireEvent.keyDown(box, { key: "Delete" })).toBe(true);
    caretAt(box.childNodes[2], 0);
    expect(fireEvent.keyDown(box, { key: "Backspace" })).toBe(true);
    caretAt(box, 4);
    expect(fireEvent.keyDown(box, { key: "Backspace", metaKey: true })).toBe(true);
    const range = document.createRange();
    range.setStart(box.childNodes[2], 1);
    range.setEnd(box, 4);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    expect(fireEvent.keyDown(box, { key: "Backspace" })).toBe(true);
    expect(shape(box)).toBe("Aa<br>Bb{T}");
    expect(valueOf()).toBe("Aa\nBb{T}");
  });
});
