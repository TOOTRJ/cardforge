import { describe, expect, it } from "vitest";
import { buildCardsExport, buildDeckExport, decideEntry } from "@/lib/tools/play-exports/build";
import { costColors, exportNameFor, fileStemOf, hasSharedPictures } from "@/lib/tools/play-exports/model";
import { GONE_CARD_NAME, PRIVATE_CARD_NAME, publicDeckItems } from "@/lib/decks/private-card-name";
import { BASE_URL, CTX, OTHER, OWNER, bake, cardId, cardRow, item, unchangedImport } from "./play-exports-fixtures";

// ---------------------------------------------------------------------------
// The play export's model (lib/tools/play-exports/build.ts): which entries go
// out as custom cards, which by name, which are left out — and the pictures,
// the stored display bakes only, never a private card's.
// ---------------------------------------------------------------------------

const DECK = { title: "Wolf Pack", fileStem: "wolf-pack" };
const BOLT_ID = "33333333-3333-4333-8333-333333333333";

describe("decideEntry", () => {
  it("writes an edited card as a custom card, standing in for its printing", () => {
    const card = cardRow();
    const decided = decideEntry(item({ name: "Grizzly Bears", scryfall_id: BOLT_ID }, card));
    expect(decided).toMatchObject({ kind: "custom", standsInFor: "Grizzly Bears" });
  });

  it("writes an unchanged import of the entry's printing by name", () => {
    const card = unchangedImport(BOLT_ID);
    expect(decideEntry(item({ name: "Lightning Bolt", scryfall_id: BOLT_ID }, card))).toEqual({ kind: "real", name: "Lightning Bolt" });
  });

  it("writes a printing and a pasted name by name", () => {
    expect(decideEntry(item({ name: "Sol Ring", scryfall_id: BOLT_ID }))).toEqual({ kind: "real", name: "Sol Ring" });
    expect(decideEntry(item({ name: "Mystery Card", source: "import" }))).toEqual({ kind: "real", name: "Mystery Card" });
  });

  it("leaves out a private card a visitor can't read, and a deleted card", () => {
    const hidden = item({ name: "Secret Plan", card_id: cardId(), source: "creator" });
    expect(decideEntry(hidden)).toEqual({ kind: "hidden" });
    expect(decideEntry(item({ name: GONE_CARD_NAME, source: "creator" }))).toEqual({ kind: "hidden" });
    // A hidden card standing in for a printing plays the printing by name…
    expect(decideEntry(item({ name: "Sol Ring", card_id: cardId(), scryfall_id: BOLT_ID }))).toEqual({ kind: "real", name: "Sol Ring" });
    // …unless the name itself was masked for the viewer.
    expect(decideEntry(item({ name: PRIVATE_CARD_NAME, card_id: cardId(), scryfall_id: BOLT_ID }))).toEqual({ kind: "hidden" });
  });
});

