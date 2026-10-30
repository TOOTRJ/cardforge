// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { beforeAll, afterEach, describe, expect, it, vi } from "vitest";
import { dynamicReady } from "@/tests/stubs/next-dynamic";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

// ---------------------------------------------------------------------------
// The deck list and its pop-up say each entry's status (TODO DK2.6) — the one
// deckEntryStatus answer — credit another creator's card (D3, TODO DK2.9)
// and link it at THEIR card page, and say "No longer available" where the
// card is gone, offering the owner a card of their own in its place.
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
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/creator/card-glossary", () => ({ CardGlossary: () => null }));
vi.mock("@/lib/decks/card-actions", () => ({
  linkDeckCardAction: vi.fn(),
  listMyCardsLiteAction: vi.fn(async () => ({ ok: true, cards: [] })),
  removeDeckCardAction: vi.fn(),
  unlinkDeckCardAction: vi.fn(),
  updateDeckCardAction: vi.fn(),
}));

import { DeckCardList } from "@/components/decks/deck-card-list";
import { DeckCardModal } from "@/components/decks/deck-card-modal";
import type { DeckItem } from "@/lib/decks/queries";

// The owner's parts are `next/dynamic` chunks: in before any test draws.
beforeAll(() => dynamicReady());

afterEach(cleanup);

function entry(id: string, over: Partial<DeckItem["entry"]> = {}): DeckItem["entry"] {
  return {
    id,
    deck_id: "d",
    board: "main",
    quantity: 1,
    position: 0,
    card_id: null,
    scryfall_id: null,
    source: "import",
    name: id,
    set_code: null,
    collector_number: null,
    type_line: null,
    mana_cost: null,
    mana_value: null,
    color_identity: [],
    rarity: null,
    image_url: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...over,
  };
}

function card(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    owner_id: "owner-1",
    slug: id.toLowerCase().replace(/\s+/g, "-"),
    title: id,
    cost: "{1}{R}",
    card_type: "creature",
    supertype: null,
    subtypes: [],
    color_identity: ["red"],
    frame_style: { template: "m15" },
    parent_card_id: null,
    rendered_image_url: null,
    rendered_thumb_url: null,
    ...over,
  } as unknown as NonNullable<DeckItem["card"]>;
}

const ITEMS: DeckItem[] = [
  { entry: entry("Fire // Ice", { scryfall_id: "sf-1", type_line: "Instant // Instant" }), card: null, cardOwner: null },
  {
    entry: entry("Solemn Simulacrum", { scryfall_id: "sf-2", card_id: "c-ed", type_line: "Artifact Creature — Golem" }),
    // Edited since its import of this printing (0144 provenance; the
    // fingerprint is of what it printed then, so it no longer matches).
    card: card("Solemn Sentinel", { card_type: "instant", import_scryfall_id: "sf-2", import_fingerprint: `v1:${"0".repeat(64)}` }),
    cardOwner: null,
  },
  { entry: entry("Broodling", { card_id: "c-rx", source: "creator" }), card: card("Broodling", { parent_card_id: "p" }), cardOwner: null },
  { entry: entry("Archivist", { card_id: "c-og", source: "creator" }), card: card("Archivist"), cardOwner: null },
  {
    entry: entry("Cinderwing Matriarch", { card_id: "c-foreign", source: "link" }),
    card: card("Cinderwing Matriarch", { owner_id: "artist-1" }),
    cardOwner: { username: "dev_artist" },
  },
  { entry: entry("Tidecaller Apprentice", { card_id: "c-private", source: "link" }), card: null, cardOwner: null },
  { entry: entry("Ashen Prototype", { source: "creator" }), card: null, cardOwner: null },
  { entry: entry("Zqx Unknown Relic"), card: null, cardOwner: null },
];

// A row's name is "<name>, <n> cop(y|ies), <status>" (TODO DK5.12).
const rowOf = (name: string) => screen.getByRole("button", { name: new RegExp(`^${name.replace(/[/]/g, "\\/")}, `) });

