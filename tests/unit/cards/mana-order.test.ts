import { describe, expect, it } from "vitest";

import {
  canonicalColorSequence,
  normalizeManaCost,
} from "@/lib/cards/mana-order";
import { deriveColorIdentity } from "@/lib/creator/card-fields";

// ---------------------------------------------------------------------------
// Golden cases verified against real printings via the Scryfall API
// (2026-07-01). Left side is a shuffled/hand-entered cost; right side is
// the cost exactly as printed.
// ---------------------------------------------------------------------------

const GOLDEN: Array<{ name: string; input: string; expected: string }> = [
  // Wheel pairs / shards / wedges
  {
    name: "Nicol Bolas",
    input: "{U}{B}{R}{2}{U}{B}{R}",
    expected: "{2}{U}{U}{B}{B}{R}{R}",
  },
  { name: "Siege Rhino", input: "{B}{G}{W}{1}", expected: "{1}{W}{B}{G}" },
  {
    name: "Zurgo Helmsmasher",
    input: "{W}{B}{2}{R}",
    expected: "{2}{R}{W}{B}",
  },
  {
    name: "Surrak Dragonclaw",
    input: "{R}{U}{G}{2}",
    expected: "{2}{G}{U}{R}",
  },
  {
    name: "Progenitus",
    input: "{G}{W}{U}{B}{R}{G}{W}{U}{B}{R}",
    expected: "{W}{W}{U}{U}{B}{B}{R}{R}{G}{G}",
  },
  // Hybrids: internal pair order + placement after the primary color
  {
    name: "Kitchen Finks",
    input: "{G/W}{1}{W/G}",
    expected: "{1}{G/W}{G/W}",
  },
  { name: "Naya Hushblade", input: "{G}{R/W}", expected: "{R/W}{G}" },
  { name: "Bant Sureblade", input: "{W}{U/G}", expected: "{G/U}{W}" },
  { name: "Esper Stormblade", input: "{U}{B/W}", expected: "{W/B}{U}" },
  {
    name: "Wort, the Raidmother",
    input: "{G/R}{4}{R/G}",
    expected: "{4}{R/G}{R/G}",
  },
  // Hybrid phyrexian sits between its two solid colors
  {
    name: "Tamiyo, Compleated Sage",
    input: "{U}{G/U/P}{G}{2}",
    expected: "{2}{G}{G/U/P}{U}",
  },
  {
    name: "Lukka, Bound to Ruin",
    input: "{G}{R}{2}{G/R/P}",
    expected: "{2}{R}{R/G/P}{G}",
  },
  // Twobrids run WUBRG
  {
    name: "Reaper King",
    input: "{2/G}{2/B}{2/W}{2/R}{2/U}",
    expected: "{2/W}{2/U}{2/B}{2/R}{2/G}",
  },
  // Colorless {C} after generic
  { name: "Spatial Contortion", input: "{C}{1}", expected: "{1}{C}" },
  {
    name: "Kozilek, the Great Distortion",
    input: "{4}{C}{4}{C}",
    expected: "{8}{C}{C}",
  },
  // Variable first
  { name: "X spell", input: "{R}{X}", expected: "{X}{R}" },
  { name: "XX spell", input: "{X}{B}{X}", expected: "{X}{X}{B}" },
  // Snow after generic, before colors
  { name: "snow cost", input: "{S}{1}{U}", expected: "{1}{S}{U}" },
  // Tap/untap and energy trail the mana
  { name: "tap cost", input: "{T}{1}{U}", expected: "{1}{U}{T}" },
  { name: "energy", input: "{E}{R}{E}", expected: "{R}{E}{E}" },
  // Zero handling
  { name: "Ornithopter", input: "{0}", expected: "{0}" },
  { name: "stray zero", input: "{0}{R}", expected: "{R}" },
  // Phyrexian solid sorts as its color
  {
    name: "phyrexian",
    input: "{W/P}{1}{U}",
    expected: "{1}{W/P}{U}",
  },
];

describe("normalizeManaCost golden cases", () => {
  for (const { name, input, expected } of GOLDEN) {
    it(`${name}: ${input} → ${expected}`, () => {
      expect(normalizeManaCost(input)).toBe(expected);
    });
  }

  it("is idempotent across all golden cases", () => {
    for (const { expected } of GOLDEN) {
      expect(normalizeManaCost(expected)).toBe(expected);
    }
  });

  it("preserves color identity across normalization", () => {
    for (const { input } of GOLDEN) {
      const before = [...deriveColorIdentity(input)].sort();
      const after = [...deriveColorIdentity(normalizeManaCost(input))].sort();
      expect(after).toEqual(before);
    }
  });
});

describe("normalizeManaCost bail-outs", () => {
  it("leaves unknown tokens untouched", () => {
    expect(normalizeManaCost("{ABC}{R}")).toBe("{ABC}{R}");
    expect(normalizeManaCost("{W/U/B}")).toBe("{W/U/B}");
    expect(normalizeManaCost("{R/R}")).toBe("{R/R}");
  });

  it("leaves text outside braces untouched", () => {
    expect(normalizeManaCost("2 {R}")).toBe("2 {R}");
    expect(normalizeManaCost("{R} tap")).toBe("{R} tap");
  });

  it("passes empty and brace-less strings through", () => {
    expect(normalizeManaCost("")).toBe("");
    expect(normalizeManaCost("   ")).toBe("   ");
  });

  it("normalizes case and numeric padding", () => {
    // Boros pair order is {R}{W} on real cards.
    expect(normalizeManaCost("{w}{r}")).toBe("{R}{W}");
    expect(normalizeManaCost("{01}{R}")).toBe("{1}{R}");
  });
});

describe("canonicalColorSequence", () => {
  it("resolves pairs, shards, wedges, and four-color sets", () => {
    expect(canonicalColorSequence(["U", "W"])).toBe("WU");
    expect(canonicalColorSequence(["W", "R"])).toBe("RW");
    expect(canonicalColorSequence(["R", "B", "U"])).toBe("UBR");
    expect(canonicalColorSequence(["G", "B", "W"])).toBe("WBG");
    expect(canonicalColorSequence(["G", "R", "U", "B"])).toBe("UBRG");
    expect(canonicalColorSequence(["W", "U", "B", "R", "G"])).toBe("WUBRG");
    expect(canonicalColorSequence([])).toBe("");
  });
});
