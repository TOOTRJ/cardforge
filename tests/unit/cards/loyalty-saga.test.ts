import { describe, expect, it } from "vitest";
import {
  parseLoyaltyAbilities,
  parseSagaIntro,
} from "@/lib/cards/card-display";

describe("parseLoyaltyAbilities", () => {
  it("parses +N / −N / 0 ability lines with normalized ASCII signs", () => {
    const abilities = parseLoyaltyAbilities(
      "+1: Draw a card.\n−3: Destroy target creature.\n0: Discard your hand.\n-8: You get an emblem.",
    );
    expect(abilities.map((a) => a.cost)).toEqual(["+1", "-3", "0", "-8"]);
    expect(abilities[1].text).toBe("Destroy target creature.");
  });

  it("treats lines without a leading cost as static (unbadged) abilities", () => {
    const abilities = parseLoyaltyAbilities(
      "As long as you control a Forest, this has hexproof.\n+2: Add {G}.",
    );
    expect(abilities[0].cost).toBeNull();
    expect(abilities[1].cost).toBe("+2");
  });

  it("supports X costs and returns [] for empty text", () => {
    expect(parseLoyaltyAbilities("-X: Destroy X permanents.")[0].cost).toBe(
      "-X",
    );
    expect(parseLoyaltyAbilities("")).toEqual([]);
    expect(parseLoyaltyAbilities(null)).toEqual([]);
  });
});

describe("parseSagaIntro", () => {
  it("returns the pre-chapter reminder line", () => {
    expect(
      parseSagaIntro(
        "(As this Saga enters, add a lore counter.)\nI — Create a token.\nII — Draw a card.",
      ),
    ).toBe("(As this Saga enters, add a lore counter.)");
  });

  it("returns null when the text starts at chapter I or is empty", () => {
    expect(parseSagaIntro("I — Create a token.")).toBeNull();
    expect(parseSagaIntro("")).toBeNull();
    expect(parseSagaIntro(null)).toBeNull();
  });
});
