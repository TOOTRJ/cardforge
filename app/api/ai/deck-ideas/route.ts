import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import type { Json } from "@/types/supabase";
import { z } from "zod";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { isDesignAiConfigured } from "@/lib/ai/provider";
import {
  checkAiRateLimit,
  getFreshCreditBalance,
  logAiCall,
  refundCredits,
  spendCredits,
} from "@/lib/ai/rate-limit";
import { generateDeckIdeas } from "@/lib/ai/deck-ideas";
import { deckTypeByKey } from "@/lib/decks/deck-types";
import { DECK_FORMAT_VALUES } from "@/types/deck";

// ---------------------------------------------------------------------------
// POST /api/ai/deck-ideas — three deck concepts (name, theme, art style,
// pitch) for the deck wizard. 1 credit per batch, charged up front and
// refunded if the call fails; rate-limited like every AI call. Text only.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const maxDuration = 60;

const bodySchema = z.object({
  format: z.enum(DECK_FORMAT_VALUES),
  deck_type: z.string().trim().max(60).optional(),
  bracket: z.coerce.number().int().min(1).max(5).optional(),
  hint: z.string().trim().max(300).optional(),
});

export async function POST(request: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ ok: false, error: "Supabase isn't configured." }, { status: 503 });
  }
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Sign in to get deck ideas." }, { status: 401 });
  }
  if (!isDesignAiConfigured()) {
    return NextResponse.json({ ok: false, error: "AI design isn't configured on this deployment." }, { status: 503 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Request body must be JSON." }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }
  const rate = await checkAiRateLimit(user.id);
  if (!rate.ok) {
    return NextResponse.json(
      { ok: false, error: rate.message },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }
  const ref = `spend:deckideas:${randomUUID()}`;
  const spend = await spendCredits(1, "generate_deck_ideas", { failClosed: true, ref });
  if (!spend.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: spend.message,
        code: spend.reason === "insufficient_credits" ? "INSUFFICIENT_CREDITS" : "CREDIT_CHECK_FAILED",
        balance: Number.isFinite(spend.balance) ? spend.balance : undefined,
      },
      { status: spend.reason === "insufficient_credits" ? 402 : 503 },
    );
  }
  await logAiCall(user.id, "generate_deck_ideas");
  try {
    const ideas = await generateDeckIdeas({
      format: parsed.data.format,
      deckType: deckTypeByKey(parsed.data.deck_type),
      bracket: parsed.data.bracket,
      hint: parsed.data.hint,
    });
    // Keep the batch (migration 0093) so a closed tab doesn't waste the
    // credit — the wizard offers "reopen your last ideas". Best-effort.
    try {
      const supabase = await createClient();
      await supabase.from("deck_idea_batches").insert({
        owner_id: user.id,
        request: {
          format: parsed.data.format,
          deck_type: parsed.data.deck_type ?? null,
          bracket: parsed.data.bracket ?? null,
          hint: parsed.data.hint ?? null,
        },
        ideas: ideas as unknown as Json,
      });
    } catch {
      // never fail the response over the archive write
    }
    return NextResponse.json({ ok: true, ideas, credits: await getFreshCreditBalance() });
  } catch (error) {
    if (spend.charged) {
      await refundCredits(user.id, 1, "generate_deck_ideas", `refund:${ref}`);
    }
    const message = error instanceof Error ? error.message : "Idea generation failed.";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
