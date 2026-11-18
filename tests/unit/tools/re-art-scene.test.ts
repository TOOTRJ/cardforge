import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Re-art deck — an AI-WRITTEN SCENE for a card (migration 0217; owner
// 2026-11-18: one credit each).
//
//   * the brief the writer is given (lib/tools/re-art/scene.ts): the card's
//     name, type, rules and flavour text, the deck's world, the maker's
//     note — and never the look's words as something to repeat;
//   * the scene as it is stored: clean, within its limit, never empty;
//   * the route (POST /api/tools/re-art-deck/scene): the tool's gate, every
//     refusal that needs no AI BEFORE the charge, the credit reserved before
//     the call, the scene SAVED before the credit is settled, and the credit
//     handed back when the call fails, the scene is empty or the save fails;
//   * what the tool's log is told: counts and codes — never the scene, the
//     note or a card's name.
// ---------------------------------------------------------------------------

const USER = "11111111-1111-4111-8111-111111111111";
const DECK = "22222222-2222-4222-8222-222222222222";
const ENTRY = "33333333-3333-4333-8333-333333333333";
const CARD = "44444444-4444-4444-8444-444444444444";
const SCENE = "An old goblin chieftain in dented bronze rallies a mob on a scorched ridge, banners snapping in the dusk wind.";

type Recorded = { slug: string; userId: string | null; event: string; access: string | null; props?: Record<string, unknown> };

const m = vi.hoisted(() => ({
  access: null as null | { userId: string; via: string },
  aiConfigured: true,
  deck: null as null | { id: string; slug: string; title: string; visibility: string },
  entry: null as null | Record<string, unknown>,
  entryError: null as null | { message: string },
  card: null as null | Record<string, unknown>,
  stored: { ok: true, words: null } as { ok: true; words: null | { text: string; only: boolean } } | { ok: false },
  style: null as null | Record<string, unknown>,
  rate: { ok: true } as { ok: true } | { ok: false; reason: "per_minute" | "per_day"; retryAfterSeconds: number; message: string },
  spend: { ok: true, balance: 4, charged: true } as
    | { ok: true; balance: number; charged: boolean }
    | { ok: false; reason: "insufficient_credits" | "error"; balance: number; message: string },
  refundLands: true,
  saved: true,
  scene: "" as string | Error,
  order: [] as string[],
  spends: [] as Array<{ amount: number; reason: string; options: unknown }>,
  refunds: [] as Array<{ amount: number; reason: string; ref: string }>,
  settled: [] as string[],
  logged: [] as string[],
  writes: [] as Array<{ words: unknown; entryId: string }>,
  writerCalls: [] as Array<{ subject: unknown; style: unknown; note: unknown }>,
  events: [] as Recorded[],
  generate: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/supabase/admin", () => ({ isAdminConfigured: () => false, createAdminClient: () => ({}) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () =>
          table === "deck_cards" ? { data: m.entry, error: m.entryError } : table === "cards" ? { data: m.card, error: null } : { data: null, error: null },
      };
      return chain;
    },
  }),
}));
vi.mock("@/lib/tools/queries", () => ({ checkToolAccess: async () => m.access }));
vi.mock("@/lib/tools/events", () => ({
  recordToolEventLater: (input: Recorded) => {
    m.events.push(input);
    // Never settles: a route that awaited its own bookkeeping would hang.
    return new Promise(() => undefined);
  },
}));
vi.mock("@/lib/ai/provider", () => ({ isDesignAiConfigured: () => m.aiConfigured, designModel: () => ({ modelId: "test" }) }));
vi.mock("@/lib/ai/rate-limit", () => ({
  checkAiRateLimit: async () => m.rate,
  getFreshCreditBalance: async () => 3,
  logAiCall: async (_user: string, label: string) => {
    m.logged.push(label);
  },
  spendCredits: async (amount: number, reason: string, options: unknown) => {
    m.order.push("spend");
    m.spends.push({ amount, reason, options });
    return m.spend;
  },
  refundCredits: async (_user: string, amount: number, reason: string, ref: string) => {
    m.order.push("refund");
    m.refunds.push({ amount, reason, ref });
    return m.refundLands;
  },
  settleSpend: async (ref: string) => {
    m.order.push("settle");
    m.settled.push(ref);
  },
}));
vi.mock("@/lib/billing/flags", () => ({ isBillingEnabled: () => true }));
vi.mock("@/lib/billing/credit-reconcile", () => ({ reconcileUserSpends: vi.fn() }));
vi.mock("@/lib/tools/re-art/server", () => ({
  getOwnedDeck: async () => m.deck,
  readCardWordsAdmin: async () => m.stored,
  readDeckStyle: async () => m.style,
  saveCardWords: async (_user: string, _deck: string, entryId: string, words: unknown) => {
    m.order.push("save");
    m.writes.push({ words, entryId });
    return m.saved;
  },
}));
// The writer itself is the real one; only the model's answer is made up.
vi.mock("ai", () => ({ generateObject: m.generate }));

