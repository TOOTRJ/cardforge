// ---------------------------------------------------------------------------
// The deck page's write queue (TODO DK5.8): ONE line per entry. The page
// draws an edit at once (an optimistic update, components/decks/
// use-deck-editor.tsx) and sends it through here, so two writes to the same
// entry never race:
//
//   * a write starts only once every earlier write that touches one of its
//     entries has settled — a "+" pressed while the last "+" is still on
//     its way waits for it (writes to other entries go on in parallel; Next
//     sends server actions one at a time anyway, so the order is the
//     page's, never the network's);
//   * a write still WAITING is replaced by a newer one of the same kind on
//     the same entries (`coalesce`): every edit says the value it wants
//     ("3 copies"), never a step ("one more"), so the newest says all —
//     five quick presses are two requests, not five;
//   * a write that FAILS cancels the writes still waiting on its entries:
//     they were made on top of a value the server never took, and the page
//     rolls back to what the server holds and says so, once.
//
// Pure and framework-free (no React, no Next), so the unit tests drive it
// with plain promises.
// ---------------------------------------------------------------------------

export type QueueOutcome<T> =
  /** The write ran and answered. */
  | { status: "done"; value: T }
  /** The write ran and failed: it threw (`error`), or `failed` read its
   *  answer as a refusal (`value`). */
  | { status: "failed"; error?: unknown; value?: T }
  /** A newer write of the same kind on the same entries took its place
   *  before it started: never sent. */
  | { status: "superseded" }
  /** An earlier write on one of its entries failed before it started:
   *  never sent. */
  | { status: "cancelled" };

export type QueueRunOptions<T> = {
  /** Writes with the same key on the same entries replace each other while
   *  they wait (the newest wins). Omitted: never replaced. */
  coalesce?: string;
  /** Whether an answer is a refusal ({ ok: false }) — a failure like a
   *  throw: the writes waiting on these entries are cancelled. */
  failed?: (value: T) => boolean;
};

export type EntryQueue = {
  run<T>(keys: readonly string[], send: () => Promise<T>, options?: QueueRunOptions<T>): Promise<QueueOutcome<T>>;
  /** How many writes touching `key` are waiting or in flight. */
  pending(key: string): number;
};

type Task = {
  keys: ReadonlySet<string>;
  coalesce: string | null;
  /** Settles the caller's promise early (superseded / cancelled). */
  drop: (outcome: { status: "superseded" } | { status: "cancelled" }) => void;
  /** The caller has its answer. */
  dropped: boolean;
};

const sameKeys = (a: ReadonlySet<string>, b: ReadonlySet<string>) => a.size === b.size && [...a].every((key) => b.has(key));
const shares = (a: ReadonlySet<string>, b: ReadonlySet<string>) => [...a].some((key) => b.has(key));

export function createEntryQueue(): EntryQueue {
  /** Per entry: settles when the last write queued on it has settled. */
  const tails = new Map<string, Promise<void>>();
  /** Writes queued and not yet started. */
  const waiting = new Set<Task>();
  const counts = new Map<string, number>();

  const count = (keys: Iterable<string>, by: number) => {
    for (const key of keys) {
      const next = (counts.get(key) ?? 0) + by;
      if (next > 0) counts.set(key, next);
      else counts.delete(key);
    }
  };

  function run<T>(rawKeys: readonly string[], send: () => Promise<T>, options: QueueRunOptions<T> = {}): Promise<QueueOutcome<T>> {
    const keys: ReadonlySet<string> = new Set(rawKeys);
    return new Promise<QueueOutcome<T>>((resolve) => {
      // Counted from the moment it is queued until the caller has its
      // answer (a dropped write stops counting at once).
      let counted = true;
      const uncount = () => {
        if (!counted) return;
        counted = false;
        count(keys, -1);
      };
      const task: Task = {
        keys,
        coalesce: options.coalesce ?? null,
        dropped: false,
        drop: (outcome) => {
          if (task.dropped) return;
          task.dropped = true;
          uncount();
          resolve(outcome);
        },
      };

      // A waiting write of the same kind on the same entries says less than
      // this one: it goes.
      if (task.coalesce) {
        for (const other of waiting) {
          if (other.coalesce === task.coalesce && sameKeys(other.keys, keys)) other.drop({ status: "superseded" });
        }
      }

      // The writes before it on its entries; none — it starts at once (it
      // never waits, so nothing can replace it).
      const before = [...keys].flatMap((key) => {
        const tail = tails.get(key);
        return tail ? [tail] : [];
      });
      let settle!: () => void;
      const mine = new Promise<void>((done) => {
        settle = done;
      });
      for (const key of keys) tails.set(key, mine);
      count(keys, 1);

      const finish = () => {
        waiting.delete(task);
        uncount();
        for (const key of keys) if (tails.get(key) === mine) tails.delete(key);
        settle();
      };

      const start = async () => {
        waiting.delete(task);
        if (task.dropped) {
          finish();
          return;
        }
        let outcome: QueueOutcome<T>;
        try {
          const value = await send();
          outcome = options.failed?.(value) ? { status: "failed", value } : { status: "done", value };
        } catch (error) {
          outcome = { status: "failed", error };
        }
        if (outcome.status === "failed") {
          // The writes made on top of this one never reach the server.
          for (const other of waiting) if (shares(other.keys, keys)) other.drop({ status: "cancelled" });
        }
        task.dropped = true;
        uncount();
        resolve(outcome);
        finish();
      };

      if (before.length === 0) {
        void start();
      } else {
        waiting.add(task);
        void Promise.all(before).then(start);
      }
    });
  }

  return {
    run,
    pending: (key) => counts.get(key) ?? 0,
  };
}
