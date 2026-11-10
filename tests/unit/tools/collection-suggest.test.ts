import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CollectionCard } from "@/lib/tools/collection/card-row";
import type { ScoringCard } from "@/lib/tools/collection/commander-scores";

// ---------------------------------------------------------------------------
// "Suggest a commander" (owner decision 2026-11-09): the CODE shortlists and
// scores the user's own commanders — the best ~30, at most six per colour
// identity, a preferred deck type first, the wanted colours only — and
// lists, per commander, the user's own cards that play into its plan under
// shared ids; the AI ranks and explains, and its answer is checked here:
// unknown or repeated commanders dropped, key cards only from that
// commander's own list, fewer than three usable a failed call.
// ---------------------------------------------------------------------------

const s = vi.hoisted(() => ({ calls: [] as Record<string, unknown>[], answer: null as unknown }));

vi.mock("server-only", () => ({}));
vi.mock("ai", () => ({
  generateObject: async (args: Record<string, unknown>) => {
    s.calls.push(args);
    return { object: s.answer };
  },
}));

import {
  SUGGEST_PER_IDENTITY,
  SUGGEST_SHORTLIST,
  SUGGEST_SUPPORT_CARDS,
  suggestShortlist,
} from "@/lib/tools/collection/suggest-shortlist";
import { AI_SUGGEST_SYSTEM, checkSuggestions, suggestCommanders, suggestPrompt, suggestSchema } from "@/lib/tools/collection/ai-suggest";

let seq = 0;
function commander(name: string, colorIdentity: string[], oracleText = "", typeLine = "Legendary Creature — Human"): CollectionCard {
  seq += 1;
  return {
    id: `c0000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    scryfallId: `s0000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    name,
    typeLine,
    manaCost: "{2}",
    manaValue: 2,
    colorIdentity,
    oracleText,
    rarity: "rare",
    setCode: "tst",
    setName: "Test",
    collectorNumber: String(seq),
    imageUrl: null,
    quantity: 1,
    finish: "nonfoil",
    lang: "en",
    commanderLegal: true,
    canBeCommander: true,
  };
}
function owned(name: string, colorIdentity: string[], oracleText = "", typeLine = "Creature — Human"): ScoringCard {
  seq += 1;
  return { id: `r0000000-0000-4000-8000-${String(seq).padStart(12, "0")}`, name, typeLine, oracleText, colorIdentity, commanderLegal: true };
}

const KRENKO = commander("Krenko", ["R"], "{T}: Create X 1/1 red Goblin creature tokens, where X is the number of Goblins you control.", "Legendary Creature — Goblin Warrior");
const MEREN = commander("Meren", ["B", "G"], "Whenever another creature you control dies, you get an experience counter.");
const TALRAND = commander("Talrand", ["U"], "Whenever you cast an instant or sorcery spell, create a 2/2 blue Drake creature token with flying.");
const goblins = Array.from({ length: 15 }, (_, i) => owned(`Goblin ${i}`, ["R"], "", "Creature — Goblin"));
const spells = Array.from({ length: 6 }, (_, i) => owned(`Spell ${i}`, ["U"], "Draw two cards.", "Instant"));
const CARDS = [...goblins, ...spells];

beforeEach(() => {
  s.calls = [];
  s.answer = null;
});

describe("the shortlist", () => {
  it("lists each commander's own supporting cards, inside its colours, under ids shared across the list", () => {
    const list = suggestShortlist({ commanders: [KRENKO, MEREN, TALRAND], cards: CARDS });
    const krenko = list.find((e) => e.commander.id === KRENKO.id)!;
    expect(krenko.cards).toHaveLength(SUGGEST_SUPPORT_CARDS);
    expect(krenko.cards.every((c) => c.name.startsWith("Goblin"))).toBe(true);
    expect(list.find((e) => e.commander.id === MEREN.id)!.cards).toEqual([]);
    const refs = list.flatMap((e) => e.cards.map((c) => c.ref));
    expect(new Set(refs).size).toBe(refs.length);
    expect(list.map((e) => e.ref)).toEqual(["k0", "k1", "k2"]);
  });

  it("keeps the best 30, at most six of one colour identity", () => {
    const reds = Array.from({ length: 10 }, (_, i) => commander(`Red ${i}`, ["R"]));
    const blues = Array.from({ length: 40 }, (_, i) => commander(`Blue ${i}`, ["U"], "", "Legendary Creature — Human"));
    const greens = Array.from({ length: 40 }, (_, i) => commander(`Green ${i}`, ["G"]));
    const list = suggestShortlist({ commanders: [...reds, ...blues, ...greens], cards: CARDS });
    const perIdentity = new Map<string, number>();
    for (const e of list) {
      const key = e.commander.colorIdentity.join("");
      perIdentity.set(key, (perIdentity.get(key) ?? 0) + 1);
    }
    expect(Math.max(...perIdentity.values())).toBeLessThanOrEqual(SUGGEST_PER_IDENTITY);
    expect(list.length).toBeLessThanOrEqual(SUGGEST_SHORTLIST);
  });

  it("a preferred deck type ranks its commanders first; wanted colours narrow the list", () => {
    const byType = suggestShortlist({ commanders: [MEREN, KRENKO, TALRAND], cards: CARDS, preferences: { deckType: "spellslinger" } });
    expect(byType[0].commander.id).toBe(TALRAND.id);
    const red = suggestShortlist({ commanders: [MEREN, KRENKO, TALRAND], cards: CARDS, preferences: { colours: ["R"] } });
    expect(red.map((e) => e.commander.id)).toEqual([KRENKO.id]);
  });
});

