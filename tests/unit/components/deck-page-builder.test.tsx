// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { beforeAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dynamicReady } from "@/tests/stubs/next-dynamic";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";

// ---------------------------------------------------------------------------
// The deck page's card area (TODO DK5.3 / DK5.6 / DK5.9 / DK5.12 / DK5.17):
// the four views from one list, the remembered choice (a cookie), the
// status chips, a visitor's "Private card" tile (never the card's title or
// art), the sticky summary bar (the format check the owner's alone, "Edit
// next" the next unchanged import's Customize flow), and every opener's
// name saying its quantity and status. The two-faced tile and the pop-up's
// focus hand-back: two-faces-surfaces.test.tsx.
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
vi.mock("@/components/cards/card-preview", () => ({ CardPreview: () => <div data-testid="live-preview" /> }));
vi.mock("@/lib/decks/card-actions", () => ({
  linkDeckCardAction: vi.fn(),
  listMyCardsLiteAction: vi.fn(async () => ({ ok: true, cards: [] })),
  removeDeckCardAction: vi.fn(),
  unlinkDeckCardAction: vi.fn(),
  updateDeckCardAction: vi.fn(),
}));

import { DeckCardList } from "@/components/decks/deck-card-list";
import { DeckAnalyticsPanel } from "@/components/decks/deck-analytics-panel";
import { DeckSummaryBar } from "@/components/decks/deck-summary-bar";
import { computeDeckAnalytics } from "@/lib/decks/analytics";
import { computeDeckCharts } from "@/lib/decks/deck-charts";
import { deckSummaryOf } from "@/lib/decks/deck-summary";
import { DECK_VIEW_COOKIE, deckRowsOf, deckStatusCountsOf, ENTRY_BADGE_COUNT_LABELS, statusCountRows } from "@/lib/decks/deck-view";
import type { DeckItem } from "@/lib/decks/queries";

// The owner's parts are `next/dynamic` chunks: in before any test draws.
beforeAll(() => dynamicReady());

// Our storage host: a bake's pointers are drawn only from it.
beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://auth.pipglyph.com");
});
afterEach(() => {
  vi.unstubAllEnvs();
  cleanup();
  document.cookie = `${DECK_VIEW_COOKIE}=; path=/deck; max-age=0`;
});

const HOST = "https://auth.pipglyph.com";
const RENDERS = `${HOST}/storage/v1/object/public/card-renders/owner-1`;
const PRINT = "https://cards.scryfall.io/normal/front/a/b/abc.jpg?1700000000";

let n = 0;
function entry(over: Record<string, unknown> = {}) {
  n += 1;
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    deck_id: "d",
    board: "main",
    quantity: 1,
    position: n,
    card_id: null,
    scryfall_id: `sf-${n}`,
    source: "import",
    name: `Card ${n}`,
    set_code: "dom",
    collector_number: String(n),
    type_line: "Creature — Elf",
    mana_cost: "{G}",
    mana_value: 1,
    color_identity: ["G"],
    rarity: "common",
    image_url: PRINT,
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
    ...over,
  };
}

function card(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    owner_id: "owner-1",
    slug: id,
    title: `Title of ${id}`,
    visibility: "public",
    cost: "{1}{R}",
    card_type: "creature",
    supertype: null,
    subtypes: [],
    color_identity: ["red"],
    frame_style: { template: "m15" },
    parent_card_id: null,
    rendered_image_url: `${RENDERS}/${id}.png?v=1`,
    rendered_thumb_url: `${RENDERS}/${id}.thumb.webp?v=1`,
    rendered_back_image_url: null,
    rendered_back_thumb_url: null,
    ...over,
  };
}

/** A card id our render names accept (lib/cards/render-cdn.ts). */
const CARD_ID = "11111111-1111-4111-8111-111111111111";

const item = (e: Record<string, unknown> = {}, c: ReturnType<typeof card> | null = null) =>
  ({ entry: entry(e), card: c, cardOwner: null }) as unknown as DeckItem;

