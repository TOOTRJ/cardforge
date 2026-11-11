import { describe, expect, it, vi } from "vitest";
import { recordActivity, recordFunnelEvent, recordSignup } from "@/lib/analytics/funnel-server";
import { SIGNUP_METHODS, sanitizeFunnelProps, signupMethodOf } from "@/lib/analytics/funnel-events";

function makeAdmin(existingFirst: boolean) {
  const inserts: Array<Record<string, unknown>> = [];
  const admin = {
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        inserts.push(row);
        return { select: () => ({ single: async () => ({ data: { id: `fe_${inserts.length}` }, error: null }) }) };
      },
      select: () => {
        const chain = {
          eq: () => chain,
          limit: () => chain,
          maybeSingle: async () => ({ data: existingFirst ? { id: "fe_first" } : null, error: null }),
        };
        return chain;
      },
    }),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { admin: admin as any, inserts };
}

describe("recordFunnelEvent / recordActivity", () => {
  it("writes the row with sanitized props and returns its id; unknown events are dropped", async () => {
    const { admin, inserts } = makeAdmin(false);
    const id = await recordFunnelEvent(admin, { event: "checkout_started", userId: "u1", props: { tier: "pro", email: "x@y" } });
    expect(id).toBe("fe_1");
    expect(inserts).toEqual([{ event: "checkout_started", user_id: "u1", props: { tier: "pro" }, source: "server" }]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await recordFunnelEvent(admin, { event: "nope" as any, userId: "u1" })).toBeNull();
    expect(inserts).toHaveLength(1);
  });

  it("an activity records the activity row AND the once-per-user milestone the first time only", async () => {
    const first = makeAdmin(false);
    await recordActivity(first.admin, { userId: "u1", kind: "card_saved", props: { visibility: "public" } });
    expect(first.inserts.map((r) => r.event)).toEqual(["card_saved", "first_card_saved"]);

    const again = makeAdmin(true);
    await recordActivity(again.admin, { userId: "u1", kind: "download", props: { format: "png" } });
    expect(again.inserts.map((r) => r.event)).toEqual(["download"]);
  });
});

