import { describe, expect, it, vi } from "vitest";

// /admin/users LIST: a subscriber who has cancelled and is still active
// carries `planEnding` (the Plan column's "cancelled, ends …" badge), read
// from the columns migration 0135 adds to admin_list_users. Before it the
// RPC returned neither the flag nor a date: the list could not show it.

const rows = vi.hoisted(() => ({ data: [] as Array<Record<string, unknown>>, args: null as unknown }));
vi.mock("@/lib/supabase/server", () => ({ getCurrentProfile: async () => ({ id: "admin", is_admin: true }) }));
vi.mock("@/lib/supabase/admin", () => ({
  isAdminConfigured: () => true,
  createAdminClient: () => ({
    rpc: async (_fn: string, args: unknown) => {
      rows.args = args;
      return { data: rows.data, error: null };
    },
  }),
}));

import { listAdminUsers } from "@/lib/admin/users-queries";
import { parseUserListParams } from "@/lib/admin/users-params";
import { planEndingAdminLabel } from "@/lib/billing/plan-ending";

const base = {
  id: "u1",
  username: "dev_pro",
  display_name: "Priya",
  avatar_url: null,
  email: "pro@dev.pipglyph.test",
  subscription_tier: "pro",
  subscription_status: "active",
  comp_tier: null,
  comp_expires_at: null,
  credits: 200,
  is_admin: false,
  card_count: 3,
  deck_count: 1,
  created_at: "2026-07-01T00:00:00.000Z",
  last_active_at: null,
  total_count: 3,
  current_period_end: "2026-10-23T02:31:04.000Z",
  cancel_at_period_end: false,
  subscription_ends_at: null,
  subscription_canceled_at: null,
};

describe("listAdminUsers — pending cancellations", () => {
  it("marks the cancelled-but-active subscriber, and only them", async () => {
    rows.data = [
      { ...base, id: "u1", cancel_at_period_end: true, subscription_ends_at: "2026-10-23T02:31:04.000Z" },
      { ...base, id: "u2" },
      { ...base, id: "u3", subscription_status: "canceled", cancel_at_period_end: true },
      // A database that has not run 0135 yet returns none of the new columns.
      { ...base, id: "u4", current_period_end: undefined, cancel_at_period_end: undefined, subscription_ends_at: undefined },
    ];
    const page = await listAdminUsers(parseUserListParams({ flag: "ending" }));
    expect((rows.args as { p_flag: string }).p_flag).toBe("ending");
    const [ending, renewing, ended, old] = page!.rows;
    expect(ending.planEnding).toMatchObject({ kind: "plan", endsAt: "2026-10-23T02:31:04.000Z" });
    expect(planEndingAdminLabel(ending.planEnding!)).toBe("cancelled, ends Oct 23, 2026");
    expect(renewing.planEnding).toBeNull();
    expect(ended.planEnding).toBeNull();
    expect(old.planEnding).toBeNull();
  });
});
