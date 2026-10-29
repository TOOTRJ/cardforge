import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { checkAiRateLimit, getFreshCreditBalance } from "@/lib/ai/rate-limit";
import { runNextJobStep } from "@/lib/ai/generation-jobs";
import { notifyDeckJobFinished } from "@/lib/ai/job-notify";
import { rateLimitedResponse } from "@/lib/api/responses";
import { DECK_AI_PAUSED_STATUS, deckAiPausedBody, isDeckAiPaused } from "@/lib/ai/deck-ai-pause";
import { isUuid } from "@/lib/ids";

// ---------------------------------------------------------------------------
// POST /api/ai/jobs/[id]/step — execute one step of a generation job (one
// card's creation + art, or the set icon). The client calls this in a loop
// while steps remain; passing { step } retries a specific failed step.
// One image generation per call keeps every invocation well under the
// function timeout regardless of batch size.
//
// While AI deck building is paused (owner 2026-10-28, TODO DK1 — D6,
// lib/ai/deck-ai-pause.ts) a FAILED step of a deck build or deck remix is
// not re-run: its credit was refunded, so a re-run reserves a new one and
// calls the AI — new deck AI. It is refused before the rate limit, the
// claim (claim_job_step accepts a failed step by key) and any charge. The
// pending and running steps of a job still running are untouched: work
// already paid for finishes.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const maxDuration = 180;

const requestSchema = z.object({
  step: z.string().max(40).optional(),
});

/** A retry of a deck job's failed step — what the pause refuses. Read
 *  through the caller's own session (RLS: owners read only their jobs); a
 *  job it can't read is left to runNextJobStep's "Job not found". */
async function isPausedDeckRetry(jobId: string, stepKey: string): Promise<boolean> {
  if (!isUuid(jobId)) return false;
  const supabase = await createClient();
  const { data } = await supabase
    .from("ai_generation_jobs")
    .select("kind, steps")
    .eq("id", jobId)
    .maybeSingle();
  if (!data || (data.kind !== "deck" && data.kind !== "deck_remix")) return false;
  const steps = Array.isArray(data.steps) ? (data.steps as Array<{ key?: unknown; status?: unknown }>) : [];
  return steps.some((step) => step?.key === stepKey && step?.status === "failed");
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Supabase isn't configured." },
      { status: 503 },
    );
  }
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Sign in." }, { status: 401 });
  }

  let stepKey: string | undefined;
  try {
    const body = await request.json();
    const parsed = requestSchema.safeParse(body);
    stepKey = parsed.success ? parsed.data.step : undefined;
  } catch {
    stepKey = undefined;
  }

  const { id } = await params;
  // Only a keyed request can name a failed step (the unkeyed one claims the
  // next pending step), so only it pays for the read.
  if (stepKey && isDeckAiPaused() && (await isPausedDeckRetry(id, stepKey))) {
    return NextResponse.json(deckAiPausedBody(), { status: DECK_AI_PAUSED_STATUS });
  }

  const rate = await checkAiRateLimit(user.id);
  if (!rate.ok) {
    return rateLimitedResponse(rate);
  }

  const result = await runNextJobStep(id, stepKey);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 502 });
  }
  // A finished deck job tells its owner once (bell + realtime toast).
  if (!result.inFlight) await notifyDeckJobFinished(result.job);
  // inFlight: the wanted step is mid-run in ANOTHER request (parallel worker,
  // second tab). Nothing was executed here — the client should poll, not
  // count a failure or re-request blindly.
  // credits: the live post-step balance (spend or refund included), so every
  // mounted credit display can update without refetching /api/me. Null when
  // a live number isn't meaningful (billing off / admin).
  // The plan is server-only (and, for a 100-card deck, most of the bytes of
  // every one of the ~100 step responses) — the client only needs the steps.
  const { plan: _plan, ...job } = result.job;
  void _plan;
  return NextResponse.json(
    {
      ok: true,
      job,
      inFlight: result.inFlight ?? false,
      credits: await getFreshCreditBalance(),
    },
    { status: 200 },
  );
}
