// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { dynamicReady } from "@/tests/stubs/next-dynamic";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// ---------------------------------------------------------------------------
// The deck page's polish round (TODO DK11): the info boxes (InfoTip — a
// keyboard focus or a resting mouse shows one, a press pins it and moves
// the focus in, Escape closes it with the focus back on its button), the
// total mana value's box and its guide, the boards' and the breakdown's
// help, and the format issues' list whose card issue goes to THAT card's
// row — through a filter or a folded group hiding it.
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
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn() }) }));
vi.mock("@/components/creator/card-glossary", () => ({ CardGlossary: () => null }));
vi.mock("@/components/cards/card-preview", () => ({ CardPreview: () => <div data-testid="live-preview" /> }));
vi.mock("@/lib/decks/card-actions", () => ({
  updateDeckEntriesAction: vi.fn(),
  removeDeckEntriesAction: vi.fn(),
  restoreDeckEntriesAction: vi.fn(),
  linkDeckCardAction: vi.fn(),
  unlinkDeckCardAction: vi.fn(),
  listMyCardsLiteAction: vi.fn(async () => ({ ok: true, cards: [] })),
}));
vi.mock("@/lib/decks/add-actions", () => ({ addToDeckAction: vi.fn(), addManyToDeckAction: vi.fn() }));
vi.mock("@/lib/decks/membership-actions", () => ({ privateCardOfferAction: vi.fn() }));

import { InfoTip } from "@/components/ui/info-tip";
import { DeckCardList } from "@/components/decks/deck-card-list";
import { DeckAnalyticsPanel } from "@/components/decks/deck-analytics-panel";
import { DeckDrawOdds } from "@/components/decks/deck-draw-odds";
import { computeDeckAnalytics } from "@/lib/decks/analytics";
import { computeDeckCharts } from "@/lib/decks/deck-charts";
import { TOTAL_MANA_VALUE_ARTICLE_HREF } from "@/lib/decks/deck-help";
import type { DeckItem } from "@/lib/decks/queries";

beforeAll(() => dynamicReady());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const DECK = { id: "33333333-3333-4333-8333-333333333333", slug: "ness", title: "Ness", format: "modern" as const };
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

const flush = () => act(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
});

