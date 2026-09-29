import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// TODO 6.23 on the design engine: emblems stay out of the AI's card types
// until the owner asks. CARD_TYPE_VALUES gained "emblem", and the designer's
// structured output read that list — so a random card, a deck or a batch
// could come back as an emblem (and then fail the save's kind gate on a
// non-emblem frame). The design and judge calls now ask for an emblem only
// when a slot pins one: a per-field fill on an open emblem.
// ---------------------------------------------------------------------------

const s = vi.hoisted(() => ({ calls: [] as Record<string, unknown>[], cards: [] as unknown[] }));

vi.mock("ai", () => ({
  generateObject: async (args: Record<string, unknown>) => {
    s.calls.push(args);
    return { object: { cards: s.cards } };
  },
}));
vi.mock("@/lib/ai/provider", () => ({ designModel: () => "test/design", judgeModel: () => "test/judge" }));

import { designCards } from "@/lib/ai/card-design";

type Schema = { safeParse: (value: unknown) => { success: boolean } };

const card = (over: Record<string, unknown> = {}) => ({
  title: "Kaito, Cunning Infiltrator",
  cost: "—",
  card_type: "emblem",
  supertype: null,
  subtypes: [],
  rarity: "common",
  color_identity: ["colorless"],
  rules_text: "Whenever a player casts a spell, you create a 2/1 blue Ninja creature token.",
  flavor_text: null,
  power: null,
  toughness: null,
  loyalty: null,
  defense: null,
  art_prompt: "A shadowed ninja mid-leap across moonlit rooftops, cool blue palette.",
  ...over,
});

const accepts = (call: Record<string, unknown>, value: unknown) =>
  (call.schema as Schema).safeParse({ cards: [value] }).success;

beforeEach(() => {
  s.calls = [];
  s.cards = [card()];
});

describe("the designer's card types (TODO 6.23)", () => {
  it("a fresh design can't come back as an emblem; every other type still can", async () => {
    s.cards = [card({ card_type: "creature", cost: "{1}{U}", color_identity: ["blue"], power: "2", toughness: "1" })];
    await designCards({ slots: [{}] });
    const design = s.calls[0];
    expect(accepts(design, card())).toBe(false);
    for (const type of ["creature", "token", "planeswalker", "land", "instant"]) {
      expect(accepts(design, card({ card_type: type })), type).toBe(true);
    }
  });

  it("a slot that pins an emblem (a fill on an open emblem) may", async () => {
    await designCards({ slots: [{ cardType: "emblem" }] });
    expect(accepts(s.calls[0], card())).toBe(true);
  });

  it("the judge keeps that rule: an emblem only when one is under repair", async () => {
    // A flawed creature (its cost is no mana cost) goes to the judge.
    s.cards = [card({ card_type: "creature", cost: "{Q}", color_identity: ["blue"], power: "2", toughness: "1" })];
    await designCards({ slots: [{}] });
    expect(s.calls).toHaveLength(2);
    expect(accepts(s.calls[1], card())).toBe(false);

    // A flawed emblem (a mana cost, CR 114) keeps its type through repair.
    s.calls = [];
    s.cards = [card({ cost: "{2}{U}" })];
    await designCards({ slots: [{ cardType: "emblem" }] });
    expect(s.calls).toHaveLength(2);
    expect(accepts(s.calls[1], card())).toBe(true);
  });
});
