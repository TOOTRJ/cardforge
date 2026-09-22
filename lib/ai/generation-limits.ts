import "server-only";

import { getCurrentProfile } from "@/lib/supabase/server";
import { isBillingEnabled } from "@/lib/billing/flags";

// ---------------------------------------------------------------------------
// Batch-generation card caps.
//
// With billing LIVE, credits are the only limiter (owner decision,
// 2026-07-28): a batch can be as large as the steppable ceiling, and the
// jobs route's balance pre-check (+ the per-step fail-closed reserve) bounds
// what actually runs. The old 3-card cap survives ONLY where billing is
// disabled (previews, local) — there credits aren't charged, so the small
// cap is what protects AI spend. Admins are always uncapped.
// ---------------------------------------------------------------------------

export const BATCH_CARD_LIMIT = 3;

/** Absolute ceiling for everyone: a full 100-card Commander deck in one
 *  job. Still steppable in one sitting — the client runs three art steps at
 *  a time (~11 s each), so 100 steps land in roughly six minutes — and the
 *  plan call designs the cards in parallel chunks (lib/ai/card-design.ts)
 *  so one model call never has to emit 100 cards. */
const BATCH_CARD_HARD_MAX = 100;

/** The caller's per-generation card cap: the steppable ceiling when credits
 *  meter usage (billing on) or for admins; 3 on billing-off deployments. */
export async function batchCardLimit(): Promise<number> {
  if (isBillingEnabled()) return BATCH_CARD_HARD_MAX;
  const profile = await getCurrentProfile();
  return profile?.is_admin ? BATCH_CARD_HARD_MAX : BATCH_CARD_LIMIT;
}

export function clampBatchSize(requested: number, limit: number): number {
  if (!Number.isFinite(requested)) return Math.min(limit, BATCH_CARD_LIMIT);
  return Math.max(1, Math.min(limit, Math.round(requested)));
}
