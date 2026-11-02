import { describe, expect, it } from "vitest";
import {
  deckDetailsPatch,
  deckDetailsValuesOf,
  formatHasBracket,
  type DeckDetailsOpened,
} from "@/lib/decks/deck-details";
import { bracketFormatError, createDeckSchema, updateDeckSchema } from "@/lib/validation/deck";

// ---------------------------------------------------------------------------
// The deck details dialog (TODO DK5.14): the deck type and bracket are
// editable, validated by the schema both sides share (0083's CHECKs: type
// ≤ 60 characters, bracket 1–5 — plus the app's rules: a type from the list,
// a bracket only on a Commander deck), and an edit sends ONLY the fields the
// maker changed.
// ---------------------------------------------------------------------------

const OPENED: DeckDetailsOpened = {
  title: "Cinderwing Dragonstorm",
  description: "Dragons, ramp, and one very angry matriarch.",
  cover_url: null,
  cover_position: null,
  format: "commander",
  visibility: "public",
  deck_type: "dragons",
  bracket: 3,
};

describe("formatHasBracket", () => {
  it("is Commander's alone", () => {
    expect(formatHasBracket("commander")).toBe(true);
    for (const format of ["modern", "brawl", "oathbreaker", "casual", "limited"]) {
      expect(formatHasBracket(format)).toBe(false);
    }
  });
});

describe("deckDetailsPatch — only what changed", () => {
  it("an untouched dialog sends nothing", () => {
    expect(deckDetailsPatch(OPENED, deckDetailsValuesOf(OPENED))).toEqual({});
  });

  it("an untouched deck type the list doesn't know is never sent", () => {
    const opened = { ...OPENED, deck_type: "Dragons" };
    const values = { ...deckDetailsValuesOf(opened), title: "Renamed" };
    expect(deckDetailsPatch(opened, values)).toEqual({ title: "Renamed" });
  });

  it("the deck type and bracket travel when changed, as a key and a number", () => {
    const values = { ...deckDetailsValuesOf(OPENED), deck_type: "goblins", bracket: "5" };
    expect(deckDetailsPatch(OPENED, values)).toEqual({ deck_type: "goblins", bracket: 5 });
  });

  it("clearing them sends null", () => {
    const values = { ...deckDetailsValuesOf(OPENED), deck_type: "", bracket: "" };
    expect(deckDetailsPatch(OPENED, values)).toEqual({ deck_type: null, bracket: null });
  });

  it("a bracket on a format without one is not sent — the stored one stays", () => {
    const values = { ...deckDetailsValuesOf(OPENED), format: "modern" as const, bracket: "1" };
    expect(deckDetailsPatch(OPENED, values)).toEqual({ format: "modern" });
  });

  it("an emptied description is null; a trimmed title equal to the stored one is unchanged", () => {
    const values = { ...deckDetailsValuesOf(OPENED), title: "  Cinderwing Dragonstorm ", description: "   " };
    expect(deckDetailsPatch(OPENED, values)).toEqual({ description: null });
  });

  it("the cover's focal point is sent only when it moved, and cleared with the cover", () => {
    const withCover = { ...OPENED, cover_url: "https://x.supabase.co/a.webp", cover_position: { focalX: 0.5, focalY: 0.2 } };
    const same = deckDetailsValuesOf(withCover);
    expect(deckDetailsPatch(withCover, { ...same, cover_position: { focalX: 0.5, focalY: 0.2 } })).toEqual({});
    expect(deckDetailsPatch(withCover, { ...same, cover_position: { focalX: 0.1, focalY: 0.2 } })).toEqual({
      cover_position: { focalX: 0.1, focalY: 0.2 },
    });
    expect(deckDetailsPatch(withCover, { ...same, cover_url: "" })).toEqual({ cover_url: null, cover_position: null });
  });

  it("visibility and format alone", () => {
    const values = { ...deckDetailsValuesOf(OPENED), visibility: "unlisted" as const };
    expect(deckDetailsPatch(OPENED, values)).toEqual({ visibility: "unlisted" });
  });
});

describe("the deck schemas: deck type and bracket", () => {
  it("a deck type is a key from the list, ≤ 60 characters, or null", () => {
    expect(updateDeckSchema.safeParse({ deck_type: "goblins" }).success).toBe(true);
    expect(updateDeckSchema.safeParse({ deck_type: null }).success).toBe(true);
    const unknown = updateDeckSchema.safeParse({ deck_type: "Dragons" });
    expect(unknown.success).toBe(false);
    expect(unknown.error?.issues[0]?.path).toEqual(["deck_type"]);
    expect(updateDeckSchema.safeParse({ deck_type: "x".repeat(61) }).success).toBe(false);
  });

  it("a bracket is a whole number 1–5, or null", () => {
    for (const bracket of [1, 5, "3", null]) {
      expect(updateDeckSchema.safeParse({ bracket }).success).toBe(true);
    }
    for (const bracket of [0, 6, 2.5, "x"]) {
      expect(updateDeckSchema.safeParse({ bracket }).success).toBe(false);
    }
  });

  it("a bracket only on a Commander deck — when the edit names the format", () => {
    const refused = updateDeckSchema.safeParse({ format: "modern", bracket: 2 });
    expect(refused.success).toBe(false);
    expect(refused.error?.issues[0]).toMatchObject({ path: ["bracket"], message: "Only a Commander deck has a bracket." });
    expect(updateDeckSchema.safeParse({ format: "modern", bracket: null }).success).toBe(true);
    expect(updateDeckSchema.safeParse({ format: "commander", bracket: 2 }).success).toBe(true);
    // No format named: the action checks against the stored one.
    expect(updateDeckSchema.safeParse({ bracket: 2 }).success).toBe(true);
  });

  it("a create holds the same rule (its format defaults to Commander)", () => {
    expect(createDeckSchema.safeParse({ title: "A", bracket: 4 }).success).toBe(true);
    expect(createDeckSchema.safeParse({ title: "A", format: "pauper", bracket: 4 }).success).toBe(false);
  });

  it("bracketFormatError: clearing is always allowed", () => {
    expect(bracketFormatError("modern", null)).toBeNull();
    expect(bracketFormatError("modern", undefined)).toBeNull();
    expect(bracketFormatError("commander", 3)).toBeNull();
    expect(bracketFormatError("standard", 3)).toBe("Only a Commander deck has a bracket.");
  });

  it("a partial update materializes no default (format / visibility stay absent)", () => {
    const parsed = updateDeckSchema.safeParse({ bracket: 2 });
    expect(parsed.success && parsed.data).toEqual({ bracket: 2 });
  });
});
