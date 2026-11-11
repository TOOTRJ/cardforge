import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// "Notify me" on a tool that is not open yet promised "We'll tell you when
// it opens" — and releasing the tool told nobody (the 2026-11-10 tools
// audit): only a tester grant wrote a notification. A release that reaches
// someone on the waiting list now tells them, once, and takes them off it.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

const db = vi.hoisted(() => ({
  isAdmin: true,
  billing: true,
  release: null as null | Record<string, unknown>,
  interest: [] as Array<Record<string, unknown>>,
  grants: [] as Array<Record<string, unknown>>,
  profiles: [] as Array<Record<string, unknown>>,
  notifications: [] as Array<Record<string, unknown>>,
  upserts: [] as Array<{ table: string; rows: unknown }>,
  notifyFails: false,
}));

function client() {
  return {
    from(table: string) {
      let rows: Row[] =
        table === "tool_interest" ? [...db.interest] : table === "tool_access_grants" ? [...db.grants] : table === "profiles" ? [...db.profiles] : [];
      let window: [number, number] | null = null;
      let deleting = false;
      const chain: Record<string, unknown> = {
        select: () => chain,
        order: () => chain,
        eq: (column: string, value: unknown) => {
          rows = rows.filter((row) => row[column] === value);
          return chain;
        },
        in: (column: string, values: unknown[]) => {
          rows = rows.filter((row) => values.includes(row[column]));
          if (deleting && table === "tool_interest") {
            db.interest = db.interest.filter((row) => !(row.tool_slug === rows[0]?.tool_slug && values.includes(row.user_id)));
          }
          return chain;
        },
        range: (from: number, to: number) => {
          window = [from, to];
          return chain;
        },
        maybeSingle: async () => ({ data: table === "tool_releases" ? db.release : (rows[0] ?? null), error: null }),
        // Awaited as it is (the release), or read back (the pause switch).
        upsert: (value: unknown) => {
          db.upserts.push({ table, rows: value });
          return Object.assign(Promise.resolve({ error: null }), {
            select: () => ({ maybeSingle: async () => ({ data: db.release, error: null }) }),
          });
        },
        insert: async (value: Row[]) => {
          if (table === "notifications") {
            if (db.notifyFails) return { error: { message: "insert failed" } };
            db.notifications.push(...value);
          }
          return { error: null };
        },
        delete: () => {
          deleting = true;
          return chain;
        },
        then: (resolve: (value: unknown) => void) => {
          const [from, to] = window ?? [0, 999];
          resolve({ data: rows.slice(from, to + 1), error: null });
        },
      };
      return chain;
    },
  };
}

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getCurrentProfile: async () => ({ id: "admin-1", is_admin: db.isAdmin }) }));
vi.mock("@/lib/supabase/admin", () => ({ isAdminConfigured: () => true, createAdminClient: () => client() }));
vi.mock("@/lib/billing/flags", () => ({ isBillingEnabled: () => db.billing }));

import { grantInterestedAction, setToolPausedAction, setToolReleaseAction } from "@/lib/tools/admin-actions";
import { describeNotification } from "@/lib/notifications/describe";

const SLUG = "token-kit";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const waiting = (n: number, slug = SLUG) => ({ tool_slug: slug, user_id: id(n), created_at: `2026-11-0${(n % 9) + 1}T00:00:00Z` });
const profile = (n: number, extra: Row = {}) => ({
  id: id(n),
  is_admin: false,
  subscription_tier: "free",
  subscription_status: null,
  comp_tier: null,
  comp_expires_at: null,
  payment_failed_at: null,
  ...extra,
});
const told = () => db.notifications.map((row) => row.recipient_id);
const stillWaiting = () => db.interest.filter((row) => row.tool_slug === SLUG).map((row) => row.user_id);

beforeEach(() => {
  db.isAdmin = true;
  db.billing = true;
  db.release = null;
  db.interest = [];
  db.grants = [];
  db.profiles = [];
  db.notifications = [];
  db.upserts = [];
  db.notifyFails = false;
});

