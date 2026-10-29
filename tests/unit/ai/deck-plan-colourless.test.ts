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
// Since the follow-up (owner 2026-10-14) EVERY typed deck is planned that
// way: its colours are its TYPE's, set in code (Gorgons black-green,
// Slivers all five — the coloured schema's cap of 3 built them in three),
// and the model is asked for none. An UNTYPED deck still lets the model
// pick 1–3.
//
// The record (`fixtures/deck-plan-main.json`, recorded by this file on
// #567's main lib/, UNTOUCHED since) pins: the untyped requests byte for
// byte; the typed ones byte for byte minus the colour question (no `colors`
// in the schema, the typed system line — `asTyped`), and Slivers minus the
// colour hints the five colours move. Pinned: the concept call (system,
// prompt, the schema as the SDK sends it), what the card designer is
// handed (slots + context), the deck createDeckAction is asked for and the
// job row stored. Planning charges nothing (the jobs
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
import { aiFailureMessage } from "@/lib/ai/failure";

const FIXTURE = join(process.cwd(), "tests/unit/ai/fixtures/deck-plan-main.json");
const UPDATE = process.env.DECK_PLAN_UPDATE === "1";
const recorded: Record<string, unknown> = existsSync(FIXTURE)
  ? (JSON.parse(readFileSync(FIXTURE, "utf8")) as Record<string, unknown>)
  : {};
const fresh: Record<string, unknown> = {};

/** Main's record as this branch stores it: a new deck job plans NO cover
 *  step since TODO DK6.3 (the deck shows its default background,
 *  lib/decks/cover.ts) — the one step the record held that a job no longer
 *  does. Everything else is main's, byte for byte. */
function withoutCoverStep<T>(record: T): T {
  const out = structuredClone(record) as { job?: Array<{ steps?: Array<{ key: string }> }> };
  for (const row of out.job ?? []) {
    if (row.steps) row.steps = row.steps.filter((step) => step.key !== "cover");
  }
  return out as T;
}

function pinned(name: string, value: unknown) {
  const wire = JSON.parse(JSON.stringify(value)) as unknown;
  fresh[name] = wire;
  if (UPDATE) return;
  expect(recorded, `no record for "${name}" — run with DECK_PLAN_UPDATE=1 on main's lib/`).toHaveProperty([name]);
  const want = withoutCoverStep(recorded[name]);
  expect(wire, name).toEqual(want);
  expect(JSON.stringify(wire), name).toBe(JSON.stringify(want));
}

