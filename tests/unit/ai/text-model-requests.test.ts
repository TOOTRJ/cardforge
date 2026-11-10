import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// The text AI's models and what every call sends (Sonnet 4.5 retires on
// 2026-11-30). The defaults are the gateway ids of Claude Sonnet 5.5 (design)
// and Claude Haiku 4.5 (judge); the 5.x models answer a request that carries
// temperature / top_p / top_k with a 400, so no call may send one to them,
// and none sends thinking options, a forced tool choice or an assistant
// prefill. `generateObject` is mocked: it records the options and throws, so
// each path is driven only as far as its request.
// ---------------------------------------------------------------------------

const s = vi.hoisted(() => ({ calls: [] as Record<string, unknown>[] }));

vi.mock("ai", () => ({
  generateObject: async (args: Record<string, unknown>) => {
    s.calls.push(args);
    throw new Error("recorded");
  },
}));

import { DEFAULT_DESIGN_MODEL, DEFAULT_JUDGE_MODEL, designModel, judgeModel } from "@/lib/ai/provider";
import { acceptsSamplingParams, textModelOptions } from "@/lib/ai/sampling";
import { designCards } from "@/lib/ai/card-design";
import { generateDeckPlan } from "@/lib/ai/deck-design";
import { generateDeckGuide } from "@/lib/ai/deck-guide";
import { generateDeckIdeas } from "@/lib/ai/deck-ideas";
import { generateRemixIdentity } from "@/lib/ai/remix";
import { aiBuildCommanderDeck } from "@/lib/tools/collection/ai-build";
import { designColourCard } from "@/lib/tools/pip-forge/colour-card";
import { draftTableSheet } from "@/lib/tools/rule0/ai-draft";
import { computeDeckAnalytics } from "@/lib/decks/analytics";
import type { CollectionCard } from "@/lib/tools/collection/card-row";

const savedEnv = { design: process.env.AI_DESIGN_MODEL, judge: process.env.AI_JUDGE_MODEL };

beforeEach(() => {
  s.calls = [];
  delete process.env.AI_DESIGN_MODEL;
  delete process.env.AI_JUDGE_MODEL;
});

afterEach(() => {
  if (savedEnv.design === undefined) delete process.env.AI_DESIGN_MODEL;
  else process.env.AI_DESIGN_MODEL = savedEnv.design;
  if (savedEnv.judge === undefined) delete process.env.AI_JUDGE_MODEL;
  else process.env.AI_JUDGE_MODEL = savedEnv.judge;
});

describe("the default text models", () => {
  it("design on Claude Sonnet 5.5 and judge on Claude Haiku 4.5, as AI Gateway ids", () => {
    expect(DEFAULT_DESIGN_MODEL).toBe("anthropic/claude-sonnet-5.5");
    expect(DEFAULT_JUDGE_MODEL).toBe("anthropic/claude-haiku-4.5");
    expect(designModel()).toBe("anthropic/claude-sonnet-5.5");
    expect(judgeModel()).toBe("anthropic/claude-haiku-4.5");
  });

  it("an env override still wins, a bare Claude id gaining its provider", () => {
    process.env.AI_DESIGN_MODEL = "claude-opus-5.5";
    process.env.AI_JUDGE_MODEL = "openai/gpt-4o";
    expect(designModel()).toBe("anthropic/claude-opus-5.5");
    expect(judgeModel()).toBe("openai/gpt-4o");
    process.env.AI_DESIGN_MODEL = "   ";
    expect(designModel()).toBe(DEFAULT_DESIGN_MODEL);
  });
});

describe("acceptsSamplingParams", () => {
  it("refuses the Claude models that 400 on temperature / top_p / top_k", () => {
    for (const id of [
      "anthropic/claude-sonnet-5.5",
      "claude-sonnet-5-5",
      "anthropic/claude-haiku-5.5",
      "anthropic/claude-sonnet-5",
      "anthropic/claude-opus-5.5",
      "anthropic/claude-opus-4.8",
      "claude-opus-4-7",
      "anthropic/claude-fable-5.2",
      "claude-mythos-5-1",
      "anthropic/claude-next", // a Claude id it can't read: leave the parameter out
    ]) {
      expect(acceptsSamplingParams(id), id).toBe(false);
    }
  });

  it("keeps it for the Claude models that take it and for other providers", () => {
    for (const id of [
      "anthropic/claude-haiku-4.5",
      "claude-haiku-4-5-20251001",
      "anthropic/claude-sonnet-4.5",
      "anthropic/claude-sonnet-4.6",
      "claude-sonnet-4-20250514",
      "claude-3-5-sonnet-latest",
      "openai/gpt-4o",
      "test/design",
    ]) {
      expect(acceptsSamplingParams(id), id).toBe(true);
    }
  });

  it("reads a model object by its modelId", () => {
    const model = { modelId: "claude-sonnet-5-5" } as unknown as Parameters<typeof acceptsSamplingParams>[0];
    expect(acceptsSamplingParams(model)).toBe(false);
  });

  it("textModelOptions drops the temperature only where it is refused", () => {
    expect(textModelOptions("anthropic/claude-sonnet-5.5", 0.9)).toEqual({ model: "anthropic/claude-sonnet-5.5" });
    expect(textModelOptions("anthropic/claude-haiku-4.5", 0.2)).toEqual({ model: "anthropic/claude-haiku-4.5", temperature: 0.2 });
  });
});

