import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// "AI card design failed: No object generated: response did not match
// schema." (production, 2026-10-14). The AI SDK validates the model's answer
// with the FULL zod schema, but the provider enforces only part of it:
// Anthropic's structured outputs drop minLength / maxLength / maxItems and
// any minItems above 1, and a gateway route without native structured output
// enforces nothing. One field outside the zod schema failed the whole call.
//
// This file: (1) the schemas as the SDK sends them, held to what the
// provider accepts, with every constraint the provider does NOT enforce
// pinned; (2) realistic answers through the design schema — which fail on
// main, which the repair sets right; (3) the guard (repair → log → one more
// call → plain message); (4) the design engine wired to it, with the model
// mocked like the SDK (no generation is ever run).
// ---------------------------------------------------------------------------

const s = vi.hoisted(() => ({
  /** One raw model TEXT per call, in order. */
  texts: [] as string[],
  calls: 0,
  repaired: 0,
  /** The fake clock (Date.now) and how long each call takes, in order. */
  now: 1_000_000,
  callMs: [] as number[],
}));

/** A stand-in for the SDK's generateObject: parse → validate with the zod
 *  schema → on failure `experimental_repairText` → validate again → else a
 *  NoObjectGeneratedError (name, text, cause chain as the SDK builds them). */
vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    generateObject: async (args: {
      schema: import("zod").ZodType;
      experimental_repairText?: (o: { text: string; error: unknown }) => Promise<string | null>;
    }) => {
      s.calls += 1;
      s.now += s.callMs.shift() ?? 0;
      const text = s.texts.shift() ?? "";
      const check = (raw: string) => {
        try {
          return args.schema.safeParse(JSON.parse(raw));
        } catch {
          return null;
        }
      };
      let result = check(text);
      if (!result?.success && args.experimental_repairText) {
        const repaired = await args.experimental_repairText({ text, error: result?.error });
        if (repaired !== null) {
          s.repaired += 1;
          result = check(repaired);
        }
      }
      if (result?.success) return { object: result.data };
      throw new actual.NoObjectGeneratedError({
        message: "No object generated: response did not match schema.",
        text,
        cause: new actual.TypeValidationError({ value: text, cause: result?.error }),
        response: { id: "r", timestamp: new Date(0), modelId: "test" },
        usage: {} as never,
        finishReason: "stop",
      });
    },
  };
});
vi.mock("@/lib/ai/provider", () => ({ designModel: () => "test/design", judgeModel: () => "test/judge" }));

import { zodSchema } from "ai";
import type { z } from "zod";
import { DESIGN_STAT_FIELDS, designCards, designedCardsSchema, designRepair } from "@/lib/ai/card-design";
import { deckConceptSchema } from "@/lib/ai/deck-design";
import { deckIdeasSchema, generateDeckIdeas } from "@/lib/ai/deck-ideas";
import { deckGuideSchema } from "@/lib/ai/deck-guide";
import { buildRemixIdentityRequest } from "@/lib/ai/remix";
import {
  AI_OUTPUT_ERROR_MESSAGE,
  AiOutputError,
  aiErrorMessage,
  AI_RETRY_TAIL_MS,
  extractJson,
  retryFitsBudget,
  structuredCall,
  withAiTimeBudget,
} from "@/lib/ai/structured-output";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { stationReminder } from "@/lib/creator/station-rows";

let errors: unknown[][] = [];
beforeEach(() => {
  s.texts = [];
  s.calls = 0;
  s.repaired = 0;
  s.now = 1_000_000;
  s.callMs = [];
  vi.spyOn(Date, "now").mockImplementation(() => s.now);
  errors = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errors.push(args);
  });
});
afterEach(() => vi.restoreAllMocks());

// ---------------------------------------------------------------------------
// (1) The schemas as sent
// ---------------------------------------------------------------------------

const remixRequest = (secondHalf: Parameters<typeof buildRemixIdentityRequest>[0]["secondHalf"]) =>
  buildRemixIdentityRequest({
    card: { title: "A", cost: "{R}", card_type: "creature", supertype: null, subtypes: [], rules_text: "Haste", flavor_text: null, power: "1", toughness: "1" },
    secondHalf,
    style: "ink",
  }).schema;
