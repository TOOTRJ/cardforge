import { describe, expect, it } from "vitest";
import { createEntryQueue } from "@/lib/decks/entry-queue";

// ---------------------------------------------------------------------------
// The deck page's write queue (TODO DK5.8, lib/decks/entry-queue.ts): ONE
// line per entry — a write waits for the writes before it on its entries,
// a waiting write is replaced by a newer one of its kind on the same
// entries, and a failure cancels the writes still waiting on its entries.
// ---------------------------------------------------------------------------

/** A write the test settles by hand. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("the write queue", () => {
  it("runs ONE write at a time on an entry, in order; other entries go on in parallel", async () => {
    const queue = createEntryQueue();
    const started: string[] = [];
    const first = deferred<{ ok: true }>();
    const second = deferred<{ ok: true }>();
    const other = deferred<{ ok: true }>();
    const a = queue.run(["e1"], () => (started.push("a"), first.promise));
    const b = queue.run(["e1"], () => (started.push("b"), second.promise));
    const c = queue.run(["e2"], () => (started.push("c"), other.promise));
    await tick();
    expect(started).toEqual(["a", "c"]);
    expect(queue.pending("e1")).toBe(2);
    first.resolve({ ok: true });
    await expect(a).resolves.toEqual({ status: "done", value: { ok: true } });
    await tick();
    expect(started).toEqual(["a", "c", "b"]);
    second.resolve({ ok: true });
    other.resolve({ ok: true });
    await Promise.all([b, c]);
    expect(queue.pending("e1")).toBe(0);
    expect(queue.pending("e2")).toBe(0);
  });

  it("a write on several entries waits for each of them", async () => {
    const queue = createEntryQueue();
    const started: string[] = [];
    const one = deferred<string>();
    const two = deferred<string>();
    void queue.run(["e1"], () => (started.push("one"), one.promise));
    void queue.run(["e2"], () => (started.push("two"), two.promise));
    const bulk = queue.run(["e1", "e2"], async () => (started.push("bulk"), "bulk"));
    await tick();
    one.resolve("1");
    await tick();
    expect(started).not.toContain("bulk");
    two.resolve("2");
    await expect(bulk).resolves.toEqual({ status: "done", value: "bulk" });
    expect(started).toEqual(["one", "two", "bulk"]);
  });

  it("a WAITING write is replaced by a newer one of its kind on the same entries — five presses, two requests", async () => {
    const queue = createEntryQueue();
    const sent: number[] = [];
    const inFlight = deferred<number>();
    const presses = [3, 4, 5, 6, 7].map((quantity, index) =>
      queue.run(["e1"], () => (sent.push(quantity), index === 0 ? inFlight.promise : Promise.resolve(quantity)), { coalesce: "quantity" }),
    );
    await tick();
    expect(sent).toEqual([3]);
    // The ones replaced answer at once — never sent.
    await expect(presses[1]).resolves.toEqual({ status: "superseded" });
    await expect(presses[3]).resolves.toEqual({ status: "superseded" });
    inFlight.resolve(3);
    await expect(presses[4]).resolves.toEqual({ status: "done", value: 7 });
    expect(sent).toEqual([3, 7]);
  });

  it("never replaces a write of another kind, or on other entries", async () => {
    const queue = createEntryQueue();
    const sent: string[] = [];
    const block = deferred<string>();
    void queue.run(["e1", "e2"], () => (sent.push("block"), block.promise));
    const quantity = queue.run(["e1"], async () => (sent.push("qty"), "qty"), { coalesce: "quantity" });
    const board = queue.run(["e1"], async () => (sent.push("board"), "board"), { coalesce: "board" });
    const elsewhere = queue.run(["e2"], async () => (sent.push("e2 qty"), "e2"), { coalesce: "quantity" });
    block.resolve("ok");
    await Promise.all([quantity, board, elsewhere]);
    expect(sent).toEqual(["block", "qty", "e2 qty", "board"]);
  });

  it("a refusal cancels the writes still waiting on its entries — they were made on a value the server never took", async () => {
    const queue = createEntryQueue();
    const sent: string[] = [];
    const refused = deferred<{ ok: boolean; error?: string }>();
    const failed = (value: { ok: boolean }) => !value.ok;
    const first = queue.run(["e1"], () => (sent.push("first"), refused.promise), { failed });
    const onTop = queue.run(["e1"], async () => (sent.push("on top"), { ok: true }), { failed, coalesce: "board" });
    const elsewhere = queue.run(["e2"], async () => (sent.push("elsewhere"), { ok: true }), { failed });
    refused.resolve({ ok: false, error: "Deck not found or not yours." });
    await expect(first).resolves.toEqual({ status: "failed", value: { ok: false, error: "Deck not found or not yours." } });
    await expect(onTop).resolves.toEqual({ status: "cancelled" });
    await expect(elsewhere).resolves.toEqual({ status: "done", value: { ok: true } });
    expect(sent).toEqual(["first", "elsewhere"]);
    // A write queued AFTER the failure goes ahead.
    await expect(queue.run(["e1"], async () => ({ ok: true }), { failed })).resolves.toEqual({ status: "done", value: { ok: true } });
  });

  it("a request that throws is a failure too (the caller then asks the server again)", async () => {
    const queue = createEntryQueue();
    const lost = new Error("Failed to fetch");
    const outcome = await queue.run(["e1"], async () => {
      throw lost;
    });
    expect(outcome).toEqual({ status: "failed", error: lost });
    expect(queue.pending("e1")).toBe(0);
  });
});
