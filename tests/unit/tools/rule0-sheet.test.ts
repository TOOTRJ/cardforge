import { describe, expect, it } from "vitest";
import { GAME_CHANGERS, GAME_CHANGERS_SOURCE, foldCardName, gameChangerName } from "@/lib/tools/rule0/game-changers";
import { bracketFloorFor, estimateBracket, GAME_CHANGER_LIMITS, NOT_JUDGED } from "@/lib/tools/rule0/bracket-estimate";
import { buildTableSheetFacts, customHeadline, type SheetItem } from "@/lib/tools/rule0/sheet";
import { publicDeckItems } from "@/lib/decks/private-card-name";
import { tableSheetTextSchema, winConditionLines } from "@/lib/validation/table-sheet";
import { TOOL_CATALOG } from "@/lib/tools/catalog";
import { TOOL_ICONS } from "@/components/tools/tool-icon";
import { RULE0_TOOL_SLUG, tableSheetPath } from "@/lib/tools/rule0/model";
import { qrPath, QR_QUIET } from "@/lib/qr/qr-path";
import { importFingerprintOf } from "@/lib/cards/import-fingerprint";

// ---------------------------------------------------------------------------
// The Rule 0 table sheet (beta tool `rule0-sheet`): the Game Changers data,
// the light bracket estimate, the facts the sheet derives from a deck (its
// statuses through deckRowsOf — never a second derivation; the maybeboard
// never counts; a visitor's private card stays "Private card"), the owner's
// fields and the QR path.
// ---------------------------------------------------------------------------

let n = 0;
function item(entry: Partial<SheetItem["entry"]> & { name: string }, card: SheetItem["card"] = null, cardOwner: SheetItem["cardOwner"] = null): SheetItem {
  n += 1;
  return {
    entry: {
      id: `00000000-0000-4000-a000-${String(n).padStart(12, "0")}`,
      board: "main",
      quantity: 1,
      card_id: null,
      scryfall_id: null,
      source: "import",
      type_line: null,
      ...entry,
    },
    card,
    cardOwner,
  };
}

function customCard(over: Record<string, unknown> = {}): NonNullable<SheetItem["card"]> {
  return {
    id: "c1",
    slug: "my-card",
    title: "My Card",
    owner_id: "owner",
    visibility: "public",
    parent_card_id: null,
    source_scryfall_id: null,
    import_scryfall_id: null,
    import_fingerprint: null,
    ...over,
  } as unknown as NonNullable<SheetItem["card"]>;
}

const DECK = { slug: "sampler", format: "commander", bracket: 2, ownerUsername: "dev_pro" };

