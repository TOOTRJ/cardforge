// ---------------------------------------------------------------------------
// frames-check-run.mjs — what scripts/frames-check.mjs DECIDES, apart from
// its command line so that every exit code is unit-tested
// (tests/unit/frames/frames-check-run.test.ts). The script reads its flags,
// plans (frames-check-plan.mjs), makes the pacer and the lookup, and exits
// with what runFramesCheck returns.
//
// Two kinds of check, by what an unlooked object means:
//
//   STRICT    the objects a pull request, a merge or a production build ADDS
//             (and the whole manifest for `npm run frames:check` / any doubt
//             about the base). Every one must be verified: one that is
//             missing, one storage never answered for, one the budget did
//             not reach — each fails the run. "An object nobody looked at is
//             not published as far as this gate knows."
//   TOLERANT  the production build's canary and the nightly sweep: samples
//             of objects an earlier run verified. One that is MISSING fails
//             the run, and so does one whose answer SAID missing (a 400, a
//             wrong size) and could not be settled before the run stopped.
//             One that was never looked at — the slow pace against a cold
//             CDN did not reach it inside the budget — is counted in the
//             log and left to the next night.
// ---------------------------------------------------------------------------
import { checkObjects, frameObjectKey, isNoAnswer } from "./frame-objects.mjs";
import { sweepOrder } from "./frames-check-plan.mjs";

/** What the confirm pass keeps of a sweep's budget, so a miss the first
 *  pass saw is settled the same night. */
export const CONFIRM_RESERVE_SECONDS = 180;
/** How long a production build spends on its canary's first pass. */
export const CANARY_SECONDS = 90;
/** The nightly sweep's budget (its CI job stops at 25 minutes). */
export const SWEEP_BUDGET_SECONDS = 1200;
/** A strict check's budget: never under the first, and what its objects
 *  need when the CDN has NONE of them — SECONDS_PER_UNCACHED each (the
 *  pacer's gap plus a lookup) on top of STRICT_FIXED_SECONDS for the confirm
 *  pass and a busy pause. A pull request that adds 400 frames gets 14
 *  minutes. An UNATTENDED run (CI, a Vercel build) is capped at the second:
 *  CI's job stops at 25 minutes. So a FULL strict check — the whole
 *  manifest, any doubt about the base — cannot finish there from a
 *  completely cold CDN (over an hour at this pace): it fails, saying so,
 *  and a re-run from the same CDN location gets further each time. The
 *  owner's own `npm run frames:check` has no cap. */
export const STRICT_MIN_SECONDS = 780;
export const STRICT_MAX_SECONDS = 1320;
export const STRICT_FIXED_SECONDS = 240;
export const SECONDS_PER_UNCACHED = 1.5;

/**
 * The run's budget in seconds: `override` (--budget-seconds) when given,
 * the sweep's, or a strict check's by the number of objects it must verify
 * — capped for an `unattended` run (CI, a Vercel build).
 * @param {{ sweep: boolean, strictCount: number, override?: number, unattended?: boolean }} input
 */
export function framesCheckBudgetSeconds({ sweep, strictCount, override, unattended = true }) {
  if (override !== undefined) return override;
  if (sweep) return SWEEP_BUDGET_SECONDS;
  const needed = Math.max(STRICT_MIN_SECONDS, STRICT_FIXED_SECONDS + Math.ceil(strictCount * SECONDS_PER_UNCACHED));
  return unattended ? Math.min(STRICT_MAX_SECONDS, needed) : needed;
}

