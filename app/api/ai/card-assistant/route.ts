import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import {
  isAIConfigured,
  runCardAssistant,
} from "@/lib/ai/card-assistant";

// AI calls can take several seconds; ensure we don't get killed early.
// 60s is plenty for a single structured-output call to Anthropic.
export const maxDuration = 60;

export async function POST(request: Request) {
  // Auth gate: only signed-in users can use the AI assistant. This both
  // ratchets the load and keeps a (future) per-user quota possible.
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

  const result = await runCardAssistant(payload);
  return NextResponse.json(result, {
    status: result.ok ? 200 : 400,
  });
}
