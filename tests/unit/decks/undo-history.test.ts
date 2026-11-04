import { describe, expect, it, vi } from "vitest";
import {
  combineReverses,
  createUndoHistory,
  redoWords,
  undoWords,
  type Reverse,
  type UndoLabels,
} from "@/lib/decks/undo-history";

// ---------------------------------------------------------------------------
// The deck editor's ONE undo / redo stack (TODO DK5.13). A change is
// recorded as its reverse; a reverse hands back its own reverse, which is
// the redo — no second mechanism. A fresh edit clears Redo; an Undo moves a
// step onto Redo under the same words and a Redo moves it back.
// ---------------------------------------------------------------------------

/** A counter the steps move: what the "deck" holds. */
function world() {
  let value = 0;
  const set = (to: number): Reverse => (done) => {
    const was = value;
    value = to;
    done(set(was));
  };
  return { get: () => value, edit: (to: number) => { const was = value; value = to; return set(was); } };
}

describe("createUndoHistory", () => {
  it("undo puts the change back, redo makes it again, under the same words", () => {
    const labels: UndoLabels[] = [];
    const history = createUndoHistory((next) => labels.push(next));
    const deck = world();
    history.record({ label: "add Sol Ring", reverse: deck.edit(1) }, "edit");
    expect(history.labels()).toEqual({ undo: "add Sol Ring", redo: null });

    expect(history.run("undo")).toBe(true);
    expect(deck.get()).toBe(0);
    expect(history.labels()).toEqual({ undo: null, redo: "add Sol Ring" });

    expect(history.run("redo")).toBe(true);
    expect(deck.get()).toBe(1);
    expect(history.labels()).toEqual({ undo: "add Sol Ring", redo: null });

    // …and again, as often as the reader likes.
    history.run("undo");
    history.run("redo");
    history.run("undo");
    expect(deck.get()).toBe(0);
    expect(labels.at(-1)).toEqual({ undo: null, redo: "add Sol Ring" });
  });

  it("an Undo answered AFTER a fresh edit is dropped — never a redo of the branch that edit cleared", () => {
    const history = createUndoHistory();
    const deck = world();
    history.record({ label: "older", reverse: deck.edit(1) }, "edit");
    history.record({ label: "newest", reverse: deck.edit(2) }, "edit");
    // The undo goes out; its answer waits on the server.
    let answer: ((next: Reverse | null) => void) | null = null;
    const slow: Reverse = (done) => {
      answer = done;
    };
    history.record({ label: "slow", reverse: slow }, "edit");
    history.run("undo");
    // A fresh edit lands first.
    history.record({ label: "fresh", reverse: deck.edit(5) }, "edit");
    expect(history.labels()).toEqual({ undo: "fresh", redo: null });
    answer!((done) => done(null));
    // Redo stays empty: "slow"'s redo was made on a base that is gone.
    expect(history.labels()).toEqual({ undo: "fresh", redo: null });
    // An undo answered with no edit in between still refills Redo.
    history.run("undo");
    expect(history.labels()).toEqual({ undo: "newest", redo: "fresh" });
  });

  it("walks back newest first and forward oldest first", () => {
    const history = createUndoHistory();
    const deck = world();
    history.record({ label: "1", reverse: deck.edit(1) }, "edit");
    history.record({ label: "2", reverse: deck.edit(2) }, "edit");
    history.record({ label: "3", reverse: deck.edit(3) }, "edit");
    history.run("undo");
    history.run("undo");
    expect(deck.get()).toBe(1);
    expect(history.labels()).toEqual({ undo: "1", redo: "2" });
    history.run("redo");
    expect(deck.get()).toBe(2);
    expect(history.labels()).toEqual({ undo: "2", redo: "3" });
  });

  it("a fresh edit clears Redo; a redo keeps the rest of it", () => {
    const history = createUndoHistory();
    const deck = world();
    history.record({ label: "1", reverse: deck.edit(1) }, "edit");
    history.record({ label: "2", reverse: deck.edit(2) }, "edit");
    history.run("undo");
    history.run("undo");
    history.run("redo");
    expect(history.labels().redo).toBe("2");
    history.record({ label: "other", reverse: deck.edit(9) }, "edit");
    expect(history.labels()).toEqual({ undo: "other", redo: null });
    expect(history.run("redo")).toBe(false);
  });

  it("a step that did nothing (refused, the entries gone) is dropped, never a dead step", () => {
    const history = createUndoHistory();
    history.record({ label: "gone", reverse: (done) => done(null) }, "edit");
    history.run("undo");
    expect(history.labels()).toEqual({ undo: null, redo: null });
  });

  it("answers a step once: an async reverse lands on Redo when the server answers", async () => {
    const history = createUndoHistory();
    let answer!: (next: Reverse | null) => void;
    history.record({ label: "move", reverse: (done) => (answer = done) }, "edit");
    history.run("undo");
    // On its way: off Undo, not yet on Redo.
    expect(history.labels()).toEqual({ undo: null, redo: null });
    answer((done) => done(null));
    answer((done) => done(null));
    expect(history.labels()).toEqual({ undo: null, redo: "move" });
    history.run("redo");
    expect(history.labels()).toEqual({ undo: null, redo: null });
  });

  it("a named step runs only once — the toast's Undo after the bar's does nothing", () => {
    const history = createUndoHistory();
    const reverse = vi.fn<Reverse>((done) => done(null));
    history.record({ label: "remove Bolt", reverse }, "edit");
    const step = history.top("undo")!;
    expect(history.run("undo")).toBe(true);
    expect(history.run("undo", step)).toBe(false);
    expect(reverse).toHaveBeenCalledTimes(1);
  });

  it("keeps the last 20 steps", () => {
    const history = createUndoHistory();
    const deck = world();
    for (let i = 1; i <= 25; i += 1) history.record({ label: String(i), reverse: deck.edit(i) }, "edit");
    let undone = 0;
    while (history.run("undo")) undone += 1;
    expect(undone).toBe(20);
  });

  it("clear() empties both stacks", () => {
    const history = createUndoHistory();
    const deck = world();
    history.record({ label: "1", reverse: deck.edit(1) }, "edit");
    history.record({ label: "2", reverse: deck.edit(2) }, "edit");
    history.run("undo");
    history.clear();
    expect(history.labels()).toEqual({ undo: null, redo: null });
  });

  it("says what a control does", () => {
    expect(undoWords("add Sol Ring")).toBe("Undo: add Sol Ring");
    expect(redoWords("add Sol Ring")).toBe("Redo: add Sol Ring");
  });
});

