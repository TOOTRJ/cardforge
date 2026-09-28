import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";
import type { LeaseHolder } from "@/lib/cards/auto-rebake-state";

// ---------------------------------------------------------------------------
// The ONE sweep lease (public.render_sweep_state, migration 0121) that keeps
// the three re-bake drivers from running batches at the same time:
//
//   cron     /api/cron/auto-rebake — holds it for one invocation (≤ 300 s),
//            checks between batches whether a manual run asked for it.
//   manual   POST /api/admin/rebake (scripts/rebake-renders.mjs) and
//            POST /api/admin/rebake-marked (the compare page's "Re-bake now")
//            — one batch per call. Between two calls the lease is PARKED
//            (holder 'manual', no token, MANUAL_PARK_SECONDS) so the cron
//            stays out for the whole run, while the next manual call takes
//            it straight back.
//
// A manual call that finds the CRON holding the lease asks it to yield
// (request_render_sweep_yield) and waits — polling — until the cron's
// current batch ends and it lets go (a batch is ~8 renders, well under a
// minute). The manual drivers only see a slower answer, which both already
// handle. If the lease is still busy after MANUAL_WAIT_MS (a hung batch,
// another manual call mid-batch) the route answers 503 + Retry-After with a
// plain message: scripts/rebake-renders.mjs prints it and stops (with the
// PR #394 retry helper it backs off and retries a 503), the compare page
// shows it with "Try again". Never 409 — the script treats that as fatal
// with no retry.
//
// The SQL does the arbitration (one conditional UPDATE, row-locked); this
// module only wraps it. Callers use the service-role client.
// ---------------------------------------------------------------------------

type Admin = ReturnType<typeof createAdminClient>;

/** Just over the routes' maxDuration (300 s): a function that dies holding
 *  the lease frees it on its own. */
export const SWEEP_LEASE_TTL_SECONDS = 310;
/** How long a manual run keeps the cron out between two of its calls. */
export const MANUAL_PARK_SECONDS = 120;
/** How long a manual call waits for the lease before answering 503. */
export const MANUAL_WAIT_MS = 120_000;
export const MANUAL_POLL_MS = 2_000;

export type LeaseAttempt = {
  acquired: boolean;
  /** The holder after the attempt (the caller when acquired). */
  holder: LeaseHolder | null;
  expiresAt: string | null;
};

export async function acquireSweepLease(
  admin: Admin,
  holder: LeaseHolder,
  token: string,
  ttlSeconds: number = SWEEP_LEASE_TTL_SECONDS,
): Promise<LeaseAttempt> {
  const { data, error } = await admin.rpc("acquire_render_sweep_lease", {
    p_holder: holder,
    p_token: token,
    p_ttl_seconds: ttlSeconds,
  });
  if (error) throw new Error(`Sweep lease: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  const current = row?.holder === "cron" || row?.holder === "manual" ? row.holder : null;
  return { acquired: row?.acquired === true, holder: current, expiresAt: row?.expires_at ?? null };
}

/** Release (or, with parkSeconds, park) the lease — only the token's holder
 *  can. Best-effort: an expiry frees it anyway. Returns whether it held. */
export async function releaseSweepLease(
  admin: Admin,
  token: string,
  opts: { parkSeconds?: number } = {},
): Promise<boolean> {
  const { data, error } = await admin.rpc("release_render_sweep_lease", {
    p_token: token,
    p_park_seconds: Math.max(0, Math.floor(opts.parkSeconds ?? 0)),
  });
  if (error) {
    console.warn("[sweep-lease] release failed:", error.message);
    return false;
  }
  return data === true;
}

/** Ask a running cron invocation to stop after its current batch. */
export async function requestCronYield(admin: Admin): Promise<boolean> {
  const { data, error } = await admin.rpc("request_render_sweep_yield");
  if (error) throw new Error(`Sweep lease: ${error.message}`);
  return data === true;
}

export type ManualLease =
  | { ok: true; token: string; waitedMs: number }
  | { ok: false; holder: LeaseHolder | null; expiresAt: string | null; waitedMs: number };

/**
 * Take the lease for ONE manual batch, waiting for a running cron to yield.
 * Re-asks for the yield on every poll: a cron invocation that started while
 * we waited cleared the earlier request when it took the lease.
 */
export async function acquireManualLease(
  admin: Admin,
  token: string,
  opts: {
    waitMs?: number;
    pollMs?: number;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<ManualLease> {
  const waitMs = opts.waitMs ?? MANUAL_WAIT_MS;
  const pollMs = opts.pollMs ?? MANUAL_POLL_MS;
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const started = now();
  for (;;) {
    const attempt = await acquireSweepLease(admin, "manual", token);
    const waitedMs = now() - started;
    if (attempt.acquired) return { ok: true, token, waitedMs };
    if (attempt.holder === "cron") await requestCronYield(admin);
    if (waitedMs + pollMs > waitMs) {
      return { ok: false, holder: attempt.holder, expiresAt: attempt.expiresAt, waitedMs };
    }
    await sleep(pollMs);
  }
}

/** The 503 a manual route answers when the lease stayed busy. */
export function leaseBusyMessage(lease: Extract<ManualLease, { ok: false }>): string {
  const until = lease.expiresAt ? ` (lease until ${lease.expiresAt})` : "";
  const waited = Math.round(lease.waitedMs / 1000);
  return lease.holder === "cron"
    ? `The automatic re-bake is mid-batch and did not hand over the sweep lease within ${waited} s${until}. Nothing was baked — try again in a minute.`
    : `Another re-bake call is running${until}. Nothing was baked — try again in a minute.`;
}
