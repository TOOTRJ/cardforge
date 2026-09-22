import "server-only";

import { getSiteBaseUrl } from "@/lib/site-url";

// ---------------------------------------------------------------------------
// IndexNow — push new/changed/removed public URLs to Bing (and every engine
// on the protocol) the moment they change, instead of waiting for a crawl.
// Bing's index is what ChatGPT search, Copilot and several other answer
// engines read from, so this is the shortest path from "card published" to
// "card citable". Google ignores IndexNow; the sitemap still covers it.
//
// Setup (owner): generate any 8–128 char [a-zA-Z0-9-] key, set INDEXNOW_KEY
// in Vercel's Production env, deploy, then confirm /indexnow-key.txt serves
// it. Bing Webmaster Tools shows submissions under "IndexNow". Leave the key
// unset locally and on previews — those hosts can't serve the key file.
//
// Best-effort by design: a failed submission is logged and never surfaces
// to the request that published the page.
// ---------------------------------------------------------------------------

export const INDEXNOW_ENDPOINT = "https://api.indexnow.org/IndexNow";
export const INDEXNOW_KEY_PATH = "/indexnow-key.txt";
/** Protocol cap per submission. */
export const INDEXNOW_MAX_URLS = 10_000;

const KEY_SHAPE = /^[a-zA-Z0-9-]{8,128}$/;

/** The configured key, or null when IndexNow is off for this deployment
 *  (no key, a malformed key, or a Vercel preview whose host can't verify). */
export function indexNowKey(): string | null {
  const key = process.env.INDEXNOW_KEY?.trim();
  if (!key || !KEY_SHAPE.test(key)) return null;
  const vercelEnv = process.env.VERCEL_ENV;
  if (vercelEnv && vercelEnv !== "production") return null;
  return key;
}

/**
 * Submit site-relative paths ("/card/alice/dragon"). Duplicates collapse,
 * non-path strings are dropped. Resolves true only when the endpoint
 * accepted the batch.
 */
export async function notifyIndexNow(paths: readonly string[]): Promise<boolean> {
  const key = indexNowKey();
  if (!key) return false;
  const unique = [...new Set(paths.filter((p) => p.startsWith("/")))].slice(
    0,
    INDEXNOW_MAX_URLS,
  );
  if (unique.length === 0) return false;
  const base = getSiteBaseUrl();
  try {
    const response = await fetch(INDEXNOW_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        host: new URL(base).host,
        key,
        keyLocation: `${base}${INDEXNOW_KEY_PATH}`,
        urlList: unique.map((p) => `${base}${p}`),
      }),
    });
    // 200 = accepted, 202 = accepted pending key validation.
    if (response.status !== 200 && response.status !== 202) {
      console.error(`[indexnow] HTTP ${response.status} for ${unique.length} url(s)`);
      return false;
    }
    return true;
  } catch (error) {
    console.error("[indexnow] submission threw:", error);
    return false;
  }
}
