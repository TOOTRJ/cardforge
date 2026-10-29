import { describe, expect, it } from "vitest";
import { importFingerprintOf } from "@/lib/cards/import-fingerprint";
import { canLinkIntoDeck, deckEntryStatus, deckEntryUnavailable, type StatusCard } from "@/lib/decks/entry-status";
import { DECK_ENTRY_SOURCE_VALUES, DECK_ENTRY_STATUS_VALUES } from "@/types/deck";

// ---------------------------------------------------------------------------
// deckEntryStatus (TODO DK2.6): the ONE answer to "what is this entry" —
// Imported / Edited / Remix / Original / Not found — over every shape an
// entry and its card can take. Exhaustive on purpose: the table below is
// every combination of the inputs the function reads.
// ---------------------------------------------------------------------------

const PRINTING = "581b7327-3215-4a4f-b4ae-d9d4002ba882";

const CARD = {
  title: "Llanowar Elves",
  cost: "{G}",
  supertype: null,
  card_type: "creature",
  subtypes: ["Elf", "Druid"],
  printed_types: null,
  rules_text: "{T}: Add {G}.",
  flavor_text: null,
  power: "1",
  toughness: "1",
  loyalty: null,
  defense: null,
  artist_credit: "Chris Rahn",
  art_url: "https://example.supabase.co/storage/v1/object/public/card-art/u/elves.png",
  back_face: null,
};

type CardShape = "none" | "unreadable" | "remix" | "tracked-unchanged" | "tracked-edited" | "edited-at-import" | "source-only" | "plain";

/** The card as the viewer reads it, per shape ("unreadable": linked, but
 *  RLS returns nothing). */
function cardOf(shape: CardShape): StatusCard | null {
  const fingerprint = importFingerprintOf(CARD);
  switch (shape) {
    case "none":
    case "unreadable":
      return null;
    case "remix":
      // A remix wins over anything else it carries.
      return { ...CARD, parent_card_id: "p", import_scryfall_id: PRINTING, import_fingerprint: fingerprint };
    case "tracked-unchanged":
      return { ...CARD, import_scryfall_id: PRINTING, import_fingerprint: fingerprint };
    case "tracked-edited":
      return { ...CARD, rules_text: "{T}: Add {G}{G}.", import_scryfall_id: PRINTING, import_fingerprint: fingerprint };
    case "edited-at-import":
      return { ...CARD, import_scryfall_id: PRINTING, import_fingerprint: null };
    case "source-only":
      // Before 0144: the user-editable source id, no provenance.
      return { ...CARD, source_scryfall_id: PRINTING, import_scryfall_id: null };
    case "plain":
      return { ...CARD };
  }
}

const SHAPES: CardShape[] = ["none", "unreadable", "remix", "tracked-unchanged", "tracked-edited", "edited-at-import", "source-only", "plain"];

/** [entry has a printing, card shape] → status. */
const EXPECTED: Record<"printing" | "no-printing", Record<CardShape, string>> = {
  printing: {
    none: "imported",
    unreadable: "edited",
    remix: "remix",
    "tracked-unchanged": "imported",
    "tracked-edited": "edited",
    "edited-at-import": "edited",
    "source-only": "edited",
    // An older import the deck flow knows: the entry's printing.
    plain: "edited",
  },
  "no-printing": {
    none: "not_found",
    unreadable: "original",
    remix: "remix",
    "tracked-unchanged": "imported",
    "tracked-edited": "edited",
    "edited-at-import": "edited",
    "source-only": "edited",
    plain: "original",
  },
};

