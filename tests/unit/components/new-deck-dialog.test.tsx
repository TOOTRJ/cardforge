// @vitest-environment happy-dom
import { useState, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";

// ---------------------------------------------------------------------------
// The New deck dialog (TODO DK4.1 / DK4.3 / DK4.5) — the one short way to
// start a deck:
//   * the name needs one character (createDeckSchema's rule): an empty or
//     blank one is refused in the dialog, the input marked and focused;
//   * the format row is ONE single-select chip row — one tab stop, the arrow
//     keys move the focus and never pick, a press picks; Commander first;
//     "More" adds the other formats to the same row, and a preselected one
//     outside the first five is shown even folded;
//   * a pasted list: the saved-card forecast as the textarea's description,
//     the lines it can't read named; on Create the deck is made, THEN the
//     list goes through the import (resolve → commit) and the deck opens —
//     only EXACT matches as cards: a best guess is kept as the name typed (a
//     placeholder), never the guessed card, and the toast names those lines
//     and the skipped ones; a list the import refuses keeps
//     the deck, says the import's own words, and offers the list again or
//     the deck page — and so does a lost connection once the deck exists;
//     nothing ever makes a second deck (Create holds the focus,
//     aria-disabled, while the first is made; a press after a lost answer
//     asks for that deck back) or adds the list twice (firstImportOnly);
//   * closed, the focus goes back to what opened it — not after a create,
//     which opens the deck;
//   * an empty deck opens with `?new=1` (its add control focused);
//   * signed out, Create asks to sign up or sign in, keeps the input in
//     sessionStorage (never the URL) and brings it back on the next open; a
//     server that answers "sign in" does the same; a dismissal drops it.
// Decks are unlimited on every plan: the dialog shows no deck meter.
// ---------------------------------------------------------------------------

const s = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  createDeck: vi.fn(),
  resolve: vi.fn(),
  commit: vi.fn(),
  toastSuccess: vi.fn(),
  toastMessage: vi.fn(),
  signedInCookie: true,
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: s.push, refresh: s.refresh, replace: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode } & Record<string, unknown>) => (
    <a href={String(href)} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: s.toastSuccess, message: s.toastMessage } }));
vi.mock("@/lib/decks/actions", () => ({ createDeckAction: s.createDeck, updateDeckAction: vi.fn(), deleteDeckAction: vi.fn() }));
vi.mock("@/lib/decks/import", () => ({ resolveDecklistAction: s.resolve, commitDeckImportAction: s.commit }));
vi.mock("@/lib/supabase/session-cookie", () => ({ hasSupabaseSessionCookie: () => s.signedInCookie }));

import { NewDeckDialog, quickImportNotes } from "@/components/decks/new-deck-dialog";
import { readNewDeckDraft, saveNewDeckDraft } from "@/lib/decks/new-deck";

const onClosed = vi.fn();

function contextResponse(body: Record<string, unknown>) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })));
}

async function openDialog(request: { format?: "standard" | "legacy"; cardId?: string } = {}) {
  render(<NewDeckDialog open request={{ key: 1, ...request }} onClosed={onClosed} />);
  // GET /api/me lands.
  await act(async () => {});
}

const nameInput = () => screen.getByRole("textbox", { name: "Deck name" }) as HTMLInputElement;
const listInput = () => screen.getByRole("textbox", { name: "Paste a decklist (optional)" }) as HTMLTextAreaElement;
const createButton = () => screen.getByRole("button", { name: /^create deck$/i });
const radio = (name: string) => screen.getByRole("radio", { name });

async function press(element: Element) {
  await act(async () => {
    fireEvent.click(element);
  });
}

async function type(element: Element, value: string) {
  await act(async () => {
    fireEvent.change(element, { target: { value } });
  });
}

const RESOLVED_LINES = [
  { line: 1, raw: "4 Mountain", name: "Mountain", quantity: 4, board: "main", status: "resolved", resolved: { scryfall_id: "a0000000-0000-4000-8000-000000000001", name: "Mountain" } },
  { line: 2, raw: "2 Island", name: "Island", quantity: 2, board: "main", status: "resolved", resolved: { scryfall_id: "a0000000-0000-4000-8000-000000000002", name: "Island" } },
];

