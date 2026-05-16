import { describe, expect, it } from "vitest";
import {
  backFaceSchema,
  cardSlugSchema,
  cardTitleSchema,
  createCardSchema,
  frameStyleSchema,
  slugify,
} from "@/lib/validation/card";

// ---------------------------------------------------------------------------
// Tests for lib/validation/card.ts.
//
// The schemas mirror the DB check constraints (see migrations 0003-0016),
// so these tests act as a tripwire — if the schema drifts from the DB,
// at least the slug/title/visibility branches will flag it before
// production data starts rejecting at the Postgres layer.
// ---------------------------------------------------------------------------

describe("slugify", () => {
  it("kebab-cases ordinary titles", () => {
    expect(slugify("Emberbound Wyrm")).toBe("emberbound-wyrm");
  });

  it("strips diacritics so 'café' folds to 'cafe'", () => {
    expect(slugify("Café Noir")).toBe("cafe-noir");
  });

  it("collapses runs of separators", () => {
    expect(slugify("  whirling   blades --- of ___ fate  ")).toBe(
      "whirling-blades-of-fate",
    );
  });

  it("falls back to 'untitled-card' when input has no slug-able chars", () => {
    expect(slugify("???")).toBe("untitled-card");
    expect(slugify("")).toBe("untitled-card");
  });

  it("respects the max-length cap", () => {
    const long = "a".repeat(200);
    expect(slugify(long).length).toBeLessThanOrEqual(80);
  });
});

describe("cardTitleSchema", () => {
  it("accepts a non-empty title", () => {
    expect(cardTitleSchema.parse("Emberbound Wyrm")).toBe("Emberbound Wyrm");
  });

  it("trims surrounding whitespace", () => {
    expect(cardTitleSchema.parse("  Wyrm  ")).toBe("Wyrm");
  });

  it("rejects an empty title", () => {
    expect(() => cardTitleSchema.parse("")).toThrow();
    expect(() => cardTitleSchema.parse("   ")).toThrow();
  });

  it("rejects titles over 120 chars", () => {
    expect(() => cardTitleSchema.parse("a".repeat(121))).toThrow();
  });
});

describe("cardSlugSchema", () => {
  it("accepts lowercase kebab-case", () => {
    expect(cardSlugSchema.parse("emberbound-wyrm")).toBe("emberbound-wyrm");
  });

  it("rejects uppercase", () => {
    expect(() => cardSlugSchema.parse("Emberbound-Wyrm")).toThrow();
  });

  it("rejects leading / trailing hyphens", () => {
    expect(() => cardSlugSchema.parse("-emberbound")).toThrow();
    expect(() => cardSlugSchema.parse("emberbound-")).toThrow();
  });

  it("rejects whitespace and underscores", () => {
    expect(() => cardSlugSchema.parse("ember bound")).toThrow();
    expect(() => cardSlugSchema.parse("ember_bound")).toThrow();
  });
});

describe("frameStyleSchema", () => {
  it("defaults to an empty object when given undefined", () => {
    expect(frameStyleSchema.parse(undefined)).toEqual({});
  });

  it("accepts all four finish values from chunk 03", () => {
    for (const finish of ["regular", "foil", "etched", "borderless", "showcase"] as const) {
      expect(frameStyleSchema.parse({ finish })).toEqual({ finish });
    }
  });

  it("rejects unknown finish values", () => {
    expect(() => frameStyleSchema.parse({ finish: "rainbow" })).toThrow();
  });

  it("rejects unknown keys (strict)", () => {
    expect(() => frameStyleSchema.parse({ wholly: "invented" })).toThrow();
  });
});

describe("backFaceSchema (chunk 10)", () => {
  it("requires a title", () => {
    expect(() => backFaceSchema.parse({})).toThrow();
  });

  it("accepts a minimal back face", () => {
    const parsed = backFaceSchema.parse({ title: "Insectile Aberration" });
    expect(parsed.title).toBe("Insectile Aberration");
  });

  it("validates inner cost format like the front", () => {
    expect(() =>
      backFaceSchema.parse({ title: "Back", cost: "x".repeat(80) }),
    ).toThrow();
  });
});

describe("createCardSchema", () => {
  // A minimal valid payload — all required fields, nothing optional. The
  // UUID is a proper v4 because Zod v4's `.uuid()` enforces the version
  // digit (4 in the third group) rather than just shape.
  const baseValid = {
    title: "Emberbound Wyrm",
    game_system_id: "94c70f23-0ca9-425e-a53a-6c09921c0075",
    color_identity: [],
    subtypes: [],
  };

  it("accepts the minimum required shape", () => {
    expect(() => createCardSchema.parse(baseValid)).not.toThrow();
  });

  it("defaults visibility to 'private'", () => {
    const parsed = createCardSchema.parse(baseValid);
    expect(parsed.visibility).toBe("private");
  });

  it("rejects a non-UUID game_system_id", () => {
    expect(() =>
      createCardSchema.parse({ ...baseValid, game_system_id: "not-a-uuid" }),
    ).toThrow();
  });

  it("threads source_scryfall_id through (chunk 13)", () => {
    const parsed = createCardSchema.parse({
      ...baseValid,
      source_scryfall_id: "94c70f23-0ca9-425e-a53a-6c09921c0075",
    });
    expect(parsed.source_scryfall_id).toBe(
      "94c70f23-0ca9-425e-a53a-6c09921c0075",
    );
  });

  it("treats source_scryfall_id null as 'clear it'", () => {
    const parsed = createCardSchema.parse({
      ...baseValid,
      source_scryfall_id: null,
    });
    expect(parsed.source_scryfall_id).toBeNull();
  });

  it("rejects malformed source_scryfall_id", () => {
    expect(() =>
      createCardSchema.parse({
        ...baseValid,
        source_scryfall_id: "not-a-uuid",
      }),
    ).toThrow();
  });

  it("accepts a back_face payload (chunk 10)", () => {
    const parsed = createCardSchema.parse({
      ...baseValid,
      back_face: { title: "Werewolf Form" },
    });
    expect(parsed.back_face?.title).toBe("Werewolf Form");
  });

  it("treats back_face null as 'clear it'", () => {
    const parsed = createCardSchema.parse({ ...baseValid, back_face: null });
    expect(parsed.back_face).toBeNull();
  });
});
