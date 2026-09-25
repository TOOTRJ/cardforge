import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentProfile } from "@/lib/supabase/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { isBillingEnabled } from "@/lib/billing/flags";
import { runRebakeBatch } from "@/lib/cards/rebake-batch";

// ---------------------------------------------------------------------------
// POST /api/admin/rebake-marked  { skipIds? }
//
// The compare page's "Re-bake now" (TODO 0.20): one small batch of the
// "marked" scope per call — baked cards a frame-layout save stamped with
// layout_version = null — driven in a loop by components/admin/
// rebake-marked-store.ts. A route handler rather than a server action on
// purpose: Next runs a client's server actions one at a time, so a
// minutes-long loop of actions would stall the compare page's own Save,
// Reset and verify checkbox behind every batch.
//
// Auth: the admin's session (is_admin, answered 404 otherwise like the
// other admin routes) plus a same-origin check — the session cookie is
// SameSite=Lax, and the Origin header must be ours. Same billing gate as
// the cron route: a server without NEXT_PUBLIC_BILLING_ENABLED would bake
// every card clean, so it refuses.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Renders per call — ~1–3 s each, so a call stays around 10 s. */
const BATCH = 4;

const bodySchema = z.object({
  skipIds: z.array(z.string().uuid()).max(2000).default([]),
});

export type RebakeMarkedResponse =
  | {
      ok: true;
      rebaked: number;
      failed: Array<{ id: string; error: string }>;
      superseded: number;
      remaining: number;
    }
  | { ok: false; error: string };

function json(body: RebakeMarkedResponse, status = 200) {
  return NextResponse.json(body, { status });
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) {
    return json({ ok: false, error: "Cross-origin request refused." }, 403);
  }
  const profile = await getCurrentProfile();
  if (!profile?.is_admin) return json({ ok: false, error: "Not authorized." }, 404);
  if (!isAdminConfigured()) return json({ ok: false, error: "Admin key is not configured." }, 503);

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return json({ ok: false, error: "Invalid request." }, 400);

  const billingEnabled = isBillingEnabled();
  if (!billingEnabled && process.env.ALLOW_UNWATERMARKED_SWEEP !== "true") {
    return json(
      {
        ok: false,
        error:
          "This server has NEXT_PUBLIC_BILLING_ENABLED off, so re-baked cards would lose the pipglyph.com mark. Re-bake from production or a preview instead.",
      },
      412,
    );
  }

  const result = await runRebakeBatch(createAdminClient(), {
    scope: { kind: "marked" },
    limit: BATCH,
    dry: false,
    billingEnabled,
    skipIds: parsed.data.skipIds,
  });
  if (!result.ok) return json({ ok: false, error: result.error }, 500);
  return json({
    ok: true,
    rebaked: result.processed.length,
    failed: result.failed,
    superseded: result.superseded.length,
    remaining: result.remaining,
  });
}
