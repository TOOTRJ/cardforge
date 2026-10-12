// @vitest-environment happy-dom
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
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
// Backspace did nothing). The place itself is a "caret host": a text node
// holding one zero-width space in front of every pip a break precedes — never
// part of the value — so typing there is the browser's own.
// And a <br> Chrome puts in front of a pip whose text was deleted is no line.
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

/**
 * The box as tags: text, "<br>" for a break of ours, "<filler>", "<bare>", and
 * "<caret>" for the zero-width character of a caret host.
 */
function shape(box: HTMLElement): string {
  return Array.from(box.childNodes)
    .map((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        return node.nodeValue === "" ? "<empty>" : node.nodeValue!.replaceAll("\u200B", "<caret>");
      }
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
    expect(shape(box)).toBe("Aa<br><caret>{T}: Add {G}.<br><filler>");
    expect(valueOf()).toBe("Aa\n{T}: Add {G}.\n");
  });
});

describe("PipTextEditor — a value from outside while the box is not focused", () => {
  // The blur conversion (print typography) rewrites the text right after the
  // caret left the box. A selection set inside a contenteditable focuses it,
  // so the editor must not touch the selection then: the box took the focus
  // back and the next field's typing landed at the start of the rules text.
  function Outside() {
    const [value, setValue] = useState("it's\n{T}: go");
    return (
      <>
        <PipTextEditor aria-label="Rules text" value={value} onChange={setValue} />
        <input aria-label="Power" />
        <button type="button" onClick={() => setValue("it\u2019s\n{T}: go")}>
          convert
        </button>
      </>
    );
  }

  it("leaves the selection alone, so the focus stays where it went", () => {
    render(<Outside />);
    const box = screen.getByRole("textbox", { name: "Rules text" });
    box.focus();
    caretAt(box, 0);
    const power = screen.getByRole("textbox", { name: "Power" });
    power.focus();
    const addRange = vi.spyOn(window.getSelection()!, "addRange");
    fireEvent.click(screen.getByRole("button", { name: "convert" }));
    expect(shape(box)).toContain("it\u2019s");
    expect(addRange).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(power);
    addRange.mockRestore();
  });

  it("still moves the caret onto a new host while the box is focused", () => {
    render(<Outside />);
    const box = screen.getByRole("textbox", { name: "Rules text" });
    box.focus();
    caretAt(box, 0);
    const addRange = vi.spyOn(window.getSelection()!, "addRange");
    fireEvent.click(screen.getByRole("button", { name: "convert" }));
    expect(addRange).toHaveBeenCalled();
    addRange.mockRestore();
  });
});

