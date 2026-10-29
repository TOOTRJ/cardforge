// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// ---------------------------------------------------------------------------
// The deck breakdown's charts (TODO DK7.1 / DK7.2 / DK5.12): the mana
// curve's bars filter the deck list above (one tab stop, the arrow keys, a
// pick takes the focus to the list's notice, "Back to the curve" and the
// two "Clear filter"s), every chart's table twin and its "Table" switch, the
// draw odds and the sample hand's London mulligan — a visitor's private card
// a "Private card" face, never its title.
// ---------------------------------------------------------------------------

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }) }));
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

import { DeckAnalyticsPanel } from "@/components/decks/deck-analytics-panel";
import { DeckCardList } from "@/components/decks/deck-card-list";
import { DeckCurveFilterProvider } from "@/components/decks/deck-curve-filter";
import { DeckDrawOdds } from "@/components/decks/deck-draw-odds";
import { DeckSampleHand } from "@/components/decks/deck-sample-hand";
import { computeDeckAnalytics } from "@/lib/decks/analytics";
import { computeDeckCharts } from "@/lib/decks/deck-charts";
import { DECK_CARDS_HEADING_ID } from "@/lib/decks/deck-view";
import type { DeckItem } from "@/lib/decks/queries";

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://auth.pipglyph.com");
});
afterEach(() => {
  vi.unstubAllEnvs();
  cleanup();
});

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
const item = (e: Record<string, unknown> = {}, c: Record<string, unknown> | null = null) =>
  ({ entry: entry(e), card: c, cardOwner: null }) as unknown as DeckItem;

function deck() {
  return [
    item({ name: "Llanowar Elves", quantity: 4 }),
    item({ name: "Lightning Bolt", type_line: "Instant", mana_cost: "{R}", mana_value: 1, color_identity: ["R"], quantity: 2 }),
    item({ name: "Shivan Dragon", type_line: "Creature — Dragon", mana_cost: "{4}{R}{R}", mana_value: 6, color_identity: ["R"] }),
    item({ name: "Forest", type_line: "Basic Land — Forest", mana_cost: null, mana_value: 0, quantity: 10 }),
  ];
}

/** The page's two sections under the one provider, as the page draws them. */
function renderPage(items: DeckItem[]) {
  return render(page(items));
}

function page(items: DeckItem[]) {
  return (
    <DeckCurveFilterProvider curve={computeDeckCharts(items).curve}>
      <h2 id={DECK_CARDS_HEADING_ID} tabIndex={-1}>
        Cards
      </h2>
      <DeckCardList items={items} ownerUsername="kesh" canManage initialPrefs={{ view: "list", group: "type", sort: "mana" }} />
      <DeckAnalyticsPanel
        analytics={computeDeckAnalytics(items)}
        charts={computeDeckCharts(items)}
        statusCounts={[{ key: "imported", label: "Imported, not changed yet", count: 17 }]}
      />
    </DeckCurveFilterProvider>
  );
}

const listNames = () =>
  Array.from(document.querySelectorAll("[data-deck-entry]"))
    .map((el) => el.getAttribute("aria-label")?.split(",")[0])
    .sort();

