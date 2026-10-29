import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// addCustomCardEntryToDeck (the creator's deck picker, AI deck steps): the
// check-then-insert runs in the database (add_custom_deck_entry, migration
// 0143) under the deck's entry lock, so two parallel saves can't both see
// "not in the deck yet". The helper only pre-checks ownership for the slug.
// ---------------------------------------------------------------------------

const s = vi.hoisted(() => ({
  deck: { id: "deck-1", slug: "dragons", owner_id: "user-1" } as Record<string, string> | null,
  rpc: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  rpcResult: { data: true as unknown, error: null as null | { message: string; details?: string } },
  inserts: 0,
  revalidated: [] as string[],
}));

vi.mock("next/cache", () => ({ revalidatePath: (p: string) => s.revalidated.push(p) }));
vi.mock("@/lib/profile/username", () => ({ revalidateProfilePage: async () => {} }));

import { addCustomCardEntryToDeck } from "@/lib/decks/membership";

const supabase = {
  from: () => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      insert: () => {
        s.inserts += 1;
        return chain;
      },
      maybeSingle: async () => ({ data: s.deck, error: null }),
    };
    return chain;
  },
  rpc: async (fn: string, args: Record<string, unknown>) => {
    s.rpc.push({ fn, args });
    return s.rpcResult;
  },
} as unknown as Parameters<typeof addCustomCardEntryToDeck>[0];

beforeEach(() => {
  s.deck = { id: "deck-1", slug: "dragons", owner_id: "user-1" };
  s.rpc = [];
  s.rpcResult = { data: true, error: null };
  s.inserts = 0;
  s.revalidated = [];
});

describe("addCustomCardEntryToDeck", () => {
  it("adds through the locked RPC, never a direct insert, and revalidates the deck", async () => {
    const result = await addCustomCardEntryToDeck(supabase, "user-1", "deck-1", "card-1", "Cinderwing");
    expect(result).toEqual({ ok: true, deckSlug: "dragons" });
    expect(s.rpc).toEqual([
      { fn: "add_custom_deck_entry", args: { p_deck_id: "deck-1", p_card_id: "card-1", p_name: "Cinderwing" } },
    ]);
    expect(s.inserts).toBe(0);
    expect(s.revalidated).toContain("/deck/dragons");
  });

  it("an entry already in the deck is fine and changes nothing", async () => {
    s.rpcResult = { data: false, error: null };
    const result = await addCustomCardEntryToDeck(supabase, "user-1", "deck-1", "card-1", "Cinderwing");
    expect(result).toEqual({ ok: true, deckSlug: "dragons" });
    expect(s.revalidated).toEqual([]);
  });

  it("refuses another user's deck before the RPC", async () => {
    s.deck = { id: "deck-1", slug: "dragons", owner_id: "someone-else" };
    const result = await addCustomCardEntryToDeck(supabase, "user-1", "deck-1", "card-1", "Cinderwing");
    expect(result.ok).toBe(false);
    expect(s.rpc).toEqual([]);
  });

  it("a full deck says so in words", async () => {
    s.rpcResult = {
      data: null,
      error: { message: "deck_entry_limit: a deck holds at most 500 entries", details: "existing=500,adding=1" },
    };
    const result = await addCustomCardEntryToDeck(supabase, "user-1", "deck-1", "card-1", "Cinderwing");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/already holds 500/);
  });
});