beforeEach(() => {
  s.push.mockReset();
  s.refresh.mockReset();
  s.toastSuccess.mockReset();
  s.toastMessage.mockReset();
  s.createDeck.mockReset().mockResolvedValue({ ok: true, deckId: "deck-1", slug: "goblin-swarm" });
  s.resolve.mockReset().mockResolvedValue({ ok: true, title: null, lines: RESOLVED_LINES, parseWarnings: [] });
  s.commit.mockReset().mockResolvedValue({ ok: true, added: 2, merged: 0, placeholders: 0 });
  s.signedInCookie = true;
  onClosed.mockReset();
  window.sessionStorage.clear();
  contextResponse({ user: { id: "u1" }, cardCapacity: null });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the name", () => {
  it("is required — an empty or blank name is refused here, the input marked and focused", async () => {
    await openDialog();
    expect(screen.getByRole("dialog", { name: "New deck" })).toBeTruthy();
    await press(createButton());
    expect(s.createDeck).not.toHaveBeenCalled();
    expect(nameInput().getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(nameInput().getAttribute("aria-describedby") ?? "")?.textContent).toBe(
      "Give the deck a name.",
    );
    expect(document.activeElement).toBe(nameInput());

    await type(nameInput(), "   ");
    await press(createButton());
    expect(s.createDeck).not.toHaveBeenCalled();

    // One character is enough (the server's rule), trimmed.
    await type(nameInput(), " X ");
    expect(nameInput().getAttribute("aria-invalid")).toBeNull();
    await press(createButton());
    expect(s.createDeck).toHaveBeenCalledWith(
      { title: "X", format: "commander", visibility: "public" },
      { redirectAfterCreate: false, surface: "dialog", firstCardId: undefined },
    );
  });

  it("a name the server refuses is shown on the field", async () => {
    s.createDeck.mockResolvedValue({ ok: false, fieldErrors: { title: "Title must be 120 characters or fewer." } });
    await openDialog();
    await type(nameInput(), "Goblin Swarm");
    await press(createButton());
    expect(nameInput().getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(nameInput());
    expect(s.push).not.toHaveBeenCalled();
  });
});

describe("the format chips", () => {
  it("are one tab stop on Commander; the arrows move the focus and never pick; a press picks", async () => {
    await openDialog();
    const group = screen.getByRole("radiogroup", { name: "Format" });
    const chips = within(group).getAllByRole("radio");
    expect(chips.map((chip) => chip.textContent)).toEqual(["Commander", "Standard", "Modern", "Pauper", "Brawl"]);
    expect(radio("Commander").getAttribute("aria-checked")).toBe("true");
    expect(chips.filter((chip) => chip.tabIndex === 0)).toEqual([radio("Commander")]);

    radio("Commander").focus();
    fireEvent.keyDown(radio("Commander"), { key: "ArrowRight" });
    expect(document.activeElement).toBe(radio("Standard"));
    expect(radio("Commander").getAttribute("aria-checked")).toBe("true");
    fireEvent.keyDown(radio("Standard"), { key: "ArrowLeft" });
    fireEvent.keyDown(radio("Commander"), { key: "ArrowLeft" });
    expect(document.activeElement).toBe(radio("Brawl")); // wraps

    await press(radio("Pauper"));
    expect(radio("Pauper").getAttribute("aria-checked")).toBe("true");
    expect(radio("Commander").getAttribute("aria-checked")).toBe("false");
    // The row's description is its helper.
    const helper = document.getElementById(group.getAttribute("aria-describedby") ?? "");
    expect(helper?.textContent).toBe("Sets the deck's size and copy limits.");
  });

  it("More adds the other formats to the same row; folding keeps the picked one", async () => {
    await openDialog();
    const more = screen.getByRole("button", { name: "More formats" });
    expect(more.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("radio", { name: "Legacy" })).toBeNull();
    await press(more);
    expect(more.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getAllByRole("radiogroup")).toHaveLength(1);
    expect(screen.getAllByRole("radio").map((chip) => chip.textContent)).toEqual([
      "Commander",
      "Standard",
      "Modern",
      "Pauper",
      "Brawl",
      "Pioneer",
      "Legacy",
      "Vintage",
      "Standard Brawl",
      "Oathbreaker",
      "Limited (40-card)",
      "Casual",
    ]);
    await press(radio("Oathbreaker"));
    await press(more);
    expect(screen.getAllByRole("radio").map((chip) => chip.textContent)).toEqual([
      "Commander",
      "Standard",
      "Modern",
      "Pauper",
      "Brawl",
      "Oathbreaker",
    ]);
    expect(radio("Oathbreaker").getAttribute("aria-checked")).toBe("true");
    await type(nameInput(), "Tiny Leaders");
    await press(createButton());
    expect(s.createDeck.mock.calls[0][0]).toMatchObject({ format: "oathbreaker" });
  });

  it("a preselected format outside the first five shows, picked, while folded", async () => {
    await openDialog({ format: "legacy" });
    expect(radio("Legacy").getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("button", { name: "More formats" }).getAttribute("aria-expanded")).toBe("false");
  });
});

describe("a pasted list", () => {
  it("is forecast against the saved-card slots, as the textarea's description — never a block", async () => {
    contextResponse({ user: { id: "u1" }, cardCapacity: { used: 12, cap: 50, tier: "free" } });
    await openDialog();
    await type(listInput(), "4 Mountain\n2 Island");
    const described = (listInput().getAttribute("aria-describedby") ?? "").split(" ");
    const texts = described.map((id) => document.getElementById(id)?.textContent ?? "");
    expect(texts).toContain(
      "These 6 cards (2 different) use no saved-card slots. Each different card you customize uses 1 — you have 38 left.",
    );
    expect(createButton().hasAttribute("disabled")).toBe(false);

    // A line it can't read is counted, never a block.
    await type(listInput(), "4 Mountain\n2 Island\njust some words");
    expect(screen.getByText(/^1 line skipped or adjusted/)).toBeTruthy();
    expect(createButton().getAttribute("aria-disabled")).toBeNull();
  });

  it("Create holds the focus while the deck is made, and a second press makes no second deck", async () => {
    let finish: (value: unknown) => void = () => {};
    s.createDeck.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    await openDialog();
    await type(nameInput(), "Goblin Swarm");
    createButton().focus();
    await press(screen.getByRole("button", { name: /^create deck$/i }));
    const busy = screen.getByRole("button", { name: /creating/i });
    expect(busy.getAttribute("aria-disabled")).toBe("true");
    expect(busy.hasAttribute("disabled")).toBe(false);
    expect(document.activeElement).toBe(busy);
    expect(nameInput().readOnly).toBe(true);
    await press(busy);
    expect(s.createDeck).toHaveBeenCalledTimes(1);
    await act(async () => finish({ ok: true, deckId: "deck-1", slug: "goblin-swarm" }));
    expect(s.push).toHaveBeenCalledWith("/deck/goblin-swarm?new=1");
  });

  it("is imported after the deck is made, and the deck opens with its cards", async () => {
    await openDialog();
    await type(nameInput(), "Goblin Swarm");
    await type(listInput(), "4 Mountain\n2 Island");
    await press(createButton());
    expect(s.createDeck).toHaveBeenCalledTimes(1);
    expect(s.resolve).toHaveBeenCalledWith({ text: "4 Mountain\n2 Island" });
    expect(s.commit).toHaveBeenCalledWith({
      deckId: "deck-1",
      lines: [
        { name: "Mountain", quantity: 4, board: "main", resolved: RESOLVED_LINES[0].resolved },
        { name: "Island", quantity: 2, board: "main", resolved: RESOLVED_LINES[1].resolved },
      ],
      firstImportOnly: true,
    });
    expect(s.createDeck.mock.invocationCallOrder[0]).toBeLessThan(s.resolve.mock.invocationCallOrder[0]);
    expect(s.toastSuccess).toHaveBeenCalledWith("Deck created — 2 added.", { description: undefined, duration: undefined });
    expect(onClosed).toHaveBeenCalledWith("created");
    expect(s.push).toHaveBeenCalledWith("/deck/goblin-swarm");
  });

  it("only an EXACT match goes in as a card: a best guess is kept as the name typed, and the toast names it and the skipped lines", async () => {
    s.resolve.mockResolvedValueOnce({
      ok: true,
      title: null,
      parseWarnings: [{ line: 4, raw: "just some words", reason: "No quantity found — expected lines like “4 Lightning Bolt”." }],
      lines: [
        RESOLVED_LINES[0],
        // "Lightning Blot" → Scryfall's fuzzy rescue says Lightning Blow.
        { line: 2, raw: "1 Lightning Blot", name: "Lightning Blot", quantity: 1, board: "main", status: "fuzzy", resolved: { scryfall_id: "b0000000-0000-4000-8000-000000000003", name: "Lightning Blow" } },
        // A set + number that points at another card than the name says.
        { line: 3, raw: "1 Sol Ring (CMR) 999", name: "Sol Ring", quantity: 1, board: "main", status: "fuzzy", resolved: { scryfall_id: "b0000000-0000-4000-8000-000000000004", name: "Some Other Card" } },
        { line: 5, raw: "1 Zzzyx Card", name: "Zzzyx Card", quantity: 1, board: "main", status: "unresolved", resolved: null },
      ],
    });
    s.commit.mockResolvedValueOnce({ ok: true, added: 4, merged: 0, placeholders: 3 });
    await openDialog();
    await type(nameInput(), "Goblin Swarm");
    await type(listInput(), "4 Mountain\n1 Lightning Blot\n1 Sol Ring (CMR) 999\njust some words\n1 Zzzyx Card");
    // Before Create, the forecast names the line it can't read.
    expect(screen.getByText("1 line skipped or adjusted: line 4 (“just some words”).")).toBeTruthy();
    await press(createButton());
    const [{ lines }] = s.commit.mock.calls[0] as [{ lines: Array<{ name: string; resolved: unknown }> }];
    expect(lines.map((line) => [line.name, line.resolved])).toEqual([
      ["Mountain", RESOLVED_LINES[0].resolved],
      ["Lightning Blot", null],
      ["Sol Ring", null],
      ["Zzzyx Card", null],
    ]);
    expect(s.toastSuccess).toHaveBeenCalledWith("Deck created — 4 added, 3 placeholders.", {
      description:
        "3 lines kept as names to check: Lightning Blot, Sol Ring, Zzzyx Card. 1 line skipped or adjusted: line 4 (“just some words”).",
      duration: 12_000,
    });
  });

  it("the notes read in the singular for one line, list three names and count the rest, and say nothing when all matched", () => {
    const guess = (name: string, line: number) =>
      ({ line, raw: `1 ${name}`, name, quantity: 1, board: "main", status: "fuzzy", resolved: null }) as const;
    expect(quickImportNotes([guess("Lightning Blot", 1)], [])).toBe("1 line kept as a name to check: Lightning Blot.");
    expect(quickImportNotes(["A", "B", "C", "D", "E"].map(guess), [])).toBe(
      "5 lines kept as names to check: A, B, C and 2 more.",
    );
    expect(quickImportNotes([RESOLVED_LINES[0]] as never, [])).toBeUndefined();
  });

  it("a list the import can't read keeps the deck: the import's words, then the list again or the deck", async () => {
    s.resolve.mockResolvedValueOnce({ ok: false, error: "No cards found — expected lines like “4 Lightning Bolt”." });
    await openDialog();
    await type(nameInput(), "Goblin Swarm");
    await type(listInput(), "just some words");
    // The dialog says it before Create, and still lets it go.
    expect(screen.getByText(/expected lines like/)).toBeTruthy();
    await press(createButton());
    expect(s.createDeck).toHaveBeenCalledTimes(1);
    expect(s.commit).not.toHaveBeenCalled();
    expect(s.push).not.toHaveBeenCalled();
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("“Goblin Swarm” is created, but its list wasn't added: No cards found — expected lines like “4 Lightning Bolt”.");
    const retry = screen.getByRole("button", { name: "Add the list" });
    expect(document.activeElement).toBe(retry);
    expect(screen.queryByRole("button", { name: /^create deck$/i })).toBeNull();

    // Fixed in place and added to the SAME deck — no second deck.
    await type(screen.getByRole("textbox", { name: "Decklist" }), "4 Mountain\n2 Island");
    await press(retry);
    expect(s.createDeck).toHaveBeenCalledTimes(1);
    expect(s.commit).toHaveBeenCalledWith(expect.objectContaining({ deckId: "deck-1" }));
    expect(s.push).toHaveBeenCalledWith("/deck/goblin-swarm");
  });

  it("…or the deck page, empty, with its add control focused", async () => {
    s.commit.mockResolvedValueOnce({ ok: false, error: "Scryfall didn't respond — nothing was imported. Try again in a moment." });
    await openDialog();
    await type(nameInput(), "Goblin Swarm");
    await type(listInput(), "4 Mountain");
    await press(createButton());
    expect(screen.getByRole("alert").textContent).toContain("Scryfall didn't respond");
    await press(screen.getByRole("button", { name: "Open the deck" }));
    expect(s.push).toHaveBeenCalledWith("/deck/goblin-swarm?new=1");
  });

  it("the kept deck's list is its Decklist — no longer “optional”", async () => {
    s.commit.mockResolvedValueOnce({ ok: false, error: "Scryfall didn't respond — nothing was imported. Try again in a moment." });
    await openDialog();
    await type(nameInput(), "Goblin Swarm");
    await type(listInput(), "4 Mountain");
    await press(createButton());
    expect(screen.queryByRole("textbox", { name: /optional/i })).toBeNull();
    expect((screen.getByRole("textbox", { name: "Decklist" }) as HTMLTextAreaElement).value).toBe("4 Mountain");
  });

  it("a retry whose list already went in (a lost answer) adds nothing: only the deck is offered", async () => {
    s.commit
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce({ ok: false, error: "The list is already in — open the deck.", alreadyImported: true });
    await openDialog();
    await type(nameInput(), "Goblin Swarm");
    await type(listInput(), "4 Mountain");
    await press(createButton());
    await press(screen.getByRole("button", { name: "Add the list" }));
    expect(s.commit).toHaveBeenCalledTimes(2);
    expect(s.commit.mock.calls[1][0]).toMatchObject({ firstImportOnly: true });
    expect(screen.getByRole("alert").textContent).toContain("“Goblin Swarm” is created and its list is in");
    expect(screen.queryByRole("button", { name: "Add the list" })).toBeNull();
    const open = screen.getByRole("button", { name: "Open the deck" });
    expect(document.activeElement).toBe(open);
    await press(open);
    expect(s.push).toHaveBeenCalledWith("/deck/goblin-swarm");
  });

  it("a lost connection after the deck was made keeps it — the next press adds the list, never a second deck", async () => {
    s.resolve.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await openDialog();
    await type(nameInput(), "Goblin Swarm");
    await type(listInput(), "4 Mountain");
    await press(createButton());
    expect(screen.getByRole("alert").textContent).toContain("Couldn't reach PipGlyph");
    await press(screen.getByRole("button", { name: "Add the list" }));
    expect(s.createDeck).toHaveBeenCalledTimes(1);
    expect(s.resolve).toHaveBeenCalledTimes(2);
    expect(s.push).toHaveBeenCalledWith("/deck/goblin-swarm");
  });

  it("a lost connection before the deck was made says so; the next press asks for that deck back", async () => {
    s.createDeck.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await openDialog();
    await type(nameInput(), "Goblin Swarm");
    await press(createButton());
    expect(s.createDeck.mock.calls[0][1]).not.toHaveProperty("reuseRecentTwin");
    expect(screen.getByRole("alert").textContent).toContain("Couldn't reach PipGlyph");
    await press(createButton());
    expect(s.createDeck).toHaveBeenCalledTimes(2);
    // The create may have landed: the server returns that deck, not a twin.
    expect(s.createDeck.mock.calls[1][1]).toMatchObject({ reuseRecentTwin: true });
    expect(s.push).toHaveBeenCalledWith("/deck/goblin-swarm?new=1");
  });
});

describe("the visibility (the card creator's control, in deck words)", () => {
  const privateBox = () => screen.getByRole("checkbox", { name: "Keep it private" }) as HTMLInputElement;
  const sharedChip = (name: "Unlisted" | "Public") => screen.getByRole("radio", { name: new RegExp(`^${name}`) });

  it("is Public by default — the maker chooses private with a box, as in the creator", async () => {
    contextResponse({ user: { id: "u1" }, cardCapacity: { used: 50, cap: 50, tier: "free" } });
    await openDialog();
    const change = screen.getByRole("button", { name: "Change visibility" });
    expect(change.closest("p")?.textContent).toBe("Visibility: Public · change");
    expect(change.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("checkbox")).toBeNull();

    await press(change);
    expect(change.getAttribute("aria-expanded")).toBe("true");
    expect(document.getElementById(change.getAttribute("aria-controls") ?? "")).not.toBeNull();
    // The creator's order: the private box, then Unlisted | Public.
    expect(privateBox().checked).toBe(false);
    expect(document.getElementById(privateBox().getAttribute("aria-describedby") ?? "")?.textContent).toMatch(
      /^Only you can see it\./,
    );
    const group = screen.getByRole("radiogroup", { name: "Visibility" });
    const chips = within(group).getAllByRole("radio");
    expect(chips.map((chip) => chip.textContent)).toEqual([
      "UnlistedAnyone with the link can view, hidden from community decks.",
      "PublicListed in community decks and on your profile. The default.",
    ]);
    expect(sharedChip("Public").getAttribute("aria-checked")).toBe("true");
    expect(chips.filter((chip) => chip.tabIndex === 0)).toEqual([sharedChip("Public")]);

    await press(sharedChip("Unlisted"));
    expect(change.closest("p")?.textContent).toBe("Visibility: Unlisted · change");

    // Private: ticked, the chips step aside (a private deck is neither).
    await press(privateBox());
    expect(change.closest("p")?.textContent).toBe("Visibility: Private · change");
    expect(screen.queryByRole("radiogroup", { name: "Visibility" })).toBeNull();
    // Decks are unlimited on every plan: no deck meter, no warning, no
    // upgrade — a full saved-card plan included.
    expect(screen.queryByText(/private decks/i)).toBeNull();
    expect(screen.queryByTestId("deck-capacity-notice")).toBeNull();

    await type(nameInput(), "Secret Tech");
    await press(createButton());
    expect(s.createDeck.mock.calls[0][0]).toEqual({ title: "Secret Tech", format: "commander", visibility: "private" });
  });

  it("unticked, a private deck is offered public again", async () => {
    await openDialog();
    await press(screen.getByRole("button", { name: "Change visibility" }));
    await press(privateBox());
    await press(privateBox());
    expect(sharedChip("Public").getAttribute("aria-checked")).toBe("true");
  });

  it("a format hub's or /dashboard/decks/new's open is Public too", async () => {
    await openDialog({ format: "standard" });
    expect(screen.getByRole("button", { name: "Change visibility" }).closest("p")?.textContent).toBe(
      "Visibility: Public · change",
    );
    await type(nameInput(), "Mono-Red");
    await press(createButton());
    expect(s.createDeck.mock.calls[0][0]).toMatchObject({ format: "standard", visibility: "public" });
  });
});

describe("closing hands the focus back (it opens from context, not a trigger)", () => {
  /** The provider's part: told it closed, it closes. */
  function Closable({ opener }: { opener: HTMLElement }) {
    const [open, setOpen] = useState(true);
    return (
      <NewDeckDialog
        open={open}
        request={{ key: 1, returnFocusTo: opener }}
        onClosed={(reason) => {
          onClosed(reason);
          setOpen(false);
        }}
      />
    );
  }

  /** Radix hands the focus on a tick after the content unmounts. */
  const afterUnmountFocus = () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

  function opener() {
    const button = document.createElement("button");
    button.textContent = "New deck";
    document.body.append(button);
    return button;
  }

  it("a dismissal: to what opened it", async () => {
    const button = opener();
    render(<Closable opener={button} />);
    await act(async () => {});
    await press(screen.getByRole("button", { name: "Cancel" }));
    await afterUnmountFocus();
    expect(onClosed).toHaveBeenCalledWith("dismiss");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(button);
    button.remove();
  });

  it("a create: not back — the deck's page opens and takes the focus", async () => {
    const button = opener();
    render(<Closable opener={button} />);
    await act(async () => {});
    await type(nameInput(), "Goblin Swarm");
    await press(createButton());
    await afterUnmountFocus();
    expect(onClosed).toHaveBeenCalledWith("created");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).not.toBe(button);
    button.remove();
  });
});

