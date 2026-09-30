// ---------------------------------------------------------------------------
// rebake-secret.mjs — which CRON_SECRET scripts/rebake-renders.mjs sends to
// REBAKE_URL (POST /api/admin/rebake takes `Authorization: Bearer <secret>`).
//
// Against PRODUCTION (scripts/lib/prod-guard.mjs: www.pipglyph.com or the
// apex) with no CRON_SECRET in the environment, the secret is read at a
// hidden prompt (scripts/lib/hidden-prompt.mjs — nothing typed or pasted is
// echoed), like sweep-storage-orphans.mjs does: it never has to sit in the
// shell, its history, or any other program's environment. No terminal (a
// pipe, CI) → refused, nothing sent. Production over plain http is refused
// whatever the secret's source. Any other URL (a local dev server, a
// preview) keeps the old rule: CRON_SECRET from the environment, or none.
// The secret itself is never printed.
// ---------------------------------------------------------------------------
import { promptHidden } from "./hidden-prompt.mjs";
import { PRODUCTION_APP_URL, isProductionAppUrl } from "./prod-guard.mjs";

export class RebakeSecretError extends Error {}

/** The prompt's question (no secret in it). */
export const PRODUCTION_SECRET_QUESTION = `Production CRON_SECRET for ${PRODUCTION_APP_URL} (Vercel → Settings → Environment Variables; not echoed): `;

/**
 * Resolve the secret for `url`. Throws RebakeSecretError when production
 * can't be asked safely.
 *
 * @param {string} url  REBAKE_URL
 * @param {{
 *   envSecret?: string,
 *   isTTY?: boolean,
 *   prompt?: (question: string) => Promise<string>,
 * }} [options]  the environment's CRON_SECRET, whether stdin is a terminal,
 *   and the hidden prompt (tests pass fakes)
 * @returns {Promise<{ secret: string, production: boolean, prompted: boolean }>}
 */
export async function resolveRebakeSecret(
  url,
  { envSecret = "", isTTY = Boolean(process.stdin.isTTY), prompt = promptHidden } = {},
) {
  const production = isProductionAppUrl(url);
  if (production && new URL(url.trim()).protocol !== "https:") {
    throw new RebakeSecretError(`REBAKE_URL is production over ${new URL(url.trim()).protocol.replace(":", "")} — use https:// (the secret never goes out in the clear).`);
  }
  if (envSecret) return { secret: envSecret, production, prompted: false };
  if (!production) return { secret: "", production, prompted: false };
  if (!isTTY) {
    throw new RebakeSecretError(
      "Run this in a terminal: production's CRON_SECRET is read at a hidden prompt (REBAKE_URL is production and CRON_SECRET is not set). Nothing was sent.",
    );
  }
  const secret = (await prompt(PRODUCTION_SECRET_QUESTION)).trim();
  if (!secret) throw new RebakeSecretError("No CRON_SECRET entered — nothing was sent.");
  return { secret, production, prompted: true };
}
