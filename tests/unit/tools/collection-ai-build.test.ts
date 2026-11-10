import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CollectionCard } from "@/lib/tools/collection/card-row";

// ---------------------------------------------------------------------------
// The collection builder's "Build with AI" call (lib/tools/collection/
// ai-build.ts, owner 2026-11-09): the card list first in its tags and the
// task last; lettered ids; each pick's reason reaches the draft; what the
// model says the cards are thin on joins the warnings; a measurable
// shortfall is asked for ONCE more, only while the route's budget holds a
// second call. `generateObject` is mocked: it records the request and
// answers what the test queues.
// ---------------------------------------------------------------------------

const s = vi.hoisted(() => ({ calls: [] as Record<string, unknown>[], answers: [] as unknown[] }));

vi.mock("server-only", () => ({}));
vi.mock("ai", () => ({
  generateObject: async (args: Record<string, unknown>) => {
    s.calls.push(args);
    const next = s.answers.shift();
    if (!next) throw new Error("no answer queued");
    if (next instanceof Error) throw next;
    return { object: next };
  },
}));

import { AI_BUILD_SYSTEM, AI_RETRY_MIN_PICKS, aiBuildCommanderDeck, aiBuildSchema, retryMinPicks } from "@/lib/tools/collection/ai-build";
import { aiCandidates } from "@/lib/tools/collection/ai-candidates";
import { withAiTimeBudget } from "@/lib/ai/structured-output";

