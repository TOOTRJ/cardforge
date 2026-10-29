// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { DeckCoverPicks } from "@/components/decks/deck-cover-picks";
import type { CoverPickRow } from "@/lib/decks/featured";

// ---------------------------------------------------------------------------
// "Feature on cover" in a deck entry's pop-up (TODO DK6.4): the toggle, the
// picks' order shown, Earlier / Later — buttons, never a drag — every change
// the deck's WHOLE list, rank 1 first. Five at most (the toggle is
// aria-disabled with its reason, never a click handler); a commander and the
// maybeboard are no pick; a pick the fan can't show says so.
// ---------------------------------------------------------------------------

afterEach(() => cleanup());

const row = (entryId: string, name: string, shown = true): CoverPickRow => ({ entryId, name, shown });
const PICKS = [row("e1", "Sol Ring"), row("e2", "Cinderwing Broodling"), row("e3", "Secret", false)];

function picks(entryId: string, list: CoverPickRow[] = PICKS, extra: Partial<Parameters<typeof DeckCoverPicks>[0]> = {}) {
  const onChange = vi.fn();
  render(
    <DeckCoverPicks entryId={entryId} board="main" picks={list} shown pending={false} onChange={onChange} {...extra} />,
  );
  return onChange;
}

describe("DeckCoverPicks", () => {
  it("an unpicked card: Feature on cover appends it to the list", () => {
    const onChange = picks("e9");
    fireEvent.click(screen.getByRole("button", { name: "Feature on cover" }));
    expect(onChange).toHaveBeenCalledWith(["e1", "e2", "e3", "e9"]);
    expect(screen.getByText("3 of 5 cover picks used.")).toBeTruthy();
  });

  it("shows the picks in order, this card marked", () => {
    picks("e2");
    const list = screen.getByRole("list", { name: "Cards on the cover, in order" });
    expect(within(list).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "1.Sol Ring",
      "2.Cinderwing Broodling (this card)",
      "3.Secret· not shown",
    ]);
    expect(screen.getByText(/On the cover — 2nd of 3 picks, after the commanders\./)).toBeTruthy();
  });

  it("a picked card: Remove from cover, Earlier and Later send the whole new order", () => {
    const onChange = picks("e2");
    fireEvent.click(screen.getByRole("button", { name: "Move earlier on the cover" }));
    expect(onChange).toHaveBeenLastCalledWith(["e2", "e1", "e3"]);
    fireEvent.click(screen.getByRole("button", { name: "Move later on the cover" }));
    expect(onChange).toHaveBeenLastCalledWith(["e1", "e3", "e2"]);
    fireEvent.click(screen.getByRole("button", { name: "Remove from cover" }));
    expect(onChange).toHaveBeenLastCalledWith(["e1", "e3"]);
  });

  it("at an end, Earlier / Later stay — aria-disabled, no handler — so the focus never drops", () => {
    const onChange = picks("e1");
    const earlier = screen.getByRole("button", { name: "Move earlier on the cover" });
    expect(earlier.getAttribute("aria-disabled")).toBe("true");
    expect(earlier.hasAttribute("disabled")).toBe(false);
    fireEvent.click(earlier);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Move later on the cover" }).getAttribute("aria-disabled")).toBeNull();
  });

  it("five picks: the toggle is aria-disabled with its reason, and does nothing", () => {
    const five = ["a", "b", "c", "d", "e"].map((id) => row(id, id.toUpperCase()));
    const onChange = picks("z", five);
    const toggle = screen.getByRole("button", { name: "Feature on cover" });
    expect(toggle.getAttribute("aria-disabled")).toBe("true");
    const reason = document.getElementById(toggle.getAttribute("aria-describedby")!);
    expect(reason?.textContent).toMatch(/5 cards are featured — remove one to feature this\./);
    fireEvent.click(toggle);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("while a change is saving, nothing sends a second one", () => {
    const onChange = vi.fn();
    render(<DeckCoverPicks entryId="e2" board="main" picks={PICKS} shown pending onChange={onChange} />);
    for (const name of ["Remove from cover", "Move earlier on the cover", "Move later on the cover"]) {
      fireEvent.click(screen.getByRole("button", { name }));
    }
    expect(onChange).not.toHaveBeenCalled();
  });

  it("a commander or a maybeboard card is no pick — one line says why", () => {
    picks("c1", PICKS, { board: "commander" });
    expect(screen.queryByRole("button", { name: "Feature on cover" })).toBeNull();
    expect(screen.getByText("Commanders always lead the cover.")).toBeTruthy();
    cleanup();
    picks("m1", PICKS, { board: "maybe" });
    expect(screen.getByText("The maybeboard isn't shown on the cover.")).toBeTruthy();
  });

  it("a card picked before it moved to the maybeboard can still be taken off", () => {
    const onChange = picks("e1", PICKS, { board: "maybe" });
    fireEvent.click(screen.getByRole("button", { name: "Remove from cover" }));
    expect(onChange).toHaveBeenCalledWith(["e2", "e3"]);
  });

  it("a card the fan can't show (private, no picture) may be picked, and says it is skipped", () => {
    picks("e3", PICKS, { shown: false });
    expect(screen.getByText(/can't be shown on the cover .* the next card takes its place/)).toBeTruthy();
  });
});