import { POST } from "@/app/api/tools/re-art-deck/scene/route";
import {
  REART_SCENE_AI_LABEL,
  REART_SCENE_SYSTEM,
  cleanReartScene,
  reartSceneBrief,
  reartSceneSaysSomething,
  writeReartScene,
} from "@/lib/tools/re-art/scene";
import {
  REART_CARD_WORDS_MAX,
  REART_SCENE_CREDITS,
  REART_SCENE_HELP,
  REART_SCENE_MAX,
  REART_SCENE_ONLY_NOTE,
  reartSceneCost,
  reartScenesKeptLine,
  reartScenesLine,
  reartScenesOnlyLine,
  reartScenesReplaceLabel,
  reartScenesReplaceLine,
} from "@/lib/tools/re-art/model";

const post = (body: unknown) =>
  POST(new Request("http://localhost/api/tools/re-art-deck/scene", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }));
const answer = async (body: unknown) => {
  const response = await post(body);
  return { status: response.status, body: (await response.json()) as Record<string, unknown>, headers: response.headers };
};
const BODY = { deckId: DECK, entryId: ENTRY };
const eventsOf = () => m.events.map((event) => [event.event, event.props] as const);

beforeEach(() => {
  m.access = { userId: USER, via: "grant" };
  m.aiConfigured = true;
  m.deck = { id: DECK, slug: "embers", title: "Embers of the Fen", visibility: "private" };
  m.entry = { id: ENTRY, name: "Goblin Chieftain", board: "main", card_id: null, scryfall_id: "89fcc35b-76fa-4408-8620-a1e11b2caf1f", type_line: "Creature — Goblin" };
  m.entryError = null;
  m.card = null;
  m.stored = { ok: true, words: null };
  m.style = { preset: "watercolor", theme: "a haunted fen", mode: "preset", prompt: "", version: 3 };
  m.rate = { ok: true };
  m.spend = { ok: true, balance: 4, charged: true };
  m.refundLands = true;
  m.saved = true;
  m.scene = SCENE;
  for (const list of [m.order, m.spends, m.refunds, m.settled, m.logged, m.writes, m.writerCalls, m.events]) list.length = 0;
  m.generate.mockReset();
  m.generate.mockImplementation(async (options: { system: string; prompt: string }) => {
    m.order.push("write");
    m.writerCalls.push({ subject: options.prompt, style: options.system, note: null });
    if (m.scene instanceof Error) throw m.scene;
    return { object: { scene: m.scene } };
  });
});

