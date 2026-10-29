import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// createDeckAction's `firstCardId` (the New deck dialog's `cardId`, TODO
// DK4.2 — "Build a deck around this card" and the creator's deck box use it
// later) and the dialog's signed-out answer:
//   * the card is read through RLS (the caller can see it) and added through
//     the creator's membership helper (the `add_custom_deck_entry` RPC) once
//     the deck exists;
//   * an unreadable or refused card never fails the create — the deck is
//     made and the result says so in ONE plain sentence, never a database
//     error's words (RLS reads another creator's UNLISTED card back, and
//     0144's deck_card_not_linkable trigger refuses it);
//   * reuseRecentTwin (the dialog's press after a lost answer) returns the
//     same deck made in the last minute instead of a second one, and adds
//     no second funnel row; without it a create always inserts;
//   * nobody signed in → AUTH_REQUIRED, so the dialog asks to sign in.
// ---------------------------------------------------------------------------

const USER = "11111111-1111-4111-8111-111111111111";
const CARD = "44444444-4444-4444-8444-444444444444";

const s = vi.hoisted(() => ({
  user: { id: "11111111-1111-4111-8111-111111111111" } as { id: string } | null,
  card: { id: "44444444-4444-4444-8444-444444444444", title: "Zoey, the Lyricist" } as Record<string, unknown> | null,
  added: { ok: true } as { ok: boolean; error?: string },
  addCalls: [] as unknown[][],
  cardReads: 0,
  twin: null as { id: string; slug: string } | null,
  twinFilters: [] as Array<[string, unknown]>,
  inserts: 0,
  events: 0,
  /** deck_cards updates: the patch and its filters (the commander move). */
  moves: [] as Array<{ patch: unknown; filters: Array<[string, unknown]> }>,
}));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({ redirect: () => {} }));
vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/decks/revalidate", () => ({ revalidateDeckPaths: () => {} }));
vi.mock("@/lib/decks/queries", () => ({ getDeckById: async () => null }));
vi.mock("@/lib/billing/entitlements", () => ({ getEntitlements: async () => ({ deckCapacity: -1, effectiveTier: "pro" }) }));
vi.mock("@/lib/supabase/admin", () => ({ isAdminConfigured: () => true, createAdminClient: () => ({}) }));
vi.mock("@/lib/analytics/funnel-server", () => ({
  recordFunnelEvent: async () => {
    s.events += 1;
    return "row";
  },
}));
vi.mock("@/lib/decks/membership", () => ({
  addCustomCardEntryToDeck: async (...args: unknown[]) => {
    s.addCalls.push(args.slice(1));
    return s.added;
  },
}));

function table(name: string) {
  let move: { patch: unknown; filters: Array<[string, unknown]> } | null = null;
  const q = {
    select: () => q,
    eq: (column: string, value: unknown) => {
      if (name === "decks") s.twinFilters.push([column, value]);
      move?.filters.push([column, value]);
      return q;
    },
    update: (patch: unknown) => {
      move = { patch, filters: [] };
      if (name === "deck_cards") s.moves.push(move);
      return q;
    },
    in: () => q,
    gte: (column: string, value: unknown) => {
      s.twinFilters.push([column, value]);
      return q;
    },
    order: () => q,
    limit: () => q,
    insert: () => {
      s.inserts += 1;
      return q;
    },
    single: async () => ({ data: { id: "deck-new", slug: "around-zoey" }, error: null }),
    maybeSingle: async () => {
      if (name === "cards") {
        s.cardReads += 1;
        return { data: s.card, error: null };
      }
      return { data: name === "decks" ? s.twin : null, error: null };
    },
  };
  return q;
}

vi.mock("@/lib/supabase/server", () => ({
  getCurrentUser: async () => s.user,
  getCurrentUsername: async () => "me",
  createClient: async () => ({ from: (name: string) => table(name) }),
}));

import { createDeckAction } from "@/lib/decks/actions";

beforeEach(() => {
  s.user = { id: USER };
  s.card = { id: CARD, title: "Zoey, the Lyricist" };
  s.added = { ok: true };
  s.addCalls = [];
  s.cardReads = 0;
  s.twin = null;
  s.twinFilters = [];
  s.inserts = 0;
  s.events = 0;
  s.moves = [];
});

describe("createDeckAction — the card a deck starts with", () => {
  it("adds it once the deck exists", async () => {
    const result = await createDeckAction({ title: "Around Zoey" }, { surface: "dialog", firstCardId: CARD });
    expect(result).toEqual({ ok: true, deckId: "deck-new", slug: "around-zoey" });
    expect(s.addCalls).toEqual([[USER, "deck-new", CARD, "Zoey, the Lyricist"]]);
  });

  it("no card asked for: no read, no add", async () => {
    await createDeckAction({ title: "Plain" }, { surface: "dialog" });
    expect(s.cardReads).toBe(0);
    expect(s.addCalls).toEqual([]);
  });

  it("a card the caller can't see, or a malformed id, still makes the deck — and says so", async () => {
    s.card = null;
    const hidden = await createDeckAction({ title: "Around Zoey" }, { firstCardId: CARD });
    expect(hidden).toEqual({
      ok: true,
      deckId: "deck-new",
      slug: "around-zoey",
      firstCardError: "That card couldn't be added — add it from the deck page.",
    });
    const malformed = await createDeckAction({ title: "Around Zoey" }, { firstCardId: "not-a-uuid" });
    expect(malformed).toMatchObject({ ok: true, firstCardError: expect.any(String) });
    expect(s.addCalls).toEqual([]);
  });

  it("a refused add keeps the deck — in plain words, never the database's", async () => {
    // RLS reads another creator's UNLISTED card back; 0144's trigger refuses it.
    s.added = {
      ok: false,
      error: "deck_card_not_linkable: a deck links your own cards or another creator's public card",
    };
    const result = await createDeckAction({ title: "Around Zoey" }, { firstCardId: CARD });
    expect(result).toEqual({
      ok: true,
      deckId: "deck-new",
      slug: "around-zoey",
      firstCardError: "That card couldn't be added — add it from the deck page.",
    });
  });
});

