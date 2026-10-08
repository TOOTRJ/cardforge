// ---------------------------------------------------------------------------
// One live notification stream per user per tab, however many subscribers
// are mounted.
//
// The browser's Supabase client is a singleton, and it hands back the channel
// a topic already has. Two RealtimeAlerts for one user are therefore ONE
// channel: the second `.on("postgres_changes")` throws once the first has
// subscribed (before that it binds twice, and every notification is delivered
// twice), and whichever unmounts first takes the channel away from the other.
// That is how a second site header on the 404 page turned every signed-in 404
// into the error boundary (2026-10).
//
// So subscribers queue. The first one mounted runs the stream; the others
// wait and do nothing. When the holder leaves, its stream is stopped and THEN
// the next in line starts — in that order: the old channel has to be gone
// before the topic is asked for again.
// ---------------------------------------------------------------------------

type Claim = {
  /** Opens the stream; returns its teardown. Must not throw. */
  start: () => () => void;
  /** The running stream's teardown — set only while this claim holds it. */
  stop: (() => void) | null;
};

const queues = new Map<string, Claim[]>();

/**
 * Queue for `key`'s stream (the user id). `start` runs now when nobody holds
 * the stream, otherwise once every earlier claimant has released. Returns the
 * release, which is safe to call twice.
 */
export function claimNotificationStream(
  key: string,
  start: () => () => void,
): () => void {
  const claim: Claim = { start, stop: null };
  let queue = queues.get(key);
  if (!queue) {
    queue = [];
    queues.set(key, queue);
  }
  queue.push(claim);
  if (queue[0] === claim) claim.stop = claim.start();

  return () => {
    const waiting = queues.get(key);
    const index = waiting ? waiting.indexOf(claim) : -1;
    if (!waiting || index === -1) return;
    waiting.splice(index, 1);
    if (waiting.length === 0) queues.delete(key);

    claim.stop?.();
    claim.stop = null;
    const next = waiting[0];
    if (index === 0 && next) next.stop = next.start();
  };
}
