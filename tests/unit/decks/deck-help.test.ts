import { describe, expect, it } from "vitest";
import { countsTowardDeckStats, computeDeckAnalytics } from "@/lib/decks/analytics";
import { deckLibraryOf } from "@/lib/decks/deck-charts";
import { BOARD_HELP, BREAKDOWN_HELP, TOTAL_MANA_VALUE_ARTICLE_SLUG, TOTAL_MANA_VALUE_HELP } from "@/lib/decks/deck-help";
import { ACTIVITY_METRIC_LABELS, ACTIVITY_METRICS } from "@/lib/decks/deck-activity";
import { validateDeck } from "@/lib/decks/format-rules";
import { getArticle } from "@/lib/content/articles";
import { DECK_BOARD_VALUES, type DeckBoard, type DeckCardEntry } from "@/types/deck";

// ---------------------------------------------------------------------------
// The deck page's help words (TODO DK11) held to the code that counts: what
// a board's box says it counts toward is what the breakdown, the playtest
// and the format check really read; the total mana value's box points at a
// guide that exists.
// ---------------------------------------------------------------------------

function entry(board: DeckBoard, over: Partial<DeckCardEntry> = {}): DeckCardEntry {
  return {
    id: `e-${board}`,
    deck_id: "d",
    board,
    quantity: 1,
    position: 0,
    card_id: null,
    scryfall_id: `sf-${board}`,
    set_code: null,
    collector_number: null,
    name: `Card on ${board}`,
    type_line: "Creature — Elf",
    mana_cost: "{2}{G}",
    mana_value: 3,
    color_identity: ["G"],
    rarity: "common",
    image_url: null,
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
    source: "import",
    ...over,
  } as DeckCardEntry;
}

describe("the boards' help", () => {
  it("covers every board", () => {
    expect(Object.keys(BOARD_HELP).sort()).toEqual([...DECK_BOARD_VALUES].sort());
  });

  it("the curve, types and lands: the main deck and the commander alone, as the help says", () => {
    for (const board of DECK_BOARD_VALUES) {
      const counted = countsTowardDeckStats(board);
      const says = BOARD_HELP[board].counts;
      if (counted) expect(says, board).toMatch(/curve/);
      else expect(says, board).toMatch(/Never the deck's size, the curve|nothing/);
    }
  });

  it("the playtest: the mainboard alone", () => {
    const rows = DECK_BOARD_VALUES.map((board) => ({ id: board, board, quantity: 1, name: board, privateName: null, bucket: "Creature" as const }));
    expect(deckLibraryOf(rows).map((row) => row.id)).toEqual(["main"]);
    expect(BOARD_HELP.main.counts).toMatch(/draw odds and the sample hand/);
    expect(BOARD_HELP.commander.counts).toMatch(/leave it out/);
  });

  it("the copy limit counts the sideboard and a companion — never the maybeboard", () => {
    const named = (board: DeckBoard) => entry(board, { id: `x-${board}`, name: "Llanowar Elves", quantity: 3 });
    const over = (boards: DeckBoard[]) => validateDeck("modern", [named("main"), ...boards.map(named)]).some((w) => w.code === "copy_limit");
    expect(over(["side"])).toBe(true);
    expect(over(["companion"])).toBe(true);
    expect(over(["maybe"])).toBe(false);
    expect(BOARD_HELP.side.counts).toMatch(/copy limit/);
    expect(BOARD_HELP.companion.counts).toMatch(/copy limit/);
    expect(BOARD_HELP.maybe.counts).toMatch(/nothing/);
  });
});

describe("the total mana value's help", () => {
  it("says what computeDeckAnalytics counts: main + commander, copies, lands 0", () => {
    const items = [
      { entry: entry("main", { id: "a", quantity: 4 }) },
      { entry: entry("commander", { id: "b", mana_value: 5, mana_cost: "{3}{G}{G}" }) },
      { entry: entry("main", { id: "c", type_line: "Basic Land — Forest", mana_cost: null, mana_value: 0, quantity: 30 }) },
      { entry: entry("side", { id: "d", quantity: 3 }) },
      { entry: entry("companion", { id: "e" }) },
      { entry: entry("maybe", { id: "f", quantity: 9 }) },
    ];
    expect(computeDeckAnalytics(items).totalManaValue).toBe(4 * 3 + 5);
    expect(TOTAL_MANA_VALUE_HELP.body).toMatch(/main deck and the commander/);
    expect(TOTAL_MANA_VALUE_HELP.body).toMatch(/Lands count as 0/);
    expect(TOTAL_MANA_VALUE_HELP.body).toMatch(/sideboard, a companion and the maybeboard/);
  });

  it("links to a guide that exists, with an FAQ", () => {
    const article = getArticle(TOTAL_MANA_VALUE_ARTICLE_SLUG);
    expect(article).not.toBeNull();
    expect(article!.meta.faq?.length ?? 0).toBeGreaterThanOrEqual(4);
    expect(article!.meta.description.length).toBeLessThanOrEqual(155);
  });
});

describe("the breakdown's help", () => {
  it("every part has a title and words, and none promises a mulligan (DK11 (f))", () => {
    for (const [key, help] of Object.entries(BREAKDOWN_HELP)) {
      expect(help.title, key).toBeTruthy();
      expect(help.body.length, key).toBeGreaterThan(40);
      expect(help.body, key).not.toMatch(/mulligan/i);
    }
  });
});

describe("the deck activity help", () => {
  it("has a box for every series the panel draws, titled as its tile", () => {
    for (const metric of ACTIVITY_METRICS) {
      expect(BREAKDOWN_HELP[metric].title).toBe(ACTIVITY_METRIC_LABELS[metric].title);
    }
  });

  it("names every series, and says an own copy is never a clone", () => {
    const activity = BREAKDOWN_HELP.activity.body.toLowerCase();
    for (const metric of ACTIVITY_METRICS) expect(activity).toContain(ACTIVITY_METRIC_LABELS[metric].many);
    expect(BREAKDOWN_HELP.clones.body).toMatch(/own copies of your own deck never count/);
  });
});
