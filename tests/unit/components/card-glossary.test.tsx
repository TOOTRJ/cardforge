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
});
