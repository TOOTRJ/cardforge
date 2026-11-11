import { describe, expect, it } from "vitest";
import { createLookupPacer } from "@/scripts/lib/frame-objects.mjs";
import { SWEEP_STRIDE, planFramesCheck } from "@/scripts/lib/frames-check-plan.mjs";
import {
  SECONDS_PER_UNCACHED,
  STRICT_FIXED_SECONDS,
  STRICT_MAX_SECONDS,
  STRICT_MIN_SECONDS,
  SWEEP_BUDGET_SECONDS,
  framesCheckBudgetSeconds,
  runFramesCheck,
} from "@/scripts/lib/frames-check-run.mjs";

// ---------------------------------------------------------------------------
// What scripts/frames-check.mjs decides (2026-11-10). The gate has two kinds
// of object now, and the difference is the whole point:
//
//   - what a pull request, a merge or a production build ADDS must be
//     verified — missing, unanswered or not reached, each is exit 1;
//   - the canary and the nightly sweep are samples of objects an earlier
//     run verified — a MISSING one is exit 1; one the slow pace did not
//     reach is counted, and the run is green.
//
// A gate that passes an object nobody verified is worse than no gate, so
// every exit code is pinned here.
// ---------------------------------------------------------------------------

type Entry = { hash: string; bytes: number };
type Item = [string, Entry];
type Manifest = { version: 1; bucket: string; files: Record<string, Entry> };
type Answer = { ok: boolean; status: string };

const hex = (n: number) => n.toString(16).padStart(12, "0");
const sha = (n: number) => n.toString(16).padStart(40, "0");
const manifestOf = (count: number): Manifest => ({
  version: 1,
  bucket: "frames",
  files: Object.fromEntries(Array.from({ length: count }, (_, i) => [`t${i}/w.png`, { hash: hex(i + 1), bytes: 1000 + i }])),
});
const ORIGIN = "https://prod.example/storage/v1/object/public/frames";
const HIT = { ok: true, status: "206" };
const GONE = { ok: false, status: "400" };

const never = () => new AbortController().signal;
const spent = () => {
  const controller = new AbortController();
  controller.abort();
  return controller.signal;
};
/** A pacer on a clock that never waits for real. */
const pacerOf = () => {
  let t = 0;
  return createLookupPacer({ now: () => t, sleep: async (ms: number) => void (t += ms) });
};

/** Run a check over `plan`; `answers(key, thorough)` is production's bucket. */
async function run(
  plan: ReturnType<typeof planFramesCheck>,
  answers: (key: string, thorough: boolean) => Answer | { answer: Answer; http: number; cached: boolean },
  extra: Partial<Parameters<typeof runFramesCheck>[0]> = {},
) {
  const out: string[] = [];
  const err: string[] = [];
  const asked: string[] = [];
  const total = plan.entries.length + (plan.mode === "incremental" ? plan.unchanged - plan.canary.length : 0);
  const result = await runFramesCheck({
    plan,
    origin: ORIGIN,
    total,
    budgetSeconds: 780,
    signal: never(),
    timeout: never,
    pacer: pacerOf(),
    confirmDelayMs: 0,
    progressMs: 0,
    log: (line: string) => out.push(line),
    error: (line: string) => err.push(line),
    lookup: async ([key]: Item, thorough: boolean, onAnswer?: (a: { status: number; cached: boolean }) => void) => {
      asked.push(key);
      const said = answers(key, thorough);
      if ("answer" in said) {
        onAnswer?.({ status: said.http, cached: said.cached });
        return said.answer;
      }
      onAnswer?.({ status: Number(said.status) || 0, cached: said.ok });
      return said;
    },
    ...extra,
  });
  return { ...result, out: out.join("\n"), err: err.join("\n"), asked };
}

/** CI's plan for a run that adds `added` objects to a 600-object manifest. */
function ciPlan(added: string[] = [], canarySize?: number, production = false) {
  const base = manifestOf(600);
  const current = structuredClone(base);
  for (const [i, key] of added.entries()) current.files[key] = { hash: hex(9000 + i), bytes: 7 };
  const plan = planFramesCheck({
    manifest: current,
    incremental: true,
    originIsProduction: true,
    env: production
      ? { VERCEL_ENV: "production", VERCEL_GIT_COMMIT_SHA: sha(0xabc), VERCEL_GIT_PREVIOUS_SHA: sha(0xdef) }
      : { FRAMES_CHECK_BASE_SHA: sha(0xdef), GITHUB_SHA: sha(0xabc) },
    canarySize,
    readBase: () => ({ manifest: base }),
  });
  if (plan.mode !== "incremental") throw new Error(plan.reason);
  return plan;
}
const fullPlan = (count = 600) => planFramesCheck({ manifest: manifestOf(count), incremental: false, originIsProduction: true, env: {} });

