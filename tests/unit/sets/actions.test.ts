import { beforeEach, describe, expect, it, vi } from "vitest";
import { chainClient, called, payloadOf, type ChainAnswer } from "@/tests/stubs/supabase-chain";

// ---------------------------------------------------------------------------
// Sets subsystem — membership authz, the set-icon denormalisation onto member
// cards (adopt on add, re-home on remove) with its deferred re-bake, and slug
// uniqueness. The feature is flag-hidden in the UI, but the actions are live
// server actions and the AI set generator drives them.
// ---------------------------------------------------------------------------

const OWNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_USER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const SET = "11111111-1111-4111-8111-111111111111";
const OTHER_SET = "22222222-2222-4222-8222-222222222222";
const CARD = "33333333-3333-4333-8333-333333333333";

const s = vi.hoisted(() => ({
  client: null as unknown,
  deferred: [] as Array<() => Promise<void>>,
  slugTaken: new Set<string>(),
  bake: vi.fn(async () => "https://render/x.png"),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => s.client,
  getCurrentUser: async () => ({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }),
  getCurrentUsername: async () => "owner",
}));
vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => true }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (fn: () => Promise<void>) => {
    s.deferred.push(fn);
  },
}));
vi.mock("@/lib/sets/queries", () => ({
  getSetById: vi.fn(),
  isSetSlugTakenForCurrentUser: async (slug: string) => s.slugTaken.has(slug),
}));
vi.mock("@/lib/cards/bake-render", () => ({
  bakeAndPersistCardRender: (...args: unknown[]) => s.bake(...(args as [])),
}));

import { addCardToSetAction, createSetAction, removeCardFromSetAction } from "@/lib/sets/actions";

type World = {
  setOwner?: string;
  cardOwner?: string;
  insertError?: { code: string; message: string };
  icon?: { icon_url: string | null; icon_code: string | null };
  adopted?: string[];
  primarySetId?: string | null;
  remaining?: string[];
};

function world(w: World = {}) {
  const stub = chainClient((table, calls): ChainAnswer => {
    const select = payloadOf(calls, "select");
    if (table === "card_sets" && select === "id, slug, owner_id") {
      return { data: { id: SET, slug: "alpha", owner_id: w.setOwner ?? OWNER } };
    }
    if (table === "card_sets" && select === "icon_url, icon_code") {
      return { data: w.icon ?? { icon_url: "https://x/alpha.png", icon_code: "ALP" } };
    }
    if (table === "card_sets" && called(calls, "insert")) {
      const row = payloadOf(calls, "insert") as { slug: string };
      return { data: { id: SET, slug: row.slug } };
    }
    if (table === "cards" && select === "id, owner_id") {
      return { data: { id: CARD, owner_id: w.cardOwner ?? OWNER } };
    }
    if (table === "cards" && select === "primary_set_id") {
      return { data: { primary_set_id: w.primarySetId === undefined ? SET : w.primarySetId } };
    }
    if (table === "cards" && called(calls, "update")) {
      return { data: (w.adopted ?? [CARD]).map((id) => ({ id })) };
    }
    if (table === "card_set_items" && called(calls, "insert")) {
      return { error: w.insertError ?? null };
    }
    if (table === "card_set_items" && select === "set_id") {
      return { data: (w.remaining ?? []).map((set_id) => ({ set_id })) };
    }
    return {};
  });
  s.client = stub.client;
  return stub;
}

const runDeferred = async () => {
  const fns = s.deferred.splice(0);
  for (const fn of fns) await fn();
  return fns.length;
};

beforeEach(() => {
  s.deferred = [];
  s.slugTaken = new Set();
  s.bake.mockClear();
});

