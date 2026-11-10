import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// New pips PR 6 — the AI designer and the maker's OWN mana symbols
// (lib/ai/own-symbols.ts). The engine with the model mocked: what the
// designer and the judge are told, what the lint accepts, and what a code
// the designer wasn't given becomes before any save. A maker without
// symbols gets main's prompt (job-payloads-pinned.test.ts holds the saved
// payloads).
// ---------------------------------------------------------------------------

type Call = { system: string; prompt: string; model: string };
const s = vi.hoisted(() => ({
  calls: [] as { system: string; prompt: string; model: string }[],
  answers: [] as (unknown[] | null)[],
  tool: { allowed: true } as null | { allowed: boolean },
  toolThrows: false,
  symbols: [] as unknown[],
}));

vi.mock("ai", () => ({
  generateObject: async (args: Call) => {
    s.calls.push(args);
    const cards = s.answers.shift();
    if (cards === null) throw new Error("model unavailable");
    return { object: { cards: cards ?? [] } };
  },
}));
vi.mock("@/lib/ai/provider", () => ({ designModel: () => "test/design", judgeModel: () => "test/judge" }));
vi.mock("@/lib/tools/queries", () => ({
  getViewerTool: async () => {
    if (s.toolThrows) throw new Error("boom");
    return s.tool;
  },
}));
vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({
      select: () => ({ eq: () => ({ order: async () => ({ data: s.symbols, error: null }) }) }),
    }),
  }),
}));

import { batchPrompt, designCards } from "@/lib/ai/card-design";
import { autofixCard, lintCardDesign } from "@/lib/ai/mtg-rules";
import { designSymbolMeanings, ownSymbolPromptLines, withoutUnknownSymbols, type DesignOwnSymbol } from "@/lib/ai/own-symbols";
import { designSymbolsFor } from "@/lib/symbols/queries";

const FIRE: DesignOwnSymbol = { code: "FIRE", name: "Pyre Mark", manaValue: 3, baseColor: "R" };
const BUG: DesignOwnSymbol = { code: "BUG", name: "Swarm", manaValue: 0, baseColor: null };

const design = (over: Record<string, unknown> = {}) => ({
  title: "Emberwake Tyrant",
  cost: "{1}{*FIRE}",
  card_type: "creature",
  supertype: null,
  subtypes: ["Dragon"],
  rarity: "rare",
  color_identity: ["red"],
  rules_text: "Flying",
  flavor_text: null,
  power: "4",
  toughness: "4",
  loyalty: null,
  defense: null,
  art_prompt: "A dragon over a caldera.",
  ...over,
});

beforeEach(() => {
  s.calls = [];
  s.answers = [];
  s.tool = { allowed: true };
  s.toolThrows = false;
  s.symbols = [];
});

describe("what the designer is told", () => {
  it("nothing without symbols — the prompt is main's", () => {
    const input = { slots: [{ cardType: "creature" as const }] };
    expect(ownSymbolPromptLines(undefined)).toEqual([]);
    expect(ownSymbolPromptLines([])).toEqual([]);
    expect(batchPrompt({ ...input, ownSymbols: [] })).toBe(batchPrompt(input));
  });

  it("each live symbol: code, name, mana value and colour", () => {
    const prompt = batchPrompt({ slots: [{}], ownSymbols: [FIRE, BUG] });
    expect(prompt).toContain('- {*FIRE} "Pyre Mark": mana value 3, red.');
    expect(prompt).toContain('- {*BUG} "Swarm": mana value 0, colorless.');
    expect(prompt).toMatch(/MAY use these and no other \{\*…\} symbol/);
  });

  it("the meanings the lint reads", () => {
    expect(designSymbolMeanings([])).toBeNull();
    expect(designSymbolMeanings([FIRE, BUG])).toEqual({ FIRE: { manaValue: 3, baseColor: "R" }, BUG: { manaValue: 0, baseColor: null } });
  });
});

describe("the last-resort replacement", () => {
  const meanings = designSymbolMeanings([FIRE]);

  it("keeps a code it was given, replaces any other — a cost's by one generic, a rules line's by {C}", () => {
    expect(withoutUnknownSymbols({ cost: "{2}{*NOPE}" }, meanings)).toEqual({ cost: "{3}" });
    expect(withoutUnknownSymbols({ cost: "{*NOPE}" }, meanings)).toEqual({ cost: "{1}" });
    expect(withoutUnknownSymbols({ cost: "{1}{*FIRE}{*NOPE}" }, meanings)).toEqual({ cost: "{2}{*FIRE}" });
    expect(withoutUnknownSymbols({ rules_text: "Add {*NOPE}." }, meanings)).toEqual({ rules_text: "Add {C}." });
    expect(withoutUnknownSymbols({ flavor_text: "A {*NOPE} sign." }, meanings)).toEqual({ flavor_text: "A sign." });
  });

  it("reaches a back face and rows, and hands back the same object when nothing changes", () => {
    const card = design({ cost: "{1}{*FIRE}", back_face: { cost: "{*FIRE}", rules_text: "Add {*X}." } });
    const out = withoutUnknownSymbols(card, null) as typeof card & { back_face?: unknown };
    expect(out.cost).toBe("{2}");
    expect(out.back_face).toEqual({ cost: "{1}", rules_text: "Add {C}." });
    const plain = design({ cost: "{1}{R}" });
    expect(withoutUnknownSymbols(plain, null)).toBe(plain);
  });

  it("the autofix counts a symbol's declared colour", () => {
    const fixed = autofixCard(design({ color_identity: ["white"], cost: "{1}{*FIRE}" }) as never, { symbolMeanings: meanings });
    expect((fixed as { color_identity: string[] }).color_identity).toEqual(["red"]);
    expect(lintCardDesign(design() as never, { symbolMeanings: meanings }).errors).toEqual([]);
  });
});

