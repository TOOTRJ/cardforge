import { describe, expect, it } from "vitest";
import { cardFormSchema } from "@/lib/creator/form-schema";
import {
  EMPTY_BACK_FACE,
  EMPTY_WATERMARK,
  type FormValues,
} from "@/lib/creator/form-types";
import { DEFAULT_FRAME_TEMPLATE } from "@/types/card";

// ---------------------------------------------------------------------------
// Tests for lib/creator/form-schema.ts — the client-side mirror of the
// server's createCardSchema limits, run through react-hook-form's resolver.
//
// The contract under test is PARITY with what runSubmit actually sends:
// anything the server accepts must pass here (equal-or-looser), and the
// error paths must land on real FormValues field names so the wizard can
// jump to the offending step.
// ---------------------------------------------------------------------------

const UUID = "123e4567-e89b-42d3-a456-426614174000";

function baseValues(overrides: Partial<FormValues> = {}): FormValues {
  return {
    title: "Emberbound Wyrm",
    slug: "emberbound-wyrm",
    game_system_id: UUID,
    template_id: UUID,
    cost: "{2}{R}{R}",
    color_identity: ["red"],
    supertype: "Legendary",
    card_type: "creature",
    subtypes_text: "Dragon, Elder",
    tags_text: "dragons, tribal",
    rarity: "rare",
    rules_text: "Flying, haste.",
    loyalty_abilities: [],
    saga_intro: "",
    saga_chapters: [],
    flavor_text: "Born of cinders.",
    power: "5",
    toughness: "4",
    loyalty: "",
    defense: "",
    artist_credit: "Anya Vale",
    art_url: "https://example.com/art.png",
    art_position: { focalX: 0.5, focalY: 0.5, scale: 1 },
    frame_style: { finish: "regular", template: DEFAULT_FRAME_TEMPLATE },
    visibility: "public",
    has_back_face: false,
    back_face: EMPTY_BACK_FACE,
    back_card_id: "",
    source_scryfall_id: "",
    primary_set_id: "",
    watermark: EMPTY_WATERMARK,
    ...overrides,
  };
}

function firstIssueFor(values: FormValues, field: string) {
  const result = cardFormSchema.safeParse(values);
  if (result.success) return null;
  return (
    result.error.issues.find((issue) => issue.path[0] === field) ?? null
  );
}

