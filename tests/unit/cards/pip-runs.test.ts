import { describe, expect, it } from "vitest";
import {
  canonicalPipCode,
  joinPipRuns,
  pipSuffixForCode,
  splitPipRuns,
} from "@/lib/cards/pip-runs";

// ---------------------------------------------------------------------------
// splitPipRuns backs both the read-only InlinePips renderer and the creator's
// PipTextEditor: text must survive verbatim (whitespace included) and only
// codes the mana font can draw become pips.
// ---------------------------------------------------------------------------

describe("splitPipRuns", () => {
  it("keeps prose verbatim around pips", () => {
    expect(splitPipRuns("{T}: Add {G}. Draw a card.")).toEqual([
      { kind: "pip", code: "{T}", suffix: "tap" },
      { kind: "text", value: ": Add " },
      { kind: "pip", code: "{G}", suffix: "g" },
      { kind: "text", value: ". Draw a card." },
    ]);
  });

  it("canonicalises lowercase codes but preserves their length", () => {
    const runs = splitPipRuns("pay {b}{w/u}{2/r}{g/p}");
    expect(runs.filter((r) => r.kind === "pip").map((r) => (r.kind === "pip" ? r.code : ""))).toEqual([
      "{B}",
      "{W/U}",
      "{2/R}",
      "{G/P}",
    ]);
    expect(joinPipRuns(runs)).toHaveLength("pay {b}{w/u}{2/r}{g/p}".length);
  });

  it("leaves unknown or malformed codes as literal text", () => {
    expect(splitPipRuns("{foo} {W/U/B} { W } {}")).toEqual([
      { kind: "text", value: "{foo} {W/U/B} { W } {}" },
    ]);
  });

  it("keeps newlines inside text runs", () => {
    expect(splitPipRuns("Flying\n{T}: Draw.")).toEqual([
      { kind: "text", value: "Flying\n" },
      { kind: "pip", code: "{T}", suffix: "tap" },
      { kind: "text", value: ": Draw." },
    ]);
  });

  it("round-trips through joinPipRuns", () => {
    const src = "{2}{U}{U}: Counter target spell.\n({T}: Add {C}.)";
    expect(joinPipRuns(splitPipRuns(src))).toBe(src);
  });

  it("returns nothing for empty text", () => {
    expect(splitPipRuns("")).toEqual([]);
  });
});

describe("canonicalPipCode / pipSuffixForCode", () => {
  it("accepts the full mana-font vocabulary", () => {
    for (const inner of ["0", "12", "X", "W", "C", "T", "Q", "S", "E", "W/U", "2/G", "C/P"]) {
      const code = canonicalPipCode(inner.toLowerCase());
      expect(code, inner).toBe(`{${inner}}`);
      expect(pipSuffixForCode(code!), inner).toBeTruthy();
    }
  });

  it("rejects codes the font cannot draw", () => {
    for (const inner of ["", "foo", "W/U/B", "3/W", "P", "123", "W P"]) {
      expect(canonicalPipCode(inner), inner).toBeNull();
    }
  });
});
