import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// "Add from my cards" (TODO DK4.4) — one of the caller's OWN cards into
// their deck through the locked RPC (lib/decks/membership.ts, source
// "link"); already in the deck → nothing added; the commander slot's pick
// then moves to the commander zone. Never another creator's card here.
// ---------------------------------------------------------------------------

const DECK = "11111111-1111-4111-8111-111111111111";
const CARD = "22222222-2222-4222-8222-222222222222";

const s = vi.hoisted(() => ({
  user: { id: "user-1" } as { id: string } | null,
  card: { id: "", owner_id: "user-1", title: "Ember Wyrm" } as Record<string, unknown> | null,
  add: vi.fn(),
  updates: [] as Array<{ patch: unknown; filters: Array<[string, unknown]> }>,
  updateError: null as { message: string } | null,
  revalidated: [] as string[],
}));

vi.mock("next/cache", () => ({ revalidatePath: (path: string) => s.revalidated.push(path) }));
vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/decks/membership", () => ({ addCustomCardEntryToDeck: s.add }));
vi.mock("@/lib/supabase/server", () => ({
  getCurrentUser: async () => s.user,
  createClient: async () => ({
    from: (table: string) => {
      if (table === "cards") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: s.card }) }) }) };
      }
      const filters: Array<[string, unknown]> = [];
      const chain = {
        eq: (column: string, value: unknown) => {
          filters.push([column, value]);
          return filters.length === 3 ? Promise.resolve({ error: s.updateError }) : chain;
        },
      };
      return {
        update: (patch: unknown) => {
          s.updates.push({ patch, filters });
          return chain;
        },
      };
    },
  }),
}));

import { addMyCardToDeckAction } from "@/lib/decks/add-card-action";

beforeEach(() => {
  s.user = { id: "user-1" };
  s.card = { id: CARD, owner_id: "user-1", title: "Ember Wyrm" };
  s.add.mockReset();
  s.updates = [];
  s.updateError = null;
  s.revalidated = [];
});

describe("addMyCardToDeckAction", () => {
  it("adds the caller's own card through the RPC, as a link", async () => {
    s.add.mockResolvedValue({ ok: true, deckSlug: "ness", added: true });
    expect(await addMyCardToDeckAction(DECK, CARD)).toEqual({ ok: true, added: true, title: "Ember Wyrm" });
    expect(s.add).toHaveBeenCalledWith(expect.anything(), "user-1", DECK, CARD, "Ember Wyrm", { source: "link" });
    expect(s.updates).toEqual([]);
  });

  it("the commander slot's pick moves to the commander zone", async () => {
    s.add.mockResolvedValue({ ok: true, deckSlug: "ness", added: true });
    expect(await addMyCardToDeckAction(DECK, CARD, "commander")).toEqual({ ok: true, added: true, title: "Ember Wyrm" });
    expect(s.updates).toEqual([
      { patch: { board: "commander" }, filters: [["deck_id", DECK], ["card_id", CARD], ["board", "main"]] },
    ]);
    expect(s.revalidated).toEqual(["/deck/ness"]);
  });

  it("already in the deck: nothing added, nothing moved, and it says so", async () => {
    s.add.mockResolvedValue({ ok: true, deckSlug: "ness", added: false });
    expect(await addMyCardToDeckAction(DECK, CARD, "commander")).toEqual({ ok: true, added: false, title: "Ember Wyrm" });
    expect(s.updates).toEqual([]);
  });

  it("refuses another creator's card, a stranger, bad ids and boards, and passes the RPC's refusal on", async () => {
    s.card = { id: CARD, owner_id: "someone-else", title: "Theirs" };
    expect(await addMyCardToDeckAction(DECK, CARD)).toEqual({ ok: false, error: "That card isn't one of yours." });
    s.card = null;
    expect((await addMyCardToDeckAction(DECK, CARD)).ok).toBe(false);
    s.user = null;
    expect(await addMyCardToDeckAction(DECK, CARD)).toEqual({ ok: false, error: "Sign in to edit decks." });
    expect((await addMyCardToDeckAction("nope", CARD)).ok).toBe(false);
    expect((await addMyCardToDeckAction(DECK, CARD, "side" as never)).ok).toBe(false);
    expect(s.add).not.toHaveBeenCalled();

    s.user = { id: "user-1" };
    s.card = { id: CARD, owner_id: "user-1", title: "Ember Wyrm" };
    s.add.mockResolvedValue({ ok: false, error: "This deck already holds 500 entries." });
    expect(await addMyCardToDeckAction(DECK, CARD)).toEqual({ ok: false, error: "This deck already holds 500 entries." });
  });
});
