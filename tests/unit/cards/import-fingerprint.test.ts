import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  fingerprintMatches,
  IMPORT_FINGERPRINT_BACK_FIELDS,
  IMPORT_FINGERPRINT_FIELDS,
  importEditStateOf,
  importFingerprintOf,
  importFingerprintText,
  sha256Hex,
} from "@/lib/cards/import-fingerprint";

// ---------------------------------------------------------------------------
// The import fingerprint (TODO DK2.5, migration 0144): ONE hash of what a
// card prints, compared row to row. The field list is explicit and pinned
// here — a new printed column joins it as a new VERSION, never silently.
// ---------------------------------------------------------------------------

const BOLT = {
  title: "Lightning Bolt",
  cost: "{R}",
  supertype: null,
  card_type: "instant",
  subtypes: [] as string[],
  printed_types: null,
  rules_text: "Lightning Bolt deals 3 damage to any target.",
  flavor_text: "The sparkmage shrieked, calling on the rage of the storms of his youth.",
  power: null,
  toughness: null,
  loyalty: null,
  defense: null,
  artist_credit: "Christopher Moeller",
  art_url: "https://example.supabase.co/storage/v1/object/public/card-art/u/bolt.png",
  back_face: null,
};

describe("sha256Hex", () => {
  it.each([
    "",
    "abc",
    "a".repeat(55),
    "a".repeat(56),
    "a".repeat(63),
    "a".repeat(64),
    "a".repeat(1000),
    "Fire // Ice — “quoted” ’ é ∞ 🐉",
  ])("matches node:crypto for %#", (input) => {
    expect(sha256Hex(input)).toBe(createHash("sha256").update(input, "utf8").digest("hex"));
  });
});

describe("the field list", () => {
  it("is the printed text, the stats, the credit and the picture — nothing the platform rewrites", () => {
    expect(IMPORT_FINGERPRINT_FIELDS).toEqual([
      "title",
      "nickname",
      "cost",
      "supertype",
      "card_type",
      "subtypes",
      "printed_types",
      "rules_text",
      "flavor_text",
      "power",
      "toughness",
      "loyalty",
      "defense",
      "artist_credit",
      "art_url",
    ]);
    expect(IMPORT_FINGERPRINT_BACK_FIELDS).toEqual(IMPORT_FINGERPRINT_FIELDS.filter((field) => field !== "nickname"));
  });

  it("has the stored format", () => {
    expect(importFingerprintOf(BOLT)).toMatch(/^v1:[0-9a-f]{64}$/);
  });
});

describe("importFingerprintOf", () => {
  const base = importFingerprintOf(BOLT);

  it("is the same for the insert and the row read back (absent, null and blank texts are one)", () => {
    const insert = { ...BOLT, supertype: undefined, power: undefined, subtypes: undefined, nickname: undefined };
    const row = { ...BOLT, supertype: "", power: null, subtypes: [], nickname: null, frame_style: { template: "m15" } };
    expect(importFingerprintOf(insert)).toBe(base);
    expect(importFingerprintOf(row)).toBe(base);
  });

  it("ignores key order and columns it doesn't read (frame, colour, rarity, rows)", () => {
    const reordered = Object.fromEntries(Object.entries(BOLT).reverse());
    expect(importFingerprintOf(reordered)).toBe(base);
    expect(
      importFingerprintOf({
        ...BOLT,
        frame_style: { template: "m15nyx" },
        color_identity: ["blue"],
        rarity: "mythic",
        face_content: { loyalty: [] },
        visibility: "public",
      } as typeof BOLT),
    ).toBe(base);
  });

  it.each(IMPORT_FINGERPRINT_FIELDS.filter((field) => field !== "subtypes" && field !== "printed_types"))(
    "moves when %s changes",
    (field) => {
      expect(importFingerprintOf({ ...BOLT, [field]: "changed" })).not.toBe(base);
    },
  );

  it("moves when the subtypes change, and keeps their order", () => {
    expect(importFingerprintOf({ ...BOLT, subtypes: ["Arcane"] })).not.toBe(base);
    expect(importFingerprintOf({ ...BOLT, subtypes: ["Elf", "Druid"] })).not.toBe(
      importFingerprintOf({ ...BOLT, subtypes: ["Druid", "Elf"] }),
    );
  });

  it("keeps the two empty Types fields apart (NULL = the built line, \"\" = emptied)", () => {
    expect(importFingerprintOf({ ...BOLT, printed_types: "" })).not.toBe(base);
    expect(importFingerprintOf({ ...BOLT, printed_types: "Instant" })).not.toBe(base);
  });

  it("reads the back face's printed keys only", () => {
    const back = { title: "Ice", cost: "{1}{U}", card_type: "instant", rules_text: "Tap target permanent." };
    const withBack = importFingerprintOf({ ...BOLT, back_face: back });
    expect(withBack).not.toBe(base);
    expect(importFingerprintOf({ ...BOLT, back_face: { ...back, frame_style: { template: "x" }, color_identity: ["blue"] } })).toBe(withBack);
    expect(importFingerprintOf({ ...BOLT, back_face: { ...back, rules_text: "Draw a card." } })).not.toBe(withBack);
    expect(importFingerprintOf({ ...BOLT, back_face: { ...back, art_url: "https://x/y.png" } })).not.toBe(withBack);
  });

  it("is a SHA-256 of the canonical text", () => {
    expect(base).toBe(`v1:${createHash("sha256").update(importFingerprintText(BOLT), "utf8").digest("hex")}`);
  });
});

describe("fingerprintMatches / importEditStateOf", () => {
  const fingerprint = importFingerprintOf(BOLT);

  it("unchanged while the card prints what it printed", () => {
    expect(fingerprintMatches(BOLT, fingerprint)).toBe(true);
    expect(importEditStateOf({ ...BOLT, import_scryfall_id: "x", import_fingerprint: fingerprint })).toBe("unchanged");
  });

  it("edited once a printed field moves", () => {
    expect(importEditStateOf({ ...BOLT, rules_text: "Deal 4.", import_scryfall_id: "x", import_fingerprint: fingerprint })).toBe("edited");
  });

  it("edited from the start when the import was saved with no fingerprint", () => {
    expect(importEditStateOf({ ...BOLT, import_scryfall_id: "x", import_fingerprint: null })).toBe("edited");
  });

  it("untracked with no import source (from scratch, a remix, before 0144, or a database without the columns)", () => {
    expect(importEditStateOf({ ...BOLT })).toBe("untracked");
    expect(importEditStateOf({ ...BOLT, import_scryfall_id: null, import_fingerprint: null })).toBe("untracked");
  });

  it("never matches a version it doesn't know or a malformed value", () => {
    const hex = fingerprint.slice(3);
    expect(fingerprintMatches(BOLT, `v2:${hex}`)).toBe(false);
    expect(fingerprintMatches(BOLT, hex)).toBe(false);
    expect(fingerprintMatches(BOLT, `v1:${hex.toUpperCase()}`)).toBe(false);
    expect(fingerprintMatches(BOLT, null)).toBe(false);
  });
});
