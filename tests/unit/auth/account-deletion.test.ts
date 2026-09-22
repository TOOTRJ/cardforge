import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// deleteAccountAction — the order matters: refuse unless the user typed
// DELETE; stop Stripe billing FIRST (a deleted subscriber must never keep
// paying); best-effort storage cleanup; hard-delete the auth user; sign the
// browser out. Stripe refusing to cancel keeps the account intact.
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
}));

vi.mock("@/lib/supabase/server", () => ({
  getCurrentUser: async () => s.user,
  createClient: async () => ({ auth: { signOut: s.signOut } }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  isAdminConfigured: () => s.configured,
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: { stripe_customer_id: s.customerId } }) }),
      }),
    }),
    storage: {
      from: (bucket: string) => ({
        list: async () => ({ data: s.files[bucket] ?? [] }),
        remove: async (paths: string[]) => {
          s.removed.push([bucket, paths]);
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
  s.deleteUser.mockReset().mockImplementation(async () => ({ error: s.deleteError }));
});

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
});
