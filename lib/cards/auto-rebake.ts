import "server-only";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import type { createAdminClient } from "@/lib/supabase/admin";
import { isUuid } from "@/lib/ids";
import { CARD_LAYOUT_VERSION, latestSweepVersion } from "@/lib/cards/layout-version";
import { DEFAULT_BATCH, runRebakeBatch, type RebakeBatchResult } from "@/lib/cards/rebake-batch";
import { acquireSweepLease, releaseSweepLease } from "@/lib/cards/sweep-lease";
import {
  applyRunOutcome,
  breakerAfterBatch,
  breakerForPoison,
  formatRunLog,
  leaseIsLive,
  parseSweepState,
  summaryFailures,
  type AutoRebakeRunSummary,
  type AutoRebakeState,
  type AutoRebakeStop,
  type IdleFingerprint,
} from "@/lib/cards/auto-rebake-state";

// ---------------------------------------------------------------------------
// The automatic re-bake — what GET /api/cron/auto-rebake runs every 10
// minutes on production (vercel.json). After a deploy with a "sweep" layout
// bump (lib/cards/layout-version.ts VERSION_ROLLOUT), or a migration /
// frame-layout save that nulls stamps, it re-bakes the affected published
// cards in the background: the same batch as scripts/rebake-renders.mjs
// (runRebakeBatch, scope "sweep"), so the same guards apply (opt-in-only
// cards left alone, overlap compare-and-set, art guard).
//
// One invocation:
//   1. Refuse without NEXT_PUBLIC_BILLING_ENABLED (bakes would be clean —
//      layout v21 and 2026-09-16). No ALLOW_UNWATERMARKED_SWEEP escape here.
//   2. Skip when paused (breaker or admin) or when the sweep lease is held
//      (a manual run — the script or the compare page — is active).
//   3. The cheap pre-check: ONE head count of published cards stamped below
//      the newest sweep version (or unstamped, or never baked), leaving out
//      the poison list. 0 → done: two queries and a timestamp write.
//      A count equal to the last "nothing actionable" fingerprint (same
//      layout version, under IDLE_RECHECK_MS old) is idle too — opt-in-only
//      leftovers are counted but never re-baked, so without it an opt-in
//      bump would cost a full scan every 10 minutes.
//   4. Take the lease, then batches of AUTO_REBAKE_BATCH until a batch finds
//      nothing to do or AUTO_REBAKE_BUDGET_MS (240 s; the route's
//      maxDuration is 300) would be crossed by the next batch. Between
//      batches: stop if an admin paused it or a manual run asked for the
//      lease. A failed card joins skipIds for the rest of the invocation, a
//      card superseded twice likewise.
//   5. Strikes → poison list, the breaker, one state write, admin alert,
//      release, and ONE log line (formatRunLog).
// ---------------------------------------------------------------------------

type Admin = ReturnType<typeof createAdminClient>;

/** Stop starting batches once the next one would end past this. */
export const AUTO_REBAKE_BUDGET_MS = 240_000;
/** A batch still running at this point is treated as hung (breaker). Leaves
 *  ~20 s under maxDuration for the bookkeeping writes. */
export const AUTO_REBAKE_HARD_STOP_MS = 280_000;
export const AUTO_REBAKE_BATCH = DEFAULT_BATCH;
/** Floor for the projected batch duration (8 renders at ~1–3 s each). */
export const BATCH_ESTIMATE_FLOOR_MS = 30_000;
/** How long a "nothing actionable" fingerprint may skip the scan. */
export const IDLE_RECHECK_MS = 6 * 60 * 60 * 1000;
/** A card superseded this often in one invocation waits for the next one. */
const SUPERSEDED_LIMIT = 2;

export const REFUSED_BILLING_ERROR =
  'Refusing to bake: NEXT_PUBLIC_BILLING_ENABLED is not "true" on this deployment, so every render would be unwatermarked.';

export type AutoRebakeDeps = {
  now?: () => number;
  runBatch?: typeof runRebakeBatch;
  newToken?: () => string;
  /** Refresh the ISR pages once a sweep finishes (they point at old ?v= URLs). */
  revalidate?: () => void;
  log?: (line: string) => void;
  /** Resolves "timeout" after `ms` — the hard stop for a hung batch. */
  timeout?: (ms: number) => { promise: Promise<"timeout">; cancel: () => void };
};