const backFace = { title: "B", cost: null, card_type: "creature", rules_text: "Flying" } as never;

const SCHEMAS: Record<string, z.ZodType> = {
  "card-design/design": designedCardsSchema(false),
  "card-design/design+emblem": designedCardsSchema(true),
  "deck-design/concept": deckConceptSchema,
  "deck-ideas": deckIdeasSchema,
  "deck-guide": deckGuideSchema,
  "remix/identity": remixRequest(null),
  "remix/identity two-part": remixRequest({ layout: "adventure", face: backFace }),
  "remix/identity double-faced": remixRequest({ layout: "transform", face: backFace }),
};

type Json = Record<string, unknown>;
/** Keywords Anthropic's structured outputs support (platform docs,
 *  "Supported JSON Schema keywords"), plus annotations. */
const SUPPORTED = new Set([
  "$schema", "type", "properties", "required", "additionalProperties", "items", "enum", "const",
  "anyOf", "description", "default", "minItems",
  // NOT enforced by the provider — allowed only as pinned below:
  "minLength", "maxLength", "maxItems",
]);

function walk(node: Json, path: string, out: { unenforced: string[]; problems: string[] }) {
  for (const key of Object.keys(node)) {
    if (!SUPPORTED.has(key)) out.problems.push(`${path}: unsupported keyword ${key}`);
  }
  if (node.type === "object") {
    if (node.additionalProperties !== false) out.problems.push(`${path}: additionalProperties must be false`);
    for (const [name, child] of Object.entries((node.properties ?? {}) as Record<string, Json>)) {
      walk(child, `${path}.${name}`, out);
    }
  }
  if (node.items) walk(node.items as Json, `${path}[]`, out);
  for (const branch of (node.anyOf ?? []) as Json[]) walk(branch, path, out);
  if (typeof node.minLength === "number" && node.minLength > 0) out.unenforced.push(`${path} minLength ${node.minLength}`);
  if (typeof node.maxLength === "number") out.unenforced.push(`${path} maxLength ${node.maxLength}`);
  if (typeof node.maxItems === "number") out.unenforced.push(`${path} maxItems ${node.maxItems}`);
  if (typeof node.minItems === "number" && node.minItems > 1) out.unenforced.push(`${path} minItems ${node.minItems}`);
}

async function audit(schema: z.ZodType) {
  const json = (await zodSchema(schema).jsonSchema) as Json;
  const out = { unenforced: [] as string[], problems: [] as string[] };
  walk(json, "$", out);
  return out;
}

describe("every structured-output schema, as the SDK sends it", () => {
  it("uses only keywords the provider accepts, every object closed", async () => {
    for (const [label, schema] of Object.entries(SCHEMAS)) {
      expect({ label, problems: (await audit(schema)).problems }).toEqual({ label, problems: [] });
    }
  });

  // What the model is NOT held to. A new entry here is a field that can fail
  // a whole generation: give it a repair (a cut, a fixup) or a retry, then pin
  // it. maxLength / maxItems are cut by the generic repair; a minimum is only
  // ever met by asking again.
  it("pins every constraint the provider does not enforce", async () => {
    const pinned: Record<string, string[]> = {};
    for (const [label, schema] of Object.entries(SCHEMAS)) pinned[label] = (await audit(schema)).unenforced.sort();
    const card = [
      "$.cards[].title minLength 1",
      "$.cards[].cost minLength 1",
      "$.cards[].cost maxLength 40",
      "$.cards[].color_identity maxItems 6",
      "$.cards[].rules_text minLength 1",
      "$.cards[].art_prompt minLength 1",
      "$.cards[].tags maxItems 8",
    ];
    const sorted = (lists: Record<string, string[]>) =>
      Object.fromEntries(Object.entries(lists).map(([label, list]) => [label, [...list].sort()]));
    expect(pinned).toEqual(sorted({
      "card-design/design": card,
      "card-design/design+emblem": card,
      "deck-design/concept": ["$.deck_title minLength 1", "$.colors maxItems 3"],
      "deck-ideas": [
        "$.ideas minItems 3",
        "$.ideas maxItems 3",
        "$.ideas[].title maxLength 80",
        "$.ideas[].theme maxLength 300",
        "$.ideas[].style maxLength 60",
        "$.ideas[].pitch maxLength 200",
      ],
      "deck-guide": [
        "$.game_plan minItems 3",
        "$.game_plan maxItems 6",
        "$.combos maxItems 6",
        "$.combos[].cards minItems 2",
        "$.combos[].cards maxItems 4",
        "$.key_cards maxItems 6",
      ],
      "remix/identity": ["$.title minLength 1", "$.art_instruction minLength 1"],
      "remix/identity two-part": ["$.title minLength 1", "$.art_instruction minLength 1", "$.second_title minLength 1"],
      "remix/identity double-faced": [
        "$.title minLength 1",
        "$.art_instruction minLength 1",
        "$.second_title minLength 1",
        "$.second_art_instruction minLength 1",
      ],
    }));
  });
});

