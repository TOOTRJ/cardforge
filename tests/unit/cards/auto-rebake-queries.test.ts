import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// getAutoRebakeOverview: /admin/renders looks the poisoned cards up (title,
// link); the admin dashboard tile (TODO 7.4) asks for `poisonDetails: false`
// and prints only their count, so it must not query cards/profiles at all.
// The tile also asks `cachePending: true`: the owed count (a service-role
// head count over every published card) is reused for up to 60 s, while
// /admin/renders keeps counting fresh (owner, 2026-09-29). "Up to 60 s" is
// a promise unstable_cache alone doesn't keep — past `revalidate` Next still
// returns the stale entry (refreshing it in the background) — so the stand-in
// below behaves the same way, and the tile must not print that stale count.
// ---------------------------------------------------------------------------

type CacheOptions = { revalidate?: number | false; tags?: string[] };

const mocks = vi.hoisted(() => ({
  tables: [] as string[],
  readSweepState: vi.fn(),
  countSweepCandidates: vi.fn(),
  // What unstable_cache was configured with, and a stand-in Data Cache that
  // keeps what the wrapped function resolved to per argument list — and,
  // like Next's, nothing when it throws. Like Next's in an App Router
  // request (next/dist/server/web/spec-extension/unstable-cache.js), an
  // entry past `revalidate` is still RETURNED and only refreshed in the
  // background.
  cacheConfigs: [] as Array<{ keyParts: string[] | undefined; options: CacheOptions | undefined }>,
  dataCache: new Map<string, { value: unknown; storedAt: number }>(),
}));

vi.mock("next/cache", () => ({
  unstable_cache: <A extends unknown[], R>(
    fn: (...args: A) => Promise<R>,
    keyParts?: string[],
    options?: CacheOptions,
  ) => {
    mocks.cacheConfigs.push({ keyParts, options });
    return async (...args: A): Promise<R> => {
      const key = JSON.stringify([keyParts, args]);
      const refresh = async () => {
        const value = await fn(...args);
        mocks.dataCache.set(key, { value, storedAt: Date.now() });
        return value;
      };
      const entry = mocks.dataCache.get(key);
      if (!entry) return refresh();
      const revalidate = options?.revalidate;
      if (typeof revalidate === "number" && Date.now() - entry.storedAt > revalidate * 1000) {
        void refresh().catch(() => {});
      }
      return entry.value as R;
    };
  },
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

import {
  getAutoRebakeOverview,
  REBAKE_OWED_REVALIDATE_SECONDS,
  REBAKE_OWED_TAG,
} from "@/lib/cards/auto-rebake-queries";
import { EMPTY_AUTO_REBAKE_STATE } from "@/lib/cards/auto-rebake-state";
import { latestSweepVersion } from "@/lib/cards/layout-version";

const ID = "44444444-4444-4444-8444-444444444444";

beforeEach(() => {
  mocks.tables.length = 0;
  mocks.dataCache.clear();
  mocks.countSweepCandidates.mockReset();
  mocks.readSweepState.mockResolvedValue({
    ...EMPTY_AUTO_REBAKE_STATE,
    poison: [{ id: ID, error: "Art unavailable", failures: 3, at: "2026-09-29T10:00:00.000Z" }],
  });
  mocks.countSweepCandidates.mockResolvedValue(5);
});

afterEach(() => {
  vi.useRealTimers();
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

describe("getAutoRebakeOverview — the owed count's cache", () => {
  it("caches the count for 60 s under its tag, keyed by the sweep version", () => {
    expect(REBAKE_OWED_REVALIDATE_SECONDS).toBe(60);
    expect(mocks.cacheConfigs).toEqual([
      {
        keyParts: [REBAKE_OWED_TAG, `sweep-v${latestSweepVersion()}`],
        options: { revalidate: 60, tags: [REBAKE_OWED_TAG] },
      },
    ]);
  });

  it("reuses the count with cachePending: true — and /admin/renders' default still counts every time", async () => {
    mocks.countSweepCandidates.mockResolvedValueOnce(5).mockResolvedValueOnce(4).mockResolvedValue(3);
    const tile = await getAutoRebakeOverview({ poisonDetails: false, cachePending: true });
    const again = await getAutoRebakeOverview({ poisonDetails: false, cachePending: true });
    expect([tile.pending, again.pending]).toEqual([5, 5]);
    expect(mocks.countSweepCandidates).toHaveBeenCalledTimes(1);
    // The poisoned cards are still left out of the cached count.
    expect(mocks.countSweepCandidates).toHaveBeenCalledWith(expect.anything(), [ID]);

    const page = await getAutoRebakeOverview();
    const pageAgain = await getAutoRebakeOverview();
    expect([page.pending, pageAgain.pending]).toEqual([4, 3]);
    expect(mocks.countSweepCandidates).toHaveBeenCalledTimes(3);
  });

  it("counts afresh when the poison list changes (a Retry, a new strike)", async () => {
    mocks.countSweepCandidates.mockResolvedValueOnce(5).mockResolvedValueOnce(6);
    await getAutoRebakeOverview({ poisonDetails: false, cachePending: true });
    mocks.readSweepState.mockResolvedValue({ ...EMPTY_AUTO_REBAKE_STATE, poison: [] });
    const retried = await getAutoRebakeOverview({ poisonDetails: false, cachePending: true });
    expect(retried.pending).toBe(6);
    expect(mocks.countSweepCandidates).toHaveBeenLastCalledWith(expect.anything(), []);
  });

  it("never prints a count older than 60 s, though the Data Cache still hands back its stale entry", async () => {
    const T0 = Date.parse("2026-09-29T09:00:00.000Z");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T0);
    // A sweep bump: 700 owed at 09:00; the cron clears them within the hour.
    mocks.countSweepCandidates.mockResolvedValueOnce(700).mockResolvedValue(0);
    const tile = () => getAutoRebakeOverview({ poisonDetails: false, cachePending: true });

    expect((await tile()).pending).toBe(700);
    vi.setSystemTime(T0 + 59_000);
    expect((await tile()).pending).toBe(700);
    expect(mocks.countSweepCandidates).toHaveBeenCalledTimes(1);

    // The admin's next visit is after lunch: the entry is stale, and Next
    // would return it as is — the tile counts now instead.
    vi.setSystemTime(T0 + 4 * 60 * 60_000);
    const later = await tile();
    expect(later.pending).toBe(0);
    expect(later.readAt).toBe(T0 + 4 * 60 * 60_000);
  });

  it("never caches a failed count: it reads null, and the next visit counts again", async () => {
    mocks.countSweepCandidates.mockRejectedValueOnce(new Error("Counting pending re-bakes failed: timeout"));
    mocks.countSweepCandidates.mockResolvedValueOnce(5);
    const failed = await getAutoRebakeOverview({ poisonDetails: false, cachePending: true });
    expect(failed.pending).toBeNull();
    const next = await getAutoRebakeOverview({ poisonDetails: false, cachePending: true });
    expect(next.pending).toBe(5);
    expect(mocks.countSweepCandidates).toHaveBeenCalledTimes(2);
  });
});
