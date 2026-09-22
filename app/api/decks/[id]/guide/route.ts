import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { isDesignAiConfigured } from "@/lib/ai/provider";
import { requireTier, UpgradeRequiredError } from "@/lib/billing/entitlements";
import {
  checkAiRateLimit,
  getFreshCreditBalance,
  logAiCall,
  refundCredits,
  settleSpend,
  spendCredits,
} from "@/lib/ai/rate-limit";
import { buildAndStoreDeckGuide } from "@/lib/decks/guides";
import { rateLimitedResponse } from "@/lib/api/responses";

// ---------------------------------------------------------------------------
// POST /api/decks/[id]/guide — analyze the owner's deck into a how-to-play
// guide with combos. Pro only (the third tier-gated AI feature), 1 credit,
// refunded if the analysis fails. AI-generated decks get theirs free at
// generation time; this is for every other deck, or a refresh.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const maxDuration = 90;

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ ok: false, error: "Supabase isn't configured." }, { status: 503 });
  }
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Sign in first." }, { status: 401 });
  if (!isDesignAiConfigured()) {
    return NextResponse.json({ ok: false, error: "AI isn't configured on this deployment." }, { status: 503 });
  }
  try {
    await requireTier("pro");
  } catch (error) {
    if (error instanceof UpgradeRequiredError) {
      return NextResponse.json(
        { ok: false, error: "Deck analysis is a Pro feature.", code: "UPGRADE_REQUIRED" },
        { status: 403 },
      );
    }
    throw error;
  }
  const { id } = await params;
  const supabase = await createClient();
  const { data: deck } = await supabase.from("decks").select("id, owner_id").eq("id", id).maybeSingle();
  if (!deck) return NextResponse.json({ ok: false, error: "Deck not found." }, { status: 404 });
  if (deck.owner_id !== user.id) return NextResponse.json({ ok: false, error: "Not your deck." }, { status: 403 });
  const rate = await checkAiRateLimit(user.id);
  if (!rate.ok) {
    return rateLimitedResponse(rate);
  }
  const ref = `spend:deckguide:${randomUUID()}`;
  const spend = await spendCredits(1, "analyze_deck", { failClosed: true, ref });
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
  await logAiCall(user.id, "analyze_deck");
  const result = await buildAndStoreDeckGuide(id, "analysis");
  if (!result.ok) {
    if (spend.charged) await refundCredits(user.id, 1, "analyze_deck", `refund:${ref}`);
    return NextResponse.json({ ok: false, error: result.error }, { status: 502 });
  }
  // The analysis is stored: settle the charge so the reconcile-credits sweep
  // (which refunds every aged UNSETTLED spend) leaves it alone.
  if (spend.charged) await settleSpend(ref);
  return NextResponse.json({ ok: true, guide: result.guide, credits: await getFreshCreditBalance() });
}