describe("the deck list's status badges", () => {
  it("each row says its status; the owner sees what's gone", () => {
    render(<DeckCardList items={ITEMS} ownerUsername="dev_pro" canManage />);
    const badge = (name: string) => rowOf(name).querySelector("[data-status]")?.textContent;
    expect(badge("Fire // Ice")).toBe("Imported");
    expect(badge("Solemn Sentinel")).toBe("Edited");
    expect(badge("Broodling")).toBe("Remix");
    expect(badge("Archivist")).toBe("Original");
    expect(badge("Cinderwing Matriarch by @dev_artist")).toBe("Original");
    expect(badge("Tidecaller Apprentice")).toBe("No longer available");
    expect(badge("Ashen Prototype")).toBe("No longer available");
    expect(badge("Zqx Unknown Relic")).toBe("Not found");
  });

  it("a visitor can't tell another creator's private card from the owner's: no label", () => {
    render(<DeckCardList items={ITEMS} ownerUsername="dev_pro" canManage={false} />);
    // A card the visitor can't read is a "Private card" (D11) — with no
    // printing behind it, the entry's name is the card's own title: hidden.
    const privateRows = screen.getAllByRole("button", { name: /^Private card, / });
    expect(privateRows.map((row) => row.querySelector("[data-status]")?.textContent).sort()).toEqual(["No longer available", "Original"]);
    expect(screen.queryByText("Tidecaller Apprentice")).toBeNull();
    // A deleted card is gone for everyone — and its name (the deleted
    // card's title, maybe a private one's) is the owner's alone (0152).
    expect(screen.queryByText("Ashen Prototype")).toBeNull();
  });

  it("credits another creator's card, in the row and its name", () => {
    render(<DeckCardList items={ITEMS} ownerUsername="dev_pro" canManage />);
    const row = rowOf("Cinderwing Matriarch by @dev_artist");
    expect(within(row).getByText("by @dev_artist")).toBeTruthy();
    expect(within(rowOf("Archivist")).queryByText(/by @/)).toBeNull();
  });

  it("groups an edited card as what it now is (its effective type line)", () => {
    render(<DeckCardList items={ITEMS} ownerUsername="dev_pro" canManage />);
    const instants = screen.getByRole("heading", { name: /^Instants\b/ }).closest("section");
    expect(within(instants as HTMLElement).getByRole("button", { name: /^Solemn Sentinel, / })).toBeTruthy();
  });
});

describe("the pop-up", () => {
  it("another creator's card: credit, and its page under ITS maker's handle", () => {
    render(<DeckCardModal item={ITEMS[4]!} ownerUsername="dev_pro" canManage open onOpenChange={() => {}} preferProxy />);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("link", { name: /by @dev_artist/ }).getAttribute("href")).toBe("/profile/dev_artist");
    const [page] = within(dialog).getAllByRole("link", { name: "Open this card's page" });
    expect(page!.getAttribute("href")).toBe("/card/dev_artist/cinderwing-matriarch");
  });

  it("the owner's own card keeps the deck owner's handle", () => {
    render(<DeckCardModal item={ITEMS[3]!} ownerUsername="dev_pro" canManage open onOpenChange={() => {}} preferProxy />);
    expect(within(screen.getByRole("dialog")).getAllByRole("link", { name: "Open this card's page" })[0]!.getAttribute("href")).toBe(
      "/card/dev_pro/archivist",
    );
  });

  it("a card that went private: No longer available, and the owner may make their own", () => {
    render(<DeckCardModal item={ITEMS[5]!} ownerUsername="dev_pro" canManage open onOpenChange={() => {}} preferProxy />);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("No longer available")).toBeTruthy();
    // Never WHY (private, unlisted, hidden, deleted): the deck can't know.
    expect(within(dialog).getByTestId("deck-card-unavailable").textContent).toBe("This card is no longer available.");
    expect(within(dialog).getByRole("link", { name: /Make your own version/ }).getAttribute("href")).toBe("/create?deckCard=Tidecaller Apprentice");
  });

  it("a card that's gone says the same neutral words; a visitor gets no action", () => {
    render(<DeckCardModal item={ITEMS[6]!} ownerUsername="dev_pro" canManage={false} open onOpenChange={() => {}} preferProxy />);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByTestId("deck-card-unavailable").textContent).toBe("This card is no longer available.");
    expect(within(dialog).queryByRole("link", { name: /Make your own version/ })).toBeNull();
  });

  it("an edited card's pop-up reads its own type line and cost", () => {
    render(<DeckCardModal item={ITEMS[1]!} ownerUsername="dev_pro" canManage open onOpenChange={() => {}} preferProxy />);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Edited")).toBeTruthy();
    expect(within(dialog).getByText(/^Instant/)).toBeTruthy();
    fireEvent.keyDown(dialog, { key: "Escape" });
  });
});
