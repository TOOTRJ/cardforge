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
    return { object: next };
  },
}));

import { AI_BUILD_SYSTEM, AI_RETRY_MIN_PICKS, aiBuildCommanderDeck } from "@/lib/tools/collection/ai-build";
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
    expect(aiPicks.every((p) => /^Because c\d+\.$/.test(p.aiWhy ?? ""))).toBe(true);
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