describe("Game Changers data", () => {
  it("names its source and the date it was read", () => {
    expect(GAME_CHANGERS_SOURCE.announcement).toMatch(/^https:\/\/magic\.wizards\.com\//);
    expect(GAME_CHANGERS_SOURCE.list).toMatch(/^https:\/\//);
    expect(GAME_CHANGERS_SOURCE.read).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(GAME_CHANGERS_SOURCE.updated <= GAME_CHANGERS_SOURCE.read).toBe(true);
  });

  it("lists each card once, sorted", () => {
    expect(new Set(GAME_CHANGERS.map(foldCardName)).size).toBe(GAME_CHANGERS.length);
    expect([...GAME_CHANGERS].sort((a, b) => a.localeCompare(b))).toEqual(GAME_CHANGERS);
    expect(GAME_CHANGERS.length).toBeGreaterThan(40);
  });

  it("matches a name however it is typed, and a two-faced card by its front", () => {
    expect(gameChangerName("rhystic study")).toBe("Rhystic Study");
    expect(gameChangerName("Bolas’s Citadel")).toBe("Bolas's Citadel");
    expect(gameChangerName("Tergrid, God of Fright")).toBe("Tergrid, God of Fright // Tergrid's Lantern");
    expect(gameChangerName("Tergrid, God of Fright // Tergrid's Lantern")).toBe("Tergrid, God of Fright // Tergrid's Lantern");
    expect(gameChangerName("Sol Ring")).toBeNull();
    expect(gameChangerName(null)).toBeNull();
  });
});

describe("the light bracket estimate", () => {
  it("follows the official limits: none in 1–2, three in 3, any in 4–5", () => {
    expect(GAME_CHANGER_LIMITS).toEqual({ 1: 0, 2: 0, 3: 3, 4: null, 5: null });
    expect(bracketFloorFor(0)).toBe(1);
    expect(bracketFloorFor(1)).toBe(3);
    expect(bracketFloorFor(3)).toBe(3);
    expect(bracketFloorFor(4)).toBe(4);
    expect(bracketFloorFor(40)).toBe(4);
  });

  it("is a floor, compared with the owner's bracket", () => {
    expect(estimateBracket(0, 1)).toMatchObject({ verdict: "Fits any bracket", fit: "fits", countLabel: "No Game Changers" });
    expect(estimateBracket(2, 2)).toMatchObject({ verdict: "Bracket 3 or higher", fit: "below", countLabel: "2 Game Changers" });
    expect(estimateBracket(1, 3)).toMatchObject({ fit: "fits", countLabel: "1 Game Changer" });
    expect(estimateBracket(4, 3)).toMatchObject({ verdict: "Bracket 4 or higher", fit: "below" });
    expect(estimateBracket(4, null).fit).toBeNull();
  });

  it("says what it leaves to the table", () => {
    for (const word of ["tutors", "extra turns", "mass land denial", "combos"]) expect(NOT_JUDGED).toContain(word);
  });
});

describe("the sheet's facts", () => {
  const items = [
    item({ name: "Kenrith, the Returned King", board: "commander", scryfall_id: "s-kenrith" }),
    item({ name: "Rhystic Study", scryfall_id: "s-rhystic" }),
    item({ name: "Smothering Tithe", scryfall_id: "s-tithe", card_id: "c-tithe" }, customCard({ id: "c-tithe", slug: "tithe", title: "Tithe of Ash", source_scryfall_id: "s-tithe" })),
    item({ name: "Sol Ring", scryfall_id: "s-sol", quantity: 1 }),
    item({ name: "Archivist", card_id: "c-orig", source: "creator" }, customCard({ id: "c-orig", slug: "archivist", title: "Archivist", visibility: "private" })),
    item({ name: "Broodling", card_id: "c-remix", source: "creator" }, customCard({ id: "c-remix", slug: "broodling", title: "Broodling", parent_card_id: "c-x" }), { username: "dev_artist" }),
    item({ name: "Zqx Unknown Relic" }),
    // The maybeboard never counts.
    item({ name: "Demonic Tutor", board: "maybe", scryfall_id: "s-dt" }),
    item({ name: "Mystery Original", board: "maybe", card_id: "c-maybe", source: "creator" }, customCard({ id: "c-maybe", slug: "mystery", title: "Mystery Original" })),
  ];

  it("names the custom cards, the commander and the Game Changers from the entries' statuses", () => {
    const facts = buildTableSheetFacts(items, true, DECK);
    expect(facts.commanders.map((line) => line.name)).toEqual(["Kenrith, the Returned King"]);
    expect(facts.cardCount).toBe(7);
    expect(facts.custom.map((line) => [line.name, line.badge])).toEqual([
      ["Archivist", "original"],
      ["Broodling", "remix"],
      ["Tithe of Ash", "edited"],
    ]);
    expect(facts.customCount).toBe(3);
    expect(facts.notFound.map((line) => line.name)).toEqual(["Zqx Unknown Relic"]);
    expect(facts.realCount).toBe(3);
    // The edited Tithe is still the Game Changer it was printed as — flagged
    // as a custom version; Demonic Tutor sits on the maybeboard.
    expect(facts.gameChangers).toEqual([
      { name: "Rhystic Study", customVersion: false },
      { name: "Smothering Tithe", customVersion: true },
    ]);
    expect(facts.estimate).toMatchObject({ gameChangers: 2, floor: 3, fit: "below" });
  });

  it("links each card where the viewer can read it, else to its row", () => {
    const facts = buildTableSheetFacts(items, true, DECK);
    const byName = new Map(facts.custom.map((line) => [line.name, line]));
    expect(byName.get("Tithe of Ash")).toMatchObject({ href: "/card/dev_pro/tithe", basedOn: "Smothering Tithe" });
    expect(byName.get("Broodling")).toMatchObject({ href: "/card/dev_artist/broodling", maker: "dev_artist" });
    expect(facts.notFound[0]!.href).toMatch(/^\/deck\/sampler#entry-/);
  });

  it("never names a visitor's private card", () => {
    // A visitor reads the owner's private card as null (RLS), through
    // publicDeckItems as the page hands it.
    const visitorItems = publicDeckItems(
      items.map((it) => (it.card?.visibility === "private" ? { ...it, card: null } : it)),
      false,
    );
    const facts = buildTableSheetFacts(visitorItems, false, DECK);
    const names = facts.custom.map((line) => line.name);
    expect(names).toContain("Private card");
    expect(names).not.toContain("Archivist");
    const hidden = facts.custom.find((line) => line.name === "Private card")!;
    expect(hidden.href).toMatch(/^\/deck\/sampler#entry-/);
  });

  it("an Original that borrows a Game Changer's name is no Game Changer", () => {
    const facts = buildTableSheetFacts(
      [item({ name: "Rhystic Study", card_id: "c-o", source: "creator" }, customCard({ id: "c-o", title: "Rhystic Study" }))],
      true,
      DECK,
    );
    expect(facts.gameChangers).toEqual([]);
    expect(facts.custom).toHaveLength(1);
  });

  it("a proxy is a PipGlyph print of the real card, unchanged; changed, it is custom", () => {
    const base = customCard({ id: "c-elves", slug: "llanowar-elves", title: "Llanowar Elves", import_scryfall_id: "s-elves" });
    const unchanged = { ...base, import_fingerprint: importFingerprintOf(base) } as typeof base;
    const proxy = buildTableSheetFacts([item({ name: "Llanowar Elves", scryfall_id: "s-elves", card_id: "c-elves" }, unchanged)], true, DECK);
    expect(proxy.proxies.map((line) => [line.name, line.badge])).toEqual([["Llanowar Elves", "imported"]]);
    expect(proxy.customCount).toBe(0);
    expect(proxy.realCount).toBe(0);
    const renamed = { ...unchanged, title: "Llanowar Sentinel" } as typeof base;
    const edited = buildTableSheetFacts([item({ name: "Llanowar Elves", scryfall_id: "s-elves", card_id: "c-elves" }, renamed)], true, DECK);
    expect(edited.custom.map((line) => [line.name, line.badge, line.basedOn])).toEqual([["Llanowar Sentinel", "edited", "Llanowar Elves"]]);
    expect(edited.proxyCount).toBe(0);
  });

  it("has no bracket outside Commander", () => {
    expect(buildTableSheetFacts(items, true, { ...DECK, format: "modern" }).estimate).toBeNull();
  });

  it("says the custom cards in one line", () => {
    expect(customHeadline({ customCount: 0, proxyCount: 0 })).toMatch(/every card is the real card/);
    expect(customHeadline({ customCount: 3, proxyCount: 0 })).toBe("This deck has 3 custom cards — discuss before playing.");
    expect(customHeadline({ customCount: 1, proxyCount: 2 })).toBe("This deck has 1 custom card and 2 proxies — discuss before playing.");
    expect(customHeadline({ customCount: 0, proxyCount: 1 })).toBe("This deck has 1 proxy.");
  });
});

describe("the owner's fields", () => {
  it("trims, turns blank into null and holds the stored limits", () => {
    expect(tableSheetTextSchema.parse({ gamePlan: "  Ramp.  ", winConditions: "", tableNotes: "\n" })).toEqual({
      gamePlan: "Ramp.",
      winConditions: null,
      tableNotes: null,
    });
    expect(tableSheetTextSchema.safeParse({ gamePlan: "x".repeat(1001), winConditions: "", tableNotes: "" }).success).toBe(false);
    expect(tableSheetTextSchema.safeParse({ gamePlan: "", winConditions: "a\nb\nc\nd\ne\nf\ng", tableNotes: "" }).success).toBe(false);
  });

  it("reads win conditions one per line, list marks dropped", () => {
    expect(winConditionLines("- Combat\n\n2. Drain\n• Mill")).toEqual(["Combat", "Drain", "Mill"]);
    expect(winConditionLines(null)).toEqual([]);
  });
});

describe("the tool's wiring", () => {
  it("is in the catalog, built, with an icon", () => {
    const tool = TOOL_CATALOG.find((entry) => entry.slug === RULE0_TOOL_SLUG);
    expect(tool?.built).toBe(true);
    expect(TOOL_ICONS[tool!.icon]).toBeTruthy();
    expect(tableSheetPath("my-deck")).toBe("/deck/my-deck/table-sheet");
  });

  it("draws a QR code as one path with its quiet zone", () => {
    const { d, size } = qrPath("https://pipglyph.com/deck/rule-0-sampler");
    expect(size).toBeGreaterThanOrEqual(21 + QR_QUIET * 2);
    expect(d).toMatch(/^M\d+ \d+h\d+v1h-\d+z/);
    // Nothing is drawn in the quiet zone.
    for (const match of d.matchAll(/M(\d+) (\d+)/g)) {
      expect(Number(match[1])).toBeGreaterThanOrEqual(QR_QUIET);
      expect(Number(match[2])).toBeGreaterThanOrEqual(QR_QUIET);
    }
  });
});
