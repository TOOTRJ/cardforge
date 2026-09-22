import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import type { Json } from "@/types/supabase";
import { z } from "zod";
import { getCurrentUser, createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { isDesignAiConfigured } from "@/lib/ai/provider";
import {
  checkAiRateLimit,
  getFreshCreditBalance,
  logAiCall,
  refundCredits,
  settleSpend,
  spendCredits,
} from "@/lib/ai/rate-limit";
import { generateCardIdeas } from "@/lib/ai/card-ideas";
import { buildDeckBrief } from "@/lib/ai/deck-brief";
import { loadOwnedDeckContext } from "@/lib/ai/generation-jobs";
import { computeDeckAnalytics } from "@/lib/decks/analytics";
import { requireTier, UpgradeRequiredError } from "@/lib/billing/entitlements";
import { RARITY_VALUES } from "@/types/card";
import { rateLimitedResponse } from "@/lib/api/responses";

/** Card types the ideas can be pinned to (mirrors the creator's AI dialog). */
const IDEA_CARD_TYPES = [
  "creature", "instant", "sorcery", "artifact", "enchantment", "land", "planeswalker", "battle", "token",
] as const;

// ---------------------------------------------------------------------------
// POST /api/ai/card-ideas — a few text-only card concepts for the creator's
// "Get ideas" dialog. 1 credit per batch (charged up front, refunded if the
// design call fails), rate-limited like every AI call. `deck_id` themes the
// ideas to one of the caller's decks and is Pro-only (owner decision
// 2026-09-15 — the second tier-gated AI feature after deck-aware cards).
// Synchronous: no art, ~10–20 s of text.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const maxDuration = 60;

const bodySchema = z.object({
  theme: z.string().trim().max(300).optional(),
  card_type: z.enum(IDEA_CARD_TYPES).optional(),
  rarity: z.enum(RARITY_VALUES).optional(),
  deck_id: z.string().uuid().optional(),
});

export async function POST(request: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ ok: false, error: "Supabase isn't configured." }, { status: 503 });
  }
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Sign in to get card ideas." }, { status: 401 });
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
    return rateLimitedResponse(rate);
  }

  // Deck-themed ideas: Pro, and the deck must be the caller's.
  let deckContext: string | undefined;
  if (parsed.data.deck_id) {
    try {
      await requireTier("pro");
    } catch (error) {
      if (error instanceof UpgradeRequiredError) {
        return NextResponse.json(
          { ok: false, error: "Deck-themed ideas are a Pro feature.", code: "UPGRADE_REQUIRED" },
          { status: 403 },
        );
      }
      throw error;
    }
    const owned = await loadOwnedDeckContext(await createClient(), parsed.data.deck_id, user.id);
    if (!owned) {
      return NextResponse.json({ ok: false, error: "Deck not found or not yours." }, { status: 404 });
    }
    deckContext = buildDeckBrief({
      title: owned.deck.title,
      description: owned.deck.description,
      format: owned.deck.format,
      cards: owned.context.cards,
      analytics: computeDeckAnalytics(owned.items),
    }).context;
  }

  // One credit for the batch, reserved before the call and refunded if the
  // design fails (same fail-closed posture as job steps).
  const ref = `spend:ideas:${randomUUID()}`;
  const spend = await spendCredits(1, "generate_card_ideas", { failClosed: true, ref });
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
  await logAiCall(user.id, "generate_card_ideas");

  try {
    const ideas = await generateCardIdeas({
      theme: parsed.data.theme,
      cardType: parsed.data.card_type,
      rarity: parsed.data.rarity,
      deckContext,
    });
    // Keep the batch (migration 0092) so a closed tab doesn't waste the
    // credit — the dialog offers "reopen your last ideas". Best-effort.
    try {
      const supabase = await createClient();
      await supabase.from("card_idea_batches").insert({
        owner_id: user.id,
        request: {
          theme: parsed.data.theme ?? null,
          card_type: parsed.data.card_type ?? null,
          rarity: parsed.data.rarity ?? null,
          deck_id: parsed.data.deck_id ?? null,
        },
        ideas: ideas as unknown as Json,
      });
    } catch {
      // never fail the response over the archive write
    }
    // The ideas are delivered (the batch archive above is best-effort, the
    // response is what the user paid for): settle the charge so the
    // reconcile-credits sweep leaves it alone.
    if (spend.charged) {
      await settleSpend(ref);
    }
    return NextResponse.json({ ok: true, ideas, credits: await getFreshCreditBalance() });
  } catch (error) {
    if (spend.charged) {
      await refundCredits(user.id, 1, "generate_card_ideas", `refund:${ref}`);
    }
    const detail = error instanceof Error ? error.message : "Idea generation failed.";
    return NextResponse.json(
      { ok: false, error: `Couldn't generate ideas: ${detail}`, credits: await getFreshCreditBalance() },
      { status: 502 },
    );
  }
}