describe("the engine", () => {
  it("a maker with FIRE: the design keeps it, no judge, no fix", async () => {
    s.answers = [[design()]];
    const { cards, report } = await designCards({ slots: [{ cardType: "creature" }], ownSymbols: [FIRE] });
    expect(cards[0].cost).toBe("{1}{*FIRE}");
    expect(report).toMatchObject({ judged: false, autofixed: [] });
    expect(s.calls).toHaveLength(1);
    expect(s.calls[0].prompt).toContain("{*FIRE}");
  });

  it("a code it wasn't given goes to the judge with the list, and is replaced when the judge keeps it", async () => {
    s.answers = [[design({ cost: "{1}{*NOPE}" })], [design({ cost: "{1}{*NOPE}" })]];
    const { cards } = await designCards({ slots: [{ cardType: "creature" }], ownSymbols: [FIRE] });
    expect(s.calls).toHaveLength(2);
    expect(s.calls[1].prompt).toContain('- {*FIRE} "Pyre Mark"');
    expect(s.calls[1].prompt).toContain("{*NOPE} isn't one of the card owner's mana symbols");
    expect(cards[0].cost).toBe("{2}");
    expect(lintCardDesign(cards[0]).errors).toEqual([]);
  });

  it("a maker without symbols: any code is replaced (the save would refuse it after the picture)", async () => {
    s.answers = [[design()], null];
    const { cards } = await designCards({ slots: [{ cardType: "creature" }] });
    expect(s.calls[0].prompt).not.toContain("{*");
    expect(cards[0].cost).toBe("{2}");
  });

  it("the judge's prompt is main's without symbols", async () => {
    s.answers = [[design({ cost: "{1}{R}", power: null })], null];
    await designCards({ slots: [{ cardType: "creature" }] });
    expect(s.calls[1].prompt.startsWith("Card 1: ")).toBe(true);
  });
});

describe("designSymbolsFor", () => {
  const row = (code: string, over: Record<string, unknown> = {}) => ({
    id: `id-${code}`,
    code,
    name: `${code} name`,
    mana_value: 2,
    base_color: "U",
    image_url: `https://auth.pipglyph.com/storage/v1/object/public/custom-pips/11111111-1111-4111-8111-111111111111/sym-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png`,
    source: "upload",
    deleted_at: null,
    created_at: "2026-11-01T00:00:00Z",
    updated_at: "2026-11-01T00:00:00Z",
    ...over,
  });
  const ME = "11111111-1111-4111-8111-111111111111";

  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://auth.pipglyph.com");
  });

  it("the maker's LIVE symbols while the tool is open to them", async () => {
    s.symbols = [row("SEA"), row("OLD", { deleted_at: "2026-11-02T00:00:00Z" })];
    expect(await designSymbolsFor(ME)).toEqual([{ code: "SEA", name: "SEA name", manaValue: 2, baseColor: "U" }]);
  });

  it("none while the tool is closed, or when the read fails", async () => {
    s.symbols = [row("SEA")];
    s.tool = { allowed: false };
    expect(await designSymbolsFor(ME)).toEqual([]);
    s.tool = null;
    expect(await designSymbolsFor(ME)).toEqual([]);
    s.tool = { allowed: true };
    s.toolThrows = true;
    expect(await designSymbolsFor(ME)).toEqual([]);
  });
});

describe("wiring", () => {
  const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

  it("the card job and the three fills read the maker's symbols and pass them only when there are some", () => {
    const jobs = read("lib/ai/generation-jobs.ts");
    expect(jobs.match(/designSymbolsFor\((?:user\.id|userId)\)/g)).toHaveLength(4);
    expect(jobs.match(/\.\.\.\(ownSymbols\.length > 0 \? \{ ownSymbols \} : \{\}\)/g)).toHaveLength(4);
    // The step refuses an unknown code before the paid picture.
    expect(jobs).toMatch(/hasCustomSymbol\(JSON\.stringify\(payload\)\)\) \{\s*const unknown = await unknownSymbolFieldError/);
    expect(read("lib/ai/card-fill.ts")).toContain("...(input.ownSymbols && input.ownSymbols.length > 0 ? { ownSymbols: input.ownSymbols } : {})");
    expect(read("lib/ai/card-design.ts")).toContain("...(options.ownSymbols && options.ownSymbols.length > 0 ? { ownSymbols: options.ownSymbols } : {})");
  });
});
