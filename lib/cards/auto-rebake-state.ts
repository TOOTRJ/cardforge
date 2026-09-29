// ---------------------------------------------------------------------------
// The automatic re-bake's persisted state (public.render_sweep_state, migration
// 0123) — types, the defensive row parser, and the pure bookkeeping the cron
// runs after an invocation: strikes → poison list, and the circuit breaker.
// No imports and no server-only code: the admin panel renders these types.
//
// Vocabulary:
//   strike   one cron invocation in which a card failed to re-bake. The card
//            is skipped for the rest of that invocation (skipIds) and retried
//            by the next one.
//   poison   a card with POISON_AFTER_STRIKES strikes. Every later invocation
//            skips it (the cheap pending count leaves it out too) until an
//            admin clicks "Retry these cards". Never retried forever.
//   breaker  pauses the automatic sweep and alerts the admins when failures
//            look systemic (a renderer regression, storage down, a hung
//            render) rather than one broken card. Only FIRST-time failures
//            count: a known-bad card failing again is bookkeeping, not news.
//   crashed  a cron invocation that died holding the lease (killed at
//            maxDuration, out of memory) writes nothing; the next one sees
//            the expired lease with no summary after it and strikes the batch
//            it left in `in_flight`. Two dead runs in a row trip the breaker.
// ---------------------------------------------------------------------------

/** Invocations a card may fail before it goes on the poison list. */
export const POISON_AFTER_STRIKES = 3;
/** The breaker trips when one run grows the poison list past this. */
export const POISON_MAX = 50;
/** A strike on a card nobody retried for this long is forgotten. */
export const STRIKE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** A batch that re-baked nothing and failed at least this many cards (none
 *  of them with an earlier strike) trips the breaker. */
export const BREAKER_WHOLE_BATCH_MIN = 3;
/** First-time failures in one invocation that trip the breaker. */
export const BREAKER_NEW_FAILURES = 10;
/** Invocations in a row whose batch query failed (stop "error") that trip
 *  the breaker — a transient blip heals itself, a persistent one (code
 *  selecting a column its migration hasn't added) must not stay silent. */
export const BREAKER_ERROR_RUNS = 3;
/** Invocations in a row that died holding the lease that trip the breaker. */
export const BREAKER_CRASHED_RUNS = 2;
/** The strike a dead run's in-flight batch gets. */
export const CRASHED_BATCH_ERROR =
  "The automatic run died while re-baking this card's batch (killed at the 300 s limit or out of memory).";
/** Errors kept per summary (the Vercel log line and the admin panel). */
const SUMMARY_ERRORS = 5;

export type LeaseHolder = "cron" | "manual";

export type SweepStrike = { n: number; error: string; at: string };

export type PoisonEntry = { id: string; error: string; failures: number; at: string };

export type AutoRebakeStop =
  | "done" // a batch found nothing left to do
  | "budget" // the time budget ran out (the next invocation continues)
  | "yield" // a manual run asked for the lease
  | "paused" // an admin paused it mid-run
  | "lease-lost" // the lease was taken over (should not happen)
  | "breaker" // failures looked systemic — paused, admins alerted
  | "hung" // a batch ran past the hard stop for minutes — paused, admins alerted
  | "overrun" // a slow last batch ran into the hard stop — the next run continues
  | "crashed" // the previous run died holding the lease (recorded by the next one)
  | "error" // a batch query failed
  | "refused"; // NEXT_PUBLIC_BILLING_ENABLED is off: bakes would be clean

export type AutoRebakeRunSummary = {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  layoutVersion: number;
  batches: number;
  rebaked: number;
  stamped: number;
  failed: number;
  superseded: number;
  /** Work left after the last batch — a lower bound (the batch's own). */
  remaining: number | null;
  stop: AutoRebakeStop;
  error?: string | null;
  /** The first few failures of the run. */
  failures?: Array<{ id: string; error: string }>;
  /** Cards that went on the poison list in this run. */
  poisoned?: string[];
  /** stop "crashed": dead runs in a row (the breaker trips at
   *  BREAKER_CRASHED_RUNS). */
  crashes?: number;
  /** stop "error" (or the breaker it tripped): runs in a row whose batch
   *  query failed. */
  errorStreak?: number;
  /** The cards of a batch that hung or whose run died — the suspects. */
  suspects?: string[];
};

/** "Nothing actionable" fingerprint: the pending count a full scan found
 *  nothing to do for (opt-in-only leftovers). Equal count + same layout =
 *  skip the scan, for at most IDLE_RECHECK_MS. */
export type IdleFingerprint = { layoutVersion: number; candidates: number; at: string };

