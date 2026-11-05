import { beforeEach, describe, expect, it, vi } from "vitest";
import { called, chainClient } from "@/tests/stubs/supabase-chain";

// ---------------------------------------------------------------------------
// The hero pool's admin writes (TODO HM4, migration 0169): admins only, the
// database's guard decides (the action says its answer), and every change
// purges the home page at once.
// ---------------------------------------------------------------------------

const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CARD = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OWNER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const state = vi.hoisted(() => ({
  profile: null as null | { id: string; is_admin: boolean },
  stub: null as null | ReturnType<typeof import("@/tests/stubs/supabase-chain").chainClient>,
  revalidated: [] as string[],
}));

vi.mock("next/cache", () => ({ revalidatePath: (p: string) => state.revalidated.push(p) }));
vi.mock("@/lib/supabase/server", () => ({ getCurrentProfile: async () => state.profile }));
vi.mock("@/lib/supabase/admin", () => ({
  isAdminConfigured: () => true,
  createAdminClient: () => state.stub!.client,
}));

import { addHeroPoolCardAction, removeHeroPoolCardAction } from "@/lib/featured/actions";

let answer: string;

beforeEach(() => {
  state.profile = { id: ADMIN, is_admin: true };
  state.revalidated = [];
  answer = "added";
  state.stub = chainClient((table) => {
    if (table === "profiles") return { data: { id: OWNER } };
    if (table === "cards") return { data: { id: CARD } };
    return {};
  });
  state.stub.rpc.mockImplementation(async () => ({ data: answer, error: null }));
});

describe("the hero pool actions", () => {
  it("refuse anyone but an admin, before any read or write", async () => {
    state.profile = { id: ADMIN, is_admin: false };
    expect(await addHeroPoolCardAction({ cardId: CARD })).toEqual({ ok: false, error: "Not authorized." });
    expect(await removeHeroPoolCardAction(CARD)).toEqual({ ok: false, error: "Not authorized." });
    expect(state.stub!.log).toEqual([]);
    expect(state.stub!.rpc).not.toHaveBeenCalled();
    expect(state.revalidated).toEqual([]);
  });

  it("add a card by its page URL through featured_pool_add and purge the home page", async () => {
    expect(await addHeroPoolCardAction({ cardUrl: "https://www.pipglyph.com/card/dev_artist/cinderwing-matriarch" })).toEqual({ ok: true });
    expect(state.stub!.rpc).toHaveBeenCalledWith("featured_pool_add", { p_card_id: CARD, p_added_by: ADMIN });
    expect(state.revalidated).toContain("/");
  });

  it("add a suggestion by id", async () => {
    expect(await addHeroPoolCardAction({ cardId: CARD })).toEqual({ ok: true });
    expect(state.revalidated).toContain("/");
  });

  it("say the guard's refusal and change nothing", async () => {
    answer = "from_real_card";
    const result = await addHeroPoolCardAction({ cardId: CARD });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/real card/);
    expect(state.revalidated).toEqual([]);
  });

  it("report a card already in the pool without a purge", async () => {
    answer = "already";
    expect(await addHeroPoolCardAction({ cardId: CARD })).toEqual({ ok: true, already: true });
    expect(state.revalidated).toEqual([]);
  });

  it("refuse a URL that names no card page, and an id that isn't one", async () => {
    expect((await addHeroPoolCardAction({ cardUrl: "/deck/ember-wyrm" })).ok).toBe(false);
    expect((await addHeroPoolCardAction({ cardId: "not-a-uuid" })).ok).toBe(false);
    expect(state.stub!.rpc).not.toHaveBeenCalled();
  });

  it("remove a card and purge the home page", async () => {
    expect(await removeHeroPoolCardAction(CARD)).toEqual({ ok: true });
    expect(state.stub!.forTable("featured_pool").some((e) => called(e.calls, "delete"))).toBe(true);
    expect(state.revalidated).toContain("/");
  });
});
