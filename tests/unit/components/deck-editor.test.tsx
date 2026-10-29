// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// ---------------------------------------------------------------------------
// The owner's deck page as an editor (TODO DK5 part 2 — DK5.2 / DK5.4 /
// DK5.5 / DK5.8 / DK5.10): every edit drawn at once and rolled back — and
// said — when the server refuses it or never answers; ONE batch write a
// change (a selection's too); the entry keys only on a focused card; Remove
// with an Undo that puts the lines back through the restore action; every
// Edit with its way back; and the add box, an ARIA combobox whose Enter adds
// the highlighted result to the board it names.
// ---------------------------------------------------------------------------

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("next/image", () => ({ default: ({ alt }: { alt: string }) => <span aria-label={alt} /> }));
const toast = vi.hoisted(() =>
  Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn(), message: vi.fn() }),
);
vi.mock("sonner", () => ({ toast }));
vi.mock("@/components/creator/card-glossary", () => ({ CardGlossary: () => null }));
vi.mock("@/components/cards/card-preview", () => ({ CardPreview: () => <div data-testid="live-preview" /> }));
const actions = vi.hoisted(() => ({
  updateDeckEntriesAction: vi.fn(),
  removeDeckEntriesAction: vi.fn(),
  restoreDeckEntriesAction: vi.fn(),
  linkDeckCardAction: vi.fn(),
  unlinkDeckCardAction: vi.fn(),
  listMyCardsLiteAction: vi.fn(async () => ({ ok: true, cards: [] })),
}));
vi.mock("@/lib/decks/card-actions", () => actions);
const adds = vi.hoisted(() => ({ addToDeckAction: vi.fn() }));
vi.mock("@/lib/decks/add-actions", () => adds);

import { DeckCardList } from "@/components/decks/deck-card-list";
import type { DeckItem } from "@/lib/decks/queries";

const DECK = { id: "33333333-3333-4333-8333-333333333333", slug: "ness", title: "Ness", format: "casual" as const };
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function entry(n: number, over: Record<string, unknown> = {}) {
  return {
    id: id(n),
    deck_id: DECK.id,
    board: "main",
    quantity: 1,
    position: n,
    card_id: null,
    scryfall_id: `sf-${n}`,
    source: "import",
    name: `Card ${n}`,
    set_code: "dom",
    collector_number: String(n),
    type_line: "Instant",
    mana_cost: "{R}",
    mana_value: 1,
    color_identity: ["R"],
    rarity: "common",
    image_url: null,
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
    ...over,
  };
}
const item = (n: number, over: Record<string, unknown> = {}) => ({ entry: entry(n, over), card: null, cardOwner: null }) as unknown as DeckItem;

const BOLT = () => item(1, { name: "Lightning Bolt", quantity: 2 });
const RING = () => item(2, { name: "Sol Ring", type_line: "Artifact", mana_cost: "{1}" });

function deckPage(items: DeckItem[] = [BOLT(), RING()]) {
  return render(
    <DeckCardList
      items={items}
      ownerUsername="kesh"
      canManage
      deck={DECK}
      initialPrefs={{ view: "list", group: "none", sort: "name" }}
      summary={{ format: "casual", analytics: { total: 3, byBoard: { main: 3, side: 0, maybe: 0, commander: 0, companion: 0 }, averageManaValue: 1, lands: 0 }, formatIssues: 0 }}
    />,
  );
}

