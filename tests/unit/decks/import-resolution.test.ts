import { describe, expect, it } from "vitest";
import {
  cardNameMatchesEntry,
  chunkIdentifiers,
  identifierFor,
  lookupEntry,
  nameFallbackIdentifiers,
  reconcileCollection,
  toResolvedCardData,
  clampManaValue,
  MAX_MANA_VALUE,
  commitScryfallIds,
  scryfallIdBatches,
  serverResolvedLines,
} from "@/lib/decks/import-resolution";
import type { ScryfallCard } from "@/lib/scryfall/client";

function card(overrides: Partial<ScryfallCard> = {}): ScryfallCard {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    name: "Lightning Bolt",
    set: "m10",
    collector_number: "146",
    cmc: 1,
    mana_cost: "{R}",
    type_line: "Instant",
    color_identity: ["R"],
    rarity: "common",
    image_uris: { normal: "https://cards.scryfall.io/normal/bolt.jpg" },
    ...overrides,
  } as ScryfallCard;
}

describe("identifierFor", () => {
  it("prefers set + collector number, then name + set, then name", () => {
    expect(
      identifierFor({ name: "Bolt", setCode: "m10", collectorNumber: "146" }),
    ).toEqual({ set: "m10", collector_number: "146" });
    expect(
      identifierFor({ name: "Bolt", setCode: "m10", collectorNumber: null }),
    ).toEqual({ name: "Bolt", set: "m10" });
    expect(
      identifierFor({ name: "Bolt", setCode: null, collectorNumber: null }),
    ).toEqual({ name: "Bolt" });
  });
});

describe("chunkIdentifiers", () => {
  it("chunks to the Scryfall cap", () => {
    const chunks = chunkIdentifiers(Array.from({ length: 160 }, (_, i) => i), 75);
    expect(chunks.map((c) => c.length)).toEqual([75, 75, 10]);
  });
});

describe("reconcileCollection + lookupEntry", () => {
  it("matches by printing key and by name, never by position", () => {
    const bolt = card();
    const { byKey } = reconcileCollection([], [bolt]);
    expect(
      lookupEntry(byKey, {
        name: "whatever",
        setCode: "m10",
        collectorNumber: "146",
      }),
    ).toBe(bolt);
    expect(
      lookupEntry(byKey, {
        name: "LIGHTNING BOLT",
        setCode: null,
        collectorNumber: null,
      }),
    ).toBe(bolt);
    expect(
      lookupEntry(byKey, {
        name: "Shock",
        setCode: null,
        collectorNumber: null,
      }),
    ).toBeNull();
  });

  it("matches front-face names against full split names", () => {
    const fable = card({
      id: "00000000-0000-0000-0000-000000000002",
      name: "Fable of the Mirror-Breaker // Reflection of Kiki-Jiki",
      set: "neo",
      collector_number: "141",
    });
    const { byKey } = reconcileCollection([], [fable]);
    expect(
      lookupEntry(byKey, {
        name: "Fable of the Mirror-Breaker",
        setCode: null,
        collectorNumber: null,
      }),
    ).toBe(fable);
  });
});

describe("wrong collector numbers — name beats printing on mismatch", () => {
  // Regression: "1 Krenko, Mob Boss (DMC) 129" — DMC 129 is actually Beast
  // Within. The printing hit must NOT silently win over the parsed name.
  const beastWithin = card({
    id: "00000000-0000-0000-0000-00000000000b",
    name: "Beast Within",
    set: "dmc",
    collector_number: "129",
  });
  const krenko = card({
    id: "00000000-0000-0000-0000-00000000000c",
    name: "Krenko, Mob Boss",
    set: "j25",
    collector_number: "45",
  });
  const entry = {
    name: "Krenko, Mob Boss",
    setCode: "dmc",
    collectorNumber: "129",
  };

  it("prefers a name match over a name-mismatched printing hit", () => {
    const { byKey } = reconcileCollection([], [beastWithin, krenko]);
    expect(lookupEntry(byKey, entry)).toBe(krenko);
  });

  it("returns the mismatched printing hit only as a last resort", () => {
    const { byKey } = reconcileCollection([], [beastWithin]);
    expect(lookupEntry(byKey, entry)).toBe(beastWithin);
    expect(cardNameMatchesEntry(beastWithin, entry.name)).toBe(false);
  });

  it("requests a name fallback for the mismatched printing", () => {
    const { byKey } = reconcileCollection([], [beastWithin]);
    expect(nameFallbackIdentifiers([entry], byKey)).toEqual([
      { name: "Krenko, Mob Boss" },
    ]);
  });
});