describe("a pull request or a merge (CI's incremental check)", () => {
  it("a run that leaves the manifest alone asks production for NOTHING and passes", async () => {
    const r = await run(ciPlan(), () => HIT);
    expect(r).toMatchObject({ exitCode: 0, complete: null, asked: [] });
    expect(r.out).toContain("0 new or changed manifest object(s)");
  });

  it("looks up exactly what it adds; all published → 0", async () => {
    const r = await run(ciPlan(["new/a.png", "new/b.webp"]), () => HIT);
    expect(r.exitCode).toBe(0);
    expect(r.asked.sort()).toEqual(["new/a.png", "new/b.webp"]);
    expect(r.out).toContain("✓ All 2 new or changed manifest objects are published");
  });

  it("an unpromoted new frame → 1, named with its answer (the pull request stays red until the owner promotes)", async () => {
    const r = await run(ciPlan(["new/a.png", "new/b.webp"]), (key) => (key === "new/b.webp" ? GONE : HIT));
    expect(r.exitCode).toBe(1);
    expect(r.err).toContain("1/2 manifest objects are missing");
    expect(r.err).toMatch(/new\/b\.[0-9a-f]{12}\.webp {2}\(last answer: 400\)/);
    expect(r.err).toContain("npm run frames:promote");
  });

  it("a new frame storage never answered for → 1: not missing, and not a pass", async () => {
    const r = await run(ciPlan(["new/a.png"]), () => ({ ok: false, status: "timeout" }));
    expect(r.exitCode).toBe(1);
    expect(r.err).toContain("could not verify 1 of 1 objects");
    expect(r.err).toContain("last answers: timeout ×1");
    expect(r.err).toContain("it is not a pass");
    expect(r.err).not.toContain("are missing from");
  });

  it("a new frame the budget did not reach → 1", async () => {
    const r = await run(ciPlan(["new/a.png", "new/b.png"]), () => HIT, { signal: spent() });
    expect(r).toMatchObject({ exitCode: 1, asked: [] });
    expect(r.err).toContain("could not verify 2 of 2 objects");
    expect(r.err).toContain("ran out of time");
  });

  it("storage that stays saturated → 1 for what the run adds (the check stops knocking, and says so)", async () => {
    const added = Array.from({ length: 40 }, (_, i) => `new/k${i}.png`);
    const r = await run(ciPlan(added), () => ({ answer: { ok: false, status: "429" }, http: 429, cached: false }));
    expect(r.exitCode).toBe(1);
    expect(r.err).toContain("kept answering 429");
    // Three pauses, then it ends: a handful of lookups, never all forty over and over.
    expect(r.asked.length).toBeLessThan(20);
  });
});

describe("a production build (changed objects, then the canary)", () => {
  it("a canary object the bucket LOST fails the build, as before", async () => {
    const plan = ciPlan([], 50, true);
    const [lost] = plan.canary[0];
    const r = await run(plan, (key) => (key === lost ? GONE : HIT));
    expect(r.exitCode).toBe(1);
    expect(r.err).toContain("1/50 manifest objects are missing");
  });

  it("canary objects a cold CDN kept out of reach do NOT fail it — counted, and left to the sweep", async () => {
    const plan = ciPlan(["new/a.png"], 50, true);
    const r = await run(plan, () => HIT, { timeout: spent });
    expect(r.exitCode).toBe(0);
    // The new object was verified (strict); the canary's first pass had no time.
    expect(r.asked).toEqual(["new/a.png"]);
    expect(r.out).toContain("0 of the 50 canary (the other 50 were not looked at");
  });

  it("a new object is never covered by the canary's tolerance", async () => {
    const plan = ciPlan(["new/a.png"], 50, true);
    const r = await run(plan, (key) => (key === "new/a.png" ? { ok: false, status: "503" } : HIT));
    expect(r.exitCode).toBe(1);
    expect(r.err).toContain("could not verify 1 of 1 objects");
  });

  it("a canary object that SAID missing and could not be settled is not a pass", async () => {
    const plan = ciPlan([], 50, true);
    const [suspect] = plan.canary[0];
    const reserve = new AbortController();
    const r = await run(
      plan,
      (key, thorough) => {
        if (thorough) reserve.abort();
        return key === suspect ? GONE : HIT;
      },
      { signal: reserve.signal },
    );
    expect(r.exitCode).toBe(1);
    expect(r.err).toContain("could not verify 1 of 50 objects");
    expect(r.err).toContain("last answers: 400 ×1");
  });
});

