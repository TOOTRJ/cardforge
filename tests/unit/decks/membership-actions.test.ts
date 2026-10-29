import { beforeEach, describe, expect, it, vi } from "vitest";
import { called, chainClient, payloadOf, type ChainAnswer, type ChainCall } from "@/tests/stubs/supabase-chain";

// ---------------------------------------------------------------------------
// Cards in and out of the owner's decks, many at a time (TODO DK9.2 — My
// Cards' "Add to deck…", the creator's box on an edit, the gallery). ONE
// deck per call: every add through add_custom_deck_entry (migration 0144's
// entry lock, source 'link') in order, never a direct insert; a result per
// card; ONE revalidation. Another creator's card only while it is PUBLIC
// (owner decision D3) — refused before the RPC, and the database's own
// refusal read as the same words. The deck's 500 entries (`deck_entry_limit`)
// stop the batch with a message a person can act on. A removal drops an
// entry the card brought and keeps a decklist line (a printing, an import)
// without the card.
// ---------------------------------------------------------------------------

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "99999999-9999-4999-8999-999999999999";
const DECK = "33333333-3333-4333-8333-333333333333";
const PRINTING = "581b7327-3215-4a4f-b4ae-d9d4002ba882";
const id = (n: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, "0")}`;

type CardRow = { id: string; title: string; owner_id: string; visibility: string; frame_preview: boolean };

const state = vi.hoisted(() => ({
  client: null as unknown,
  deck: null as null | Record<string, unknown>,
  cards: [] as CardRow[],
  /** deck_cards rows the reads answer (read-back and removals). */
  entries: [] as Array<Record<string, unknown>>,
  /** The RPC's answer per card id; default "added". */
  rpc: {} as Record<string, { data: unknown; error: null | { message: string; details?: string; code?: string } }>,
  revalidated: [] as string[],
  profileRevalidations: 0,
  signedIn: true,
}));

vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => state.client,
  getCurrentUser: async () => (state.signedIn ? { id: USER } : null),
}));
vi.mock("@/lib/profile/username", () => ({
  revalidateProfilePage: async () => {
    state.profileRevalidations += 1;
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: (path: string) => state.revalidated.push(path) }));

import { changeDeckMembershipAction, getDeckPickerDataAction } from "@/lib/decks/membership-actions";
import { MAX_MEMBERSHIP_BATCH, NOT_LINKABLE_MESSAGE } from "@/lib/decks/membership-copy";

const inArg = (calls: ChainCall[], column: string) =>
  (calls.find((c) => c.method === "in" && c.args[0] === column)?.args[1] ?? []) as string[];

function db() {
  const stub = chainClient((table, calls): ChainAnswer => {
    if (table === "decks") return { data: state.deck, error: null };
    if (table === "cards") {
      const ids = inArg(calls, "id");
      return { data: state.cards.filter((card) => ids.includes(card.id)), error: null };
    }
    if (table === "deck_cards") {
      if (called(calls, "update") || called(calls, "delete")) return { data: null, error: null };
      const ids = inArg(calls, "card_id");
      return { data: state.entries.filter((e) => ids.includes(e.card_id as string)), error: null };
    }
    return { data: null, error: null };
  });
  // The stub's rpc is typed without arguments; the action passes (fn, args).
  (stub.rpc as unknown as { mockImplementation: (impl: (fn: string, args: Record<string, unknown>) => Promise<unknown>) => void }).mockImplementation(
    async (_fn, args) => state.rpc[args.p_card_id as string] ?? { data: true, error: null },
  );
  state.client = stub.client;
  return stub;
}

const own = (n: number, visibility = "private"): CardRow => ({
  id: id(n),
  title: `Card ${n}`,
  owner_id: USER,
  visibility,
  frame_preview: false,
});
const foreign = (n: number, visibility: string): CardRow => ({ ...own(n), owner_id: OTHER, visibility });

const rpcCards = (stub: ReturnType<typeof db>) =>
  stub.rpc.mock.calls.map((call) => (call as unknown as [string, Record<string, unknown>])[1].p_card_id);

beforeEach(() => {
  state.deck = { id: DECK, slug: "goblins", title: "Goblins", owner_id: USER };
  state.cards = [];
  state.entries = [];
  state.rpc = {};
  state.revalidated = [];
  state.profileRevalidations = 0;
  state.signedIn = true;
});

describe("changeDeckMembershipAction — add", () => {
  it("adds every card through the locked RPC, in order, as a link — never a direct insert — and revalidates once", async () => {
    state.cards = [own(1, "private"), own(2, "public"), foreign(3, "public")];
    const stub = db();
    const result = await changeDeckMembershipAction({ deckId: DECK, add: [id(1), id(2), id(3)] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.results.map((r) => r.status)).toEqual(["added", "added", "added"]);
    expect(rpcCards(stub)).toEqual([id(1), id(2), id(3)]);
    for (const call of stub.rpc.mock.calls) {
      const [fn, args] = call as unknown as [string, Record<string, unknown>];
      expect(fn).toBe("add_custom_deck_entry");
      expect(args).toMatchObject({ p_deck_id: DECK, p_source: "link", p_scryfall_id: null });
    }
    expect(args3Name(stub)).toBe("Card 3");
    expect(stub.forTable("deck_cards").some((e) => called(e.calls, "insert"))).toBe(false);
    // ONE revalidation for the whole batch.
    expect(state.revalidated.filter((p) => p === "/dashboard/cards")).toHaveLength(1);
    expect(state.revalidated).toContain("/deck/goblins");
    expect(state.profileRevalidations).toBe(1);
  });

  it("refuses another creator's card that isn't public (D3) before the RPC — and one RLS hides", async () => {
    state.cards = [own(1), foreign(2, "unlisted")];
    const stub = db();
    const result = await changeDeckMembershipAction({ deckId: DECK, add: [id(1), id(2), id(3)] });
    if (!result.ok) throw new Error(result.error);
    expect(result.results).toEqual([
      { cardId: id(1), status: "added" },
      { cardId: id(2), status: "refused", error: NOT_LINKABLE_MESSAGE },
      { cardId: id(3), status: "refused", error: expect.stringMatching(/isn't available/) },
    ]);
    expect(rpcCards(stub)).toEqual([id(1)]);
  });

  it("reads the database's own D3 refusal as the same words", async () => {
    state.cards = [foreign(1, "public")];
    state.rpc[id(1)] = {
      data: null,
      error: { message: "deck_card_not_linkable: a deck links your own cards or another creator's public card" },
    };
    db();
    const result = await changeDeckMembershipAction({ deckId: DECK, add: [id(1)] });
    if (!result.ok) throw new Error(result.error);
    expect(result.results).toEqual([{ cardId: id(1), status: "refused", error: NOT_LINKABLE_MESSAGE }]);
    // Nothing changed: nothing to revalidate.
    expect(state.revalidated).toEqual([]);
  });

  it("an admin's frame preview never joins a deck", async () => {
    state.cards = [{ ...own(1), frame_preview: true }];
    const stub = db();
    const result = await changeDeckMembershipAction({ deckId: DECK, add: [id(1)] });
    if (!result.ok) throw new Error(result.error);
    expect(result.results[0]).toMatchObject({ status: "refused", error: "A frame preview never joins a deck." });
    expect(stub.rpc).not.toHaveBeenCalled();
  });

  it("keeps going past one failure, and says which", async () => {
    state.cards = [own(1), own(2), own(3)];
    state.rpc[id(2)] = { data: null, error: { message: "network blip" } };
    state.rpc[id(3)] = { data: false, error: null };
    const stub = db();
    const result = await changeDeckMembershipAction({ deckId: DECK, add: [id(1), id(2), id(3)] });
    if (!result.ok) throw new Error(result.error);
    expect(result.results).toEqual([
      { cardId: id(1), status: "added" },
      { cardId: id(2), status: "failed", error: "network blip" },
      { cardId: id(3), status: "already" },
    ]);
    expect(rpcCards(stub)).toEqual([id(1), id(2), id(3)]);
  });

  it("the 500-entry cap stops the batch with words a person can act on", async () => {
    state.cards = [own(1), own(2), own(3), own(4)];
    state.rpc[id(2)] = {
      data: null,
      error: { message: "deck_entry_limit: a deck holds at most 500 entries", details: "existing=500,adding=1" },
    };
    const stub = db();
    const result = await changeDeckMembershipAction({ deckId: DECK, add: [id(1), id(2), id(3), id(4)] });
    if (!result.ok) throw new Error(result.error);
    expect(result.results.map((r) => r.status)).toEqual(["added", "deck_full", "deck_full", "deck_full"]);
    expect(result.results[1]!.error).toBe(
      "“Goblins” is full — a deck holds at most 500 different entries. Remove some from it, or add the card to another deck.",
    );
    // No call after the deck said it was full.
    expect(rpcCards(stub)).toEqual([id(1), id(2)]);
  });

  it("hands back the deck's entries for the cards now in it (the picker's board and copies)", async () => {
    state.cards = [own(1)];
    state.entries = [{ id: "e1", deck_id: DECK, card_id: id(1), board: "side", quantity: 2 }];
    db();
    const result = await changeDeckMembershipAction({ deckId: DECK, add: [id(1)] });
    if (!result.ok) throw new Error(result.error);
    expect(result.entries).toEqual([{ cardId: id(1), deckId: DECK, entryId: "e1", board: "side", quantity: 2 }]);
  });

  it("refuses another user's deck before anything is written", async () => {
    state.deck = { id: DECK, slug: "theirs", title: "Theirs", owner_id: OTHER };
    state.cards = [own(1)];
    const stub = db();
    expect(await changeDeckMembershipAction({ deckId: DECK, add: [id(1)] })).toEqual({
      ok: false,
      error: "Deck not found or not yours.",
    });
    expect(stub.rpc).not.toHaveBeenCalled();
  });
});

describe("changeDeckMembershipAction — remove", () => {
  it("drops an entry the card brought; keeps a decklist line without the card", async () => {
    state.entries = [
      { id: "brought", deck_id: DECK, card_id: id(1), scryfall_id: null, source: "creator" },
      { id: "printing", deck_id: DECK, card_id: id(2), scryfall_id: PRINTING, source: "import" },
      { id: "restyle", deck_id: DECK, card_id: id(3), scryfall_id: PRINTING, source: "ai_remix" },
      { id: "placeholder", deck_id: DECK, card_id: id(4), scryfall_id: null, source: "import" },
      { id: "old", deck_id: DECK, card_id: id(5), scryfall_id: null },
    ];
    const stub = db();
    const result = await changeDeckMembershipAction({
      deckId: DECK,
      remove: [id(1), id(2), id(3), id(4), id(5), id(6)],
    });
    if (!result.ok) throw new Error(result.error);
    expect(result.results.map((r) => r.status)).toEqual(["removed", "removed", "removed", "removed", "removed", "not_in_deck"]);
    const writes = stub.forTable("deck_cards");
    const unlink = writes.find((e) => called(e.calls, "update"))!;
    expect(payloadOf(unlink.calls, "update")).toEqual({ card_id: null });
    expect(inArg(unlink.calls, "id")).toEqual(["printing", "restyle", "placeholder"]);
    const drop = writes.find((e) => called(e.calls, "delete"))!;
    expect(inArg(drop.calls, "id")).toEqual(["brought", "old"]);
    expect(state.revalidated.filter((p) => p === "/dashboard/cards")).toHaveLength(1);
  });

  it("a card in none of the deck's entries changes nothing", async () => {
    const stub = db();
    const result = await changeDeckMembershipAction({ deckId: DECK, remove: [id(1)] });
    if (!result.ok) throw new Error(result.error);
    expect(result.results).toEqual([{ cardId: id(1), status: "not_in_deck" }]);
    expect(stub.forTable("deck_cards").some((e) => called(e.calls, "delete") || called(e.calls, "update"))).toBe(false);
    expect(state.revalidated).toEqual([]);
  });
});

describe("changeDeckMembershipAction — input", () => {
  it("takes at most MAX_MEMBERSHIP_BATCH cards a call", async () => {
    db();
    const many = Array.from({ length: MAX_MEMBERSHIP_BATCH + 1 }, (_, i) => id(i + 1));
    const result = await changeDeckMembershipAction({ deckId: DECK, add: many });
    expect(result).toEqual({ ok: false, error: `At most ${MAX_MEMBERSHIP_BATCH} cards at a time.` });
  });

  it("refuses a card asked to join and leave at once, and an empty batch", async () => {
    db();
    expect((await changeDeckMembershipAction({ deckId: DECK, add: [id(1)], remove: [id(1)] })).ok).toBe(false);
    expect((await changeDeckMembershipAction({ deckId: DECK })).ok).toBe(false);
  });

  it("signed out: nothing is read", async () => {
    state.signedIn = false;
    const stub = db();
    expect((await changeDeckMembershipAction({ deckId: DECK, add: [id(1)] })).ok).toBe(false);
    expect(stub.log).toEqual([]);
  });
});

describe("getDeckPickerDataAction", () => {
  it("signed out says so (the picker offers sign-in)", async () => {
    state.signedIn = false;
    db();
    expect(await getDeckPickerDataAction([id(1)])).toEqual({
      ok: false,
      error: "Sign in to add cards to decks.",
      signedOut: true,
    });
  });

  it("reads only the caller's own decks' entries, for the cards asked about", async () => {
    const stub = chainClient((table, calls): ChainAnswer => {
      if (table === "decks") return { data: [{ id: DECK, title: "Goblins", slug: "goblins", format: "modern", visibility: "public" }], error: null };
      if (table === "deck_cards") {
        // One page, then the empty page that ends the read.
        const from = calls.find((c) => c.method === "range")?.args[0];
        return from === 0
          ? { data: [{ id: "e1", deck_id: DECK, card_id: id(1), board: "main", quantity: 1 }], error: null }
          : { data: [], error: null };
      }
      return { data: null, error: null };
    });
    state.client = stub.client;
    const result = await getDeckPickerDataAction([id(1)]);
    expect(result).toEqual({
      ok: true,
      decks: [{ id: DECK, title: "Goblins", slug: "goblins", format: "modern", visibility: "public" }],
      memberships: { [id(1)]: [{ deckId: DECK, entryId: "e1", board: "main", quantity: 1 }] },
    });
    const decks = stub.forTable("decks")[0]!;
    expect(decks.calls).toContainEqual({ method: "eq", args: ["owner_id", USER] });
    const entries = stub.forTable("deck_cards")[0]!;
    expect(inArg(entries.calls, "deck_id")).toEqual([DECK]);
    expect(inArg(entries.calls, "card_id")).toEqual([id(1)]);
  });
});

function args3Name(stub: ReturnType<typeof db>) {
  const call = stub.rpc.mock.calls.find((c) => (c as unknown as [string, Record<string, unknown>])[1].p_card_id === id(3));
  return (call as unknown as [string, Record<string, unknown>])[1].p_name;
}
