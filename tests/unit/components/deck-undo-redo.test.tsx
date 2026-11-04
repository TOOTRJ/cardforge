// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { beforeAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dynamicReady } from "@/tests/stubs/next-dynamic";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Undo / redo and the change history on the owner's deck page (TODO DK5.13):
// the toolbar's Undo · Redo · History on the editor's ONE stack — the same
// steps as ⌘Z / ⇧⌘Z and a removal's toast. Covered: a quantity, a board
// move, a removal (undone through the restore action, redone by removing the
// line it brought back), an "Add 2" (one step both ways), the controls'
// names and keys, and the History dialog — locked for free, a restore
// through the editor that the toolbar's Undo takes back.
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
const adds = vi.hoisted(() => ({ addToDeckAction: vi.fn(), addManyToDeckAction: vi.fn() }));
vi.mock("@/lib/decks/add-actions", () => adds);
vi.mock("@/lib/decks/membership-actions", () => ({ privateCardOfferAction: vi.fn() }));
const history = vi.hoisted(() => ({ listDeckHistoryAction: vi.fn(), restoreDeckVersionAction: vi.fn() }));
vi.mock("@/lib/decks/history-actions", () => history);
const upgrade = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock("@/components/billing/upgrade-modal-provider", () => ({ useUpgradeModal: () => upgrade }));

import { DeckCardList } from "@/components/decks/deck-card-list";
import type { DeckItem } from "@/lib/decks/queries";

beforeAll(() => dynamicReady());

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
      summary={{ format: "casual", analytics: { total: 3, byBoard: { main: 3, side: 0, maybe: 0, commander: 0, companion: 0 }, averageManaValue: 1, totalManaValue: 3, lands: 0 }, formatIssues: [] }}
    />,
  );
}