describe("the nightly sweep", () => {
  const sweep = { sweep: true, budgetSeconds: 1200, day: 0 };

  it("every object looked at and found → 0, complete (the only run that may close the alert issue)", async () => {
    const r = await run(fullPlan(), () => HIT, sweep);
    expect(r).toMatchObject({ exitCode: 0, complete: true });
    expect(r.asked).toHaveLength(600);
    expect(r.out).toContain("✓ All 600 manifest objects are published");
  });

  it("starts a stride further each night", async () => {
    const night0 = await run(fullPlan(1000), () => HIT, { ...sweep, day: 0 });
    const night1 = await run(fullPlan(1000), () => HIT, { ...sweep, day: 1 });
    expect(night0.asked[0]).toBe("t0/w.png");
    expect(night1.asked.slice(0, 4)).toContain(`t${SWEEP_STRIDE}/w.png`);
    expect(night1.out).toMatch(new RegExp(`starting at t${SWEEP_STRIDE}/w\\.`));
  });

  it("an object gone from the bucket → 1, never complete", async () => {
    const r = await run(fullPlan(), (key) => (key === "t77/w.png" ? GONE : HIT), sweep);
    expect(r).toMatchObject({ exitCode: 1, complete: false });
    expect(r.err).toContain("1/600 manifest objects are missing");
    expect(r.err).toMatch(/t77\/w\.[0-9a-f]{12}\.png/);
  });

  it("a cold CDN night: what it reached is fine, the rest is counted → 0, NOT complete", async () => {
    // The first pass's time ends after 150 lookups; the confirm pass still has its reserve.
    const firstPass = new AbortController();
    let looked = 0;
    const r = await run(
      fullPlan(),
      () => {
        looked += 1;
        if (looked === 150) firstPass.abort();
        return { answer: HIT, http: 206, cached: false };
      },
      { ...sweep, timeout: () => firstPass.signal },
    );
    expect(r).toMatchObject({ exitCode: 0, complete: false });
    expect(r.asked.length).toBe(150);
    expect(r.out).toContain("None of the 150 manifest objects looked at tonight is missing");
    expect(r.out).toContain("450 were not looked at");
    expect(r.out).toContain("this is not a failure");
    expect(r.err).toBe("");
  });

  it("a miss inside the part it reached is still a failure on a cold night", async () => {
    const firstPass = new AbortController();
    let looked = 0;
    const r = await run(
      fullPlan(),
      (key, thorough) => {
        if (!thorough) {
          looked += 1;
          if (looked === 150) firstPass.abort();
        }
        return key === "t20/w.png" ? GONE : HIT;
      },
      { ...sweep, timeout: () => firstPass.signal },
    );
    expect(r).toMatchObject({ exitCode: 1, complete: false });
    expect(r.err).toMatch(/t20\/w\.[0-9a-f]{12}\.png {2}\(last answer: 400\)/);
  });

  it("an object that SAID missing but could not be settled (storage went busy) is red, not a quiet green", async () => {
    const r = await run(
      fullPlan(),
      (key, thorough) => {
        if (key === "t3/w.png" && !thorough) return GONE;
        if (thorough) return { answer: { ok: false, status: "429" }, http: 429, cached: false };
        return HIT;
      },
      sweep,
    );
    expect(r).toMatchObject({ exitCode: 1, complete: false });
    expect(r.err).toContain("could not verify 1 of 600 objects");
  });

  // The re-check's sequences: "missing" said only in the confirm pass, then silence or a cut.
  it.each([
    ["silent first, then 400 ×3, then a 429", "timeout", ["400", "400", "400", "429"]],
    ["a 503 first, then one 400, then the storage goes busy for good", "503", ["400", "429", "429", "429"]],
    ["dropped first, then a wrong size twice, then 502s", "network", ["size 3", "size 3", "502", "502"]],
  ])("an object that said missing only in the confirm pass is red too (%s)", async (_label, first, confirms) => {
    let attempt = 0;
    const r = await run(
      fullPlan(),
      (key, thorough) => {
        if (key !== "t3/w.png") return HIT;
        const status = thorough ? confirms[Math.min(attempt++, confirms.length - 1)] : first;
        return { answer: { ok: false, status }, http: status === "429" ? 429 : Number(status) || 0, cached: false };
      },
      sweep,
    );
    expect(r).toMatchObject({ exitCode: 1, complete: false });
    expect(r.err).toContain("could not verify 1 of 600 objects");
    expect(r.out).not.toContain("this is not a failure");
  });

  it("…and so is a canary object in a production build", async () => {
    const plan = ciPlan([], 50, true);
    const [suspect] = plan.canary[0];
    const confirms = ["400", "400", "400", "timeout"];
    let attempt = 0;
    const r = await run(plan, (key, thorough) => {
      if (key !== suspect) return HIT;
      return { ok: false, status: thorough ? confirms[attempt++] : "timeout" };
    });
    expect(r.exitCode).toBe(1);
    expect(r.err).toContain("last answers: 400 ×1");
  });

  it("objects storage was only SILENT about are not a failure: counted, not complete", async () => {
    const r = await run(fullPlan(), (key) => (key === "t3/w.png" || key === "t9/w.png" ? { ok: false, status: "timeout" } : HIT), sweep);
    expect(r).toMatchObject({ exitCode: 0, complete: false });
    expect(r.out).toContain("2 were not looked at");
  });

  it("a storage that stays saturated ends the sweep green and incomplete — it never keeps knocking", async () => {
    const r = await run(fullPlan(), () => ({ answer: { ok: false, status: "429" }, http: 429, cached: false }), sweep);
    expect(r).toMatchObject({ exitCode: 0, complete: false });
    expect(r.asked.length).toBeLessThan(20);
    expect(r.out).toContain("kept answering 429");
  });
});