describe("nameFallbackIdentifiers", () => {
  it("retries missed printings as bare names, deduped", () => {
    const { byKey } = reconcileCollection([], [card()]);
    const fallbacks = nameFallbackIdentifiers(
      [
        // resolved — no fallback
        { name: "Lightning Bolt", setCode: "m10", collectorNumber: "146" },
        // missed printing (Arena's DAR ≠ Scryfall's DOM) — falls back
        { name: "Llanowar Elves", setCode: "dar", collectorNumber: "168" },
        { name: "Llanowar Elves", setCode: "dar", collectorNumber: "169" },
        // name-only miss without a split name — already tried, no fallback
        { name: "Definitely Fake Card", setCode: null, collectorNumber: null },
      ],
      byKey,
    );
    expect(fallbacks).toEqual([{ name: "Llanowar Elves" }]);
  });

  it("retries name-only split-card misses with the front face", () => {
    const { byKey } = reconcileCollection([], []);
    expect(
      nameFallbackIdentifiers(
        [{ name: "Fire/Ice", setCode: null, collectorNumber: null }],
        byKey,
      ),
    ).toEqual([{ name: "Fire" }]);
  });
});

describe("toResolvedCardData", () => {
  it("denormalizes the fields a deck entry stores", () => {
    expect(toResolvedCardData(card())).toEqual({
      scryfall_id: "00000000-0000-0000-0000-000000000001",
      name: "Lightning Bolt",
      set_code: "m10",
      collector_number: "146",
      type_line: "Instant",
      mana_cost: "{R}",
      mana_value: 1,
      color_identity: ["R"],
      rarity: "common",
      image_url: "https://cards.scryfall.io/normal/bolt.jpg",
    });
  });

  it("falls back to the front face for DFC images and stats", () => {
    const dfc = card({
      image_uris: null,
      mana_cost: null,
      type_line: null,
      card_faces: [
        {
          name: "Delver of Secrets",
          mana_cost: "{U}",
          type_line: "Creature — Human Wizard",
          image_uris: { normal: "https://cards.scryfall.io/normal/delver.jpg" },
        },
      ],
    });
    const resolved = toResolvedCardData(dfc);
    expect(resolved.image_url).toBe(
      "https://cards.scryfall.io/normal/delver.jpg",
    );
    expect(resolved.mana_cost).toBe("{U}");
    expect(resolved.type_line).toBe("Creature — Human Wizard");
  });

  it("filters color identity to WUBRG letters only", () => {
    const weird = card({ color_identity: ["R", "C", "nonsense"] });
    expect(toResolvedCardData(weird).color_identity).toEqual(["R"]);
  });
});

describe("clampManaValue", () => {
  it("keeps ordinary values and nulls", () => {
    expect(clampManaValue(3)).toBe(3);
    expect(clampManaValue(2.5)).toBe(2.5);
    expect(clampManaValue(0)).toBe(0);
    expect(clampManaValue(null)).toBeNull();
    expect(clampManaValue(undefined)).toBeNull();
  });

  it("REGRESSION: Gleemax's cmc 1,000,000 no longer overflows numeric(6,2) and aborts the import", () => {
    expect(clampManaValue(1_000_000)).toBe(MAX_MANA_VALUE);
    expect(clampManaValue(Number.POSITIVE_INFINITY)).toBeNull();
    expect(clampManaValue(-4)).toBe(0);
  });
});

describe("the commit's own lookup (DK0.3: only the printing id is read from the browser)", () => {
  const BOLT_ID = "00000000-0000-0000-0000-000000000001";
  const SHOCK_ID = "00000000-0000-0000-0000-000000000002";
  const UNKNOWN_ID = "00000000-0000-0000-0000-0000000000ff";

  it("asks for each distinct id once, lower-cased, 75 a batch", () => {
    const ids = commitScryfallIds([
      { board: "main", quantity: 1, name: "Bolt", resolved: { scryfall_id: BOLT_ID.toUpperCase() } },
      { board: "side", quantity: 2, name: "Bolt", resolved: { scryfall_id: BOLT_ID } },
      { board: "main", quantity: 1, name: "Typo", resolved: null },
      { board: "main", quantity: 1, name: "Shock", resolved: { scryfall_id: SHOCK_ID } },
    ]);
    expect(ids).toEqual([BOLT_ID, SHOCK_ID]);
    const many = Array.from({ length: 160 }, (_, i) => `id-${i}`);
    const batches = scryfallIdBatches(many, 75);
    expect(batches.map((b) => b.length)).toEqual([75, 75, 10]);
    expect(batches[0]?.[0]).toEqual({ id: "id-0" });
  });

  it("stores Scryfall's answer, never the browser's copy; an unknown id is a name-only placeholder", () => {
    const lines = serverResolvedLines(
      [
        // A tampered payload: the id is Bolt's, everything else is made up —
        // and only the id survives the schema anyway.
        { board: "main", quantity: 4, name: "Lightning Bolt", resolved: { scryfall_id: BOLT_ID } },
        { board: "main", quantity: 1, name: "Made Up", resolved: { scryfall_id: UNKNOWN_ID } },
        { board: "side", quantity: 2, name: "Mystery", resolved: null },
      ],
      [card({ id: BOLT_ID, name: "Lightning Bolt", type_line: "Instant" })],
    );
    expect(lines[0]?.resolved).toEqual(toResolvedCardData(card({ id: BOLT_ID })));
    expect(lines[1]).toEqual({ board: "main", quantity: 1, name: "Made Up", resolved: null });
    expect(lines[2]).toEqual({ board: "side", quantity: 2, name: "Mystery", resolved: null });
  });
});
