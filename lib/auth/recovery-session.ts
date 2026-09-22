import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Password-reset gate. /reset-password used to accept ANY live session: an
// unattended signed-in browser was enough to set a new password and sign
// the real owner out everywhere. The reset form now requires the session to
// have been established by an EMAIL LINK recently — the JWT's `amr`
// (authentication methods reference) claim carries that fact. GoTrue logs a
// token-hash verification (recovery, signup confirm, email change — the only
// link flows this app offers; there is no magic-link sign-in) as method
// "otp", and the PKCE recovery exchange as "recovery"; both prove mailbox
// possession within the hour, which is exactly what a reset link proves. A
// password/OAuth session never qualifies: that user changes their password
// in Settings, where the current password is required
// (lib/account/security-actions.ts).
// ---------------------------------------------------------------------------

/** Supabase email links expire after an hour; a link verification older than
 *  that can't be "the link you just clicked". */
export const RECOVERY_WINDOW_MS = 60 * 60_000;

/** AMR methods that mean "this session came from an email link". */
const LINK_METHODS = new Set(["recovery", "otp"]);

type AmrEntry = { method?: unknown; timestamp?: unknown };

/**
 * True when `amr` (RFC 8176 `string[]`, or Supabase's detailed
 * `{ method, timestamp }[]` with timestamps in SECONDS) records an email-link
 * verification within RECOVERY_WINDOW_MS. Anything malformed is not one.
 */
export function hasRecentRecovery(amr: unknown, now: number = Date.now()): boolean {
  if (!Array.isArray(amr)) return false;
  return amr.some((entry) => {
    if (typeof entry === "string") return LINK_METHODS.has(entry);
    if (!entry || typeof entry !== "object") return false;
    const { method, timestamp } = entry as AmrEntry;
    if (typeof method !== "string" || !LINK_METHODS.has(method)) return false;
    if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) return false;
    const usedAt = timestamp * 1000;
    return usedAt <= now + 60_000 && now - usedAt <= RECOVERY_WINDOW_MS;
  });
}

/** Whether the current cookie session came from a recent recovery link.
 *  `getClaims()` verifies the token before handing back its claims, so a
 *  tampered cookie can't forge the answer. */
export async function isRecoverySession(
  supabase: Pick<SupabaseClient, "auth">,
  now: number = Date.now(),
): Promise<boolean> {
  try {
    const { data, error } = await supabase.auth.getClaims();
    if (error || !data?.claims) return false;
    return hasRecentRecovery(data.claims.amr, now);
  } catch {
    return false;
  }
}
