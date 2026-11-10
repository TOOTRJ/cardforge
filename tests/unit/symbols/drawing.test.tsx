import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ManaCostGlyphs, offCardSuffix, tokenSuffix, tokenize } from "@/components/cards/mana-cost-glyphs";
import { MANA_GEM_BG, drawsManaGem, manaGemSpec } from "@/lib/cards/mana-gem";
import { tokenizeRulesText } from "@/lib/cards/rules-text";
import { symbolStyle } from "@/lib/cards/symbol-style";
import { pipOverrideForSuffix, pipOverrideForToken, pipOverridesNamedIn } from "@/lib/pips/override";
import { undrawableSymbols } from "@/lib/validation/card-glyphs";
import { cardNamesSymbol } from "@/lib/symbols/rebake";
import {
  customSymbolCodeOfSuffix,
  customSymbolCodesIn,
  customSymbolKey,
  customSymbolSuffix,
  hasCustomSymbol,
} from "@/lib/symbols/symbol-token";

// ---------------------------------------------------------------------------
// The owner's own symbols as the renderers read them (layout v76): ONE
// syntax, `{*CODE}` exactly, through the cost tokenizer, the rules tokenizer,
// the pip map's `*CODE` keys and the pip description — the picture, else the
// placeholder disc. tests/unit/render/custom-symbols-bake.test.tsx holds the
// bake's pixels; tests/parity holds the preview to it.
// ---------------------------------------------------------------------------

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: () => undefined }));
vi.mock("@/lib/cards/bake-render", () => ({ bakeAndPersistCardRender: async () => undefined }));

const SYMBOLS = symbolStyle(undefined);
const PIC = "https://example.test/sym.png";

describe("the syntax", () => {
  it("reads {*CODE} exactly, any case, as the owner's symbol", () => {
    expect(tokenize("{2}{*abc}{*Q1}")).toEqual([
      { kind: "solid", color: "C", label: "2" },
      { kind: "custom", code: "ABC" },
      { kind: "custom", code: "Q1" },
    ]);
    const [token] = tokenize("{*abc}");
    expect(tokenSuffix(token)).toBe("*abc");
    expect(offCardSuffix(token)).toBe("*abc");
    expect(customSymbolSuffix("ABC")).toBe("*abc");
    expect(customSymbolCodeOfSuffix("*abc")).toBe("ABC");
    expect(customSymbolKey("abc")).toBe("*ABC");
  });

  it("anything else stays what it always was — never a symbol", () => {
    for (const text of ["{* abc}", "{ *abc }", "{*}", "{*1A}", "{*ABCDEFG}", "{*A-B}"]) {
      expect(tokenize(text)[0].kind, text).not.toBe("custom");
      expect(hasCustomSymbol(text), text).toBe(false);
    }
    for (const suffix of ["w", "tap", "2w", "*", "*1a", "*abcdefg"]) expect(customSymbolCodeOfSuffix(suffix), suffix).toBeNull();
    // …nor through its suffix: an unknown `*…` never carries a code (the
    // rules text finds a pip's picture by its suffix).
    for (const text of ["{* abc}", "{ *abc }", "{*ABCDEFG}", "{*A-B}"]) {
      const suffix = tokenSuffix(tokenize(text)[0]) ?? "";
      expect(customSymbolCodeOfSuffix(suffix), text).toBeNull();
      expect(pipOverrideForSuffix(suffix, { "*A": PIC, "*ABC": PIC }), text).toBeNull();
      expect(drawsManaGem(suffix, SYMBOLS), text).toBe(false);
    }
  });

  it("the card scope and the tokenizer agree on every shape", () => {
    for (const text of ["{*abc}", "{*ABC}", "x{*Z9}y", "{*a}{*b}"]) {
      expect(hasCustomSymbol(text), text).toBe(true);
      expect(tokenize(text).some((t) => t.kind === "custom"), text).toBe(true);
    }
    expect(customSymbolCodesIn("{*a}{*A}{*b2}")).toEqual(["A", "B2"]);
  });

  it("the rules tokenizer carries it as a pip, glued to its punctuation", () => {
    const [line] = tokenizeRulesText("{*abc}, {T}: Add {*ABC}.");
    expect(line[0]).toEqual({ t: "m", suffix: "*abc" });
    const add = line.findIndex((item) => item.t === "w" && item.v === "Add");
    expect(line[add + 1]).toEqual({ t: "m", suffix: "*abc" });
    expect(line[add + 2]).toEqual({ t: "w", v: ".", tight: true });
  });
});

