import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// getScryfallAdminUsageSnapshot gating + shape. The Supabase server/admin
// modules are mocked: the interesting logic here is "who gets data" and
// how the RPC rows map onto the snapshot, not the SQL itself (migration
// 0047 is exercised against the live DB during review).
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  getCurrentProfile: vi.fn(),
  isAdminConfigured: vi.fn(),
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  getCurrentProfile: mocks.getCurrentProfile,
}));

vi.mock("@/lib/supabase/admin", () => ({
  isAdminConfigured: mocks.isAdminConfigured,
  createAdminClient: mocks.createAdminClient,
}));

import { getScryfallAdminUsageSnapshot } from "@/lib/scryfall/admin-usage-queries";

/** Chainable stub for `.from().select().eq().gte()` head-count queries. */
function countQuery(count: number) {
  const result = { count, error: null };
  const chain = {
    select: () => chain,
    eq: () => chain,
    gte: () => Promise.resolve(result),
  };
  return chain;
}

describe("getScryfallAdminUsageSnapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null for non-admins (page 404s)", async () => {
    mocks.getCurrentProfile.mockResolvedValue({ is_admin: false });
    expect(await getScryfallAdminUsageSnapshot()).toBeNull();

    mocks.getCurrentProfile.mockResolvedValue(null);
    expect(await getScryfallAdminUsageSnapshot()).toBeNull();
  });

  it("returns an empty snapshot when the service role isn't configured", async () => {
    mocks.getCurrentProfile.mockResolvedValue({ is_admin: true });
    mocks.isAdminConfigured.mockReturnValue(false);

    const snapshot = await getScryfallAdminUsageSnapshot();
    expect(snapshot).not.toBeNull();
    expect(snapshot?.todayTotal).toBe(0);
    expect(snapshot?.topUsers).toEqual([]);
    expect(snapshot?.limits.search.perDay).toBeGreaterThan(0);
  });

  it("maps RPC rows and head counts into the snapshot", async () => {
    mocks.getCurrentProfile.mockResolvedValue({ is_admin: true });
    mocks.isAdminConfigured.mockReturnValue(true);

    const counts = [2, 10, 1, 5, 0, 3]; // (minute, day) × search/named/import_art
    let call = 0;
    mocks.createAdminClient.mockReturnValue({
      rpc: (name: string) => {
        if (name === "scryfall_usage_admin_daily") {
          return Promise.resolve({
            data: [
              { day: "2026-06-30", action: "search", count: 4 },
              { day: "2026-06-30", action: "named", count: 2 },
            ],
            error: null,
          });
        }
        return Promise.resolve({
          data: [{ user_id: "u1", username: "redjester", calls: "45" }],
          error: null,
        });
      },
      from: () => countQuery(counts[call++]),
    });

    const snapshot = await getScryfallAdminUsageSnapshot();
    expect(snapshot).not.toBeNull();
    expect(snapshot?.perAction).toEqual([
      { action: "search", minute: 2, today: 10 },
      { action: "named", minute: 1, today: 5 },
      { action: "import_art", minute: 0, today: 3 },
    ]);
    expect(snapshot?.todayTotal).toBe(18);
    expect(snapshot?.minuteTotal).toBe(3);
    expect(snapshot?.daily).toHaveLength(2);
    // bigint counts can arrive as strings — coerced to numbers.
    expect(snapshot?.topUsers).toEqual([
      { userId: "u1", username: "redjester", calls: 45 },
    ]);
  });

  it("falls back to the empty snapshot when the admin client throws", async () => {
    mocks.getCurrentProfile.mockResolvedValue({ is_admin: true });
    mocks.isAdminConfigured.mockReturnValue(true);
    mocks.createAdminClient.mockImplementation(() => {
      throw new Error("no key");
    });

    const snapshot = await getScryfallAdminUsageSnapshot();
    expect(snapshot).not.toBeNull();
    expect(snapshot?.todayTotal).toBe(0);
  });
});
