import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://pipglyph.com");
  vi.stubEnv("VERCEL_BRANCH_URL", "");
  vi.stubEnv("VERCEL_URL", "");
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

afterEach(() => {
  vi.unstubAllEnvs();
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

  it("add any public card by its page URL (the shown check alone) and purge the home page", async () => {
    expect(await addHeroPoolCardAction({ cardUrl: "https://www.pipglyph.com/card/dev_artist/cinderwing-matriarch" })).toEqual({ ok: true });
    expect(state.stub!.rpc).toHaveBeenCalledWith("featured_pool_add", {
      p_card_id: CARD,
      p_added_by: ADMIN,
      p_original_only: false,
    });
    expect(state.revalidated).toContain("/");
  });

  it("add a suggestion by id through the full original-card guard", async () => {
    expect(await addHeroPoolCardAction({ cardId: CARD })).toEqual({ ok: true });
    expect(state.stub!.rpc).toHaveBeenCalledWith("featured_pool_add", {
      p_card_id: CARD,
      p_added_by: ADMIN,
      p_original_only: true,
    });
    expect(state.revalidated).toContain("/");
  });

  it("refuse a target that isn't a string URL or id, without throwing", async () => {
    for (const bad of [{ cardUrl: 42 }, { cardId: null }, {}, null, "card"]) {
      const result = await addHeroPoolCardAction(bad as never);
      expect(result.ok).toBe(false);
    }
    expect(state.stub!.rpc).not.toHaveBeenCalled();
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

  it("resolve a mixed-case URL with a query and a hash to the lower-cased handle and slug", async () => {
    const url = "https://WWW.PipGlyph.com/card/Dev_Artist/Cinderwing-Matriarch?via=x#art";
    expect(await addHeroPoolCardAction({ cardUrl: url })).toEqual({ ok: true });
    const eqs = (table: string) =>
      state.stub!.forTable(table).flatMap((e) => e.calls.filter((c) => c.method === "eq").map((c) => c.args));
    expect(eqs("profiles")).toContainEqual(["username", "dev_artist"]);
    expect(eqs("cards")).toContainEqual(["slug", "cinderwing-matriarch"]);
    expect(state.stub!.rpc).toHaveBeenCalledWith("featured_pool_add", expect.objectContaining({ p_original_only: false }));
  });

  it("take the URL when both keys are sent: it is resolved here, and the id is dropped", async () => {
    const other = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    const both = { cardUrl: "/card/dev_artist/cinderwing-matriarch", cardId: other };
    expect(await addHeroPoolCardAction(both as never)).toEqual({ ok: true });
    expect(state.stub!.rpc).toHaveBeenCalledWith("featured_pool_add", {
      p_card_id: CARD,
      p_added_by: ADMIN,
      p_original_only: false,
    });
  });

  it("refuse another host's URL before any read", async () => {
    const result = await addHeroPoolCardAction({
      cardUrl: "https://cardforge-git-main-tootrj.vercel.app/card/dev_artist/cinderwing-matriarch",
    });
    expect(result).toEqual({ ok: false, error: "Paste a pipglyph.com card URL, e.g. /card/username/card-slug." });
    expect(state.stub!.log).toEqual([]);
    expect(state.stub!.rpc).not.toHaveBeenCalled();
  });

  it("say the shown check's refusal for a URL add", async () => {
    answer = "not_public";
    const result = await addHeroPoolCardAction({ cardUrl: "/card/dev_artist/void-tithe" });
    expect(result).toEqual({ ok: false, error: "Not public — only public cards can be on the hero." });
    expect(state.stub!.rpc).toHaveBeenCalledWith("featured_pool_add", expect.objectContaining({ p_original_only: false }));
    expect(state.revalidated).toEqual([]);
  });

  it("remove a card and purge the home page", async () => {
    expect(await removeHeroPoolCardAction(CARD)).toEqual({ ok: true });
    expect(state.stub!.forTable("featured_pool").some((e) => called(e.calls, "delete"))).toBe(true);
    expect(state.revalidated).toContain("/");
  });
});
