// ---------------------------------------------------------------------------
// The deck editor's undo AND redo (TODO DK5.13), as data — the one stack the
// owner's page keeps for the session (components/decks/use-deck-editor.tsx;
// the toolbar's Undo / Redo, ⌘Z / ⇧⌘Z, a removal's toast and the phone bar
// all read it). Pure and framework-free, so the unit tests drive it with
// plain callbacks.
//
// A change is recorded as its REVERSE: a function that, when run, makes the
// change go away and — once the server has answered — hands back the
// reverse of what it just did (`done(next)`), or null when it could not be
// done (refused, the entries gone). That second reverse is what makes redo
// fall out of undo with no second mechanism:
//
//   a fresh edit      → its reverse onto UNDO, and REDO is cleared (the
//                       branch the reader left is gone, as in every editor);
//   Undo              → the step comes off UNDO and runs; what it hands back
//                       goes onto REDO, under the same words;
//   Redo              → the step comes off REDO and runs; what it hands back
//                       goes onto UNDO — REDO is kept.
//
// An Undo's answer arrives once the server has it — and a fresh edit made
// while it was on its way has already cleared REDO: that answer is the redo
// of a branch that is gone (its base is stale), so it is DROPPED, never put
// back on REDO over the newer edit.
//
// A step's words are the change's own ("add Sol Ring", "Moved Sol Ring to
// the Sideboard") — the page puts "Undo: " / "Redo: " in front. Several
// reverses that make ONE change ("Add 4": copies back on one row, three new
// lines out) run as one step through `combineReverses`, whose own reverse is
// again one step: one ⌘Z takes all four back out, one ⇧⌘Z puts all four in.
// ---------------------------------------------------------------------------

/** Undoes (or redoes) a change; calls `done` ONCE with the reverse of what
 *  it did, or null when nothing was done. */
export type Reverse = (done: (next: Reverse | null) => void) => void;

export type HistoryStep = { label: string; reverse: Reverse };

/** Where a change came from: the reader's own edit, an Undo or a Redo. */
export type StepOrigin = "edit" | "undo" | "redo";

export type UndoLabels = { undo: string | null; redo: string | null };

export type UndoHistory = {
  /** The reverse of a change, onto the stack its origin says. */
  record(step: HistoryStep, origin: StepOrigin): void;
  /** Takes the newest step (or `step`, wherever it sits) off a stack and
   *  runs it; false when there was nothing (already undone elsewhere). */
  run(which: "undo" | "redo", step?: HistoryStep): boolean;
  /** The step a fresh `record(…, "edit")` just put on top — the toast's
   *  Undo holds it, so a press after the bar's Undo does nothing. */
  top(which: "undo" | "redo"): HistoryStep | null;
  labels(): UndoLabels;
  /** Both stacks emptied (a restore of an older version changes every row
   *  the steps would touch). */
  clear(): void;
};

export const UNDO_LIMIT = 20;

export function createUndoHistory(onChange: (labels: UndoLabels) => void = () => {}, limit = UNDO_LIMIT): UndoHistory {
  let undo: HistoryStep[] = [];
  let redo: HistoryStep[] = [];
  /** Fresh edits recorded so far: an Undo answered after another one has a
   *  stale base. */
  let edits = 0;
  const labels = (): UndoLabels => ({ undo: undo.at(-1)?.label ?? null, redo: redo.at(-1)?.label ?? null });
  const changed = () => onChange(labels());
  const push = (stack: HistoryStep[], step: HistoryStep) => [...stack, step].slice(-limit);

  function record(step: HistoryStep, origin: StepOrigin) {
    if (origin === "undo") redo = push(redo, step);
    else {
      undo = push(undo, step);
      if (origin === "edit") {
        redo = [];
        edits += 1;
      }
    }
    changed();
  }

  function take(which: "undo" | "redo", step?: HistoryStep): HistoryStep | null {
    const stack = which === "undo" ? undo : redo;
    const index = step ? stack.lastIndexOf(step) : stack.length - 1;
    if (index < 0) return null;
    const taken = stack[index]!;
    const rest = [...stack.slice(0, index), ...stack.slice(index + 1)];
    if (which === "undo") undo = rest;
    else redo = rest;
    changed();
    return taken;
  }

  function run(which: "undo" | "redo", step?: HistoryStep): boolean {
    const taken = take(which, step);
    if (!taken) return false;
    let answered = false;
    const base = edits;
    taken.reverse((next) => {
      // A reverse answers once; a second answer is a bug, never a step.
      if (answered) return;
      answered = true;
      // An undo's redo whose branch a fresh edit has since cleared: gone.
      if (which === "undo" && edits !== base) return;
      if (next) record({ label: taken.label, reverse: next }, which);
    });
    return true;
  }

  return {
    record,
    run,
    top: (which) => (which === "undo" ? undo.at(-1) : redo.at(-1)) ?? null,
    labels,
    clear() {
      if (undo.length === 0 && redo.length === 0) return;
      undo = [];
      redo = [];
      changed();
    },
  };
}

/** Several reverses as ONE: all run at once, and when every one has
 *  answered, the reverses they handed back become one again (null when none
 *  did anything). */
export function combineReverses(parts: readonly Reverse[]): Reverse {
  return (done) => {
    if (parts.length === 0) {
      done(null);
      return;
    }
    let waiting = parts.length;
    const back: Reverse[] = [];
    for (const part of parts) {
      let answered = false;
      part((next) => {
        if (answered) return;
        answered = true;
        if (next) back.push(next);
        waiting -= 1;
        if (waiting === 0) done(back.length === 0 ? null : back.length === 1 ? back[0]! : combineReverses(back));
      });
    }
  };
}

/** "Undo: add Sol Ring" — the words a control says. */
export const undoWords = (label: string) => `Undo: ${label}`;
export const redoWords = (label: string) => `Redo: ${label}`;
