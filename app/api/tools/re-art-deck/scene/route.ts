import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { isDesignAiConfigured } from "@/lib/ai/provider";
import { checkAiRateLimit, getFreshCreditBalance, logAiCall, refundCredits, settleSpend, spendCredits } from "@/lib/ai/rate-limit";
import { withAiTimeBudget } from "@/lib/ai/structured-output";
import { aiFailureMessage, classifyProviderError, designFailureKind, type AiFailureKind } from "@/lib/ai/failure";
import { reconcileUserSpends } from "@/lib/billing/credit-reconcile";
import { isBillingEnabled } from "@/lib/billing/flags";
import { buildTypeLine } from "@/lib/cards/card-display";
import { checkToolAccess } from "@/lib/tools/queries";
import { recordToolEventLater, type ToolEventProps } from "@/lib/tools/events";
import { toolHref } from "@/lib/tools/catalog";
import {
  REART_CARD_WORDS_MAX,
  REART_SCENE_CREDITS,
  REART_TOOL_SLUG,
  classifyReartEntry,
  cleanReartCardWords,
  type ReartCardWords,
} from "@/lib/tools/re-art/model";
import { getOwnedDeck, readCardWordsAdmin, readDeckStyle, saveCardWords } from "@/lib/tools/re-art/server";
import { REART_SCENE_AI_LABEL, REART_SCENE_EVENT, REART_SCENE_FAILED_EVENT, writeReartScene } from "@/lib/tools/re-art/scene";

// ---------------------------------------------------------------------------
// POST /api/tools/re-art-deck/scene — Re-art deck's "Write a scene with AI"
// for ONE card of the caller's own deck (migration 0217; owner 2026-11-18:
// one credit each). The text model writes what the card's picture shows;
// the scene becomes the card's OWN WORDS (0209), which its next picture is
// painted from. Nothing is painted here.
//
// The table sheet draft's rules: the tool's gate, everything that can
// refuse without the AI refuses BEFORE the charge, the AI rate limit, the
// reconcile, the credit reserved before the call. Then — stricter than the
// draft, because the scene is all the call buys — the scene is SAVED first
// and the credit settled only once it is: a paid answer is a saved answer,
// so a response that never reaches the browser loses nothing (the card's
// words are there on the next load). A failed call, an empty scene and a
// scene that can't be saved all hand the credit back.
//
// A route, not a server action: "Write scenes…" asks for many cards one
// after another, and a server action would queue the tool's other actions
// (a lock, a save) behind every one of them.
//
// Recorded (tool_events, after the response): `write_scene` with the
// `credits` charged; every refusal or failure past the tool's gate as
// `write_scene_failed` with a `reason` — and `refunded` once a credit was
// taken. Never the scene, the note or a card's name.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const maxDuration = 60;

const LABEL = REART_SCENE_AI_LABEL;

const bodySchema = z.object({
  deckId: z.uuid(),
  entryId: z.uuid(),
  /** The maker's direction for the scene (what they want to see). */
  note: z.string().max(REART_CARD_WORDS_MAX * 2).optional(),
});