/** A promise the test settles by hand. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const copiesOf = (name: string) => within(screen.getByRole("group", { name: `Copies of ${name}` }));
const shownCount = (name: string) => copiesOf(name).getByText(/\d+ cop(y|ies)/).textContent;
const status = () => screen.getByTestId("deck-editor-status").textContent;
const flush = () => act(async () => new Promise((resolve) => setTimeout(resolve, 80)));

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://auth.pipglyph.com");
  for (const fn of [...Object.values(actions), ...Object.values(adds), ...Object.values(router), toast.error, toast.warning, toast]) fn.mockReset?.();
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("instant saves (DK5.8)", () => {
  it("draws a stepper's change at once and sends ONE batch write — the server's rows then replace it", async () => {
    const write = deferred<{ ok: true; entries: unknown[] }>();
    actions.updateDeckEntriesAction.mockReturnValue(write.promise);
    const page = deckPage();
    expect(shownCount("Lightning Bolt")).toBe("2 copies");
    await act(async () => {
      fireEvent.click(copiesOf("Lightning Bolt").getByRole("button", { name: "One more" }));
    });
    // Drawn before the server answers, and said.
    expect(shownCount("Lightning Bolt")).toBe("3 copies");
    await flush();
    expect(status()).toBe("Lightning Bolt: 3 copies.");
    expect(actions.updateDeckEntriesAction).toHaveBeenCalledWith({ deckId: DECK.id, updates: [{ id: id(1), quantity: 3 }] });
    // The revalidated page brings the new rows with the answer.
    await act(async () => {
      page.rerender(
        <DeckCardList
          items={[item(1, { name: "Lightning Bolt", quantity: 3 }), RING()]}
          ownerUsername="kesh"
          canManage
          deck={DECK}
          initialPrefs={{ view: "list", group: "none", sort: "name" }}
        />,
      );
      write.resolve({ ok: true, entries: [] });
    });
    expect(shownCount("Lightning Bolt")).toBe("3 copies");
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("a refusal rolls the card back to what the server holds — and says so, never silently", async () => {
    actions.updateDeckEntriesAction.mockResolvedValue({ ok: false, error: "Deck not found or not yours." });
    deckPage();
    await act(async () => {
      fireEvent.click(copiesOf("Lightning Bolt").getByRole("button", { name: "One more" }));
    });
    await flush();
    expect(shownCount("Lightning Bolt")).toBe("2 copies");
    expect(toast.error).toHaveBeenCalledWith("Couldn't change Lightning Bolt — back to what it was.", {
      description: "Deck not found or not yours.",
    });
    expect(status()).toContain("Deck not found or not yours.");
    // A refusal is an answer: the server's state is known.
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("a request that never answers rolls back too, and asks the server again (its state is unknown)", async () => {
    actions.updateDeckEntriesAction.mockRejectedValue(new Error("Failed to fetch"));
    deckPage();
    await act(async () => {
      fireEvent.click(copiesOf("Sol Ring").getByRole("button", { name: "One more" }));
    });
    await flush();
    expect(shownCount("Sol Ring")).toBe("1 copy");
    expect(toast.error).toHaveBeenCalledWith("Couldn't change Sol Ring — back to what it was.", {
      description: "The change didn't reach the server — check your connection.",
    });
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it("presses made while a write is on its way wait in line, and the waiting ones collapse into the newest", async () => {
    const first = deferred<{ ok: true; entries: unknown[] }>();
    actions.updateDeckEntriesAction.mockReturnValueOnce(first.promise).mockResolvedValue({ ok: true, entries: [] });
    deckPage();
    const more = () => copiesOf("Lightning Bolt").getByRole("button", { name: "One more" });
    for (let i = 0; i < 4; i += 1) {
      await act(async () => {
        fireEvent.click(more());
      });
    }
    expect(shownCount("Lightning Bolt")).toBe("6 copies");
    expect(actions.updateDeckEntriesAction).toHaveBeenCalledTimes(1);
    await act(async () => {
      first.resolve({ ok: true, entries: [] });
    });
    await flush();
    // The first, then ONE for the three that waited: the newest value.
    expect(actions.updateDeckEntriesAction).toHaveBeenCalledTimes(2);
    expect(actions.updateDeckEntriesAction).toHaveBeenLastCalledWith({ deckId: DECK.id, updates: [{ id: id(1), quantity: 6 }] });
  });

  it("− at one copy never writes: it says Remove is the way out", async () => {
    deckPage();
    const fewer = copiesOf("Sol Ring").getByRole("button", { name: /^One fewer/ });
    expect(fewer.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(fewer);
    expect(actions.updateDeckEntriesAction).not.toHaveBeenCalled();
  });
});

describe("the entry keys (DK5.4) — only on a focused card", () => {
  const opener = (name: RegExp) => screen.getByRole("button", { name });

  it("+ and − change the count, S sends the card to the sideboard, M opens the Move menu", async () => {
    actions.updateDeckEntriesAction.mockReturnValue(new Promise(() => {}));
    deckPage();
    const bolt = opener(/^Lightning Bolt, 2 copies/);
    bolt.focus();
    await act(async () => {
      fireEvent.keyDown(bolt, { key: "+" });
    });
    expect(actions.updateDeckEntriesAction).toHaveBeenLastCalledWith({ deckId: DECK.id, updates: [{ id: id(1), quantity: 3 }] });
    const ring = opener(/^Sol Ring, 1 copy/);
    await act(async () => {
      fireEvent.keyDown(ring, { key: "s" });
    });
    expect(actions.updateDeckEntriesAction).toHaveBeenLastCalledWith({ deckId: DECK.id, updates: [{ id: id(2), board: "side" }] });
    await act(async () => {
      fireEvent.keyDown(opener(/^Lightning Bolt/), { key: "m" });
    });
    const menu = await screen.findByRole("menu", { name: "Move Lightning Bolt" });
    expect(within(menu).getAllByRole("menuitemradio").map((el) => [el.textContent, el.getAttribute("aria-checked")])).toEqual([
      ["Mainboard", "true"],
      ["Sideboard", "false"],
      ["Maybeboard", "false"],
      ["Companion", "false"],
    ]);
  });

  it("− at one copy is said, never sent; a key with Ctrl or ⌘ is the browser's", async () => {
    deckPage();
    const ring = opener(/^Sol Ring/);
    await act(async () => {
      fireEvent.keyDown(ring, { key: "-" });
    });
    await flush();
    expect(status()).toBe("Sol Ring: one copy is the fewest — remove it from its menu.");
    await act(async () => {
      fireEvent.keyDown(ring, { key: "+", ctrlKey: true });
      fireEvent.keyDown(ring, { key: "s", metaKey: true });
    });
    expect(actions.updateDeckEntriesAction).not.toHaveBeenCalled();
  });

  it("a visitor's cards take no keys", () => {
    render(<DeckCardList items={[BOLT()]} ownerUsername="kesh" canManage={false} initialPrefs={{ view: "list", group: "none", sort: "name" }} />);
    fireEvent.keyDown(screen.getByRole("button", { name: /^Lightning Bolt/ }), { key: "+" });
    expect(actions.updateDeckEntriesAction).not.toHaveBeenCalled();
    expect(screen.queryByRole("group", { name: /^Copies of/ })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Add cards" })).toBeNull();
  });
});

describe("Remove, with an Undo (DK5.4)", () => {
  it("takes the card out at once; the toast's Undo puts the lines back through the restore action", async () => {
    const removed = { id: id(2), name: "Sol Ring", board: "main", quantity: 1, scryfallId: "sf-2", cardId: null, source: "import" };
    actions.removeDeckEntriesAction.mockResolvedValue({ ok: true, removed: [removed] });
    actions.restoreDeckEntriesAction.mockResolvedValue({ ok: true, restored: [{ from: id(2), to: id(9) }] });
    deckPage();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "More for Sol Ring" }));
    });
    const menu = await screen.findByRole("menu", { name: "Sol Ring: actions" });
    // Edit, with its way back to this card on the deck (DK5.5).
    expect(within(menu).getByRole("menuitem", { name: "Customize" }).getAttribute("href")).toBe(
      `/create?deckCard=${id(2)}&returnTo=${encodeURIComponent(`/deck/ness#entry-${id(2)}`)}`,
    );
    await act(async () => {
      fireEvent.click(within(menu).getByRole("menuitem", { name: "Remove" }));
    });
    await flush();
    expect(screen.queryByRole("button", { name: /^Sol Ring/ })).toBeNull();
    expect(actions.removeDeckEntriesAction).toHaveBeenCalledWith({ deckId: DECK.id, entryIds: [id(2)] });
    expect(toast).toHaveBeenCalledWith("Removed Sol Ring.", expect.objectContaining({ duration: 8000 }));
    const undo = (toast.mock.calls.at(-1)![1] as { action: { onClick: () => void } }).action;
    await act(async () => {
      undo.onClick();
    });
    await flush();
    expect(actions.restoreDeckEntriesAction).toHaveBeenCalledWith({ deckId: DECK.id, entries: [removed] });
    // Undone once: the toast's Undo is spent (the bar's has nothing left).
    await act(async () => {
      undo.onClick();
    });
    expect(actions.restoreDeckEntriesAction).toHaveBeenCalledTimes(1);
  });
});

describe("the selection and its bulk bar (DK5.4 / DK5.10)", () => {
  it("Select turns every card into its toggle; Move to sends the whole selection in ONE write", async () => {
    actions.updateDeckEntriesAction.mockResolvedValue({ ok: true, entries: [] });
    deckPage();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Select" }));
    });
    const bolt = screen.getByRole("button", { name: /^Lightning Bolt/ });
    expect(bolt.getAttribute("aria-pressed")).toBe("false");
    expect(bolt.getAttribute("aria-haspopup")).toBeNull();
    await act(async () => {
      fireEvent.click(bolt);
      fireEvent.click(screen.getByRole("button", { name: /^Sol Ring/ }));
    });
    expect(screen.getByRole("button", { name: /^Lightning Bolt/ }).getAttribute("aria-pressed")).toBe("true");
    const bar = screen.getByRole("region", { name: "Selected cards" });
    expect(bar.textContent).toContain("2 selected");
    await act(async () => {
      fireEvent.click(within(bar).getByRole("button", { name: "Move to…" }));
    });
    const menu = await screen.findByRole("menu", { name: "Move the selected cards" });
    await act(async () => {
      fireEvent.click(within(menu).getByRole("menuitemradio", { name: "Sideboard" }));
    });
    expect(actions.updateDeckEntriesAction).toHaveBeenCalledTimes(1);
    expect(actions.updateDeckEntriesAction).toHaveBeenCalledWith({
      deckId: DECK.id,
      updates: [
        { id: id(1), board: "side" },
        { id: id(2), board: "side" },
      ],
    });
    // Escape ends the selection.
    await act(async () => {
      fireEvent.keyDown(screen.getByRole("button", { name: /^Lightning Bolt/ }), { key: "Escape" });
    });
    expect(screen.queryByRole("region", { name: "Selected cards" })).toBeNull();
  });

  it("Shift + click selects without opening the card", async () => {
    deckPage();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Sol Ring/ }), { shiftKey: true });
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("region", { name: "Selected cards" }).textContent).toContain("1 selected");
  });
});

describe("the add box (DK5.2) — an ARIA combobox", () => {
  const ADD_RESULTS = {
    ok: true,
    mine: [
      {
        card: { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", owner_id: "me", slug: "ember-wyrm", title: "Ember Wyrm", visibility: "private", rendered_image_url: null, rendered_thumb_url: null, rendered_back_image_url: null, rendered_back_thumb_url: null, cost: "{3}{R}", card_type: "creature", color_identity: ["red"], frame_style: { template: "m15" } },
        maker: null,
      },
    ],
    community: [],
  };
  const SCRYFALL = { ok: true, results: [{ id: "581b7327-3215-4a4f-b4ae-d9d4002ba882", name: "Sol Ring", type_line: "Artifact", mana_cost: "{1}", rarity: "uncommon", set: "c21", print_url: null }] };

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => ({
        ok: true,
        status: 200,
        json: async () => (String(url).startsWith("/api/decks/add-search") ? ADD_RESULTS : SCRYFALL),
      })),
    );
  });

  it("opens on focus, lists its sections, moves the highlight with the arrows and adds it with Enter", async () => {
    adds.addToDeckAction.mockResolvedValue({ ok: true, entryId: id(2), board: "side", quantity: 2, merged: true });
    deckPage();
    const box = screen.getByRole("combobox", { name: "Add cards" });
    expect(box.getAttribute("aria-expanded")).toBe("false");
    await act(async () => {
      box.focus();
      fireEvent.change(box, { target: { value: "sol" } });
    });
    await waitFor(() => expect(screen.getByRole("option", { name: /^Sol Ring/ })).toBeTruthy());
    expect(box.getAttribute("aria-expanded")).toBe("true");
    const list = screen.getByRole("listbox", { name: "Cards to add" });
    expect(within(list).getAllByRole("group").map((group) => group.getAttribute("aria-labelledby") && document.getElementById(group.getAttribute("aria-labelledby")!)?.textContent)).toEqual([
      "My cards",
      "Real cards",
    ]);
    // "In deck ×N" is part of a result's name.
    expect(screen.getByRole("option", { name: /^Sol Ring/ }).getAttribute("aria-label")).toBe("Sol Ring, Artifact · C21, In deck ×1");
    // The first result is highlighted; ↓ moves on.
    const highlighted = () => document.getElementById(box.getAttribute("aria-activedescendant") ?? "")?.getAttribute("aria-label");
    expect(highlighted()).toMatch(/^Ember Wyrm/);
    await act(async () => {
      fireEvent.keyDown(box, { key: "ArrowDown" });
    });
    expect(highlighted()).toMatch(/^Sol Ring/);
    expect(screen.getByRole("option", { name: /^Sol Ring/ }).getAttribute("aria-selected")).toBe("true");
    // The board it names.
    await act(async () => {
      fireEvent.change(screen.getByRole("combobox", { name: "Add to" }), { target: { value: "side" } });
      box.focus();
    });
    await act(async () => {
      fireEvent.keyDown(box, { key: "Enter" });
    });
    await flush();
    expect(adds.addToDeckAction).toHaveBeenCalledWith({
      deckId: DECK.id,
      board: "side",
      pick: { kind: "printing", scryfallId: "581b7327-3215-4a4f-b4ae-d9d4002ba882", name: "Sol Ring" },
    });
    expect(status()).toBe("Sol Ring: one more on the Sideboard — 2 now.");
    // Escape closes the list; a second empties the box.
    await act(async () => {
      fireEvent.keyDown(box, { key: "Escape" });
    });
    expect(box.getAttribute("aria-expanded")).toBe("false");
    await act(async () => {
      fireEvent.keyDown(box, { key: "Escape" });
    });
    expect((box as HTMLInputElement).value).toBe("");
  });

  it("“/” outside a field focuses it — never while typing", async () => {
    deckPage();
    await act(async () => {
      fireEvent.keyDown(document.body, { key: "/" });
    });
    expect(document.activeElement).toBe(screen.getByRole("combobox", { name: "Add cards" }));
    const field = document.createElement("input");
    document.body.appendChild(field);
    field.focus();
    await act(async () => {
      fireEvent.keyDown(field, { key: "/" });
    });
    expect(document.activeElement).toBe(field);
    field.remove();
  });

  it("a refused add says why next to the box (and the editor's toast)", async () => {
    adds.addToDeckAction.mockResolvedValue({ ok: false, error: "Ember Wyrm is already in the deck, on the Sideboard. Move it there to change boards." });
    deckPage();
    const box = screen.getByRole("combobox", { name: "Add cards" });
    await act(async () => {
      box.focus();
      fireEvent.change(box, { target: { value: "em" } });
    });
    await waitFor(() => expect(screen.getByRole("option", { name: /^Ember Wyrm/ })).toBeTruthy());
    await act(async () => {
      fireEvent.click(screen.getByRole("option", { name: /^Ember Wyrm/ }));
    });
    await flush();
    expect(screen.getByTestId("deck-add-notice").textContent).toBe(
      "Ember Wyrm is already in the deck, on the Sideboard. Move it there to change boards.",
    );
    expect(toast.error).toHaveBeenCalledWith("Couldn't add Ember Wyrm.", expect.anything());
  });
});