describe("an empty deck", () => {
  it("opens its page with ?new=1, and a kept draft is gone", async () => {
    saveNewDeckDraft({ title: "Kept", format: "modern", visibility: "public", decklist: "", cardId: null });
    await openDialog();
    expect(nameInput().value).toBe("Kept");
    await press(createButton());
    expect(s.push).toHaveBeenCalledWith("/deck/goblin-swarm?new=1");
    expect(s.resolve).not.toHaveBeenCalled();
    expect(readNewDeckDraft()).toBeNull();
  });

  it("starts with the card it was opened for — and, holding it, opens without ?new=1", async () => {
    await openDialog({ cardId: "c0000000-0000-4000-8000-000000000001" });
    await type(nameInput(), "Around Zoey");
    await press(createButton());
    expect(s.createDeck.mock.calls[0][1]).toMatchObject({ firstCardId: "c0000000-0000-4000-8000-000000000001" });
    expect(s.push).toHaveBeenCalledWith("/deck/goblin-swarm");
  });

  it("a first card that couldn't go in leaves it empty: ?new=1", async () => {
    s.createDeck.mockResolvedValue({
      ok: true,
      deckId: "deck-1",
      slug: "goblin-swarm",
      firstCardError: "That card couldn't be added — add it from the deck page.",
    });
    await openDialog({ cardId: "c0000000-0000-4000-8000-000000000001" });
    await type(nameInput(), "Around Zoey");
    await press(createButton());
    expect(s.toastMessage).toHaveBeenCalledWith("That card couldn't be added — add it from the deck page.");
    expect(s.push).toHaveBeenCalledWith("/deck/goblin-swarm?new=1");
  });

  it("a first card that went in but not as the commander says so — and the deck isn't empty", async () => {
    s.createDeck.mockResolvedValue({
      ok: true,
      deckId: "deck-1",
      slug: "goblin-swarm",
      firstCardNotice: "Added to the deck, but it couldn't be set as the commander — set it from the deck page.",
    });
    await openDialog({ cardId: "c0000000-0000-4000-8000-000000000001" });
    await type(nameInput(), "Around Zoey");
    await press(createButton());
    expect(s.toastMessage).toHaveBeenCalledWith(
      "Added to the deck, but it couldn't be set as the commander — set it from the deck page.",
    );
    expect(s.push).toHaveBeenCalledWith("/deck/goblin-swarm");
  });
});