let seq = 0;
function card(name: string, over: Partial<CollectionCard> = {}): CollectionCard {
  seq += 1;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    scryfallId: `10000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    name,
    typeLine: "Creature — Goblin",
    manaCost: "{1}{R}",
    manaValue: 2,
    colorIdentity: ["R"],
    oracleText: "Haste",
    rarity: "common",
    setCode: "tst",
    setName: "Test",
    collectorNumber: String(seq),
    imageUrl: null,
    quantity: 1,
    finish: "nonfoil",
    lang: "en",
    commanderLegal: true,
    canBeCommander: false,
    ...over,
  };
}

const KRENKO = card("Krenko, Mob Boss", {
  typeLine: "Legendary Creature — Goblin Warrior",
  oracleText: "{T}: Create X 1/1 red Goblin creature tokens, where X is the number of Goblins you control.",
  canBeCommander: true,
});
const COLLECTION = [KRENKO, ...Array.from({ length: 90 }, (_, i) => card(`Goblin ${i}`))];
const fixed = () => 0.5;

function answer(ids: string[], extra: Partial<{ strategy: string; shortfalls: string[] }> = {}) {
  return {
    strategy: extra.strategy ?? "Go wide with goblins.",
    shortfalls: extra.shortfalls ?? [],
    picks: ids.map((id) => ({ id, role: "plan", why: `Because ${id}.` })),
  };
}
const ids = (n: number) => Array.from({ length: n }, (_, i) => `c${i}`);

beforeEach(() => {
  s.calls = [];
  s.answers = [];
});

describe("the AI build's request", () => {
  it("lists the cards first, the commander and targets after, the task last", async () => {
    s.answers.push(answer(ids(63)));
    await aiBuildCommanderDeck({ commander: KRENKO, collection: COLLECTION, random: fixed });
    const prompt = String(s.calls[0].prompt);
    expect(prompt.startsWith("<cards>\nc0 | ")).toBe(true);
    expect(prompt.indexOf("</cards>")).toBeLessThan(prompt.indexOf("<commander>"));
    expect(prompt.indexOf("</commander>")).toBeLessThan(prompt.indexOf("<targets>"));
    expect(prompt.trim().split("\n").at(-1)).toMatch(/^Choose the deck now\. Use only ids from <cards>\./);
    expect(prompt).toContain("Krenko, Mob Boss — {1}{R} — Legendary Creature — Goblin Warrior");
    expect(s.calls[0].system).toBe(AI_BUILD_SYSTEM);
    expect(AI_BUILD_SYSTEM).toMatch(/choose only cards listed in <cards>, by their id/);
  });
});

describe("the AI build's answer", () => {
  it("carries each pick's reason to the draft and the shortfalls to the warnings", async () => {
    s.answers.push(answer(ids(63), { shortfalls: ["only 3 removal spells in red"] }));
    const draft = await aiBuildCommanderDeck({ commander: KRENKO, collection: COLLECTION, random: fixed });
    expect(s.calls).toHaveLength(1);
    const aiPicks = draft.picks.filter((p) => p.fromAi);
    expect(aiPicks.length).toBeGreaterThan(50);
    // Each reason lands on the card its id named (the same shuffle).
    const candidates = aiCandidates(KRENKO, COLLECTION, { random: fixed });
    for (const pick of aiPicks) {
      const index = candidates.findIndex((c) => c.id === pick.cardId);
      expect(pick.aiWhy).toBe(`Because c${index}.`);
    }
    expect(draft.warnings).toContain("The AI: only 3 removal spells in red");
    expect(draft.strategy).toBe("Go wide with goblins.");
  });

  it("a short answer is asked for once more, and the better answer is kept", async () => {
    s.answers.push(answer(ids(10)), answer(ids(60), { strategy: "Second try." }));
    const draft = await aiBuildCommanderDeck({ commander: KRENKO, collection: COLLECTION, random: fixed });
    expect(s.calls).toHaveLength(2);
    expect(String(s.calls[1].prompt)).toMatch(/<previous_answer>\nYour last answer had 10 usable picks\./);
    expect(draft.strategy).toBe("Second try.");
  });

  it("an answer mostly of ids not on the list is asked for once more", async () => {
    s.answers.push(answer([...ids(55), ...Array.from({ length: 20 }, (_, i) => `c${900 + i}`)]), answer(ids(63)));
    await aiBuildCommanderDeck({ commander: KRENKO, collection: COLLECTION, random: fixed });
    expect(s.calls).toHaveLength(2);
    expect(String(s.calls[1].prompt)).toMatch(/20 ids that are not in <cards>/);
  });

  it("a retry that fails keeps the first answer", async () => {
    s.answers.push(answer(ids(20)), new Error("gateway timeout"));
    const draft = await aiBuildCommanderDeck({ commander: KRENKO, collection: COLLECTION, random: fixed });
    expect(s.calls).toHaveLength(2);
    expect(draft.picks.filter((p) => p.fromAi)).toHaveLength(20);
    expect(draft.strategy).toBe("Go wide with goblins.");
  });

  it("a small list asks for 80 % of it, not 50", async () => {
    const small = [KRENKO, ...Array.from({ length: 35 }, (_, i) => card(`Small ${i}`))];
    expect(retryMinPicks(35)).toBe(28);
    s.answers.push(answer(ids(30)));
    await aiBuildCommanderDeck({ commander: KRENKO, collection: small, random: fixed });
    expect(s.calls).toHaveLength(1);
  });

  it("a retry is sized as a full answer, and cut off before the refund's time", async () => {
    // 80 s left: a full answer (50 s × 1.5) plus the 20 s tail doesn't fit,
    // however quick the short first answer was.
    s.answers.push(answer(ids(5)), answer(ids(63)));
    await withAiTimeBudget(Date.now() - 40_000, 120, () =>
      aiBuildCommanderDeck({ commander: KRENKO, collection: COLLECTION, random: fixed }),
    );
    expect(s.calls).toHaveLength(1);

    // The whole budget left: the retry runs, with an abort signal.
    s.calls = [];
    s.answers = [answer(ids(5)), answer(ids(63))];
    await withAiTimeBudget(Date.now(), 120, () =>
      aiBuildCommanderDeck({ commander: KRENKO, collection: COLLECTION, random: fixed }),
    );
    expect(s.calls).toHaveLength(2);
    expect(s.calls[0].abortSignal).toBeUndefined();
    expect(s.calls[1].abortSignal).toBeInstanceOf(AbortSignal);
  });

  it("never more than once, and not when the route's budget can't hold a second call", async () => {
    s.answers.push(answer(ids(5)), answer(ids(3)));
    const draft = await aiBuildCommanderDeck({ commander: KRENKO, collection: COLLECTION, random: fixed });
    expect(s.calls).toHaveLength(2);
    // The worse second answer is not kept.
    expect(draft.picks.filter((p) => p.fromAi)).toHaveLength(5);

    s.calls = [];
    s.answers.push(answer(ids(5)), answer(ids(63)));
    await withAiTimeBudget(Date.now() - 115_000, 120, () =>
      aiBuildCommanderDeck({ commander: KRENKO, collection: COLLECTION, random: fixed }),
    );
    expect(s.calls).toHaveLength(1);
    expect(AI_RETRY_MIN_PICKS).toBe(50);
  });
});

describe("the answer's schema", () => {
  it("only an id must be right: a missing reason or shortfall list, or an odd role word, never fails", () => {
    const parsed = aiBuildSchema.parse({
      strategy: "  Go wide.  ",
      shortfalls: null,
      picks: [
        { id: "c1", role: "card draw", why: null },
        { id: "c2", why: "  Makes goblins.  " },
      ],
    });
    expect(parsed.strategy).toBe("Go wide.");
    expect(parsed.shortfalls).toEqual([]);
    expect(parsed.picks).toEqual([
      { id: "c1", role: "card draw", why: "" },
      { id: "c2", role: "", why: "Makes goblins." },
    ]);
  });
});

describe("a deck type, a creature type and a bracket in the prompt", () => {
  it("adds their blocks before the targets, with the type's shape", async () => {
    s.answers.push(answer(ids(63)));
    await aiBuildCommanderDeck({
      commander: KRENKO,
      collection: COLLECTION,
      random: fixed,
      choice: { deckType: "landfall", tribe: "goblin", bracket: 2 },
      bracketCards: { gameChangers: new Set(), massLandDenial: new Set(), extraTurns: new Set() },
    });
    const prompt = String(s.calls[0].prompt);
    expect(prompt).toMatch(/<deck_type>\nLandfall: /);
    expect(prompt).toMatch(/<creature_type>\nGoblin: make it a Goblin deck/);
    expect(prompt).toMatch(/<bracket>\nPower level: Bracket 2 \(Core\)/);
    expect(prompt).toMatch(/already left out of <cards>/);
    expect(prompt.indexOf("</bracket>")).toBeLessThan(prompt.indexOf("<targets>"));
    // Landfall plays 38 lands: 61 spells.
    expect(prompt).toMatch(/About 61 non-land cards/);
    expect(prompt).toMatch(/\(38 lands in all/);
  });

  it("a bracket whose lists couldn't be read asks the model to keep to it", async () => {
    s.answers.push(answer(ids(63)));
    await aiBuildCommanderDeck({ commander: KRENKO, collection: COLLECTION, random: fixed, choice: { bracket: 3 }, bracketCards: null });
    expect(String(s.calls[0].prompt)).toMatch(/couldn't check its card lists this time/);
  });
});

