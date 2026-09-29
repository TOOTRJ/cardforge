import { beforeEach, describe, expect, it, vi } from "vitest";
import { sweepDb } from "@/tests/stubs/sweep-db";

// ---------------------------------------------------------------------------
// The /admin/renders server actions (lib/cards/auto-rebake-actions.ts).
// Each checks is_admin ITSELF — a server action is reachable without the
// page — and only then writes render_sweep_state with the service role.
// Pause sets the flag + who; Resume clears the breaker (and the idle
// fingerprint, so the next run scans afresh); Retry empties the poison list
// and gives those cards ONE more attempt (strikes = POISON_AFTER_STRIKES - 1).
// ---------------------------------------------------------------------------

const T0 = Date.parse("2026-09-28T12:00:00.000Z");
const state = vi.hoisted(() => ({
  profile: null as null | { id: string; is_admin: boolean; username: string | null },
  configured: true,
  db: null as null | ReturnType<typeof import("@/tests/stubs/sweep-db").sweepDb>,
  adminClients: 0,
}));
vi.mock("@/lib/supabase/server", () => ({ getCurrentProfile: async () => state.profile }));
vi.mock("@/lib/supabase/admin", () => ({
  isAdminConfigured: () => state.configured,
  createAdminClient: () => {
    state.adminClients += 1;
    return state.db!.client;
  },
}));
const revalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/cards/rebake-batch", () => ({ DEFAULT_BATCH: 8, runRebakeBatch: vi.fn() }));

import {
  pauseAutoRebakeAction,
  resumeAutoRebakeAction,
  retryPoisonedCardsAction,
} from "@/lib/cards/auto-rebake-actions";
import { POISON_AFTER_STRIKES } from "@/lib/cards/auto-rebake-state";

const ACTIONS = [pauseAutoRebakeAction, resumeAutoRebakeAction, retryPoisonedCardsAction];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  state.profile = { id: "admin", is_admin: true, username: "dev_admin" };
  state.configured = true;
  state.adminClients = 0;
  state.db = sweepDb({
    now: () => T0,
    row: {
      paused: true,
      paused_reason: "A whole batch failed",
      paused_at: "2026-09-28T11:00:00.000Z",
      idle: { layoutVersion: 32, candidates: 3, at: "2026-09-28T11:00:00.000Z" },
      strikes: { s1: { n: 1, error: "art", at: "2026-09-28T11:00:00.000Z" } },
      poison: [
        { id: "p1", error: "Art unavailable", failures: 3, at: "2026-09-28T10:00:00.000Z" },
        { id: "p2", error: "Row update failed", failures: 3, at: "2026-09-28T10:00:00.000Z" },
      ],
    },
  });
  revalidatePath.mockClear();
});

describe("auto re-bake admin actions — auth", () => {
  it("refuses a signed-out visitor and a non-admin without touching the service role", async () => {
    for (const profile of [null, { id: "u", is_admin: false, username: "dev_free" }]) {
      state.profile = profile;
      for (const action of ACTIONS) {
        expect(await action()).toEqual({ ok: false, error: "Not authorized." });
      }
    }
    expect(state.adminClients).toBe(0);
    expect(state.db!.log).toHaveLength(0);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("refuses when the admin key isn't configured", async () => {
    state.configured = false;
    for (const action of ACTIONS) expect((await action()).ok).toBe(false);
    expect(state.adminClients).toBe(0);
  });
});

describe("auto re-bake admin actions — effects", () => {
  it("pause sets the flag and says who paused it", async () => {
    state.db!.row.paused = false;
    expect(await pauseAutoRebakeAction()).toEqual({ ok: true });
    expect(state.db!.row).toMatchObject({
      paused: true,
      paused_reason: "Paused by @dev_admin.",
      paused_at: new Date(T0).toISOString(),
    });
    expect(revalidatePath).toHaveBeenCalledWith("/admin/renders");
  });

  it("resume clears the breaker and the idle fingerprint, and leaves the poison list alone", async () => {
    expect(await resumeAutoRebakeAction()).toEqual({ ok: true });
    expect(state.db!.row).toMatchObject({ paused: false, paused_reason: null, paused_at: null, idle: null });
    expect(state.db!.row.poison).toHaveLength(2);
  });

  it("retry empties the poison list and gives each card one more attempt", async () => {
    expect(await retryPoisonedCardsAction()).toEqual({ ok: true });
    expect(state.db!.row.poison).toEqual([]);
    expect(state.db!.row.idle).toBeNull();
    expect(state.db!.row.strikes).toEqual({
      s1: { n: 1, error: "art", at: "2026-09-28T11:00:00.000Z" },
      p1: { n: POISON_AFTER_STRIKES - 1, error: "Art unavailable", at: new Date(T0).toISOString() },
      p2: { n: POISON_AFTER_STRIKES - 1, error: "Row update failed", at: new Date(T0).toISOString() },
    });
    // Retry doesn't resume a paused sweep.
    expect(state.db!.row.paused).toBe(true);
  });

  it("retry with nothing poisoned writes nothing", async () => {
    state.db!.row.poison = [];
    expect(await retryPoisonedCardsAction()).toEqual({ ok: true });
    expect(state.db!.stateWrites()).toEqual([]);
  });
});