describe("the prompt", () => {
  it("puts the collection and the commanders first, the preferences after, the task last", () => {
    const list = suggestShortlist({ commanders: [KRENKO, MEREN, TALRAND], cards: CARDS });
    const prompt = suggestPrompt(list, CARDS, { deckType: "tokens", bracket: 2 });
    expect(prompt.startsWith("<collection>\n")).toBe(true);
    expect(prompt.indexOf("</collection>")).toBeLessThan(prompt.indexOf("<commanders>"));
    expect(prompt.indexOf("</commanders>")).toBeLessThan(prompt.indexOf("<preferences>"));
    expect(prompt).toMatch(/<commander id="k0">/);
    expect(prompt).toMatch(/The player's cards: your cards in its colours: \d+ · fit its plan: \d+ · ramp/);
    expect(prompt).toMatch(/Deck type wanted: Tokens/);
    expect(prompt).toMatch(/Power level: Bracket 2/);
    expect(prompt.trim().split("\n").at(-1)).toMatch(/^Rank up to 8 of these commanders now/);
    expect(AI_SUGGEST_SYSTEM).toMatch(/answer only with commander ids from <commanders>/);
  });
});

describe("the answer, checked", () => {
  const list = () => suggestShortlist({ commanders: [KRENKO, MEREN, TALRAND], cards: CARDS });

  it("drops unknown and repeated commanders, keeps key cards only from that commander's own list", () => {
    const shortlist = list();
    const krenko = shortlist.find((e) => e.commander.id === KRENKO.id)!;
    const talrand = shortlist.find((e) => e.commander.id === TALRAND.id)!;
    const result = checkSuggestions(
      suggestSchema.parse({
        overview: "Lots of goblins.",
        suggestions: [
          { commander: krenko.ref, deckType: "Tokens", pitch: "Go wide.", why: "Your goblins.", keyCards: [krenko.cards[0].ref, talrand.cards[0]?.ref ?? "c999", "c999"], gaps: "" },
          { commander: "k99", deckType: "any", pitch: "", why: "", keyCards: [], gaps: "" },
          { commander: krenko.ref, deckType: "tokens", pitch: "Again", why: "", keyCards: [], gaps: "" },
          { commander: talrand.ref, deckType: "storm", pitch: "Spells.", why: null, keyCards: null, gaps: null },
        ],
      }),
      shortlist,
    );
    expect(result.suggestions.map((x) => x.name)).toEqual(["Krenko", "Talrand"]);
    expect(result.suggestions[0].deckType).toBe("tokens");
    expect(result.suggestions[0].keyCards).toEqual([{ id: krenko.cards[0].id, name: krenko.cards[0].name }]);
    expect(result.suggestions[1].deckType).toBeNull();
    expect(result.suggestions[1].support).toBe(talrand.support);
  });

  it("fewer than three usable suggestions is a failed call (the route refunds)", async () => {
    const shortlist = list();
    s.answer = { overview: "x", suggestions: [{ commander: "k0", deckType: "any", pitch: "", why: "", keyCards: [], gaps: "" }] };
    await expect(suggestCommanders({ shortlist, cards: CARDS, preferences: {} })).rejects.toMatchObject({ name: "AiOutputError" });
    s.answer = {
      overview: "x",
      suggestions: shortlist.map((e) => ({ commander: e.ref, deckType: "any", pitch: "p", why: "w", keyCards: [], gaps: "" })),
    };
    const ok = await suggestCommanders({ shortlist, cards: CARDS, preferences: {} });
    expect(ok.suggestions).toHaveLength(3);
    expect(s.calls.at(-1)?.temperature).toBeUndefined();
  });
});
