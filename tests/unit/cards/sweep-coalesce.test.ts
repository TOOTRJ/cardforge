import { describe, expect, it } from "vitest";
import { SWEEP_WAIT_MS, coalesceSweep } from "@/lib/cards/sweep-coalesce";

// ---------------------------------------------------------------------------
// Making or replacing a custom symbol or pip re-bakes up to 40 of the owner's
// cards after the response, and every save started its own sweep over the
// same cards at once (2026-11-10: 30 saves a minute could queue 1,200 bakes).
// One sweep at a time per subject; the NEWEST change waits for the running
// one and then sweeps itself, in its own request — the changes in between
// step aside. A sweep that hangs never holds a later change back.
// ---------------------------------------------------------------------------

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Sweeps the test finishes by hand, counting how many run at once. */
function controlled() {
  const releases: Array<() => void> = [];
  const state = { started: 0, running: 0, most: 0, order: [] as string[] };
  const sweep = (name = "") => () =>
    new Promise<void>((resolve) => {
      state.started += 1;
      state.running += 1;
      state.most = Math.max(state.most, state.running);
      state.order.push(name);
      releases.push(() => {
        state.running -= 1;
        resolve();
      });
    });
  const finishOne = async () => {
    releases.shift()?.();
    await tick();
    await tick();
  };
  return { sweep, state, finishOne };
}

describe("coalesceSweep", () => {
  it("a sweep with nothing in its way runs once", async () => {
    let runs = 0;
    expect(await coalesceSweep("symbol:u1:FOO", async () => void (runs += 1))).toBe("ran");
    expect(runs).toBe(1);
  });

  it("a change while one runs starts NO second sweep at once: it waits, then sweeps ITSELF (its own request, its own budget)", async () => {
    const { sweep, state, finishOne } = controlled();
    const first = coalesceSweep("symbol:u1:A", sweep("first"));
    await tick();
    const second = coalesceSweep("symbol:u1:A", sweep("second"));
    await tick();
    expect(state.started).toBe(1);
    await finishOne();
    expect(await first).toBe("ran");
    // The second change's OWN sweep runs now — not a second pass of the first caller's.
    expect(state.order).toEqual(["first", "second"]);
    await finishOne();
    expect(await second).toBe("ran");
    expect(state.most).toBe(1);
  });

  it("a storm of changes is ONE more sweep — the newest's, which sees the latest picture — not one each", async () => {
    const { sweep, state, finishOne } = controlled();
    const first = coalesceSweep("symbol:u1:B", sweep("first"));
    await tick();
    const waiting = ["a", "b", "c", "d", "e"].map((name) => coalesceSweep("symbol:u1:B", sweep(name)));
    await tick();
    await finishOne();
    expect(await first).toBe("ran");
    await finishOne();
    expect(await Promise.all(waiting)).toEqual(["queued", "queued", "queued", "queued", "ran"]);
    expect(state.order).toEqual(["first", "e"]);
    expect(state.most).toBe(1);
  });

  it("a change DURING the second sweep gets a third (the latest picture always gets a pass)", async () => {
    const { sweep, state, finishOne } = controlled();
    const first = coalesceSweep("symbol:u1:C", sweep("first"));
    await tick();
    const second = coalesceSweep("symbol:u1:C", sweep("second"));
    await finishOne();
    await first;
    const third = coalesceSweep("symbol:u1:C", sweep("third"));
    await tick();
    expect(state.order).toEqual(["first", "second"]);
    await finishOne();
    expect(await second).toBe("ran");
    await finishOne();
    expect(await third).toBe("ran");
    expect(state.order).toEqual(["first", "second", "third"]);
    expect(state.most).toBe(1);
  });

  it("different owners and different symbols never wait for each other", async () => {
    const { sweep, state, finishOne } = controlled();
    const runs = [
      coalesceSweep("symbol:u1:D", sweep()),
      coalesceSweep("symbol:u2:D", sweep()),
      coalesceSweep("pip:u1:W", sweep()),
    ];
    await tick();
    expect(state.started).toBe(3);
    await finishOne();
    await finishOne();
    await finishOne();
    expect(await Promise.all(runs)).toEqual(["ran", "ran", "ran"]);
  });

  it("a sweep that throws rejects for its own caller, frees its key, and lets the change waiting behind it sweep", async () => {
    let fail: (error: Error) => void = () => {};
    const first = coalesceSweep("symbol:u1:E", () => new Promise<void>((_resolve, reject) => (fail = reject)));
    await tick();
    let runs = 0;
    const second = coalesceSweep("symbol:u1:E", async () => void (runs += 1));
    fail(new Error("storage is away"));
    await expect(first).rejects.toThrow("storage is away");
    expect(await second).toBe("ran");
    expect(runs).toBe(1);
    expect(await coalesceSweep("symbol:u1:E", async () => void (runs += 1))).toBe("ran");
    expect(runs).toBe(2);
  });

  it("a sweep that never settles holds nobody back: after the wait the change behind it sweeps beside it — and is not dropped", async () => {
    // A bake that hangs, or a function that was stopped: this sweep never ends.
    void coalesceSweep("symbol:u1:HUNG", () => new Promise<void>(() => {}));
    await tick();
    let runs = 0;
    const behind = coalesceSweep("symbol:u1:HUNG", async () => void (runs += 1), { waitMs: 20 });
    await tick();
    expect(runs).toBe(0);
    expect(await behind).toBe("ran");
    expect(runs).toBe(1);
    // The key is free: the next change does not wait for the hung one again.
    expect(await coalesceSweep("symbol:u1:HUNG", async () => void (runs += 1), { waitMs: 20 })).toBe("ran");
    expect(runs).toBe(2);
  });

  it("a hung sweep that finally ends does not end the run that went on without it", async () => {
    let endOld: () => void = () => {};
    const old = coalesceSweep("symbol:u1:SLOW", () => new Promise<void>((resolve) => (endOld = resolve)));
    await tick();
    const { sweep, state, finishOne } = controlled();
    const took = coalesceSweep("symbol:u1:SLOW", sweep("took over"), { waitMs: 10 });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(state.order).toEqual(["took over"]);
    endOld();
    expect(await old).toBe("ran");
    // The run that took over still holds the key: a change now waits for IT.
    const next = coalesceSweep("symbol:u1:SLOW", sweep("next"));
    await tick();
    expect(state.started).toBe(1);
    await finishOne();
    expect(await took).toBe("ran");
    await finishOne();
    expect(await next).toBe("ran");
  });

  it("waits less than the shortest life of a function that runs these sweeps (a tool page's 60 s), with room for its own", () => {
    expect(SWEEP_WAIT_MS).toBeLessThanOrEqual(30_000);
  });
});