// Migration 0197: a user has ONE signup row and ONE of each "first". The
// writer was check-then-insert with nothing behind it, so two AI job steps
// or a ZIP export at once wrote several firsts for one user.
describe("once-per-user events (0197's unique index)", () => {
  /** An admin whose milestone insert the database refuses as a duplicate. */
  function conflicting(existingOnRead: boolean) {
    const inserts: Array<Record<string, unknown>> = [];
    const once = new Set(["signup", "first_card_saved", "first_ai_generation", "first_download"]);
    const admin = {
      from: () => ({
        insert: (row: Record<string, unknown>) => {
          inserts.push(row);
          const refused = once.has(String(row.event));
          return {
            select: () => ({
              single: async () =>
                refused
                  ? { data: null, error: { code: "23505", message: 'duplicate key value violates unique constraint "funnel_events_once_per_user_idx"' } }
                  : { data: { id: `fe_${inserts.length}` }, error: null },
            }),
          };
        },
        select: () => {
          const chain = { eq: () => chain, limit: () => chain, maybeSingle: async () => ({ data: existingOnRead ? { id: "fe" } : null, error: null }) };
          return chain;
        },
      }),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { admin: admin as any, inserts };
  }

  it("two saves at once both read 'none yet': the one the database refuses wrote NO milestone — and says so, quietly", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { admin, inserts } = conflicting(false);
    expect(await recordActivity(admin, { userId: "u1", kind: "card_saved" })).toBe(false);
    // The activity row and the attempt; the refusal is not an error worth a line.
    expect(inserts.map((r) => r.event)).toEqual(["card_saved", "first_card_saved"]);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("answers true only for the call that wrote the milestone (what the referral program waits for)", async () => {
    const first = makeAdmin(false);
    expect(await recordActivity(first.admin, { userId: "u1", kind: "card_saved" })).toBe(true);
    const later = makeAdmin(true);
    expect(await recordActivity(later.admin, { userId: "u1", kind: "card_saved" })).toBe(false);
  });

  it("any other write failure still gets its line", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const admin = {
      from: () => ({ insert: () => ({ select: () => ({ single: async () => ({ data: null, error: { code: "57014", message: "canceling statement" } }) }) }) }),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await recordFunnelEvent(admin as any, { event: "card_saved", userId: "u1" })).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

// An account made with Google or Discord posts no signup form, so it had no
// `signup` row at all: "Signups", the source lists and the signup → first
// card rate left every one of them out. Its row is written where the
// account is made (/auth/callback, the method alone — the server has no
// attribution there) and completed where the tab hands its first touch over
// (onboarding).
describe("recordSignup — one signup row an account, written once and completed once", () => {
  /** An admin holding `row` as the account's signup row (null: none). */
  function withRow(row: { id: string; props: Record<string, unknown> } | null) {
    const inserts: Array<Record<string, unknown>> = [];
    const updates: Array<{ id: unknown; props: unknown }> = [];
    const admin = {
      from: () => ({
        insert: (value: Record<string, unknown>) => {
          inserts.push(value);
          return { select: () => ({ single: async () => ({ data: { id: "fe_new" }, error: null }) }) };
        },
        update: (value: { props: unknown }) => ({
          eq: async (_column: string, id: unknown) => {
            updates.push({ id, props: value.props });
            return { error: null };
          },
        }),
        select: () => {
          const chain = { eq: () => chain, limit: () => chain, maybeSingle: async () => ({ data: row, error: null }) };
          return chain;
        },
      }),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { admin: admin as any, inserts, updates };
  }

  it("the callback: an account with no row gets one, with how it was made", async () => {
    const { admin, inserts, updates } = withRow(null);
    expect(await recordSignup(admin, { userId: "u1", props: { method: "google" } })).toBe("written");
    expect(inserts).toEqual([{ event: "signup", user_id: "u1", props: { method: "google" }, source: "server" }]);
    expect(updates).toEqual([]);
  });

  it("onboarding: that method-only row takes the tab's first touch — once", async () => {
    const callbackRow = withRow({ id: "fe_1", props: { method: "google" } });
    expect(
      await recordSignup(callbackRow.admin, { userId: "u1", props: { method: "google", referrer: "reddit.com", surface: "home_hero", referred: true } }),
    ).toBe("enriched");
    expect(callbackRow.updates).toEqual([{ id: "fe_1", props: { method: "google", referrer: "reddit.com", surface: "home_hero", referred: true } }]);
    expect(callbackRow.inserts).toEqual([]);

    // A row that already holds a first touch is left as it is (a second tab, a retry).
    const done = withRow({ id: "fe_1", props: { method: "google", referrer: "reddit.com" } });
    expect(await recordSignup(done.admin, { userId: "u1", props: { method: "google", utmSource: "newsletter" } })).toBe("kept");
    expect(done.updates).toEqual([]);
  });

  it.each([
    ["the email form's row (it says what that form posted)", { method: "email" }],
    ["a row from before `method` existed (the email form's)", {}],
    ["a row migration 0197 backfilled (the tab at onboarding is not its first touch)", { method: "google", backfilled: true }],
  ])("never rewrites %s", async (_label, props) => {
    const { admin, inserts, updates } = withRow({ id: "fe_1", props });
    // The tab a confirmation link opened: its "referrer" is a mail client.
    expect(await recordSignup(admin, { userId: "u1", props: { method: "email", referrer: "mail.google.com" } })).toBe("kept");
    expect(inserts).toEqual([]);
    expect(updates).toEqual([]);
  });

  it("nothing to add is nothing written: a sign-in of an account that has its row costs one read", async () => {
    const { admin, inserts, updates } = withRow({ id: "fe_1", props: { method: "discord" } });
    expect(await recordSignup(admin, { userId: "u1", props: { method: "discord" } })).toBe("kept");
    expect(inserts).toEqual([]);
    expect(updates).toEqual([]);
  });

  it("keeps only allow-listed props, in the row it writes and in the one it completes", async () => {
    const fresh = withRow(null);
    await recordSignup(fresh.admin, { userId: "u1", props: { method: "google", email: "a@b.c", referrer: "x.com" } });
    expect(fresh.inserts[0].props).toEqual({ method: "google", referrer: "x.com" });
    const existing = withRow({ id: "fe_1", props: { method: "google" } });
    await recordSignup(existing.admin, { userId: "u1", props: { method: "google", name: "Jane", utmSource: "ads" } });
    expect(existing.updates[0].props).toEqual({ method: "google", utmSource: "ads" });
  });

  it("a read that fails writes nothing (never a second row on a guess)", async () => {
    const admin = {
      from: () => ({
        select: () => {
          const chain = { eq: () => chain, limit: () => chain, maybeSingle: async () => ({ data: null, error: { message: "timeout" } }) };
          return chain;
        },
        insert: () => {
          throw new Error("must not insert");
        },
      }),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await recordSignup(admin as any, { userId: "u1", props: { method: "google" } })).toBe("failed");
  });

  it("the method is one of four words, never a provider's free text", () => {
    expect(SIGNUP_METHODS).toEqual(["email", "google", "discord", "other"]);
    expect(["email", "google", "Google", "discord", "github", undefined, null, 7].map(signupMethodOf)).toEqual([
      "email", "google", "google", "discord", "other", "email", "email", "email",
    ]);
    // …and the props allow-list keeps it (and the migration's marker).
    expect(sanitizeFunnelProps({ method: "google", backfilled: true, email: "x@y.z" })).toEqual({ method: "google", backfilled: true });
  });
});