describe("the mana curve filters the list", () => {
  it("is one tab stop whose arrow keys move between the bars, each named with its numbers", () => {
    renderPage(deck());
    const curve = screen.getByRole("toolbar", { name: "Mana curve" });
    const bars = within(curve).getAllByRole("button");
    expect(bars).toHaveLength(8);
    // The tab stop: the first column with cards.
    expect(bars.filter((bar) => bar.tabIndex === 0).map((bar) => bar.getAttribute("aria-label"))).toEqual([
      "Mana value 1: 6 cards, 4 creatures and 2 other spells. Show them in the card list",
    ]);
    // An empty column says so, and is no control.
    expect(bars[0].getAttribute("aria-label")).toBe("Mana value 0: no cards");
    expect(bars[0].getAttribute("aria-disabled")).toBe("true");
    expect(bars[7].getAttribute("aria-label")).toBe("Mana value 7 or more: no cards");

    act(() => bars[1].focus());
    fireEvent.keyDown(bars[1], { key: "ArrowRight" });
    expect(document.activeElement).toBe(bars[2]);
    fireEvent.keyDown(bars[2], { key: "End" });
    expect(document.activeElement).toBe(bars[7]);
    fireEvent.keyDown(bars[7], { key: "Home" });
    expect(document.activeElement).toBe(bars[0]);
    // The tab stop follows the focus: Tab leaves the toolbar from where it is.
    expect(bars.filter((bar) => bar.tabIndex === 0)).toEqual([bars[0]]);
  });

  it("a pick filters the list to the bar's cards and takes the focus to its notice; Back to the curve returns", async () => {
    renderPage(deck());
    expect(listNames()).toEqual(["Forest", "Lightning Bolt", "Llanowar Elves", "Shivan Dragon"]);
    const bar = screen.getByRole("button", { name: /^Mana value 1:/ });
    // Clicking an empty column does nothing.
    fireEvent.click(screen.getByRole("button", { name: "Mana value 0: no cards" }));
    expect(document.getElementById("deck-curve-filter-notice")).toBeNull();

    fireEvent.click(bar);
    const notice = await waitFor(() => {
      const element = document.getElementById("deck-curve-filter-notice");
      expect(element).toBeTruthy();
      return element!;
    });
    expect(listNames()).toEqual(["Lightning Bolt", "Llanowar Elves"]);
    expect(notice.textContent).toContain("Mana value 1");
    expect(notice.textContent).toContain("6 cards shown");
    await waitFor(() => expect(document.activeElement).toBe(notice));
    expect(bar.getAttribute("aria-current")).toBe("true");

    fireEvent.click(within(notice).getByRole("button", { name: "Back to the curve" }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: /^Mana value 1:/ })));
    // Still filtered: coming back changes nothing.
    expect(listNames()).toEqual(["Lightning Bolt", "Llanowar Elves"]);
  });

  it("the list's Clear filter hands the focus to the Cards heading; the curve's keeps it on the curve", async () => {
    renderPage(deck());
    fireEvent.click(screen.getByRole("button", { name: /^Mana value 6:/ }));
    const notice = await waitFor(() => document.getElementById("deck-curve-filter-notice")!);
    expect(listNames()).toEqual(["Shivan Dragon"]);
    fireEvent.click(within(notice).getByRole("button", { name: "Clear filter" }));
    await waitFor(() => expect(document.activeElement?.id).toBe(DECK_CARDS_HEADING_ID));
    expect(document.getElementById("deck-curve-filter-notice")).toBeNull();
    expect(listNames()).toHaveLength(4);

    fireEvent.click(screen.getByRole("button", { name: /^Mana value 6:/ }));
    await waitFor(() => expect(document.getElementById("deck-curve-filter-notice")).toBeTruthy());
    const curveCard = screen.getByRole("region", { name: "Mana curve" });
    fireEvent.click(within(curveCard).getByRole("button", { name: "Clear filter" }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: /^Mana value 6:/ })));
    expect(listNames()).toHaveLength(4);
  });

  it("follows the deck through a refresh: a card added at that mana value joins the list", async () => {
    const items = deck();
    const { rerender } = renderPage(items);
    fireEvent.click(screen.getByRole("button", { name: /^Mana value 6:/ }));
    await waitFor(() => expect(document.getElementById("deck-curve-filter-notice")).toBeTruthy());
    expect(listNames()).toEqual(["Shivan Dragon"]);
    // The owner adds a card; the page's refresh hands down the new curve.
    rerender(page([...items, item({ name: "Inferno Titan", type_line: "Creature — Giant", mana_cost: "{4}{R}{R}", mana_value: 6 })]));
    expect(listNames()).toEqual(["Inferno Titan", "Shivan Dragon"]);
  });

  it("the filter and the status filter apply together", async () => {
    const items = [...deck(), item({ name: "Ember Wyrm", card_id: "c-gone", scryfall_id: null, source: "link", mana_value: 1, mana_cost: "{R}" })];
    renderPage(items);
    fireEvent.click(screen.getByRole("button", { name: /^Mana value 1:/ }));
    await waitFor(() => expect(document.getElementById("deck-curve-filter-notice")).toBeTruthy());
    expect(listNames()).toEqual(["Ember Wyrm", "Lightning Bolt", "Llanowar Elves"]);
    const status = screen.getByRole("radiogroup", { name: "Filter by card status" });
    fireEvent.click(within(status).getByRole("radio", { name: /^No longer available/ }));
    expect(listNames()).toEqual(["Ember Wyrm"]);
  });
});

describe("every chart has its table", () => {
  it("a picture-only chart has its table for a screen reader, and the Table switch shows it", () => {
    renderPage(deck());
    // Beside the picture, the table is there (visually hidden) and the
    // picture is hidden from assistive tech.
    const types = screen.getByRole("table", { name: "Cards by type" });
    expect(types.closest(".sr-only")).toBeTruthy();
    const rows = within(types)
      .getAllByRole("row")
      .slice(1)
      .map((row) => Array.from(row.querySelectorAll("th, td"), (cell) => cell.textContent));
    expect(rows).toEqual([
      ["Creatures", "5", "29%"],
      ["Instants", "2", "12%"],
      ["Lands", "10", "59%"],
    ]);
    const toggle = screen.getByRole("button", { name: "Show card types as a table" });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("table", { name: "Cards by type" }).closest(".sr-only")).toBeNull();
  });

  it("the curve's table: every value, zeros included", () => {
    renderPage(deck());
    fireEvent.click(screen.getByRole("button", { name: "Show mana curve as a table" }));
    const table = screen.getByRole("table", { name: /^Mana curve/ });
    const rows = within(table)
      .getAllByRole("row")
      .slice(1)
      .map((row) => Array.from(row.querySelectorAll("th, td"), (cell) => cell.textContent).join(" "));
    expect(rows).toEqual(["0 0 0 0", "1 4 2 6", "2 0 0 0", "3 0 0 0", "4 0 0 0", "5 0 0 0", "6 1 0 1", "7 or more 0 0 0"]);
    // As a table, the bars are gone (the table speaks for them).
    expect(screen.queryByRole("toolbar", { name: "Mana curve" })).toBeNull();
  });

  it("color symbols against sources, with the hint where sources trail", () => {
    renderPage(deck());
    const rows = within(screen.getByRole("table", { name: /^Color symbols/ }))
      .getAllByRole("row")
      .slice(1)
      .map((row) => Array.from(row.querySelectorAll("th, td"), (cell) => cell.textContent));
    expect(rows).toEqual([
      ["Red (fewer sources than its share)", "4", "50%", "0", "0%"],
      ["Green", "4", "50%", "10", "100%"],
    ]);
  });
});

