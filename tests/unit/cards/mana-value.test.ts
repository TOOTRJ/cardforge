import { describe, expect, it } from "vitest";
import { manaValueOfCost, symbolManaValue } from "@/lib/cards/mana-value";

// ---------------------------------------------------------------------------
// lib/cards/mana-value.ts — a cost's mana value as the rules count it
// (CR 202.3). The deck analytics' own parser counted every hybrid,
// Phyrexian and snow pip as 0 (deck audit 2026-10-28, L1).
// ---------------------------------------------------------------------------

describe("symbolManaValue", () => {
  it("generic, coloured, colourless and snow pips", () => {
    expect(symbolManaValue("0")).toBe(0);
    expect(symbolManaValue("3")).toBe(3);
    expect(symbolManaValue("15")).toBe(15);
    for (const pip of ["W", "U", "B", "R", "G", "C"]) expect(symbolManaValue(pip)).toBe(1);
    expect(symbolManaValue("S")).toBe(1);
    expect(symbolManaValue("w")).toBe(1);
  });

  it("X, Y and Z are 0", () => {
    expect(symbolManaValue("X")).toBe(0);
    expect(symbolManaValue("Y")).toBe(0);
    expect(symbolManaValue("Z")).toBe(0);
  });

  it("a hybrid symbol counts its largest part", () => {
    expect(symbolManaValue("W/U")).toBe(1);
    expect(symbolManaValue("C/W")).toBe(1);
    expect(symbolManaValue("2/W")).toBe(2);
  });

  it("a Phyrexian symbol is one mana, two-colour or not", () => {
    expect(symbolManaValue("W/P")).toBe(1);
    expect(symbolManaValue("G/U/P")).toBe(1);
  });

  it("half mana is a half; symbols that are not mana are 0", () => {
    expect(symbolManaValue("HR")).toBe(0.5);
    expect(symbolManaValue("½")).toBe(0.5);
    for (const other of ["T", "Q", "E", "CHAOS", "P", "A", "W/Q"]) expect(symbolManaValue(other)).toBe(0);
  });
});

describe("manaValueOfCost", () => {
  it("sums every symbol", () => {
    expect(manaValueOfCost("{2}{W}{W}")).toBe(4);
    expect(manaValueOfCost("{W/U}{W/U}")).toBe(2);
    expect(manaValueOfCost("{2/W}{2/W}{2/W}")).toBe(6);
    expect(manaValueOfCost("{1}{W/P}{W/P}")).toBe(3);
    expect(manaValueOfCost("{G/U/P}")).toBe(1);
    expect(manaValueOfCost("{S}{S}{1}")).toBe(3);
    expect(manaValueOfCost("{X}{X}{R}")).toBe(1);
  });

  it("a split cost sums both halves", () => {
    expect(manaValueOfCost("{1}{R} // {2}{U}")).toBe(5);
  });

  it("a bare number is read; text without a symbol is no cost", () => {
    expect(manaValueOfCost("3")).toBe(3);
    expect(manaValueOfCost("—")).toBeNull();
    expect(manaValueOfCost("")).toBeNull();
    expect(manaValueOfCost(null)).toBeNull();
    expect(manaValueOfCost(undefined)).toBeNull();
  });

  it("a cost of symbols that are not mana is 0, not unreadable", () => {
    expect(manaValueOfCost("{T}")).toBe(0);
  });
});
