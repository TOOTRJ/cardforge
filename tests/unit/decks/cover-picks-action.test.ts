import { beforeEach, describe, expect, it, vi } from "vitest";
import { chainClient, type ChainAnswer } from "@/tests/stubs/supabase-chain";

// ---------------------------------------------------------------------------
// setDeckCoverPicksAction (TODO DK6.4) — the deck card pop-up's "Feature on
// cover" / "Remove from cover" / Earlier / Later. It sends the deck's WHOLE
// list of picks to migration 0150's set_deck_featured_entries (which holds
// the same rules in the database: the owner, five distinct entries of the
// deck — proved on the local stack), after a friendly pre-flight: ids are
// uuids, five at most, no repeat, a deck the caller owns. A refusal is the
// app's own words, never the database's; a database 0150 hasn't reached
// says the feature isn't there yet.
// ---------------------------------------------------------------------------

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "99999999-9999-4999-8999-999999999999";
const DECK = "33333333-3333-4333-8333-333333333333";
const ids = (n: number) => Array.from({ length: n }, (_, i) => `${String(i + 1).padStart(8, "0")}-0000-4000-8000-000000000000`);

const state = vi.hoisted(() => ({
  client: null as unknown,
  user: { id: "11111111-1111-4111-8111-111111111111" } as { id: string } | null,
  owner: "11111111-1111-4111-8111-111111111111",
  rpcAnswer: { data: 0, error: null } as ChainAnswer,
  revalidated: [] as string[],
}));

vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => state.client,
  getCurrentUser: async () => state.user,
}));
vi.mock("@/lib/profile/username", () => ({ revalidateProfilePage: async () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: (path: string) => state.revalidated.push(path) }));

import { setDeckCoverPicksAction } from "@/lib/decks/card-actions";

function db() {
  const stub = chainClient((table): ChainAnswer => {
    if (table === "decks") return { data: { id: DECK, slug: "dragonstorm", owner_id: state.owner }, error: null };
    return { data: null, error: null };
  });
  stub.rpc.mockImplementation(async () => state.rpcAnswer);
  state.client = stub.client;
  return stub;
}

beforeEach(() => {
  state.user = { id: USER };
  state.owner = USER;
  state.rpcAnswer = { data: 0, error: null };
  state.revalidated = [];
});

describe("setDeckCoverPicksAction", () => {
  it("sends the whole list, rank 1 first, and revalidates the deck", async () => {
    const stub = db();
    state.rpcAnswer = { data: 3, error: null };
    const picks = ids(3);
    expect(await setDeckCoverPicksAction(DECK, picks)).toEqual({ ok: true, picks: 3 });
    expect(stub.rpc).toHaveBeenCalledWith("set_deck_featured_entries", { p_deck_id: DECK, p_entry_ids: picks });
    expect(state.revalidated).toContain("/deck/dragonstorm");
  });

  it("an empty list clears the picks", async () => {
    const stub = db();
    expect(await setDeckCoverPicksAction(DECK, [])).toEqual({ ok: true, picks: 0 });
    expect(stub.rpc).toHaveBeenCalledWith("set_deck_featured_entries", { p_deck_id: DECK, p_entry_ids: [] });
  });

  it.each([
    ["six picks", ids(6), "A cover features at most 5 cards."],
    ["a repeat", [ids(1)[0], ids(1)[0]], "A card is picked twice."],
    ["a malformed id", ["nope"], "Invalid deck entry id."],
    ["not a list", "x", undefined],
  ])("refuses %s before any database call", async (_, picks, message) => {
    const stub = db();
    const result = await setDeckCoverPicksAction(DECK, picks);
    expect(result.ok).toBe(false);
    if (message) expect(result).toEqual({ ok: false, error: message });
    expect(stub.rpc).not.toHaveBeenCalled();
  });

  it("refuses a malformed deck id, nobody signed in, or another user's deck", async () => {
    let stub = db();
    expect(await setDeckCoverPicksAction("deck", ids(1))).toEqual({ ok: false, error: "Invalid deck id." });
    state.user = null;
    expect(await setDeckCoverPicksAction(DECK, ids(1))).toEqual({ ok: false, error: "Sign in to edit decks." });
    state.user = { id: USER };
    state.owner = OTHER;
    stub = db();
    expect(await setDeckCoverPicksAction(DECK, ids(1))).toEqual({ ok: false, error: "Deck not found or not yours." });
    expect(stub.rpc).not.toHaveBeenCalled();
  });

  it.each([
    [{ code: "23514", message: "deck_featured_limit: a deck's cover features at most 5 cards" }, "A cover features at most 5 cards."],
    [{ code: "22023", message: "deck_featured_invalid: every pick must be an entry of this deck" }, "That card isn't in this deck any more — reload the page."],
    [{ code: "42501", message: "deck_not_owned: deck not found or not yours" }, "Deck not found or not yours."],
    [{ code: "PGRST202", message: "Could not find the function public.set_deck_featured_entries" }, "Cover picks aren't available here yet."],
    [{ code: "XX000", message: "something else entirely" }, "The cover's cards couldn't be saved. Try again."],
  ])("a database refusal is the app's own words (%j)", async (error, words) => {
    db();
    state.rpcAnswer = { data: null, error };
    expect(await setDeckCoverPicksAction(DECK, ids(2))).toEqual({ ok: false, error: words });
    expect(state.revalidated).toEqual([]);
  });
});