describe("the playtest", () => {
  it("lands by turn on the play / on the draw, and a picked card's odds", () => {
    render(<DeckDrawOdds items={deck()} canManage multiplayer={false} />);
    const lands = screen.getByRole("table", { name: /^Chance of at least 1 to 7 lands by turn, on the play/ });
    // Turn 1 on the play sees the opening seven.
    expect(within(lands).getAllByRole("rowheader")[0].textContent).toBe("Turn 17 cards");
    fireEvent.click(screen.getByRole("radio", { name: "On the draw" }));
    const drawn = screen.getByRole("table", { name: /^Chance of at least 1 to 7 lands by turn, on the draw/ });
    expect(within(drawn).getAllByRole("rowheader")[0].textContent).toBe("Turn 18 cards");
    // The picker starts on the spell with the most copies — never a land.
    const select = screen.getByRole("combobox", { name: /chance of at least one copy/i }) as HTMLSelectElement;
    expect(select.selectedOptions[0].textContent).toBe("Llanowar Elves (4 copies)");
    expect(screen.getByRole("table", { name: "Chance to draw Llanowar Elves by turn, on the draw" })).toBeTruthy();
  });

  it("a sample hand, the London mulligan and a draw — keyboard-ready, said aloud", async () => {
    render(<DeckSampleHand items={deck()} canManage freeMulligan={false} seed={7} />);
    // Nothing shuffled, no picture loaded, until asked.
    expect(screen.queryByRole("list", { name: /^Hand/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Draw a hand" }));
    expect(screen.getByRole("list", { name: "Hand, 7 cards" })).toBeTruthy();
    expect(document.querySelector("[aria-live]")?.textContent).toMatch(/^New hand: \d+ lands?, \d+ spells?\.$/);

    fireEvent.click(screen.getByRole("button", { name: "Mulligan" }));
    const keep = screen.getByRole("button", { name: /^Keep 6 cards/ });
    expect(keep.getAttribute("aria-disabled")).toBe("true");
    // Draw waits for the hand to be kept.
    expect(screen.getByRole("button", { name: /^Draw a card/ }).getAttribute("aria-disabled")).toBe("true");
    const picks = screen.getAllByRole("button", { name: /: put on the bottom$/ });
    expect(picks).toHaveLength(7);
    fireEvent.click(picks[0]);
    // One card owed: another pick MOVES the choice.
    fireEvent.click(picks[1]);
    expect(picks.map((pick) => pick.getAttribute("aria-pressed"))).toEqual(["false", "true", "false", "false", "false", "false", "false"]);
    fireEvent.click(screen.getByRole("button", { name: "Keep 6 cards" }));
    expect(screen.getByRole("list", { name: "Hand, 6 cards" })).toBeTruthy();
    const draw = screen.getByRole("button", { name: "Draw a card" });
    await waitFor(() => expect(document.activeElement).toBe(draw));
    fireEvent.click(draw);
    expect(screen.getByRole("list", { name: "Hand, 7 cards" })).toBeTruthy();
    expect(document.querySelector("[aria-live]")?.textContent).toMatch(/^Drew /);
  });

  it("the same seed deals the same hand", () => {
    const hand = () => {
      render(<DeckSampleHand items={deck()} canManage freeMulligan={false} seed={42} />);
      fireEvent.click(screen.getByRole("button", { name: "Draw a hand" }));
      const names = within(screen.getByRole("list", { name: /^Hand/ }))
        .getAllByRole("img")
        .map((img) => img.getAttribute("alt"));
      cleanup();
      return names;
    };
    expect(hand()).toEqual(hand());
  });

  it("a visitor's private card is a Private card face — never its title or art", () => {
    const items = [
      item({ name: "Private card", card_id: "c-private", scryfall_id: null, source: "creator", image_url: null, quantity: 7 }),
    ];
    render(<DeckSampleHand items={items} canManage={false} freeMulligan={false} seed={1} />);
    fireEvent.click(screen.getByRole("button", { name: "Draw a hand" }));
    const hand = screen.getByRole("list", { name: "Hand, 7 cards" });
    expect(within(hand).getAllByText("Private card").length).toBeGreaterThan(0);
    expect(hand.querySelector("img")).toBeNull();
  });
});