describe("the views", () => {
  const items = () => [
    item({ name: "Llanowar Elves", quantity: 4 }),
    item({ name: "Sol Ring", type_line: "Artifact", mana_cost: "{1}", color_identity: [] }),
    item({ name: "Shivan Dragon", card_id: CARD_ID, scryfall_id: null, source: "creator" }, card(CARD_ID, { title: "Ember Wyrm" })),
  ];

  it("draws the same cards in each view, each opener named with its quantity and status", async () => {
    render(<DeckCardList items={items()} ownerUsername="kesh" canManage={false} initialPrefs={{ view: "stacks", group: "type", sort: "mana" }} />);
    const names = () =>
      Array.from(document.querySelectorAll("[data-deck-entry]"))
        .map((el) => el.getAttribute("aria-label"))
        .sort();
    const expected = ["Ember Wyrm, 1 copy, Original", "Llanowar Elves, 4 copies, Imported", "Sol Ring, 1 copy, Imported"];
    expect(names()).toEqual(expected);
    // Stacks: a pile per group, the real cards on Scryfall's normal picture.
    expect(screen.getByRole("heading", { name: /^Creatures/ })).toBeTruthy();
    expect(Array.from(document.querySelectorAll("img")).map((img) => img.getAttribute("src"))).toContain(PRINT);

    const views = screen.getByRole("radiogroup", { name: "View" });
    for (const view of ["Grid", "List", "Table"]) {
      await act(async () => {
        fireEvent.click(within(views).getByRole("radio", { name: view }));
      });
      expect(within(views).getByRole("radio", { name: view }).getAttribute("aria-checked")).toBe("true");
      expect(names()).toEqual(expected);
    }
    // Table: one real table, the sortable columns' headers sort.
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("columnheader").map((th) => th.textContent?.trim())).toEqual([
      "Qty",
      "Name",
      "Cost",
      "MV",
      "Type",
      "Color",
      "Rarity",
      "Status",
      "Board",
      "Added",
    ]);
    expect(within(table).getByRole("columnheader", { name: /MV/ }).getAttribute("aria-sort")).toBe("ascending");
    await act(async () => {
      fireEvent.click(within(table).getByRole("button", { name: "Qty" }));
    });
    expect(within(table).getByRole("columnheader", { name: /Qty/ }).getAttribute("aria-sort")).toBe("descending");
    expect((screen.getByRole("combobox", { name: "Sort by" }) as HTMLSelectElement).value).toBe("quantity");
  });

  it("rows ask Scryfall for its SMALL picture; tiles for the normal one; a custom card's tile is its 600 px thumb", async () => {
    render(<DeckCardList items={items()} ownerUsername="kesh" canManage={false} initialPrefs={{ view: "list", group: "type", sort: "mana" }} />);
    const srcs = () => Array.from(document.querySelectorAll("img")).map((img) => img.getAttribute("src"));
    expect(srcs()).toContain("https://cards.scryfall.io/small/front/a/b/abc.jpg?1700000000");
    expect(srcs()).not.toContain(PRINT);
    await act(async () => {
      fireEvent.click(screen.getByRole("radio", { name: "Grid" }));
    });
    expect(srcs()).toContain(PRINT);
    expect(srcs()).toContain(`/render-cdn/owner-1/${CARD_ID}.thumb.webp?v=1`);
    expect(srcs().some((src) => src?.endsWith(".png?v=1"))).toBe(false);
  });

  it("remembers the view, the grouping and the sort in ONE cookie, scoped to the deck pages", async () => {
    // The cookie's path is /deck: read it from a deck page.
    window.history.pushState({}, "", "/deck/sampler");
    render(<DeckCardList items={items()} ownerUsername="kesh" canManage={false} initialPrefs={{ view: "stacks", group: "type", sort: "mana" }} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("radio", { name: "Table" }));
    });
    expect(document.cookie).toContain(`${DECK_VIEW_COOKIE}=table.type.mana`);
    await act(async () => {
      fireEvent.change(screen.getByRole("combobox", { name: "Group by" }), { target: { value: "rarity" } });
    });
    await act(async () => {
      fireEvent.change(screen.getByRole("combobox", { name: "Sort by" }), { target: { value: "added" } });
    });
    expect(document.cookie).toContain(`${DECK_VIEW_COOKIE}=table.rarity.added`);
    expect(screen.getByRole("rowheader", { name: /Common/ }) ?? screen.getByText(/Common/)).toBeTruthy();
  });

  it("the status chips are ONE ChipGroup, each chip's name its count of cards, and they filter every view", async () => {
    render(<DeckCardList items={items()} ownerUsername="kesh" canManage={false} initialPrefs={{ view: "grid", group: "type", sort: "mana" }} />);
    const chips = screen.getByRole("radiogroup", { name: "Filter by card status" });
    expect(within(chips).getAllByRole("radio").map((chip) => chip.textContent)).toEqual(["All 6", "Imported 5", "Edited 0", "Original 1"]);
    expect(within(chips).getByRole("radio", { name: "All 6" }).getAttribute("aria-checked")).toBe("true");
    await act(async () => {
      fireEvent.click(within(chips).getByRole("radio", { name: "Original 1" }));
    });
    expect(Array.from(document.querySelectorAll("[data-deck-entry]")).map((el) => el.getAttribute("aria-label"))).toEqual([
      "Ember Wyrm, 1 copy, Original",
    ]);
    await act(async () => {
      fireEvent.click(within(chips).getByRole("radio", { name: "Edited 0" }));
    });
    expect(screen.getByText("No cards match this filter.")).toBeTruthy();
  });
});

