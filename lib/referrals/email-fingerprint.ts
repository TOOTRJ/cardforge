import "server-only";

import { createHmac } from "node:crypto";
import { normalizeReferralEmail } from "@/lib/referrals/fraud";

// ---------------------------------------------------------------------------
// One email, one referral month — ever (owner 2026-11-02). What the referral
// program KEEPS of a referred account's email: a keyed hash (HMAC-SHA256) of
// its normalized form (normalizeReferralEmail) under the server-only secret
// REFERRAL_EMAIL_HASH_KEY — never the address, and never an unkeyed hash (a
// plain SHA-256 of an email is reversible by guessing). Stored in 0164's
// referral_email_fingerprints, which no account deletion touches.
//
// No key → null: the caller FAILS CLOSED (nothing is rewarded; the retry
// sweep grants once the key exists). The key is never rotated casually: old
// fingerprints stop matching.
// ---------------------------------------------------------------------------

export const REFERRAL_EMAIL_HASH_KEY_ENV = "REFERRAL_EMAIL_HASH_KEY";

/** Shorter than this is treated as missing — a key must be a long secret. */
export const REFERRAL_EMAIL_HASH_KEY_MIN_LENGTH = 32;

export function referralEmailHashKey(env: NodeJS.ProcessEnv = process.env): string | null {
  const key = env[REFERRAL_EMAIL_HASH_KEY_ENV]?.trim() ?? "";
  return key.length >= REFERRAL_EMAIL_HASH_KEY_MIN_LENGTH ? key : null;
}

/** The fingerprint of an email (64 hex characters), or null when the email
 *  doesn't normalize. */
export function referralEmailFingerprint(email: string | null | undefined, key: string): string | null {
  const normalized = normalizeReferralEmail(email);
  if (!normalized) return null;
  return createHmac("sha256", key).update(normalized, "utf8").digest("hex");
}
