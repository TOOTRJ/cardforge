// ---------------------------------------------------------------------------
// A paid Collection AI call whose answer never reached the page — asked
// about again (client-safe; the server half is ai-results.ts, migration
// 0198).
//
// "Build with AI" and "Suggest a commander" run up to two minutes. A
// connection that drops in that time (a laptop lid, a phone changing
// network, a proxy's own timeout) loses the response, not the work: the
// route finishes, keeps its answer and settles the credit. So when the
// fetch throws or its body is not ours, the page asks
// GET /api/tools/collection-builder/ai-result what became of the request
// id it sent, every few seconds, and says exactly that:
//
//   done        the answer, as the route would have sent it
//   failed      the call failed after the charge; its credit was refunded
//   refused     the route turned the request down before any charge
//   none        the server has no record of the request. A request is put
//               on record BEFORE anything is charged (and refused if it
//               can't be), so this is "it never reached us: nothing was
//               charged" — believed once the request has had time to arrive
//   unfinished  the server's LATEST word is still "running" when the call
//               can no longer be: the function stopped. Its credit was
//               never settled, and the reconcile sweep returns it (15
//               minutes' grace, a run every 30)
//   unknown     it could not be asked: no request id, signed out, the tool
//               closed, or too many asks that told nothing
//
// Only an ask the server ANSWERED WITH A STATE decides anything. An ask
// that told nothing — offline, a timeout, a 5xx, a page that is not ours —
// is counted (AI_RECOVER_BLIND_ASKS of them in all, then `unknown`) and
// never read as a verdict: a browser that was offline for ten minutes, or
// asleep for an hour, has its answer on the first ask that gets through.
// ---------------------------------------------------------------------------

export type CollectionAiKind = "build" | "suggest";

/** The routes' maxDuration (120 s) and a margin for the keep + settle: a
 *  call the server still calls "running" past this has stopped. */
export const AI_RECOVER_UNTIL_MS = 135_000;
export const AI_RECOVER_EVERY_MS = 5_000;
/** How long a request may take to reach the route and be put on record
 *  (a cold start, a slow uplink). "No record" is believed only after this. */
export const AI_RECOVER_NONE_AFTER_MS = 20_000;
/** One ask may take this long. */
export const AI_RECOVER_ASK_TIMEOUT_MS = 10_000;
/** Asks that told nothing before the asking ends: ten minutes of them while
 *  the page is awake (a sleeping page asks nothing and loses none). */
export const AI_RECOVER_BLIND_ASKS = 120;
/** Refusals in a row (401 / 404) before the asking ends. */
const REFUSALS_BEFORE_GIVING_UP = 3;

export const aiResultHref = (kind: CollectionAiKind, requestId: string) =>
  `/api/tools/collection-builder/ai-result?kind=${kind}&request=${encodeURIComponent(requestId)}`;

/** A request id for a paid call, or null where the browser can't make one
 *  (the call still runs; it just can't be asked about again). */
export function newAiRequestId(): string | null {
  try {
    return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : null;
  } catch {
    return null;
  }
}

export type AiRecoveryOutcome = "failed" | "refused" | "none" | "unfinished" | "unknown";

export type AiRecovery<T> =
  | { state: "done"; result: T; credits: number | null }
  | { state: AiRecoveryOutcome; credits: number | null }
  | { state: "aborted" };

const NAME: Record<CollectionAiKind, string> = { build: "The AI build", suggest: "The suggestions" };
const NAME_MID: Record<CollectionAiKind, string> = { build: "the AI build", suggest: "the suggestions" };

/** What the page says while it asks — and while it can't. */
export const AI_ANSWER_CHECKING = (kind: CollectionAiKind, offline = false) =>
  offline
    ? `You seem to be offline. This page will check whether ${NAME_MID[kind]} finished as soon as the connection is back.`
    : `The connection dropped. Checking whether ${NAME_MID[kind]} finished. This can take up to two minutes.`;

/** What the page says when there is no answer to show — each true of the
 *  state it is said for (the reasons are in the header). */
