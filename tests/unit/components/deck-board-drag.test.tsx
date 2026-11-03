// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { dynamicReady } from "@/tests/stubs/next-dynamic";

// ---------------------------------------------------------------------------
// TODO DK5.15 — drag entries between boards on the owner's deck page, with
// its keyboard and menu twins:
//
//   * a drop is the menus' MOVE — the same one batch write, the same line in
//     the live region, the same undo — and the focus stays on the card;
//   * every group standing for a board the card can go to is a drop zone
//     (dashed while the card is held, filled + named while it is over it),
//     and a tray of the format's boards reaches a board with no group yet;
//   * the commander zone is a target exactly where the menus offer it, and a
//     non-legendary card dropped there gets what a menu move gets: the move,
//     and the format check's own words in the summary bar;
//   * no drag on touch or a coarse pointer, nor from a control beside the
//     card; nothing at all on a visitor's page;
//   * the keyboard's way (M → the Move menu, arrows, Enter) and the "⋯"
//     menu's Move to make the same write.
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
const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn(), message: vi.fn() }));
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
vi.mock("@/lib/decks/add-actions", () => ({ addToDeckAction: vi.fn(), addManyToDeckAction: vi.fn() }));
vi.mock("@/lib/decks/membership-actions", () => ({ privateCardOfferAction: vi.fn() }));

import { DeckCardList } from "@/components/decks/deck-card-list";
import { DECK_ENTRY_DRAG_TYPE } from "@/lib/decks/board-drag";
import type { DeckItem } from "@/lib/decks/queries";
import type { DeckFormat } from "@/types/deck";
import type { DeckViewPrefs } from "@/lib/decks/deck-view";

beforeAll(() => dynamicReady());

const DECK = { id: "33333333-3333-4333-8333-333333333333", slug: "ness", title: "Ness" };
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function item(n: number, over: Record<string, unknown> = {}) {
  return {
    entry: {
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
    },
    card: null,
    cardOwner: null,
  } as unknown as DeckItem;
}

const BOLT = () => item(1, { name: "Lightning Bolt", quantity: 2 });
const RING = () => item(2, { name: "Sol Ring", type_line: "Artifact", mana_cost: "{1}" });
const DUSK = () => item(3, { name: "Duress", type_line: "Sorcery", board: "side" });

const ANALYTICS = { total: 3, byBoard: { main: 3, side: 0, maybe: 0, commander: 0, companion: 0 }, averageManaValue: 1, totalManaValue: 3, lands: 0 };

function ownerPage({
  items = [BOLT(), RING(), DUSK()],
  format = "casual",
  prefs = { view: "list", group: "board", sort: "name" },
}: { items?: DeckItem[]; format?: DeckFormat; prefs?: DeckViewPrefs } = {}) {
  return render(
    <DeckCardList
      items={items}
      ownerUsername="kesh"
      canManage
      deck={{ ...DECK, format }}
      initialPrefs={prefs}
      summary={{ format, analytics: ANALYTICS, formatIssues: [] }}
    />,
  );
}

/** The pointer the page sees: a mouse (fine, hovers) unless told. */
function pointer(fine: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: fine && query === "(hover: hover) and (pointer: fine)",
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  window.matchMedia = globalThis.matchMedia;
}

/** A drag's DataTransfer, as a browser hands it to the page. */
function transfer() {
  const data = new Map<string, string>();
  return {
    effectAllowed: "all",
    dropEffect: "none",
    get types() {
      return [...data.keys()];
    },
    setData: vi.fn((type: string, value: string) => data.set(type, value)),
    getData: (type: string) => data.get(type) ?? "",
    setDragImage: vi.fn(),
  };
}

const opener = (name: RegExp) => screen.getByRole("button", { name });
const cardOf = (name: RegExp) => opener(name).closest("li")!;
const groupNamed = (name: string) => screen.getByRole("region", { name: new RegExp(`^${name}`) });
const tray = () => document.querySelector<HTMLElement>("[data-board-drop-tray]");
const trayBoard = (label: string) =>
  Array.from(tray()?.querySelectorAll<HTMLElement>("li") ?? []).find((li) => li.textContent?.startsWith(label)) ?? null;
const status = () => screen.getByTestId("deck-editor-status").textContent;
const flush = () => act(async () => new Promise((resolve) => setTimeout(resolve, 80)));

