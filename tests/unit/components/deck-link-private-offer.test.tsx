// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// ---------------------------------------------------------------------------
// TODO DK0.13 on the card pop-up's "Link an existing card": linking one of
// the maker's PRIVATE cards onto an entry of a deck others can open asks
// first (privateCardOfferAction, a read) — "Make it public" links with
// `publish` (the server makes it public first, then links), "Add as
// private" links as before, Escape links nothing. A private deck never asks.
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
const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), message: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
vi.mock("@/components/creator/card-glossary", () => ({ CardGlossary: () => null }));
const deckCardActions = vi.hoisted(() => ({
  linkDeckCardAction: vi.fn(),
  listMyCardsLiteAction: vi.fn(),
  unlinkDeckCardAction: vi.fn(),
  updateDeckEntriesAction: vi.fn(),
  removeDeckEntriesAction: vi.fn(),
  restoreDeckEntriesAction: vi.fn(),
  setDeckCoverPicksAction: vi.fn(),
}));
vi.mock("@/lib/decks/card-actions", () => deckCardActions);
vi.mock("@/lib/decks/add-actions", () => ({ addToDeckAction: vi.fn() }));
const offers = vi.hoisted(() => ({ privateCardOfferAction: vi.fn() }));
vi.mock("@/lib/decks/membership-actions", () => offers);

import { DeckCardModal } from "@/components/decks/deck-card-modal";
import { DeckEditorProvider } from "@/components/decks/use-deck-editor";
import type { DeckItem } from "@/lib/decks/queries";

const DECK_ID = "33333333-3333-4333-8333-333333333333";
const ENTRY = "22222222-2222-4222-8222-222222222222";
const MINE = "11111111-1111-4111-8111-111111111111";

const realEntry = {
  entry: {
    id: ENTRY,
    deck_id: DECK_ID,
    card_id: null,
    scryfall_id: "sf-1",
    name: "Lightning Bolt",
    quantity: 4,
    board: "main",
    type_line: "Instant",
    mana_cost: "{R}",
    image_url: null,
    set_code: "m11",
    collector_number: "149",
  },
  card: null,
  cardOwner: null,
} as unknown as DeckItem;

function page(visibility: "public" | "unlisted" | "private") {
  return render(
    <DeckEditorProvider deck={{ id: DECK_ID, slug: "burn", title: "Burn", format: "modern", visibility }} items={[]}>
      <DeckCardModal item={realEntry} ownerUsername="kesh" canManage open onOpenChange={() => {}} preferProxy />
    </DeckEditorProvider>,
  );
}

async function pickMine() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /link an existing card/i }));
  });
  await waitFor(() => expect(screen.getByRole("button", { name: /Bolt of Ember/ })).toBeTruthy());
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /Bolt of Ember/ }));
  });
}

beforeEach(() => {
  deckCardActions.listMyCardsLiteAction.mockResolvedValue({
    ok: true,
    cards: [{ id: MINE, title: "Bolt of Ember", slug: "bolt-of-ember", rendered_image_url: null, rendered_thumb_url: null }],
  });
  deckCardActions.linkDeckCardAction.mockResolvedValue({ ok: true, deckCardId: ENTRY });
});
afterEach(() => {
  cleanup();
  for (const fn of [...Object.values(deckCardActions), ...Object.values(offers), toast.error]) fn.mockReset();
});

describe("Link an existing card — a private card into a deck others can open (DK0.13)", () => {
  it("asks first; Make it public links with publish", async () => {
    offers.privateCardOfferAction.mockResolvedValue({ ok: true, cards: [{ cardId: MINE }] });
    page("public");
    await pickMine();
    expect(offers.privateCardOfferAction).toHaveBeenCalledWith({ deckId: DECK_ID, cardIds: [MINE] });
    const offer = await screen.findByRole("dialog", { name: "Add “Bolt of Ember” to “Burn”?" });
    expect(deckCardActions.linkDeckCardAction).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(within(offer).getByRole("button", { name: "Make it public" }));
    });
    expect(deckCardActions.linkDeckCardAction).toHaveBeenCalledWith(ENTRY, MINE, { publish: true });
  });

  it("Add as private links as before; Escape links nothing and hands the focus back", async () => {
    offers.privateCardOfferAction.mockResolvedValue({ ok: true, cards: [{ cardId: MINE }] });
    page("unlisted");
    await pickMine();
    let offer = await screen.findByRole("dialog", { name: "Add “Bolt of Ember” to “Burn”?" });
    await act(async () => {
      fireEvent.keyDown(offer, { key: "Escape" });
    });
    expect(deckCardActions.linkDeckCardAction).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("button", { name: /link an existing card/i })),
    );
    await pickMine();
    offer = await screen.findByRole("dialog", { name: "Add “Bolt of Ember” to “Burn”?" });
    await act(async () => {
      fireEvent.click(within(offer).getByRole("button", { name: "Add as private" }));
    });
    expect(deckCardActions.linkDeckCardAction).toHaveBeenCalledWith(ENTRY, MINE, {});
  });

  it("a private deck never asks", async () => {
    page("private");
    await pickMine();
    expect(offers.privateCardOfferAction).not.toHaveBeenCalled();
    await waitFor(() => expect(deckCardActions.linkDeckCardAction).toHaveBeenCalledWith(ENTRY, MINE));
  });
});
