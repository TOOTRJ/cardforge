import { randomUUID } from "node:crypto";
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
import {
  acquireManualLease,
  leaseBusyMessage,
  MANUAL_PARK_SECONDS,
  releaseSweepLease,
  type ManualLease,
} from "@/lib/cards/sweep-lease";

// ---------------------------------------------------------------------------
// POST /api/admin/rebake — re-bake stored card renders, one batch per call.
// Driven by scripts/rebake-renders.mjs; secured like the cron routes
// (`Authorization: Bearer ${CRON_SECRET}`, or ALLOW_UNAUTHENTICATED_REBAKE
// on a non-production dev server that talks to the same Supabase project).
// The admin compare page drives the same batch through
// /api/admin/rebake-marked with the admin's session instead.
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
//
// One sweeper at a time: a writing call takes the shared sweep lease
// (lib/cards/sweep-lease.ts) that the automatic re-bake cron
// (/api/cron/auto-rebake) and the compare page's route also take. If the
// cron is mid-run, the call asks it to hand over after its current batch
// and waits (the driver just sees a slower answer); if the lease is still
// busy after ~2 minutes it answers 503 + Retry-After with a plain message.
// Between two calls the lease stays PARKED for the manual run, so the cron
// stays out until the driver finishes. Dry runs take no lease.
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

  const admin = createAdminClient();
  if (dry) return planResponse(await runRebakeBatch(admin, { scope, limit, dry, billingEnabled }));

  // One sweeper at a time (lib/cards/sweep-lease.ts): wait for a running
  // automatic re-bake to hand over after its current batch; answer 503 +
  // Retry-After if the lease stays busy.
  const token = randomUUID();
  let lease: ManualLease;
  try {
    lease = await acquireManualLease(admin, token);
  } catch (err) {
    return NextResponse.json(
      { ok: false, billingEnabled, error: err instanceof Error ? err.message : "Sweep lease unavailable." },
      { status: 500 },
    );
  }
  if (!lease.ok) {
    return NextResponse.json(
      { ok: false, busy: true, holder: lease.holder, billingEnabled, error: leaseBusyMessage(lease) },
      { status: 503, headers: { "Retry-After": "60" } },
    );
  }

  let result: Awaited<ReturnType<typeof runRebakeBatch>> | null = null;
  try {
    result = await runRebakeBatch(admin, { scope, limit, dry, billingEnabled });
  } finally {
    // Finished → hand the lease back; otherwise park it so the cron stays
    // out until the driver's next call (or MANUAL_PARK_SECONDS).
    const finished = result?.ok === true && result.remaining === 0;
    await releaseSweepLease(admin, token, finished ? {} : { parkSeconds: MANUAL_PARK_SECONDS });
  }
  if (!result.ok) return NextResponse.json(result, { status: 500 });
  return NextResponse.json(result);
}

/** The dry run's answer: the plan the driver prints (nothing processed). */
function planResponse(result: Awaited<ReturnType<typeof runRebakeBatch>>) {
  if (!result.ok) return NextResponse.json(result, { status: 500 });
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
