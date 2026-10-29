import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// createDeckAction's `firstCardId` (the New deck dialog's `cardId`, TODO
// DK4.2 — "Build a deck around this card" and the creator's deck box use it
// later) and the dialog's signed-out answer:
//   * the card is read through RLS (the caller can see it) and added through
//     the creator's membership helper (the `add_custom_deck_entry` RPC) once
//     the deck exists;
//   * an unreadable or refused card never fails the create — the deck is
//     made and the result says why the card isn't in it;
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
}));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({ redirect: () => {} }));
vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/decks/revalidate", () => ({ revalidateDeckPaths: () => {} }));
vi.mock("@/lib/decks/queries", () => ({ getDeckById: async () => null }));
vi.mock("@/lib/billing/entitlements", () => ({ getEntitlements: async () => ({ deckCapacity: -1, effectiveTier: "pro" }) }));
vi.mock("@/lib/supabase/admin", () => ({ isAdminConfigured: () => false, createAdminClient: () => ({}) }));
vi.mock("@/lib/analytics/funnel-server", () => ({ recordFunnelEvent: async () => "row" }));
vi.mock("@/lib/decks/membership", () => ({
  addCustomCardEntryToDeck: async (...args: unknown[]) => {
    s.addCalls.push(args.slice(1));
    return s.added;
  },
}));

function table(name: string) {
  const q = {
    select: () => q,
    eq: () => q,
    in: () => q,
    insert: () => q,
    single: async () => ({ data: { id: "deck-new", slug: "around-zoey" }, error: null }),
    maybeSingle: async () => {
      if (name === "cards") s.cardReads += 1;
      return { data: name === "cards" ? s.card : null, error: null };
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

  it("a refused add (the entry cap, a policy) keeps the deck with the helper's reason", async () => {
    s.added = { ok: false, error: "That deck already holds 500 entries." };
    const result = await createDeckAction({ title: "Around Zoey" }, { firstCardId: CARD });
    expect(result).toMatchObject({ ok: true, slug: "around-zoey", firstCardError: "That deck already holds 500 entries." });
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