describe("what a scene costs, in words", () => {
  it("one credit each — the label's price, the button's and the batch's are one number", () => {
    expect(REART_SCENE_CREDITS).toBe(1);
    expect(reartSceneCost(1)).toBe("1 credit");
    expect(reartSceneCost(12)).toBe("12 credits");
    expect(reartScenesLine(1)).toBe("Writes a scene for 1 card · 1 credit");
    expect(reartScenesLine(12)).toBe("Writes a scene for 12 cards · 12 credits");
  });

  it("says before anything is charged that the words are replaced, saved at once, and that nothing is painted", () => {
    expect(REART_SCENE_HELP).toMatch(/replaces this card's words/);
    expect(REART_SCENE_HELP).toMatch(/saved at once/);
    expect(REART_SCENE_HELP).toMatch(/painted in the deck's look/);
    expect(REART_SCENE_HELP).toMatch(/Nothing is painted now/);
    // A card set to “use only these words” is told what a scene does to that.
    expect(REART_SCENE_ONLY_NOTE).toMatch(/“Use only these words” is turned off/);
    expect(reartScenesOnlyLine(0)).toBe("");
    expect(reartScenesOnlyLine(1)).toBe("1 is set to “Use only these words”: with a scene it is painted in the deck's look again.");
    expect(reartScenesOnlyLine(3)).toBe("3 are set to “Use only these words”: with a scene they are painted in the deck's look again.");
    expect(reartScenesReplaceLine(5, 0)).toBe("");
    expect(reartScenesReplaceLine(1, 1)).toBe("It has words of its own: they are replaced.");
    expect(reartScenesReplaceLine(5, 1)).toBe("1 of them has words of its own: those are replaced.");
    expect(reartScenesReplaceLine(5, 3)).toBe("3 of them have words of their own: those are replaced.");
    // A batch leaves such cards alone unless the maker ticks the box.
    expect(reartScenesKeptLine(0)).toBe("");
    expect(reartScenesKeptLine(1)).toBe("1 card picked already has words of its own and is left as it is.");
    expect(reartScenesKeptLine(4)).toBe("4 cards picked already have words of their own and are left as they are.");
    expect(reartScenesReplaceLabel(1)).toBe("Also replace the words of the card that has its own");
    expect(reartScenesReplaceLabel(4)).toBe("Also replace the words of the 4 cards that have their own");
  });

  it("a scene leaves the maker room to add to it", () => {
    expect(REART_SCENE_MAX).toBeLessThan(REART_CARD_WORDS_MAX);
  });
});

describe("the brief the writer is given", () => {
  const subject = { name: "Archivist of Lost Hours", typeLine: "Creature — Human Wizard", rulesText: "{T}: Draw a card, then discard a card.", flavorText: "“Every hour is filed somewhere.”" };
  const style = { preset: "watercolor", theme: "a haunted fen", mode: "preset" as const, prompt: "" };

  it("names the card, its type, what it does (symbols left out), its flavour and the deck's world", () => {
    const brief = reartSceneBrief(subject, style, null);
    expect(brief).toContain("Card: Archivist of Lost Hours");
    expect(brief).toContain("Type: Creature — Human Wizard");
    expect(brief).toContain("What it does: : Draw a card, then discard a card.");
    expect(brief).not.toContain("{T}");
    expect(brief).toContain("Its flavour text: “Every hour is filed somewhere.”");
    expect(brief).toContain("The deck's world: a haunted fen");
    // The look is context, never something to repeat.
    expect(brief).toMatch(/It will be painted as: .+ \(context only: do not name it\)\./);
    expect(brief).not.toMatch(/The maker's direction/);
  });

  it("carries the maker's direction, clean and bounded", () => {
    const brief = reartSceneBrief(subject, style, "  asleep on a heap\n\nof overdue books  ");
    expect(brief).toContain("The maker's direction for this card: asleep on a heap of overdue books");
    expect(reartSceneBrief(subject, style, "x".repeat(2000)).length).toBeLessThan(1600);
  });

  it("a real card gives its name and type alone; no saved style gives no world", () => {
    const brief = reartSceneBrief({ name: "Sol Ring", typeLine: "Artifact", rulesText: null, flavorText: null }, null, null);
    expect(brief).toBe("Card: Sol Ring\nType: Artifact");
  });

  it("the maker's own deck prompt is context only; a licensed property is the deck's world", () => {
    const own = reartSceneBrief(subject, { preset: "watercolor", theme: "ignored", mode: "custom", prompt: "{card}. Thick oil paint, candle light." }, null);
    expect(own).toMatch(/The deck's own picture prompt, for context only \(do not repeat its style words\): .*Thick oil paint/);
    expect(own).not.toContain("It will be painted as");
    expect(own).not.toContain("ignored");
    const licensed = reartSceneBrief(subject, { ...style, ipName: "Emberfall Chronicles" }, null);
    expect(licensed).toContain("The deck's world: Emberfall Chronicles (the maker holds the rights to it).");
  });

  it("the writer is told what a picture's prompt needs: what is seen, no style, no text, nothing a provider refuses", () => {
    for (const rule of [
      /at most 50 words/,
      /Do not use the card's name as if the painter knew it/,
      /No game words/,
      /Name no art style, medium, artist/,
      /No text, lettering, logos, borders or card frames/,
      /fully clothed/,
      /no real people/,
      /A land is a place/,
      /When the maker gives a direction, follow it/,
    ]) {
      expect(REART_SCENE_SYSTEM).toMatch(rule);
    }
  });
});

describe("a scene as it is stored", () => {
  it("is one clean line, without the PAIR of quotation marks the writer wrapped it in — a lone mark belongs to the text", () => {
    expect(cleanReartScene(`  “A heron\n stands in the reeds.”  `)).toBe("A heron stands in the reeds.");
    expect(cleanReartScene(`A sign nailed to the gate reads 'Beware`)).toBe(`A sign nailed to the gate reads 'Beware`);
    expect(cleanReartScene(`"Halt," says the guard at the gate.`)).toBe(`"Halt," says the guard at the gate.`);
    // Marks round its first and last WORDS are the text's own too.
    expect(cleanReartScene(`'Halt' is carved over the gate, and under it 'or else'`)).toBe(`'Halt' is carved over the gate, and under it 'or else'`);
  });

  it("past its limit it ends on a whole sentence, else a whole word — never mid-word", () => {
    const long = `${"A tall heron stands in the grey reeds at dawn. ".repeat(12)}`.trim();
    const cut = cleanReartScene(long);
    expect(cut.length).toBeLessThanOrEqual(REART_SCENE_MAX);
    expect(cut.endsWith("dawn.")).toBe(true);
    const oneSentence = `A heron ${"very ".repeat(120)}tall`;
    const word = cleanReartScene(oneSentence);
    expect(word.length).toBeLessThanOrEqual(REART_SCENE_MAX);
    expect(word.endsWith("very")).toBe(true);
  });

  it("text with no space to go back to (a language written without them) is cut AT the limit — it was cut to one character", () => {
    const cjk = "霧の沼に立つ青い鷺。".repeat(60);
    const cut = cleanReartScene(cjk);
    expect([...cut].length).toBeGreaterThan(300);
    expect(cut.length).toBeLessThanOrEqual(REART_SCENE_MAX);
    // A short scene in such a language is a scene — with a space between
    // its sentences, or a Latin name in it, too (it counted as "three words").
    expect(cleanReartScene("霧の沼に立つ青い鷺と古い礼拝堂。")).toBe("霧の沼に立つ青い鷺と古い礼拝堂。");
    expect(cleanReartScene("霧の沼に立つ青い鷺。 古い礼拝堂の前で夜明けを待つ。")).not.toBe("");
    expect(cleanReartScene("雾中的沼泽里，Krenko 站在古老的礼拜堂前。")).not.toBe("");
  });

  it("nothing a picture can show is empty (the route refunds it)", () => {
    for (const nothing of ["", "   ", "…", "“”", ". . .", null, undefined]) expect(cleanReartScene(nothing)).toBe("");
  });

  it("the writer DECLINING is not a scene — it would be saved, charged for and painted from in a batch nobody reads", () => {
    for (const refusal of [
      "I'm sorry, but I can't help with that request.",
      "I’m sorry, I can’t write that.",
      "I cannot comply with this request.",
      "I can not help with that.",
      "Sorry, that isn't something I can describe.",
      "As an AI, I am unable to depict this.",
      "I am unable to write a scene for this card.",
      "Unable to write this scene.",
      "I apologize, but I cannot describe this card.",
      "Unfortunately, I can't write a scene for that.",
      "I'm afraid I can't help with this one.",
      "My apologies, that is not something I can write.",
      "I do not feel comfortable writing this scene.",
      "This request goes against my guidelines.",
      "I must decline to write that scene.",
      "N/A",
      "n/a",
      "None",
      "Nothing.",
      "No scene.",
      // Too little to paint from.
      "A goblin.",
      "Goblin chieftain",
    ]) {
      expect(cleanReartScene(refusal), refusal).toBe("");
      expect(reartSceneSaysSomething(refusal), refusal).toBe(false);
    }
    // A scene that merely begins with one of those words is a scene.
    expect(cleanReartScene("Nothing stirs in the drowned chapel but one candle, guttering on the altar.")).not.toBe("");
    expect(cleanReartScene("None of the goblins notice the wyrm uncoiling in the rafters above their feast.")).not.toBe("");
    expect(cleanReartScene("Unable to rise, a wounded griffin drags one wing through the ash of the burnt orchard.")).not.toBe("");
    expect(cleanReartScene("Sorry-eyed hounds wait at the gate of the drowned manor, rain beading on their coats.")).not.toBe("");
  });

  it("the writer hands back the clean scene, and throws on one that says nothing", async () => {
    m.scene = `"${SCENE}"`;
    expect(await writeReartScene({ name: "Goblin Chieftain", typeLine: "Creature — Goblin", rulesText: null, flavorText: null }, null, null)).toBe(SCENE);
    for (const nothing of [" … ", "I'm sorry, but I can't help with that request."]) {
      m.scene = nothing;
      await expect(writeReartScene({ name: "Goblin Chieftain", typeLine: null, rulesText: null, flavorText: null }, null, null)).rejects.toMatchObject({ name: "AiOutputError" });
    }
  });
});

describe("POST /api/tools/re-art-deck/scene", () => {
  it("a closed tool answers 404 (with a code a batch stops on) and records nothing", async () => {
    m.access = null;
    expect(await answer(BODY)).toMatchObject({ status: 404, body: { ok: false, code: "CLOSED" } });
    expect(m.events).toEqual([]);
    expect(m.spends).toEqual([]);
  });

  it("everything that needs no AI refuses BEFORE the charge", async () => {
    const refusals: Array<[() => void, unknown, number, string]> = [
      [() => (m.aiConfigured = false), BODY, 503, "ai_unavailable"],
      [() => undefined, "not json", 400, "invalid"],
      [() => undefined, { deckId: "nope", entryId: ENTRY }, 400, "invalid"],
      [() => undefined, { ...BODY, note: "x".repeat(REART_CARD_WORDS_MAX * 2 + 1) }, 400, "invalid"],
      [() => (m.deck = null), BODY, 404, "not_owner"],
      [() => (m.entryError = { message: "boom" }), BODY, 503, "unread"],
      [() => (m.entry = null), BODY, 404, "gone"],
      [() => (m.entry = { ...m.entry, board: "maybe" }), BODY, 400, "not_paintable"],
      [() => (m.stored = { ok: false }), BODY, 503, "unread"],
      [() => (m.rate = { ok: false, reason: "per_minute", retryAfterSeconds: 60, message: "Slow down." }), BODY, 429, "rate_limited"],
    ];
    for (const [arrange, body, status, reason] of refusals) {
      // (beforeEach's state, then one thing wrong.)
      m.aiConfigured = true;
      m.deck = { id: DECK, slug: "embers", title: "Embers of the Fen", visibility: "private" };
      m.entry = { id: ENTRY, name: "Goblin Chieftain", board: "main", card_id: null, scryfall_id: "89fcc35b-76fa-4408-8620-a1e11b2caf1f", type_line: "Creature — Goblin" };
      m.entryError = null;
      m.stored = { ok: true, words: null };
      m.rate = { ok: true };
      m.events.length = 0;
      arrange();
      const result = await answer(body);
      expect([reason, result.status]).toEqual([reason, status]);
      expect(result.body.ok).toBe(false);
      expect(m.events.map((event) => [event.event, event.props?.reason])).toEqual([["write_scene_failed", reason]]);
    }
    expect(m.spends).toEqual([]);
    expect(m.generate).not.toHaveBeenCalled();
    expect(m.writes).toEqual([]);
  });

  it("a card the tool never paints gets no scene: another creator's card, an emblem, a card that is gone — said in the list's own words", async () => {
    m.entry = { ...m.entry, card_id: CARD };
    m.card = { id: CARD, owner_id: "someone-else", title: "Cinderwing", card_type: "creature", supertype: null, subtypes: [], rules_text: null, flavor_text: null };
    expect(await answer(BODY)).toMatchObject({ status: 400, body: { ok: false, code: "NOT_PAINTABLE", error: "Another creator's card keeps its own art." } });
    m.card = { ...m.card, owner_id: USER, card_type: "emblem" };
    expect((await answer(BODY)).body.error).toBe("Emblems keep their art.");
    m.card = null;
    expect((await answer(BODY)).body.error).toBe("No longer available.");
    expect(m.spends).toEqual([]);
  });

  it("a rate limit says when to come back", async () => {
    m.rate = { ok: false, reason: "per_day", retryAfterSeconds: 3600, message: "Daily AI quota reached." };
    const result = await answer(BODY);
    expect(result).toMatchObject({ status: 429, body: { ok: false, code: "RATE_LIMITED", error: "Daily AI quota reached.", retryAfterSeconds: 3600 } });
    expect(result.headers.get("Retry-After")).toBe("3600");
  });

  it("no credit left: 402, nothing written, and the log says so", async () => {
    m.spend = { ok: false, reason: "insufficient_credits", balance: 0, message: "You're out of credits." };
    expect(await answer(BODY)).toMatchObject({ status: 402, body: { ok: false, code: "INSUFFICIENT_CREDITS", credits: 0 } });
    m.spend = { ok: false, reason: "error", balance: Number.NaN, message: "We couldn't check your credits." };
    expect(await answer(BODY)).toMatchObject({ status: 503, body: { ok: false, code: "CREDIT_CHECK_FAILED" } });
    expect(m.generate).not.toHaveBeenCalled();
    expect(m.events.map((event) => event.props?.reason)).toEqual(["insufficient_credits", "credit_check_failed"]);
  });

  it("writes the scene: ONE credit reserved first (fail closed), the scene SAVED as the card's words, THEN settled", async () => {
    const result = await answer(BODY);
    expect(result).toMatchObject({ status: 200, body: { ok: true, words: { text: SCENE, only: false }, previous: null, credits: 3 } });
    expect(m.order).toEqual(["spend", "write", "save", "settle"]);
    expect(m.spends).toHaveLength(1);
    expect(m.spends[0]).toMatchObject({ amount: 1, reason: REART_SCENE_AI_LABEL, options: { failClosed: true } });
    const ref = (m.spends[0].options as { ref: string }).ref;
    expect(ref).toMatch(/^spend:re-art-scene:[0-9a-f-]{36}$/);
    expect(m.settled).toEqual([ref]);
    expect(m.logged).toEqual([REART_SCENE_AI_LABEL]);
    expect(m.writes).toEqual([{ entryId: ENTRY, words: { text: SCENE, only: false } }]);
    expect(m.refunds).toEqual([]);
    // A real card: its name and type are what the writer gets.
    expect(m.writerCalls[0].subject).toBe("Card: Goblin Chieftain\nType: Creature — Goblin\nThe deck's world: a haunted fen\nIt will be painted as: Watercolor (context only: do not name it).");
  });

  it("the maker's own card gives the writer its type line as the card prints it, its rules and its flavour — and the note typed", async () => {
    m.entry = { ...m.entry, name: "Archivist", card_id: CARD, scryfall_id: null, type_line: "Creature" };
    m.card = {
      id: CARD,
      owner_id: USER,
      title: "Archivist of Lost Hours",
      card_type: "creature",
      supertype: "Legendary",
      subtypes: ["Human", "Wizard"],
      rules_text: "Flying",
      flavor_text: "Every hour is filed somewhere.",
    };
    await answer({ ...BODY, note: "asleep on a heap of overdue books" });
    const brief = m.writerCalls[0].subject as string;
    expect(brief).toContain("Card: Archivist of Lost Hours");
    expect(brief).toContain("Type: Legendary Creature — Human Wizard");
    expect(brief).toContain("What it does: Flying");
    expect(brief).toContain("Its flavour text: Every hour is filed somewhere.");
    expect(brief).toContain("The maker's direction for this card: asleep on a heap of overdue books");
  });

  it("replaces the words the card had and hands them back (the dialog's way back)", async () => {
    m.stored = { ok: true, words: { text: "an old librarian", only: false } };
    expect((await answer(BODY)).body).toMatchObject({ words: { text: SCENE, only: false }, previous: { text: "an old librarian", only: false } });
  });

  it("a scene is NEVER “use only these words”: it names no style, so alone it would be painted out of the deck's look", async () => {
    // The card was set to it; a request can't ask for it either.
    m.stored = { ok: true, words: { text: "an old librarian", only: true } };
    expect((await answer(BODY)).body).toMatchObject({ words: { text: SCENE, only: false }, previous: { text: "an old librarian", only: true } });
    expect((await answer({ ...BODY, only: true })).body).toMatchObject({ words: { only: false } });
    expect(m.writes.every((write) => (write.words as { only: boolean }).only === false)).toBe(true);
    expect(m.events.at(-1)).toMatchObject({ event: "write_scene", props: { was_only: true } });
  });

  it("a failed call hands the credit back, saves nothing and settles nothing", async () => {
    m.scene = new Error("upstream connect error");
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await answer(BODY);
    expect(result.status).toBe(502);
    expect(result.body.ok).toBe(false);
    // The credit first, the refund last — and neither a save nor a settle between.
    expect(m.order[0]).toBe("spend");
    expect(m.order.at(-1)).toBe("refund");
    expect(m.order).not.toContain("save");
    expect(m.order).not.toContain("settle");
    expect(m.refunds).toHaveLength(1);
    expect(m.refunds[0]).toMatchObject({ amount: 1, reason: REART_SCENE_AI_LABEL, ref: `refund:${(m.spends[0].options as { ref: string }).ref}` });
    expect(m.writes).toEqual([]);
    expect(m.settled).toEqual([]);
    expect(m.events.at(-1)).toMatchObject({ event: "write_scene_failed", props: { refunded: true, refund_pending: false } });
    logged.mockRestore();
  });

  it("a scene that says nothing is a failure too: refunded, never saved", async () => {
    m.scene = " … ";
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await answer(BODY);
    expect(result).toMatchObject({ status: 502, body: { ok: false, code: "design_unreadable" } });
    expect(m.refunds).toHaveLength(1);
    expect(m.writes).toEqual([]);
    expect(m.settled).toEqual([]);
    logged.mockRestore();
  });

  it("a scene that couldn't be SAVED is not paid for: refunded, never settled, and said", async () => {
    m.saved = false;
    const result = await answer(BODY);
    expect(result).toMatchObject({ status: 500, body: { ok: false, error: "The scene couldn't be saved — nothing was charged. Try again." } });
    expect(m.order).toEqual(["spend", "write", "save", "refund"]);
    expect(m.settled).toEqual([]);
    expect(m.events.at(-1)).toMatchObject({ event: "write_scene_failed", props: { reason: "not_saved", refunded: true } });
    // The refund itself didn't land: said honestly (the reconcile returns it).
    m.refundLands = false;
    expect((await answer(BODY)).body.error).toBe("The scene couldn't be saved. Your credit is on its way back.");
    expect(m.events.at(-1)).toMatchObject({ props: { refunded: false, refund_pending: true } });
  });

  it("a call that charged nothing (an admin, billing off) settles nothing and refunds nothing", async () => {
    m.spend = { ok: true, balance: Number.POSITIVE_INFINITY, charged: false };
    expect((await answer(BODY)).status).toBe(200);
    expect(m.settled).toEqual([]);
    expect(m.events.at(-1)).toMatchObject({ event: "write_scene", props: { credits: 0 } });
    m.scene = new Error("boom");
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await answer(BODY);
    expect(m.refunds).toEqual([]);
    expect(m.events.at(-1)).toMatchObject({ props: { refunded: false, refund_pending: false } });
    logged.mockRestore();
  });

  it("tells the tool's log what happened in counts and codes — never the scene, the note, a name or an id", async () => {
    m.stored = { ok: true, words: { text: "an old librarian", only: false } };
    await answer({ ...BODY, note: "asleep on a heap of overdue books" });
    expect(eventsOf()).toEqual([
      ["write_scene", { kind: "printing", had_words: true, was_only: false, note: true, chars: SCENE.length, credits: 1, ms: expect.any(Number) }],
    ]);
    const told = JSON.stringify(m.events);
    for (const secret of ["goblin", "Goblin", "librarian", "overdue", "chieftain", ENTRY, DECK]) expect(told).not.toContain(secret);
    for (const event of m.events) {
      expect(event).toMatchObject({ slug: "re-art-deck", userId: USER, access: "grant" });
      expect(Object.keys(event.props ?? {}).length).toBeLessThanOrEqual(12);
      for (const key of Object.keys(event.props ?? {})) expect(key).toMatch(/^[a-z0-9_]+$/);
    }
  });
});