describe("addCardToSetAction", () => {
  it("rejects malformed ids before any read", async () => {
    const stub = world();
    expect(await addCardToSetAction("nope", CARD)).toEqual({ ok: false, formError: "Invalid id." });
    expect(stub.log).toEqual([]);
  });

  it("requires the caller to own BOTH the set and the card", async () => {
    const notMySet = world({ setOwner: OTHER_USER });
    expect(await addCardToSetAction(SET, CARD)).toEqual({ ok: false, formError: "Set not found or not yours." });
    expect(notMySet.forTable("card_set_items")).toEqual([]);
    const notMyCard = world({ cardOwner: OTHER_USER });
    expect(await addCardToSetAction(SET, CARD)).toEqual({
      ok: false,
      formError: "You can only add cards you own to your sets.",
    });
    expect(notMyCard.forTable("card_set_items")).toEqual([]);
  });

  it("adds the membership, adopts the set's icon onto a homeless card, and re-bakes it after the response", async () => {
    const stub = world();
    expect(await addCardToSetAction(SET, CARD)).toEqual({ ok: true, setId: SET, cardId: CARD });
    expect(payloadOf(stub.forTable("card_set_items")[0]!.calls, "insert")).toEqual({
      set_id: SET,
      card_id: CARD,
      position: 0,
    });
    const adopt = stub.forTable("cards").find((e) => called(e.calls, "update"))!;
    expect(payloadOf(adopt.calls, "update")).toEqual({
      primary_set_id: SET,
      set_icon_url: "https://x/alpha.png",
      set_icon_code: "ALP",
    });
    // Only cards with no primary set adopt, scoped to the owner's rows.
    expect(adopt.calls).toEqual(
      expect.arrayContaining([
        { method: "in", args: ["id", [CARD]] },
        { method: "eq", args: ["owner_id", OWNER] },
        { method: "is", args: ["primary_set_id", null] },
      ]),
    );
    expect(s.bake).not.toHaveBeenCalled(); // not on the request path
    expect(await runDeferred()).toBe(1);
    expect(s.bake).toHaveBeenCalledWith(CARD, OWNER);
  });

  it("treats an existing membership (23505) as success and still heals the icon", async () => {
    const stub = world({ insertError: { code: "23505", message: "duplicate" } });
    expect((await addCardToSetAction(SET, CARD)).ok).toBe(true);
    expect(stub.forTable("cards").some((e) => called(e.calls, "update"))).toBe(true);
  });

  it("does not re-bake when the card already had a home set", async () => {
    world({ adopted: [] });
    expect((await addCardToSetAction(SET, CARD)).ok).toBe(true);
    expect(await runDeferred()).toBe(0);
  });
});

describe("removeCardFromSetAction", () => {
  it("deletes the membership and re-homes a card whose primary set this was to its oldest remaining set", async () => {
    const stub = world({ primarySetId: SET, remaining: [OTHER_SET], icon: { icon_url: "https://x/beta.png", icon_code: "BET" } });
    expect(await removeCardFromSetAction(SET, CARD)).toEqual({ ok: true, setId: SET, cardId: CARD });
    const del = stub.forTable("card_set_items").find((e) => called(e.calls, "delete"))!;
    expect(del.calls).toEqual(
      expect.arrayContaining([{ method: "eq", args: ["set_id", SET] }, { method: "eq", args: ["card_id", CARD] }]),
    );
    const repoint = stub.forTable("cards").find((e) => called(e.calls, "update"))!;
    expect(payloadOf(repoint.calls, "update")).toEqual({
      primary_set_id: OTHER_SET,
      set_icon_url: "https://x/beta.png",
      set_icon_code: "BET",
    });
    expect(await runDeferred()).toBe(1);
    expect(s.bake).toHaveBeenCalledWith(CARD, OWNER);
  });

  it("clears back to the default symbol when no membership remains", async () => {
    const stub = world({ primarySetId: SET, remaining: [] });
    await removeCardFromSetAction(SET, CARD);
    const repoint = stub.forTable("cards").find((e) => called(e.calls, "update"))!;
    expect(payloadOf(repoint.calls, "update")).toEqual({
      primary_set_id: null,
      set_icon_url: null,
      set_icon_code: null,
    });
  });

  it("leaves the card alone when the removed set wasn't its primary", async () => {
    const stub = world({ primarySetId: OTHER_SET });
    expect((await removeCardFromSetAction(SET, CARD)).ok).toBe(true);
    expect(stub.forTable("cards").some((e) => called(e.calls, "update"))).toBe(false);
    expect(await runDeferred()).toBe(0);
  });

  it("refuses sets the caller doesn't own", async () => {
    const stub = world({ setOwner: OTHER_USER });
    expect(await removeCardFromSetAction(SET, CARD)).toEqual({ ok: false, formError: "Set not found or not yours." });
    expect(stub.forTable("card_set_items")).toEqual([]);
  });
});

describe("createSetAction — slug uniqueness per owner", () => {
  it("suffixes a taken slug, trimming the base so the suffix always survives", async () => {
    s.slugTaken = new Set(["alpha", "alpha-2"]);
    const stub = world();
    const result = await createSetAction({ title: "Alpha", visibility: "private" });
    expect(result).toEqual({ ok: true, setId: SET, slug: "alpha-3" });
    expect((payloadOf(stub.forTable("card_sets")[0]!.calls, "insert") as { slug: string }).slug).toBe("alpha-3");

    const long = "x".repeat(90);
    s.slugTaken = new Set([long.slice(0, 80)]);
    world();
    const suffixed = await createSetAction({ title: long, visibility: "private" });
    expect(suffixed.ok && suffixed.slug).toBe(`${"x".repeat(78)}-2`);
  });
});
