import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// THE AI DECK PLAN for a COLOURLESS deck type (Eldrazi).
//
// The plan's concept call asked the model for 1–3 of WUBRG while the prompt
// said "colourless — generic costs only": an honest answer (no colours)
// failed the whole plan ("response did not match schema"), an obedient one
// invented colours the user never asked for and every card slot was hinted
// into them. A colourless deck type now asks for no colours at all and
// hints every slot "colorless" — the card's own colourless identity.
//
// Every OTHER request is pinned to origin/main byte for byte
// (`fixtures/deck-plan-main.json`, recorded by this file on main's lib/):
// the concept call (system, prompt, the schema as the SDK sends it), what
// the card designer is handed (slots + context), the deck createDeckAction
// is asked for and the job row stored. Planning charges nothing (the jobs
// route pre-checks the balance; steps charge) — so a failed plan has
// nothing to refund, as on main.
//
// `DECK_PLAN_UPDATE=1` rewrites the fixture — only with the reason in the PR.
// Stubbed: Supabase, the deck actions/queries, the model (`ai`
// generateObject — the answer is checked against the schema the call sent
// and, failing it, run through the call's own repair, as the SDK does) and
// the card designer (captured). No generation is run.
// ---------------------------------------------------------------------------

const USER = "11111111-1111-4111-8111-111111111111";

const s = vi.hoisted(() => ({
  concepts: [] as unknown[],
  calls: [] as Array<{ system: string; prompt: string; schema: unknown; ok: boolean }>,
  designs: [] as unknown[],
  createdDecks: [] as Record<string, unknown>[],
  inserted: [] as Record<string, unknown>[],
  deck: null as Record<string, unknown> | null,
  items: [] as unknown[],
}));

vi.mock("@/lib/supabase/server", () => ({
  getCurrentUser: async () => ({ id: USER }),
  getCurrentProfile: async () => ({ display_name: "Tester", username: "tester", is_admin: false }),
  createClient: async () => ({
    from: (table: string) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        limit: () => chain,
        insert: (row: Record<string, unknown>) => {
          s.inserted.push(row);
          return { select: () => ({ single: async () => ({ data: { id: "job-1", ...row }, error: null }) }) };
        },
        maybeSingle: async () => ({ data: table === "decks" ? s.deck : null, error: null }),
      };
      return chain;
    },
  }),
}));
vi.mock("@/lib/decks/actions", () => ({
  createDeckAction: async (payload: Record<string, unknown>) => {
    s.createdDecks.push(payload);
    return { ok: true, deckId: "deck-1", slug: "made-deck" };
  },
  updateDeckAction: async () => ({ ok: true }),
}));
vi.mock("@/lib/decks/queries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/decks/queries")>()),
  listDeckCards: async () => s.items,
}));
vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    generateObject: async (args: {
      system: string;
      prompt: string;
      schema: { safeParse: (v: unknown) => { success: boolean; data?: unknown } };
      experimental_repairText?: (input: { text: string; error: unknown }) => Promise<string | null>;
    }) => {
      const answer = s.concepts.shift();
      const parsed = args.schema.safeParse(answer);
      s.calls.push({
        system: args.system,
        prompt: args.prompt,
        schema: await actual.zodSchema(args.schema as never).jsonSchema,
        ok: parsed.success,
      });
      if (parsed.success) return { object: parsed.data };
      // What the SDK does with an answer outside the schema: the call's
      // repair (#565's repairStructuredText), validated again with the same
      // schema, else NoObjectGeneratedError (structuredCall asks once more).
      const repaired = await args.experimental_repairText?.({ text: JSON.stringify(answer ?? null), error: null });
      if (repaired != null) {
        const again = args.schema.safeParse(JSON.parse(repaired));
        if (again.success) return { object: again.data };
      }
      throw Object.assign(new Error("No object generated: response did not match schema."), { name: "AI_NoObjectGeneratedError" });
    },
  };
});
vi.mock("@/lib/ai/provider", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/provider")>()),
  designModel: () => "test/design",
  judgeModel: () => "test/judge",
}));
vi.mock("@/lib/ai/card-design", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/card-design")>();
  return {
    ...actual,
    designCards: async (input: { slots: Array<{ colorHint?: string | null; cardType?: string }> }) => {
      s.designs.push(input);
      return {
        cards: input.slots.map((slot, index) => ({
          title: `Designed Card ${index + 1}`,
          cost: slot.cardType === "land" ? "—" : "{3}",
          card_type: slot.cardType ?? "artifact",
          supertype: null,
          subtypes: [],
          rarity: "rare",
          color_identity: [slot.colorHint ?? "colorless"],
          rules_text: "Text.",
          flavor_text: null,
          power: slot.cardType === "creature" ? "2" : null,
          toughness: slot.cardType === "creature" ? "2" : null,
          loyalty: null,
          defense: null,
          art_prompt: "A scene.",
          tags: [],
        })),
        report: { warnings: [], judged: false, autofixed: [] },
      };
    },
  };
});