describe("a two-faced card in the Stacks and Grid views (TODO 5.15 / 5.17)", () => {
  it("is a CardTile: its “2 faces” button beside the opener, never inside it", () => {
    const twoFaced = item(
      { name: "Village Elder", card_id: CARD_ID, scryfall_id: null, source: "creator" },
      card(CARD_ID, {
        title: "Village Elder",
        frame_style: { template: "m15dfcfront" },
        back_face: { title: "Elder Wolf" },
        rendered_back_image_url: `${RENDERS}/${CARD_ID}.back.png?v=1`,
        rendered_back_thumb_url: `${RENDERS}/${CARD_ID}.back.thumb.webp?v=1`,
      }),
    );
    for (const view of ["stacks", "grid"] as const) {
      render(<DeckCardList items={[twoFaced]} ownerUsername="kesh" canManage={false} initialPrefs={{ view, group: "type", sort: "mana" }} />);
      const opener = screen.getByRole("button", { name: "Village Elder, 1 copy, Original" });
      const turn = screen.getByRole("button", { name: "Show back face of Village Elder" });
      expect(opener.getAttribute("data-tile-body")).toBe("under");
      expect(opener.contains(turn)).toBe(false);
      expect(turn.contains(opener)).toBe(false);
      cleanup();
    }
  });
});

