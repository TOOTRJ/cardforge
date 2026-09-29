import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// deleteAccountAction — the order matters: refuse unless the user typed
// DELETE; stop Stripe billing FIRST (a deleted subscriber must never keep
// paying); best-effort storage cleanup; hard-delete the auth user; sign the
// browser out. Stripe refusing to cancel keeps the account intact. Once the
// account is gone, every one of its cards' cached copies is purged (pages,
// share images and /render-cdn bakes — tag card-<id>), after the response.
// ---------------------------------------------------------------------------

const s = vi.hoisted(() => ({
  user: { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", email: "x@example.test" } as null | { id: string; email: string },
  configured: true,
  stripeConfigured: true,
  customerId: "cus_123" as string | null,
  subs: [] as Array<{ id: string; status: string }>,
  cancelThrows: false,
  deleteError: null as null | { message: string },
  files: { "card-art": [{ name: "a.png" }] } as Record<string, Array<{ name: string }>>,
  removed: [] as Array<[string, string[]]>,
  cancelled: [] as string[],
  signOut: vi.fn(async () => ({ error: null })),
  deleteUser: vi.fn(),
  /** The user's card ids, as the cards table answers them (paged). */
  cardIds: [] as string[],
  cardsError: null as null | { message: string },
  cardPages: [] as Array<[number, number]>,
  purged: [] as string[][],
  afterTasks: [] as Array<() => unknown>,
  seq: [] as string[],
}));

vi.mock("@/lib/supabase/server", () => ({
  getCurrentUser: async () => s.user,
  createClient: async () => ({ auth: { signOut: s.signOut } }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  isAdminConfigured: () => s.configured,
  createAdminClient: () => ({
    from: (table: string) =>
      table === "cards"
        ? {
            select: () => ({
              eq: () => ({
                order: () => ({
                  range: async (from: number, to: number) => {
                    s.cardPages.push([from, to]);
                    s.seq.push("read:cards");
                    if (s.cardsError) return { data: null, error: s.cardsError };
                    // A server cap of 2 rows: the list must still be complete.
                    return { data: s.cardIds.slice(from, Math.min(to + 1, from + 2)).map((id) => ({ id })), error: null };
                  },
                }),
              }),
            }),
          }
        : {
            select: () => ({
              eq: () => ({ maybeSingle: async () => ({ data: { stripe_customer_id: s.customerId } }) }),
            }),
          },
    storage: {
      from: (bucket: string) => ({
        list: async () => ({ data: s.files[bucket] ?? [] }),
        remove: async (paths: string[]) => {
          s.removed.push([bucket, paths]);
          s.seq.push(`remove:${bucket}`);
          return { error: null };
        },
      }),
    },
    auth: { admin: { deleteUser: s.deleteUser } },
  }),
}));
vi.mock("@/lib/stripe/client", () => ({
  isStripeConfigured: () => s.stripeConfigured,
  getStripe: () => ({
    subscriptions: {
      list: async () => ({ data: s.subs }),
      cancel: async (id: string) => {
        if (s.cancelThrows) throw new Error("stripe down");
        s.cancelled.push(id);
      },
    },
  }),
}));
vi.mock("@/lib/billing/entitlements", () => ({ getEntitlements: vi.fn() }));
vi.mock("@/lib/billing/flags", () => ({ isBillingEnabled: () => true }));
vi.mock("next/server", () => ({ after: (task: () => unknown) => void s.afterTasks.push(task) }));
vi.mock("@/lib/cards/revalidate", () => ({
  purgeHiddenCards: async (ids: string[]) => {
    s.purged.push(ids);
    s.seq.push("purge");
  },
}));

import { deleteAccountAction } from "@/lib/account/actions";

const USER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

beforeEach(() => {
  s.user = { id: USER, email: "x@example.test" };
  s.configured = true;
  s.stripeConfigured = true;
  s.customerId = "cus_123";
  s.subs = [];
  s.cancelThrows = false;
  s.deleteError = null;
  s.removed = [];
  s.cancelled = [];
  s.signOut.mockClear();
  s.deleteUser.mockReset().mockImplementation(async () => {
    s.seq.push("deleteUser");
    return { error: s.deleteError };
  });
  s.cardIds = [];
  s.cardsError = null;
  s.cardPages = [];
  s.purged = [];
  s.afterTasks = [];
  s.seq = [];
});

const runAfterTasks = async () => {
  for (const task of s.afterTasks.splice(0)) await task();
};

describe("deleteAccountAction", () => {
  it("needs a signed-in user and the literal confirmation", async () => {
    s.user = null;
    expect(await deleteAccountAction({ confirm: "DELETE" })).toEqual({ ok: false, error: "You're not signed in." });
    s.user = { id: USER, email: "x@example.test" };
    expect((await deleteAccountAction({ confirm: "delete me" })).ok).toBe(false);
    expect(s.deleteUser).not.toHaveBeenCalled();
  });

  it("refuses without the service role rather than half-deleting", async () => {
    s.configured = false;
    expect((await deleteAccountAction({ confirm: "delete" })).ok).toBe(false);
    expect(s.deleteUser).not.toHaveBeenCalled();
  });

  it("keeps the account when Stripe refuses to cancel a live subscription", async () => {
    s.subs = [{ id: "sub_live", status: "active" }];
    s.cancelThrows = true;
    const result = await deleteAccountAction({ confirm: " DELETE " });
    expect(result.ok).toBe(false);
    expect(s.deleteUser).not.toHaveBeenCalled();
    expect(s.removed).toEqual([]);
  });

  it("cancels every live subscription (skipping ended ones), clears storage, deletes, signs out", async () => {
    s.subs = [
      { id: "sub_live", status: "active" },
      { id: "sub_trial", status: "trialing" },
      { id: "sub_old", status: "canceled" },
      { id: "sub_dead", status: "incomplete_expired" },
    ];
    s.files = { "card-art": [{ name: "a.png" }], "profile-media": [{ name: "avatar.webp" }] };
    expect(await deleteAccountAction({ confirm: "DELETE" })).toEqual({ ok: true });
    expect(s.cancelled).toEqual(["sub_live", "sub_trial"]);
    expect(s.removed).toEqual([
      ["card-art", [`${USER}/a.png`]],
      ["profile-media", [`${USER}/avatar.webp`]],
    ]);
    expect(s.deleteUser).toHaveBeenCalledWith(USER);
    expect(s.signOut).toHaveBeenCalledTimes(1);
  });

  it("skips Stripe entirely for accounts without a customer, and reports a failed delete", async () => {
    s.customerId = null;
    s.subs = [{ id: "sub_live", status: "active" }];
    s.deleteError = { message: "auth down" };
    const result = await deleteAccountAction({ confirm: "DELETE" });
    expect(result).toEqual({
      ok: false,
      error: "Couldn't delete your account. Please try again or contact support.",
    });
    expect(s.cancelled).toEqual([]);
    expect(s.signOut).not.toHaveBeenCalled();
  });

  it("purges every card's cached copies once the account is gone — after the response, the whole list however the server pages it", async () => {
    s.cardIds = ["c1", "c2", "c3", "c4", "c5"];
    expect(await deleteAccountAction({ confirm: "DELETE" })).toEqual({ ok: true });
    // Read before the cascade takes the rows; nothing purged inside the request.
    expect(s.seq.indexOf("read:cards")).toBeLessThan(s.seq.indexOf("deleteUser"));
    expect(s.purged).toEqual([]);
    await runAfterTasks();
    expect(s.purged).toEqual([["c1", "c2", "c3", "c4", "c5"]]);
    // Paged until an empty page, never trusting a short page to be the last.
    expect(s.cardPages.map(([from]) => from)).toEqual([0, 2, 4, 5]);
    expect(s.seq.at(-1)).toBe("purge");
  });

  it("purges nothing when the account survives, or when there are no cards; a failed card read doesn't stop the deletion", async () => {
    s.cardIds = ["c1"];
    s.deleteError = { message: "auth down" };
    expect((await deleteAccountAction({ confirm: "DELETE" })).ok).toBe(false);
    await runAfterTasks();
    expect(s.purged).toEqual([]);

    s.deleteError = null;
    s.cardIds = [];
    expect(await deleteAccountAction({ confirm: "DELETE" })).toEqual({ ok: true });
    await runAfterTasks();
    expect(s.purged).toEqual([]);

    s.cardsError = { message: "read failed" };
    s.cardIds = ["c1"];
    expect(await deleteAccountAction({ confirm: "DELETE" })).toEqual({ ok: true });
    await runAfterTasks();
    expect(s.purged).toEqual([]);
  });
});
