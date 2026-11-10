import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CUSTOM_SYMBOLS_SLUG,
  LIVE_SYMBOL_CAP,
  SYMBOL_ROW_CAP,
  normalizeSymbolCode,
  symbolCodesIn,
  symbolDetailsSchema,
  symbolEditSchema,
  symbolMeaningLabel,
  symbolToken,
} from "@/lib/symbols/symbols";
import { toolBySlug } from "@/lib/tools/catalog";
import { tokenize } from "@/components/cards/mana-cost-glyphs";
import { manaValueOfCost } from "@/lib/cards/mana-value";
import { printTypography } from "@/lib/validation/print-typography";

// ---------------------------------------------------------------------------
// New mana symbols (0193): the code rules, the {*CODE} syntax, the forms'
// schemas, and the caps held to the migration's trigger.
// ---------------------------------------------------------------------------

describe("codes", () => {
  it("normalises what a maker types", () => {
    expect(normalizeSymbolCode("abc")).toBe("ABC");
    expect(normalizeSymbolCode(" *Ab1 ")).toBe("AB1");
    expect(normalizeSymbolCode("{*q}")).toBe("Q");
    expect(normalizeSymbolCode("ZZZZZZ")).toBe("ZZZZZZ");
  });

  it("refuses anything else", () => {
    for (const bad of ["", "1A", "ABCDEFG", "A-B", "A B", "*", "{*}", "É", 42, null]) {
      expect(normalizeSymbolCode(bad), String(bad)).toBeNull();
    }
  });

  it("reads every code a text names, once, case-insensitively", () => {
    expect(symbolCodesIn("{*abc}: Add {*ABC}{*Q2}. {*toolong7} {*} {W}")).toEqual(["ABC", "Q2"]);
    expect(symbolCodesIn(null)).toEqual([]);
    expect(symbolToken("ABC")).toBe("{*ABC}");
  });
});

describe("`*` is free in every parser today", () => {
  it("the cost tokenizer reads a {*CODE} as one unknown symbol, never a known one", () => {
    const [token] = tokenize("{*ABC}");
    expect(token).toEqual({ kind: "solid", color: "C", label: "*A" });
  });

  it("mana value counts it as nothing (PR 3 gives it the declared value)", () => {
    expect(manaValueOfCost("{2}{*ABC}")).toBe(2);
  });

  it("print typography never touches it, in rules or flavour", () => {
    const text = "{T}: Add {*ABC}. Pay {*q2} — or don't.";
    expect(printTypography(text, "rules")).toContain("{*ABC}");
    expect(printTypography(text, "rules")).toContain("{*q2}");
    expect(printTypography("{*ABC} at the start", "rules")).toBe("{*ABC} at the start");
  });
});

describe("the forms' schemas", () => {
  it("parses a new symbol", () => {
    expect(symbolDetailsSchema.parse({ code: "*ab", name: "  Aether  bloom ", manaValue: "2", baseColor: "U" })).toEqual({
      code: "AB",
      name: "Aether bloom",
      manaValue: 2,
      baseColor: "U",
    });
  });

  it("reads colourless as no base colour", () => {
    for (const baseColor of ["", "C", null]) {
      expect(symbolDetailsSchema.parse({ code: "A", name: "x", manaValue: 0, baseColor }).baseColor).toBeNull();
    }
  });

  it("refuses a bad mana value, colour, name or code", () => {
    const base = { code: "A", name: "x", manaValue: 1, baseColor: "" };
    expect(symbolDetailsSchema.safeParse({ ...base, manaValue: 1.5 }).success).toBe(false);
    expect(symbolDetailsSchema.safeParse({ ...base, manaValue: -1 }).success).toBe(false);
    expect(symbolDetailsSchema.safeParse({ ...base, manaValue: 21 }).success).toBe(false);
    expect(symbolDetailsSchema.safeParse({ ...base, baseColor: "X" }).success).toBe(false);
    expect(symbolDetailsSchema.safeParse({ ...base, name: "   " }).success).toBe(false);
    expect(symbolDetailsSchema.safeParse({ ...base, name: "x".repeat(41) }).success).toBe(false);
    expect(symbolDetailsSchema.safeParse({ ...base, code: "9" }).success).toBe(false);
  });

  it("an edit never carries a code", () => {
    const parsed = symbolEditSchema.parse({
      id: "0f1e2d3c-4b5a-4968-8776-655443322110",
      code: "NEW",
      name: "x",
      manaValue: 3,
      baseColor: "G",
    });
    expect(parsed).not.toHaveProperty("code");
  });

  it("says what a symbol means", () => {
    expect(symbolMeaningLabel({ manaValue: 2, baseColor: "U" })).toBe("Mana value 2 · Blue");
    expect(symbolMeaningLabel({ manaValue: 0, baseColor: null })).toBe("Mana value 0 · Colorless");
  });
});

describe("the catalog and the migration agree", () => {
  const dir = join(process.cwd(), "supabase/migrations");
  const file = readdirSync(dir).find((f) => /^\d{4}_custom_symbols\.sql$/.test(f)) ?? "";
  const sql = file ? readFileSync(join(dir, file), "utf8") : "";

  it("the tool is built under its slug", () => {
    expect(toolBySlug(CUSTOM_SYMBOLS_SLUG)?.built).toBe(true);
  });

  it("holds the same caps as the trigger", () => {
    expect(sql).toContain(`v_live >= ${LIVE_SYMBOL_CAP}`);
    expect(sql).toContain(`v_rows >= ${SYMBOL_ROW_CAP}`);
  });

  it("holds the same code rule as the table's CHECK", () => {
    expect(sql).toContain("check (code ~ '^[A-Z][A-Z0-9]{0,5}$')");
  });
});
