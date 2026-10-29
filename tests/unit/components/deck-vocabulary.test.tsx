// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";

// ---------------------------------------------------------------------------
// The deck pages in the new card vocabulary (owner 2026-10-28, TODO DK2.2,
// components/creator/card-glossary.tsx): a real card not yet customized is
// "Imported", one with your version linked is "Edited", the headline action
// is "Customize", taking your version off is "Use the real card" — and
// "custom proxy" / "Needs proxy" are gone. The stat block ("Proxied", "%
// proxied") waits for DK2.6's status counts.
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
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }));
vi.mock("@/components/creator/card-glossary", () => ({ CardGlossary: () => null }));
vi.mock("@/lib/decks/card-actions", () => ({
  linkDeckCardAction: vi.fn(),
  listMyCardsLiteAction: vi.fn(async () => ({ ok: true, cards: [] })),
  removeDeckCardAction: vi.fn(),
  unlinkDeckCardAction: vi.fn(),
  updateDeckCardAction: vi.fn(),
}));

import { DeckCardModal } from "@/components/decks/deck-card-modal";
import { DeckCardList } from "@/components/decks/deck-card-list";
import type { DeckItem } from "@/lib/decks/queries";

afterEach(cleanup);

const PRINT = "https://cards.scryfall.io/normal/front/a/b/abc.jpg";

function entry(id: string, name: string, over: Record<string, unknown> = {}) {
  return {
    id,
    deck_id: "33333333-3333-4333-8333-333333333333",
    card_id: null,
    scryfall_id: `sf-${id}`,
    name,
    quantity: 1,
    board: "main",
    type_line: "Instant",
    mana_cost: "{R}",
    image_url: PRINT,
    set_code: "m11",
    collector_number: "149",
    ...over,
  };
}

const real = { entry: entry("e-1", "Lightning Bolt"), card: null } as unknown as DeckItem;
const edited = {
  entry: entry("e-2", "Counterspell", { card_id: "c-2" }),
  card: { id: "c-2", title: "Counter-Hex", slug: "counter-hex", card_type: "instant", rendered_image_url: null, rendered_thumb_url: null },
} as unknown as DeckItem;
const original = {
  entry: entry("e-3", "Ember Imp", { scryfall_id: null, card_id: "c-3", image_url: null }),
  card: { id: "c-3", title: "Ember Imp", slug: "ember-imp", card_type: "creature", rendered_image_url: null, rendered_thumb_url: null },
} as unknown as DeckItem;

const NOT_THESE = /custom proxy|needs proxy|unlink proxy|my prox/i;

const modal = (item: DeckItem) =>
  render(<DeckCardModal item={item} ownerUsername="kesh" canManage open onOpenChange={() => {}} preferProxy />);

describe("the deck card pop-up", () => {
  it("a real card: “Imported”, and “Customize” opens the creator on the entry", () => {
    modal(real);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Imported")).toBeTruthy();
    expect(within(dialog).getByRole("link", { name: "Customize" }).getAttribute("href")).toBe("/create?deckCard=e-1");
    expect(within(dialog).getByRole("link", { name: /View the real card on Scryfall/ })).toBeTruthy();
    expect(dialog.textContent).not.toMatch(NOT_THESE);
  });

  // (Its "Real card | Custom card" image switch: two-faces-surfaces.test.tsx.)
  it("an edited real card: “Edited”, and “Use the real card”", () => {
    modal(edited);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Edited")).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Use the real card" })).toBeTruthy();
    expect(dialog.textContent).not.toMatch(NOT_THESE);
  });

  it("a card of your own with no real card behind it is unlinked, not sent back to a real card", () => {
    modal(original);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "Unlink card" })).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: "Use the real card" })).toBeNull();
  });
});

describe("the deck card list", () => {
  it("badges each row, and its filter chips say the badges' words", async () => {
    render(<DeckCardList items={[real, edited, original]} ownerUsername="kesh" canManage={false} />);
    // A ChipGroup (TODO DK5.6): one radio a status, its card count in its name.
    const filters = screen.getByRole("radiogroup", { name: "Filter by card status" });
    expect(within(filters).getByRole("radio", { name: "Imported 1" })).toBeTruthy();
    expect(within(filters).getByRole("radio", { name: "Edited 1" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Showing custom cards" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Lightning Bolt, 1 copy, Imported" }).textContent).toContain("Imported");
    expect(screen.getByRole("button", { name: "Counter-Hex, 1 copy, Edited" }).textContent).toContain("Edited");
    expect(document.body.textContent).not.toMatch(NOT_THESE);

    // Each chip shows exactly the rows wearing its badge.
    const row = (name: string) => screen.queryByRole("button", { name: new RegExp(`^${name}, `) });
    await act(async () => {
      fireEvent.click(within(filters).getByRole("radio", { name: "Edited 1" }));
    });
    expect(row("Counter-Hex")).toBeTruthy();
    expect(row("Lightning Bolt")).toBeNull();
    expect(row("Ember Imp")).toBeNull();
    await act(async () => {
      fireEvent.click(within(filters).getByRole("radio", { name: "Imported 1" }));
    });
    expect(row("Lightning Bolt")).toBeTruthy();
    expect(row("Counter-Hex")).toBeNull();
    expect(row("Ember Imp")).toBeNull();
    await act(async () => {
      fireEvent.click(within(filters).getByRole("radio", { name: "All 3" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Showing custom cards" }));
    });
    expect(screen.getByRole("button", { name: "Showing real cards" })).toBeTruthy();
  });
});
