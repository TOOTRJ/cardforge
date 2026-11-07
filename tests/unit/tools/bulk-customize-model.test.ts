import { describe, expect, it } from "vitest";
import {
  BULK_EXACT_COPY_REASON,
  BULK_CUSTOMIZE_MAX_CARDS,
  DEFAULT_BULK_CHOICES,
  bulkChoicesSchema,
  bulkCostLine,
  bulkSourceKey,
  bulkSourcesSchema,
  choicesChangeSomething,
  printingCustomizeHref,
} from "@/lib/tools/bulk-customize/model";

// ---------------------------------------------------------------------------
// Bulk Customize's choices and words (lib/tools/bulk-customize/model.ts):
// the cost line said before anything is made, the exact-copy rule at the
// batch's door, and the strict shapes the server parses.
// ---------------------------------------------------------------------------

describe("bulkCostLine", () => {
  it("says the cards, the slots left after and the credits", () => {
    expect(bulkCostLine({ creates: 24, slotsLeftAfter: 31, credits: 0 })).toBe("Creates 24 cards · 31 slots left · 0 credits");
    expect(bulkCostLine({ creates: 1, slotsLeftAfter: 1, credits: 1 })).toBe("Creates 1 card · 1 slot left · 1 credit");
  });

  it("says nothing about slots on a plan with no card limit, and never a negative", () => {
    expect(bulkCostLine({ creates: 3, slotsLeftAfter: null, credits: 6 })).toBe("Creates 3 cards · 6 credits");
    expect(bulkCostLine({ creates: 5, slotsLeftAfter: -2, credits: 0 })).toBe("Creates 5 cards · 0 slots left · 0 credits");
  });
});

describe("choicesChangeSomething", () => {
  it("the default choices change nothing — every card would be the real card", () => {
    expect(choicesChangeSomething(DEFAULT_BULK_CHOICES)).toBe(false);
    expect(choicesChangeSomething({ ...DEFAULT_BULK_CHOICES, art: "later" })).toBe(false);
    expect(choicesChangeSomething({ ...DEFAULT_BULK_CHOICES, visibility: "private" })).toBe(false);
    expect(BULK_EXACT_COPY_REASON).toMatch(/aren't saved as your own/);
  });

  it("any look, border, symbol, watermark or AI art is a change", () => {
    expect(choicesChangeSomething({ ...DEFAULT_BULK_CHOICES, look: "borderless" })).toBe(true);
    expect(choicesChangeSomething({ ...DEFAULT_BULK_CHOICES, border: "white" })).toBe(true);
    expect(choicesChangeSomething({ ...DEFAULT_BULK_CHOICES, setSymbol: "printing" })).toBe(true);
    expect(choicesChangeSomething({ ...DEFAULT_BULK_CHOICES, watermark: "none" })).toBe(true);
    expect(choicesChangeSomething({ ...DEFAULT_BULK_CHOICES, art: "ai" })).toBe(true);
  });
});

describe("the shapes", () => {
  it("choices are strict: no unknown key, no unknown style", () => {
    expect(bulkChoicesSchema.safeParse(DEFAULT_BULK_CHOICES).success).toBe(true);
    expect(bulkChoicesSchema.safeParse({ ...DEFAULT_BULK_CHOICES, template: "m15" }).success).toBe(false);
    expect(bulkChoicesSchema.safeParse({ ...DEFAULT_BULK_CHOICES, artStyle: "photo of a real artist" }).success).toBe(false);
  });

  it("sources: 1 to the batch limit, ids of the right shape", () => {
    const id = "00000000-0000-4000-8000-000000000001";
    expect(bulkSourcesSchema.safeParse([]).success).toBe(false);
    expect(bulkSourcesSchema.safeParse([{ kind: "deck_entry", id }]).success).toBe(true);
    expect(bulkSourcesSchema.safeParse([{ kind: "deck_entry", id: "nope" }]).success).toBe(false);
    expect(bulkSourcesSchema.safeParse([{ kind: "cards", id }]).success).toBe(false);
    const many = Array.from({ length: BULK_CUSTOMIZE_MAX_CARDS + 1 }, () => ({ kind: "scryfall", id }));
    expect(bulkSourcesSchema.safeParse(many).success).toBe(false);
    expect(bulkSourceKey({ kind: "scryfall", id: id.toUpperCase() })).toBe(`scryfall:${id}`);
  });

  it("one card goes to the creator on its printing", () => {
    expect(printingCustomizeHref("abc")).toBe("/create?printing=abc");
    expect(printingCustomizeHref("abc", "row-1")).toBe("/create?printing=abc&collectionRow=row-1");
  });
});
