// ---------------------------------------------------------------------------
// app-endpoint.mjs — how scripts/sweep-storage-orphans.mjs reaches the APP
// (TODO 3.14b follow-up, owner answers 2026-09-29): POST
// /api/admin/storage-sweep (app/api/admin/storage-sweep/route.ts), for what a
// script can't do itself —
//   * act on the rows that use a flagged file through the app's own code
//     paths (the moderation hide, the built-in avatar/banner, the deck cover,
//     the pip remove): `flaggedFile(file, actions)`;
//   * purge Vercel's CDN copies of a card's images (tag card-<id>): only a
//     function running on Vercel can: `purgeCards(cardIds)`.
//
// Secured like the re-bake driver: `Authorization: Bearer <CRON_SECRET>`.
// Production's secret is read at a hidden prompt and only ever sent to
// https://www.pipglyph.com (the script refuses --app-url there); the dev
// target reads CRON_SECRET from its env file and needs --app-url (a local
// `npm run dev` on the dev database). Redirects are refused, not followed: a
// cross-origin redirect drops the Authorization header (and a same-origin one
// would still be a surprise).
//
// EVERY answer names the database the app talks to (`supabaseHost`); the
// call fails unless it is the script's --target (production's two hosts
// count as one), so no action ever goes through an app on another database.
// The secret is never printed, and neither is anything the app answers
// beyond its status, error text and results.
// ---------------------------------------------------------------------------
import { PRODUCTION_SUPABASE_HOSTS } from "./prod-guard.mjs";

export const PRODUCTION_APP_URL = "https://www.pipglyph.com";
export const ENDPOINT_PATH = "/api/admin/storage-sweep";

/** Card ids per purge call (the route's own cap). */
export const PURGE_CHUNK = 100;
/** Row actions per flagged-file call (the route's own cap). */
export const ACTION_CHUNK = 50;
/** The route may re-bake and purge; its maxDuration is 300 s. */
export const CALL_TIMEOUT_MS = 290_000;

export class AppEndpointError extends Error {}

/** True when the app's database host and the script's target are the same
 *  project (production answers on two hosts). */
export function sameSupabaseProject(appHost, targetHost) {
  if (typeof appHost !== "string" || typeof targetHost !== "string" || !appHost || !targetHost) return false;
  const a = appHost.toLowerCase();
  const b = targetHost.toLowerCase();
  if (a === b) return true;
  return PRODUCTION_SUPABASE_HOSTS.includes(a) && PRODUCTION_SUPABASE_HOSTS.includes(b);
}

/** A base URL the script may send the secret to: https, or http on a
 *  loopback host (a local dev server). No path, no credentials. */
export function appUrlProblem(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return "not a URL";
  }
  if (url.username || url.password) return "no credentials in the URL";
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) return "https only (http is allowed for localhost)";
  if (url.pathname !== "/" || url.search || url.hash) return "the site's origin only (no path or query)";
  return null;
}

/**
 * `{ url, whoami(), purgeCards(ids), flaggedFile(file, actions) }` for the
 * app at `baseUrl`. Each call throws AppEndpointError on no answer, a
 * refused secret, a non-ok answer, or an app on another database.
 */
export function createAppEndpoint({ baseUrl, secret, targetHost, fetch = globalThis.fetch, timeoutMs = CALL_TIMEOUT_MS }) {
  const problem = appUrlProblem(baseUrl);
  if (problem) throw new AppEndpointError(`app URL ${baseUrl}: ${problem}`);
  if (!secret) throw new AppEndpointError("no CRON_SECRET — the app's admin endpoint needs it");
  const url = new URL(ENDPOINT_PATH, baseUrl).toString();

  async function call(body) {
    let res;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
        body: JSON.stringify(body),
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const why = err?.name === "TimeoutError" ? "timed out" : "no answer, or it redirected (pass the final URL)";
      throw new AppEndpointError(`${url}: ${why}`);
    }
    let json = null;
    try {
      json = await res.json();
    } catch {
      // not JSON — reported below by status
    }
    if (res.status === 401) throw new AppEndpointError(`${url} refused the CRON_SECRET (HTTP 401)`);
    if (!res.ok || json?.ok !== true) {
      const error = typeof json?.error === "string" ? ` — ${json.error.slice(0, 300)}` : "";
      throw new AppEndpointError(`${url}: HTTP ${res.status}${error}`);
    }
    if (!sameSupabaseProject(json.supabaseHost, targetHost)) {
      throw new AppEndpointError(
        `${url} talks to ${json.supabaseHost ? `database ${json.supabaseHost}` : "an unknown database"}, not ${targetHost} — nothing is done through it`,
      );
    }
    return json;
  }

  return {
    url,
    /** → `{ supabaseHost, vercel }` */
    whoami: () => call({ op: "whoami" }),
    /** Purge the caches of these cards (chunked). → `{ purged, vercel }` */
    async purgeCards(cardIds) {
      const ids = [...new Set(cardIds)];
      let vercel = false;
      for (let i = 0; i < ids.length; i += PURGE_CHUNK) {
        const answer = await call({ op: "purge-cards", cardIds: ids.slice(i, i + PURGE_CHUNK) });
        vercel = Boolean(answer.vercel);
      }
      return { purged: ids.length, vercel };
    },
    /** Act on the rows that use a flagged file (chunked). → results, in order. */
    async flaggedFile(file, actions) {
      const results = [];
      for (let i = 0; i < actions.length; i += ACTION_CHUNK) {
        const answer = await call({ op: "flagged-file", file, actions: actions.slice(i, i + ACTION_CHUNK) });
        if (!Array.isArray(answer.results)) throw new AppEndpointError(`${url}: no results in the answer`);
        results.push(...answer.results);
      }
      return results;
    },
  };
}