const flush = () => act(async () => new Promise((resolve) => setTimeout(resolve, 80)));
const toolbar = () => within(screen.getByRole("group", { name: "Undo and history" }));
const undoButton = () => toolbar().getByRole("button", { name: /^Undo/ });
const redoButton = () => toolbar().getByRole("button", { name: /^Redo/ });
const copiesOf = (name: string) => within(screen.getByRole("group", { name: `Copies of ${name}` }));
const press = async (element: HTMLElement) => {
  await act(async () => {
    fireEvent.click(element);
  });
  await flush();
};

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://auth.pipglyph.com");
  for (const fn of [...Object.values(actions), ...Object.values(adds), ...Object.values(history), ...Object.values(router), upgrade.open, toast.error, toast.warning, toast]) fn.mockReset?.();
  actions.updateDeckEntriesAction.mockResolvedValue({ ok: true, entries: [] });
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("the toolbar's Undo and Redo", () => {
  it("are reachable with nothing to do, and say so", () => {
    deckPage();
    expect(undoButton().getAttribute("aria-disabled")).toBe("true");
    expect(undoButton().getAttribute("aria-label")).toBe("Undo — nothing to undo yet");
    expect(undoButton().getAttribute("aria-keyshortcuts")).toContain("Meta+Z");
    expect(redoButton().getAttribute("aria-disabled")).toBe("true");
    expect(redoButton().getAttribute("aria-label")).toBe("Redo — nothing to redo");
    expect(redoButton().getAttribute("aria-keyshortcuts")).toContain("Shift+Meta+Z");
    // A press does nothing (no write, no throw).
    fireEvent.click(undoButton());
    expect(actions.updateDeckEntriesAction).not.toHaveBeenCalled();
  });

  it("undo a quantity, redo it, undo it again — each a write of the VALUE", async () => {
    deckPage();
    await press(copiesOf("Lightning Bolt").getByRole("button", { name: "One more" }));
    expect(undoButton().getAttribute("aria-label")).toBe("Undo: Lightning Bolt: 3 copies");
    await press(undoButton());
    expect(actions.updateDeckEntriesAction).toHaveBeenLastCalledWith({ deckId: DECK.id, updates: [{ id: id(1), quantity: 2, board: "main" }] });
    expect(undoButton().getAttribute("aria-disabled")).toBe("true");
    expect(redoButton().getAttribute("aria-label")).toBe("Redo: Lightning Bolt: 3 copies");
    await press(redoButton());
    // The redo writes the edit's own value — never one read off the rows.
    expect(actions.updateDeckEntriesAction).toHaveBeenLastCalledWith({ deckId: DECK.id, updates: [{ id: id(1), quantity: 3 }] });
    expect(undoButton().getAttribute("aria-label")).toBe("Undo: Lightning Bolt: 3 copies");
    expect(redoButton().getAttribute("aria-disabled")).toBe("true");
    await press(undoButton());
    expect(actions.updateDeckEntriesAction).toHaveBeenLastCalledWith({ deckId: DECK.id, updates: [{ id: id(1), quantity: 2, board: "main" }] });
    expect(actions.updateDeckEntriesAction).toHaveBeenCalledTimes(4);
  });

  it("⌘Z and ⇧⌘Z (and Ctrl Y) outside a field; a fresh edit clears Redo", async () => {
    deckPage();
    await press(copiesOf("Sol Ring").getByRole("button", { name: "One more" }));
    await act(async () => {
      fireEvent.keyDown(document.body, { key: "z", metaKey: true });
    });
    await flush();
    expect(actions.updateDeckEntriesAction).toHaveBeenLastCalledWith({ deckId: DECK.id, updates: [{ id: id(2), quantity: 1, board: "main" }] });
    await act(async () => {
      fireEvent.keyDown(document.body, { key: "Z", metaKey: true, shiftKey: true });
    });
    await flush();
    expect(actions.updateDeckEntriesAction).toHaveBeenLastCalledWith({ deckId: DECK.id, updates: [{ id: id(2), quantity: 2 }] });
    await act(async () => {
      fireEvent.keyDown(document.body, { key: "z", ctrlKey: true });
    });
    await flush();
    await act(async () => {
      fireEvent.keyDown(document.body, { key: "y", ctrlKey: true });
    });
    await flush();
    expect(actions.updateDeckEntriesAction).toHaveBeenCalledTimes(5);
    await press(undoButton());
    expect(redoButton().getAttribute("aria-disabled")).toBeNull();
    // A fresh edit: the redo branch is gone.
    await press(copiesOf("Lightning Bolt").getByRole("button", { name: "One more" }));
    expect(redoButton().getAttribute("aria-disabled")).toBe("true");
    // Typing in a field is never an undo.
    const box = screen.getByRole("combobox", { name: "Add cards" });
    const calls = actions.updateDeckEntriesAction.mock.calls.length;
    fireEvent.keyDown(box, { key: "z", metaKey: true });
    await flush();
    expect(actions.updateDeckEntriesAction.mock.calls.length).toBe(calls);
  });

  it("a removal: Undo puts the line back, Redo takes the line it brought back out, Undo puts it back again", async () => {
    const removed = { id: id(2), name: "Sol Ring", board: "main", quantity: 1, scryfallId: "sf-2", cardId: null, source: "import" };
    actions.removeDeckEntriesAction.mockResolvedValueOnce({ ok: true, removed: [removed] });
    actions.restoreDeckEntriesAction.mockResolvedValueOnce({ ok: true, restored: [{ from: id(2), to: id(9) }] });
    const page = deckPage();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "More for Sol Ring" }));
    });
    const menu = await screen.findByRole("menu", { name: "Sol Ring: actions" });
    await press(within(menu).getByRole("menuitem", { name: "Remove" }));
    expect(undoButton().getAttribute("aria-label")).toBe("Undo: remove Sol Ring");
    await press(undoButton());
    expect(actions.restoreDeckEntriesAction).toHaveBeenCalledWith({ deckId: DECK.id, entries: [removed] });
    expect(redoButton().getAttribute("aria-label")).toBe("Redo: remove Sol Ring");
    // The server's rows come back with the line under its new id.
    page.rerender(
      <DeckCardList
        items={[BOLT(), item(9, { name: "Sol Ring" })]}
        ownerUsername="kesh"
        canManage
        deck={DECK}
        initialPrefs={{ view: "list", group: "none", sort: "name" }}
      />,
    );
    const again = { ...removed, id: id(9) };
    actions.removeDeckEntriesAction.mockResolvedValueOnce({ ok: true, removed: [again] });
    await press(redoButton());
    expect(actions.removeDeckEntriesAction).toHaveBeenLastCalledWith({ deckId: DECK.id, entryIds: [id(9)] });
    expect(undoButton().getAttribute("aria-label")).toBe("Undo: remove Sol Ring");
    actions.restoreDeckEntriesAction.mockResolvedValueOnce({ ok: true, restored: [{ from: id(9), to: id(10) }] });
    await press(undoButton());
    expect(actions.restoreDeckEntriesAction).toHaveBeenLastCalledWith({ deckId: DECK.id, entries: [again] });
  });

  it("a refused undo is said and leaves nothing to redo", async () => {
    deckPage();
    await press(copiesOf("Lightning Bolt").getByRole("button", { name: "One more" }));
    actions.updateDeckEntriesAction.mockResolvedValueOnce({ ok: false, error: "No." });
    await press(undoButton());
    expect(toast.error).toHaveBeenCalled();
    expect(redoButton().getAttribute("aria-disabled")).toBe("true");
  });
});

