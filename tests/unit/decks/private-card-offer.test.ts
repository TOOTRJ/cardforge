import { beforeEach, describe, expect, it, vi } from "vitest";
import { chainClient, type ChainAnswer, type ChainCall } from "@/tests/stubs/supabase-chain";

// ---------------------------------------------------------------------------
// TODO DK0.13 (owner 2026-10-29): the maker's own PRIVATE card asked into a
// deck others can open (public or unlisted) — decided by the SERVER, from
// the rows:
//   privateCards "ask"  → not added, nothing written ("private_card"), with
//                         the reason when its text keeps it private;
//   publish [ids]       → made public FIRST through the site's visibility
//                         change (updateCardsVisibilityAction, every gate),
//                         then added; still private after it → not added
//                         ("publish_refused"), never silently;
//   "keep" (default)    → added as it is (today's behaviour).
// No question for a private deck, a public card, or another creator's card.
// privateCardOfferAction is the same answer as a read; linkDeckCardAction's
// `publish` does the same for a link. The word is ROT13'd: the repo is public.
// ---------------------------------------------------------------------------

const rot13 = (text: string) =>
  text.replace(/[a-z]/g, (c) => String.fromCharCode(((c.charCodeAt(0) - 97 + 13) % 26) + 97));
const STRONG = rot13("fuvg");

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "99999999-9999-4999-8999-999999999999";
const DECK = "33333333-3333-4333-8333-333333333333";
const ENTRY = "44444444-4444-4444-8444-444444444444";
const id = (n: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, "0")}`;

type CardRow = {
  id: string;
  title: string;
  owner_id: string;
  visibility: string;
  frame_preview: boolean;
  rules_text?: string | null;
};

const state = vi.hoisted(() => ({
  client: null as unknown,
  deck: null as null | Record<string, unknown>,
  cards: [] as Array<Record<string, unknown>>,
  /** What the site's visibility change answers (and does). */
  publish: null as null | ((ids: string[]) => { ok: true; count: number; skippedPreviews: number } | { ok: false; error: string }),
  published: [] as string[][],
  /** The publish really changes the row (false: it answers ok, changes nothing). */
  publishFlips: true,
  rpcCards: [] as string[],
  linked: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => state.client,
  getCurrentUser: async () => ({ id: USER }),
}));
vi.mock("@/lib/supabase/admin", () => ({ isAdminConfigured: () => false, createAdminClient: () => null }));
vi.mock("@/lib/profile/username", () => ({ revalidateProfilePage: async () => undefined }));
vi.mock("@/lib/decks/revalidate", () => ({
  revalidateDeckEntryChange: async () => undefined,
  revalidateDeckCardPaths: async () => undefined,
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, unstable_cache: (fn: unknown) => fn }));
vi.mock("@/lib/cards/actions", () => ({
  updateCardsVisibilityAction: async (ids: string[], visibility: string) => {
    expect(visibility).toBe("public");
    state.published.push(ids);
    const answer = state.publish ? state.publish(ids) : { ok: true as const, count: ids.length, skippedPreviews: 0 };
    if (answer.ok && state.publishFlips) {
      for (const card of state.cards) if (ids.includes(card.id as string)) card.visibility = "public";
    }
    return answer;
  },
}));

import { changeDeckMembershipAction, privateCardOfferAction } from "@/lib/decks/membership-actions";
import { linkDeckCardAction } from "@/lib/decks/card-actions";

const inArg = (calls: ChainCall[], column: string) =>
  (calls.find((c) => c.method === "in" && c.args[0] === column)?.args[1] ?? []) as string[];
const eqArg = (calls: ChainCall[], column: string) => calls.find((c) => c.method === "eq" && c.args[0] === column)?.args[1];

function db() {
  const stub = chainClient((table, calls): ChainAnswer => {
    if (table === "decks") return { data: state.deck, error: null };
    if (table === "cards") {
      const one = eqArg(calls, "id");
      if (one) return { data: state.cards.find((card) => card.id === one) ?? null, error: null };
      const ids = inArg(calls, "id");
      return { data: state.cards.filter((card) => ids.includes(card.id as string)), error: null };
    }
    if (table === "deck_cards") {
      const update = calls.find((c) => c.method === "update");
      if (update) {
        state.linked.push(update.args[0] as Record<string, unknown>);
        return { data: null, error: null };
      }
      if (eqArg(calls, "id") === ENTRY) {
        return {
          data: { id: ENTRY, deck_id: DECK, card_id: null, scryfall_id: null, decks: { owner_id: USER, slug: "goblins" } },
          error: null,
        };
      }
      const ids = inArg(calls, "card_id");
      return {
        data: ids.map((cardId, i) => ({ id: `e${i}`, deck_id: DECK, card_id: cardId, board: "main", quantity: 1 })),
        error: null,
      };
    }
    return { data: null, error: null };
  });
  (stub.rpc as unknown as { mockImplementation: (impl: (fn: string, args: Record<string, unknown>) => Promise<unknown>) => void }).mockImplementation(
    async (_fn, args) => {
      state.rpcCards.push(args.p_card_id as string);
      return { data: true, error: null };
    },
  );
  state.client = stub.client;
  return stub;
}

const card = (n: number, visibility: string, extra: Partial<CardRow> = {}): CardRow => ({
  id: id(n),
  title: `Card ${n}`,
  owner_id: USER,
  visibility,
  frame_preview: false,
  rules_text: "Flying.",
  ...extra,
});

beforeEach(() => {
  state.deck = { id: DECK, slug: "goblins", title: "Goblins", owner_id: USER, visibility: "public" };
  state.cards = [];
  state.publish = null;
  state.published = [];
  state.publishFlips = true;
  state.rpcCards = [];
  state.linked = [];
  db();
});

describe("changeDeckMembershipAction — a private card into a deck others can open (DK0.13)", () => {
  it("asks: an own private card is not added, nothing is written, and the others go in", async () => {
    state.cards = [card(1, "private"), card(2, "public"), card(3, "public", { owner_id: OTHER })];
    const result = await changeDeckMembershipAction({ deckId: DECK, add: [id(1), id(2), id(3)], privateCards: "ask" });
    if (!result.ok) throw new Error(result.error);
    expect(result.results).toEqual([
      { cardId: id(1), status: "private_card" },
      { cardId: id(2), status: "added" },
      { cardId: id(3), status: "added" },
    ]);
    expect(state.rpcCards).toEqual([id(2), id(3)]);
    expect(state.published).toEqual([]);
  });

  it("asks in an UNLISTED deck too", async () => {
    state.deck = { ...state.deck, visibility: "unlisted" };
    state.cards = [card(1, "private")];
    const result = await changeDeckMembershipAction({ deckId: DECK, add: [id(1)], privateCards: "ask" });
    if (!result.ok) throw new Error(result.error);
    expect(result.results[0]?.status).toBe("private_card");
  });

  it("never asks for a PRIVATE deck, an unlisted card or a frame preview — today's add (or refusal)", async () => {
    state.deck = { ...state.deck, visibility: "private" };
    state.cards = [card(1, "private")];
    let result = await changeDeckMembershipAction({ deckId: DECK, add: [id(1)], privateCards: "ask" });
    if (!result.ok) throw new Error(result.error);
    expect(result.results).toEqual([{ cardId: id(1), status: "added" }]);

    state.deck = { ...state.deck, visibility: "public" };
    state.cards = [card(2, "unlisted"), card(3, "private", { frame_preview: true })];
    result = await changeDeckMembershipAction({ deckId: DECK, add: [id(2), id(3)], privateCards: "ask" });
    if (!result.ok) throw new Error(result.error);
    expect(result.results.map((r) => r.status)).toEqual(["added", "refused"]);
  });

  it("names the reason when its text keeps it private (strong language)", async () => {
    state.cards = [card(1, "private", { rules_text: `Flying. ${STRONG}.` })];
    const result = await changeDeckMembershipAction({ deckId: DECK, add: [id(1)], privateCards: "ask" });
    if (!result.ok) throw new Error(result.error);
    expect(result.results[0]).toEqual({
      cardId: id(1),
      status: "private_card",
      languageReason: expect.stringMatching(/rules text includes strong language/),
    });
  });

  it("keep (the default, an Undo): added as it is, no question", async () => {
    state.cards = [card(1, "private")];
    const result = await changeDeckMembershipAction({ deckId: DECK, add: [id(1)] });
    if (!result.ok) throw new Error(result.error);
    expect(result.results).toEqual([{ cardId: id(1), status: "added" }]);
    expect(state.published).toEqual([]);
  });

  it("publish: made public through the site's visibility change FIRST, then added", async () => {
    state.cards = [card(1, "private"), card(2, "private")];
    const result = await changeDeckMembershipAction({ deckId: DECK, add: [id(1), id(2)], publish: [id(1)] });
    if (!result.ok) throw new Error(result.error);
    expect(state.published).toEqual([[id(1)]]);
    // Card 2 was not asked to go public: added as it is.
    expect(result.results).toEqual([
      { cardId: id(1), status: "added", published: true },
      { cardId: id(2), status: "added" },
    ]);
    expect(state.rpcCards).toEqual([id(1), id(2)]);
  });

  it("publish refused: the card is NOT added, and the refusal says why", async () => {
    state.cards = [card(1, "private")];
    state.publish = () => ({ ok: false, error: "Name the second face of “Card 1” in the editor before publishing — nothing was changed." });
    const result = await changeDeckMembershipAction({ deckId: DECK, add: [id(1)], publish: [id(1)] });
    if (!result.ok) throw new Error(result.error);
    expect(result.results).toEqual([
      { cardId: id(1), status: "publish_refused", error: expect.stringMatching(/Name the second face/) },
    ]);
    expect(state.rpcCards).toEqual([]);
  });

  it("publish of a card its text keeps private: never sent, not added", async () => {
    state.cards = [card(1, "private", { rules_text: STRONG })];
    const result = await changeDeckMembershipAction({ deckId: DECK, add: [id(1)], publish: [id(1)] });
    if (!result.ok) throw new Error(result.error);
    expect(state.published).toEqual([]);
    expect(result.results[0]).toMatchObject({ status: "publish_refused", error: expect.stringMatching(/strong language/) });
    expect(state.rpcCards).toEqual([]);
  });

  it("a publish that answers ok but left the card private is read back — not added", async () => {
    state.cards = [card(1, "private")];
    state.publishFlips = false;
    const result = await changeDeckMembershipAction({ deckId: DECK, add: [id(1)], publish: [id(1)] });
    if (!result.ok) throw new Error(result.error);
    expect(result.results[0]?.status).toBe("publish_refused");
    expect(state.rpcCards).toEqual([]);
  });

  it("publish is never taken for another creator's card, and only for a card being added", async () => {
    state.cards = [card(1, "public", { owner_id: OTHER })];
    const result = await changeDeckMembershipAction({ deckId: DECK, add: [id(1)], publish: [id(1)] });
    if (!result.ok) throw new Error(result.error);
    expect(state.published).toEqual([]);
    expect(result.results).toEqual([{ cardId: id(1), status: "added" }]);
    const refused = await changeDeckMembershipAction({ deckId: DECK, add: [id(1)], publish: [id(2)] });
    expect(refused.ok).toBe(false);
  });
});

describe("privateCardOfferAction — the same answer as a read", () => {
  it("lists the own private cards a public deck would mask, with the reason; writes nothing", async () => {
    state.cards = [
      card(1, "private"),
      card(2, "private", { rules_text: STRONG }),
      card(3, "public"),
      card(4, "public", { owner_id: OTHER }),
    ];
    const result = await privateCardOfferAction({ deckId: DECK, cardIds: [id(1), id(2), id(3), id(4)] });
    expect(result).toEqual({
      ok: true,
      cards: [{ cardId: id(1) }, { cardId: id(2), languageReason: expect.stringMatching(/strong language/) }],
    });
    expect(state.rpcCards).toEqual([]);
    expect(state.published).toEqual([]);
  });

  it("asks nothing of a private deck, and refuses another owner's deck", async () => {
    state.cards = [card(1, "private")];
    state.deck = { ...state.deck, visibility: "private" };
    expect(await privateCardOfferAction({ deckId: DECK, cardIds: [id(1)] })).toEqual({ ok: true, cards: [] });
    state.deck = { ...state.deck, owner_id: OTHER, visibility: "public" };
    expect((await privateCardOfferAction({ deckId: DECK, cardIds: [id(1)] })).ok).toBe(false);
  });
});

describe("linkDeckCardAction — publish then link", () => {
  it("makes the own private card public first, then links it", async () => {
    state.cards = [card(1, "private")];
    const result = await linkDeckCardAction(ENTRY, id(1), { publish: true });
    expect(result).toEqual({ ok: true, deckCardId: ENTRY });
    expect(state.published).toEqual([[id(1)]]);
    expect(state.linked).toEqual([{ card_id: id(1) }]);
  });

  it("a card its text keeps private is not linked, and the answer says why", async () => {
    state.cards = [card(1, "private", { rules_text: STRONG })];
    const result = await linkDeckCardAction(ENTRY, id(1), { publish: true });
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/strong language/) });
    expect(state.published).toEqual([]);
    expect(state.linked).toEqual([]);
  });

  it("a refused publish links nothing", async () => {
    state.cards = [card(1, "private")];
    state.publish = () => ({ ok: false, error: "Nope." });
    const result = await linkDeckCardAction(ENTRY, id(1), { publish: true });
    expect(result).toEqual({ ok: false, error: "Nope." });
    expect(state.linked).toEqual([]);
  });

  it("without publish: linked as it is (today's behaviour)", async () => {
    state.cards = [card(1, "private")];
    const result = await linkDeckCardAction(ENTRY, id(1));
    expect(result.ok).toBe(true);
    expect(state.published).toEqual([]);
  });
});
