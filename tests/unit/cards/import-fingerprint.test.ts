import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  fingerprintAfterRewrite,
  fingerprintMatches,
  IMPORT_FINGERPRINT_EXCLUDED,
  IMPORT_FINGERPRINT_FIELDS,
  importEditStateOf,
  importFingerprintOf,
  importFingerprintText,
  sha256Hex,
} from "@/lib/cards/import-fingerprint";

// ---------------------------------------------------------------------------
// The import fingerprint (TODO DK2.5, migration 0144): ONE hash of the card,
// compared row to row. "Edited" = ANY change a maker can make (owner
// 2026-10-29): every column of `cards` is either fingerprinted or named as
// left out, and both lists are pinned here.
// ---------------------------------------------------------------------------

const BOLT = {
  title: "Lightning Bolt",
  nickname: null,
  cost: "{R}",
  color_identity: ["red"],
  supertype: null,
  card_type: "instant",
  subtypes: [] as string[],
  printed_types: null,
  rarity: "common",
  rules_text: "Lightning Bolt deals 3 damage to any target.",
  flavor_text: "The sparkmage shrieked.",
  power: null,
  toughness: null,
  loyalty: null,
  defense: null,
  artist_credit: "Christopher Moeller",
  art_url: "https://example.supabase.co/storage/v1/object/public/card-art/u/bolt.png",
  art_position: { focalX: 0.5, focalY: 0.42, scale: 1 },
  frame_style: { template: "m15", finish: "regular", crown: true, twoColor: true, collector: "2023", star: true },
  face_content: null,
  back_face: null,
  watermark: null,
  footer_text: null,
  set_icon_url: null,
  set_icon_code: null,
  set_code: "M11",
  collector_number: "149",
  lang: "en",
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
  it("is everything a maker can set on the card", () => {
    expect(IMPORT_FINGERPRINT_FIELDS).toEqual([
      "title",
      "nickname",
      "cost",
      "color_identity",
      "supertype",
      "card_type",
      "subtypes",
      "printed_types",
      "rarity",
      "rules_text",
      "flavor_text",
      "power",
      "toughness",
      "loyalty",
      "defense",
      "artist_credit",
      "art_url",
      "art_position",
      "frame_style",
      "face_content",
      "back_face",
      "watermark",
      "footer_text",
      "set_icon_url",
      "set_icon_code",
      "set_code",
      "collector_number",
      "lang",
    ]);
  });

  it("and the two lists name every column of `cards`, once (types/supabase.ts)", () => {
    const types = readFileSync(join(process.cwd(), "types/supabase.ts"), "utf8");
    const start = types.indexOf("      cards: {");
    const row = types.slice(types.indexOf("Row: {", start), types.indexOf("Insert: {", start));
    const columns = [...row.matchAll(/^\s+(\w+): /gm)].map((m) => m[1]!);
    expect(columns.length).toBeGreaterThan(40);
    const named = [...IMPORT_FINGERPRINT_FIELDS, ...IMPORT_FINGERPRINT_EXCLUDED] as string[];
    expect(new Set(named).size).toBe(named.length);
    expect([...columns].sort()).toEqual([...named].sort());
  });

  it("leaves out only what isn't the maker's to set", () => {
    for (const column of ["visibility", "tags", "slug", "owner_id", "rendered_image_url", "layout_version", "likes_count", "updated_at", "source_scryfall_id"]) {
      expect(IMPORT_FINGERPRINT_EXCLUDED).toContain(column);
    }
  });

  it("has the stored format", () => {
    expect(importFingerprintOf(BOLT)).toMatch(/^v1:[0-9a-f]{64}$/);
  });
});

