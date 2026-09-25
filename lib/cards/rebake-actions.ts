"use server";

import { z } from "zod";
import { getCurrentProfile } from "@/lib/supabase/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { isBillingEnabled } from "@/lib/billing/flags";
import { runRebakeBatch } from "@/lib/cards/rebake-batch";

// ---------------------------------------------------------------------------
// Admin "Re-bake now" for cards a frame-geometry change marked (TODO 0.20).
//
// Saving or resetting a layout override on the compare page stamps the
// template's baked cards with layout_version = null — a platform re-bake is
// owed, never an owner badge (lib/cards/layout-version.ts hasNewerLook).
// The compare page then calls this action in a loop (components/admin/
// rebake-marked-store.ts): one small batch per call so each request stays
// well inside the function timeout, with the ids that failed passed back
// so one unbakeable card can't wedge the loop.
//
// Same batch as POST /api/admin/rebake (scope "marked"), but authorized by
// the admin's session instead of the cron secret, and under the same
// billing gate: a server without NEXT_PUBLIC_BILLING_ENABLED would bake
// every card clean, so it refuses.
// ---------------------------------------------------------------------------

/** Renders per call — ~1–3 s each, so a call stays around 10 s. */
const BATCH = 4;

const inputSchema = z.object({
  skipIds: z.array(z.string().uuid()).max(1000).default([]),
});

export type RebakeMarkedResult =
  | {
      ok: true;
      rebaked: number;
      failed: Array<{ id: string; error: string }>;
      remaining: number;
    }
  | { ok: false; error: string };

export async function rebakeMarkedRendersAction(
  input: { skipIds?: string[] } = {},
): Promise<RebakeMarkedResult> {
  const profile = await getCurrentProfile();
  if (!profile?.is_admin) return { ok: false, error: "Not authorized." };
  if (!isAdminConfigured()) return { ok: false, error: "Admin key is not configured." };

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };

  const billingEnabled = isBillingEnabled();
  if (!billingEnabled && process.env.ALLOW_UNWATERMARKED_SWEEP !== "true") {
    return {
      ok: false,
      error:
        "This server has NEXT_PUBLIC_BILLING_ENABLED off, so re-baked cards would lose the pipglyph.com mark. Re-bake from production or a preview instead.",
    };
  }

  const result = await runRebakeBatch(createAdminClient(), {
    scope: { kind: "marked" },
    limit: BATCH,
    dry: false,
    billingEnabled,
    skipIds: parsed.data.skipIds,
  });
  if (!result.ok) return { ok: false, error: result.error };
  return {
    ok: true,
    rebaked: result.processed.length,
    failed: result.failed,
    remaining: result.remaining,
  };
}
