import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { importFingerprintOf } from "@/lib/cards/import-fingerprint";
import { deckEntryStatus, deckEntryUnavailable } from "@/lib/decks/entry-status";

// ---------------------------------------------------------------------------
// supabase/seeds/26_deck_card_origin.sql — the "Every Status Sampler" deck
// (TODO DK2.5 / DK2.6 / DK2.9): one entry per status, another creator's
// public card and one that went private. Its three cards carry import
// provenance, and a fingerprint is the JS helper's hash: this test holds each
// seeded card row to the fields it hashes, and each seeded entry to the
// status it is there to show.
// ---------------------------------------------------------------------------

const seed = readFileSync(join(process.cwd(), "supabase/seeds/26_deck_card_origin.sql"), "utf8");

const ART = (n: number) => `https://pipglyph.com/defaults/avatars/avatar-${String(n).padStart(2, "0")}.webp`;

type SeedCard = {
  id: string;
  title: string;
  slug: string;
  cost: string;
  colors: string[];
  supertype: string | null;
  card_type: string;
  subtypes: string[];
  rarity: string;
  rules_text: string;
  power: string | null;
  toughness: string | null;
  artist_credit: string;
  art: number;
  template: string;
  source_scryfall_id: string;
  import_scryfall_id: string;
  /** What the card printed when it was imported (null = the row stores no
   *  fingerprint: changed before its first save). */
  imported_as: Partial<SeedCard> | null;
};

const LLANOWAR = "581b7327-3215-4a4f-b4ae-d9d4002ba882";
const SOLEMN = "7bbd2cab-538e-4932-a828-150e3e9d52ad";
const THOUGHT_KNOT = "bffc360e-db41-48f3-9365-680d55046e04";

const CARDS: SeedCard[] = [
  {
    // Saved straight from the import: still prints what it printed.
    id: "c0000000-0000-4000-a000-0000000006b1",
    title: "Llanowar Elves",
    slug: "llanowar-elves",
    cost: "{G}",
    colors: ["green"],
    supertype: null,
    card_type: "creature",
    subtypes: ["Elf", "Druid"],
    rarity: "common",
    rules_text: "{T}: Add {G}.",
    power: "1",
    toughness: "1",
    artist_credit: "Chris Rahn",
    art: 7,
    template: "m15",
    source_scryfall_id: LLANOWAR,
    import_scryfall_id: LLANOWAR,
    imported_as: {},
  },
  {
    // Renamed since its import: the fingerprint is the printing's.
    id: "c0000000-0000-4000-a000-0000000006b2",
    title: "Solemn Sentinel",
    slug: "solemn-sentinel",
    cost: "{4}",
    colors: ["colorless"],
    supertype: "Artifact",
    card_type: "creature",
    subtypes: ["Golem"],
    rarity: "rare",
    rules_text:
      "When Solemn Sentinel enters, you may search your library for a basic land card, put it onto the battlefield tapped, then shuffle.\nWhen Solemn Sentinel dies, you may draw a card.",
    power: "2",
    toughness: "2",
    artist_credit: "Donato Giancola",
    art: 12,
    template: "m15artifact",
    source_scryfall_id: SOLEMN,
    import_scryfall_id: SOLEMN,
    imported_as: {
      title: "Solemn Simulacrum",
      rules_text:
        "When Solemn Simulacrum enters, you may search your library for a basic land card, put it onto the battlefield tapped, then shuffle.\nWhen Solemn Simulacrum dies, you may draw a card.",
    },
  },
  {
    // An AI restyle of a printing: saved changed, so no fingerprint.
    id: "c0000000-0000-4000-a000-0000000006b3",
    title: "Thicket Seer",
    slug: "thicket-seer",
    cost: "{3}{C}",
    colors: ["colorless"],
    supertype: null,
    card_type: "creature",
    subtypes: ["Eldrazi"],
    rarity: "rare",
    rules_text:
      "When Thicket Seer enters, target opponent reveals their hand. You choose a nonland card from it and exile that card.\nWhen Thicket Seer leaves the battlefield, target opponent draws a card.",
    power: "4",
    toughness: "4",
    artist_credit: "PipGlyph AI",
    art: 19,
    template: "m15",
    source_scryfall_id: THOUGHT_KNOT,
    import_scryfall_id: THOUGHT_KNOT,
    imported_as: null,
  },
];

