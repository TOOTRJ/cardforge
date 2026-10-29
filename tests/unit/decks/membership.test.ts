import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// addCustomCardEntryToDeck (the creator's deck picker, AI deck steps): the
// check-then-insert runs in the database (add_custom_deck_entry, migration
// 0143) under the deck's entry lock, so two parallel saves can't both see
// "not in the deck yet". The helper only pre-checks ownership for the slug.
// Since 0144 the entry also says how it got there (p_source) and an AI
// restyle keeps its printing (p_scryfall_id) — on a database 0144 has not
// reached, the 3-argument call is the fallback.
// ---------------------------------------------------------------------------

const s = vi.hoisted(() => ({
  deck: { id: "deck-1", slug: "dragons", owner_id: "user-1" } as Record<string, string> | null,
  rpc: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  rpcResult: { data: true as unknown, error: null as null | { message: string; details?: string; code?: string } },
  /** Answers per call, in order (the fallback's second call); else rpcResult. */
  rpcQueue: [] as Array<{ data: unknown; error: null | { message: string; code?: string } }>,
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
    return s.rpcQueue.shift() ?? s.rpcResult;
  },
} as unknown as Parameters<typeof addCustomCardEntryToDeck>[0];

beforeEach(() => {
  s.deck = { id: "deck-1", slug: "dragons", owner_id: "user-1" };
  s.rpc = [];
  s.rpcResult = { data: true, error: null };
  s.rpcQueue = [];
  s.inserts = 0;
  s.revalidated = [];
});

describe("addCustomCardEntryToDeck", () => {
  it("adds through the locked RPC, never a direct insert, and revalidates the deck", async () => {
    const result = await addCustomCardEntryToDeck(supabase, "user-1", "deck-1", "card-1", "Cinderwing");
    expect(result).toEqual({ ok: true, deckSlug: "dragons", added: true });
    expect(s.rpc).toEqual([
      {
        fn: "add_custom_deck_entry",
        args: { p_deck_id: "deck-1", p_card_id: "card-1", p_name: "Cinderwing", p_source: "creator", p_scryfall_id: null },
      },
    ]);
    expect(s.inserts).toBe(0);
    expect(s.revalidated).toContain("/deck/dragons");
  });

  it("the AI's entries say so; an AI restyle keeps its printing's id and real name", async () => {
    await addCustomCardEntryToDeck(supabase, "user-1", "deck-1", "card-1", "Emberwake", { source: "ai_generate" });
    await addCustomCardEntryToDeck(supabase, "user-1", "deck-1", "card-2", "Verdant Sprout", {
      source: "ai_remix",
      scryfallId: "581B7327-3215-4A4F-B4AE-D9D4002BA882",
      name: "Llanowar Elves",
    });
    // An own card's remix (no printing): the card's title, no id.
    await addCustomCardEntryToDeck(supabase, "user-1", "deck-1", "card-3", "Restyled Matriarch", {
      source: "ai_remix",
      scryfallId: null,
      name: "Cinderwing Matriarch",
    });
    expect(s.rpc.map((call) => call.args)).toEqual([
      { p_deck_id: "deck-1", p_card_id: "card-1", p_name: "Emberwake", p_source: "ai_generate", p_scryfall_id: null },
      { p_deck_id: "deck-1", p_card_id: "card-2", p_name: "Llanowar Elves", p_source: "ai_remix", p_scryfall_id: "581b7327-3215-4a4f-b4ae-d9d4002ba882" },
      { p_deck_id: "deck-1", p_card_id: "card-3", p_name: "Restyled Matriarch", p_source: "ai_remix", p_scryfall_id: null },
    ]);
  });

  it("trusts no crafted origin past the deck owner's own entry", async () => {
    await addCustomCardEntryToDeck(supabase, "user-1", "deck-1", "card-1", "Cinderwing", {
      source: "import" as never,
      scryfallId: "not-a-uuid",
      name: "x".repeat(300),
    });
    await addCustomCardEntryToDeck(supabase, "user-1", "deck-1", "card-1", "Cinderwing", {
      source: "creator",
      scryfallId: "581b7327-3215-4a4f-b4ae-d9d4002ba882",
      name: "Llanowar Elves",
    });
    expect(s.rpc.map((call) => call.args)).toEqual([
      // An unknown source is the creator's; a bad id is dropped.
      { p_deck_id: "deck-1", p_card_id: "card-1", p_name: "Cinderwing", p_source: "creator", p_scryfall_id: null },
      // Only an AI restyle keeps a printing.
      { p_deck_id: "deck-1", p_card_id: "card-1", p_name: "Cinderwing", p_source: "creator", p_scryfall_id: null },
    ]);
  });

  it("a database without 0144: the 3-argument call, once", async () => {
    s.rpcQueue = [
      { data: null, error: { code: "PGRST202", message: "Could not find the function public.add_custom_deck_entry(p_card_id, p_deck_id, p_name, p_scryfall_id, p_source)" } },
      { data: true, error: null },
    ];
    const result = await addCustomCardEntryToDeck(supabase, "user-1", "deck-1", "card-1", "Cinderwing", { source: "ai_generate" });
    expect(result).toEqual({ ok: true, deckSlug: "dragons", added: true });
    expect(s.rpc.map((call) => call.args)).toEqual([
      { p_deck_id: "deck-1", p_card_id: "card-1", p_name: "Cinderwing", p_source: "ai_generate", p_scryfall_id: null },
      { p_deck_id: "deck-1", p_card_id: "card-1", p_name: "Cinderwing" },
    ]);
  });

  it("an entry already in the deck is fine and changes nothing", async () => {
    s.rpcResult = { data: false, error: null };
    const result = await addCustomCardEntryToDeck(supabase, "user-1", "deck-1", "card-1", "Cinderwing");
    expect(result).toEqual({ ok: true, deckSlug: "dragons", added: false });
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
