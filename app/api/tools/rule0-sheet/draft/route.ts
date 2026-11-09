import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { isDesignAiConfigured } from "@/lib/ai/provider";
import {
  checkAiRateLimit,
  getFreshCreditBalance,
  logAiCall,
  refundCredits,
  settleSpend,
  spendCredits,
} from "@/lib/ai/rate-limit";
import { withAiTimeBudget } from "@/lib/ai/structured-output";
import { aiFailureMessage, classifyProviderError, designFailureKind, type AiFailureKind } from "@/lib/ai/failure";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { reconcileUserSpends } from "@/lib/billing/credit-reconcile";
import { isBillingEnabled } from "@/lib/billing/flags";
import { rateLimitedResponse } from "@/lib/api/responses";
import { listDeckCards } from "@/lib/decks/queries";
import { countsTowardDeckStats } from "@/lib/decks/analytics";
import { isDeckFormat } from "@/types/deck";
import { checkToolAccess } from "@/lib/tools/queries";
import { recordToolEvent } from "@/lib/tools/events";
import { draftTableSheet } from "@/lib/tools/rule0/ai-draft";
import { RULE0_TOOL_SLUG } from "@/lib/tools/rule0/model";
import { tableSheetFromRow } from "@/lib/tools/rule0/queries";

// ---------------------------------------------------------------------------
// POST /api/tools/rule0-sheet/draft — the table sheet's "Draft with AI"
// (1 credit, the Collection Deck Builder's rules: the tool's gate, the AI
// rate limit, the reconcile, the credit reserved before the call and SETTLED
// once the draft is delivered, refunded if it fails). The deck's OWNER only.
// The draft is WRITTEN to the sheet (game plan + win conditions, the notes
// untouched) so a paid answer survives a reload; the owner edits it after.
// Beta tools run AI although deck AI is paused (owner 2026-11-06).
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const maxDuration = 90;

const LABEL = "draft_table_sheet" as const;
const bodySchema = z.object({ deckId: z.uuid() });
const COLUMNS = "deck_id, game_plan, win_conditions, table_notes, shared, ai_drafted_at, updated_at";

export async function POST(request: Request) {
  const startedAt = Date.now();
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ ok: false, error: "Supabase isn't configured." }, { status: 503 });
  }
  const access = await checkToolAccess(RULE0_TOOL_SLUG);
  if (!access) {
    return NextResponse.json({ ok: false, error: "The Rule 0 table sheet isn't open to you." }, { status: 404 });
  }
  if (!isDesignAiConfigured()) {
    return NextResponse.json({ ok: false, error: "AI drafting isn't configured on this deployment." }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Request body must be JSON." }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "That deck doesn't exist." }, { status: 400 });
  }

  // Everything that can refuse without the AI refuses BEFORE the charge.
  const supabase = await createClient();
  const { data: deck } = await supabase
    .from("decks")
    .select("id, slug, title, description, format, bracket")
    .eq("id", parsed.data.deckId)
    .eq("owner_id", access.userId)
    .maybeSingle();
  if (!deck) {
    return NextResponse.json({ ok: false, error: "Only the deck's owner can draft its table sheet." }, { status: 404 });
  }
  // The deck's own cards (the main deck and the commander), as every AI
  // deck brief reads them (countsTowardDeckStats).
  const items = (await listDeckCards(deck.id)).filter(
    (item) => countsTowardDeckStats(item.entry.board) && item.entry.quantity > 0,
  );
  if (items.length === 0) {
    return NextResponse.json({ ok: false, error: "Add cards to the deck first: the draft is written from them." }, { status: 400 });
  }

  const rate = await checkAiRateLimit(access.userId);
  if (!rate.ok) return rateLimitedResponse(rate);

  if (isBillingEnabled() && isAdminConfigured()) {
    await reconcileUserSpends(createAdminClient(), access.userId);
  }

  const ref = `spend:table-sheet:${randomUUID()}`;
  const spend = await spendCredits(1, LABEL, { failClosed: true, ref });
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
  await logAiCall(access.userId, LABEL);

  let draft: Awaited<ReturnType<typeof draftTableSheet>>;
  try {
    draft = await withAiTimeBudget(startedAt, maxDuration, () =>
      draftTableSheet({
        title: deck.title,
        format: isDeckFormat(deck.format) ? deck.format : "casual",
        bracket: deck.bracket ?? null,
        description: deck.description ?? null,
        cards: items.map(({ entry, card }) => ({
          name: card?.title ?? entry.name,
          quantity: entry.quantity,
          board: entry.board,
          typeLine: entry.type_line ?? null,
          // A PipGlyph card's own words (an unchanged import's are its
          // printing's — still what the card says).
          rulesText: card?.rules_text ?? null,
        })),
      }),
    );
  } catch (error) {
    const landed = spend.charged ? await refundCredits(access.userId, 1, LABEL, `refund:${ref}`) : true;
    const detail = error instanceof Error ? error.message : String(error);
    const code: AiFailureKind =
      error instanceof Error && (error.name === "AiOutputError" || error.name === "AI_NoObjectGeneratedError")
        ? "design_unreadable"
        : designFailureKind(classifyProviderError(detail));
    console.error(`[ai:design] table sheet draft failed (${code}): ${detail.replace(/\s+/g, " ").slice(0, 300)}`);
    return NextResponse.json(
      {
        ok: false,
        code,
        error: aiFailureMessage(code, spend.charged && landed ? 1 : 0, spend.charged && !landed),
        credits: await getFreshCreditBalance(),
      },
      { status: 502 },
    );
  }

  // The draft is what the user paid for: settled, then written.
  if (spend.charged) await settleSpend(ref);
  const { data: row, error: writeError } = await supabase
    .from("deck_table_sheets")
    .upsert(
      {
        deck_id: deck.id,
        owner_id: access.userId,
        game_plan: draft.gamePlan || null,
        win_conditions: draft.winConditions.join("\n") || null,
        ai_drafted_at: new Date().toISOString(),
      },
      { onConflict: "deck_id" },
    )
    .select(COLUMNS)
    .single();
  if (writeError) console.error("[rule0] AI draft not saved:", writeError.message);

  await recordToolEvent({
    slug: RULE0_TOOL_SLUG,
    userId: access.userId,
    event: "ai_draft",
    access: access.via,
    props: { cards: items.length, win_conditions: draft.winConditions.length, saved: !writeError },
  });
  return NextResponse.json({
    ok: true,
    draft,
    // Null when the write failed: the page keeps the draft in the form,
    // unsaved, for the owner to save.
    sheet: row ? tableSheetFromRow(row) : null,
    credits: await getFreshCreditBalance(),
  });
}
