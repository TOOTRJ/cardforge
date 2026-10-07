import { describe, expect, it } from "vitest";
import { tokenTypeLineChanged, type ScopeCard } from "@/lib/cards/layout-version";
import { buildTypeLine, printsPowerToughness } from "@/lib/cards/card-display";
import type { CardType } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 3b.15's card scope for the release's layout bump (the integrator wires
// tokenTypeLineChanged into VERSION_SCOPES with the one shared version): a
// card is re-baked exactly when the token wording changes its bake.
//
// Checked against real bakes on 2026-09-29: the 32 public production tokens
// (anonymous REST; their r5-cached rows identical in supertype, subtypes,
// P/T and template) baked by main (02fe649) and by this branch with 0128's
// word applied — 30 PNGs differ (22 "Basic" tokens: "Basic Token — Wastes"
// → "Token Basic — Wastes"; 8 P/T tokens with no word: "Token — X" → "Token
// Creature — X"), 2 are byte-identical (no word, no P/T: "Token"). PUBLIC
// below is those 32 rows' scope columns (no ids or titles).
// ---------------------------------------------------------------------------

type Cols = [supertype: string | null, subtypes: string[], power: string | null, toughness: string | null];
const basic = (subtype: string): Cols => ["Basic", [subtype], null, null];
const PUBLIC: Array<{ cols: Cols; changed: boolean }> = [
  ...Array.from({ length: 20 }, () => ({ cols: basic("Wastes"), changed: true })),
  ...[basic("Mountain"), basic("Swamp")].map((cols) => ({ cols, changed: true })),
  ...(
    [
      [null, [], "1", "1"],
      [null, ["bokoblin et squelette"], "2", "2"],
      [null, ["lézalfos et squelette"], "1", "1"],
      [null, ["bokoblin et squelette"], "3", "1"],
      [null, ["bokoblin et squelette"], "3", "1"],
      [null, ["Boar"], "0", "3"],
      [null, ["bokoblin et squelette"], "1", "1"],
      [null, [], "1", "1"],
    ] as Cols[]
  ).map((cols) => ({ cols, changed: true })),
  ...([[null, [], null, null], [null, [], null, null]] as Cols[]).map((cols) => ({ cols, changed: false })),
];

function row([supertype, subtypes, power, toughness]: Cols, over: Partial<ScopeCard> = {}): ScopeCard {
  return {
    card_type: "token",
    supertype,
    subtypes,
    power,
    toughness,
    back_face: null,
    frame_style: { template: "m15token" },
    ...over,
  };
}

describe("tokenTypeLineChanged — 3b.15's card scope", () => {
  it("matches the real bakes of the 32 public tokens: 30 changed, 2 identical", () => {
    expect(PUBLIC).toHaveLength(32);
    expect(PUBLIC.filter((r) => tokenTypeLineChanged(row(r.cols))).length).toBe(30);
    for (const { cols, changed } of PUBLIC) expect(tokenTypeLineChanged(row(cols))).toBe(changed);
  });

  it("the unchanged ones print the same line and P/T before and after", () => {
    for (const { cols, changed } of PUBLIC) {
      if (changed) continue;
      const [supertype, subtypes, power, toughness] = cols;
      const face = { cardType: "token" as CardType, supertype, subtypes, power, toughness };
      expect(buildTypeLine(face)).toBe("Token");
      expect(printsPowerToughness(face)).toBe(false);
    }
  });

  it("covers a P/T token before AND after 0128 writes its word", () => {
    expect(tokenTypeLineChanged(row([null, ["Soldier"], "1", "1"]))).toBe(true);
    expect(tokenTypeLineChanged(row(["Creature", ["Soldier"], "1", "1"]))).toBe(true);
  });

  it("covers every token template, and a Treasure's stray P/T", () => {
    for (const template of ["m15tokenartifact", "fullart", "m15textless", "extendedart", "flip"]) {
      expect(tokenTypeLineChanged(row(["Artifact", ["Treasure"], null, null], { frame_style: { template } }))).toBe(true);
    }
    expect(tokenTypeLineChanged(row(["Artifact", ["Treasure"], "1", "1"]))).toBe(true);
  });

  it("covers a blank supertype of spaces: the old line kept them before \"Token\", the new one trims them", () => {
    // Before v34: [supertype, "Token"].filter(Boolean) kept "  " → "   Token
    // — Boar"; now "Token" comes first and the supertype is trimmed.
    expect(buildTypeLine({ cardType: "token", supertype: "  ", subtypes: ["Boar"] })).toBe("Token — Boar");
    expect(tokenTypeLineChanged(row(["  ", ["Boar"], null, null]))).toBe(true);
    const back = { title: "Boar", card_type: "token", supertype: " ", subtypes: ["Boar"] };
    expect(tokenTypeLineChanged(row([null, [], null, null], { card_type: "enchantment", back_face: back }))).toBe(true);
  });

  it("leaves every other card alone", () => {
    expect(tokenTypeLineChanged(row(["Legendary", ["Elf"], "2", "2"], { card_type: "creature" }))).toBe(false);
    expect(tokenTypeLineChanged(row(["Basic", ["Forest"], null, null], { card_type: "land" }))).toBe(false);
  });

  it("covers a back face typed token with a word", () => {
    const back = { title: "Sorcerer", card_type: "token", supertype: "Enchantment", subtypes: ["Aura", "Role"] };
    expect(tokenTypeLineChanged(row([null, [], null, null], { card_type: "enchantment", back_face: back }))).toBe(true);
    expect(
      tokenTypeLineChanged(row([null, [], null, null], { card_type: "enchantment", back_face: { ...back, supertype: "" } })),
    ).toBe(false);
  });

  it("is conservative for a row missing a column it reads", () => {
    expect(tokenTypeLineChanged({ card_type: "creature" })).toBe(true);
    expect(tokenTypeLineChanged({ card_type: "token", supertype: null, power: null, toughness: null })).toBe(true);
  });
});
