// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// ---------------------------------------------------------------------------
// An empty deck's doors and the commander slot (TODO DK4.4): each opens a
// flow the page already has, says what it really does (no "search" — the
// add box is DK5.2), and hands the focus back to the control that opened it
// on close (DK5.12; the dialogs have no trigger of their own). The commander
// slot opens the import with its text under "Commander", and "Add from my
// cards" for the commander zone.
// ---------------------------------------------------------------------------

const s = vi.hoisted(() => ({ change: vi.fn(), move: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={String(href)} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("next/image", () => ({ default: ({ alt }: { alt: string }) => <span aria-label={alt} /> }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/components/decks/deck-creator-form", () => ({ DeckCreatorForm: () => null }));
vi.mock("@/components/decks/delete-deck-dialog", () => ({ DeleteDeckDialog: () => <button type="button">Delete deck</button> }));
vi.mock("@/lib/decks/import", () => ({ resolveDecklistAction: vi.fn(), commitDeckImportAction: vi.fn() }));
vi.mock("@/lib/decks/membership-actions", () => ({ changeDeckMembershipAction: s.change }));
vi.mock("@/lib/decks/card-actions", () => ({
  listMyCardsLiteAction: vi.fn(async () => ({
    ok: true,
    cards: [{ id: "c-1", title: "Ember Wyrm", rendered_image_url: null, rendered_thumb_url: null }],
  })),
  linkDeckCardAction: vi.fn(),
  removeDeckCardAction: vi.fn(),
  unlinkDeckCardAction: vi.fn(),
  updateDeckCardAction: s.move,
}));

import { DeckOwnerTools } from "@/components/decks/deck-owner-tools";
import { CommanderSlot, DeckStartDoors } from "@/components/decks/deck-start-doors";
import type { Deck } from "@/types/deck";

afterEach(cleanup);

const page = (commander: boolean) =>
  render(
    <>
      <DeckOwnerTools deck={{ id: "deck-1", title: "Ness" } as Deck} userId="user-1" />
      <h2 id="deck-cards-title" tabIndex={-1}>
        Cards
      </h2>
      <DeckStartDoors commander={commander} />
    </>,
  );

const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 10)));

describe("the empty deck's doors", () => {
  it("three doors, worded for what they do; a deck with a commander zone gets the slot first", () => {
    page(false);
    expect(screen.queryByRole("region", { name: "Choose your commander" })).toBeNull();
    for (const name of [/^Add cards by name/, /^Paste a decklist/, /^Add from my cards The cards/]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
    expect(document.body.textContent).not.toMatch(/search/i);
    cleanup();
    page(true);
    const slot = screen.getByRole("region", { name: "Choose your commander" });
    expect(within(slot).getByRole("button", { name: "Type the commander’s name" })).toBeTruthy();
    expect(within(slot).getByRole("button", { name: "Pick a commander from my cards" })).toBeTruthy();
  });

  it("“Add cards by name” opens the import in its own words; closing it hands the focus back to the door", async () => {
    page(false);
    const door = screen.getByRole("button", { name: /^Add cards by name/ });
    door.focus();
    await act(async () => {
      fireEvent.click(door);
    });
    const dialog = screen.getByRole("dialog", { name: "Add cards by name" });
    expect(within(dialog).getByRole("textbox", { name: "Decklist text" }).getAttribute("placeholder")).toContain("1 Sol Ring");
    await act(async () => {
      fireEvent.keyDown(dialog, { key: "Escape" });
    });
    await settle();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(door);
  });

  it("the commander slot's “Type the commander’s name” starts the text under Commander", async () => {
    page(true);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Type the commander’s name" }));
    });
    const dialog = screen.getByRole("dialog", { name: "Choose your commander" });
    expect((within(dialog).getByRole("textbox", { name: "Decklist text" }) as HTMLTextAreaElement).value).toBe("Commander\n1 ");
  });

  const membership = (status: "added" | "already", board = "main") => ({
    ok: true,
    deckId: "deck-1",
    deckTitle: "Ness",
    deckSlug: "ness",
    results: [{ cardId: "c-1", status }],
    entries: [{ cardId: "c-1", deckId: "deck-1", entryId: "entry-1", board, quantity: 1 }],
  });
  const pickCommander = async () => {
    page(true);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Pick a commander from my cards" }));
    });
    const dialog = screen.getByRole("dialog", { name: "Choose your commander" });
    const tile = await waitFor(() => within(dialog).getByRole("button", { name: /Ember Wyrm/ }));
    await act(async () => {
      fireEvent.click(tile);
    });
    await settle();
  };

  it("“Pick a commander from my cards” adds the pick through the ONE membership writer, then moves it to the commander zone", async () => {
    s.change.mockReset().mockResolvedValue(membership("added"));
    s.move.mockReset().mockResolvedValue({ ok: true, deckCardId: "entry-1" });
    await pickCommander();
    expect(s.change).toHaveBeenCalledWith({ deckId: "deck-1", add: ["c-1"] });
    expect(s.move).toHaveBeenCalledWith("entry-1", { board: "commander" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("a pick already in the deck: its mainboard entry moves to the zone; already the commander: nothing moves", async () => {
    s.change.mockReset().mockResolvedValue(membership("already"));
    s.move.mockReset().mockResolvedValue({ ok: true, deckCardId: "entry-1" });
    await pickCommander();
    expect(s.move).toHaveBeenCalledWith("entry-1", { board: "commander" });
    expect(screen.queryByRole("dialog")).toBeNull();
    cleanup();

    s.change.mockReset().mockResolvedValue(membership("already", "commander"));
    s.move.mockReset();
    await pickCommander();
    expect(s.move).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("a refused pick (a full deck, a frame preview) says why and moves nothing", async () => {
    s.change.mockReset().mockResolvedValue({ ...membership("added"), results: [{ cardId: "c-1", status: "deck_full", error: "“Ness” is full." }], entries: [] });
    s.move.mockReset();
    await pickCommander();
    expect(s.move).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Choose your commander" })).toBeTruthy();
  });

  it("the compact slot over a deck with cards and no commander says so", () => {
    render(<CommanderSlot compact />);
    expect(screen.getByRole("region", { name: "No commander yet" })).toBeTruthy();
  });
});