export type AutoRebakeOutcome =
  | { ok: true; outcome: "paused" | "manual-run" | "busy" }
  | { ok: true; outcome: "idle"; pending: number }
  | { ok: true; outcome: "ran"; summary: AutoRebakeRunSummary; pausedReason: string | null }
  | { ok: false; outcome: "refused" | "error"; error: string };

export async function readSweepState(admin: Admin): Promise<AutoRebakeState> {
  const { data, error } = await admin.from("render_sweep_state").select("*").eq("id", 1).maybeSingle();
  if (error) throw new Error(`Reading the re-bake state failed: ${error.message}`);
  return parseSweepState(data as Record<string, unknown> | null);
}

/**
 * Published cards that may owe a platform re-bake: never baked, unstamped
 * (a frame-layout save or a migration marked them), or stamped below the
 * newest SWEEP version — minus the poison list. An upper bound on the work
 * (opt-in-only and stamp-only cards are counted too) and the admin panel's
 * "pending" estimate. One head query. Throws on a query error: a failed
 * count must never read as "nothing to do".
 */
export async function countSweepCandidates(admin: Admin, excludeIds: readonly string[] = []): Promise<number> {
  let query = admin
    .from("cards")
    .select("id", { count: "exact", head: true })
    .in("visibility", ["public", "unlisted"])
    .or(`rendered_image_url.is.null,layout_version.is.null,layout_version.lt.${latestSweepVersion()}`);
  const ids = excludeIds.filter(isUuid);
  if (ids.length > 0) query = query.not("id", "in", `(${ids.join(",")})`);
  const { count, error } = await query;
  if (error) throw new Error(`Counting pending re-bakes failed: ${error.message}`);
  return count ?? 0;
}

function idleMatches(idle: IdleFingerprint | null, pending: number, nowMs: number): boolean {
  if (!idle) return false;
  const age = nowMs - Date.parse(idle.at);
  return (
    idle.layoutVersion === CARD_LAYOUT_VERSION &&
    idle.candidates === pending &&
    Number.isFinite(age) &&
    age >= 0 &&
    age < IDLE_RECHECK_MS
  );
}

function defaultTimeout(ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const promise = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), Math.max(0, ms));
  });
  return { promise, cancel: () => clearTimeout(timer) };
}

async function writeState(admin: Admin, patch: Record<string, unknown>): Promise<void> {
  const { error } = await admin
    .from("render_sweep_state")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", 1);
  if (error) console.warn("[auto-rebake] state write failed:", error.message);
}

/** One `render_sweep_paused` notification per admin — Realtime turns it into
 *  a toast + bell badge (lib/notifications/describe.ts has the copy). */
async function notifyAdminsPaused(
  admin: Admin,
  payload: { reason: string; failed: number; rebaked: number },
): Promise<void> {
  const { data, error } = await admin.from("profiles").select("id").eq("is_admin", true);
  if (error || !data || data.length === 0) {
    if (error) console.warn("[auto-rebake] admin lookup failed:", error.message);
    return;
  }
  const { error: insertError } = await admin.from("notifications").insert(
    data.map((profile) => ({
      recipient_id: profile.id as string,
      type: "render_sweep_paused",
      payload,
    })),
  );
  if (insertError) console.warn("[auto-rebake] admin alert failed:", insertError.message);
}

