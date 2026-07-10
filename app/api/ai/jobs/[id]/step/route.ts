import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { checkAiRateLimit } from "@/lib/ai/rate-limit";
import { runNextJobStep } from "@/lib/ai/generation-jobs";

// ---------------------------------------------------------------------------
// POST /api/ai/jobs/[id]/step — execute one step of a generation job (one
// card's creation + art, or the set icon). The client calls this in a loop
// while steps remain; passing { step } retries a specific failed step.
// One image generation per call keeps every invocation well under the
// function timeout regardless of batch size.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const maxDuration = 180;

const requestSchema = z.object({
  step: z.string().max(40).optional(),
});

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

  const rate = await checkAiRateLimit(user.id);
  if (!rate.ok) {
    return NextResponse.json(
      { ok: false, error: rate.message },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
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
  const result = await runNextJobStep(id, stepKey);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 502 });
  }
  return NextResponse.json({ ok: true, job: result.job }, { status: 200 });
}
