import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isBillingEnabled } from "@/lib/billing/flags";
import { cronRouteGuard, isCronAuthorized } from "@/lib/api/cron-auth";
import {
  DEFAULT_BATCH,
  MAX_BATCH,
  parseRebakeScope,
  runRebakeBatch,
} from "@/lib/cards/rebake-batch";

// ---------------------------------------------------------------------------
// POST /api/admin/rebake — re-bake stored card renders, one batch per call.
// Driven by scripts/rebake-renders.mjs; secured like the cron routes
// (`Authorization: Bearer ${CRON_SECRET}`, or ALLOW_UNAUTHENTICATED_REBAKE
// on a non-production dev server that talks to the same Supabase project).
// The admin compare page drives the same batch through a server action
// (lib/cards/rebake-actions.ts) with the admin's session instead.
//
// ?scope=version&version=N | sweep | marked | legacy-art&before=<iso> — see
// lib/cards/rebake-batch.ts. ?dry=1 plans without writing: bucket counts
// {rebake, stamp, optIn} for the scope. The driver always runs this first
// and prints the plan.
//
// Environment gate: a bake carries the pipglyph.com mark only when
// isBillingEnabled() — a sweep server without NEXT_PUBLIC_BILLING_ENABLED
// bakes every card CLEAN (layout v21, and again on 2026-09-16). The route
// refuses to write unless the flag is on, or ALLOW_UNWATERMARKED_SWEEP=true
// is set deliberately. The response always reports `billingEnabled`.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** A local dev server may skip the bearer — never in production. */
function devBypass(): boolean {
  return (
    process.env.ALLOW_UNAUTHENTICATED_REBAKE === "true" &&
    process.env.NODE_ENV !== "production"
  );
}

export async function POST(request: Request) {
  const denied = cronRouteGuard(request, {
    authorized: devBypass() || isCronAuthorized(request),
  });
  if (denied) return denied;

  const url = new URL(request.url);
  const scope = parseRebakeScope(url.searchParams);
  if ("error" in scope) return NextResponse.json({ ok: false, error: scope.error }, { status: 400 });
  const dry = url.searchParams.get("dry") === "1";
  const limit = Math.min(MAX_BATCH, Math.max(1, Number(url.searchParams.get("limit")) || DEFAULT_BATCH));
  const billingEnabled = isBillingEnabled();

  if (!dry && !billingEnabled && process.env.ALLOW_UNWATERMARKED_SWEEP !== "true") {
    return NextResponse.json(
      {
        ok: false,
        billingEnabled,
        error:
          "Refusing to bake: NEXT_PUBLIC_BILLING_ENABLED is not \"true\" on this server, so every render would be unwatermarked. Set the flag as production has it (or ALLOW_UNWATERMARKED_SWEEP=true if that is really intended).",
      },
      { status: 412 },
    );
  }

  const result = await runRebakeBatch(createAdminClient(), { scope, limit, dry, billingEnabled });
  if (!result.ok) return NextResponse.json(result, { status: 500 });
  if (result.dry) {
    // The driver prints the plan; a dry run has nothing processed or failed.
    return NextResponse.json({
      ok: true,
      dry: true,
      scope: result.scope,
      layoutVersion: result.layoutVersion,
      billingEnabled: result.billingEnabled,
      plan: result.plan,
      remaining: result.remaining,
    });
  }
  return NextResponse.json(result);
}