describe("signed out (TODO DK4.3)", () => {
  it("Create asks to sign up or sign in, keeps the input in sessionStorage — never the URL — and brings it back", async () => {
    s.signedInCookie = false;
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await openDialog({ format: "standard" });
    // No session cookie: no request at all.
    expect(fetchSpy).not.toHaveBeenCalled();

    await type(nameInput(), "Mono-Red Aggro");
    await type(listInput(), "4 Lightning Bolt");
    await press(createButton());
    expect(s.createDeck).not.toHaveBeenCalled();

    const signUp = screen.getByRole("link", { name: "Sign up free" });
    const signIn = screen.getByRole("link", { name: "Sign in" });
    // A new account goes through onboarding, which ends on the dialog.
    expect(signUp.getAttribute("href")).toBe(
      `/signup?redirectTo=${encodeURIComponent(`/onboarding?next=${encodeURIComponent("/dashboard/decks/new?format=standard")}`)}`,
    );
    expect(signIn.getAttribute("href")).toBe("/login?redirectTo=%2Fdashboard%2Fdecks%2Fnew%3Fformat%3Dstandard");
    expect(signUp.getAttribute("href")).not.toMatch(/Bolt/);
    expect(document.activeElement).toBe(signUp);
    expect(document.getElementById(signUp.getAttribute("aria-describedby") ?? "")?.textContent).toMatch(
      /^Sign up or sign in to create your deck/,
    );
    expect(readNewDeckDraft()).toEqual({
      title: "Mono-Red Aggro",
      format: "standard",
      visibility: "public",
      decklist: "4 Lightning Bolt",
      cardId: null,
    });

    // Back from signing in: the same dialog, the same input.
    cleanup();
    s.signedInCookie = true;
    contextResponse({ user: { id: "u1" }, cardCapacity: null });
    await openDialog();
    expect(nameInput().value).toBe("Mono-Red Aggro");
    expect(listInput().value).toBe("4 Lightning Bolt");
    expect(radio("Standard").getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText(/as you left it/)).toBeTruthy();
    await press(createButton());
    expect(s.createDeck).toHaveBeenCalledWith(
      { title: "Mono-Red Aggro", format: "standard", visibility: "public" },
      expect.anything(),
    );
  });

  it("a session the server no longer knows asks the same way", async () => {
    s.createDeck.mockResolvedValue({ ok: false, code: "AUTH_REQUIRED", formError: "You must be signed in to do that." });
    await openDialog();
    await type(nameInput(), "Goblin Swarm");
    await press(createButton());
    expect(screen.getByRole("link", { name: "Sign up free" })).toBeTruthy();
    expect(readNewDeckDraft()?.title).toBe("Goblin Swarm");
  });

  it("a dismissal drops what was kept", async () => {
    saveNewDeckDraft({ title: "Kept", format: "modern", visibility: "public", decklist: "", cardId: null });
    await openDialog();
    await press(screen.getByRole("button", { name: "Cancel" }));
    expect(onClosed).toHaveBeenCalledWith("dismiss");
    expect(readNewDeckDraft()).toBeNull();
  });
});