describe("importFingerprintOf", () => {
  const base = importFingerprintOf(BOLT);

  it("is the same for the insert and the row read back (the column defaults, nulls and blanks are one)", () => {
    const insert = { ...BOLT, nickname: undefined, supertype: undefined, power: undefined, subtypes: undefined, lang: undefined, face_content: undefined };
    const row = {
      ...BOLT,
      supertype: "",
      power: null,
      subtypes: [],
      lang: "en",
      // Columns it never reads.
      id: "c",
      visibility: "public",
      tags: ["mine"],
      rendered_image_url: "x",
      updated_at: "2026",
    };
    expect(importFingerprintOf(insert)).toBe(base);
    expect(importFingerprintOf(row)).toBe(base);
    // An empty jsonb object is the column's default: nothing.
    expect(importFingerprintOf({ ...BOLT, watermark: {} })).toBe(base);
  });

  it("ignores key order inside the row and inside every jsonb object", () => {
    const reordered = Object.fromEntries(Object.entries(BOLT).reverse());
    expect(importFingerprintOf(reordered)).toBe(base);
    const frame = Object.fromEntries(Object.entries(BOLT.frame_style).reverse());
    expect(importFingerprintOf({ ...BOLT, frame_style: frame })).toBe(base);
  });

  it.each(IMPORT_FINGERPRINT_FIELDS.map((field) => [field]))("moves when %s changes", (field) => {
    const changed: Record<string, unknown> = {
      color_identity: ["blue"],
      subtypes: ["Arcane"],
      art_position: { focalX: 0.5, focalY: 0.42, scale: 1.2 },
      frame_style: { ...BOLT.frame_style, template: "m15nyx" },
      face_content: { loyalty: [{ cost: "+1", text: "Draw." }] },
      back_face: { title: "Ice", cost: "{1}{U}" },
      watermark: { kind: "mana", key: "r" },
      lang: "ja",
    };
    expect(importFingerprintOf({ ...BOLT, [field]: changed[field] ?? "changed" })).not.toBe(base);
  });

  it.each([
    ["crown", false],
    ["twoColor", false],
    ["collector", "off"],
    ["stamp", "oval"],
    ["border", "white"],
    ["rulesAlign", "center"],
    ["selfName", "literal"],
    ["partColor", true],
    ["finish", "foil"],
  ])("moves with the frame_style switch %s", (key, value) => {
    expect(importFingerprintOf({ ...BOLT, frame_style: { ...BOLT.frame_style, [key]: value } })).not.toBe(base);
  });

  it("moves with the art's crop, zoom or position alone", () => {
    expect(importFingerprintOf({ ...BOLT, art_position: { ...BOLT.art_position, focalX: 0.4 } })).not.toBe(base);
  });

  it("keeps the two empty Types fields and the two empty footers apart (\"\" is a choice, NULL another)", () => {
    expect(importFingerprintOf({ ...BOLT, printed_types: "" })).not.toBe(base);
    expect(importFingerprintOf({ ...BOLT, footer_text: "" })).not.toBe(base);
    expect(importFingerprintOf({ ...BOLT, footer_text: "  " })).toBe(importFingerprintOf({ ...BOLT, footer_text: "" }));
  });

  it("reads the whole second face, key order aside", () => {
    const back = { title: "Ice", cost: "{1}{U}", card_type: "instant", rules_text: "Tap target permanent.", color_identity: ["blue"] };
    const withBack = importFingerprintOf({ ...BOLT, back_face: back });
    expect(withBack).not.toBe(base);
    expect(importFingerprintOf({ ...BOLT, back_face: Object.fromEntries(Object.entries(back).reverse()) })).toBe(withBack);
    expect(importFingerprintOf({ ...BOLT, back_face: { ...back, color_identity: ["red"] } })).not.toBe(withBack);
    expect(importFingerprintOf({ ...BOLT, back_face: { ...back, art_position: { scale: 2 } } })).not.toBe(withBack);
  });

  it("is a SHA-256 of the canonical text", () => {
    expect(base).toBe(`v1:${createHash("sha256").update(importFingerprintText(BOLT), "utf8").digest("hex")}`);
  });
});

describe("fingerprintMatches / importEditStateOf", () => {
  const fingerprint = importFingerprintOf(BOLT);

  it("unchanged while nothing on the card changed", () => {
    expect(fingerprintMatches(BOLT, fingerprint)).toBe(true);
    expect(importEditStateOf({ ...BOLT, import_scryfall_id: "x", import_fingerprint: fingerprint })).toBe("unchanged");
  });

  it("edited once anything moves — the text, the frame, the colour, the rarity or the crop alone", () => {
    for (const change of [
      { rules_text: "Deal 4." },
      { frame_style: { ...BOLT.frame_style, template: "m15borderless" } },
      { color_identity: ["blue"] },
      { rarity: "mythic" },
      { art_position: { ...BOLT.art_position, scale: 1.5 } },
    ]) {
      expect(importEditStateOf({ ...BOLT, ...change, import_scryfall_id: "x", import_fingerprint: fingerprint })).toBe("edited");
    }
  });

  it("not by its visibility or its tags (they aren't the card)", () => {
    expect(
      importEditStateOf({ ...BOLT, visibility: "private", tags: ["x"], import_scryfall_id: "x", import_fingerprint: fingerprint } as never),
    ).toBe("unchanged");
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

describe("fingerprintAfterRewrite (a platform rewrite keeps an untouched import untouched)", () => {
  const fingerprint = importFingerprintOf(BOLT);
  const swept = { ...BOLT, frame_style: { ...BOLT.frame_style, template: "m15ub" } };

  it("an untouched import: the rewritten row's fingerprint — still Imported", () => {
    const next = fingerprintAfterRewrite({ ...BOLT, import_scryfall_id: "x", import_fingerprint: fingerprint }, swept);
    expect(next).toBe(importFingerprintOf(swept));
    expect(importEditStateOf({ ...swept, import_scryfall_id: "x", import_fingerprint: next })).toBe("unchanged");
  });

  it("an edited import keeps its fingerprint (still Edited); an untracked card keeps none", () => {
    const edited = { ...BOLT, rules_text: "Deal 4.", import_scryfall_id: "x", import_fingerprint: fingerprint };
    expect(fingerprintAfterRewrite(edited, { ...edited, frame_style: swept.frame_style })).toBe(fingerprint);
    expect(fingerprintAfterRewrite({ ...BOLT, import_scryfall_id: "x", import_fingerprint: null }, swept)).toBeNull();
    expect(fingerprintAfterRewrite({ ...BOLT }, swept)).toBeNull();
  });
});
