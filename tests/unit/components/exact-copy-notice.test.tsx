// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
const collectionActions = vi.hoisted(() => ({ state: vi.fn(), add: vi.fn() }));
vi.mock("@/lib/tools/collection/actions", () => ({
  getCollectionPrintingStateAction: collectionActions.state,
  addToCollectionAction: collectionActions.add,
}));
vi.mock("@/components/decks/deck-membership-picker", () => ({ DeckQuickCreate: () => <div data-testid="quick-create" /> }));

import { ExactCopyNotice } from "@/components/creator/exact-copy-notice";

const SCRYFALL = "581b7327-3215-4a4f-b4ae-d9d4002ba882";

beforeEach(() => {
  collectionActions.state.mockResolvedValue({ open: false });
});

afterEach(() => {
  cleanup();
  for (const fn of [...Object.values(toast), ...Object.values(deckActions), ...Object.values(collectionActions)]) fn.mockReset();
});

// The layout (2026-11-11). The notice sits in the creator's form column, so
// a VIEWPORT breakpoint says nothing about the room it has: with `sm:flex-row`
// and a button group that could not shrink, the Collection tool's second
// button left the sentence a column one word wide. happy-dom lays nothing
// out, so this holds the rules the real-browser check proved: the notice
// wraps by its own width, the sentence keeps a measure, the buttons give way.
describe("ExactCopyNotice — the sentence keeps its room beside one button or two", () => {
  const classesOf = (element: Element) => (element.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);

  async function notice(toolOpen: boolean) {
    collectionActions.state.mockResolvedValue(toolOpen ? { open: true, owned: 0 } : { open: false });
    render(<ExactCopyNotice realCardName="Llanowar Elves" scryfallId={SCRYFALL} />);
    if (toolOpen) await waitFor(() => expect(screen.getByRole("button", { name: /Add to my collection/ })).toBeTruthy());
    const box = screen.getByTestId("exact-copy-notice");
    const sentence = screen.getByRole("status");
    const group = screen.getByRole("button", { name: "Add the real card to a deck" }).parentElement!;
    return { box, sentence, group };
  }

  for (const toolOpen of [false, true]) {
    it(`${toolOpen ? "with the Collection tool's button" : "with the deck button alone"}: wraps by its own width, never a viewport breakpoint`, async () => {
      const { box, sentence, group } = await notice(toolOpen);
      expect(group.querySelectorAll("button")).toHaveLength(toolOpen ? 2 : 1);

      // One wrapping row: the buttons drop under the sentence when they don't fit beside it.
      expect(classesOf(box)).toEqual(expect.arrayContaining(["flex", "flex-wrap"]));
      for (const element of [box, sentence, group]) {
        expect(classesOf(element).filter((name) => /^(sm|md|lg|xl|2xl):/.test(name))).toEqual([]);
      }
      // The sentence asks for a readable measure and takes what is left over.
      expect(classesOf(sentence)).toEqual(expect.arrayContaining(["grow", "basis-48", "min-w-0"]));
      // The group gives way (it wraps its buttons) — it never holds its full width against the sentence.
      expect(classesOf(group)).toEqual(expect.arrayContaining(["flex", "flex-wrap", "min-w-0"]));
      expect(classesOf(group)).not.toContain("shrink-0");
      expect(group.parentElement).toBe(box);
      expect(sentence.parentElement).toBe(box);
      // No button holds a width against the notice: each may be as narrow as the column.
      for (const button of group.querySelectorAll("button")) {
        expect(classesOf(button)).toEqual(expect.arrayContaining(["min-w-0", "max-w-full"]));
        expect(classesOf(button)).not.toContain("shrink-0");
      }
    });
  }

  it("the owned count is what gives way in a narrow column — the button's own words stay whole", async () => {
    collectionActions.state.mockResolvedValue({ open: true, owned: 1204 });
    render(<ExactCopyNotice realCardName="Llanowar Elves" scryfallId={SCRYFALL} />);
    const button = await screen.findByRole("button", { name: "Add to my collection (you own 1,204)" });
    const [words, count] = [...button.querySelectorAll("span")];
    expect(words.textContent).toBe("Add to my collection");
    expect(classesOf(words)).toContain("shrink-0");
    expect(count.textContent).toBe("(you own 1,204)");
    expect(classesOf(count)).toEqual(expect.arrayContaining(["min-w-0", "truncate"]));
  });
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

  it("no collection button while the Collection Deck Builder is closed to the viewer", async () => {
    render(<ExactCopyNotice realCardName="Llanowar Elves" scryfallId={SCRYFALL} />);
    await waitFor(() => expect(collectionActions.state).toHaveBeenCalledWith(SCRYFALL));
    expect(screen.queryByRole("button", { name: /Add to my collection/ })).toBeNull();
  });

  it("adds one copy of the printing to the collection where the tool is open", async () => {
    collectionActions.state.mockResolvedValue({ open: true, owned: 2 });
    collectionActions.add.mockResolvedValue({ ok: true, name: "Llanowar Elves", owned: 3 });
    render(<ExactCopyNotice realCardName="Llanowar Elves" scryfallId={SCRYFALL} />);
    const button = await screen.findByRole("button", { name: "Add to my collection (you own 2)" });
    await act(async () => {
      fireEvent.click(button);
    });
    expect(collectionActions.add).toHaveBeenCalledWith({
      scryfallId: SCRYFALL,
      quantity: 1,
      finish: "nonfoil",
      surface: "creator",
    });
    expect(toast.success).toHaveBeenCalledWith("Added Llanowar Elves to your collection — you own 3.");
    expect(screen.getByRole("button", { name: "Add to my collection (you own 3)" })).toBeTruthy();
  });

  it("a refused add is said, and the count stays", async () => {
    collectionActions.state.mockResolvedValue({ open: true, owned: 0 });
    collectionActions.add.mockResolvedValue({ ok: false, error: "Your collection is full." });
    render(<ExactCopyNotice realCardName="Llanowar Elves" scryfallId={SCRYFALL} />);
    const button = await screen.findByRole("button", { name: "Add to my collection" });
    await act(async () => {
      fireEvent.click(button);
    });
    expect(toast.error).toHaveBeenCalledWith("Your collection is full.");
    expect(screen.getByRole("button", { name: "Add to my collection" })).toBeTruthy();
  });
});