import { createDeckGenerationJob } from "@/lib/ai/generation-jobs";
import { AI_OUTPUT_ERROR_MESSAGE } from "@/lib/ai/structured-output";

const FIXTURE = join(process.cwd(), "tests/unit/ai/fixtures/deck-plan-main.json");
const UPDATE = process.env.DECK_PLAN_UPDATE === "1";
const recorded: Record<string, unknown> = existsSync(FIXTURE)
  ? (JSON.parse(readFileSync(FIXTURE, "utf8")) as Record<string, unknown>)
  : {};
const fresh: Record<string, unknown> = {};

function pinned(name: string, value: unknown) {
  const wire = JSON.parse(JSON.stringify(value)) as unknown;
  fresh[name] = wire;
  if (UPDATE) return;
  expect(recorded, `no record for "${name}" — run with DECK_PLAN_UPDATE=1 on main's lib/`).toHaveProperty([name]);
  expect(wire, name).toEqual(recorded[name]);
  expect(JSON.stringify(wire), name).toBe(JSON.stringify(recorded[name]));
}

afterAll(() => {
  if (UPDATE) writeFileSync(FIXTURE, `${JSON.stringify(fresh, null, 2)}\n`);
});

const concept = (colors: string[] | undefined) => ({
  deck_title: "Hollow Tide",
  deck_description: "Swarm the board and win wide.",
  strategy: "Go wide, then win.",
  ...(colors ? { colors } : {}),
});

const EXISTING_DECK = (deckType: string | null) => ({
  id: "deck-9",
  slug: "old-deck",
  title: "Old Deck",
  description: "Already here.",
  format: "commander",
  cover_url: "https://example.com/cover.png",
  owner_id: USER,
  deck_type: deckType,
  bracket: 2,
});
const EXISTING_ITEMS = [
  { entry: { board: "commander", name: "Leader", type_line: "Legendary Creature — Knight" }, card: null },
  { entry: { board: "main", name: "Squire", type_line: "Creature — Knight" }, card: null },
];

beforeEach(() => {
  s.concepts = [];
  s.calls = [];
  s.designs = [];
  s.createdDecks = [];
  s.inserted = [];
  s.deck = null;
  s.items = [];
  vi.restoreAllMocks();
  vi.spyOn(Math, "random").mockReturnValue(0);
});

async function plan(input: Parameters<typeof createDeckGenerationJob>[0]) {
  const result = await createDeckGenerationJob(input);
  return {
    result: result.ok ? { ok: true, deckSlug: result.deckSlug } : result,
    concept: s.calls,
    designed: s.designs,
    deck: s.createdDecks,
    job: s.inserted,
  };
}

/** Coloured requests — and one with no type at all — are main's, byte for byte. */
const COLOURED: Record<string, { input: Parameters<typeof createDeckGenerationJob>[0]; colors: string[]; existing?: string | null }> = {
  "commander · gorgons (B/G) · bracket 3 · 12": {
    input: { theme: "petrified gardens", style: "oil painting", format: "commander", size: 12, deckType: "gorgons", bracket: 3 },
    colors: ["black", "green"],
  },
  "commander · slivers (five colours) · 12": {
    input: { theme: "", format: "commander", size: 12, deckType: "slivers" },
    colors: ["white", "blue", "black"],
  },
  "standard · no deck type · 12": {
    input: { theme: "sky pirates", format: "standard", size: 12 },
    colors: ["blue", "red"],
  },
  "limited · aggro (R) · 6": {
    input: { theme: "goblin raid", style: "ink", format: "limited", size: 6, deckType: "aggro" },
    colors: ["red"],
  },
  "add mode · knights deck · 6": {
    input: { theme: "", format: "commander", size: 6, deckId: "deck-9" },
    colors: ["white", "black"],
    existing: "knights",
  },
  "add mode · deck with no type · 6": {
    input: { theme: "more", format: "commander", size: 6, deckId: "deck-9" },
    colors: ["green"],
    existing: null,
  },
};

