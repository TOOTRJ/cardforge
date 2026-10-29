import { beforeEach, describe, expect, it, vi } from "vitest";
import { chainClient, called, type ChainAnswer, type ChainCall } from "@/tests/stubs/supabase-chain";

// ---------------------------------------------------------------------------
// A deck like names the deck by its link (TODO DK0.11, migration 0151): an
// UNLISTED deck is read only that way, and both the like's insert (0055's
// policy reads the deck) and the count the button settles on (another
// liker's rows follow the deck) need it. A card like names nothing.
// ---------------------------------------------------------------------------

const state = vi.hoisted(() => ({
  existing: null as { id: string } | null,
  stub: null as null | ReturnType<typeof import("@/tests/stubs/supabase-chain").chainClient>,
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/supabase/server", () => ({
  getCurrentUser: async () => ({ id: "d0000000-0000-4000-a000-000000000003" }),
  createClient: async () => state.stub!.client,
}));

import { toggleDeckLikeAction } from "@/lib/decks/likes";
import { toggleLikeAction } from "@/lib/cards/likes";

const DECK = "b0000000-0000-4000-a000-000000000007";
const CARD = "c0000000-0000-4000-a000-000000000001";

/** The settling read: `select("id", { count, head: true })`. */
const isCount = (calls: ChainCall[]) =>
  calls.some((c) => c.method === "select" && (c.args[1] as { head?: boolean } | undefined)?.head === true);

const resolve = (_table: string, calls: ChainCall[]): ChainAnswer =>
  called(calls, "maybeSingle") ? { data: state.existing } : isCount(calls) ? { count: 3 } : {};

const headerOf = (calls: ChainCall[]) => calls.find((c) => c.method === "setHeader")?.args ?? null;

beforeEach(() => {
  state.existing = null;
  state.stub = chainClient(resolve);
});

describe("toggleDeckLikeAction", () => {
  it("a like: the insert and the settling count name the deck by its id", async () => {
    const result = await toggleDeckLikeAction(DECK, "hidden-tech", "dev_pro");
    expect(result).toEqual({ ok: true, liked: true, likes_count: 3 });
    const chains = state.stub!.forTable("deck_likes");
    const insert = chains.find((e) => called(e.calls, "insert"));
    const count = chains.find((e) => isCount(e.calls));
    expect(headerOf(insert!.calls)).toEqual(["x-pipglyph-deck", DECK]);
    expect(headerOf(count!.calls)).toEqual(["x-pipglyph-deck", DECK]);
  });

  it("an unlike settles on a count that names the deck too", async () => {
    state.existing = { id: "like-1" };
    const result = await toggleDeckLikeAction(DECK, "hidden-tech", "dev_pro");
    expect(result).toMatchObject({ ok: true, liked: false });
    const count = state.stub!.forTable("deck_likes").find((e) => isCount(e.calls));
    expect(headerOf(count!.calls)).toEqual(["x-pipglyph-deck", DECK]);
  });
});

describe("toggleLikeAction (cards)", () => {
  it("names no deck", async () => {
    await toggleLikeAction(CARD, "cinderwing-matriarch", "dev_artist");
    expect(state.stub!.log.some((e) => called(e.calls, "setHeader"))).toBe(false);
  });
});