describe("a private card in a visitor's view (D11)", () => {
  const privateWithPrinting = () => item({ name: "Sol Ring", card_id: "c-p1", type_line: "Artifact" });
  const privateOriginal = () => item({ name: "My Secret Dragon", card_id: "c-p2", scryfall_id: null, source: "creator", image_url: null });

  it("is a Private card tile: the real card's name where the entry stands for one — never the card's title or a picture", () => {
    render(
      <DeckCardList
        items={[privateWithPrinting(), privateOriginal()]}
        ownerUsername="kesh"
        canManage={false}
        initialPrefs={{ view: "grid", group: "none", sort: "name" }}
      />,
    );
    const tiles = screen.getAllByRole("button", { name: /^Private card/ });
    expect(tiles.map((tile) => tile.getAttribute("aria-label"))).toEqual([
      "Private card, 1 copy, Original",
      "Private card (Sol Ring), 1 copy, Edited",
    ]);
    expect(document.body.textContent).not.toContain("My Secret Dragon");
    // Not even the printing's picture: a private card is the tile alone.
    expect(document.querySelectorAll("img")).toHaveLength(0);
    // The pop-up names it the same way.
    fireEvent.click(tiles[0]!);
    expect(within(screen.getByRole("dialog")).getAllByText("Private card").length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toContain("My Secret Dragon");
  });

  it("the owner reads their own card as it is", () => {
    render(
      <DeckCardList
        items={[item({ name: "Sol Ring", card_id: "c-own" }, card("c-own", { title: "Pocket Sun", visibility: "private" }))]}
        ownerUsername="kesh"
        canManage
        initialPrefs={{ view: "list", group: "type", sort: "mana" }}
      />,
    );
    expect(screen.getByRole("button", { name: /^Pocket Sun, 1 copy/ })).toBeTruthy();
    expect(screen.queryByText("Private card")).toBeNull();
  });
});

describe("the sticky summary bar", () => {
  const NO_CARDS = { all: 0, imported: 0, edited: 0, remix: 0, original: 0, not_found: 0, unavailable: 0 };
  const analytics = {
    total: 99,
    byBoard: { main: 98, side: 0, maybe: 3, commander: 1, companion: 0 },
    averageManaValue: 3.31,
    lands: 36,
  };

  it("says the count against the format's size, the commander, the composition — the format check and Edit next for the owner only", () => {
    const owner = render(
      <DeckCardList
        items={[item({ name: "Zoey", board: "commander", type_line: "Legendary Creature" }), item({ name: "Forest", type_line: "Basic Land — Forest" })]}
        ownerUsername="kesh"
        canManage
        initialPrefs={{ view: "list", group: "type", sort: "mana" }}
        summary={{ format: "commander", analytics, formatIssues: 1 }}
      />,
    );
    const bar = screen.getByRole("region", { name: "Deck summary" });
    expect(bar.className).toContain("sticky");
    expect(bar.textContent).toContain("99 / 100");
    expect(within(bar).getByText("99 of 100 cards, short of the format's size")).toBeTruthy();
    expect(bar.textContent).toContain("Zoey");
    // The composition is the rows' own count (the chips' and the breakdown's).
    expect(bar.textContent).toContain("Imported 2 · Edited 0 · Remix 0 · Original 0");
    expect(within(bar).getByRole("link", { name: /1 format issue/ }).getAttribute("href")).toBe("#format-check");
    // The first unchanged import in the order the list shows (Zoey, the commander group).
    const next = within(bar).getByRole("link", { name: /^Edit next/ });
    expect(next.getAttribute("href")).toMatch(/^\/create\?deckCard=00000000-/);
    expect(next.getAttribute("aria-label")).toBe("Edit next: customize Zoey (2 cards not changed yet)");
    // Nothing in it holds the focus: links and text only.
    expect(bar.querySelectorAll("[tabindex]")).toHaveLength(0);
    owner.unmount();

    render(
      <DeckCardList
        items={[item({ name: "Zoey", board: "commander" })]}
        ownerUsername="kesh"
        canManage={false}
        initialPrefs={{ view: "list", group: "type", sort: "mana" }}
        summary={{ format: "commander", analytics, formatIssues: null }}
      />,
    );
    const visitorBar = screen.getByRole("region", { name: "Deck summary" });
    expect(visitorBar.textContent).not.toMatch(/format check|format issue/i);
    expect(within(visitorBar).queryByRole("link")).toBeNull();
  });

  it("the chips, the bar and the breakdown say the SAME counts — the maybeboard out, No longer available its own", async () => {
    const items = [
      item({ name: "Llanowar Elves", quantity: 4 }),
      item({ name: "Ember Wyrm", card_id: CARD_ID, scryfall_id: null, source: "creator" }, card(CARD_ID, { title: "Ember Wyrm" })),
      // Gone (D3): the owner's badge says No longer available.
      item({ name: "Tidecaller", card_id: "c-gone", scryfall_id: null, source: "link" }),
      // The maybeboard is a scratchpad: listed, never counted.
      item({ name: "Maybe Bolt", board: "maybe", quantity: 3 }),
    ];
    const rows = deckRowsOf(items, true);
    const counts = deckStatusCountsOf(rows);
    render(
      <>
        <DeckCardList
          items={items}
          ownerUsername="kesh"
          canManage
          initialPrefs={{ view: "list", group: "type", sort: "mana" }}
          summary={{ format: "casual", analytics: computeDeckAnalytics(items), formatIssues: 0 }}
        />
        {/* The page's breakdown, fed the way the page feeds it. */}
        <DeckAnalyticsPanel
          analytics={computeDeckAnalytics(items)}
          charts={computeDeckCharts(items)}
          statusCounts={statusCountRows(counts).map(({ badge, count }) => ({ key: badge, label: ENTRY_BADGE_COUNT_LABELS[badge], count }))}
        />
      </>,
    );
    const chips = within(screen.getByRole("radiogroup", { name: "Filter by card status" }))
      .getAllByRole("radio")
      .map((chip) => chip.textContent?.replace(/\s+/g, " ").trim());
    expect(chips).toEqual(["All 6", "Imported 4", "Edited 0", "Original 1", "No longer available 1"]);
    expect(screen.getByRole("region", { name: "Deck summary" }).textContent).toContain(
      "Imported 4 · Edited 0 · Remix 0 · Original 1 · No longer available 1",
    );
    // The breakdown's Composition chart, read through its table twin.
    const composition = screen.getByRole("table", { name: "Cards by status" });
    const breakdown = within(composition)
      .getAllByRole("row")
      .slice(1)
      .map((row) => Array.from(row.querySelectorAll("th, td"), (cell) => cell.textContent).slice(0, 2).join(""));
    expect(breakdown).toEqual([
      "Imported, not changed yet4",
      "Edited imports0",
      "Remixes0",
      "Originals1",
      "No longer available1",
    ]);
  });

  it("names no commander yet, and a format with no size", () => {
    render(
      <DeckSummaryBar
        summary={deckSummaryOf("commander", { ...analytics, byBoard: { ...analytics.byBoard, commander: 0 } }, [], NO_CARDS)}
        formatIssues={0}
        editNext={null}
        unchanged={0}
        canManage
      />,
    );
    expect(screen.getByText("No commander yet")).toBeTruthy();
    expect(screen.getByText("Format check passes")).toBeTruthy();
    cleanup();
    render(<DeckSummaryBar summary={deckSummaryOf("casual", analytics, [], NO_CARDS)} formatIssues={null} editNext={null} unchanged={0} canManage={false} />);
    const bar = screen.getByRole("region", { name: "Deck summary" });
    expect(within(bar).getByText("99 cards")).toBeTruthy();
    expect(bar.textContent).not.toMatch(/commander/i);
  });
});