export async function POST(request: Request) {
  const startedAt = Date.now();
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ ok: false, error: "Supabase isn't configured." }, { status: 503 });
  }
  const access = await checkToolAccess(REART_TOOL_SLUG);
  if (!access) {
    return NextResponse.json({ ok: false, code: "CLOSED", error: "Re-art deck isn't open to you." }, { status: 404 });
  }
  const refused = (reason: string, props: ToolEventProps = {}) =>
    recordToolEventLater({ slug: REART_TOOL_SLUG, userId: access.userId, event: REART_SCENE_FAILED_EVENT, access: access.via, props: { reason, ...props } });
  if (!isDesignAiConfigured()) {
    refused("ai_unavailable");
    return NextResponse.json({ ok: false, code: "AI_UNAVAILABLE", error: "AI writing isn't configured on this deployment." }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    refused("invalid");
    return NextResponse.json({ ok: false, error: "Request body must be JSON." }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    refused("invalid");
    return NextResponse.json({ ok: false, error: "That card couldn't be read." }, { status: 400 });
  }

  // Everything that can refuse without the AI refuses BEFORE the charge.
  const deck = await getOwnedDeck(access.userId, parsed.data.deckId);
  if (!deck) {
    refused("not_owner");
    return NextResponse.json({ ok: false, error: "That deck isn't one of yours." }, { status: 404 });
  }
  const supabase = await createClient();
  const { data: entry, error: entryError } = await supabase
    .from("deck_cards")
    .select("id, name, board, card_id, scryfall_id, type_line")
    .eq("id", parsed.data.entryId)
    .eq("deck_id", deck.id)
    .maybeSingle();
  if (entryError) {
    refused("unread");
    return NextResponse.json({ ok: false, error: "We couldn't read this card's deck entry — try again." }, { status: 503 });
  }
  if (!entry) {
    refused("gone");
    return NextResponse.json({ ok: false, error: "That card is no longer in this deck." }, { status: 404 });
  }
  let card: {
    id: string;
    owner_id: string;
    title: string;
    card_type: string | null;
    supertype: string | null;
    subtypes: string[] | null;
    rules_text: string | null;
    flavor_text: string | null;
  } | null = null;
  if (entry.card_id) {
    const { data, error } = await supabase
      .from("cards")
      .select("id, owner_id, title, card_type, supertype, subtypes, rules_text, flavor_text")
      .eq("id", entry.card_id)
      .maybeSingle();
    if (error) {
      refused("unread");
      return NextResponse.json({ ok: false, error: "We couldn't read this card — try again." }, { status: 503 });
    }
    card = data;
  }
  // A scene is for a card the tool paints: the list's own rule.
  const classified = classifyReartEntry({
    board: entry.board,
    cardId: entry.card_id,
    scryfallId: entry.scryfall_id,
    typeLine: entry.type_line,
    card,
    ownerId: access.userId,
  });
  if (classified.kind === "skip") {
    refused("not_paintable", { why: classified.reason });
    return NextResponse.json({ ok: false, code: "NOT_PAINTABLE", error: classified.message }, { status: 400 });
  }
  // The words the card has now: the scene replaces them, and they are
  // handed back (the dialog's way back). A read that didn't answer stops
  // here — never "none", which would lose them without a word.
  const stored = await readCardWordsAdmin(access.userId, deck.id, entry.id);
  if (!stored.ok) {
    refused("unread");
    return NextResponse.json({ ok: false, error: "This card's own words couldn't be read — try again." }, { status: 503 });
  }
  // A scene names no style — the deck's look is added to it — so it is
  // never "use only these words": a card that was would be painted from the
  // scene ALONE, out of the deck's style, at a picture's price.
  const only = false;
  const note = cleanReartCardWords(parsed.data.note) || null;
  const style = await readDeckStyle(deck.id);
  const own = classified.kind === "own" ? card : null;
  const subject = {
    name: own?.title || entry.name,
    typeLine: own
      ? buildTypeLine({
          cardType: (own.card_type ?? undefined) as Parameters<typeof buildTypeLine>[0]["cardType"],
          supertype: own.supertype ?? null,
          subtypes: own.subtypes ?? [],
        }) || entry.type_line
      : entry.type_line,
    rulesText: own?.rules_text ?? null,
    flavorText: own?.flavor_text ?? null,
  };
  const about: ToolEventProps = {
    kind: classified.kind,
    had_words: Boolean(stored.words),
    was_only: Boolean(stored.words?.only),
    note: Boolean(note),
  };

  const rate = await checkAiRateLimit(access.userId);
  if (!rate.ok) {
    refused("rate_limited", { window: rate.reason, ...about });
    return NextResponse.json(
      { ok: false, code: "RATE_LIMITED", error: rate.message, retryAfterSeconds: rate.retryAfterSeconds },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }
  if (isBillingEnabled() && isAdminConfigured()) {
    await reconcileUserSpends(createAdminClient(), access.userId);
  }

  const ref = `spend:re-art-scene:${randomUUID()}`;
  const spend = await spendCredits(REART_SCENE_CREDITS, LABEL, { failClosed: true, ref });
  if (!spend.ok) {
    refused(spend.reason === "insufficient_credits" ? "insufficient_credits" : "credit_check_failed", about);
    return NextResponse.json(
      {
        ok: false,
        error: spend.message,
        code: spend.reason === "insufficient_credits" ? "INSUFFICIENT_CREDITS" : "CREDIT_CHECK_FAILED",
        credits: Number.isFinite(spend.balance) ? spend.balance : undefined,
      },
      { status: spend.reason === "insufficient_credits" ? 402 : 503 },
    );
  }
  await logAiCall(access.userId, LABEL);
  /** The credit this call took goes back; what the log and the page then say. */
  const handBack = async () => {
    const landed = spend.charged ? await refundCredits(access.userId, REART_SCENE_CREDITS, LABEL, `refund:${ref}`) : true;
    return { refunded: spend.charged && landed, refund_pending: spend.charged && !landed };
  };

  let scene: string;
  try {
    scene = await withAiTimeBudget(startedAt, maxDuration, () => writeReartScene(subject, style, note));
  } catch (error) {
    const back = await handBack();
    const detail = error instanceof Error ? error.message : String(error);
    const code: AiFailureKind =
      error instanceof Error && (error.name === "AiOutputError" || error.name === "AI_NoObjectGeneratedError")
        ? "design_unreadable"
        : designFailureKind(classifyProviderError(detail));
    console.error(`[ai:design] re-art scene failed (${code}): ${detail.replace(/\s+/g, " ").slice(0, 300)}`);
    refused(code, { ...back, ...about, ms: Date.now() - startedAt });
    return NextResponse.json(
      { ok: false, code, error: aiFailureMessage(code, back.refunded ? REART_SCENE_CREDITS : 0, back.refund_pending), credits: await getFreshCreditBalance() },
      { status: 502 },
    );
  }

  // SAVED first, settled after: the scene is all this call buys, and a
  // scene that isn't the card's words is nothing the maker can use.
  const words: ReartCardWords = { text: scene, only };
  if (!(await saveCardWords(access.userId, deck.id, entry.id, words))) {
    const back = await handBack();
    refused("not_saved", { ...back, ...about, ms: Date.now() - startedAt });
    return NextResponse.json(
      {
        ok: false,
        error: back.refund_pending
          ? "The scene couldn't be saved. Your credit is on its way back."
          : "The scene couldn't be saved — nothing was charged. Try again.",
        credits: await getFreshCreditBalance(),
      },
      { status: 500 },
    );
  }
  if (spend.charged) await settleSpend(ref);

  recordToolEventLater({
    slug: REART_TOOL_SLUG,
    userId: access.userId,
    event: REART_SCENE_EVENT,
    access: access.via,
    props: { ...about, chars: scene.length, credits: spend.charged ? REART_SCENE_CREDITS : 0, ms: Date.now() - startedAt },
  });
  revalidatePath(toolHref(REART_TOOL_SLUG));
  return NextResponse.json({ ok: true, words, previous: stored.words, credits: await getFreshCreditBalance() });
}
