import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// getAutoRebakeOverview: /admin/renders looks the poisoned cards up (title,
// link); the admin dashboard tile (TODO 7.4) asks for `poisonDetails: false`
// and prints only their count, so it must not query cards/profiles at all.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  tables: [] as string[],
  readSweepState: vi.fn(),
  countSweepCandidates: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  isAdminConfigured: () => true,
  createAdminClient: () => ({
    from(table: string) {
      mocks.tables.push(table);
      const query = {
        select: () => query,
        in: async () => ({
          data:
            table === "cards"
              ? [{ id: "44444444-4444-4444-8444-444444444444", title: "Gravebloom Shade", slug: "gravebloom-shade", visibility: "public", owner_id: "owner" }]
              : [{ id: "owner", username: "maker" }],
        }),
      };
      return query;
    },
  }),
}));
vi.mock("@/lib/billing/flags", () => ({ isBillingEnabled: () => true }));
vi.mock("@/lib/cards/auto-rebake", () => ({
  readSweepState: mocks.readSweepState,
  countSweepCandidates: mocks.countSweepCandidates,
}));

import { getAutoRebakeOverview } from "@/lib/cards/auto-rebake-queries";
import { EMPTY_AUTO_REBAKE_STATE } from "@/lib/cards/auto-rebake-state";

const ID = "44444444-4444-4444-8444-444444444444";

beforeEach(() => {
  mocks.tables.length = 0;
  mocks.readSweepState.mockResolvedValue({
    ...EMPTY_AUTO_REBAKE_STATE,
    poison: [{ id: ID, error: "Art unavailable", failures: 3, at: "2026-09-29T10:00:00.000Z" }],
  });
  mocks.countSweepCandidates.mockResolvedValue(5);
});

describe("getAutoRebakeOverview", () => {
  it("looks the poisoned cards up by default (/admin/renders)", async () => {
    const overview = await getAutoRebakeOverview();
    expect(mocks.tables).toEqual(["cards", "profiles"]);
    expect(overview.poisonCards).toEqual([
      expect.objectContaining({ id: ID, title: "Gravebloom Shade", href: "/card/maker/gravebloom-shade" }),
    ]);
    expect(overview.pending).toBe(5);
    expect(mocks.countSweepCandidates).toHaveBeenCalledWith(expect.anything(), [ID]);
  });

  it("skips the lookup with poisonDetails: false, keeping the poison list itself", async () => {
    const overview = await getAutoRebakeOverview({ poisonDetails: false });
    expect(mocks.tables).toEqual([]);
    expect(overview.poisonCards).toEqual([]);
    expect(overview.state.poison).toHaveLength(1);
    // The pending count still leaves the poisoned cards out.
    expect(mocks.countSweepCandidates).toHaveBeenCalledWith(expect.anything(), [ID]);
    expect(overview.pending).toBe(5);
  });
});