describe("releasing a tool tells its waiting list", () => {
  it("a release to everyone tells everyone who asked — once — and empties the list", async () => {
    db.interest = [waiting(1), waiting(2), waiting(3)];
    db.profiles = [profile(1), profile(2, { subscription_tier: "pro", subscription_status: "active" }), profile(3)];
    const result = await setToolReleaseAction(SLUG, "free");
    expect(result).toEqual({ ok: true, data: { notified: 3 } });
    expect(told().sort()).toEqual([id(1), id(2), id(3)]);
    expect(db.notifications[0]).toMatchObject({
      actor_id: "admin-1",
      type: "tool_access",
      payload: { tool: SLUG, toolName: "Token Kit", built: true, released: true },
    });
    expect(stillWaiting()).toEqual([]);
  });

  it("a release to Pro tells the people it reaches; the others stay on the list for a wider one", async () => {
    db.interest = [waiting(1), waiting(2), waiting(3), waiting(4)];
    db.profiles = [
      profile(1),
      profile(2, { subscription_tier: "pro", subscription_status: "active" }),
      profile(3, { subscription_tier: "plus", subscription_status: "trialing" }),
      // A comp counts like a plan; a cancelled plan does not.
      profile(4, { subscription_tier: "pro", subscription_status: "canceled", comp_tier: "pro", comp_expires_at: null }),
    ];
    expect(await setToolReleaseAction(SLUG, "pro")).toEqual({ ok: true, data: { notified: 2 } });
    expect(told().sort()).toEqual([id(2), id(4)]);
    expect(stillWaiting().sort()).toEqual([id(1), id(3)]);

    // Later it is widened to Plus: only the one it newly reaches hears of it.
    db.release = { release_tier: "pro", released_at: "2026-11-10T00:00:00Z", paused: false };
    db.notifications = [];
    expect(await setToolReleaseAction(SLUG, "plus")).toEqual({ ok: true, data: { notified: 1 } });
    expect(told()).toEqual([id(3)]);
    expect(stillWaiting()).toEqual([id(1)]);
  });

  it("admins and live testers are in already: not told, and off the list", async () => {
    db.interest = [waiting(1), waiting(2), waiting(3)];
    db.profiles = [profile(1, { is_admin: true }), profile(2), profile(3)];
    db.grants = [
      { tool_slug: SLUG, user_id: id(2), expires_at: null },
      // An expired grant is not access: this one is told.
      { tool_slug: SLUG, user_id: id(3), expires_at: "2020-01-01T00:00:00Z" },
    ];
    expect(await setToolReleaseAction(SLUG, "free")).toEqual({ ok: true, data: { notified: 1 } });
    expect(told()).toEqual([id(3)]);
    expect(stillWaiting()).toEqual([]);
  });

  it("tells nobody when nothing opened: back to beta, the same plan again, a narrower plan, a paused tool", async () => {
    db.interest = [waiting(1)];
    db.profiles = [profile(1, { subscription_tier: "pro", subscription_status: "active" })];
    db.release = { release_tier: "free", released_at: "2026-11-01T00:00:00Z", paused: false };
    for (const tier of [null, "free", "plus", "pro"] as const) {
      expect(await setToolReleaseAction(SLUG, tier)).toEqual({ ok: true, data: { notified: 0 } });
    }
    db.release = { release_tier: null, released_at: null, paused: true };
    expect(await setToolReleaseAction(SLUG, "free")).toEqual({ ok: true, data: { notified: 0 } });
    expect(db.notifications).toEqual([]);
    expect(stillWaiting()).toEqual([id(1)]);
  });

  it("with billing off everyone has every plan's tools: a release to Pro reaches a Free account", async () => {
    db.billing = false;
    db.interest = [waiting(1)];
    db.profiles = [profile(1)];
    expect(await setToolReleaseAction(SLUG, "pro")).toEqual({ ok: true, data: { notified: 1 } });
  });

  it("another tool's waiting list is not touched", async () => {
    db.interest = [waiting(1), waiting(2, "pip-forge")];
    db.profiles = [profile(1), profile(2)];
    await setToolReleaseAction(SLUG, "free");
    expect(told()).toEqual([id(1)]);
    expect(db.interest).toEqual([waiting(2, "pip-forge")]);
  });

  it("a notification that cannot be written undoes nothing: the release stands, the list is kept for another try", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    db.notifyFails = true;
    db.interest = [waiting(1)];
    db.profiles = [profile(1)];
    expect(await setToolReleaseAction(SLUG, "free")).toEqual({ ok: true, data: { notified: 0 } });
    expect(db.upserts).toHaveLength(1);
    expect(stillWaiting()).toEqual([id(1)]);
  });

  it("only an admin may release", async () => {
    db.isAdmin = false;
    expect(await setToolReleaseAction(SLUG, "free")).toEqual({ ok: false, error: "Admins only." });
    expect(db.upserts).toEqual([]);
  });

  it("the notification says the tool opened — not 'early access' — and links to it", () => {
    const text = describeNotification({ type: "tool_access", payload: { tool: SLUG, toolName: "Token Kit", built: true, released: true } } as never, { isAdmin: false });
    expect(text.body).toBe("opened Token Kit — you asked us to tell you. It's on your Tools page.");
    expect(text.href).toBe("/dashboard/tools/token-kit");
    const tester = describeNotification({ type: "tool_access", payload: { tool: SLUG, toolName: "Token Kit", built: true } } as never, { isAdmin: false });
    expect(tester.body).toContain("early access");
  });
});

