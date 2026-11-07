// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

// ---------------------------------------------------------------------------
// The creator's exact-copy notice (components/creator/exact-copy-notice.tsx):
// "Add the real card to a deck" puts the PRINTING in one of the maker's
// decks — the real card as itself, no card slot — through the add box's own
// writer (`addToDeckAction`, pick kind "printing"). The creator's wiring of
// it: creator-import-settle-window.test.tsx.
// ---------------------------------------------------------------------------

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
const deckActions = vi.hoisted(() => ({ picker: vi.fn(), add: vi.fn() }));
vi.mock("@/lib/decks/membership-actions", () => ({ getDeckPickerDataAction: deckActions.picker }));
vi.mock("@/lib/decks/add-actions", () => ({ addToDeckAction: deckActions.add }));
vi.mock("@/components/decks/deck-membership-picker", () => ({ DeckQuickCreate: () => <div data-testid="quick-create" /> }));

import { ExactCopyNotice } from "@/components/creator/exact-copy-notice";

const SCRYFALL = "581b7327-3215-4a4f-b4ae-d9d4002ba882";

afterEach(() => {
  cleanup();
  for (const fn of [...Object.values(toast), ...Object.values(deckActions)]) fn.mockReset();
});

describe("ExactCopyNotice", () => {
  it("adds the printing itself to the deck picked, and says so", async () => {
    deckActions.picker.mockResolvedValue({
      ok: true,
      decks: [
        { id: "d1", title: "Elves", format: "commander", slug: "tester/elves" },
        { id: "d2", title: "Draft night", format: "limited" },
      ],
    });
    deckActions.add.mockResolvedValue({ ok: true });
    render(<ExactCopyNotice realCardName="Llanowar Elves" scryfallId={SCRYFALL} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add the real card to a deck" }));
    });
    await waitFor(() => expect(screen.getByRole("list", { name: "Your decks" })).toBeTruthy());
    expect(deckActions.picker).toHaveBeenCalledWith([]);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add to Elves" }));
    });
    expect(deckActions.add).toHaveBeenCalledWith({
      deckId: "d1",
      board: "main",
      pick: { kind: "printing", scryfallId: SCRYFALL, name: "Llanowar Elves" },
    });
    expect(toast.success).toHaveBeenCalledWith("Added Llanowar Elves to Elves.");
    expect(screen.getByRole("button", { name: "Add another to Elves" })).toBeTruthy();
  });

  it("a refusal is said and nothing is marked added", async () => {
    deckActions.picker.mockResolvedValue({ ok: true, decks: [{ id: "d1", title: "Elves", format: "commander" }] });
    deckActions.add.mockResolvedValue({ ok: false, error: "That deck is full (500 entries)." });
    render(<ExactCopyNotice realCardName="Llanowar Elves" scryfallId={SCRYFALL} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add the real card to a deck" }));
    });
    await waitFor(() => screen.getByRole("button", { name: "Add to Elves" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add to Elves" }));
    });
    expect(toast.error).toHaveBeenCalledWith("That deck is full (500 entries).");
    expect(screen.getByRole("button", { name: "Add to Elves" })).toBeTruthy();
  });

  it("no decks yet: says so beside the quick create", async () => {
    deckActions.picker.mockResolvedValue({ ok: true, decks: [] });
    render(<ExactCopyNotice realCardName="Llanowar Elves" scryfallId={SCRYFALL} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add the real card to a deck" }));
    });
    await waitFor(() => expect(screen.getByText("You have no decks yet — make one below.")).toBeTruthy());
    expect(screen.getByTestId("quick-create")).toBeTruthy();
  });
});