export async function runAutoRebake(
  admin: Admin,
  opts: { billingEnabled: boolean },
  deps: AutoRebakeDeps = {},
): Promise<AutoRebakeOutcome> {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? ((line: string) => console.log(line));
  const runBatch = deps.runBatch ?? runRebakeBatch;
  const revalidate = deps.revalidate ?? (() => revalidatePath("/", "layout"));
  const timeout = deps.timeout ?? defaultTimeout;
  const started = now();
  const startedIso = new Date(started).toISOString();

  const summaryOf = (patch: Partial<AutoRebakeRunSummary> & { stop: AutoRebakeStop }): AutoRebakeRunSummary => {
    const finished = now();
    return {
      startedAt: startedIso,
      finishedAt: new Date(finished).toISOString(),
      durationMs: finished - started,
      layoutVersion: CARD_LAYOUT_VERSION,
      batches: 0,
      rebaked: 0,
      stamped: 0,
      failed: 0,
      superseded: 0,
      remaining: null,
      ...patch,
    };
  };

  // 1. Never bake clean.
  if (!opts.billingEnabled) {
    const summary = summaryOf({ stop: "refused", error: REFUSED_BILLING_ERROR });
    await writeState(admin, { last_run: summary, last_checked_at: summary.finishedAt });
    log(formatRunLog(summary));
    return { ok: false, outcome: "refused", error: REFUSED_BILLING_ERROR };
  }

  // 2. Paused, or someone else is sweeping.
  let state: AutoRebakeState;
  try {
    state = await readSweepState(admin);
  } catch (err) {
    const error = err instanceof Error ? err.message : "Reading the re-bake state failed.";
    log(`[auto-rebake] error="${error}"`);
    return { ok: false, outcome: "error", error };
  }
  if (state.paused) {
    log(`[auto-rebake] paused — skipped (${state.pausedReason ?? "no reason given"})`);
    return { ok: true, outcome: "paused" };
  }
  if (leaseIsLive(state, started)) {
    log(`[auto-rebake] lease held by ${state.lease.holder} until ${state.lease.expiresAt} — skipped`);
    return { ok: true, outcome: state.lease.holder === "manual" ? "manual-run" : "busy" };
  }

  // 3. Anything pending?
  const poisonIds = state.poison.map((p) => p.id);
  let pending: number;
  try {
    pending = await countSweepCandidates(admin, poisonIds);
  } catch (err) {
    const error = err instanceof Error ? err.message : "Counting pending re-bakes failed.";
    log(`[auto-rebake] error="${error}"`);
    return { ok: false, outcome: "error", error };
  }
  if (pending === 0 || idleMatches(state.idle, pending, started)) {
    const patch: Record<string, unknown> = { last_checked_at: startedIso };
    // A sweep that ran out of budget exactly at its last card finishes here.
    if (pending === 0 && state.revalidatePending) {
      revalidate();
      patch.revalidate_pending = false;
    }
    await writeState(admin, patch);
    log(`[auto-rebake] idle v${CARD_LAYOUT_VERSION} pending=${pending}${pending > 0 ? " (nothing actionable)" : ""}`);
    return { ok: true, outcome: "idle", pending };
  }

  // 4. Take the lease and sweep.
  const token = (deps.newToken ?? randomUUID)();
  try {
    const lease = await acquireSweepLease(admin, "cron", token);
    if (!lease.acquired) {
      log(`[auto-rebake] lease held by ${lease.holder} until ${lease.expiresAt} — skipped`);
      return { ok: true, outcome: lease.holder === "manual" ? "manual-run" : "busy" };
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : "Taking the sweep lease failed.";
    log(`[auto-rebake] error="${error}"`);
    return { ok: false, outcome: "error", error };
  }

  const known = new Set([...Object.keys(state.strikes), ...poisonIds]);
  const skip = new Set(poisonIds);
  const supersededTimes = new Map<string, number>();
  const failed: Array<{ id: string; error: string }> = [];
  const succeeded: string[] = [];
  let rebaked = 0;
  let stamped = 0;
  let superseded = 0;
  let batches = 0;
  let newFailures = 0;
  let stop: AutoRebakeStop = "budget";
  let error: string | null = null;
  let breaker: string | null = null;
  let hung = false;
  let projectedBatchMs = BATCH_ESTIMATE_FLOOR_MS;

  for (;;) {
    if (now() - started + projectedBatchMs > AUTO_REBAKE_BUDGET_MS) {
      stop = "budget";
      break;
    }
    if (batches > 0) {
      const { data: control, error: controlError } = await admin
        .from("render_sweep_state")
        .select("lease_token, yield_requested_at, paused")
        .eq("id", 1)
        .maybeSingle();
      if (controlError) {
        stop = "error";
        error = controlError.message;
        break;
      }
      if (!control || control.lease_token !== token) {
        stop = "lease-lost";
        break;
      }
      if (control.paused) {
        stop = "paused";
        break;
      }
      if (control.yield_requested_at) {
        stop = "yield";
        break;
      }
    }

    const batchStarted = now();
    const hardStop = timeout(AUTO_REBAKE_HARD_STOP_MS - (batchStarted - started));
    let result: Awaited<ReturnType<typeof runRebakeBatch>> | "timeout";
    try {
      result = await Promise.race([
        runBatch(admin, {
          scope: { kind: "sweep" },
          limit: AUTO_REBAKE_BATCH,
          dry: false,
          billingEnabled: true,
          skipIds: [...skip],
        }),
        hardStop.promise,
      ]);
    } catch (err) {
      result = { ok: false, error: err instanceof Error ? err.message : "The re-bake batch threw." };
    } finally {
      hardStop.cancel();
    }
    if (result === "timeout") {
      stop = "hung";
      hung = true;
      breaker = `A re-bake batch was still running ${Math.round((now() - started) / 1000)} s into the run — a render may hang`;
      break;
    }
    if (!result.ok) {
      stop = "error";
      error = result.error;
      break;
    }

    const batch = result as RebakeBatchResult;
    batches += 1;
    projectedBatchMs = Math.max(projectedBatchMs, now() - batchStarted);
    for (const p of batch.processed) {
      succeeded.push(p.id);
      if (p.verdict === "rebake") rebaked += 1;
      else stamped += 1;
    }
    for (const f of batch.failed) {
      skip.add(f.id);
      failed.push(f);
      if (!known.has(f.id)) newFailures += 1;
    }
    for (const id of batch.superseded) {
      superseded += 1;
      const times = (supersededTimes.get(id) ?? 0) + 1;
      supersededTimes.set(id, times);
      if (times >= SUPERSEDED_LIMIT) skip.add(id);
    }

    const tripped = breakerAfterBatch(
      { processed: batch.processed.length, superseded: batch.superseded.length, failed: batch.failed },
      { newFailures },
      known,
    );
    if (tripped) {
      stop = "breaker";
      breaker = tripped;
      break;
    }
    if (batch.processed.length + batch.failed.length + batch.superseded.length === 0) {
      stop = "done";
      break;
    }
  }

  // 5. Bookkeeping — on a FRESH read, so an admin's Pause / Retry during the
  // run survives this write.
  let fresh = state;
  try {
    fresh = await readSweepState(admin);
  } catch {
    // keep the start-of-run copy
  }
  const outcome = applyRunOutcome(fresh, { failed, succeeded, at: startedIso });
  const poisonBreaker = breakerForPoison(outcome.poison);
  if (!breaker && poisonBreaker) {
    breaker = poisonBreaker;
    stop = "breaker";
  }

  let remaining: number | null = null;
  try {
    remaining = await countSweepCandidates(admin, outcome.poison.map((p) => p.id));
  } catch {
    remaining = null;
  }

  // A clean finish with nothing waiting for a retry: remember the count so
  // opt-in-only leftovers don't cost a scan every 10 minutes.
  const poisonedNow = new Set(outcome.poisoned.map((p) => p.id));
  const retryPending = failed.some((f) => !poisonedNow.has(f.id));
  const idle: IdleFingerprint | null =
    stop === "done" && !retryPending && remaining != null
      ? { layoutVersion: CARD_LAYOUT_VERSION, candidates: remaining, at: new Date(now()).toISOString() }
      : null;

  let revalidatePending = fresh.revalidatePending || rebaked > 0;
  if (stop === "done" && revalidatePending) {
    revalidate();
    revalidatePending = false;
  }

  const summary = summaryOf({
    batches,
    rebaked,
    stamped,
    failed: failed.length,
    superseded,
    remaining,
    stop,
    error: error ?? breaker,
    failures: summaryFailures(failed),
    poisoned: outcome.poisoned.map((p) => p.id),
  });
  const patch: Record<string, unknown> = {
    strikes: outcome.strikes,
    poison: outcome.poison,
    last_run: summary,
    idle,
    last_checked_at: summary.finishedAt,
    revalidate_pending: revalidatePending,
  };
  if (breaker) {
    patch.paused = true;
    patch.paused_reason = breaker.slice(0, 500);
    patch.paused_at = summary.finishedAt;
  }
  await writeState(admin, patch);
  if (breaker && !fresh.paused) {
    await notifyAdminsPaused(admin, { reason: breaker.slice(0, 500), failed: failed.length, rebaked });
  }
  // A hung batch may still be writing: keep the lease until it expires
  // (just past the function's maxDuration), so no one else sweeps alongside.
  if (!hung) await releaseSweepLease(admin, token);

  log(formatRunLog(summary) + (breaker ? ` paused="${breaker.slice(0, 200)}"` : ""));
  return { ok: true, outcome: "ran", summary, pausedReason: breaker };
}