describe("buildDeckExport", () => {
  it("lists boards in order, counts the maybeboard out and each custom card once", () => {
    const wolf = cardRow();
    const exp = buildDeckExport(
      DECK,
      [
        item({ name: "Ember Wolf", quantity: 3 }, wolf),
        item({ name: "Ember Wolf", quantity: 1, board: "side" }, wolf),
        item({ name: "Sol Ring", scryfall_id: BOLT_ID, board: "commander" }),
        item({ name: "Maybe Card", scryfall_id: BOLT_ID, board: "maybe", quantity: 2 }),
      ],
      CTX,
    );
    expect(exp.cards).toHaveLength(1);
    expect(exp.lines.map((line) => line.board)).toEqual(["commander", "main", "side"]);
    expect(exp.leftOut).toEqual({ hidden: 0, maybeboard: 2 });
  });

  it("points a public card at its stored bake through this site's /render-cdn", () => {
    const wolf = cardRow();
    const [card] = buildDeckExport(DECK, [item({ name: "Ember Wolf" }, wolf)], CTX).cards;
    expect(card.front.image).toBe(`${BASE_URL}/render-cdn/${OWNER}/${wolf.id}.png?v=1`);
    expect(card.front.thumb).toBe(`${BASE_URL}/render-cdn/${OWNER}/${wolf.id}.thumb.webp?v=1`);
    expect(card.pageUrl).toBe(`${BASE_URL}/card/maker/${wolf.slug}`);
    expect(card.front).toMatchObject({ name: "Ember Wolf", cost: "{1}{R}", typeLine: "Creature — Wolf", power: "2", toughness: "1", colors: ["R"] });
  });

  it("gives a private card no picture and no page, even with a pointer left on the row", () => {
    const secret = cardRow({ visibility: "private" });
    const [card] = buildDeckExport(DECK, [item({ name: "Ember Wolf" }, secret)], CTX).cards;
    expect(card.front.image).toBeNull();
    expect(card.front.thumb).toBeNull();
    expect(card.pageUrl).toBeNull();
    expect(hasSharedPictures(card)).toBe(false);
  });

  it("never draws a pointer that isn't this card's own bake", () => {
    const id = cardId();
    const borrowed = cardRow({ id, rendered_image_url: bake(OTHER, cardId()) });
    expect(buildDeckExport(DECK, [item({ name: "x" }, borrowed)], CTX).cards[0].front.image).toBeNull();
    const outside = cardRow({ rendered_image_url: "https://example.com/pixel.png" });
    expect(buildDeckExport(DECK, [item({ name: "x" }, outside)], CTX).cards[0].front.image).toBeNull();
  });

  it("renames a custom card that would take a real card's name", () => {
    const edited = cardRow({ title: "Lightning Bolt" });
    const exp = buildDeckExport(
      DECK,
      [item({ name: "Lightning Bolt", scryfall_id: BOLT_ID }, edited), item({ name: "Sol Ring", scryfall_id: BOLT_ID })],
      CTX,
    );
    expect(exp.cards[0].name).toBe("Lightning Bolt (PipGlyph)");
    expect(exp.cards[0].front.name).toBe("Lightning Bolt (PipGlyph)");
  });

  it("names a visitor's view of a private card nowhere (publicDeckItems first)", () => {
    const secret = cardRow({ visibility: "private", title: "Secret Plan" });
    const rows = [{ ...item({ name: "Secret Plan", card_id: secret.id, source: "creator" }), card: null }];
    const shown = publicDeckItems(rows, false);
    const exp = buildDeckExport(DECK, shown, CTX);
    expect(exp.cards).toEqual([]);
    expect(exp.lines).toEqual([]);
    expect(exp.leftOut.hidden).toBe(1);
    expect(JSON.stringify(exp)).not.toContain("Secret Plan");
  });

  it("exports a double-faced card as two faces with both bakes", () => {
    const id = cardId();
    const dfc = cardRow({
      id,
      frame_style: { template: "m15dfcfront" },
      back_face: { title: "Ash Wolf", card_type: "creature", subtypes: ["Wolf"], power: "3", toughness: "2", rules_text: "Trample", frame_style: { template: "m15dfcback" } },
      rendered_back_image_url: bake(OWNER, id, `${id}.back.png`),
      rendered_back_thumb_url: bake(OWNER, id, `${id}.back.thumb.webp`),
    });
    const [card] = buildDeckExport(DECK, [item({ name: "Ember Wolf" }, dfc)], CTX).cards;
    expect(card.layout).toBe("transform");
    expect(card.back).toMatchObject({ name: "Ash Wolf", rulesText: "Trample", power: "3", toughness: "2" });
    expect(card.back?.image).toBe(`${BASE_URL}/render-cdn/${OWNER}/${id}.back.png?v=1`);
  });
});

describe("buildCardsExport", () => {
  it("writes each card once as a custom card, an unchanged import apart from the real one", () => {
    const exp = buildCardsExport([cardRow(), unchangedImport(BOLT_ID)], CTX);
    expect(exp.source).toBe("cards");
    expect(exp.cards.map((card) => card.name)).toEqual(["Ember Wolf", "Lightning Bolt (PipGlyph)"]);
    expect(exp.lines.every((line) => line.kind === "custom" && line.quantity === 1)).toBe(true);
  });
});

describe("model helpers", () => {
  it("reads a cost's colours, hybrid and Phyrexian included", () => {
    expect(costColors("{2}{G}{W/U}{B/P}")).toEqual(["W", "U", "B", "G"]);
    expect(costColors("{3}")).toEqual([]);
    expect(costColors(null)).toEqual([]);
  });

  it("makes a file stem", () => {
    expect(fileStemOf("Ëmber & Ash: Deck #2!")).toBe("ember-ash-deck-2");
    expect(fileStemOf("!!!")).toBe("pipglyph-export");
  });

  it("keeps export names unique, case-insensitively", () => {
    const taken = new Set<string>(["sol ring"]);
    expect(exportNameFor("Sol Ring", taken, null)).toBe("Sol Ring (PipGlyph)");
    expect(exportNameFor("sol ring", taken, null)).toBe("sol ring (PipGlyph 2)");
    expect(exportNameFor("  ", taken, null)).toBe("Untitled card");
  });
});