afterAll(() => {
  // Only the untyped records are re-recorded; the typed ones stay main's.
  if (UPDATE) writeFileSync(FIXTURE, `${JSON.stringify({ ...recorded, ...fresh }, null, 2)}\n`);
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

/** Coloured requests — typed and untyped — recorded on main (`colors` =
 *  what the model answered there). */
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

const UNTYPED = ["standard · no deck type · 12", "add mode · deck with no type · 6"];
const TYPED = Object.keys(COLOURED).filter((name) => !UNTYPED.includes(name));

const TYPED_SYSTEM =
  "You pitch ORIGINAL Magic: The Gathering-style decks for a homebrew tool. Given a theme and format, invent a deck name, a one-sentence pitch and a strategy paragraph (game plan, key mechanics, world/faction names) for a deck in the colors its deck type sets — they are fixed, not yours to pick. Everything must be original — never Wizards-owned proper nouns, never real-world brands.";

/** The commander slot's note as main hands it to the designer. */
const COMMANDER_NOTE_ON_MAIN = "This is the deck's LEGENDARY COMMANDER (supertype Legendary) — the strategy's centerpiece.";

/** What a typed deck's commander note adds: the type's colours, word for
 *  word (an untyped deck's and Eldrazi's notes are main's). */
const COMMANDER_COLOURS_LINE: Record<string, string> = {
  "commander · gorgons (B/G) · bracket 3 · 12":
    "Its color identity is EXACTLY the deck's: black-green (B/G) — mana symbols of each of those 2 colors in its cost or rules text, and of no other color.",
  "commander · slivers (five colours) · 12":
    "Its color identity is EXACTLY the deck's: all five colors (W/U/B/R/G) — mana symbols of each of those 5 colors in its cost or rules text, and of no other color.",
};

type Recorded = {
  concept: Array<{ system: string; prompt: string; schema: { properties: Record<string, unknown>; required: string[] } }>;
  designed: Array<{ slots: Array<{ colorHint?: string }> }>;
  job: Array<{ plan: { cards: Array<{ color_identity: string[] }> } }>;
};

/** Main's record of a TYPED request as this branch sends it: the concept
 *  call asks for no colours (the schema without `colors`, the typed system
 *  line) — nothing else moves while the model's colours were the type's. */
function asTyped(record: unknown, name?: string): Recorded {
  const out = withoutCoverStep(record) as Recorded;
  // The commander slot's note names the type's colours (the #568 follow-up,
  // owner 2026-10-14): "multicolor" alone let the designer make a
  // two-colour commander for the five-colour Slivers.
  const line = name ? COMMANDER_COLOURS_LINE[name] : undefined;
  for (const design of out.designed as Array<{ slots: Array<{ note?: string }> }>) {
    for (const slot of design.slots) {
      if (line && slot.note === COMMANDER_NOTE_ON_MAIN) slot.note = `${slot.note} ${line}`;
    }
  }
  for (const call of out.concept) {
    call.system = TYPED_SYSTEM;
    // Add mode: the strategy alone is inferred from the deck's cards — its
    // colours are its type's (owner 2026-10-14).
    call.prompt = call.prompt.replace("infer the strategy and colors FROM its current cards", "infer the strategy FROM its current cards");
    delete call.schema.properties.colors;
    call.schema.required = call.schema.required.filter((key) => key !== "colors");
  }
  return out;
}

describe("an untyped deck plan is main's", () => {
  it.each(UNTYPED)("%s", async (name) => {
    const { input, colors, existing } = COLOURED[name]!;
    if (existing !== undefined) {
      s.deck = EXISTING_DECK(existing);
      s.items = EXISTING_ITEMS;
    }
    s.concepts = [concept(colors)];
    pinned(`plan · ${name}`, await plan(input));
  });

  it("plans no AI cover step (TODO DK6.3) — main's new decks had one; the guide stays last", async () => {
    s.concepts = [concept(["blue", "red"])];
    const out = await plan(COLOURED["standard · no deck type · 12"]!.input);
    const steps = (out.job[0] as { steps: Array<{ key: string }> }).steps.map((step) => step.key);
    expect(steps).not.toContain("cover");
    expect(steps.at(-1)).toBe("guide");
    expect(steps.filter((key) => key.startsWith("card:"))).toHaveLength(12);
    // Main's record of the same request did plan one.
    const main = recorded["plan · standard · no deck type · 12"] as { job: Array<{ steps: Array<{ key: string }> }> };
    expect(main.job[0]!.steps.map((step) => step.key)).toContain("cover");
  });

  it("still refuses an answer with no colours, as main does", async () => {
    // No repair can add a colour: asked once more (structuredCall), then the
    // plain AiOutputError — no deck, no job, nothing charged.
    s.concepts = [concept([]), concept([])];
    const out = await plan({ theme: "", format: "commander", size: 12 });
    // Since 2026-10-28 the plan names the failure kind (lib/ai/failure.ts).
    expect(out.result).toEqual({ ok: false, error: aiFailureMessage("design_unreadable") });
    expect(out.concept).toHaveLength(2);
    expect(out.deck).toEqual([]);
    expect(out.job).toEqual([]);
  });

  it("still cuts more than three colours to the first three, as main does (#565's repair)", async () => {
    s.concepts = [concept(["white", "blue", "black", "red"])];
    const out = await plan({ theme: "", format: "commander", size: 12 });
    expect(out.result.ok).toBe(true);
    const design = out.designed[0] as { slots: Array<{ colorHint?: string }> };
    expect(new Set(design.slots.map((slot) => slot.colorHint))).toEqual(new Set(["multicolor", "white", "blue", "black"]));
  });
});

describe("a typed deck plan takes its colours from its type (owner 2026-10-14)", () => {
  // The provider holds the model to the closed schema: a typed answer has no
  // `colors`. Main's record, minus the colour question, byte for byte.
  it.each(TYPED.filter((name) => !name.includes("slivers")))("%s — main's, without the colour question", async (name) => {
    const { input, existing } = COLOURED[name]!;
    if (existing !== undefined) {
      s.deck = EXISTING_DECK(existing);
      s.items = EXISTING_ITEMS;
    }
    s.concepts = [concept(undefined)];
    const out = JSON.parse(JSON.stringify(await plan(input))) as unknown;
    const want = asTyped(recorded[`plan · ${name}`], name);
    expect(out).toEqual(want);
    expect(JSON.stringify(out)).toBe(JSON.stringify(want));
  });

  it("Slivers plans all FIVE colours — main built them in three (the cap of 3)", async () => {
    const name = "commander · slivers (five colours) · 12";
    s.concepts = [concept(undefined)];
    const out = JSON.parse(JSON.stringify(await plan(COLOURED[name]!.input))) as Recorded;
    const main = asTyped(recorded[`plan · ${name}`], name);
    // The commander is multicolour; the other slots cycle W U B R G.
    const hints = out.designed[0]!.slots.map((slot) => slot.colorHint);
    expect(hints).toEqual(["multicolor", "blue", "black", "red", "green", "white", "blue", "black", "red", "green", "white", "blue"]);
    expect(main.designed[0]!.slots.map((slot) => slot.colorHint)).toEqual(["multicolor", "blue", "black", "white", "blue", "black", "white", "blue", "black", "white", "blue", "black"]);
    // Only the hints — and the designed cards' colours they give — moved.
    const withoutColours = (record: Recorded) => {
      const copy = structuredClone(record);
      for (const slot of copy.designed[0]!.slots) delete slot.colorHint;
      for (const card of copy.job[0]!.plan.cards) card.color_identity = [];
      return copy;
    };
    expect(JSON.stringify(withoutColours(out))).toBe(JSON.stringify(withoutColours(main)));
  });

  it.each([
    ["angels", "white", `${COMMANDER_NOTE_ON_MAIN} Its color identity is EXACTLY the deck's: white (W) — mana symbols of that color in its cost or rules text, and of no other color.`],
    ["slivers", "multicolor", `${COMMANDER_NOTE_ON_MAIN} ${COMMANDER_COLOURS_LINE["commander · slivers (five colours) · 12"]}`],
    [null, "multicolor", COMMANDER_NOTE_ON_MAIN],
  ])("the commander slot of a %s deck names the type's colours (an untyped deck's is main's)", async (deckType, hint, note) => {
    s.concepts = [concept(deckType ? undefined : ["black", "green"])];
    const out = await plan({ theme: "", format: "commander", size: 12, deckType: deckType ?? undefined });
    const design = out.designed[0] as { slots: Array<{ colorHint?: string; note?: string }> };
    expect(design.slots[0]).toMatchObject({ colorHint: hint, note });
    // …and no other slot's note moves.
    expect(design.slots.slice(1).some((slot) => /color identity is EXACTLY/.test(slot.note ?? ""))).toBe(false);
  });

  it.each([
    ["the type's own", ["black", "green"]],
    ["off the type", ["red"]],
    ["none", []],
    ["five", ["white", "blue", "black", "red", "green"]],
  ])("never takes colours from the model (%s) — a stray `colors` is dropped", async (_label, colors) => {
    s.concepts = [concept(colors)];
    const out = await plan({ theme: "", format: "commander", size: 12, deckType: "gorgons" });
    expect(out.result).toEqual({ ok: true, deckSlug: "made-deck" });
    expect(out.concept).toHaveLength(1);
    expect(JSON.stringify(out.concept[0]!.schema)).not.toContain("colors");
    const design = out.designed[0] as { slots: Array<{ colorHint?: string }> };
    expect(design.slots.map((slot) => slot.colorHint)).toEqual([
      "multicolor", "green", "black", "green", "black", "green", "black", "green", "black", "green", "black", "green",
    ]);
  });

  it.each([
    ["spirits", "infer the strategy FROM its current cards:"],
    ["eldrazi", "infer the strategy FROM its current cards:"],
    [null, "infer the strategy and colors FROM its current cards:"],
  ])("add mode (%s): only an untyped deck is asked to infer its colours from its cards", async (deckType, wording) => {
    s.deck = EXISTING_DECK(deckType);
    s.items = EXISTING_ITEMS;
    s.concepts = [concept(deckType ? undefined : ["green"])];
    const out = await plan({ theme: "", format: "commander", size: 6, deckId: "deck-9" });
    expect(out.concept[0]!.prompt).toContain(wording);
    expect(out.concept[0]!.prompt.match(/infer the strategy/g)).toHaveLength(1);
  });

  it("adding cards to a typed deck takes the deck's type colours too", async () => {
    s.deck = EXISTING_DECK("spirits");
    s.items = EXISTING_ITEMS;
    s.concepts = [concept(["red"])];
    const out = await plan({ theme: "", format: "commander", size: 6, deckId: "deck-9" });
    expect(out.result).toEqual({ ok: true, deckSlug: "old-deck" });
    const design = out.designed[0] as { slots: Array<{ colorHint?: string }> };
    expect(new Set(design.slots.map((slot) => slot.colorHint))).toEqual(new Set(["white", "blue"]));
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