describe("what it draws", () => {
  it("the owner's picture by its `*CODE` key, in a cost and in rules text", () => {
    const map = { W: "w.png", "*ABC": PIC };
    expect(pipOverrideForToken({ kind: "custom", code: "ABC" }, map)).toBe(PIC);
    expect(pipOverrideForSuffix("*abc", map)).toBe(PIC);
    expect(pipOverrideForToken({ kind: "custom", code: "ZZZ" }, map)).toBeNull();
    expect(pipOverrideForSuffix("*zzz", map)).toBeNull();
    // The six keep their own.
    expect(pipOverrideForSuffix("w", map)).toBe("w.png");
  });

  it("without one, the placeholder: a plain colourless disc at a plain pip's size, on every style", () => {
    for (const style of ["modern", "1997", "2003", "original"] as const) {
      const spec = symbolStyle(style);
      expect(drawsManaGem("*abc", spec), style).toBe(true);
      expect(manaGemSpec("*abc", 70, spec), style).toEqual({ kind: "blank", suffix: "*abc", discPx: 70, bg: MANA_GEM_BG.c });
    }
  });

  it("is never named as a symbol the card leaves out", () => {
    expect(undrawableSymbols("{*ABC} and {*zzz}", { symbols: SYMBOLS, overrides: { "*ABC": PIC } })).toEqual([]);
    expect(undrawableSymbols("{*ABCDEFG}")).toEqual(["{*ABCDEFG}"]);
  });

  it("the preview: the picture where there is one, the bake's placeholder disc where there is none", () => {
    const disc = { size: "4cqw", gap: "0.5cqw", px: 70 };
    const pictured = renderToStaticMarkup(<ManaCostGlyphs cost="{*abc}" disc={disc} overrides={{ "*ABC": PIC }} />);
    expect(pictured).toContain(`src="${PIC}"`);
    const placeholder = renderToStaticMarkup(<ManaCostGlyphs cost="{*abc}" disc={disc} overrides={{}} />);
    expect(placeholder).toContain('data-pip="*abc"');
    expect(placeholder).toContain(`background-color:${MANA_GEM_BG.c}`);
    expect(placeholder).not.toContain("<img");
    // Off a card (the card page's text block, the pickers): the picture, or
    // mana-font's plain disc with no symbol class.
    expect(renderToStaticMarkup(<ManaCostGlyphs cost="{*abc}" overrides={{ "*ABC": PIC }} />)).toContain(`src="${PIC}"`);
    const off = renderToStaticMarkup(<ManaCostGlyphs cost="{*abc}" />);
    expect(off).toMatch(/class="ms ms-cost[^"]*"/);
    expect(off).not.toContain("ms-*");
  });
});

describe("only the symbols a card names", () => {
  it("keeps the six and the named codes; drops the rest of the set", () => {
    const map = { W: "w.png", "*ABC": PIC, "*ZZZ": "z.png" };
    expect(pipOverridesNamedIn(map, '{"cost":"{1}{*abc}"}')).toEqual({ W: "w.png", "*ABC": PIC });
    expect(pipOverridesNamedIn(map, "nothing")).toEqual({ W: "w.png" });
    expect(pipOverridesNamedIn(null, "{*abc}")).toBeNull();
  });

  it("a card names a code in its cost, rules, rows or back face — what the re-bake reads", () => {
    expect(cardNamesSymbol({ cost: "{*abc}" }, "ABC")).toBe(true);
    expect(cardNamesSymbol({ rules_text: "Add {*ABC}." }, "abc")).toBe(true);
    expect(cardNamesSymbol({ face_content: { saga: { chapters: [{ text: "{*ABC}" }] } } }, "ABC")).toBe(true);
    expect(cardNamesSymbol({ back_face: { cost: "{*ABC}" } }, "ABC")).toBe(true);
    expect(cardNamesSymbol({ cost: "{*ABCD}", rules_text: "{*AB}" }, "ABC")).toBe(false);
  });
});

describe("the owner's map (lib/pips/queries.ts)", () => {
  const reads = vi.hoisted(() => ({ pips: [] as unknown[], symbols: [] as unknown[], symbolsError: null as unknown }));
  vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => true }));
  vi.mock("@/lib/supabase/server", () => ({
    createClient: async () => ({
      from: (table: string) => ({
        select: () => ({
          eq: async () =>
            table === "custom_pips"
              ? { data: reads.pips, error: null }
              : { data: reads.symbolsError ? null : reads.symbols, error: reads.symbolsError },
        }),
      }),
    }),
  }));
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
  const OWNER = "11111111-1111-4111-8111-111111111111";
  const own = (name: string) => `http://127.0.0.1:54321/storage/v1/object/public/custom-pips/${OWNER}/${name}`;

  beforeEach(() => {
    reads.pips = [{ symbol: "G", image_url: own("G.png?v=1") }];
    reads.symbols = [
      { code: "ABC", image_url: own("sym-33333333-3333-4333-8333-333333333333.png?v=2") },
      { code: "OUT", image_url: "https://evil.test/x.png" },
    ];
    reads.symbolsError = null;
  });

  it("holds the six and every symbol of the owner's, removed ones too, under `*CODE` — the owner's own files only", async () => {
    const { getPipOverrides } = await import("@/lib/pips/queries");
    expect(await getPipOverrides(OWNER)).toEqual({
      G: own("G.png?v=1"),
      "*ABC": own("sym-33333333-3333-4333-8333-333333333333.png?v=2"),
    });
  });

  it("a failed symbols read leaves them out, never the six", async () => {
    reads.symbolsError = { message: 'relation "custom_symbols" does not exist' };
    const { getPipOverrides } = await import("@/lib/pips/queries");
    expect(await getPipOverrides(`${OWNER.slice(0, -1)}2`)).toEqual({});
    expect(await getPipOverrides(OWNER)).toMatchObject({ G: own("G.png?v=1") });
  });
});
