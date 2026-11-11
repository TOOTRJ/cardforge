import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import sharp from "sharp";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { isGatewayConfigured } from "@/lib/ai/provider";
import {
  checkAiRateLimit,
  checkDailyActionLimit,
  getFreshCreditBalance,
  logAiCall,
  refundCredits,
  settleSpend,
  spendCredits,
} from "@/lib/ai/rate-limit";
import { generateImageWithFallbacks } from "@/lib/ai/image-gen";
import { AI_FAILURE_COPY, ART_NUDITY_BLOCKED_COPY, creditOutcome, type AiFailureKind } from "@/lib/ai/failure";
import { scanImageBytes } from "@/lib/moderation/image-scan";
import { AI_ART_BLOCKED_CATEGORIES } from "@/lib/moderation/image-scan-core";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { isUserStorageConfigured } from "@/lib/media/user-storage";
import { reconcileUserSpends } from "@/lib/billing/credit-reconcile";
import { isBillingEnabled } from "@/lib/billing/flags";
import { rateLimitedResponse } from "@/lib/api/responses";
import { checkToolAccess } from "@/lib/tools/queries";
import { recordToolEventLater, type ToolEventProps } from "@/lib/tools/events";
import { generateSymbolSchema, SYMBOL_LIBRARY_MAX, type CutoutSettings } from "@/lib/tools/set-symbol/model";
import {
  buildSymbolPrompt,
  fallbackSymbolPrompt,
  PROMPT_PROBLEM_MESSAGES,
  symbolPromptProblem,
} from "@/lib/tools/set-symbol/prompt";
import {
  countSymbols,
  decodeWorking,
  insertSymbolRow,
  LIBRARY_FULL_MESSAGE,
  newSymbolVersion,
  paintSymbolFiles,
  removeSymbolVersion,
  SET_SYMBOL_SLUG,
  sourceExtensionOf,
  storeSymbolVersion,
  SymbolCutError,
} from "@/lib/tools/set-symbol/server";
import { symbolSourceName } from "@/lib/tools/set-symbol/naming";

// ---------------------------------------------------------------------------
// POST /api/tools/set-symbol-studio/generate — one set symbol drawn by FLUX
// (owner 2026-11-06: FLUX alone, through the Vercel AI Gateway) from the
// maker's description: 1 credit, the card ideas route's rules (the tool's
// gate, the prompt guard and the library limit BEFORE any charge, the AI
// rate limit, the reconcile, the credit reserved before the call, SETTLED
// once the symbol is stored, refunded on any failure). The picture's bytes
// are scanned before anything is stored (the AI art rule:
// persistGeneratedArt's sexual categories, one 10 s cap, fail open); the
// cut-out, the four rarity looks and the watermark are then painted here
// for free (lib/tools/set-symbol/server.ts) and the row written.
//
// A route, not a server action: the picture alone can take two minutes. No
// text call runs beside it (the design is the maker's own words).
//
// The tool's log (lib/tools/events.ts, after the response): `generate` with
// the credit charged, or `generate_failed` with a `reason` code — a refusal
// before the charge, or a failure after it with whether the credit went
// back. Codes and numbers only, never the description.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const maxDuration = 180;

const LABEL = "generate_set_icon" as const;
/** Where billing is off (previews, local) the credit charges nothing; this
 *  daily cap is what holds the picture spend there. */
const BILLING_OFF_DAILY_LIMIT = 20;
/** The picture's budget inside the route's 180 s: the scan, the paint and
 *  the uploads after it take ~15 s, the refund must still run. */
const IMAGE_BUDGET_MS = 135_000;
const SCAN_TIMEOUT_MS = 10_000;

const AI_SETTINGS: CutoutSettings = { mode: "edges", tolerance: 40, ink: "one" };