const FORBIDDEN_KEYS = ["topP", "topK", "toolChoice", "mode", "providerOptions", "messages", "maxOutputTokens"];

function expectCleanRequest(call: Record<string, unknown> | undefined, model: string) {
  expect(call, "generateObject was called").toBeDefined();
  expect(call!.model).toBe(model);
  for (const key of FORBIDDEN_KEYS) expect(call, key).not.toHaveProperty(key);
  // A temperature only where the model takes one (Haiku 4.5 does, 5.x don't).
  if (acceptsSamplingParams(model)) expect(typeof call!.temperature).toBe("number");
  else expect(call).not.toHaveProperty("temperature");
  expect(typeof call!.system).toBe("string");
  expect(call!.schema).toBeDefined();
}

const card = (name: string, over: Partial<CollectionCard> = {}): CollectionCard => ({
  id: name,
  scryfallId: name,
  name,
  typeLine: "Creature — Goblin",
  manaCost: "{1}{R}",
  manaValue: 2,
  colorIdentity: ["R"],
  oracleText: "Haste",
  rarity: "common",
  setCode: "abc",
  setName: "ABC",
  collectorNumber: "1",
  imageUrl: null,
  quantity: 1,
  finish: "nonfoil" as CollectionCard["finish"],
  lang: "en",
  commanderLegal: true,
  canBeCommander: false,
  ...over,
});

// Every path, its call and the model role it uses.
const PATHS: Array<{ name: string; role: "design" | "judge"; run: () => Promise<unknown> }> = [
  { name: "card design (cards, deck and remix jobs, fills)", role: "design", run: () => designCards({ slots: [{}] }) },
  { name: "deck plan concept", role: "judge", run: () => generateDeckPlan({ theme: "goblin fireworks", format: "standard", size: 10 }) },
  {
    name: "deck guide",
    role: "judge",
    run: () =>
      generateDeckGuide({
        title: "Goblins",
        description: null,
        format: "commander",
        deckType: null,
        bracket: null,
        cards: [{ quantity: 1, board: "main", name: "Goblin", type_line: null, mana_cost: null, rules_text: null }],
        analytics: computeDeckAnalytics([]),
      }),
  },
  { name: "deck ideas", role: "judge", run: () => generateDeckIdeas({ format: "commander" }) },
  {
    name: "remix identity",
    role: "design",
    run: () =>
      generateRemixIdentity({
        card: { title: "Goblin", cost: "{R}", card_type: "creature", supertype: null, subtypes: ["Goblin"], rules_text: "Haste", flavor_text: null, power: "1", toughness: "1" },
        style: "ink",
      }),
  },
  {
    name: "collection AI build",
    role: "design",
    run: () =>
      aiBuildCommanderDeck({
        commander: card("Krenko", { typeLine: "Legendary Creature — Goblin", canBeCommander: true }),
        collection: [card("Goblin A"), card("Goblin B")],
      }),
  },
  { name: "Pip Forge colour card", role: "judge", run: () => designColourCard({ subject: "a key with an eye", idea: "secrets", disc: null }) },
  {
    name: "Rule 0 draft",
    role: "design",
    run: () =>
      draftTableSheet({ title: "Goblins", format: "commander", bracket: 2, description: null, cards: [] as never }),
  },
];

describe("what each text path sends", () => {
  for (const path of PATHS) {
    it(`${path.name}: the ${path.role} model; no refused sampling, thinking, tool-choice or prefill options`, async () => {
      await expect(path.run()).rejects.toThrow();
      expectCleanRequest(s.calls[0], path.role === "design" ? DEFAULT_DESIGN_MODEL : DEFAULT_JUDGE_MODEL);
    });
  }

  it("an override to a model that takes sampling keeps the call's temperature", async () => {
    process.env.AI_DESIGN_MODEL = "anthropic/claude-sonnet-4.6";
    await expect(designCards({ slots: [{}] })).rejects.toThrow();
    expect(s.calls[0].model).toBe("anthropic/claude-sonnet-4.6");
    expect(s.calls[0].temperature).toBe(0.9);
  });
});

// Every text call in lib/ goes through textModelOptions and names no sampling
// or thinking option of its own — the paths above, and any added later.
describe("every generateObject call in lib/", () => {
  const root = path.resolve(__dirname, "../../../lib");
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name)) files.push(full);
    }
  };
  walk(root);
  const callers = files.filter((f) => /\bgenerateObject\(/.test(fs.readFileSync(f, "utf8")));

  it("finds the known callers", () => {
    expect(callers.length).toBeGreaterThanOrEqual(8);
  });

  for (const file of callers) {
    it(path.relative(root, file), () => {
      const src = fs.readFileSync(file, "utf8");
      const calls = src.split(/\bgenerateObject\(\{/).slice(1);
      expect(calls.length).toBeGreaterThan(0);
      for (const body of calls) {
        // The call's own options, up to the closing of its object literal.
        const head = body.slice(0, body.search(/\n\s*\}\)/));
        expect(head).toMatch(/\.\.\.textModelOptions\((designModel|judgeModel)\(\), [0-9.]+\)/);
        expect(head).not.toMatch(/\b(temperature|topP|topK|toolChoice|providerOptions|maxOutputTokens)\s*:/);
        expect(head).not.toMatch(/\bmodel\s*:/);
        expect(head).not.toMatch(/role:\s*"assistant"/);
      }
    });
  }
});
