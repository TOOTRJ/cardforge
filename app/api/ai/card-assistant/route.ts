import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import {
  isAIConfigured,
  runCardAssistant,
} from "@/lib/ai/card-assistant";
import { AI_ACTIONS, type AIAction } from "@/lib/ai/schemas";
import { checkAiRateLimit, logAiCall } from "@/lib/ai/rate-limit";

// AI calls can take several seconds; ensure we don't get killed early.
// 60s is plenty for a single structured-output call to Anthropic.
export const maxDuration = 60;

function isAIAction(value: unknown): value is AIAction {
  return (
    typeof value === "string" &&
    (AI_ACTIONS as readonly string[]).includes(value)
  );
}

export async function POST(request: Request) {
  // Auth gate: only signed-in users can use the AI assistant. This both
  // ratchets the load and feeds the per-user rate limit below.
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Supabase is not configured." },
      { status: 503 },
    );
  }

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "You must be signed in to use the AI assistant." },
      { status: 401 },
    );
  }

  if (!isAIConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "AI assistant isn't configured on this deployment. Set ANTHROPIC_API_KEY.",
      },
      { status: 503 },
    );
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Request body must be JSON." },
      { status: 400 },
    );
  }

  // Per-user windowed quota. We check the limit BEFORE invoking the
  // provider (the expensive bit), and log the call regardless of provider
  // success so failed-but-attempted calls still consume quota — a noisy
  // attacker can't trigger errors to dodge the limit.
  const limit = await checkAiRateLimit(user.id);
  if (!limit.ok) {
    return NextResponse.json(
      { ok: false, error: limit.message },
      {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfterSeconds) },
      },
    );
  }

  // Pull the action label out of the body for usage logging. The full
  // payload is still validated inside `runCardAssistant`; this is a thin
  // pre-parse so we can record what the user *tried* to do even on
  // schema-rejection paths. Unknown actions are silently skipped — the
  // strict parse inside the assistant will reject them with a 400.
  const action: AIAction | null =
    typeof payload === "object" &&
    payload !== null &&
    "action" in payload &&
    isAIAction((payload as { action: unknown }).action)
      ? ((payload as { action: AIAction }).action)
      : null;

  if (action) {
    await logAiCall(user.id, action);
  }

  const result = await runCardAssistant(payload);
  return NextResponse.json(result, {
    status: result.ok ? 200 : 400,
  });
}
