import { describe, expect, it } from "vitest";
import {
  createDeckSchema,
  updateDeckSchema,
  deckSlugSchema,
} from "@/lib/validation/deck";
import {
  DECK_BOARD_LABELS,
  DECK_BOARD_VALUES,
  DECK_FORMAT_LABELS,
  DECK_FORMAT_VALUES,
  deckEntryState,
  isDeckBoard,
  isDeckFormat,
} from "@/types/deck";

describe("createDeckSchema", () => {
  it("accepts a minimal valid payload and applies defaults", () => {
    const result = createDeckSchema.safeParse({ title: "Atraxa Superfriends" });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.title).toBe("Atraxa Superfriends");
    expect(result.data.format).toBe("commander");
    expect(result.data.visibility).toBe("private");
    expect(result.data.description).toBeUndefined();
    expect(result.data.cover_url).toBeUndefined();
  });

  it("accepts every declared format", () => {
    for (const format of DECK_FORMAT_VALUES) {
      const result = createDeckSchema.safeParse({ title: "Deck", format });
      expect(result.success, `format ${format} should parse`).toBe(true);
    }
  });

  it("rejects an unknown format", () => {
    const result = createDeckSchema.safeParse({
      title: "Deck",
      format: "tiny-leaders",
    });
    expect(result.success).toBe(false);
  });

  it("requires a title and enforces the 120-char DB bound", () => {
    expect(createDeckSchema.safeParse({ title: "" }).success).toBe(false);
    expect(createDeckSchema.safeParse({ title: "   " }).success).toBe(false);
    expect(
      createDeckSchema.safeParse({ title: "a".repeat(121) }).success,
    ).toBe(false);
    expect(
      createDeckSchema.safeParse({ title: "a".repeat(120) }).success,
    ).toBe(true);
  });

  it("enforces the 2000-char description bound and tolerates empty strings", () => {
    expect(
      createDeckSchema.safeParse({ title: "Deck", description: "a".repeat(2001) })
        .success,
    ).toBe(false);
    // The form trims "" to undefined before submit; the schema just needs to
    // not reject it (same posture as the set schemas).
    expect(
      createDeckSchema.safeParse({ title: "Deck", description: "" }).success,
    ).toBe(true);
  });

  it("blocks unsafe cover URL schemes (javascript:, data:, plain http)", () => {
    for (const cover_url of [
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "http://evil.example.com/x.png",
    ]) {
      const result = createDeckSchema.safeParse({ title: "Deck", cover_url });
      expect(result.success, `${cover_url} should be rejected`).toBe(false);
    }
    expect(
      createDeckSchema.safeParse({
        title: "Deck",
        cover_url: "https://cdn.example.com/cover.png",
      }).success,
    ).toBe(true);
  });

  it("rejects unknown visibility values", () => {
    expect(
      createDeckSchema.safeParse({ title: "Deck", visibility: "friends-only" })
        .success,
    ).toBe(false);
  });
});

describe("deckSlugSchema", () => {
  it("matches the DB slug CHECK pattern", () => {
    expect(deckSlugSchema.safeParse("atraxa-superfriends").success).toBe(true);
    expect(deckSlugSchema.safeParse("deck-2").success).toBe(true);
    for (const bad of ["-leading", "trailing-", "UPPER", "two--hyphens", "a b"]) {
      expect(deckSlugSchema.safeParse(bad).success, `${bad} rejected`).toBe(
        false,
      );
    }
    expect(deckSlugSchema.safeParse("a".repeat(81)).success).toBe(false);
  });
});

describe("updateDeckSchema", () => {
  it("allows partial payloads", () => {
    const result = updateDeckSchema.safeParse({ visibility: "public" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.title).toBeUndefined();
  });

  it("still validates provided fields", () => {
    expect(updateDeckSchema.safeParse({ title: "" }).success).toBe(false);
    expect(updateDeckSchema.safeParse({ format: "nope" }).success).toBe(false);
  });
});

describe("deck domain types", () => {
  it("has a label for every format and board", () => {
    for (const format of DECK_FORMAT_VALUES) {
      expect(DECK_FORMAT_LABELS[format]).toBeTruthy();
    }
    for (const board of DECK_BOARD_VALUES) {
      expect(DECK_BOARD_LABELS[board]).toBeTruthy();
    }
  });

  it("narrows formats and boards", () => {
    expect(isDeckFormat("commander")).toBe(true);
    expect(isDeckFormat("edh")).toBe(false);
    expect(isDeckBoard("side")).toBe(true);
    expect(isDeckBoard("sideboard")).toBe(false);
  });

  it("derives entry state from scryfall_id + card_id", () => {
    expect(deckEntryState({ scryfall_id: "abc", card_id: null })).toBe("real");
    expect(deckEntryState({ scryfall_id: "abc", card_id: "def" })).toBe(
      "remixed",
    );
    expect(deckEntryState({ scryfall_id: null, card_id: "def" })).toBe(
      "custom",
    );
    expect(deckEntryState({ scryfall_id: null, card_id: null })).toBe(
      "unresolved",
    );
  });
});