// ---------------------------------------------------------------------------
// (2) Realistic answers through the design schema
// ---------------------------------------------------------------------------

const base = {
  title: "Lanternhollow Vigil",
  cost: "{1}{W}",
  card_type: "creature",
  supertype: null,
  subtypes: ["Spirit", "Cleric"],
  rarity: "common",
  color_identity: ["white"],
  rules_text: "Vigilance\nWhen Lanternhollow Vigil enters, you gain 2 life.",
  flavor_text: "The lanterns never gutter while she watches.",
  power: "2",
  toughness: "1",
  loyalty: null,
  defense: null,
  art_prompt: "A serene spirit cleric holding a brass lantern on a fog-drowned wall at dusk.",
};
const card = (over: Record<string, unknown> = {}) => ({ ...base, ...over });
const spacecraft = card({
  title: "Halcyon Driftbarge",
  cost: "{2}{U}",
  card_type: "artifact",
  subtypes: ["Spacecraft"],
  rarity: "rare",
  color_identity: ["blue"],
  rules_text: `${stationReminder("Spacecraft", 9)}\n2+ | Whenever you cast an artifact spell, scry 1.\n9+ | Flying\nWhenever this Spacecraft attacks, draw a card.`,
  power: "4",
  toughness: "5",
});
const planet = card({
  title: "Verdance Prime",
  cost: "—",
  card_type: "land",
  subtypes: ["Planet"],
  rarity: "rare",
  color_identity: ["green"],
  rules_text: `This land enters tapped.\n{T}: Add {G}.\n${stationReminder("Planet", null)}\n12+ | {T}: Add {G}{G}{G}.`,
  flavor_text: null,
  power: null,
  toughness: null,
});

const GOOD: Record<string, unknown> = {
  "a creature": card(),
  "an instant": card({ card_type: "instant", cost: "{1}{U}{U}", subtypes: [], color_identity: ["blue"], rules_text: "Counter target spell unless its controller pays {2}. Draw a card.", power: null, toughness: null }),
  "a Spacecraft with two tiers": spacecraft,
  "a Planet": planet,
  "a token": card({ card_type: "token", cost: "—", supertype: "Artifact", subtypes: ["Treasure"], title: "Treasure", rules_text: "{T}, Sacrifice this token: Add one mana of any color.", power: null, toughness: null }),
  "a long text (clamped, never refused)": card({ rules_text: "Flying. ".repeat(200), flavor_text: "x".repeat(900), art_prompt: "y".repeat(2000) }),
  "tags": card({ tags: ["Spirits", "lifegain"] }),
};

const without = (value: Record<string, unknown>, ...keys: string[]) =>
  Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));

/** Correct-looking answers the schema refused on main — what can make the
 *  owner's error, field by field. `repaired` = set right by the repair
 *  (no second call); false = only a second call helps. */
