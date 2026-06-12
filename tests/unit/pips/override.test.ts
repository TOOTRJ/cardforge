import { describe, expect, it } from "vitest";
import { tokenize } from "@/components/cards/mana-cost-glyphs";
import {
  CUSTOM_PIP_SYMBOLS,
  isCustomPipSymbol,
  pipOverrideForSuffix,
  pipOverrideForToken,
  type PipOverrides,
} from "@/lib/pips/override";

// ---------------------------------------------------------------------------
// Custom pip override resolution — which cost tokens swap to the owner's
// uploaded icon, and (just as important) which ones never do.
// ---------------------------------------------------------------------------

const OVERRIDES: PipOverrides = {
  R: "https://cdn.example/custom-r.png?v=1",
  C: "https://cdn.example/custom-c.png?v=1",
};

function tokensFor(cost: string) {
  return tokenize(cost);
}

describe("isCustomPipSymbol", () => {
  it("accepts exactly the six core symbols", () => {
    for (const s of CUSTOM_PIP_SYMBOLS) expect(isCustomPipSymbol(s)).toBe(true);
    for (const s of ["X", "T", "P", "2", "", "r", "w/u"]) {
      expect(isCustomPipSymbol(s)).toBe(false);
    }
  });
});

describe("pipOverrideForToken", () => {
  it("matches a pure color pip with an override", () => {
    const [token] = tokensFor("{R}");
    expect(pipOverrideForToken(token, OVERRIDES)).toBe(OVERRIDES.R);
  });

  it("matches {C} (colorless is a real core symbol)", () => {
    const [token] = tokensFor("{C}");
    expect(pipOverrideForToken(token, OVERRIDES)).toBe(OVERRIDES.C);
  });

  it("returns null for colors without an override", () => {
    const [token] = tokensFor("{U}");
    expect(pipOverrideForToken(token, OVERRIDES)).toBeNull();
  });

  it("never matches generic numbers, even though they tokenize as solid C", () => {
    for (const cost of ["{0}", "{3}", "{20}"]) {
      const [token] = tokensFor(cost);
      expect(pipOverrideForToken(token, OVERRIDES)).toBeNull();
    }
  });

  it("never matches X/Y/Z variables", () => {
    for (const cost of ["{X}", "{Y}", "{Z}"]) {
      const [token] = tokensFor(cost);
      expect(pipOverrideForToken(token, OVERRIDES)).toBeNull();
    }
  });

  it("never matches hybrids, twobrids, or phyrexians (v1 scope)", () => {
    for (const cost of ["{R/G}", "{2/R}", "{R/P}", "{C/P}"]) {
      const [token] = tokensFor(cost);
      expect(pipOverrideForToken(token, OVERRIDES)).toBeNull();
    }
  });

  it("never matches tap/untap/snow/energy", () => {
    for (const cost of ["{T}", "{Q}", "{S}", "{E}"]) {
      const [token] = tokensFor(cost);
      expect(pipOverrideForToken(token, OVERRIDES)).toBeNull();
    }
  });

  it("never matches the unknown-token fallback", () => {
    const [token] = tokensFor("{WTF}");
    expect(pipOverrideForToken(token, OVERRIDES)).toBeNull();
  });

  it("handles a full cost string, overriding only the matching pips", () => {
    const tokens = tokensFor("{2}{R}{R}{R/G}{T}");
    const urls = tokens.map((t) => pipOverrideForToken(t, OVERRIDES));
    expect(urls).toEqual([null, OVERRIDES.R, OVERRIDES.R, null, null]);
  });

  it("is null-safe on missing override maps", () => {
    const [token] = tokensFor("{R}");
    expect(pipOverrideForToken(token, null)).toBeNull();
    expect(pipOverrideForToken(token, undefined)).toBeNull();
    expect(pipOverrideForToken(token, {})).toBeNull();
  });
});

describe("pipOverrideForSuffix (inline rules-text pips)", () => {
  it("matches core solid suffixes", () => {
    expect(pipOverrideForSuffix("r", OVERRIDES)).toBe(OVERRIDES.R);
    expect(pipOverrideForSuffix("c", OVERRIDES)).toBe(OVERRIDES.C);
    expect(pipOverrideForSuffix("u", OVERRIDES)).toBeNull();
  });

  it("never matches hybrids, twobrids, phyrexians, digits, or utility suffixes", () => {
    for (const s of ["wu", "2w", "rp", "cp", "0", "3", "20", "x", "tap", "untap", "s", "e"]) {
      expect(pipOverrideForSuffix(s, OVERRIDES)).toBeNull();
    }
  });

  it("is null-safe", () => {
    expect(pipOverrideForSuffix("r", null)).toBeNull();
    expect(pipOverrideForSuffix("r", undefined)).toBeNull();
    expect(pipOverrideForSuffix("r", {})).toBeNull();
  });
});