export function aiRecoveryMessage(kind: CollectionAiKind, state: AiRecoveryOutcome): string {
  switch (state) {
    case "failed":
      return `${NAME[kind]} failed. The credit it took was returned, or comes back by itself within the hour.`;
    case "refused":
      return `${NAME[kind]} was turned down before anything was made, and nothing was charged. Try again.`;
    case "none":
      return "We have no record of that request, so nothing was made and nothing was charged for it. Check your connection and try again.";
    case "unfinished":
      return `${NAME[kind]} didn't finish. The credit it took comes back by itself within the hour.`;
    case "unknown":
      return `We couldn't check whether ${NAME_MID[kind]} finished. If a credit was taken and nothing was made, it comes back by itself within the hour.`;
  }
}

/**
 * Ask what became of the request until there is an answer. Never throws.
 * `signal` (the page going away) ends it with `aborted`. `onReach` says, as
 * it changes, whether the server can be reached (the page's own words for
 * "offline").
 */
export async function recoverAiAnswer<T>(
  kind: CollectionAiKind,
  requestId: string | null,
  startedAt: number,
  options: {
    fetchImpl?: typeof fetch;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
    signal?: AbortSignal;
    onReach?: (reached: boolean) => void;
  } = {},
): Promise<AiRecovery<T>> {
  if (!requestId) return { state: "unknown", credits: null };
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? Date.now;
  const { signal } = options;
  let sawRunning = false;
  let refusals = 0;
  let blind = 0;
  let credits: number | null = null;
  let reached: boolean | null = null;
  const reach = (value: boolean) => {
    if (reached !== value) options.onReach?.(value);
    reached = value;
  };
  for (;;) {
    if (signal?.aborted) return { state: "aborted" };
    /** What the server said about the request in this ask, if it said. */
    let said: "running" | "none" | null = null;
    const ask = new AbortController();
    const onAbort = () => ask.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => ask.abort(), AI_RECOVER_ASK_TIMEOUT_MS);
    try {
      const response = await fetchImpl(aiResultHref(kind, requestId), { cache: "no-store", signal: ask.signal });
      reach(true);
      // A request we can't name: no later ask will differ.
      if (response.status === 400) return { state: "unknown", credits };
      if (response.status === 401 || response.status === 404) {
        // Signed out, or the tool is closed to this account. Believed only
        // when it repeats: one failed read looks the same.
        refusals += 1;
        if (refusals >= REFUSALS_BEFORE_GIVING_UP) return { state: "unknown", credits };
      } else {
        refusals = 0;
        if (response.ok) {
          const body = (await response.json()) as { ok?: boolean; state?: string; result?: T; credits?: number | null };
          if (typeof body.credits === "number") credits = body.credits;
          if (body.ok && body.state === "done" && body.result) return { state: "done", result: body.result, credits };
          if (body.ok && (body.state === "failed" || body.state === "refused")) return { state: body.state, credits };
          if (body.ok && (body.state === "running" || body.state === "none")) said = body.state;
        }
      }
    } catch {
      // Offline, a timeout, or an answer that isn't JSON.
      if (!signal?.aborted) reach(false);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
    if (signal?.aborted) return { state: "aborted" };
    const waited = now() - startedAt;
    if (said === "running") {
      sawRunning = true;
      // The server's word NOW, past the time the call can run: it stopped.
      if (waited + AI_RECOVER_EVERY_MS > AI_RECOVER_UNTIL_MS) return { state: "unfinished", credits };
    } else if (said === "none") {
      // No record. After a "running" the row is gone (trimmed): say nothing
      // about the charge. Otherwise believed once the request has had time
      // to reach the route.
      if (sawRunning) return { state: "unknown", credits };
      if (waited >= AI_RECOVER_NONE_AFTER_MS) return { state: "none", credits };
    } else {
      // This ask told nothing: never a verdict, only counted.
      blind += 1;
      if (blind >= AI_RECOVER_BLIND_ASKS) return { state: "unknown", credits };
    }
    await sleep(AI_RECOVER_EVERY_MS);
  }
}
