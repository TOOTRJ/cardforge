import "server-only";

import { getCurrentProfile } from "@/lib/supabase/server";

// ---------------------------------------------------------------------------
// Batch-generation card caps.
//
// Until paid subscriptions launch, every non-admin is capped at 3 cards per
// set generation and 3 per deck generation (owner decision, 2026-07-09).
// Admins (profiles.is_admin — the hardened boolean, see 0029) are exempt.
//
// This is deliberately SEPARATE from billing entitlements: billing is off by
// default, which makes every user read as Pro/unlimited there — tier checks
// can't express "everyone but the admin". When subscriptions go live, the
// paid tiers will raise this cap.
// ---------------------------------------------------------------------------

export const BATCH_CARD_LIMIT = 3;

/** Absolute ceiling even for admins — one job must stay steppable in a
 *  reasonable session (60 art steps ≈ an hour of stepping). */
export const BATCH_CARD_HARD_MAX = 60;

/** The caller's per-generation card cap: 3, or the hard max for admins. */
export async function batchCardLimit(): Promise<number> {
  const profile = await getCurrentProfile();
  return profile?.is_admin ? BATCH_CARD_HARD_MAX : BATCH_CARD_LIMIT;
}

export function clampBatchSize(requested: number, limit: number): number {
  if (!Number.isFinite(requested)) return Math.min(limit, BATCH_CARD_LIMIT);
  return Math.max(1, Math.min(limit, Math.round(requested)));
}