describe("taking a tool off pause", () => {
  it("opens a RELEASED tool to people again: its waiting list hears of it, once", async () => {
    // Released to everyone while paused — which told nobody.
    db.interest = [waiting(1), waiting(2)];
    db.profiles = [profile(1), profile(2)];
    db.release = { release_tier: "free", released_at: "2026-11-01T00:00:00Z", paused: true };
    expect(await setToolPausedAction(SLUG, false)).toEqual({ ok: true, data: { notified: 2 } });
    expect(told().sort()).toEqual([id(1), id(2)]);
    expect(stillWaiting()).toEqual([]);
    // Paused and taken off again: nobody is left to tell.
    expect(await setToolPausedAction(SLUG, false)).toEqual({ ok: true, data: { notified: 0 } });
    expect(db.notifications).toHaveLength(2);
  });

  it("reaches only the plans the release reaches", async () => {
    db.interest = [waiting(1), waiting(2)];
    db.profiles = [profile(1), profile(2, { subscription_tier: "pro", subscription_status: "active" })];
    db.release = { release_tier: "pro", released_at: "2026-11-01T00:00:00Z", paused: true };
    expect(await setToolPausedAction(SLUG, false)).toEqual({ ok: true, data: { notified: 1 } });
    expect(told()).toEqual([id(2)]);
    expect(stillWaiting()).toEqual([id(1)]);
  });

  it("pausing tells nobody, and neither does unpausing a tool that is still in beta", async () => {
    db.interest = [waiting(1)];
    db.profiles = [profile(1)];
    db.release = { release_tier: "free", released_at: "2026-11-01T00:00:00Z", paused: false };
    expect(await setToolPausedAction(SLUG, true)).toEqual({ ok: true, data: { notified: 0 } });
    db.release = { release_tier: null, released_at: null, paused: true };
    expect(await setToolPausedAction(SLUG, false)).toEqual({ ok: true, data: { notified: 0 } });
    expect(db.notifications).toEqual([]);
    expect(stillWaiting()).toEqual([id(1)]);
  });

  it("a notification that cannot be written never fails the switch", async () => {
    db.interest = [waiting(1)];
    db.profiles = [profile(1)];
    db.release = { release_tier: "free", released_at: "2026-11-01T00:00:00Z", paused: true };
    db.notifyFails = true;
    expect(await setToolPausedAction(SLUG, false)).toEqual({ ok: true, data: { notified: 0 } });
    expect(stillWaiting()).toEqual([id(1)]);
  });
});

describe("letting the whole waiting list in", () => {
  it("grants the next people after the testers already in — it stalled once the first 200 had access", async () => {
    // 250 on the list; the first 200 already hold a live grant.
    db.interest = Array.from({ length: 250 }, (_, i) => ({ tool_slug: SLUG, user_id: id(i + 1), created_at: new Date(Date.UTC(2026, 10, 1, 0, i)).toISOString() }));
    db.grants = Array.from({ length: 200 }, (_, i) => ({ tool_slug: SLUG, user_id: id(i + 1), expires_at: null }));
    const result = await grantInterestedAction({ slug: SLUG, expiresInDays: null });
    expect(result).toEqual({ ok: true, data: { granted: 50 } });
    const granted = db.upserts.find((u) => u.table === "tool_access_grants")!.rows as Array<{ user_id: string }>;
    expect(granted.map((row) => row.user_id)).toEqual(Array.from({ length: 50 }, (_, i) => id(i + 201)));
  });
});