describe("the owner's full check (npm run frames:check, or any doubt about the base)", () => {
  it("every object must be verified: found → 0, one missing → 1, one unreached → 1", async () => {
    expect((await run(fullPlan(), () => HIT)).exitCode).toBe(0);
    const missing = await run(fullPlan(), (key) => (key === "t5/w.png" ? GONE : HIT));
    expect(missing.exitCode).toBe(1);
    expect(missing.err).toContain("1/600 manifest objects are missing");
    const unreached = await run(fullPlan(), () => HIT, { signal: spent() });
    expect(unreached.exitCode).toBe(1);
    expect(unreached.err).toContain("could not verify 600 of 600 objects");
  });

  it("says why an --incremental run was a full one", async () => {
    const plan = planFramesCheck({ manifest: manifestOf(3), incremental: true, originIsProduction: true, env: { FRAMES_CHECK_BASE_SHA: "main" } });
    const r = await run(plan, () => HIT, { incrementalAsked: true });
    expect(r.exitCode).toBe(0);
    expect(r.out).toContain('Full check: FRAMES_CHECK_BASE_SHA ("main") is not a full commit SHA.');
  });
});

describe("the budget (framesCheckBudgetSeconds)", () => {
  it("is --budget-seconds when given, the sweep's own, and never under the old 13 minutes for a strict check", () => {
    expect(framesCheckBudgetSeconds({ sweep: false, strictCount: 5000, override: 60 })).toBe(60);
    expect(framesCheckBudgetSeconds({ sweep: true, strictCount: 0 })).toBe(SWEEP_BUDGET_SECONDS);
    expect(framesCheckBudgetSeconds({ sweep: false, strictCount: 0 })).toBe(STRICT_MIN_SECONDS);
    expect(framesCheckBudgetSeconds({ sweep: false, strictCount: 100 })).toBe(STRICT_MIN_SECONDS);
  });

  it("grows with what a run must verify — the largest frame merges on main (419 and 291 objects) fit — and stays under CI's 25-minute job", () => {
    const need = (n: number) => STRICT_FIXED_SECONDS + Math.ceil(n * SECONDS_PER_UNCACHED);
    expect(framesCheckBudgetSeconds({ sweep: false, strictCount: 419 })).toBe(need(419));
    expect(need(419)).toBeGreaterThan(STRICT_MIN_SECONDS);
    expect(framesCheckBudgetSeconds({ sweep: false, strictCount: 700 })).toBe(need(700));
    expect(framesCheckBudgetSeconds({ sweep: false, strictCount: 4280 })).toBe(STRICT_MAX_SECONDS);
    expect(STRICT_MAX_SECONDS).toBeLessThan(25 * 60 - 120);
    expect(SWEEP_BUDGET_SECONDS).toBeLessThan(25 * 60 - 120);
  });

  it("the cap is CI's and the build's: the owner's own full check gets the time a cold CDN needs, however long", () => {
    const need = STRICT_FIXED_SECONDS + Math.ceil(4280 * SECONDS_PER_UNCACHED);
    expect(framesCheckBudgetSeconds({ sweep: false, strictCount: 4280, unattended: false })).toBe(need);
    expect(need).toBeGreaterThan(60 * 60);
    expect(framesCheckBudgetSeconds({ sweep: false, strictCount: 4280, unattended: true })).toBe(STRICT_MAX_SECONDS);
    // Unattended is the default: a caller that does not say is capped.
    expect(framesCheckBudgetSeconds({ sweep: false, strictCount: 4280 })).toBe(STRICT_MAX_SECONDS);
    expect(framesCheckBudgetSeconds({ sweep: false, strictCount: 10, unattended: false })).toBe(STRICT_MIN_SECONDS);
  });

  it("a cold night is sure of its stride: the slow pace reaches SWEEP_STRIDE objects inside the sweep's first pass", () => {
    // The pacer's 0.5 s gap plus a slow second of lookup, and one minute's busy pause.
    const firstPassSeconds = SWEEP_BUDGET_SECONDS - 180;
    expect((firstPassSeconds - 60) / (0.5 + 1.0)).toBeGreaterThan(SWEEP_STRIDE);
  });
});