/**
 * Run the check `plan` describes and say how it ended:
 * { exitCode: 0 | 1, complete } — `complete` is true only for a sweep that
 * looked at EVERY object and found them all (false for any other sweep,
 * null for the other modes).
 *
 * @param {{
 *   plan: ReturnType<typeof import("./frames-check-plan.mjs").planFramesCheck>,
 *   sweep?: boolean,
 *   incrementalAsked?: boolean,
 *   origin: string,
 *   total: number,
 *   day?: number,
 *   lookup: (entry: [string, { hash: string, bytes: number }], thorough: boolean, onAnswer?: (answer: { status: number, cached: boolean }) => void) => Promise<{ ok: boolean, status: string }>,
 *   pacer: ReturnType<typeof import("./frame-objects.mjs").createLookupPacer>,
 *   budgetSeconds: number,
 *   signal: AbortSignal,
 *   timeout?: (seconds: number) => AbortSignal,
 *   confirmDelayMs?: number,
 *   progressMs?: number,
 *   log?: (line: string) => void,
 *   error?: (line: string) => void,
 * }} input
 */
export async function runFramesCheck({
  plan,
  sweep = false,
  incrementalAsked = false,
  origin,
  total,
  day = Math.floor(Date.now() / 86_400_000),
  lookup,
  pacer,
  budgetSeconds,
  signal,
  timeout = (seconds) => AbortSignal.timeout(seconds * 1000),
  confirmDelayMs = 3000,
  progressMs = 30_000,
  log = console.log,
  error = console.error,
}) {
  const started = Date.now();
  const keyOf = ([key, entry]) => frameObjectKey(key, entry.hash);

  /** Look `entries` up at the pacer's pace, printing progress. */
  const look = async (entries, firstPass = signal) => {
    let progress = { done: 0, total: entries.length, suspects: 0 };
    const ticker =
      progressMs > 0
        ? setInterval(() => {
            const { uncached, slow } = pacer.stats();
            log(
              `  … ${progress.done}/${progress.total} checked, ${progress.suspects} apparent misses so far ` +
                `(${Math.round((Date.now() - started) / 1000)} s; ${uncached} not from the CDN's cache${slow ? ", going slowly" : ""})`,
            );
          }, progressMs)
        : null;
    try {
      return await checkObjects(entries, lookup, {
        pacer,
        signal: firstPass,
        confirmSignal: signal,
        confirmTries: 4,
        confirmDelayMs,
        onProgress: (p) => (progress = p),
      });
    } finally {
      if (ticker) clearInterval(ticker);
    }
  };

  /** Why a check ended early, in words. */
  const whyStopped = (result) => {
    if (result.stopped === "busy") {
      return "production's storage kept answering 429 (it is saturated — by this check or by something else), so the check stopped rather than add to it";
    }
    if (result.stopped === "deadline") {
      const { uncached } = pacer.stats();
      return uncached > 0
        ? `the CDN did not have ${uncached} of the answers in its cache, so the check went slowly (it must not load production's storage) and ran out of time (budget ${budgetSeconds} s)`
        : `it ran out of time (budget ${budgetSeconds} s)`;
    }
    return "storage gave no answer for some objects (429, a 5xx, a timeout)";
  };

  const failMissing = (missing, of) => {
    error(`✗ ${missing.length}/${of} manifest objects are missing from ${origin}:`);
    for (const row of missing.map(({ item, status }) => `  ${keyOf(item)}  (last answer: ${status})`).sort()) error(row);
    error("The owner runs `npm run frames:promote` (docs/FRAMES.md) before this merges.");
    return 1;
  };

  /** Objects the check could not verify: neither a pass nor a list of misses. */
  const failUnverified = (result, open, unsettled) => {
    const answers = {};
    for (const { status } of unsettled) answers[status] = (answers[status] ?? 0) + 1;
    const last = Object.entries(answers)
      .map(([status, n]) => `${status} ×${n}`)
      .join(", ");
    error(`✗ The frames check could not verify ${open} of ${result.total} objects at ${origin}: ${whyStopped(result)}${last ? ` (last answers: ${last})` : ""}.`);
    for (const row of unsettled.slice(0, 25).map(({ item, status }) => `  ${keyOf(item)}  (last answer: ${status})`)) error(row);
    error(
      "  That does not say a frame is missing — and it is not a pass: an object nobody looked at is not published as far as this gate knows. " +
        "Re-run the job in a few minutes (what this run looked at is in that CDN location's cache now, so a run from the same place gets further); " +
        "if it fails again, check Supabase's status (storage / CDN).",
    );
    return 1;
  };

  /** Every one of `entries` must be verified: 0, or the exit code of the failure. */
  const strict = async (entries) => {
    const result = await look(entries);
    if (result.missing.length) return failMissing(result.missing, entries.length);
    const open = result.unchecked.length + result.unverified.length;
    if (result.stopped || open) return failUnverified(result, open, result.unverified);
    return 0;
  };

  /** A sample of objects an earlier run verified: { exitCode, open, result }. */
  const tolerant = async (entries, firstPass) => {
    const result = await look(entries, firstPass);
    if (result.missing.length) return { exitCode: failMissing(result.missing, entries.length), open: 0, result };
    // An answer that SAID missing and was never settled is not a pass.
    const saidMissing = result.unverified.filter(({ status }) => !isNoAnswer(status));
    if (saidMissing.length) return { exitCode: failUnverified(result, saidMissing.length, saidMissing), open: 0, result };
    return { exitCode: 0, open: result.unchecked.length + result.unverified.length, result };
  };

  if (plan.mode === "incremental") {
    log(
      `Incremental check at ${origin}: ${plan.changed.length} new or changed manifest object(s) since ${plan.baseSha.slice(0, 12)}` +
        (plan.canary.length ? ` + a canary of ${plan.canary.length} of the ${plan.unchanged} unchanged.` : ` (${plan.unchanged} unchanged, not looked up).`) +
        ' CI\'s nightly "Frames published" sweep walks them all.',
    );
    if (plan.changed.length) {
      const failed = await strict(plan.changed);
      if (failed) return { exitCode: failed, complete: null };
    }
    let canaryNote = "";
    if (plan.canary.length) {
      const canary = await tolerant(plan.canary, AbortSignal.any([signal, timeout(CANARY_SECONDS)]));
      if (canary.exitCode) return { exitCode: canary.exitCode, complete: null };
      canaryNote = canary.open
        ? `, ${plan.canary.length - canary.open} of the ${plan.canary.length} canary (the other ${canary.open} were not looked at: ${whyStopped(canary.result)} — the nightly sweep's)`
        : `, ${plan.canary.length} canary`;
    }
    log(
      `✓ All ${plan.changed.length} new or changed manifest objects${canaryNote} are published at ${origin}; ` +
        `the other ${total - plan.changed.length - plan.canary.length} are unchanged since ${plan.baseSha.slice(0, 12)}.`,
    );
    return { exitCode: 0, complete: null };
  }

  if (sweep) {
    const entries = sweepOrder(plan.entries, day);
    log(`Nightly sweep of ${entries.length} manifest objects at ${origin} (budget ${budgetSeconds} s), starting at ${keyOf(entries[0])}…`);
    const firstPass = AbortSignal.any([signal, timeout(Math.max(1, budgetSeconds - CONFIRM_RESERVE_SECONDS))]);
    const swept = await tolerant(entries, firstPass);
    if (swept.exitCode) return { exitCode: swept.exitCode, complete: false };
    if (swept.open === 0) {
      log(`✓ All ${entries.length} manifest objects are published at ${origin}.`);
      return { exitCode: 0, complete: true };
    }
    const looked = entries.length - swept.open;
    log(
      `✓ None of the ${looked} manifest objects looked at tonight is missing from ${origin}. ` +
        `${swept.open} were not looked at: ${whyStopped(swept.result)}. Tomorrow's sweep starts further on; this is not a failure.`,
    );
    return { exitCode: 0, complete: false };
  }

  if (incrementalAsked) log(`Full check: ${plan.reason}.`);
  log(`Checking ${plan.entries.length} manifest objects at ${origin} (budget ${budgetSeconds} s)…`);
  const failed = await strict(plan.entries);
  if (failed) return { exitCode: failed, complete: null };
  log(`✓ All ${plan.entries.length} manifest objects are published at ${origin}.`);
  return { exitCode: 0, complete: null };
}