describe("InfoTip", () => {
  function tip() {
    render(
      <>
        <button type="button">before</button>
        <InfoTip label="About the thing">
          <p>It counts things.</p>
          <a href="#more">Read more</a>
        </InfoTip>
        <button type="button">after</button>
      </>,
    );
    return screen.getByRole("button", { name: "About the thing" });
  }

  it("a keyboard focus shows the box and takes no focus; moving on hides it", async () => {
    const trigger = tip();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    await act(async () => {
      trigger.focus();
      fireEvent.focus(trigger);
    });
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("dialog", { name: "About the thing" }).textContent).toContain("It counts things.");
    expect(document.activeElement).toBe(trigger);
    const after = screen.getByRole("button", { name: "after" });
    await act(async () => {
      fireEvent.blur(trigger, { relatedTarget: after });
      after.focus();
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("a press pins it and moves the focus to its link; Escape closes it, the focus back on the button", async () => {
    const trigger = tip();
    await act(async () => {
      fireEvent.click(trigger);
    });
    await flush();
    const box = screen.getByRole("dialog", { name: "About the thing" });
    expect(document.activeElement).toBe(within(box).getByRole("link", { name: "Read more" }));
    // Radix hears Escape on the document (a capture listener).
    await act(async () => {
      fireEvent.keyDown(document, { key: "Escape" });
    });
    await flush();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("a mouse that rests shows it; leaving hides it", async () => {
    vi.useFakeTimers();
    const trigger = tip();
    await act(async () => {
      fireEvent.pointerEnter(trigger, { pointerType: "mouse" });
      vi.advanceTimersByTime(200);
    });
    expect(screen.getByRole("dialog", { name: "About the thing" })).toBeTruthy();
    await act(async () => {
      fireEvent.pointerLeave(trigger, { pointerType: "mouse" });
      vi.advanceTimersByTime(200);
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("the summary bar's total mana value and format issues (TODO DK11 (b), (d))", () => {
  // Modern: 4 copies at most. Bolt ×3 + ×2 on the sideboard is one issue
  // about a card; the deck's size is one about the deck.
  const deckItems = () => [
    item(1, { name: "Lightning Bolt", quantity: 3 }),
    item(2, { name: "Shivan Dragon", type_line: "Creature — Dragon", mana_cost: "{4}{R}{R}", mana_value: 6, quantity: 2 }),
    item(3, { name: "Mountain", type_line: "Basic Land — Mountain", mana_cost: null, mana_value: 0, quantity: 20 }),
    item(4, { name: "Lightning Bolt", board: "side", quantity: 2 }),
    item(5, { name: "Maybe Titan", board: "maybe", mana_value: 6, mana_cost: "{4}{R}{R}", type_line: "Creature — Giant" }),
  ];

  function ownerPage() {
    const items = deckItems();
    return render(
      <DeckCardList
        items={items}
        ownerUsername="kesh"
        canManage
        deck={DECK}
        initialPrefs={{ view: "list", group: "type", sort: "mana" }}
        summary={{ format: "modern", analytics: computeDeckAnalytics(items), formatIssues: [] }}
      />,
    );
  }

  it("the total counts the main deck and the commander, lands as 0 — never the sideboard or the maybeboard", () => {
    ownerPage();
    const bar = screen.getByRole("region", { name: "Deck summary" });
    // 3 × 1 + 2 × 6 + 20 lands × 0 = 15 (the sideboard's Bolts and the maybeboard's Titan out).
    expect(bar.textContent).toMatch(/Total mana value\s*15/);
    expect(computeDeckAnalytics(deckItems()).totalManaValue).toBe(15);
  });

  it("its info box says how it's counted and links to the guide", async () => {
    ownerPage();
    const bar = screen.getByRole("region", { name: "Deck summary" });
    const info = within(bar).getByRole("button", { name: "About total mana value" });
    await act(async () => {
      fireEvent.click(info);
    });
    await flush();
    const box = screen.getByRole("dialog", { name: "About total mana value" });
    expect(box.textContent).toMatch(/Lands count as 0/);
    expect(box.textContent).toMatch(/main deck and the commander/);
    const guide = within(box).getByRole("link", { name: "How to judge and compare decks by total mana value" });
    expect(guide.getAttribute("href")).toBe(TOTAL_MANA_VALUE_ARTICLE_HREF);
    expect(document.activeElement).toBe(guide);
  });

  it("the issues list: a card's issue is a link to ITS row, focused; a deck's issue is text", async () => {
    ownerPage();
    const bar = screen.getByRole("region", { name: "Deck summary" });
    const count = within(bar).getByRole("button", { name: "2 format issues" });
    await act(async () => {
      fireEvent.click(count);
    });
    await flush();
    const list = screen.getByRole("dialog", { name: "2 format issues" });
    expect(list.textContent).toContain("Modern decks need at least 60 cards");
    expect(within(list).queryByRole("link", { name: /Modern decks need/ })).toBeNull();
    const bolt = within(list).getByRole("link", { name: /Lightning Bolt” appears 5×/ });
    expect(bolt.getAttribute("href")).toBe(`#entry-${id(1)}`);
    await act(async () => {
      fireEvent.click(bolt);
    });
    await flush();
    const row = document.querySelector<HTMLElement>(`[data-deck-entry="${id(1)}"]`);
    expect(row).toBeTruthy();
    expect(document.activeElement).toBe(row);
    expect(row!.hasAttribute("data-flash")).toBe(true);
    expect(within(list).getByRole("link", { name: "Open the format check" }).getAttribute("href")).toBe("#format-check");
  });

  it("a row a folded group or a filter hides is shown first, then focused", async () => {
    ownerPage();
    // Fold the Instants (Bolt's group) and filter to Edited (no card).
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Instants/ }));
    });
    expect(document.querySelector(`[data-deck-entry="${id(1)}"]`)?.closest("[hidden]")).toBeTruthy();
    const status = screen.getByRole("radiogroup", { name: "Filter by card status" });
    await act(async () => {
      fireEvent.click(within(status).getByRole("radio", { name: /^Edited/ }));
    });
    const bar = screen.getByRole("region", { name: "Deck summary" });
    await act(async () => {
      fireEvent.click(within(bar).getByRole("button", { name: "2 format issues" }));
    });
    await flush();
    await act(async () => {
      fireEvent.click(screen.getByRole("link", { name: /Lightning Bolt” appears 5×/ }));
    });
    await flush();
    await waitFor(() => expect(document.activeElement?.getAttribute("data-deck-entry")).toBe(id(1)));
    expect(within(status).getByRole("radio", { name: /^All/ }).getAttribute("aria-checked")).toBe("true");
  });
});

describe("the boards' help (TODO DK11 (c))", () => {
  it("each board group carries its help: what it is and what it counts toward", async () => {
    const items = [
      item(1, { name: "Zoey", board: "commander", type_line: "Legendary Creature" }),
      item(2, { name: "Bolt" }),
      item(3, { name: "Side Bolt", board: "side" }),
      item(4, { name: "Maybe Bolt", board: "maybe" }),
      item(5, { name: "Lurrus", board: "companion" }),
    ];
    render(<DeckCardList items={items} ownerUsername="kesh" canManage={false} initialPrefs={{ view: "list", group: "board", sort: "mana" }} />);
    for (const board of ["Commander", "Mainboard", "Sideboard", "Maybeboard", "Companion"]) {
      expect(screen.getByRole("button", { name: `About the ${board}` }), board).toBeTruthy();
    }
    const side = screen.getByRole("button", { name: "About the Sideboard" });
    await act(async () => {
      side.focus();
      fireEvent.focus(side);
    });
    expect(screen.getByRole("dialog", { name: "About the Sideboard" }).textContent).toMatch(/copy limit/);
    // A type group is no board: no help there.
    cleanup();
    render(<DeckCardList items={items} ownerUsername="kesh" canManage={false} initialPrefs={{ view: "list", group: "type", sort: "mana" }} />);
    expect(screen.queryByRole("button", { name: "About the Mainboard" })).toBeNull();
    expect(screen.getByRole("button", { name: "About the Sideboard" })).toBeTruthy();
  });
});

describe("the boards' help sits BESIDE the group heading, never in its name", () => {
  const items = [item(1, { name: "Zoey", board: "commander", type_line: "Legendary Creature" }), item(2, { name: "Bolt" }), item(3, { name: "Side Bolt", board: "side" })];

  it.each(["list", "grid", "stacks"] as const)("%s view: the <h3> (and its section) is named by its text alone; the ⓘ is a button of its own beside it", (view) => {
    render(<DeckCardList items={items} ownerUsername="kesh" canManage={false} initialPrefs={{ view, group: "board", sort: "mana" }} />);
    const heading = screen.getByRole("heading", { level: 3, name: /^Commander\s*, 1 card$/ });
    expect(screen.getByRole("region", { name: /^Commander\s*, 1 card$/ })).toBeTruthy();
    const tip = screen.getByRole("button", { name: "About the Commander" });
    expect(heading.contains(tip)).toBe(false);
    // Beside it: the heading's own row.
    expect(heading.parentElement?.contains(tip)).toBe(true);
    for (const h of screen.getAllByRole("heading", { level: 3 })) expect(h.textContent).not.toMatch(/About/);
  });

  it("table view: the group's header cell is named by its button's text, the ⓘ beside it in the cell", () => {
    render(<DeckCardList items={items} ownerUsername="kesh" canManage={false} initialPrefs={{ view: "table", group: "board", sort: "mana" }} />);
    const cell = screen.getByRole("rowheader", { name: "Commander · 1" });
    expect(within(cell).getByRole("button", { name: "About the Commander" })).toBeTruthy();
  });

  it("the ⓘ is a 24 × 24 px target that keeps its 20 px place in the line", () => {
    render(
      <InfoTip label="About the thing">
        <p>It counts things.</p>
      </InfoTip>,
    );
    const button = screen.getByRole("button", { name: "About the thing" });
    expect(button.className.split(/\s+/)).toEqual(expect.arrayContaining(["h-6", "w-6", "-m-0.5"]));
  });
});

describe("the breakdown's help (TODO DK11 (e))", () => {
  it("every chart, the total mana value, the draw odds have a help box", () => {
    const items = [
      item(1, { name: "Bolt", quantity: 4 }),
      item(2, { name: "Mountain", type_line: "Basic Land — Mountain", mana_cost: null, mana_value: 0, quantity: 20 }),
    ];
    render(
      <>
        <DeckAnalyticsPanel analytics={computeDeckAnalytics(items)} charts={computeDeckCharts(items)} statusCounts={[]} />
        <DeckDrawOdds items={items} canManage commander={false} multiplayer={false} />
      </>,
    );
    for (const name of [
      "About total mana value",
      "About mana curve",
      "About card types",
      "About color symbols and sources",
      "About rarity",
      "About composition",
      "About keywords",
      "About draw odds",
    ]) {
      expect(screen.getByRole("button", { name }), name).toBeTruthy();
    }
    // The breakdown's total: 4 Bolts × 1, lands 0.
    expect(screen.getByText("Total mana value").closest("div")?.textContent).toContain("4");
  });
});