function nameFromSubject(subject: string): string {
  const clean = subject.replace(/\s+/g, " ").trim().replace(/^(an?|the)\s+/i, "");
  const short = clean.length > 40 ? `${clean.slice(0, 39).replace(/\s+\S*$/, "")}…` : clean;
  return short.charAt(0).toUpperCase() + short.slice(1);
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ ok: false, error: "Supabase isn't configured." }, { status: 503 });
  }
  const access = await checkToolAccess(SET_SYMBOL_SLUG);
  if (!access) {
    return NextResponse.json({ ok: false, error: "Set Symbol Studio isn't open to you." }, { status: 404 });
  }
  const track = (event: "generate" | "generate_failed", props: ToolEventProps) =>
    recordToolEventLater({ slug: SET_SYMBOL_SLUG, userId: access.userId, event, access: access.via, props });
  if (!isGatewayConfigured()) {
    return NextResponse.json({ ok: false, error: "AI images aren't configured on this deployment." }, { status: 503 });
  }
  if (!isUserStorageConfigured() || !isAdminConfigured()) {
    return NextResponse.json({ ok: false, error: "Saving symbols isn't available right now." }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Request body must be JSON." }, { status: 400 });
  }
  const parsed = generateSymbolSchema.safeParse(body);
  if (!parsed.success) {
    track("generate_failed", { reason: "invalid" });
    return NextResponse.json({ ok: false, error: "Describe the symbol you want." }, { status: 400 });
  }
  const { subject, style } = parsed.data;

  // Everything that can refuse without the AI refuses BEFORE the charge.
  const problem = symbolPromptProblem(subject);
  if (problem) {
    track("generate_failed", { reason: "prompt_refused", problem });
    return NextResponse.json({ ok: false, code: "PROMPT", error: PROMPT_PROBLEM_MESSAGES[problem] }, { status: 400 });
  }
  const kept = await countSymbols(access.userId);
  if (kept === null) {
    track("generate_failed", { reason: "library_unreadable" });
    return NextResponse.json({ ok: false, error: "Your symbols couldn't be read. Try again." }, { status: 503 });
  }
  if (kept >= SYMBOL_LIBRARY_MAX) {
    track("generate_failed", { reason: "library_full" });
    return NextResponse.json({ ok: false, code: "LIBRARY_FULL", error: LIBRARY_FULL_MESSAGE }, { status: 409 });
  }

  const rate = await checkAiRateLimit(access.userId);
  if (!rate.ok) {
    track("generate_failed", { reason: "rate_limited" });
    return rateLimitedResponse(rate);
  }
  if (!isBillingEnabled()) {
    const daily = await checkDailyActionLimit(access.userId, LABEL, BILLING_OFF_DAILY_LIMIT, "set symbol");
    if (!daily.ok) {
      track("generate_failed", { reason: "daily_limit" });
      return rateLimitedResponse(daily);
    }
  }

  if (isBillingEnabled()) {
    await reconcileUserSpends(createAdminClient(), access.userId);
  }

  const ref = `spend:set-symbol:${randomUUID()}`;
  const spend = await spendCredits(1, LABEL, { failClosed: true, ref });
  if (!spend.ok) {
    track("generate_failed", {
      reason: spend.reason === "insufficient_credits" ? "insufficient_credits" : "credit_check_failed",
    });
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

  // `reason` is the log's code where the failure kind alone doesn't say it
  // (our own scan's block, a picture with nothing to cut out).
  const refund = async (code: AiFailureKind, message?: string, status = 502, reason: string = code) => {
    const landed = spend.charged ? await refundCredits(access.userId, 1, LABEL, `refund:${ref}`) : true;
    track("generate_failed", {
      reason,
      refunded: spend.charged && landed,
      ...(spend.charged && !landed ? { refund_pending: true } : {}),
      ms: Date.now() - startedAt,
    });
    return NextResponse.json(
      {
        ok: false,
        code,
        error: `${message ?? AI_FAILURE_COPY[code]} ${creditOutcome(spend.charged && landed ? 1 : 0, spend.charged && !landed)}`,
        credits: await getFreshCreditBalance(),
      },
      { status },
    );
  };

  let version: string | null = null;
  let sourceName: string | undefined;
  try {
    const picture = await generateImageWithFallbacks(
      [buildSymbolPrompt(subject, style), fallbackSymbolPrompt(style)],
      "square",
      { budgetMs: IMAGE_BUDGET_MS },
    );
    if (!picture.ok) {
      console.error(`[set-symbol] image failed (${picture.failure}): ${picture.error.slice(0, 200)}`);
      return await refund(picture.failure);
    }

    // The AI art rule: the picture's BYTES are scanned before they are
    // stored; a flagged one never is (fail open on a skipped scan).
    const scan = await scanImageBytes(picture.bytes, picture.contentType, {
      categories: AI_ART_BLOCKED_CATEGORIES,
      timeoutMs: SCAN_TIMEOUT_MS,
    });
    if (scan.flagged) return await refund("art_blocked", ART_NUDITY_BLOCKED_COPY, 422, "scan_blocked");

    const meta = await sharp(picture.bytes).metadata().catch(() => null);
    const sourceExt = sourceExtensionOf(meta?.format);
    const sourceBytes = sourceExt ? picture.bytes : new Uint8Array(await sharp(picture.bytes).png().toBuffer());
    const ext = sourceExt ?? "png";

    const painted = await paintSymbolFiles(await decodeWorking(sourceBytes), AI_SETTINGS);
    version = newSymbolVersion();
    sourceName = symbolSourceName(version, ext);
    const files = await storeSymbolVersion(access.userId, version, painted, { bytes: sourceBytes, ext });
    const symbol = await insertSymbolRow({
      userId: access.userId,
      name: parsed.data.name ?? nameFromSubject(subject),
      source: "ai",
      prompt: subject.trim().slice(0, 400),
      style,
      settings: AI_SETTINGS,
      version,
      files,
      legibility: painted.legibility,
    });
    if (!symbol) throw new Error("The symbol row was not written.");

    // The symbol is what the maker paid for: settled, so the reconcile
    // sweep leaves the charge alone.
    if (spend.charged) await settleSpend(ref);
    track("generate", {
      style,
      rung: picture.promptIndex,
      legibility: painted.legibility,
      credits: spend.charged ? 1 : 0,
      ms: Date.now() - startedAt,
    });
    return NextResponse.json({ ok: true, symbol, credits: await getFreshCreditBalance() });
  } catch (error) {
    if (version) await removeSymbolVersion(access.userId, version, sourceName).catch(() => undefined);
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`[set-symbol] generate failed: ${detail.replace(/\s+/g, " ").slice(0, 300)}`);
    if (error instanceof SymbolCutError) {
      return await refund(
        "art_failed",
        "The picture came back without a clear symbol to cut out. Try another description.",
        502,
        "no_symbol",
      );
    }
    // The picture was painted; storing it (or its row) is what failed.
    return await refund(version ? "art_store" : "art_failed");
  }
}
