import "server-only";

import { getCurrentProfile } from "@/lib/supabase/server";
import { getFrameReviews } from "@/lib/cards/frame-reviews";
import { getFrameProfileOverrides } from "@/lib/cards/frame-profile-overrides";
import { getAutoRebakeOverview } from "@/lib/cards/auto-rebake-queries";
import { getFrameRequestSummary } from "@/lib/frames/frame-request-queries";
import {
  summariseFrameDemand,
  summariseFrameVerification,
  summariseRebake,
  type AdminOpsSummary,
} from "@/lib/admin/ops-summary";

// ---------------------------------------------------------------------------
// The admin dashboard tile's read (TODO 7.4). Null for anyone but an admin —
// checked HERE, before any read: getAutoRebakeOverview() reads
// render_sweep_state with the service role and trusts its caller, and the
// tile must not depend on the page remembering to gate it. Each source
// degrades on its own (an error string, never a throw), so one broken read
// can't take the dashboard down.
// ---------------------------------------------------------------------------

export async function getAdminOpsSummary(): Promise<AdminOpsSummary | null> {
  const profile = await getCurrentProfile();
  if (!profile?.is_admin) return null;

  const [reviews, overrides, rebake, requests] = await Promise.all([
    getFrameReviews(),
    getFrameProfileOverrides(),
    // The owed count is a service-role head count over every published
    // card: reused for up to a minute (REBAKE_OWED_REVALIDATE_SECONDS).
    getAutoRebakeOverview({ poisonDetails: false, cachePending: true }),
    getFrameRequestSummary("30"),
  ]);
  // getFrameRequestSummary re-checks is_admin (same request-cached profile).
  if (!requests) return null;

  return {
    frames: summariseFrameVerification(reviews, overrides),
    rebake: summariseRebake(rebake, rebake.readAt),
    requests: summariseFrameDemand(requests),
    readAt: rebake.readAt,
  };
}
