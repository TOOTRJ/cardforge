import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import {
  isAIConfigured,
  streamCardAssistantResponse,
} from "@/lib/ai/card-assistant";
import { AI_ACTIONS, type AIAction } from "@/lib/ai/schemas";
import { checkAiRateLimit, logAiCall } from "@/lib/ai/rate-limit";

// AI streams can take 10–30s end-to-end (token-by-token over the wire);
// allow plenty of headroom. The streamObject reader closes the response
// as soon as the model finishes, so this is a ceiling, not a target.
export const maxDuration = 60;

function isAIAction(value: unknown): value is AIAction {
  return (
    typeof value === "string" &&
    (AI_ACTIONS as readonly string[]).includes(value)
  );
}

export async function POST(request: Request) {
  // Auth + service-config gates. These return JSON responses (not the
  // NDJSON stream format) since the client reads them as `.json()` when
  // `response.ok === false`.
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

  // Per-user windowed quota. Same posture as Phase 9 chunk PR 1: log
  // BEFORE invoking the provider so noisy failures still consume quota
  // and can't be used to evade the cap.
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

  // Pull the action label out of the body for usage logging — same
  // pattern as the non-streaming version. Unknown actions are swallowed
  // here; the validate-then-stream call below rejects them properly.
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

  // Streaming begins. The library function handles its own validation +
  // error responses — both as NDJSON so the client only has one parser.
  return streamCardAssistantResponse(payload);
}