describe("\"Add 2\" — one step both ways (DK5.17 + DK5.13)", () => {
  const WYRM = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const RING_SF = "581b7327-3215-4a4f-b4ae-d9d4002ba882";
  const results = {
    ok: true,
    mine: [
      {
        card: { id: WYRM, owner_id: "me", slug: "ember-wyrm", title: "Ember Wyrm", visibility: "public", rendered_image_url: null, rendered_thumb_url: null, rendered_back_image_url: null, rendered_back_thumb_url: null, cost: "{3}{R}", card_type: "creature", color_identity: ["red"], frame_style: { template: "m15" } },
        maker: null,
      },
    ],
    community: [],
  };
  const SCRYFALL = { ok: true, results: [{ id: RING_SF, name: "Arcane Signet", type_line: "Artifact", mana_cost: "{2}", rarity: "common", set: "c21", print_url: null }] };

  it("one Undo takes both out, one Redo puts both lines back", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => ({ ok: true, status: 200, json: async () => (String(url).startsWith("/api/decks/add-search") ? results : SCRYFALL) })),
    );
    adds.addManyToDeckAction.mockResolvedValue({
      ok: true,
      results: [
        { ok: true, entryId: id(8), board: "main", quantity: 1, merged: false },
        { ok: true, entryId: id(9), board: "main", quantity: 1, merged: false },
      ],
    });
    const page = deckPage();
    const box = screen.getByRole("combobox", { name: "Add cards" });
    await act(async () => {
      box.focus();
      fireEvent.change(box, { target: { value: "arc" } });
    });
    await waitFor(() => expect(screen.getByRole("option", { name: /^Arcane Signet/ })).toBeTruthy());
    for (const name of [/^Ember Wyrm/, /^Arcane Signet/]) {
      await act(async () => {
        fireEvent.click(screen.getByRole("option", { name }).querySelector("[data-tick]")!);
      });
    }
    await press(screen.getByRole("button", { name: "Add 2 to Mainboard" }));
    // The server's rows, with the two new lines.
    const lines = [BOLT(), RING(), item(8, { name: "Ember Wyrm" }), item(9, { name: "Arcane Signet" })];
    page.rerender(<DeckCardList items={lines} ownerUsername="kesh" canManage deck={DECK} initialPrefs={{ view: "list", group: "none", sort: "name" }} />);
    expect(undoButton().getAttribute("aria-label")).toBe("Undo: add 2 cards");

    const out = [
      { id: id(8), name: "Ember Wyrm", board: "main", quantity: 1, scryfallId: null, cardId: WYRM, source: "link" },
      { id: id(9), name: "Arcane Signet", board: "main", quantity: 1, scryfallId: RING_SF, cardId: null, source: "import" },
    ];
    actions.removeDeckEntriesAction.mockResolvedValueOnce({ ok: true, removed: out });
    await press(undoButton());
    expect(actions.removeDeckEntriesAction).toHaveBeenCalledTimes(1);
    expect(actions.removeDeckEntriesAction).toHaveBeenCalledWith({ deckId: DECK.id, entryIds: [id(8), id(9)] });
    expect(redoButton().getAttribute("aria-label")).toBe("Redo: add 2 cards");

    actions.restoreDeckEntriesAction.mockResolvedValueOnce({ ok: true, restored: [{ from: id(8), to: id(18) }, { from: id(9), to: id(19) }] });
    await press(redoButton());
    expect(actions.restoreDeckEntriesAction).toHaveBeenCalledTimes(1);
    expect(actions.restoreDeckEntriesAction).toHaveBeenCalledWith({ deckId: DECK.id, entries: out });
    expect(undoButton().getAttribute("aria-label")).toBe("Undo: add 2 cards");
  });
});

