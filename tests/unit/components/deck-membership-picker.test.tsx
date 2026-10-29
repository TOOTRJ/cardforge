// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// ---------------------------------------------------------------------------
// The shared deck picker (TODO DK9.1) and its dialog (DK9.2 / DK9.4).
//
//   * one NATIVE checkbox per deck, named by the deck and described by its
//     format and visibility — every one a tab stop; a deck holding some of
//     several cards is the checkbox's third state, and says "2 of 3 in it";
//     a busy row stays reachable (aria-disabled, never disabled) and its
//     change is ignored;
//   * a search from DECK_SEARCH_FROM decks;
//   * a ONE-card row's board and copies — the count written when it is
//     left (blur / Enter), never per keystroke;
//   * the dialog: each tick is a write at once, what happened is ONE polite
//     status line; closing it after a write asks the page to read again, and
//     the focus goes back to what opened it.
// ---------------------------------------------------------------------------

const actions = vi.hoisted(() => ({
  getDeckPickerDataAction: vi.fn(),
  changeDeckMembershipAction: vi.fn(),
}));
vi.mock("@/lib/decks/membership-actions", () => actions);
const cardActions = vi.hoisted(() => ({ updateDeckCardAction: vi.fn() }));
vi.mock("@/lib/decks/card-actions", () => cardActions);
vi.mock("@/lib/decks/actions", () => ({ createDeckAction: vi.fn() }));
vi.mock("@/components/billing/upgrade-modal-provider", () => ({ useUpgradeModal: () => ({ open: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

import { DECK_SEARCH_FROM, DeckMembershipPicker } from "@/components/decks/deck-membership-picker";
import { AddToDeckDialog } from "@/components/decks/add-to-deck-dialog";
import { AddToDeckButton } from "@/components/cards/add-to-deck-button";
import type { DeckRowState, PickerDeck } from "@/lib/decks/membership-state";

const DECKS: PickerDeck[] = [
  { id: "d1", title: "Goblins", format: "modern", visibility: "public" },
  { id: "d2", title: "Dragons", format: "commander", visibility: "private" },
  { id: "d3", title: "Burn", format: "pauper", visibility: "unlisted" },
];
const CARD = "aaaaaaaa-aaaa-4aaa-8aaa-000000000001";
const CARD_2 = "aaaaaaaa-aaaa-4aaa-8aaa-000000000002";

beforeEach(() => {
  for (const fn of [...Object.values(actions), ...Object.values(cardActions)]) fn.mockReset();
});
afterEach(cleanup);

const box = (name: string) => screen.getByRole("checkbox", { name }) as HTMLInputElement;
const descriptionOf = (el: Element) =>
  (el.getAttribute("aria-describedby") ?? "")
    .split(" ")
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" ");

describe("DeckMembershipPicker", () => {
  const rows: Record<string, DeckRowState> = {
    d1: { tick: "all", holders: 3, entry: null },
    d2: { tick: "some", holders: 2, entry: null },
    d3: { tick: "none", holders: 0, entry: null },
  };

  it("one native checkbox per deck, named by the deck, described by its format and visibility", () => {
    render(<DeckMembershipPicker decks={DECKS} rows={rows} cardCount={3} onToggle={vi.fn()} />);
    const list = screen.getByRole("list", { name: "Your decks" });
    expect(within(list).getAllByRole("checkbox")).toHaveLength(3);
    expect(box("Goblins").checked).toBe(true);
    expect(descriptionOf(box("Goblins"))).toBe("Modern · Public");
    // Some of the cards: the third state, said in words too.
    expect(box("Dragons").checked).toBe(false);
    expect(box("Dragons").indeterminate).toBe(true);
    expect(descriptionOf(box("Dragons"))).toBe("Commander · Private · 2 of 3 in it");
    expect(box("Burn").indeterminate).toBe(false);
    // Every row is a tab stop of its own.
    for (const name of ["Goblins", "Dragons", "Burn"]) expect(box(name).tabIndex).not.toBe(-1);
  });

  it("a tick adds (a mixed row adds the rest), an untick removes", () => {
    const onToggle = vi.fn();
    render(<DeckMembershipPicker decks={DECKS} rows={rows} cardCount={3} onToggle={onToggle} />);
    fireEvent.click(box("Burn"));
    fireEvent.click(box("Dragons"));
    fireEvent.click(box("Goblins"));
    expect(onToggle.mock.calls).toEqual([
      ["d3", true],
      ["d2", true],
      ["d1", false],
    ]);
  });

  it("a busy row stays reachable and named, its change ignored", () => {
    const onToggle = vi.fn();
    render(
      <DeckMembershipPicker decks={DECKS} rows={rows} cardCount={3} onToggle={onToggle} pending={new Set(["d3"])} />,
    );
    const burn = box("Burn");
    expect(burn.disabled).toBe(false);
    expect(burn.getAttribute("aria-disabled")).toBe("true");
    burn.focus();
    fireEvent.click(burn);
    expect(onToggle).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(burn);
  });

  it(`offers a search from ${DECK_SEARCH_FROM} decks`, () => {
    const few = DECKS.slice(0, 2);
    const { rerender } = render(<DeckMembershipPicker decks={few} rows={{}} cardCount={1} onToggle={vi.fn()} />);
    expect(screen.queryByRole("searchbox", { name: "Find a deck" })).toBeNull();
    const many: PickerDeck[] = Array.from({ length: DECK_SEARCH_FROM }, (_, i) => ({
      id: `m${i}`,
      title: i === 4 ? "Urza’s Saga" : `Deck ${i}`,
      format: "casual",
    }));
    rerender(<DeckMembershipPicker decks={many} rows={{}} cardCount={1} onToggle={vi.fn()} />);
    const search = screen.getByRole("searchbox", { name: "Find a deck" });
    // Typed quotes find printed ones.
    fireEvent.change(search, { target: { value: "urza's" } });
    expect(screen.getAllByRole("checkbox").map((el) => el.getAttribute("id") && (el as HTMLInputElement).labels?.[0]?.textContent)).toEqual([
      expect.stringContaining("Urza’s Saga"),
    ]);
    fireEvent.change(search, { target: { value: "zzz" } });
    expect(screen.getByRole("status").textContent).toMatch(/No deck matches “zzz”/);
  });

  it("one card's row edits its entry: the board at once, the count when it is left", () => {
    const onEntryChange = vi.fn();
    const entry = { deckId: "d1", entryId: "e1", board: "main" as const, quantity: 1 };
    render(
      <DeckMembershipPicker
        decks={DECKS}
        rows={{ d1: { tick: "all", holders: 1, entry } }}
        cardCount={1}
        onToggle={vi.fn()}
        onEntryChange={onEntryChange}
      />,
    );
    // Only the ticked row has them.
    expect(screen.getAllByRole("combobox")).toHaveLength(1);
    fireEvent.change(screen.getByRole("combobox", { name: "Board in Goblins" }), { target: { value: "side" } });
    expect(onEntryChange).toHaveBeenLastCalledWith("d1", entry, { board: "side" });
    const copies = screen.getByRole("spinbutton", { name: "Copies in Goblins" }) as HTMLInputElement;
    fireEvent.change(copies, { target: { value: "4" } });
    expect(onEntryChange).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(copies, { key: "Enter" });
    expect(onEntryChange).toHaveBeenLastCalledWith("d1", entry, { quantity: 4 });
    // Out of range: put back, nothing written.
    fireEvent.change(copies, { target: { value: "0" } });
    fireEvent.blur(copies);
    expect(copies.value).toBe("1");
    expect(onEntryChange).toHaveBeenCalledTimes(2);
  });
});

describe("AddToDeckDialog", () => {
  const loaded = (memberships: Record<string, unknown> = {}) => ({
    ok: true,
    decks: DECKS,
    memberships,
  });

  it("reads the decks when it opens, and writes each tick at once — one status line says what happened", async () => {
    actions.getDeckPickerDataAction.mockResolvedValue(
      loaded({ [CARD]: [{ deckId: "d1", entryId: "e1", board: "main", quantity: 1 }] }),
    );
    actions.changeDeckMembershipAction.mockResolvedValue({
      ok: true,
      deckId: "d3",
      deckTitle: "Burn",
      deckSlug: "burn",
      results: [{ cardId: CARD, status: "added" }],
      entries: [{ cardId: CARD, deckId: "d3", entryId: "e3", board: "main", quantity: 1 }],
    });
    const onChanged = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <AddToDeckDialog
        open
        onOpenChange={onOpenChange}
        cards={[{ id: CARD, title: "Bolt" }]}
        surface="my_cards"
        onChanged={onChanged}
      />,
    );
    expect(screen.getByRole("dialog", { name: "Add “Bolt” to a deck" })).toBeTruthy();
    await waitFor(() => expect(box("Goblins").checked).toBe(true));
    expect(actions.getDeckPickerDataAction).toHaveBeenCalledWith([CARD]);
    await act(async () => {
      fireEvent.click(box("Burn"));
    });
    expect(actions.changeDeckMembershipAction).toHaveBeenCalledWith({ deckId: "d3", add: [CARD] });
    expect(box("Burn").checked).toBe(true);
    expect(screen.getByTestId("deck-membership-status").textContent).toBe("Added to “Burn”.");
    // The new entry's board and copies are there to edit.
    expect(screen.getByRole("combobox", { name: "Board in Burn" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("a selection: partly in a deck is mixed; a full deck and a refusal are said, the rest kept", async () => {
    actions.getDeckPickerDataAction.mockResolvedValue(
      loaded({ [CARD]: [{ deckId: "d2", entryId: "e1", board: "main", quantity: 1 }] }),
    );
    actions.changeDeckMembershipAction.mockResolvedValue({
      ok: true,
      deckId: "d2",
      deckTitle: "Dragons",
      deckSlug: "dragons",
      results: [
        {
          cardId: CARD_2,
          status: "deck_full",
          error: "“Dragons” is full — a deck holds at most 500 different entries. Remove some from it, or add the card to another deck.",
        },
      ],
      entries: [],
    });
    render(
      <AddToDeckDialog
        open
        onOpenChange={vi.fn()}
        cards={[
          { id: CARD, title: "Bolt" },
          { id: CARD_2, title: "Shock" },
        ]}
        surface="my_cards"
      />,
    );
    await waitFor(() => expect(box("Dragons").indeterminate).toBe(true));
    // A selection's rows have no board / copies.
    expect(screen.queryByRole("combobox")).toBeNull();
    await act(async () => {
      fireEvent.click(box("Dragons"));
    });
    // Only the card not in it yet is sent.
    expect(actions.changeDeckMembershipAction).toHaveBeenCalledWith({ deckId: "d2", add: [CARD_2] });
    const status = screen.getByTestId("deck-membership-status");
    expect(status.getAttribute("role")).toBe("status");
    expect(status.textContent).toMatch(/“Dragons” is full — a deck holds at most 500/);
    expect(box("Dragons").indeterminate).toBe(true);
  });

  it("signed out meanwhile: says so politely (never an alert), with a way back in", async () => {
    actions.getDeckPickerDataAction.mockResolvedValue({ ok: false, error: "Sign in to add cards to decks.", signedOut: true });
    render(
      <AddToDeckDialog open onOpenChange={vi.fn()} cards={[{ id: CARD, title: "Bolt" }]} surface="gallery" signInPath="/card/someone/bolt" />,
    );
    const status = await screen.findByText(/Sign in to add cards to decks\./);
    expect(status.getAttribute("role")).toBe("status");
    expect(within(status).getByRole("link", { name: "Sign in" }).getAttribute("href")).toBe(
      "/login?redirectTo=%2Fcard%2Fsomeone%2Fbolt",
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("AddToDeckButton (the gallery, TODO DK9.4)", () => {
  const props = { cardId: CARD, cardTitle: "Bolt", cardPath: "/card/someone/bolt" };

  it("a visitor is offered sign-in, back to the card", () => {
    render(<AddToDeckButton {...props} isPublic signedIn={false} />);
    expect(screen.getByRole("link", { name: "Sign in to add to a deck" }).getAttribute("href")).toBe(
      "/login?redirectTo=%2Fcard%2Fsomeone%2Fbolt",
    );
  });

  it("a card that isn't public can't join a deck: Remix into a deck instead", () => {
    const { rerender } = render(<AddToDeckButton {...props} isPublic={false} signedIn />);
    expect(screen.getByRole("link", { name: "Remix into a deck" }).getAttribute("href")).toBe(`/create?remix=${CARD}`);
    rerender(<AddToDeckButton {...props} isPublic={false} signedIn={false} />);
    expect(screen.getByRole("link", { name: "Remix into a deck" }).getAttribute("href")).toBe(
      `/login?redirectTo=${encodeURIComponent(`/create?remix=${CARD}`)}`,
    );
    expect(screen.queryByRole("button", { name: "Add to deck" })).toBeNull();
  });

  it("signed in, a public card: the picker, and the focus back on the button when it closes", async () => {
    actions.getDeckPickerDataAction.mockResolvedValue({ ok: true, decks: DECKS, memberships: {} });
    render(<AddToDeckButton {...props} isPublic signedIn />);
    const button = screen.getByRole("button", { name: "Add to deck" });
    button.focus();
    fireEvent.click(button);
    await screen.findByRole("dialog", { name: "Add “Bolt” to a deck" });
    expect(actions.getDeckPickerDataAction).toHaveBeenCalledWith([CARD]);
    await waitFor(() => expect(box("Goblins")).toBeTruthy());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Done" }));
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Add to deck" })));
  });
});