describe("deckEntryStatus — every entry × card shape", () => {
  for (const printing of ["printing", "no-printing"] as const) {
    for (const shape of SHAPES) {
      for (const source of [null, ...DECK_ENTRY_SOURCE_VALUES]) {
        it(`${printing} · ${shape} · source ${source ?? "null"} → ${EXPECTED[printing][shape]}`, () => {
          const entry = {
            scryfall_id: printing === "printing" ? PRINTING : null,
            card_id: shape === "none" ? null : "card-1",
            source,
          };
          // The source never changes what an entry IS — only whether a
          // missing card reads as "No longer available".
          expect(deckEntryStatus(entry, cardOf(shape))).toBe(EXPECTED[printing][shape]);
        });
      }
    }
  }

  it("covers every status", () => {
    const seen = new Set(Object.values(EXPECTED).flatMap((row) => Object.values(row)));
    expect([...seen].sort()).toEqual([...DECK_ENTRY_STATUS_VALUES].sort());
  });

  it("an unchanged import turns Edited with ANY change to the card (owner 2026-10-29), and back", () => {
    const fingerprint = importFingerprintOf(CARD);
    const entry = { scryfall_id: PRINTING, card_id: "c" };
    const card = { ...CARD, import_scryfall_id: PRINTING, import_fingerprint: fingerprint };
    expect(deckEntryStatus(entry, card)).toBe("imported");
    expect(deckEntryStatus(entry, { ...card, art_url: "https://x/new.png" })).toBe("edited");
    expect(deckEntryStatus(entry, { ...card, title: "Llanowar Elder" })).toBe("edited");
    // The frame, the colour, the rarity alone: Edited too.
    expect(deckEntryStatus(entry, { ...card, frame_style: { template: "m15nyx" } } as never)).toBe("edited");
    expect(deckEntryStatus(entry, { ...card, color_identity: ["blue"] } as never)).toBe("edited");
    expect(deckEntryStatus(entry, { ...card, rarity: "mythic" } as never)).toBe("edited");
    // Not what isn't the card: its visibility, its tags.
    expect(deckEntryStatus(entry, { ...card, visibility: "private", tags: ["elves"] } as never)).toBe("imported");
  });

  it("an unchanged import of ANOTHER printing is Edited — Imported only for the entry's own printing (L1)", () => {
    const fingerprint = importFingerprintOf(CARD);
    const card = { ...CARD, import_scryfall_id: PRINTING, import_fingerprint: fingerprint };
    expect(deckEntryStatus({ scryfall_id: "e3285e6b-3e79-4d7c-bf96-d920f973b122", card_id: "c" }, card)).toBe("edited");
    // The same printing, whatever its case.
    expect(deckEntryStatus({ scryfall_id: PRINTING.toUpperCase(), card_id: "c" }, card)).toBe("imported");
    // No printing on the entry (the creator's add): the card's own import.
    expect(deckEntryStatus({ scryfall_id: null, card_id: "c" }, card)).toBe("imported");
  });

  it("reads a row from a database 0144 has not reached (no provenance columns) as not tracked", () => {
    expect(deckEntryStatus({ scryfall_id: null, card_id: "c" }, { ...CARD })).toBe("original");
    expect(deckEntryStatus({ scryfall_id: PRINTING, card_id: "c" }, { ...CARD })).toBe("edited");
  });
});

describe("deckEntryUnavailable (D3: No longer available)", () => {
  it("a linked card the deck's OWNER can't read is another creator's that went private", () => {
    expect(deckEntryUnavailable({ scryfall_id: null, card_id: "c", source: "link" }, null, true)).toBe(true);
    expect(deckEntryUnavailable({ scryfall_id: PRINTING, card_id: "c", source: "import" }, null, true)).toBe(true);
  });

  it("a visitor can't tell it from the owner's own private card: no label", () => {
    expect(deckEntryUnavailable({ scryfall_id: null, card_id: "c", source: "link" }, null, false)).toBe(false);
  });

  it("an entry its owner UNLINKED (source cleared by unlinkDeckCardAction) is a plain name, not unavailable", () => {
    expect(deckEntryUnavailable({ scryfall_id: null, card_id: null, source: null }, null, true)).toBe(false);
    expect(deckEntryStatus({ scryfall_id: null, card_id: null, source: null }, null)).toBe("not_found");
  });

  it("a deleted card: an entry that came with a card, nothing left, no printing", () => {
    for (const source of ["creator", "link", "ai_generate", "ai_remix"]) {
      expect(deckEntryUnavailable({ scryfall_id: null, card_id: null, source }, null, false)).toBe(true);
      expect(deckEntryUnavailable({ scryfall_id: null, card_id: null, source }, null, true)).toBe(true);
    }
  });

  it("never a placeholder, a pre-0144 row, an entry with a printing, or a readable card", () => {
    expect(deckEntryUnavailable({ scryfall_id: null, card_id: null, source: "import" }, null, true)).toBe(false);
    expect(deckEntryUnavailable({ scryfall_id: null, card_id: null, source: "manual" }, null, true)).toBe(false);
    expect(deckEntryUnavailable({ scryfall_id: null, card_id: null, source: null }, null, true)).toBe(false);
    expect(deckEntryUnavailable({ scryfall_id: null, card_id: null }, null, true)).toBe(false);
    // A deleted AI restyle reverts to its printing.
    expect(deckEntryUnavailable({ scryfall_id: PRINTING, card_id: null, source: "ai_remix" }, null, true)).toBe(false);
    expect(deckEntryUnavailable({ scryfall_id: null, card_id: "c", source: "link" }, CARD, true)).toBe(false);
  });
});

describe("canLinkIntoDeck (D3, the database's rule)", () => {
  it("the deck owner's own card at any visibility", () => {
    for (const visibility of ["public", "unlisted", "private"]) {
      expect(canLinkIntoDeck({ owner_id: "me", visibility }, "me")).toBe(true);
    }
  });

  it("another creator's card only when public", () => {
    expect(canLinkIntoDeck({ owner_id: "them", visibility: "public" }, "me")).toBe(true);
    expect(canLinkIntoDeck({ owner_id: "them", visibility: "unlisted" }, "me")).toBe(false);
    expect(canLinkIntoDeck({ owner_id: "them", visibility: "private" }, "me")).toBe(false);
  });
});
