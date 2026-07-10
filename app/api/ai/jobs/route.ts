import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { isDesignAiConfigured } from "@/lib/ai/provider";
import { checkAiRateLimit, logAiCall } from "@/lib/ai/rate-limit";
import { batchCardLimit, clampBatchSize } from "@/lib/ai/generation-limits";
import { createSetGenerationJob } from "@/lib/ai/generation-jobs";
import { isBillingEnabled } from "@/lib/billing/flags";
import { getEntitlements } from "@/lib/billing/entitlements";

// ---------------------------------------------------------------------------
// POST /api/ai/jobs — create an AI batch-generation job and run its PLAN
// step (concept + every card's text in one cohesive batch). The client then
// advances the job one step at a time via /api/ai/jobs/[id]/step.
//
// Card count is clamped to the caller's batch limit: 3 for everyone until
// subscriptions launch, admins exempt (lib/ai/generation-limits.ts).
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const maxDuration = 300;

const requestSchema = z.object({
  kind: z.literal("set"),
  theme: z.string().trim().max(300).optional(),
  style: z.string().trim().max(200).optional(),
  size: z.coerce.number().optional(),
  set_id: z.string().uuid().optional(),
});

export async function POST(request: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Supabase isn't configured." },
      { status: 503 },
    );
  }
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "Sign in to generate a set." },
      { status: 401 },
    );
  }
  if (!isDesignAiConfigured()) {
    return NextResponse.json(
      { ok: false, error: "AI generation isn't configured on this deployment." },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Request body must be JSON." },
      { status: 400 },
    );
  }
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Invalid generation request." },
      { status: 400 },
    );
  }

  const limit = await batchCardLimit();
  const size = clampBatchSize(parsed.data.size ?? limit, limit);

  const rate = await checkAiRateLimit(user.id);
  if (!rate.ok) {
    return NextResponse.json(
      { ok: false, error: rate.message },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  // Credits are metered per card as steps complete; pre-check the balance so
  // a user doesn't burn a plan call they can't afford (billing off → ∞).
  if (isBillingEnabled()) {
    const entitlements = await getEntitlements();
    if (entitlements.credits < size) {
      return NextResponse.json(
        {
          ok: false,
          error: `You need ${size} credits to generate ${size} cards (you have ${entitlements.credits}).`,
          code: "INSUFFICIENT_CREDITS",
          balance: entitlements.credits,
          needed: size,
        },
        { status: 402 },
      );
    }
  }

  await logAiCall(user.id, "generate_deck");

  const result = await createSetGenerationJob({
    theme: parsed.data.theme ?? "",
    style: parsed.data.style,
    size,
    setId: parsed.data.set_id,
  });
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 502 });
  }

  return NextResponse.json(
    { ok: true, job: result.job, setSlug: result.setSlug, cardLimit: limit },
    { status: 200 },
  );
}