describe("a coloured deck plan is main's", () => {
  it.each(Object.keys(COLOURED))("%s", async (name) => {
    const { input, colors, existing } = COLOURED[name]!;
    if (existing !== undefined) {
      s.deck = EXISTING_DECK(existing);
      s.items = EXISTING_ITEMS;
    }
    s.concepts = [concept(colors)];
    pinned(`plan · ${name}`, await plan(input));
  });

  it("still refuses a coloured answer with no colours, as main does", async () => {
    // No repair can add a colour: asked once more (structuredCall), then the
    // plain AiOutputError — no deck, no job, nothing charged.
    s.concepts = [concept([]), concept([])];
    const out = await plan({ theme: "", format: "commander", size: 12, deckType: "gorgons" });
    expect(out.result).toEqual({ ok: false, error: AI_OUTPUT_ERROR_MESSAGE });
    expect(out.concept).toHaveLength(2);
    expect(out.deck).toEqual([]);
    expect(out.job).toEqual([]);
  });

  it("still cuts more than three colours to the first three, as main does (#565's repair)", async () => {
    s.concepts = [concept(["white", "blue", "black", "red"])];
    const out = await plan({ theme: "", format: "commander", size: 12, deckType: "slivers" });
    expect(out.result.ok).toBe(true);
    const design = out.designed[0] as { slots: Array<{ colorHint?: string }> };
    expect(new Set(design.slots.map((slot) => slot.colorHint))).toEqual(new Set(["multicolor", "white", "blue", "black"]));
  });
});

describe("a colourless deck plan (Eldrazi)", () => {
  it("is valid with no colours, and every card slot is hinted colourless", async () => {
    s.concepts = [concept(undefined)];
    const out = await plan({ theme: "void titans", format: "commander", size: 12, deckType: "eldrazi", bracket: 2 });
    expect(out.result).toEqual({ ok: true, deckSlug: "made-deck" });

    // The model is not asked for colours, and is told why.
    const call = out.concept[0]!;
    expect(call.ok).toBe(true);
    expect(JSON.stringify(call.schema)).not.toContain("colors");
    expect(call.system).not.toMatch(/1-3 colors/);
    expect(call.system).toMatch(/COLORLESS deck/);
    expect(call.prompt).toContain("The deck's colour identity MUST be colourless (colourless — generic costs only).");

    // Every slot — commander and lands too — is the card's colourless identity.
    const design = out.designed[0] as { slots: Array<{ colorHint?: string; cardType?: string; note?: string }>; context: string };
    expect(design.slots).toHaveLength(12);
    expect(design.slots.every((slot) => slot.colorHint === "colorless")).toBe(true);
    expect(design.slots[0]!.note).toMatch(/COMMANDER/);
    const lands = design.slots.filter((slot) => slot.cardType === "land");
    expect(lands).toHaveLength(2);
    for (const land of lands) expect(land.note).not.toMatch(/deck's colors/);

    // The deck and the job are what any other plan stores: nothing new.
    expect(out.deck).toEqual([
      { title: "Hollow Tide", description: "Swarm the board and win wide.", format: "commander", visibility: "public", deck_type: "eldrazi", bracket: 2 },
    ]);
    expect(Object.keys(out.job[0]!)).toEqual(["owner_id", "kind", "status", "request", "plan", "steps", "deck_id"]);
    const stored = out.job[0]!.plan as Record<string, unknown>;
    expect(Object.keys(stored)).toEqual(["deck_title", "strategy", "theme", "style", "format", "cards", "roles", "quantities"]);
    const cards = stored.cards as Array<{ color_identity: string[] }>;
    expect(cards.every((card) => card.color_identity.join() === "colorless")).toBe(true);
  });

  it.each([[["black"]], [[]]])("never takes colours from the model — a stray `colors` (%j) is dropped, never planned in", async (colors) => {
    // Main took ["black"] and hinted every slot black. The colourless schema
    // is a closed object without the field (the provider holds the model to
    // it); an answer that carries one anyway loses it to #565's repair (an
    // unknown key is dropped) and the plan is colourless.
    s.concepts = [concept(colors)];
    const out = await plan({ theme: "", format: "standard", size: 12, deckType: "eldrazi" });
    expect(out.result).toEqual({ ok: true, deckSlug: "made-deck" });
    expect(out.concept).toHaveLength(1);
    expect(out.concept[0]!.schema).toMatchObject({ additionalProperties: false });
    const design = out.designed[0] as { slots: Array<{ colorHint?: string }> };
    expect(design.slots.every((slot) => slot.colorHint === "colorless")).toBe(true);
  });

  it("adding cards to an Eldrazi deck plans colourless too", async () => {
    s.deck = EXISTING_DECK("eldrazi");
    s.items = EXISTING_ITEMS;
    s.concepts = [concept(undefined)];
    const out = await plan({ theme: "", format: "commander", size: 6, deckId: "deck-9" });
    expect(out.result).toEqual({ ok: true, deckSlug: "old-deck" });
    expect(out.deck).toEqual([]);
    const design = out.designed[0] as { slots: Array<{ colorHint?: string; note?: string }> };
    expect(design.slots.every((slot) => slot.colorHint === "colorless")).toBe(true);
    // The deck already has its commander: none is designed.
    expect(design.slots.some((slot) => /COMMANDER/.test(slot.note ?? ""))).toBe(false);
  });
});