export type AutoRebakeState = {
  lease: {
    holder: LeaseHolder | null;
    /** A holder with a token is running a batch; without one it is parked
     *  between two calls of a manual run. */
    running: boolean;
    expiresAt: string | null;
    acquiredAt: string | null;
  };
  yieldRequestedAt: string | null;
  paused: boolean;
  pausedReason: string | null;
  pausedAt: string | null;
  strikes: Record<string, SweepStrike>;
  poison: PoisonEntry[];
  /** The batch a cron run is baking now (left behind if it died). */
  inFlight: string[];
  lastRun: AutoRebakeRunSummary | null;
  idle: IdleFingerprint | null;
  lastCheckedAt: string | null;
  revalidatePending: boolean;
};

export const EMPTY_AUTO_REBAKE_STATE: AutoRebakeState = {
  lease: { holder: null, running: false, expiresAt: null, acquiredAt: null },
  yieldRequestedAt: null,
  paused: false,
  pausedReason: null,
  pausedAt: null,
  strikes: {},
  poison: [],
  inFlight: [],
  lastRun: null,
  idle: null,
  lastCheckedAt: null,
  revalidatePending: false,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
const str = (value: unknown): string | null => (typeof value === "string" && value ? value : null);
const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/** A render_sweep_state row (or null) → state. Tolerates any jsonb shape: a
 *  hand-edited or older row must never crash the cron or the admin page. */
export function parseSweepState(row: Record<string, unknown> | null | undefined): AutoRebakeState {
  if (!row) return EMPTY_AUTO_REBAKE_STATE;
  const holder = row.lease_holder === "cron" || row.lease_holder === "manual" ? row.lease_holder : null;

  const strikes: Record<string, SweepStrike> = {};
  if (isRecord(row.strikes)) {
    for (const [id, value] of Object.entries(row.strikes)) {
      if (!isRecord(value)) continue;
      const n = num(value.n);
      if (n == null || n < 1) continue;
      strikes[id] = { n, error: str(value.error) ?? "Unknown error", at: str(value.at) ?? "" };
    }
  }

  const poison: PoisonEntry[] = [];
  if (Array.isArray(row.poison)) {
    for (const value of row.poison) {
      if (!isRecord(value)) continue;
      const id = str(value.id);
      if (!id || poison.some((p) => p.id === id)) continue;
      poison.push({
        id,
        error: str(value.error) ?? "Unknown error",
        failures: num(value.failures) ?? POISON_AFTER_STRIKES,
        at: str(value.at) ?? "",
      });
    }
  }

  const inFlight = Array.isArray(row.in_flight)
    ? [...new Set(row.in_flight.filter((v): v is string => typeof v === "string" && v.length > 0))]
    : [];

  let idle: IdleFingerprint | null = null;
  if (isRecord(row.idle)) {
    const layoutVersion = num(row.idle.layoutVersion);
    const candidates = num(row.idle.candidates);
    const at = str(row.idle.at);
    if (layoutVersion != null && candidates != null && at) idle = { layoutVersion, candidates, at };
  }

  return {
    lease: {
      holder,
      running: holder != null && str(row.lease_token) != null,
      expiresAt: str(row.lease_expires_at),
      acquiredAt: str(row.lease_acquired_at),
    },
    yieldRequestedAt: str(row.yield_requested_at),
    paused: row.paused === true,
    pausedReason: str(row.paused_reason),
    pausedAt: str(row.paused_at),
    strikes,
    poison,
    inFlight,
    lastRun: isRecord(row.last_run) ? (row.last_run as unknown as AutoRebakeRunSummary) : null,
    idle,
    lastCheckedAt: str(row.last_checked_at),
    revalidatePending: row.revalidate_pending === true,
  };
}

/** The lease blocks the cron: someone holds it and it hasn't expired. */
export function leaseIsLive(state: AutoRebakeState, nowMs: number): boolean {
  if (!state.lease.holder || !state.lease.expiresAt) return false;
  const expires = Date.parse(state.lease.expiresAt);
  return Number.isFinite(expires) && expires > nowMs;
}

/**
 * The previous cron invocation died holding the lease: the lease is a cron's,
 * still carries its token (never released), has expired, and no run summary
 * was written after it was taken. A hung batch keeps its lease on purpose but
 * writes its summary first, so it doesn't count.
 */
export function diedHoldingLease(state: AutoRebakeState, nowMs: number): boolean {
  if (state.lease.holder !== "cron" || !state.lease.running) return false;
  if (!state.lease.expiresAt || leaseIsLive(state, nowMs)) return false;
  const acquired = state.lease.acquiredAt ? Date.parse(state.lease.acquiredAt) : NaN;
  if (!Number.isFinite(acquired)) return false;
  const finished = state.lastRun?.finishedAt ? Date.parse(state.lastRun.finishedAt) : NaN;
  return !Number.isFinite(finished) || finished < acquired;
}

/** Runs in a row that ended the same way: the previous summary's streak
 *  (at least 1 when it ended that way) plus this one. */
export function streakAfter(
  last: AutoRebakeRunSummary | null,
  stop: AutoRebakeStop,
  field: "crashes" | "errorStreak",
): number {
  if (!last || last.stop !== stop) return 1;
  const previous = last[field];
  return Math.max(1, typeof previous === "number" && Number.isFinite(previous) ? previous : 1) + 1;
}

/**
 * Fold one invocation's outcome into the strike/poison bookkeeping.
 *   * each failed card gains one strike; at POISON_AFTER_STRIKES it moves to
 *     the poison list (its strike entry goes);
 *   * a re-baked or stamped card loses its strikes (and leaves the poison
 *     list, should it have been retried);
 *   * strikes older than STRIKE_TTL_MS are forgotten.
 * Pure: pass the FRESH state (re-read right before the write), so an admin's
 * "Retry these cards" during the run isn't overwritten.
 */
export function applyRunOutcome(
  prev: Pick<AutoRebakeState, "strikes" | "poison">,
  run: { failed: ReadonlyArray<{ id: string; error: string }>; succeeded: readonly string[]; at: string },
): { strikes: Record<string, SweepStrike>; poison: PoisonEntry[]; poisoned: PoisonEntry[] } {
  const atMs = Date.parse(run.at);
  const strikes: Record<string, SweepStrike> = {};
  for (const [id, strike] of Object.entries(prev.strikes)) {
    const age = atMs - Date.parse(strike.at);
    if (Number.isFinite(age) && age > STRIKE_TTL_MS) continue;
    strikes[id] = strike;
  }
  const succeeded = new Set(run.succeeded);
  for (const id of succeeded) delete strikes[id];
  const poison = prev.poison.filter((p) => !succeeded.has(p.id));

  const poisoned: PoisonEntry[] = [];
  const seen = new Set<string>();
  for (const { id, error } of run.failed) {
    if (seen.has(id) || poison.some((p) => p.id === id)) continue;
    seen.add(id);
    const n = (strikes[id]?.n ?? 0) + 1;
    if (n >= POISON_AFTER_STRIKES) {
      delete strikes[id];
      const entry = { id, error, failures: n, at: run.at };
      poison.push(entry);
      poisoned.push(entry);
    } else {
      strikes[id] = { n, error, at: run.at };
    }
  }
  return { strikes, poison, poisoned };
}

/** A batch's verdict for the breaker. `known` = ids that had a strike (or
 *  were poisoned) before this invocation. Returns the reason to pause, or
 *  null. */
export function breakerAfterBatch(
  batch: { processed: number; superseded: number; failed: ReadonlyArray<{ id: string; error: string }> },
  run: { newFailures: number },
  known: ReadonlySet<string>,
): string | null {
  const fresh = batch.failed.filter((f) => !known.has(f.id));
  if (batch.processed === 0 && batch.superseded === 0 && fresh.length >= BREAKER_WHOLE_BATCH_MIN) {
    return `A whole batch failed (${fresh.length} cards): ${fresh[0].error}`;
  }
  if (run.newFailures >= BREAKER_NEW_FAILURES) {
    return `${run.newFailures} cards failed to re-bake in one run (last: ${batch.failed.at(-1)?.error ?? "unknown error"})`;
  }
  return null;
}

/** The breaker's poison-list check, after the run's outcome is folded in:
 *  trips when THIS run pushed the list past POISON_MAX — not on every later
 *  run, so Resume lets the sweep carry on past cards an admin can't fix yet
 *  (they stay listed, and skipped). */
export function breakerForPoison(before: number, poison: readonly PoisonEntry[]): string | null {
  return before <= POISON_MAX && poison.length > POISON_MAX
    ? `${poison.length} cards keep failing (more than ${POISON_MAX}) — something is wrong beyond single cards`
    : null;
}

export function summaryFailures(
  failed: ReadonlyArray<{ id: string; error: string }>,
): Array<{ id: string; error: string }> {
  return failed.slice(0, SUMMARY_ERRORS).map((f) => ({ id: f.id, error: f.error.slice(0, 300) }));
}

/** One compact line for the Vercel log — no per-card noise. */
export function formatRunLog(summary: AutoRebakeRunSummary): string {
  const parts = [
    `[auto-rebake] v${summary.layoutVersion}`,
    `stop=${summary.stop}`,
    `batches=${summary.batches}`,
    `rebaked=${summary.rebaked}`,
    `stamped=${summary.stamped}`,
    `failed=${summary.failed}`,
    `superseded=${summary.superseded}`,
    `remaining=${summary.remaining ?? "?"}`,
    `${Math.round(summary.durationMs / 1000)}s`,
  ];
  if (summary.poisoned?.length) parts.push(`poisoned=${summary.poisoned.length}`);
  if (summary.error) parts.push(`error="${summary.error.slice(0, 200)}"`);
  return parts.join(" ");
}