describe("createDeckAction — a legendary creature leads a Commander deck (TODO DK8.3)", () => {
  const legend = { id: CARD, title: "Zoey, the Lyricist", card_type: "creature", supertype: "Legendary" };

  it("moves into the commander zone once added (the RPC adds to the main board)", async () => {
    s.card = legend;
    const result = await createDeckAction({ title: "Around Zoey", format: "commander" }, { firstCardId: CARD });
    expect(result).toEqual({ ok: true, deckId: "deck-new", slug: "around-zoey" });
    expect(s.addCalls).toEqual([[USER, "deck-new", CARD, "Zoey, the Lyricist"]]);
    expect(s.moves).toEqual([
      { patch: { board: "commander" }, filters: [["deck_id", "deck-new"], ["card_id", CARD], ["board", "main"]] },
    ]);
  });

  it.each(["brawl", "standard_brawl"])("…in %s too", async (format) => {
    s.card = legend;
    await createDeckAction({ title: "Around Zoey", format }, { firstCardId: CARD });
    expect(s.moves).toHaveLength(1);
  });

  it.each([
    ["a 60-card format", { format: "modern" }, legend],
    ["Oathbreaker (a planeswalker leads)", { format: "oathbreaker" }, legend],
    ["a non-legendary creature", { format: "commander" }, { ...legend, supertype: null }],
    ["a legendary sorcery", { format: "commander" }, { ...legend, card_type: "sorcery" }],
    ["a legendary creature TOKEN", { format: "commander" }, { ...legend, card_type: "token", supertype: "Legendary Creature" }],
  ])("stays on the main board: %s", async (_, deck, card) => {
    s.card = card;
    await createDeckAction({ title: "Around Zoey", ...deck }, { firstCardId: CARD });
    expect(s.addCalls).toHaveLength(1);
    expect(s.moves).toEqual([]);
  });

  it("a refused add moves nothing", async () => {
    s.card = legend;
    s.added = { ok: false, error: "deck_card_not_linkable" };
    await createDeckAction({ title: "Around Zoey", format: "commander" }, { firstCardId: CARD });
    expect(s.moves).toEqual([]);
  });
});

describe("createDeckAction — a press after a lost answer (reuseRecentTwin)", () => {
  it("returns the deck that create made — no second insert, no second funnel row", async () => {
    s.twin = { id: "deck-made", slug: "around-zoey" };
    const result = await createDeckAction(
      { title: "Around Zoey", format: "modern", visibility: "private" },
      { surface: "dialog", reuseRecentTwin: true },
    );
    expect(result).toEqual({ ok: true, deckId: "deck-made", slug: "around-zoey" });
    expect(s.inserts).toBe(0);
    expect(s.events).toBe(0);
    // The same owner, name, format and visibility, made within the minute.
    expect(s.twinFilters.slice(0, 4)).toEqual([
      ["owner_id", USER],
      ["title", "Around Zoey"],
      ["format", "modern"],
      ["visibility", "private"],
    ]);
    const since = Date.parse(String(s.twinFilters[4]?.[1]));
    expect(s.twinFilters[4]?.[0]).toBe("created_at");
    expect(Date.now() - since).toBeGreaterThanOrEqual(59_000);
    expect(Date.now() - since).toBeLessThan(61_000);
  });

  it("…adds its first card again only if it isn't in (the RPC adds nothing twice)", async () => {
    s.twin = { id: "deck-made", slug: "around-zoey" };
    await createDeckAction({ title: "Around Zoey" }, { reuseRecentTwin: true, firstCardId: CARD });
    expect(s.addCalls).toEqual([[USER, "deck-made", CARD, "Zoey, the Lyricist"]]);
  });

  it("no twin: a new deck as usual", async () => {
    const result = await createDeckAction({ title: "Around Zoey" }, { reuseRecentTwin: true });
    expect(result).toEqual({ ok: true, deckId: "deck-new", slug: "around-zoey" });
    expect(s.inserts).toBe(1);
    expect(s.events).toBe(1);
  });

  it("a first press never looks for one", async () => {
    s.twin = { id: "deck-made", slug: "around-zoey" };
    const result = await createDeckAction({ title: "Around Zoey" }, { surface: "dialog" });
    expect(result).toEqual({ ok: true, deckId: "deck-new", slug: "around-zoey" });
    expect(s.twinFilters).toEqual([]);
  });
});

describe("createDeckAction — signed out", () => {
  it("answers AUTH_REQUIRED, so the dialog can ask to sign in", async () => {
    s.user = null;
    expect(await createDeckAction({ title: "Anyone" })).toEqual({
      ok: false,
      code: "AUTH_REQUIRED",
      formError: "You must be signed in to do that.",
    });
  });
});
