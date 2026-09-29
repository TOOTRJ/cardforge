import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentProfile } from "@/lib/supabase/server";
import { isAdminConfigured } from "@/lib/supabase/admin";
import { FRAME_COLOR_KEYS } from "@/lib/cards/frame-reference-registry";
import { getFrameReviews } from "@/lib/cards/frame-reviews";
import { getFrameProfileOverrides } from "@/lib/cards/frame-profile-overrides";
import {
  SCORE_BATCH_BUDGET_MS,
  SCORE_BATCH_CONCURRENCY,
  SCORE_BATCH_MAX_COMBOS,
  encodeScoreBatchEvent,
  planScoreBatch,
  runScoreBatch,
  type ScoreBatchEvent,
} from "@/lib/frames/score-batch";
import { scoreAndRecordCombo } from "@/lib/frames/score-record";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";

// ---------------------------------------------------------------------------
// POST /api/admin/frame-score-batch  { combos: [{ template, colorKey }, …] }
//
// Verification throughput (TODO 4.12): the sign-off view's "Score all
// colours" (one template) and "Score the treatment" (every template of a
// frame set) in ONE job. The response is an NDJSON stream —
// lib/frames/score-batch.ts has the event types — so the view shows each
// combo as it is scored:
//
//   start   → the combos it will score + the ones it skips (no printing)
//   scoring → a combo started
//   result  → its frame score, per-slot scores + suggested nudges, and
//             whether the "score" event was recorded
//   done    → totals, and `remaining` when the time budget (or a cancel)
//             stopped it early — the client sends those in the next request
//
// Every score is recorded exactly like the per-colour Score button
// (lib/frames/score-record.ts → a "score" event). The job NEVER ticks a
// colour or writes frame_reviews: publishing stays the owner's click.
//
// A route rather than a server action, like /api/admin/rebake-marked: Next
// runs a client's server actions one at a time, so a minutes-long job would
// stall the page's own Score, tick and Publish behind it. Auth: the admin's
// session (404 otherwise, like the other admin routes) plus a same-origin
// check (the session cookie is SameSite=Lax). Everything cookie-bound —
// the profile, the reviews that pick each combo's reference — is read
// BEFORE the stream starts; inside it only the service-role recorder and
// the cookie-free override cache run. The Scryfall lookups are admin
// tooling and aren't logged to the per-user scryfall_calls quotas.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const bodySchema = z.object({
  combos: z
    .array(
      z.object({
        template: z.enum(FRAME_TEMPLATE_VALUES),
        colorKey: z.enum(FRAME_COLOR_KEYS),
      }),
    )
    .min(1)
    .max(SCORE_BATCH_MAX_COMBOS),
});

function jsonError(error: string, status: number) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) {
    return jsonError("Cross-origin request refused.", 403);
  }
  const profile = await getCurrentProfile();
  if (!profile?.is_admin) return jsonError("Not authorized.", 404);
  if (!isAdminConfigured()) return jsonError("Admin key is not configured.", 503);

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Invalid request.", 400);

  // One review read plans every combo's reference; one override read is
  // what every render uses AND what every recorded hash describes.
  const [reviews, overrides] = await Promise.all([getFrameReviews(), getFrameProfileOverrides()]);
  const plan = planScoreBatch(parsed.data.combos, reviews);
  const actorId = profile.id;

  const encoder = new TextEncoder();
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: ScoreBatchEvent) => {
        if (cancelled) return;
        try {
          controller.enqueue(encoder.encode(encodeScoreBatchEvent(event)));
        } catch {
          // The client went away; the run stops starting combos below.
          cancelled = true;
        }
      };
      send({
        type: "start",
        combos: plan.toScore.map(({ template, colorKey }) => ({ template, colorKey })),
        skipped: plan.skipped,
      });
      try {
        const outcome = await runScoreBatch({
          combos: plan.toScore,
          scoreOne: (combo) =>
            scoreAndRecordCombo({
              template: combo.template,
              colorKey: combo.colorKey,
              actorId,
              referenceId: combo.referenceId,
              overrides,
            }),
          send,
          budgetMs: SCORE_BATCH_BUDGET_MS,
          concurrency: SCORE_BATCH_CONCURRENCY,
          isCancelled: () => cancelled || request.signal.aborted,
        });
        send({ type: "done", ...outcome });
      } catch (err) {
        send({ type: "error", error: err instanceof Error ? err.message : "The scoring job failed." });
      } finally {
        try {
          controller.close();
        } catch {
          // Already closed by a cancel.
        }
      }
    },
    cancel() {
      cancelled = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
