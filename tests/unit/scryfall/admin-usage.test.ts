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
    expect(snapshot?.loadError).toBe(false);
  });

  it("maps RPC rows and head counts into the snapshot", async () => {
    mocks.getCurrentProfile.mockResolvedValue({ is_admin: true });
    mocks.isAdminConfigured.mockReturnValue(true);

    // (minute, day) × search / named / import_art / deck_import /
    // deck_import_commit — deck_import used to be missing from these figures
    // while the 30-day total included it; the commit's own action (0143)
    // joins them.
    const counts = [2, 10, 1, 5, 0, 3, 1, 4, 2, 6];
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
      { action: "deck_import", minute: 1, today: 4 },
      { action: "deck_import_commit", minute: 2, today: 6 },
    ]);
    expect(snapshot?.todayTotal).toBe(28);
    expect(snapshot?.minuteTotal).toBe(6);
    expect(snapshot?.daily).toHaveLength(2);
    // bigint counts can arrive as strings — coerced to numbers.
    expect(snapshot?.topUsers).toEqual([
      { userId: "u1", username: "redjester", calls: 45 },
    ]);
  });

  it("falls back to the empty snapshot when the admin client throws — flagged and logged (L5)", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.getCurrentProfile.mockResolvedValue({ is_admin: true });
    mocks.isAdminConfigured.mockReturnValue(true);
    mocks.createAdminClient.mockImplementation(() => {
      throw new Error("no key");
    });

    const snapshot = await getScryfallAdminUsageSnapshot();
    expect(snapshot).not.toBeNull();
    expect(snapshot?.todayTotal).toBe(0);
    expect(snapshot?.loadError).toBe(true);
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it("flags a snapshot whose RPC answered an error, rather than printing zeros as the truth (L5)", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.getCurrentProfile.mockResolvedValue({ is_admin: true });
    mocks.isAdminConfigured.mockReturnValue(true);
    mocks.createAdminClient.mockReturnValue({
      rpc: (name: string) =>
        Promise.resolve(
          name === "scryfall_usage_admin_daily"
            ? { data: null, error: { message: "permission denied" } }
            : { data: [], error: null },
        ),
      from: () => countQuery(0),
    });
    const snapshot = await getScryfallAdminUsageSnapshot();
    expect(snapshot?.loadError).toBe(true);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("usage read failed"), "permission denied");
    log.mockRestore();
  });
});
