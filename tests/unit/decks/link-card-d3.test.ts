import { beforeEach, describe, expect, it, vi } from "vitest";
import { called, chainClient, payloadOf, type ChainAnswer } from "@/tests/stubs/supabase-chain";

// ---------------------------------------------------------------------------
// Linking a card onto a deck entry (owner decision D3, TODO DK2.9): the deck's
// owner may link their own card at any visibility or another creator's
// PUBLIC card; another creator's unlisted card is refused, and a private one
// is not even readable (RLS answers nothing). The database holds the same
// rule (migration 0144, proved on the local stack); this is the action's
// friendly pre-flight. The link writes `card_id` alone — the entry keeps its
// source.
// ---------------------------------------------------------------------------

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "99999999-9999-4999-8999-999999999999";
const ENTRY = "22222222-2222-4222-8222-222222222222";
const DECK = "33333333-3333-4333-8333-333333333333";
const CARD = "44444444-4444-4444-8444-444444444444";

const state = vi.hoisted(() => ({
  client: null as unknown,
  card: null as null | { id: string; owner_id: string; visibility: string },
  /** The entry row as `select("*")` reads it. */
  entry: { id: "", deck_id: "" } as Record<string, unknown>,
}));

vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => state.client,
  getCurrentUser: async () => ({ id: USER }),
}));
vi.mock("@/lib/profile/username", () => ({ revalidateProfilePage: async () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { linkDeckCardAction, unlinkDeckCardAction } from "@/lib/decks/card-actions";

function db() {
  const stub = chainClient((table, calls): ChainAnswer => {
    if (table === "deck_cards" && called(calls, "update")) return { data: null, error: null };
    if (table === "deck_cards") return { data: { id: ENTRY, deck_id: DECK, ...state.entry }, error: null };
    if (table === "decks") return { data: { id: DECK, slug: "sampler", owner_id: USER }, error: null };
    if (table === "cards") return { data: state.card, error: null };
    return { data: null, error: null };
  });
  state.client = stub.client;
  return stub;
}

const linkWrite = (stub: ReturnType<typeof db>) => {
  const update = stub.forTable("deck_cards").find((e) => called(e.calls, "update"));
  return update ? (payloadOf(update.calls, "update") as Record<string, unknown>) : null;
};

beforeEach(() => {
  state.card = null;
  state.entry = {};
});

describe("linkDeckCardAction (D3)", () => {
  it.each(["public", "unlisted", "private"])("links the caller's own %s card", async (visibility) => {
    state.card = { id: CARD, owner_id: USER, visibility };
    const stub = db();
    expect(await linkDeckCardAction(ENTRY, CARD)).toEqual({ ok: true, deckCardId: ENTRY });
    expect(linkWrite(stub)).toEqual({ card_id: CARD });
  });

  it("links another creator's PUBLIC card", async () => {
    state.card = { id: CARD, owner_id: OTHER, visibility: "public" };
    const stub = db();
    expect(await linkDeckCardAction(ENTRY, CARD)).toEqual({ ok: true, deckCardId: ENTRY });
    expect(linkWrite(stub)).toEqual({ card_id: CARD });
  });

  it("refuses another creator's UNLISTED card, before any write", async () => {
    state.card = { id: CARD, owner_id: OTHER, visibility: "unlisted" };
    const stub = db();
    const result = await linkDeckCardAction(ENTRY, CARD);
    expect(result.ok).toBe(false);
    expect(linkWrite(stub)).toBeNull();
  });

  it("refuses a card RLS hides (another creator's private card)", async () => {
    state.card = null;
    const stub = db();
    const result = await linkDeckCardAction(ENTRY, CARD);
    expect(result).toEqual({ ok: false, error: "You can link your own cards, or another creator's public card." });
    expect(linkWrite(stub)).toBeNull();
  });
});

describe("unlinkDeckCardAction (L2: an unlink is not a deleted card)", () => {
  it("a card-brought entry with no printing loses its source with its card: a plain name", async () => {
    for (const source of ["creator", "link", "ai_generate", "ai_remix"]) {
      state.entry = { card_id: CARD, scryfall_id: null, source };
      const stub = db();
      expect(await unlinkDeckCardAction(ENTRY)).toEqual({ ok: true, deckCardId: ENTRY });
      expect(linkWrite(stub)).toEqual({ card_id: null, source: null });
    }
  });

  it("an import keeps its source (it is the real card again); so does an entry with no source column yet", async () => {
    for (const entry of [
      { card_id: CARD, scryfall_id: "581b7327-3215-4a4f-b4ae-d9d4002ba882", source: "import" },
      { card_id: CARD, scryfall_id: "581b7327-3215-4a4f-b4ae-d9d4002ba882", source: "ai_remix" },
      { card_id: CARD, scryfall_id: null },
      { card_id: CARD, scryfall_id: null, source: null },
    ]) {
      state.entry = entry;
      const stub = db();
      await unlinkDeckCardAction(ENTRY);
      expect(linkWrite(stub)).toEqual({ card_id: null });
    }
  });
});