/** Picks a card up with the mouse (pointerdown, then the drag's start). */
async function pickUp(card: HTMLElement, data = transfer(), from: Element = card.querySelector("[data-deck-entry]")!) {
  await act(async () => {
    fireEvent.pointerDown(from, { pointerType: "mouse" });
    fireEvent.dragStart(card, { dataTransfer: data, clientX: 10, clientY: 10 });
  });
  // The page draws the held card on the next tick.
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  return data;
}

async function dropOn(zone: HTMLElement, data: ReturnType<typeof transfer>) {
  await act(async () => {
    fireEvent.dragOver(zone, { dataTransfer: data });
  });
  await act(async () => {
    fireEvent.drop(zone, { dataTransfer: data });
  });
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://auth.pipglyph.com");
  for (const fn of [...Object.values(actions), ...Object.values(router), toast]) fn.mockReset?.();
  actions.updateDeckEntriesAction.mockReturnValue(new Promise(() => {}));
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("drag a card onto another board (DK5.15)", () => {
  it("only the owner's cards drag, on a fine pointer — each view's card wrapper", () => {
    pointer(true);
    for (const view of ["list", "grid", "stacks"] as const) {
      ownerPage({ prefs: { view, group: "board", sort: "name" } });
      expect(cardOf(/^Sol Ring/).getAttribute("draggable")).toBe("true");
      cleanup();
    }
  });

  it("held, the boards it can go to are drop zones; over one it is named; the drop is the menus' move — one write, said, focus kept", async () => {
    pointer(true);
    ownerPage();
    expect(tray()).toBeNull();
    const data = await pickUp(cardOf(/^Sol Ring/));
    expect(data.setData).toHaveBeenCalledWith(DECK_ENTRY_DRAG_TYPE, id(2));
    // Its own board is no target; the sideboard is.
    expect(groupNamed("Mainboard").getAttribute("data-drop-state")).toBeNull();
    const side = groupNamed("Sideboard");
    expect(side.getAttribute("data-drop-state")).toBe("target");
    // The tray: the format's boards (casual: no commander zone), its own marked.
    expect(Array.from(tray()!.querySelectorAll("li")).map((li) => li.textContent)).toEqual([
      "Mainboard(here)",
      "Sideboard",
      "Maybeboard",
      "Companion",
    ]);

    await act(async () => {
      fireEvent.dragOver(side, { dataTransfer: data });
    });
    expect(side.getAttribute("data-drop-state")).toBe("over");
    expect(within(side).getByText("Move here — the Sideboard")).toBeTruthy();
    await act(async () => {
      fireEvent.drop(side, { dataTransfer: data });
    });
    expect(actions.updateDeckEntriesAction).toHaveBeenCalledTimes(1);
    expect(actions.updateDeckEntriesAction).toHaveBeenCalledWith({ deckId: DECK.id, updates: [{ id: id(2), board: "side" }] });
    // Drawn at once in its new group, and the held card's zones gone.
    await waitFor(() => expect(within(groupNamed("Sideboard")).getByRole("button", { name: /^Sol Ring/ })).toBeTruthy());
    expect(tray()).toBeNull();
    expect(document.querySelector("[data-drop-state]")).toBeNull();
    await flush();
    expect(status()).toBe("Moved Sol Ring to the Sideboard.");
    expect(document.activeElement).toBe(opener(/^Sol Ring/));
  });

  it("the tray reaches a board with no group yet (an empty maybeboard), from a type-grouped page", async () => {
    pointer(true);
    ownerPage({ prefs: { view: "grid", group: "type", sort: "name" } });
    expect(screen.queryByRole("region", { name: /^Maybeboard/ })).toBeNull();
    const data = await pickUp(cardOf(/^Lightning Bolt/));
    // A mainboard type group stands for the mainboard: no target for a main card.
    expect(groupNamed("Instants").getAttribute("data-drop-state")).toBeNull();
    await dropOn(trayBoard("Maybeboard")!, data);
    expect(actions.updateDeckEntriesAction).toHaveBeenCalledWith({ deckId: DECK.id, updates: [{ id: id(1), board: "maybe" }] });
  });

  it("a sideboard card dropped on a mainboard TYPE group goes to the mainboard", async () => {
    pointer(true);
    ownerPage({ prefs: { view: "stacks", group: "type", sort: "name" } });
    const data = await pickUp(cardOf(/^Duress/));
    const instants = groupNamed("Instants");
    expect(instants.getAttribute("data-drop-state")).toBe("target");
    await dropOn(instants, data);
    expect(actions.updateDeckEntriesAction).toHaveBeenCalledWith({ deckId: DECK.id, updates: [{ id: id(3), board: "main" }] });
  });

  it("a picked card carries the whole selection — ONE write for every card", async () => {
    pointer(true);
    ownerPage();
    await act(async () => {
      fireEvent.click(opener(/^Lightning Bolt/), { shiftKey: true });
      fireEvent.click(opener(/^Sol Ring/), { shiftKey: true });
    });
    const data = await pickUp(cardOf(/^Sol Ring/));
    expect(within(tray()!).getByText(/move 2 cards/i)).toBeTruthy();
    await dropOn(groupNamed("Sideboard"), data);
    expect(actions.updateDeckEntriesAction).toHaveBeenCalledTimes(1);
    expect(actions.updateDeckEntriesAction).toHaveBeenCalledWith({
      deckId: DECK.id,
      updates: [
        { id: id(1), board: "side" },
        { id: id(2), board: "side" },
      ],
    });
  });

  it("a drop on the card's own board, or a drag that is not the page's, moves nothing", async () => {
    pointer(true);
    ownerPage();
    await pickUp(cardOf(/^Sol Ring/));
    // Something else held over the sideboard (a file, a link): not taken.
    const foreign = { ...transfer(), types: ["Files"] };
    const over = fireEvent.dragOver(groupNamed("Sideboard"), { dataTransfer: foreign });
    expect(over).toBe(true); // not prevented: the browser refuses the drop
    await act(async () => {
      fireEvent.drop(groupNamed("Mainboard"), { dataTransfer: transfer() });
    });
    expect(actions.updateDeckEntriesAction).not.toHaveBeenCalled();
  });

  it("Escape (the drag's end with no drop) puts every zone and the tray away", async () => {
    pointer(true);
    ownerPage();
    await pickUp(cardOf(/^Sol Ring/));
    expect(tray()).not.toBeNull();
    await act(async () => {
      fireEvent.dragEnd(cardOf(/^Sol Ring/));
    });
    expect(tray()).toBeNull();
    expect(document.querySelector("[data-drop-state]")).toBeNull();
  });
});

describe("no drag where a press is something else", () => {
  it("touch: a press is the selection's — the drag is cancelled, nothing is held", async () => {
    pointer(true);
    ownerPage();
    const card = cardOf(/^Sol Ring/);
    let started = true;
    await act(async () => {
      fireEvent.pointerDown(card.querySelector("[data-deck-entry]")!, { pointerType: "touch" });
      started = fireEvent.dragStart(card, { dataTransfer: transfer() });
    });
    await flush();
    expect(started).toBe(false);
    expect(tray()).toBeNull();
  });

  it("a coarse pointer (a phone): no card is draggable", () => {
    pointer(false);
    ownerPage();
    expect(cardOf(/^Sol Ring/).hasAttribute("draggable")).toBe(false);
  });

  it("a press on the stepper or the ⋯ beside the card never drags it", async () => {
    pointer(true);
    ownerPage();
    const card = cardOf(/^Sol Ring/);
    let started = true;
    await act(async () => {
      fireEvent.pointerDown(within(card).getByRole("button", { name: "More for Sol Ring" }), { pointerType: "mouse" });
      started = fireEvent.dragStart(card, { dataTransfer: transfer() });
    });
    await flush();
    expect(started).toBe(false);
    expect(tray()).toBeNull();
  });
});

describe("the commander zone (DK5.15)", () => {
  it("a Commander deck takes a drop on the zone; a non-legendary card gets what the menu's move gets — the move, and the format check's words", async () => {
    pointer(true);
    ownerPage({ format: "commander" });
    const data = await pickUp(cardOf(/^Sol Ring/));
    expect(trayBoard("Commander")!.getAttribute("data-drop-state")).toBe("target");
    await dropOn(trayBoard("Commander")!, data);
    expect(actions.updateDeckEntriesAction).toHaveBeenCalledWith({ deckId: DECK.id, updates: [{ id: id(2), board: "commander" }] });
    const dragged = screen.getByRole("region", { name: "Deck summary" }).textContent;
    // The app judges no card for the zone: the bar names the commander, and
    // the format check counts its issues — as after any move.
    expect(dragged).toContain("Commander: Sol Ring");
    expect(dragged).toMatch(/\d+ format issues?/);

    // The same card moved from its menu instead: the very same check.
    cleanup();
    actions.updateDeckEntriesAction.mockClear();
    ownerPage({ format: "commander" });
    await act(async () => {
      fireEvent.keyDown(opener(/^Sol Ring/), { key: "m" });
    });
    const menu = await screen.findByRole("menu", { name: "Move Sol Ring" });
    await act(async () => {
      fireEvent.click(within(menu).getByRole("menuitemradio", { name: "Commander" }));
    });
    expect(actions.updateDeckEntriesAction).toHaveBeenCalledWith({ deckId: DECK.id, updates: [{ id: id(2), board: "commander" }] });
    expect(screen.getByRole("region", { name: "Deck summary" }).textContent).toBe(dragged);
  });

  it("a format with no commander zone: no tray place for it, and a stray commander group takes no drop — as the menus offer none", async () => {
    pointer(true);
    ownerPage({ format: "standard", items: [BOLT(), RING(), item(4, { name: "Ness", board: "commander" })] });
    const data = await pickUp(cardOf(/^Sol Ring/));
    expect(trayBoard("Commander")).toBeNull();
    const zone = groupNamed("Commander");
    expect(zone.getAttribute("data-drop-state")).toBeNull();
    await dropOn(zone, data);
    expect(actions.updateDeckEntriesAction).not.toHaveBeenCalled();
  });
});

describe("the drag's twins — the keyboard and the menu (DK5.15 / WCAG 2.5.7)", () => {
  it("keyboard: M on a focused card opens Move to, the arrows pick, Enter moves — said, the focus back on the card", async () => {
    pointer(false);
    ownerPage();
    const ring = opener(/^Sol Ring/);
    ring.focus();
    await act(async () => {
      fireEvent.keyDown(ring, { key: "m" });
    });
    const menu = await screen.findByRole("menu", { name: "Move Sol Ring" });
    // Opened on the card's own board.
    await waitFor(() => expect(document.activeElement?.textContent).toBe("Mainboard"));
    await act(async () => {
      fireEvent.keyDown(menu, { key: "ArrowDown" });
    });
    expect(document.activeElement?.textContent).toBe("Sideboard");
    await act(async () => {
      fireEvent.click(document.activeElement!);
    });
    expect(actions.updateDeckEntriesAction).toHaveBeenCalledWith({ deckId: DECK.id, updates: [{ id: id(2), board: "side" }] });
    await flush();
    expect(status()).toBe("Moved Sol Ring to the Sideboard.");
    await waitFor(() => expect(document.activeElement).toBe(opener(/^Sol Ring/)));
  });

  it("menu: the row's ⋯ lists Move to with every board, the card's own checked; a pick is the same write", async () => {
    pointer(false);
    ownerPage();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "More for Sol Ring" }));
    });
    const menu = await screen.findByRole("menu", { name: "Sol Ring: actions" });
    expect(within(menu).getByText("Move to")).toBeTruthy();
    expect(within(menu).getAllByRole("menuitemradio").map((el) => [el.textContent, el.getAttribute("aria-checked")])).toEqual([
      ["Mainboard", "true"],
      ["Sideboard", "false"],
      ["Maybeboard", "false"],
      ["Companion", "false"],
    ]);
    await act(async () => {
      fireEvent.click(within(menu).getByRole("menuitemradio", { name: "Maybeboard" }));
    });
    expect(actions.updateDeckEntriesAction).toHaveBeenCalledWith({ deckId: DECK.id, updates: [{ id: id(2), board: "maybe" }] });
  });
});

describe("a visitor's page — nothing changes", () => {
  it("no card drags, no group is a drop zone, a drop does nothing", async () => {
    pointer(true);
    render(
      <DeckCardList
        items={[BOLT(), RING(), DUSK()]}
        ownerUsername="kesh"
        canManage={false}
        initialPrefs={{ view: "stacks", group: "board", sort: "name" }}
      />,
    );
    expect(document.querySelector("[draggable]")).toBeNull();
    expect(document.querySelector("[data-drop-board]")).toBeNull();
    const side = groupNamed("Sideboard");
    await act(async () => {
      fireEvent.dragOver(side, { dataTransfer: transfer() });
      fireEvent.drop(side, { dataTransfer: transfer() });
    });
    expect(actions.updateDeckEntriesAction).not.toHaveBeenCalled();
    expect(tray()).toBeNull();
  });
});
