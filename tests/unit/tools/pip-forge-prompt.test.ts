import { describe, expect, it, vi } from "vitest";

vi.mock("ai", () => ({ generateObject: vi.fn() }));

import { ideaProblem, isManaLookalike, pipPromptProblem, buildGlyphPrompt } from "@/lib/tools/pip-forge/prompt";
import { cardFromAnswer, colourCardProblem } from "@/lib/tools/pip-forge/colour-card";
import { colourCardSchema, type ColourCard } from "@/lib/tools/pip-forge/model";

// ---------------------------------------------------------------------------
// Pip Forge's guards: what is refused BEFORE a credit is reserved (the
// glyph's description and the colour's idea), and what a colour card must
// be to be kept.
// ---------------------------------------------------------------------------

describe("pipPromptProblem", () => {
  it("refuses Magic's own mana symbols — the five motifs alone, or the game named", () => {
    for (const subject of [
      "a sun",
      "A simple white sun icon",
      "skull",
      "a black skull",
      "water drop",
      "a blue droplet",
      "fireball",
      "a tree",
      "the green mana symbol",
      "an MTG mana pip",
      "Phyrexian symbol",
      "a magic the gathering icon",
    ]) {
      expect(isManaLookalike(subject), subject).toBe(true);
      expect(pipPromptProblem(subject), subject).toBe("mana_lookalike");
    }
  });

  it("lets a motif with something of the maker's own through", () => {
    for (const subject of ["a skull wreathed in vines", "a sun with a keyhole", "a tree growing from a book", "a key with an eye in its bow"]) {
      expect(pipPromptProblem(subject), subject).toBeNull();
    }
  });

  it("keeps Set Symbol Studio's rules: length, strong language, hate symbols", () => {
    expect(pipPromptProblem("ab")).toBe("too_short");
    expect(pipPromptProblem("x".repeat(201))).toBe("too_long");
    expect(pipPromptProblem("a swastika")).toBe("hate_symbol");
    expect(pipPromptProblem("a fucking key")).toBe("language");
  });

  it("never asks FLUX for a disc", () => {
    expect(buildGlyphPrompt("a crowned eye")).toMatch(/no circle, badge, coin or disc/);
    expect(buildGlyphPrompt("a crowned eye")).toContain("a crowned eye");
  });
});

describe("ideaProblem", () => {
  it("allows an empty idea and refuses language, hate and length", () => {
    expect(ideaProblem("")).toBeNull();
    expect(ideaProblem("Secrets, memory and the price of a bargain")).toBeNull();
    expect(ideaProblem("x".repeat(301))).toBe("too_long");
    expect(ideaProblem("the shit colour")).toBe("language");
    expect(ideaProblem("the colour of the third reich")).toBe("hate_symbol");
  });
});

const ANSWER = {
  name: "amber",
  epithet: "the colour of memory",
  philosophy: "Amber keeps what others forget. It believes the past is a resource.",
  values: ["Memory", "Patience", "Preservation"],
  keyword: { name: "enshrine", reminder: "(Exile this card. You may cast it from exile later.)" },
  mechanics: [
    { name: "Recursion", text: "Returning cards from the graveyard." },
    { name: "Counters", text: "Time counters that pay off later." },
  ],
  cannot: ["It can't destroy creatures directly.", "It can't draw many cards quickly."],
  basicLand: "Grove",
  sitsBetween: "GW" as const,
  alliesWhy: "Green and White share its patience.",
  enemiesWhy: "Red and Blue want change now.",
  discColor: "#E8C27A",
};

describe("the colour card", () => {
  it("reads a good answer into a stored card and its disc colour", () => {
    const result = cardFromAnswer(ANSWER)!;
    expect(result.disc).toBe("#e8c27a");
    expect(result.card.name).toBe("Amber");
    expect(result.card.keyword).toEqual({ name: "Enshrine", reminder: "Exile this card. You may cast it from exile later." });
    expect(colourCardSchema.safeParse(result.card).success).toBe(true);
    expect(colourCardProblem(result.card)).toBeNull();
  });

  it("refuses a card short of values, mechanics or limits", () => {
    expect(cardFromAnswer({ ...ANSWER, mechanics: ANSWER.mechanics.slice(0, 1) })).toBeNull();
    expect(cardFromAnswer({ ...ANSWER, values: ["Memory"] })).toBeNull();
    expect(cardFromAnswer({ ...ANSWER, cannot: [] })).toBeNull();
  });

  it("keeps no card with strong language, an existing keyword or land type", () => {
    const card = cardFromAnswer(ANSWER)!.card;
    const with_ = (patch: Partial<ColourCard>) => colourCardProblem({ ...card, ...patch });
    expect(with_({ philosophy: "It doesn't give a shit." })).toBe("language");
    expect(with_({ keyword: { name: "Flying", reminder: "x" } })).toMatch(/already a Magic keyword/);
    expect(with_({ basicLand: "Forest" })).toMatch(/already a land type/);
  });

  it("falls back to no disc colour for a colour that isn't one", () => {
    expect(cardFromAnswer({ ...ANSWER, discColor: "amber" })!.disc).toBeNull();
  });
});
