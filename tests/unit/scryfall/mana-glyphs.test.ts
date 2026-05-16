import { describe, expect, it } from "vitest";
import { tokenize } from "@/components/cards/mana-cost-glyphs";

// ---------------------------------------------------------------------------
// Tests for the mana-cost tokenizer (chunk 02).
//
// Pure-function tests against the same vocabulary the renderer handles:
// solid colors, numerics, X, hybrids, twobrids, Phyrexian, T/Q/S, and
// the fallback path for unknown tokens.
// ---------------------------------------------------------------------------

describe("tokenize", () => {
  it("returns an empty array for an empty cost", () => {
    expect(tokenize("")).toEqual([]);
  });

  it("parses a single solid color", () => {
    expect(tokenize("{R}")).toEqual([
      { kind: "solid", color: "R", label: "R" },
    ]);
  });

  it("parses numeric generic costs", () => {
    expect(tokenize("{2}")).toEqual([
      { kind: "solid", color: "C", label: "2" },
    ]);
    expect(tokenize("{10}")).toEqual([
      { kind: "solid", color: "C", label: "10" },
    ]);
  });

  it("handles X as variable colorless", () => {
    expect(tokenize("{X}")).toEqual([
      { kind: "solid", color: "C", label: "X" },
    ]);
  });

  it("handles explicit C colorless", () => {
    expect(tokenize("{C}")).toEqual([
      { kind: "solid", color: "C", label: "C" },
    ]);
  });

  it("parses tap and untap symbols", () => {
    expect(tokenize("{T}")).toEqual([{ kind: "symbol", symbol: "T" }]);
    expect(tokenize("{Q}")).toEqual([{ kind: "symbol", symbol: "Q" }]);
  });

  it("parses snow", () => {
    expect(tokenize("{S}")).toEqual([{ kind: "symbol", symbol: "S" }]);
  });

  it("parses two-color hybrid", () => {
    expect(tokenize("{W/U}")).toEqual([
      { kind: "hybrid", left: "W", right: "U" },
    ]);
    expect(tokenize("{B/R}")).toEqual([
      { kind: "hybrid", left: "B", right: "R" },
    ]);
  });

  it("parses twobrid (numeric + color)", () => {
    expect(tokenize("{2/W}")).toEqual([
      { kind: "hybrid", left: "C", right: "W", label: "2" },
    ]);
  });

  it("parses Phyrexian tokens", () => {
    expect(tokenize("{R/P}")).toEqual([
      { kind: "phyrexian", color: "R" },
    ]);
    expect(tokenize("{C/P}")).toEqual([
      { kind: "phyrexian", color: "C" },
    ]);
  });

  it("parses multiple tokens in sequence", () => {
    const result = tokenize("{2}{R}{R}");
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ kind: "solid", color: "C", label: "2" });
    expect(result[1]).toEqual({ kind: "solid", color: "R", label: "R" });
    expect(result[2]).toEqual({ kind: "solid", color: "R", label: "R" });
  });

  it("mixes kinds in a single cost", () => {
    const result = tokenize("{T}{2/W}{R/P}{S}");
    expect(result).toHaveLength(4);
    expect(result[0].kind).toBe("symbol");
    expect(result[1].kind).toBe("hybrid");
    expect(result[2].kind).toBe("phyrexian");
    expect(result[3].kind).toBe("symbol");
  });

  it("normalizes inner content to uppercase", () => {
    expect(tokenize("{r}")).toEqual([
      { kind: "solid", color: "R", label: "R" },
    ]);
  });

  it("falls back to colorless gem for unknown tokens", () => {
    const result = tokenize("{ZZ}");
    expect(result).toEqual([{ kind: "solid", color: "C", label: "ZZ" }]);
  });

  it("preserves non-bracketed text fragments", () => {
    const result = tokenize("pay {2} now");
    expect(result.some((t) => t.kind === "text")).toBe(true);
    expect(result.some((t) => t.kind === "solid")).toBe(true);
  });
});
