import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentProfile } from "@/lib/supabase/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { isBillingEnabled } from "@/lib/billing/flags";
import { runRebakeBatch } from "@/lib/cards/rebake-batch";
import {
  acquireManualLease,
  leaseBusyMessage,
  MANUAL_PARK_SECONDS,
  releaseSweepLease,
} from "@/lib/cards/sweep-lease";

// ---------------------------------------------------------------------------
// POST /api/admin/rebake-marked  { skipIds?, rebakedSoFar? }
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
//
// One sweeper at a time: each call takes the shared sweep lease
// (lib/cards/sweep-lease.ts, like POST /api/admin/rebake), waiting for a
// running automatic re-bake to hand over after its batch, and parks it
// between calls so the cron stays out of the loop. A lease still busy after
// ~2 minutes answers 503 with a message the panel shows ("Try again").
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Renders per call — ~1–3 s each, so a call stays around 10 s. */
const BATCH = 4;

const bodySchema = z.object({
  skipIds: z.array(z.string().uuid()).max(2000).default([]),
  /** Cards the loop's EARLIER calls re-baked — the route is stateless, and
   *  the run's last call may re-bake nothing itself (all failed, all
   *  superseded) after earlier ones did. */
  rebakedSoFar: z.number().int().min(0).max(1_000_000).default(0),
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

function json(body: RebakeMarkedResponse, status = 200, headers?: HeadersInit) {
  return NextResponse.json(body, { status, headers });
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

  const admin = createAdminClient();
  const token = randomUUID();
  let lease: Awaited<ReturnType<typeof acquireManualLease>>;
  try {
    lease = await acquireManualLease(admin, token);
  } catch (err) {
    console.error("[rebake-marked] sweep lease failed:", err);
    return json({ ok: false, error: err instanceof Error ? err.message : "Sweep lease unavailable." }, 500);
  }
  // Busy → 503 + Retry-After, as /api/admin/rebake answers (never a 409).
  if (!lease.ok) return json({ ok: false, error: leaseBusyMessage(lease) }, 503, { "Retry-After": "60" });

  let result: Awaited<ReturnType<typeof runRebakeBatch>> | null = null;
  try {
    result = await runRebakeBatch(admin, {
      scope: { kind: "marked" },
      limit: BATCH,
      dry: false,
      billingEnabled,
      skipIds: parsed.data.skipIds,
    });
  } finally {
    const finished = result?.ok === true && result.remaining === 0;
    await releaseSweepLease(admin, token, finished ? {} : { parkSeconds: MANUAL_PARK_SECONDS });
  }
  if (!result.ok) {
    console.error("[rebake-marked] batch failed:", result.error);
    return json({ ok: false, error: result.error }, 500);
  }
  // Gallery landings, hubs and card pages are ISR and point at the old
  // ?v= render URLs (cached immutably by /render-cdn). Refresh them once,
  // when the run finishes — the loop's last call, the one that reports
  // nothing remaining or makes no progress — if ANY call of the run
  // re-baked a card, not after every batch.
  const runRebaked = parsed.data.rebakedSoFar + result.processed.length;
  const runEnds =
    result.remaining === 0 ||
    (result.processed.length === 0 && result.failed.length === 0 && result.superseded.length === 0);
  if (runEnds && runRebaked > 0) revalidatePath("/", "layout");
  return json({
    ok: true,
    rebaked: result.processed.length,
    failed: result.failed,
    superseded: result.superseded.length,
    remaining: result.remaining,
  });
}
