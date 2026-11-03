// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// ---------------------------------------------------------------------------
// My Cards and decks (TODO DK9.2):
//   * every card that may join a deck carries ONE chip — "In 2 decks" (the
//     owner's own decks that hold it) or "Add to deck" — outside the tile's
//     own control, opening the picker for that card; never on an admin's
//     frame preview, and on the Liked tab only another creator's PUBLIC
//     card (owner decision D3); a count that couldn't be read claims none;
//   * the bulk bar's "Add to deck…" opens the same picker for the selection,
//     on the Liked tab too;
//   * closing the picker after a write reads the page again (the chips are
//     the server's numbers).
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
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/components/cards/baked-card-thumbnail", () => ({
  BakedCardThumbnail: (props: { title: string }) => <div data-testid="thumb">{props.title}</div>,
}));
vi.mock("@/components/cards/card-tile", () => ({
  CardTile: ({ body }: { body: (slot: Record<string, unknown>) => ReactNode }) => <div>{body({})}</div>,
}));
vi.mock("@/components/cards/render-update", () => ({ RenderUpdateBadge: () => null }));
vi.mock("@/components/cards/quick-like-button", () => ({ QuickLikeButton: () => null }));
vi.mock("@/components/cards/print-selection-dialog", () => ({ PrintSelectionDialog: () => null }));
vi.mock("@/lib/cards/preview-data", () => ({ cardToPreviewData: () => ({}) }));
vi.mock("@/components/billing/upgrade-modal-provider", () => ({ useUpgradeModal: () => ({ open: vi.fn() }) }));
vi.mock("@/lib/cards/actions", () => ({ updateCardsVisibilityAction: vi.fn(), deleteCardsAction: vi.fn() }));
vi.mock("@/lib/decks/actions", () => ({ createDeckAction: vi.fn() }));
vi.mock("@/lib/decks/card-actions", () => ({ updateDeckCardAction: vi.fn() }));
const actions = vi.hoisted(() => ({
  getDeckPickerDataAction: vi.fn(),
  changeDeckMembershipAction: vi.fn(),
}));
vi.mock("@/lib/decks/membership-actions", () => actions);

import { MyCardsBrowser } from "@/components/creator/my-cards-browser";
import type { DashboardCard } from "@/components/creator/dashboard-card-tile";
import type { CardWithStats } from "@/lib/cards/queries";

const id = (n: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, "0")}`;
const DECK = "33333333-3333-4333-8333-333333333333";

const mine = (n: number, overrides: Record<string, unknown> = {}) =>
  ({
    id: id(n),
    slug: `card-${n}`,
    title: `Card ${n}`,
    visibility: "public",
    rendered_image_url: null,
    rendered_thumb_url: null,
    supertype: null,
    card_type: "instant",
    subtypes: [],
    likes_count: 0,
    updated_at: "2026-10-28T10:00:00Z",
    created_at: "2026-10-28T10:00:00Z",
    parent_card_id: null,
    ...overrides,
  }) as unknown as DashboardCard;
const liked = (n: number, visibility: string) =>
  ({ ...mine(n), visibility, owner: { username: "someone" }, liked_by_viewer: true }) as unknown as CardWithStats;

function browser(props: Partial<React.ComponentProps<typeof MyCardsBrowser>> = {}) {
  return render(
    <MyCardsBrowser
      cards={[mine(1), mine(2), mine(3, { frame_preview: true, visibility: "private" })]}
      likedCards={[liked(10, "public"), liked(11, "unlisted")]}
      remixParents={{}}
      initialView="grid"
      initialFilter="all"
      initialSort="title"
      deckCounts={{ [id(1)]: 2 }}
      {...props}
    />,
  );
}

beforeEach(() => {
  actions.getDeckPickerDataAction.mockResolvedValue({
    ok: true,
    decks: [{ id: DECK, title: "Burn", format: "modern", visibility: "public" }],
    memberships: {},
  });
});
afterEach(() => {
  cleanup();
  for (const fn of [...Object.values(actions), ...Object.values(router)]) fn.mockReset();
});

describe("My Cards — a card's decks", () => {
  it("one chip per card that may join a deck: its count, or Add to deck — never on a frame preview", () => {
    browser();
    const chips = screen.getAllByTestId("deck-chip");
    expect(chips.map((chip) => chip.getAttribute("aria-label"))).toEqual([
      "In 2 decks: Card 1",
      "Add to deck: Card 2",
    ]);
    expect(chips[0]!.textContent).toBe("In 2 decks");
    expect(chips[1]!.textContent).toBe("Add to deck");
    // Label in name (WCAG 2.5.3): the name starts with the words on the chip.
    for (const chip of chips) expect(chip.getAttribute("aria-label")!.startsWith(chip.textContent!)).toBe(true);
  });

  it("the list view carries the same chips", () => {
    browser({ initialView: "list" });
    expect(screen.getAllByTestId("deck-chip")).toHaveLength(2);
  });

  it("a count that couldn't be read claims none", () => {
    browser({ deckCounts: null });
    expect(screen.getAllByTestId("deck-chip").map((chip) => chip.textContent)).toEqual(["Decks", "Decks"]);
  });

  it("the Liked tab: another creator's PUBLIC card only (D3)", () => {
    browser({ initialFilter: "liked" });
    expect(screen.getAllByTestId("deck-chip").map((chip) => chip.getAttribute("aria-label"))).toEqual([
      "Add to deck: Card 10",
    ]);
  });

  it("a chip opens the picker for that card; closing it after a write reads the page again", async () => {
    actions.changeDeckMembershipAction.mockResolvedValue({
      ok: true,
      deckId: DECK,
      deckTitle: "Burn",
      deckSlug: "burn",
      results: [{ cardId: id(2), status: "added" }],
      entries: [{ cardId: id(2), deckId: DECK, entryId: "e1", board: "main", quantity: 1 }],
    });
    browser();
    fireEvent.click(screen.getByRole("button", { name: "Add to deck: Card 2" }));
    const dialog = await screen.findByRole("dialog", { name: "Add “Card 2” to a deck" });
    expect(actions.getDeckPickerDataAction).toHaveBeenCalledWith([id(2)]);
    const burn = await within(dialog).findByRole("checkbox", { name: "Burn" });
    await act(async () => {
      fireEvent.click(burn);
    });
    expect(actions.changeDeckMembershipAction).toHaveBeenCalledWith({ deckId: DECK, add: [id(2)], privateCards: "ask" });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Done" }));
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it("the bulk bar's Add to deck… opens the picker for the selection", async () => {
    browser();
    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    // (The tile's body and its corner box both say "Select …" in select mode.)
    fireEvent.click(screen.getAllByRole("button", { name: "Select Card 1" })[0]!);
    fireEvent.click(screen.getAllByRole("button", { name: "Select Card 2" })[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Add to deck…" }));
    await screen.findByRole("dialog", { name: "Add 2 cards to a deck" });
    expect(actions.getDeckPickerDataAction).toHaveBeenCalledWith([id(1), id(2)]);
  });

  it("…on the Liked tab too", async () => {
    browser({ initialFilter: "liked" });
    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    fireEvent.click(screen.getByRole("button", { name: "Select Card 10" }));
    expect(screen.queryByRole("button", { name: /Make public/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add to deck…" }));
    await screen.findByRole("dialog", { name: "Add “Card 10” to a deck" });
  });
});