const BAD: Array<{ name: string; answer: unknown; field: string; repaired: boolean }> = [
  { name: "a land's cost left empty (Planet)", answer: { cards: [{ ...planet, cost: "" }] }, field: "cards.0.cost", repaired: true },
  { name: "a token's cost left empty", answer: { cards: [card({ card_type: "token", cost: "", supertype: "Creature", subtypes: ["Soldier"], title: "Soldier" })] }, field: "cards.0.cost", repaired: true },
  { name: "a colourless Spacecraft with no colour", answer: { cards: [{ ...spacecraft, cost: "{4}", color_identity: [] }] }, field: "cards.0.color_identity", repaired: true },
  { name: "nine tags", answer: { cards: [card({ tags: ["a", "b", "c", "d", "e", "f", "g", "h", "i"] })] }, field: "cards.0.tags", repaired: true },
  { name: "an enum in capitals", answer: { cards: [card({ card_type: "Creature", rarity: "Common", color_identity: ["White"] })] }, field: "cards.0.card_type", repaired: true },
  { name: "a nullable text left out (flavour)", answer: { cards: [without(card(), "flavor_text")] }, field: "cards.0.flavor_text", repaired: true },
  // Never nulled: the autofix would fill a null stat with numbers the model
  // never wrote (a 2/2, loyalty 3, defense 3) — asked for again instead.
  { name: "a creature's power left out", answer: { cards: [without(card(), "power")] }, field: "cards.0.power", repaired: false },
  { name: "a non-creature's stats left out (still a stat)", answer: { cards: [without(card({ card_type: "instant", power: null, toughness: null }), "loyalty", "defense")] }, field: "cards.0.loyalty", repaired: false },
  { name: "a planeswalker's loyalty left out", answer: { cards: [without(card({ card_type: "planeswalker", power: null, toughness: null }), "loyalty")] }, field: "cards.0.loyalty", repaired: false },
  { name: "a battle's defense left out", answer: { cards: [without(card({ card_type: "battle", power: null, toughness: null }), "defense")] }, field: "cards.0.defense", repaired: false },
  { name: "a key the schema doesn't know", answer: { cards: [card({ station_tiers: [{ n: 9 }] })] }, field: "cards.0", repaired: true },
  { name: "the cards list sent bare", answer: [card()], field: "", repaired: true },
  // Never cut: "{W}…{W}{" would save a broken cost (asked for again instead).
  { name: "a cost past 40 characters", answer: { cards: [card({ cost: "{W}".repeat(14) })] }, field: "cards.0.cost", repaired: false },
  // "—" would PRINT in a sorcery's cost row: asked for again.
  { name: "a sorcery's cost left empty", answer: { cards: [card({ card_type: "sorcery", cost: "", power: null, toughness: null })] }, field: "cards.0.cost", repaired: false },
  { name: "a vanilla creature with no rules text", answer: { cards: [card({ rules_text: "" })] }, field: "cards.0.rules_text", repaired: false },
];

