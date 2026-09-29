// ---------------------------------------------------------------------------
// rebake-request.mjs — one POST to /api/admin/rebake, retried when the
// network (not the server's answer) is at fault. Used by rebake-renders.mjs.
//
// A long sweep from a laptop sees the odd dropped connection: the v32 sweep
// (2026-09-28) died twice on `read ETIMEDOUT` with every batch before it
// green, and a human had to restart it. Every call is safe to repeat — the
// route re-plans from what is still pending — so a network failure is
// retried instead of ending the run.
//
// What is retried:
//   - a request that failed in flight (fetch threw: ETIMEDOUT, ECONNRESET,
//     our own timeout …) or whose 200 body was lost;
//   - a server answer that says "try again" (408, 425, 429, 500, 502, 503,
//     504).
// Anything else (401 wrong secret, 400 bad scope, a 200 with ok:false) stops
// at once: repeating it would only repeat the error.
//
// A request that failed IN FLIGHT may still be running on the server (a
// dropped connection doesn't stop a Vercel function), so the retry waits
// until that invocation must have ended — `serverMaxMs` (the route's
// maxDuration) after it started — and can never bake the same cards
// alongside it. An answered failure just backs off.
// ---------------------------------------------------------------------------

export const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

/** The route's `maxDuration` (app/api/admin/rebake/route.ts). */
export const REBAKE_SERVER_MAX_MS = 300_000;

export class RebakeRequestError extends Error {}

function describeFailure(err) {
  const cause = err?.cause;
  const code = cause?.code ?? err?.code;
  if (err?.name === "TimeoutError" || err?.name === "AbortError") return "request timed out";
  return code ? `network error (${code})` : `network error (${err?.message ?? String(err)})`;
}

/**
 * POST `url` and return the parsed `{ ok: true, … }` body, retrying as
 * described above. Throws RebakeRequestError when it gives up.
 */
export async function postWithRetry(
  url,
  {
    headers = {},
    retries = 5,
    serverMaxMs = REBAKE_SERVER_MAX_MS,
    timeoutMs = REBAKE_SERVER_MAX_MS + 20_000,
    backoffMs = [15_000, 30_000, 60_000],
    fetchImpl = fetch,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now = Date.now,
    log = (line) => console.error(line),
  } = {},
) {
  for (let attempt = 0; ; attempt += 1) {
    const started = now();
    let res = null;
    let body = null;
    let failure = null;
    let inFlight = false;
    try {
      res = await fetchImpl(url, { method: "POST", headers, signal: AbortSignal.timeout(timeoutMs) });
      body = await res.json().catch(() => null);
    } catch (err) {
      failure = describeFailure(err);
      inFlight = true;
    }
    if (!failure) {
      if (res.ok && body?.ok) return body;
      if (res.ok && body === null) {
        failure = "response body lost";
        inFlight = true;
      } else if (RETRYABLE_STATUS.has(res.status)) {
        failure = `HTTP ${res.status}${body?.error ? `: ${body.error}` : ""}`;
      } else {
        throw new RebakeRequestError(`HTTP ${res.status}: ${body?.error ?? "no body"}`);
      }
    }
    if (attempt >= retries) {
      throw new RebakeRequestError(`${failure} — gave up after ${retries} ${retries === 1 ? "retry" : "retries"}`);
    }
    const backoff = backoffMs[Math.min(attempt, backoffMs.length - 1)];
    const wait = inFlight ? Math.max(backoff, serverMaxMs + 10_000 - (now() - started)) : backoff;
    log(`⚠ ${failure} — retrying in ${Math.round(wait / 1000)} s (${attempt + 1}/${retries})`);
    await sleep(wait);
  }
}
