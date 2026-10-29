// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CardGlossary, GLOSSARY_TERMS } from "@/components/creator/card-glossary";

// ---------------------------------------------------------------------------
// The card-origin vocabulary (owner 2026-10-28, TODO DK2.1): ONE glossary,
// four words — Proxy, Import, Remix, Original — and "custom proxy" nowhere.
// ---------------------------------------------------------------------------

afterEach(cleanup);

describe("the card glossary", () => {
  it("defines the four words, in order, and never “custom proxy”", () => {
    expect(GLOSSARY_TERMS.map((t) => t.term)).toEqual(["Proxy", "Import", "Remix", "Original"]);
    for (const { term, definition } of GLOSSARY_TERMS) {
      expect(`${term} ${definition}`).not.toMatch(/custom proxy/i);
    }
  });

  it("opens from its chip and lists every word", async () => {
    render(<CardGlossary />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Proxy, import or remix?" }));
    });
    const dialog = screen.getByRole("dialog", { name: "Proxy, import, remix, original" });
    for (const term of ["Proxy", "Import", "Remix", "Original"]) {
      expect(dialog.querySelector("dl")?.textContent).toContain(term);
    }
    expect(dialog.textContent).not.toMatch(/custom proxy/i);
  });

  // Since TODO NV9 the words come from lib/content/glossary.ts, the list
  // /glossary reads too: the dialog says what #654 wrote — the same four
  // entries, the same order, nothing added — but for Import, which no longer
  // names the frame (a frame change alone doesn't make a card your version;
  // review of #659, 2026-10-29).
  it("renders the four entries word for word, in order, and nothing else", async () => {
    render(<CardGlossary />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Proxy, import or remix?" }));
    });
    const dialog = screen.getByRole("dialog", { name: "Proxy, import, remix, original" });
    expect(dialog.textContent).toContain("The words PipGlyph uses for where a card starts.");
    const pairs = [...dialog.querySelectorAll("dl > div")].map((row) => [
      row.querySelector("dt")?.textContent,
      row.querySelector("dd")?.textContent,
    ]);
    expect(pairs).toEqual([
      [
        "Proxy",
        "Any card made on PipGlyph. A card you start from a real Magic card is a proxy too, and any proxy can be printed for your table.",
      ],
      [
        "Import",
        "A card started from a real card, pulled in from Scryfall. Change its art or words and it becomes your version.",
      ],
      [
        "Remix",
        "A new card started from another card made on PipGlyph, whether someone else's or one of yours. The card it came from keeps its credit.",
      ],
      ["Original", "A card made from scratch."],
    ]);
    expect(dialog.querySelectorAll("dd")).toHaveLength(4);
    expect(dialog.querySelectorAll("a")).toHaveLength(0);
  });
});