describe("combineReverses — one ⌘Z for an \"Add 4\", one ⇧⌘Z to put all four in", () => {
  it("runs every part and hands back ONE reverse once all have answered", () => {
    const a = world();
    const b = world();
    const undoAll = combineReverses([a.edit(2), b.edit(3)]);
    const history = createUndoHistory();
    history.record({ label: "add 2 cards", reverse: undoAll }, "edit");
    history.run("undo");
    expect([a.get(), b.get()]).toEqual([0, 0]);
    expect(history.labels().redo).toBe("add 2 cards");
    history.run("redo");
    expect([a.get(), b.get()]).toEqual([2, 3]);
    history.run("undo");
    expect([a.get(), b.get()]).toEqual([0, 0]);
  });

  it("waits for the slowest part, and keeps only the parts that did something", () => {
    let late!: (next: Reverse | null) => void;
    const done = vi.fn();
    const back: Reverse = (d) => d(null);
    combineReverses([(d) => d(back), (d) => d(null), (d) => (late = d)])(done);
    expect(done).not.toHaveBeenCalled();
    late(null);
    expect(done).toHaveBeenCalledWith(back);
  });

  it("nothing done anywhere is null", () => {
    const done = vi.fn();
    combineReverses([(d) => d(null), (d) => d(null)])(done);
    combineReverses([])(done);
    expect(done.mock.calls).toEqual([[null], [null]]);
  });
});