describe("realistic design answers", () => {
  const schema = designedCardsSchema(false);
  it.each(Object.entries(GOOD))("%s passes the schema as on main", (_name, answer) => {
    expect(schema.safeParse({ cards: [answer] }).success).toBe(true);
  });

  it.each(BAD)("$name: refused on main", ({ answer, field }) => {
    const result = schema.safeParse(answer);
    expect(result.success).toBe(false);
    expect(result.error!.issues.map((issue) => issue.path.join("."))).toContain(field);
  });

  it.each(BAD)("$name: the repair sets it right = $repaired", async ({ answer, repaired }) => {
    const text = await designRepair(false)({ text: JSON.stringify(answer) });
    expect(text !== null).toBe(repaired);
    if (text) expect(schema.safeParse(JSON.parse(text)).success).toBe(true);
  });

  it("a repair never invents content: the fixed card keeps every value the model wrote", async () => {
    const text = await designRepair(false)({
      text: JSON.stringify({ cards: [{ ...planet, cost: "", extra: 1 }] }),
    });
    expect(JSON.parse(text!)).toEqual({ cards: [{ ...planet, cost: "—" }] });
  });

  it("reads JSON inside a fence or prose", () => {
    expect(extractJson('Here you go:\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Sure! {"a":[1]} hope it helps')).toEqual({ a: [1] });
    expect(extractJson("no json")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// (3) The guard
// ---------------------------------------------------------------------------

describe("structuredCall", () => {
  const fail = (text = "{}") =>
    Object.assign(new Error("No object generated: response did not match schema."), {
      name: "AI_NoObjectGeneratedError",
      text,
      finishReason: "stop",
      cause: { name: "AI_TypeValidationError", cause: { issues: [{ code: "too_small", path: ["cards", 0, "rules_text"], message: "Too small" }] } },
    });

  it("logs the zod issues and the model's text, then asks once more", async () => {
    let n = 0;
    const out = await structuredCall("t", async () => null, async () => {
      n += 1;
      if (n === 1) throw fail('{"cards":[{"rules_text":""}]}');
      return "ok";
    });
    expect(out).toBe("ok");
    expect(n).toBe(2);
    expect(errors).toHaveLength(1);
    const logged = JSON.parse(errors[0][1] as string);
    expect(logged.issues).toEqual([{ path: "cards.0.rules_text", code: "too_small", message: "Too small" }]);
    expect(logged.text).toBe('{"cards":[{"rules_text":""}]}');
  });

  it("a second miss is AiOutputError, in plain words", async () => {
    const run = vi.fn(async () => {
      throw fail();
    });
    await expect(structuredCall("t", async () => null, run)).rejects.toBeInstanceOf(AiOutputError);
    expect(run).toHaveBeenCalledTimes(2);
    const error = await structuredCall("t", async () => null, run).catch((e) => e);
    expect(error.message).toBe(AI_OUTPUT_ERROR_MESSAGE);
    expect(error.message).not.toMatch(/schema|object|zod/i);
  });

  it("attempts: 1 never makes a second call", async () => {
    const run = vi.fn(async () => {
      throw fail();
    });
    await expect(structuredCall("t", async () => null, run, { attempts: 1 })).rejects.toBeInstanceOf(AiOutputError);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("any other error is rethrown at once, untouched", async () => {
    const boom = new Error("Gateway timeout");
    const run = vi.fn(async () => {
      throw boom;
    });
    await expect(structuredCall("t", async () => null, run)).rejects.toBe(boom);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("aiErrorMessage: plain words for an unreadable answer, the caller's wording otherwise", () => {
    const wrap = (d: string) => `AI card design failed: ${d}`;
    expect(aiErrorMessage(new AiOutputError("t"), wrap, "x")).toBe(AI_OUTPUT_ERROR_MESSAGE);
    expect(aiErrorMessage(fail(), wrap, "x")).toBe(AI_OUTPUT_ERROR_MESSAGE);
    expect(aiErrorMessage(new Error("Rate limited"), wrap, "x")).toBe("AI card design failed: Rate limited");
  });
});

// ---------------------------------------------------------------------------
// (4) The engine, wired
// ---------------------------------------------------------------------------

describe("designCards with the guard", () => {
  it("a good answer: one call, no repair, the card as the model wrote it", async () => {
    s.texts = [JSON.stringify({ cards: [card()] })];
    const { cards } = await designCards({ slots: [{ cardType: "creature" }] });
    expect(s.calls).toBe(1);
    expect(s.repaired).toBe(0);
    expect(cards[0]).toMatchObject({ title: base.title, cost: base.cost, rules_text: base.rules_text });
  });

  it("the owner's error, a repairable answer: set right in the same call", async () => {
    s.texts = [JSON.stringify({ cards: [{ ...planet, cost: "" }] })];
    const { cards } = await designCards({ slots: [{ cardType: "land" }] });
    expect(s.calls).toBe(1);
    expect(cards[0].cost).toBe("—");
    expect(cards[0].subtypes).toEqual(["Planet"]);
  });

  it("an answer no machine may fix: logged, asked once more, and the second answer is the card", async () => {
    s.texts = [JSON.stringify({ cards: [card({ rules_text: "" })] }), JSON.stringify({ cards: [card()] })];
    const { cards } = await designCards({ slots: [{ cardType: "creature" }] });
    expect(s.calls).toBe(2);
    expect(cards[0].rules_text).toBe(base.rules_text);
    expect(String(errors[0][0])).toContain("card-design/design attempt 1");
  });

  it("two such answers: AiOutputError (plain words), never the SDK's text", async () => {
    s.texts = [JSON.stringify({ cards: [card({ rules_text: "" })] }), JSON.stringify({ cards: [card({ rules_text: "" })] })];
    const error = await designCards({ slots: [{ cardType: "creature" }] }).catch((e) => e);
    expect(error).toBeInstanceOf(AiOutputError);
    expect(s.calls).toBe(2);
  });

  it("deck ideas: an overlong pitch is cut to its limit, never a failed (refunded) batch", async () => {
    const idea = { title: "Ash", theme: "Fire", style: "oil", pitch: "p".repeat(260) };
    s.texts = [JSON.stringify({ ideas: [idea, idea, idea] })];
    const ideas = await generateDeckIdeas({ format: "commander" as never });
    expect(s.calls).toBe(1);
    expect(ideas[0].pitch).toHaveLength(200);
  });

  it("a missing stat is asked for again — never nulled and then filled with an invented 2/2", async () => {
    s.texts = [
      JSON.stringify({ cards: [without(card(), "power", "toughness")] }),
      JSON.stringify({ cards: [card({ power: "3", toughness: "1" })] }),
    ];
    const { cards } = await designCards({ slots: [{ cardType: "creature" }] });
    expect(s.calls).toBe(2);
    expect(s.repaired).toBe(0);
    expect(cards[0]).toMatchObject({ power: "3", toughness: "1" });
  });
});

// ---------------------------------------------------------------------------
// (5) Never invents: the stat fields
// ---------------------------------------------------------------------------

describe("the design repair never nulls a stat", () => {
  it("DESIGN_STAT_FIELDS is every nullable field of the design schema but its two texts", () => {
    const shape = (designedCardsSchema(false).shape.cards.element as unknown as { shape: Record<string, z.ZodType> }).shape;
    const nullable = Object.keys(shape).filter((key) => shape[key].safeParse(null).success);
    expect(nullable.filter((key) => !DESIGN_STAT_FIELDS.has(key)).sort()).toEqual(["flavor_text", "supertype"]);
    for (const stat of DESIGN_STAT_FIELDS) expect(Object.keys(shape)).toContain(stat);
  });

  it("the generic repair still nulls a missing text field where no option says otherwise", async () => {
    const text = await designRepair(false)({ text: JSON.stringify({ cards: [without(card(), "flavor_text", "supertype")] }) });
    expect(JSON.parse(text!).cards[0]).toMatchObject({ flavor_text: null, supertype: null, power: "2" });
  });
});

// ---------------------------------------------------------------------------
// (6) The time budget: a second call only where the route can still finish
// ---------------------------------------------------------------------------

describe("retry and the route's time budget", () => {
  const fail = () =>
    Object.assign(new Error("No object generated: response did not match schema."), { name: "AI_NoObjectGeneratedError", text: "{}" });
  const slowFailure = (ms: number) =>
    vi.fn(async () => {
      s.now += ms;
      throw fail();
    });

  it("outside a budget (job steps, the jobs route) the retry is never limited by time", async () => {
    const run = slowFailure(120_000);
    await expect(structuredCall("t", async () => null, run)).rejects.toBeInstanceOf(AiOutputError);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("60 s route, first call failed after 10 s: 50 s left ≥ 1.5 × 10 + 20 → retried", async () => {
    const start = s.now;
    const run = slowFailure(10_000);
    await expect(withAiTimeBudget(start, 60, () => structuredCall("t", async () => null, run))).rejects.toBeInstanceOf(AiOutputError);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("60 s route, first call failed after 25 s: 35 s left < 37.5 + 20 → no second call, plain error at once", async () => {
    const start = s.now;
    const run = slowFailure(25_000);
    const error = await withAiTimeBudget(start, 60, () => structuredCall("t", async () => null, run)).catch((e) => e);
    expect(error).toBeInstanceOf(AiOutputError);
    expect(error.message).toBe(AI_OUTPUT_ERROR_MESSAGE);
    expect(run).toHaveBeenCalledTimes(1);
    expect(errors.some((args) => String(args[0]).includes("time budget"))).toBe(true);
  });

  it("the budget runs from the REQUEST's start: time spent before the call counts", async () => {
    const start = s.now;
    s.now += 30_000; // auth, rate limit, deck brief, credit reserve…
    const run = slowFailure(8_000);
    await expect(withAiTimeBudget(start, 60, () => structuredCall("t", async () => null, run))).rejects.toBeInstanceOf(AiOutputError);
    // 22 s left < 12 + 20: one call.
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("retryFitsBudget at the edge, and the tail is conservative", () => {
    expect(AI_RETRY_TAIL_MS).toBeGreaterThanOrEqual(20_000);
    const start = s.now;
    return withAiTimeBudget(start, 90, async () => {
      // 90 s budget: 20 s used; first call 20 s → needs 30 + 20 = 50 ≤ 70.
      expect(retryFitsBudget(20_000, start + 20_000)).toBe(true);
      // 41 s used: 49 s left < 50.
      expect(retryFitsBudget(20_000, start + 41_000)).toBe(false);
    });
  });

  it("card ideas under a 60 s budget: a slow failed design gives the plain error with ONE design call (the route's catch refunds in time)", async () => {
    const start = s.now;
    s.texts = [JSON.stringify({ cards: [card({ rules_text: "" })] }), JSON.stringify({ cards: [card()] })];
    s.callMs = [28_000];
    const error = await withAiTimeBudget(start, 60, () => designCards({ slots: [{ cardType: "creature" }] })).catch((e) => e);
    expect(error).toBeInstanceOf(AiOutputError);
    expect(s.calls).toBe(1);
  });

  it("the same failure, fast: retried inside the budget and the second design is the card", async () => {
    const start = s.now;
    s.texts = [JSON.stringify({ cards: [card({ rules_text: "" })] }), JSON.stringify({ cards: [card()] })];
    s.callMs = [9_000, 9_000];
    const { cards } = await withAiTimeBudget(start, 60, () => designCards({ slots: [{ cardType: "creature" }] }));
    expect(s.calls).toBe(2);
    expect(cards[0].rules_text).toBe(base.rules_text);
  });

  // Every route with a short maxDuration that makes a structured AI call
  // runs it under its budget, measured from the request's start.
  it("every app/api route with maxDuration ≤ 90 that calls the AI wraps it in withAiTimeBudget", () => {
    // An AI module, or the guides module's GENERATING entry (its reads —
    // getDeckGuide in the deck download — make no call).
    const AI_ENTRY = /from "@\/lib\/ai\/(card-ideas|deck-ideas|deck-guide|deck-design|card-design|card-fill|remix|random-card|generation-jobs)"|buildAndStoreDeckGuide\(/;
    const files: string[] = [];
    const walkDir = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walkDir(path);
        else if (name === "route.ts") files.push(path);
      }
    };
    walkDir(join(process.cwd(), "app/api"));
    const short = files
      .map((path) => ({ path, source: readFileSync(path, "utf8") }))
      .filter(({ source }) => {
        const max = /export const maxDuration = (\d+)/.exec(source);
        return max && Number(max[1]) <= 90 && AI_ENTRY.test(source);
      });
    const names = short.map(({ path }) => path.slice(path.indexOf("app/api")));
    // (card-ideas runs at 120 s since 2026-10-28 — three cards and the judge
    // ran past 60 — and still wraps its work: card-ideas-route.test.ts.)
    expect(names.sort()).toEqual(["app/api/ai/deck-ideas/route.ts", "app/api/decks/[id]/guide/route.ts"]);
    for (const { path, source } of short) {
      expect({ path, starts: /POST\([^)]*\)[^{]*\{\s*const startedAt = Date\.now\(\);/.test(source) }).toEqual({ path, starts: true });
      expect({ path, wraps: source.includes("withAiTimeBudget(startedAt, maxDuration,") }).toEqual({ path, wraps: true });
    }
  });
});
