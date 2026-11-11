// ---------------------------------------------------------------------------
// One re-bake sweep at a time per subject (2026-11-10, the tools audit).
//
// Making or replacing a custom symbol (lib/symbols/rebake.ts) or a custom
// pip (lib/pips/remove-pip.ts) re-bakes the owner's cards that draw it, up
// to 40, after the response. Nothing kept two such sweeps apart: every save
// started its own, over the same cards, at the same time — the upload limit
// allows 30 saves a minute, so one busy minute could queue 1,200 bakes, each
// an art read and two to four storage writes.
//
// `coalesceSweep(key, sweep)` runs at most ONE sweep per key at a time in
// this instance, and the NEWEST change always gets one:
//
//   - a change that arrives while a sweep runs WAITS for it (the running one
//     read its cards before this change, so its work may be stale), then
//     runs its own sweep — in its own request, on its own time and client;
//   - unless a newer change arrived meanwhile: then it steps aside
//     ("queued") and the newer one sweeps. However many arrive during one
//     sweep, ONE more follows — the last one, which sees the latest picture;
//   - it waits at most SWEEP_WAIT_MS: a sweep that hangs, or whose function
//     was stopped, never holds a later change back. (The first design ran
//     the extra pass inside the FIRST caller's request: a first caller that
//     died took the queued change with it, and one hung bake made every
//     later change for that owner and symbol queue behind a sweep that never
//     ended.)
//
// Sweeps of different subjects never wait for each other. Per instance
// only: two instances can still each run one. That bounds the work by the
// number of instances instead of the number of saves, with no table and no
// lock to go stale.
// ---------------------------------------------------------------------------

/** How long a change waits for the sweep in progress before it runs its own
 *  beside it. Under the shortest life of a function that runs these (a tool
 *  page's 60 s), with room left for its own sweep. */
export const SWEEP_WAIT_MS = 30_000;

type Run = { done: Promise<void> };

const running = new Map<string, Run>();
/** The newest change waiting (or running) per key. */
const newest = new Map<string, symbol>();

/**
 * Run `sweep` for `key` once no other sweep of it is running here. Answers
 * "ran" for the caller that swept and "queued" for one that stepped aside
 * for a newer change. A sweep that throws rejects for its own caller only,
 * and the key is free again.
 */
export async function coalesceSweep(
  key: string,
  sweep: () => Promise<void>,
  options: { waitMs?: number } = {},
): Promise<"ran" | "queued"> {
  const waitMs = options.waitMs ?? SWEEP_WAIT_MS;
  const me = Symbol(key);
  newest.set(key, me);
  for (;;) {
    const current = running.get(key);
    if (!current) break;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const waited = await Promise.race([
      current.done.then(() => "done" as const),
      new Promise<"timeout">((resolve) => {
        timer = setTimeout(() => resolve("timeout"), waitMs);
      }),
    ]);
    clearTimeout(timer);
    // A newer change is waiting: it sweeps, with the latest picture.
    if (newest.get(key) !== me) return "queued";
    // Still the same sweep after the wait: it hung, or its function is gone.
    if (waited === "timeout" && running.get(key) === current) running.delete(key);
  }
  if (newest.get(key) !== me) return "queued";
  let finish: () => void = () => {};
  const run: Run = { done: new Promise<void>((resolve) => (finish = resolve)) };
  running.set(key, run);
  try {
    await sweep();
  } finally {
    // Only its own entries: a run that took over is not this one's to end.
    if (running.get(key) === run) running.delete(key);
    if (newest.get(key) === me) newest.delete(key);
    finish();
  }
  return "ran";
}