/** The row as the database stores it (what deckEntryStatus reads). */
function rowOf(card: SeedCard, over: Partial<SeedCard> = {}) {
  const c = { ...card, ...over };
  // Every column the seed's insert names, and the column default of every
  // other fingerprinted one (art_position '{}', lang 'en', the rest NULL).
  return {
    title: c.title,
    nickname: null,
    cost: c.cost,
    color_identity: c.colors,
    supertype: c.supertype,
    card_type: c.card_type,
    subtypes: c.subtypes,
    printed_types: null,
    rarity: c.rarity,
    rules_text: c.rules_text,
    flavor_text: null,
    power: c.power,
    toughness: c.toughness,
    loyalty: null,
    defense: null,
    artist_credit: c.artist_credit,
    art_url: ART(c.art),
    art_position: {},
    frame_style: { template: c.template, finish: "regular" },
    face_content: null,
    back_face: null,
    watermark: null,
    footer_text: null,
    set_icon_url: null,
    set_icon_code: null,
    set_code: null,
    collector_number: null,
    lang: "en",
    parent_card_id: null,
    source_scryfall_id: c.source_scryfall_id,
    import_scryfall_id: c.import_scryfall_id,
  };
}

function fingerprintOf(card: SeedCard): string | null {
  return card.imported_as ? importFingerprintOf(rowOf(card, card.imported_as)) : null;
}

const sqlText = (value: string | null) => (value === null ? "null" : `E'${value.replace(/\\/g, "\\\\").replace(/'/g, "''").replace(/\n/g, "\\n")}'`);
/** A plain literal — a title the seed-card-ids test reads a row by. */
const sqlPlain = (value: string) => `'${value.replace(/'/g, "''")}'`;
const sqlArray = (values: string[]) => (values.length === 0 ? "array[]::text[]" : `array[${values.map((v) => `'${v}'`).join(",")}]`);

/** The card's line in the seed, exactly. */
function seedCardLine(card: SeedCard): string {
  const fingerprint = fingerprintOf(card);
  return [
    `  ('${card.id}'::uuid, ${sqlPlain(card.title)}, '${card.slug}', '${card.cost}', ${sqlArray(card.colors)}, ${card.supertype ? `'${card.supertype}'` : "null"}, '${card.card_type}', ${sqlArray(card.subtypes)}, '${card.rarity}',`,
    `     ${sqlText(card.rules_text)}, ${card.power ? `'${card.power}'` : "null"}, ${card.toughness ? `'${card.toughness}'` : "null"}, ${sqlPlain(card.artist_credit)}, ${card.art}, '${card.template}',`,
    `     '${card.source_scryfall_id}'::uuid, '${card.import_scryfall_id}'::uuid, ${fingerprint ? `'${fingerprint}'` : "null"})`,
  ].join("\n");
}

describe("the seeded provenance cards", () => {
  it.each(CARDS.map((card) => [card.title, card] as const))("%s: the seed holds the row and its fingerprint", (_title, card) => {
    expect(seed).toContain(seedCardLine(card));
  });

  it("read as the statuses they are there for", () => {
    const linked = (card: SeedCard) =>
      deckEntryStatus(
        { scryfall_id: card.import_scryfall_id, card_id: card.id, source: "import" },
        { ...rowOf(card), import_fingerprint: fingerprintOf(card) },
      );
    expect(CARDS.map(linked)).toEqual(["imported", "edited", "edited"]);
  });
});

describe("the seeded entries", () => {
  // [entry id suffix, what it shows]
  const ENTRIES: Array<[string, string]> = [
    ["6b1", "Fire // Ice — Imported (a printing, no card)"],
    ["6b2", "Llanowar Elves — Imported (a linked card, unchanged)"],
    ["6b3", "Solemn Simulacrum — Edited"],
    ["6b4", "Thought-Knot Seer — Edited (an AI restyle that kept its printing)"],
    ["6b5", "Cinderwing Broodling — Remix"],
    ["6b6", "Archivist of Lost Hours — Original"],
    ["6b7", "Cinderwing Matriarch — another creator's public card"],
    ["6b8", "Tidecaller Apprentice — another creator's card that went private"],
    ["6b9", "Ashen Prototype — a deleted card"],
    ["6ba", "Zqx Unknown Relic — Not found"],
    ["6bb", "Void Tithe — another creator's UNLISTED card, withheld by the deck read"],
  ];
  it.each(ENTRIES)("…%s is in the seed (%s)", (suffix) => {
    expect(seed).toContain(`'a0000000-0000-4000-a000-000000000${suffix}'`);
  });

  it("the deleted card's entry is No longer available, the placeholder is not", () => {
    expect(deckEntryUnavailable({ scryfall_id: null, card_id: null, source: "creator" }, null, true)).toBe(true);
    expect(deckEntryStatus({ scryfall_id: null, card_id: null, source: "creator" }, null)).toBe("not_found");
    expect(deckEntryUnavailable({ scryfall_id: null, card_id: null, source: "import" }, null, true)).toBe(false);
  });
});