describe("cardFormSchema", () => {
  it("accepts a fully filled, valid card", () => {
    expect(cardFormSchema.safeParse(baseValues()).success).toBe(true);
  });

  it("accepts a minimal card (only a title — everything else blank)", () => {
    // Mirrors the server: title is the only required text field.
    const values = baseValues({
      cost: "",
      supertype: "",
      subtypes_text: "",
      tags_text: "",
      rules_text: "",
      flavor_text: "",
      power: "",
      toughness: "",
      artist_credit: "",
      art_url: "",
    });
    expect(cardFormSchema.safeParse(values).success).toBe(true);
  });

  it("rejects a missing title with the server's message", () => {
    const issue = firstIssueFor(baseValues({ title: "   " }), "title");
    expect(issue?.message).toBe("Title is required.");
  });

  it("rejects an overlong title with the server's message", () => {
    const issue = firstIssueFor(
      baseValues({ title: "a".repeat(121) }),
      "title",
    );
    expect(issue?.message).toBe("Title must be 120 characters or fewer.");
  });

  it("rejects rules text over 4000 characters", () => {
    const issue = firstIssueFor(
      baseValues({ rules_text: "a".repeat(4001) }),
      "rules_text",
    );
    expect(issue?.message).toBe("Rules text must be 4000 characters or fewer.");
  });

  it("rejects a subtype over 40 characters", () => {
    const issue = firstIssueFor(
      baseValues({ subtypes_text: `Dragon, ${"x".repeat(41)}` }),
      "subtypes_text",
    );
    expect(issue?.message).toBe("Each subtype must be 40 characters or fewer.");
  });

  it("rejects more than 10 subtypes", () => {
    const issue = firstIssueFor(
      baseValues({
        subtypes_text: Array.from({ length: 11 }, (_, i) => `Sub${i}`).join(
          ", ",
        ),
      }),
      "subtypes_text",
    );
    expect(issue?.message).toBe("A card can have up to 10 subtypes.");
  });

  it("rejects 13 tags", () => {
    const issue = firstIssueFor(
      baseValues({
        tags_text: Array.from({ length: 13 }, (_, i) => `tag${i}`).join(", "),
      }),
      "tags_text",
    );
    expect(issue?.message).toBe("A card can have up to 12 tags.");
  });

  it("accepts 13 raw tags that dedupe to 12 or fewer (server dedupes too)", () => {
    const tags = Array.from({ length: 12 }, (_, i) => `tag${i}`);
    const values = baseValues({
      tags_text: [...tags, "TAG0"].join(", "), // normalizes to a duplicate
    });
    expect(cardFormSchema.safeParse(values).success).toBe(true);
  });

  it("rejects a tag over 30 characters instead of silently dropping it", () => {
    const issue = firstIssueFor(
      baseValues({ tags_text: `dragons, ${"x".repeat(31)}` }),
      "tags_text",
    );
    expect(issue?.message).toBe("Each tag must be 30 characters or fewer.");
  });

  it("accepts an empty art_url and an https one; rejects unsafe schemes", () => {
    expect(cardFormSchema.safeParse(baseValues({ art_url: "" })).success).toBe(
      true,
    );
    expect(
      cardFormSchema.safeParse(
        baseValues({ art_url: "https://cdn.example.com/a.png" }),
      ).success,
    ).toBe(true);
    const issue = firstIssueFor(
      baseValues({ art_url: "javascript:alert(1)" }),
      "art_url",
    );
    expect(issue).not.toBeNull();
  });

  describe("back face", () => {
    it("ignores back-face fields while the toggle is off (payload is null)", () => {
      const values = baseValues({
        has_back_face: false,
        back_face: { ...EMPTY_BACK_FACE, title: "", rules_text: "a".repeat(5000) },
      });
      expect(cardFormSchema.safeParse(values).success).toBe(true);
    });

    it("requires a back-face title when the toggle is on", () => {
      const values = baseValues({
        has_back_face: true,
        back_face: { ...EMPTY_BACK_FACE, title: "" },
      });
      const result = cardFormSchema.safeParse(values);
      expect(result.success).toBe(false);
      if (!result.success) {
        const issue = result.error.issues.find(
          (i) => i.path[0] === "back_face" && i.path[1] === "title",
        );
        expect(issue?.message).toBe("Title is required.");
      }
    });
  });

  describe("planeswalker loyalty rows", () => {
    const walker = (
      rows: { cost: string; text: string }[],
      overrides: Partial<FormValues> = {},
    ) =>
      baseValues({
        card_type: "planeswalker",
        power: "",
        toughness: "",
        loyalty: "3",
        loyalty_abilities: rows,
        ...overrides,
      });

    it('accepts "+1", "X", and a U+2212 "−3" cost (server-normalized forms)', () => {
      const values = walker([
        { cost: "+1", text: "Draw a card." },
        { cost: "X", text: "Deal X damage to any target." },
        { cost: "−3", text: "Destroy target permanent." },
      ]);
      expect(cardFormSchema.safeParse(values).success).toBe(true);
    });

    it("accepts a blank cost (static ability row)", () => {
      const values = walker([{ cost: "", text: "Static line." }]);
      expect(cardFormSchema.safeParse(values).success).toBe(true);
    });

    it("rejects a malformed cost with the server's message", () => {
      const result = cardFormSchema.safeParse(
        walker([{ cost: "banana", text: "Do a thing." }]),
      );
      expect(result.success).toBe(false);
      if (!result.success) {
        const issue = result.error.issues.find(
          (i) => i.path[0] === "loyalty_abilities" && i.path[2] === "cost",
        );
        expect(issue?.message).toBe(
          "Loyalty cost must look like +1, -3, 0, or X.",
        );
        expect(issue?.path[1]).toBe(0);
      }
    });

    it("ignores rows with empty text (runSubmit filters them out)", () => {
      const values = walker([{ cost: "not-a-cost", text: "   " }]);
      expect(cardFormSchema.safeParse(values).success).toBe(true);
    });

    it("rejects ability text over 600 characters", () => {
      const result = cardFormSchema.safeParse(
        walker([{ cost: "+1", text: "a".repeat(601) }]),
      );
      expect(result.success).toBe(false);
    });

    it("skips the hidden rules_text when rows will be submitted instead", () => {
      // Parity guard: runSubmit replaces rules_text with the serialized rows,
      // so an overlong leftover textarea must not block the save.
      const values = walker([{ cost: "+1", text: "Draw a card." }], {
        rules_text: "a".repeat(5000),
      });
      expect(cardFormSchema.safeParse(values).success).toBe(true);
    });

    it("still validates rules_text when no rows survive", () => {
      const values = walker([], { rules_text: "a".repeat(5000) });
      const issue = firstIssueFor(values, "rules_text");
      expect(issue).not.toBeNull();
    });
  });

  describe("saga chapters", () => {
    const saga = (overrides: Partial<FormValues> = {}) =>
      baseValues({
        card_type: "enchantment",
        frame_style: { finish: "regular", template: "saga" },
        power: "",
        toughness: "",
        saga_chapters: [
          { numerals: [1], text: "Create a token." },
          { numerals: [2, 3], text: "Draw a card." },
        ],
        ...overrides,
      });

    it("accepts a normal saga", () => {
      expect(cardFormSchema.safeParse(saga()).success).toBe(true);
    });

    it("rejects chapter text over 600 characters", () => {
      const result = cardFormSchema.safeParse(
        saga({ saga_chapters: [{ numerals: [1], text: "a".repeat(601) }] }),
      );
      expect(result.success).toBe(false);
    });

    it("rejects an intro over 400 characters when chapters exist", () => {
      const issue = firstIssueFor(
        saga({ saga_intro: "a".repeat(401) }),
        "saga_intro",
      );
      expect(issue).not.toBeNull();
    });

    it("ignores the intro when no chapters survive (intro isn't submitted)", () => {
      const values = saga({
        saga_chapters: [],
        saga_intro: "a".repeat(401),
        rules_text: "Plain rules.",
      });
      expect(cardFormSchema.safeParse(values).success).toBe(true);
    });
  });
});