describe("PipTextEditor — Backspace and Delete on a pip", () => {
  const caret = () => {
    const selection = window.getSelection()!;
    return [selection.anchorNode, selection.anchorOffset] as const;
  };

  it("Backspace removes a pip that is all the last line holds, and keeps the line", () => {
    const box = setup("Cc\n{T}");
    caretAt(box, 4);
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
    caretAt(box.childNodes[2], 1);
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

  // A click on a pip leaves Chrome's caret inside it.
  it("reads a caret inside a pip as the place in front of it", () => {
    const box = setup("Cc\n{T}ab");
    caretAt(box.childNodes[3], 0);
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

    // From the caret host, on either side of its character.
    for (const offset of [0, 1]) {
      const below = setup("Cc\n{T}ab");
      caretAt(below.childNodes[2], offset);
      fireEvent.keyDown(below, { key: "Backspace" });
      expect(shape(below)).toBe("Cc{T}ab");
      expect(valueOf()).toBe("Cc{T}ab");
      expect(caret()).toEqual([below.firstChild, 2]);
      cleanup();
    }
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

describe("PipTextEditor — the place in front of a pip that starts a line", () => {
  const HOST = "\u200B";
  const caret = () => {
    const selection = window.getSelection()!;
    return [selection.anchorNode, selection.anchorOffset] as const;
  };

  it("is a caret host behind every break a pip follows, and never part of the value", () => {
    const box = setup("{T}a\n{G}\nb{W}\n\n{U}");
    expect(shape(box)).toBe("{T}a<br><caret>{G}<br>b{W}<br><br><caret>{U}");
    expect(valueOf()).toBe("{T}a\n{G}\nb{W}\n\n{U}");
    // A copy of everything reads the same.
    const range = document.createRange();
    range.selectNodeContents(box);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    let copied = "";
    fireEvent.copy(box, { clipboardData: { setData: (_: string, text: string) => (copied = text) } });
    expect(copied).toBe("{T}a\n{G}\nb{W}\n\n{U}");
  });

  // What Chrome leaves after a key in the host: the character beside the host's.
  it.each([
    ["behind the host's character", `${HOST}k`, 2],
    ["in front of it", `k${HOST}`, 1],
  ])("keeps a character typed there on the pip's line (%s)", (_, typed, at) => {
    const box = setup("Cc\n{T}ab");
    const host = box.childNodes[2];
    host.nodeValue = typed;
    caretAt(host, at);
    fireEvent.input(box);
    expect(shape(box)).toBe("Cc<br>k{T}ab");
    expect(valueOf()).toBe("Cc\nk{T}ab");
    expect(caret()).toEqual([box.childNodes[2], 1]);
  });

  it("turns a code typed there into a pip, with the host in front of the new one", () => {
    const box = setup("Cc\n{T}ab");
    const host = box.childNodes[2];
    host.nodeValue = `${HOST}{g}`;
    caretAt(host, 4);
    fireEvent.input(box);
    expect(shape(box)).toBe("Cc<br><caret>{G}{T}ab");
    expect(valueOf()).toBe("Cc\n{G}{T}ab");
    // Behind the new pip.
    expect(caret()).toEqual([box, 4]);
  });

  it("takes a paste there", () => {
    const box = setup("Cc\n{T}");
    caretAt(box.childNodes[2], 1);
    fireEvent.paste(box, { clipboardData: { getData: () => "x{g}" } });
    expect(shape(box)).toBe("Cc<br>x{G}{T}");
    expect(valueOf()).toBe("Cc\nx{G}{T}");
  });

  it("appears when the text in front of a pip is deleted, and takes the caret Chrome left on the line above", () => {
    const box = setup("Cc\na{T}");
    expect(shape(box)).toBe("Cc<br>a{T}");
    box.childNodes[2].remove();
    caretAt(box.firstChild!, 2);
    fireEvent.input(box);
    expect(shape(box)).toBe("Cc<br><caret>{T}");
    expect(valueOf()).toBe("Cc\n{T}");
    expect(caret()).toEqual([box.childNodes[2], 1]);
  });

  it("appears under an Enter in front of a pip, with the caret on it", () => {
    const box = setup("Cc{T}");
    caretAt(box.firstChild!, 2);
    fireEvent.keyDown(box, { key: "Enter" });
    expect(shape(box)).toBe("Cc<br><caret>{T}");
    expect(valueOf()).toBe("Cc\n{T}");
    expect(caret()).toEqual([box.childNodes[2], 1]);
  });

  it("is stepped over by ← and → in one press", () => {
    const box = setup("Cc\n{T}x\n{G}");
    const [above, , host, , behind, , lastHost] = Array.from(box.childNodes);
    for (const offset of [0, 1]) {
      caretAt(host, offset);
      expect(fireEvent.keyDown(box, { key: "ArrowLeft" })).toBe(false);
      expect(caret()).toEqual([above, 2]);
      caretAt(host, offset);
      expect(fireEvent.keyDown(box, { key: "ArrowRight" })).toBe(false);
      expect(caret()).toEqual([behind, 0]);
    }
    // No text on either side: the places are the box's own.
    caretAt(lastHost, 1);
    fireEvent.keyDown(box, { key: "ArrowRight" });
    expect(caret()).toEqual([box, 8]);
    // Everywhere else, and with a modifier, the arrows are the browser's.
    caretAt(lastHost, 1);
    expect(fireEvent.keyDown(box, { key: "ArrowLeft", shiftKey: true })).toBe(true);
    caretAt(above, 2);
    expect(fireEvent.keyDown(box, { key: "ArrowRight" })).toBe(true);
    caretAt(behind, 0);
    expect(fireEvent.keyDown(box, { key: "ArrowLeft" })).toBe(true);
  });

  // A click on a pip lands inside it, where Chrome announces no typing.
  it("moves a caret left inside a pip to the place beside it", () => {
    const box = setup("a{T}\n{G}");
    caretAt(box.childNodes[1], 0);
    act(() => void document.dispatchEvent(new Event("selectionchange")));
    expect(caret()).toEqual([box.firstChild, 1]);
    caretAt(box.childNodes[4].firstChild!, 0);
    act(() => void document.dispatchEvent(new Event("selectionchange")));
    expect(caret()).toEqual([box.childNodes[3], 1]);
    caretAt(box.childNodes[4], 1);
    act(() => void document.dispatchEvent(new Event("selectionchange")));
    expect(caret()).toEqual([box, 5]);
  });

  it("leaves a text being composed whole until the composition ends", () => {
    const box = setup("Cc\n{T}");
    const host = box.childNodes[2];
    fireEvent.compositionStart(box);
    host.nodeValue = `${HOST}か`;
    caretAt(host, 2);
    fireEvent.input(box);
    expect(box.childNodes[2].nodeValue).toBe(`${HOST}か`);
    expect(valueOf()).toBe("Cc\nか{T}");
    fireEvent.compositionEnd(box);
    expect(shape(box)).toBe("Cc<br>か{T}");
    expect(caret()).toEqual([box.childNodes[2], 1]);
  });
});

describe("PipTextEditor — a break the browser put in front of a pip", () => {
  // "a{T}{G}", Delete on the "a": Chrome leaves <br>{T}{G}.
  it("is no line: dropped at the start of the box", () => {
    const box = setup("a{T}{G}");
    box.firstChild!.remove();
    box.insertBefore(document.createElement("br"), box.firstChild);
    caretAt(box, 0);
    fireEvent.input(box);
    expect(shape(box)).toBe("{T}{G}");
    expect(valueOf()).toBe("{T}{G}");
    expect(window.getSelection()!.anchorNode).toBe(box);
    expect(window.getSelection()!.anchorOffset).toBe(0);
  });

  it("is dropped in the middle of the box too, and our own breaks stay", () => {
    const box = setup("Aa\n\nb{T}");
    box.childNodes[3].remove();
    box.insertBefore(document.createElement("br"), box.childNodes[3]);
    fireEvent.input(box);
    expect(shape(box)).toBe("Aa<br><br><caret>{T}");
    expect(valueOf()).toBe("Aa\n\n{T}");
  });
});