describe("the History dialog", () => {
  const openHistory = async () => {
    await act(async () => {
      fireEvent.click(toolbar().getByRole("button", { name: "History" }));
    });
    await flush();
    return within(screen.getByRole("dialog", { name: "Deck history" }));
  };

  it("free: a locked panel with the plans — the log is the server's to refuse", async () => {
    history.listDeckHistoryAction.mockResolvedValue({ ok: false, error: "locked" });
    deckPage();
    const dialog = await openHistory();
    expect(history.listDeckHistoryAction).toHaveBeenCalledWith({ deckId: DECK.id });
    expect(dialog.getByText(/part of Plus \(30 days\) and Pro \(everything\)/)).toBeTruthy();
    await press(dialog.getByRole("button", { name: "See plans" }));
    expect(upgrade.open).toHaveBeenCalledWith("deck_history", "deck_history");
    expect(dialog.queryByRole("button", { name: /Restore/ })).toBeNull();
  });

  it("restores a version through the editor after one confirm; the toolbar's Undo takes it back", async () => {
    history.listDeckHistoryAction.mockResolvedValue({
      ok: true,
      access: { kind: "window", days: 30 },
      headId: 12,
      nextBefore: null,
      versions: [
        { headId: 12, at: "2026-11-02T10:00:00Z", summary: "Removed Sol Ring", changes: [{ id: 12, text: "Removed Sol Ring" }], count: 1, byOwner: true },
        { headId: 7, at: "2026-11-01T10:00:00Z", summary: "Added 2 cards", changes: [{ id: 7, text: "Added Bolt" }, { id: 6, text: "Added Sol Ring" }], count: 2, byOwner: true },
      ],
    });
    history.restoreDeckVersionAction.mockResolvedValue({ ok: true, headBefore: 12, removed: 0, changed: 0, restored: 1, notes: [] });
    deckPage();
    const dialog = await openHistory();
    expect(dialog.getByText("Plus keeps the last 30 days of changes. Pro keeps every version.")).toBeTruthy();
    expect(dialog.getByText("Current version")).toBeTruthy();
    // The current version has no restore; the older one asks once.
    const restoreButtons = dialog.getAllByRole("button", { name: /^Restore this version/ });
    expect(restoreButtons).toHaveLength(1);
    await press(restoreButtons[0]!);
    expect(history.restoreDeckVersionAction).not.toHaveBeenCalled();
    const confirm = dialog.getByRole("button", { name: /^Restore the version of/ });
    expect(document.activeElement).toBe(confirm);
    await press(confirm);
    expect(history.restoreDeckVersionAction).toHaveBeenCalledWith({ deckId: DECK.id, changeId: 7 });
    expect(screen.queryByRole("dialog", { name: "Deck history" })).toBeNull();
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/^Restored the version of .* — 1 card back\.$/), expect.anything());
    expect(undoButton().getAttribute("aria-label")).toMatch(/^Undo: restore the version of /);

    history.restoreDeckVersionAction.mockResolvedValue({ ok: true, headBefore: 15, removed: 1, changed: 0, restored: 0, notes: [] });
    await press(undoButton());
    // Back to the version it replaced.
    expect(history.restoreDeckVersionAction).toHaveBeenLastCalledWith({ deckId: DECK.id, changeId: 12 });
    expect(redoButton().getAttribute("aria-label")).toMatch(/^Redo: restore the version of /);
    await press(redoButton());
    // …and Redo makes it again: back to the version after the undo's own
    // changes are put back.
    expect(history.restoreDeckVersionAction).toHaveBeenLastCalledWith({ deckId: DECK.id, changeId: 15 });
  });

  const twoVersions = {
    ok: true,
    access: { kind: "full" },
    headId: 12,
    nextBefore: null,
    versions: [
      { headId: 12, at: "2026-11-02T10:00:00Z", summary: "Removed Sol Ring", changes: [{ id: 12, text: "Removed Sol Ring" }], count: 1, byOwner: true },
      { headId: 9, at: "2026-11-01T12:00:00Z", summary: "Added Bolt", changes: [{ id: 9, text: "Added Bolt" }], count: 1, byOwner: true },
      { headId: 7, at: "2026-11-01T10:00:00Z", summary: "Added Sol Ring", changes: [{ id: 7, text: "Added Sol Ring" }], count: 1, byOwner: true },
    ],
  };
  /** A restore of the version `changeId` (9 or 7), through the dialog; the
   *  toast's Undo. */
  const restoreThrough = async (changeId: number) => {
    const dialog = await openHistory();
    // Pro's line names the 30-day grace once Pro ends (owner 2026-11-02).
    expect(dialog.getByText("Pro keeps every version of this deck. If Pro ends, older history is kept 30 days.")).toBeTruthy();
    const buttons = dialog.getAllByRole("button", { name: /^Restore this version/ });
    await press(buttons[changeId === 9 ? 0 : 1]!);
    await press(dialog.getByRole("button", { name: /^Restore the version of/ }));
    expect(history.restoreDeckVersionAction).toHaveBeenLastCalledWith({ deckId: DECK.id, changeId });
    const call = toast.mock.calls.find(([text]) => typeof text === "string" && text.startsWith("Restored"))!;
    return (call[1] as { action: { onClick: () => void } }).action.onClick;
  };

  it("the restore toast's Undo takes back THAT restore while it is the newest step", async () => {
    history.listDeckHistoryAction.mockResolvedValue(twoVersions);
    history.restoreDeckVersionAction.mockResolvedValue({ ok: true, headBefore: 12, removed: 0, changed: 0, restored: 1, notes: [] });
    deckPage();
    const toastUndo = await restoreThrough(7);
    history.restoreDeckVersionAction.mockResolvedValue({ ok: true, headBefore: 14, removed: 1, changed: 0, restored: 0, notes: [] });
    await act(async () => toastUndo());
    await flush();
    expect(history.restoreDeckVersionAction).toHaveBeenLastCalledWith({ deckId: DECK.id, changeId: 12 });
    expect(history.restoreDeckVersionAction).toHaveBeenCalledTimes(2);
    expect(redoButton().getAttribute("aria-label")).toMatch(/^Redo: restore the version of /);
  });

  it("the toast's Undo does nothing under an edit made since — never undoes that edit, never the restore over it", async () => {
    history.listDeckHistoryAction.mockResolvedValue(twoVersions);
    history.restoreDeckVersionAction.mockResolvedValue({ ok: true, headBefore: 12, removed: 0, changed: 0, restored: 1, notes: [] });
    deckPage();
    const toastUndo = await restoreThrough(7);
    await press(copiesOf("Lightning Bolt").getByRole("button", { name: "One more" }));
    const writes = actions.updateDeckEntriesAction.mock.calls.length;
    await act(async () => toastUndo());
    await flush();
    expect(history.restoreDeckVersionAction).toHaveBeenCalledTimes(1);
    expect(actions.updateDeckEntriesAction.mock.calls.length).toBe(writes);
    // The edit is still the toolbar's to undo, and the restore under it.
    expect(undoButton().getAttribute("aria-label")).toBe("Undo: Lightning Bolt: 3 copies");
    expect(screen.getByText(/can't be undone from here/)).toBeTruthy();
  });

  it("the toast's Undo does nothing once ⌘Z has undone the restore — never twice", async () => {
    history.listDeckHistoryAction.mockResolvedValue(twoVersions);
    history.restoreDeckVersionAction.mockResolvedValue({ ok: true, headBefore: 12, removed: 0, changed: 0, restored: 1, notes: [] });
    deckPage();
    const toastUndo = await restoreThrough(7);
    history.restoreDeckVersionAction.mockResolvedValue({ ok: true, headBefore: 14, removed: 1, changed: 0, restored: 0, notes: [] });
    await act(async () => {
      fireEvent.keyDown(document.body, { key: "z", metaKey: true });
    });
    await flush();
    expect(history.restoreDeckVersionAction).toHaveBeenCalledTimes(2);
    await act(async () => toastUndo());
    await flush();
    expect(history.restoreDeckVersionAction).toHaveBeenCalledTimes(2);
    // The redo the ⌘Z left is still there.
    expect(redoButton().getAttribute("aria-label")).toMatch(/^Redo: restore the version of /);
  });

  it("Cancel on the confirm hands the focus back to that row's \"Restore this version\"", async () => {
    history.listDeckHistoryAction.mockResolvedValue(twoVersions);
    deckPage();
    const dialog = await openHistory();
    const second = dialog.getAllByRole("button", { name: /^Restore this version/ })[1]!;
    const name = second.getAttribute("aria-label");
    await press(second);
    const cancel = dialog.getByRole("button", { name: "Cancel" });
    expect(document.activeElement).toBe(dialog.getByRole("button", { name: /^Restore the version of/ }));
    await act(async () => {
      cancel.focus();
      fireEvent.click(cancel);
    });
    await flush();
    expect(dialog.queryByRole("button", { name: "Cancel" })).toBeNull();
    expect(document.activeElement?.getAttribute("aria-label")).toBe(name);
  });

  it("opened from the phone bar's More menu, it hands the focus back to More when it closes", async () => {
    history.listDeckHistoryAction.mockResolvedValue(twoVersions);
    deckPage();
    const bar = within(screen.getByRole("navigation", { name: "Deck editing" }));
    const more = bar.getByRole("button", { name: "More" });
    await act(async () => {
      fireEvent.click(more);
    });
    const menu = await screen.findByRole("menu", { name: "More" });
    await press(within(menu).getByRole("menuitem", { name: "Deck history" }));
    const dialog = within(screen.getByRole("dialog", { name: "Deck history" }));
    await act(async () => {
      fireEvent.keyDown(dialog.getAllByRole("button", { name: /^Restore this version/ })[0]!, { key: "Escape" });
    });
    await flush();
    expect(screen.queryByRole("dialog", { name: "Deck history" })).toBeNull();
    expect(document.activeElement).toBe(more);
  });
});
