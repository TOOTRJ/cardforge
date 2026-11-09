import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
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
import {
  AI_FAILURE_COPY,
  ART_NUDITY_BLOCKED_COPY,
  classifyProviderError,
  creditOutcome,
  designFailureKind,
  type AiFailureKind,
} from "@/lib/ai/failure";
import { AiOutputError } from "@/lib/ai/structured-output";
import { scanImageBytes } from "@/lib/moderation/image-scan";
import { AI_ART_BLOCKED_CATEGORIES } from "@/lib/moderation/image-scan-core";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { isUserStorageConfigured } from "@/lib/media/user-storage";
import { reconcileUserSpends } from "@/lib/billing/credit-reconcile";
import { isBillingEnabled } from "@/lib/billing/flags";
import { rateLimitedResponse } from "@/lib/api/responses";
import { checkToolAccess } from "@/lib/tools/queries";
import { recordToolEvent } from "@/lib/tools/events";
import { decodeWorking } from "@/lib/tools/set-symbol/server";
import { cleanGlyph, type CleanGlyph } from "@/lib/tools/pip-forge/glyph";
import { ColourCardError, designColourCard } from "@/lib/tools/pip-forge/colour-card";
import {
  DISC_SWATCHES,
  forgePipSchema,
  normaliseHex,
  PIP_FORGE_SLUG,
  PIP_LIBRARY_MAX,
  type ColourCard,
} from "@/lib/tools/pip-forge/model";
import {
  buildGlyphPrompt,
  fallbackGlyphPrompt,
  IDEA_PROBLEM_MESSAGES,
  ideaProblem,
  PIP_PROMPT_PROBLEM_MESSAGES,
  pipPromptProblem,
  simplerGlyphPrompt,
} from "@/lib/tools/pip-forge/prompt";
import {
  countPips,
  glyphFileName,
  insertPipRow,
  LIBRARY_FULL_MESSAGE,
  newPipVersion,
  pipFileName,
  removePipFiles,
  storePipFiles,
} from "@/lib/tools/pip-forge/server";

// ---------------------------------------------------------------------------
// POST /api/tools/pip-forge/forge — one pip and its colour card from the
// maker's words: 1 credit, Set Symbol Studio's rules (the tool's gate, the
// prompt guard and the library limit BEFORE any charge, the AI rate limit,
// the reconcile, the credit reserved before the calls, SETTLED once the pip
// is stored, refunded on any failure).
//
// Two calls run side by side: FLUX draws the glyph (black on white — the
// owner's pick, FLUX alone through the Vercel AI Gateway, as Set Symbol
// Studio) and one text call writes the colour card (every word through the
// one profanity detector). The picture's bytes are scanned before anything
// is stored (the AI art rule). The glyph is then cleaned for card size and
// must clear the 16 and 24 px legibility bars (lib/tools/pip-forge/glyph.ts)
// BEFORE it is saved: short of them, ONE simpler drawing is asked for inside
// the same credit; still short, nothing is saved and the credit comes back.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const maxDuration = 180;

const LABEL = "forge_pip" as const;
/** Where billing is off (previews, local) the credit charges nothing; this
 *  daily cap is what holds the picture spend there. */
const BILLING_OFF_DAILY_LIMIT = 20;
/** The pictures' budget inside the route's 180 s: the first drawing gets
 *  most of it; a second, simpler one starts only with enough left. The
 *  paint, the uploads and a refund fit in what remains. */
const FIRST_IMAGE_BUDGET_MS = 100_000;
const TOTAL_IMAGE_BUDGET_MS = 140_000;
const SECOND_DRAWING_MIN_MS = 45_000;
const SCAN_TIMEOUT_MS = 10_000;

const ILLEGIBLE_MESSAGE =
  "The drawing had too much fine detail to read at card size, even redrawn simpler. Try a bolder idea — one object, few parts.";

type Drawing =
  | { ok: true; clean: CleanGlyph; rung: number; attempt: number }
  | { ok: false; failure: AiFailureKind; message?: string; status?: number };

async function drawGlyph(subject: string, started: number): Promise<Drawing> {
  const ladders = [[buildGlyphPrompt(subject), fallbackGlyphPrompt()], [simplerGlyphPrompt(subject)]];
  for (let attempt = 0; attempt < ladders.length; attempt += 1) {
    const left = TOTAL_IMAGE_BUDGET_MS - (Date.now() - started);
    if (attempt > 0 && left < SECOND_DRAWING_MIN_MS) break;
    const picture = await generateImageWithFallbacks(ladders[attempt], "square", {
      budgetMs: attempt === 0 ? FIRST_IMAGE_BUDGET_MS : left,
    });
    if (!picture.ok) {
      console.error(`[pip-forge] image failed (${picture.failure}): ${picture.error.slice(0, 200)}`);
      // The first drawing failing is the answer; a failed second one after
      // an illegible first is the illegible answer.
      if (attempt === 0) return { ok: false, failure: picture.failure };
      break;
    }
    // The AI art rule: the picture's BYTES are scanned before anything made
    // from them is stored; a flagged one never is (fail open on a skip).
    const scan = await scanImageBytes(picture.bytes, picture.contentType, {
      categories: AI_ART_BLOCKED_CATEGORIES,
      timeoutMs: SCAN_TIMEOUT_MS,
    });
    if (scan.flagged) return { ok: false, failure: "art_blocked", message: ART_NUDITY_BLOCKED_COPY, status: 422 };
    let clean: CleanGlyph | null = null;
    try {
      clean = cleanGlyph(await decodeWorking(picture.bytes));
    } catch {
      clean = null;
    }
    if (clean?.passed) return { ok: true, clean, rung: picture.promptIndex, attempt };
  }
  return { ok: false, failure: "art_failed", message: ILLEGIBLE_MESSAGE };
}

type Writing = { ok: true; card: ColourCard; disc: string | null } | { ok: false; failure: AiFailureKind; message?: string };

async function writeCard(subject: string, idea: string, disc: string | null): Promise<Writing> {
  try {
    return { ok: true, ...(await designColourCard({ subject, idea, disc })) };
  } catch (error) {
    if (error instanceof AiOutputError) return { ok: false, failure: "design_unreadable" };
    if (error instanceof ColourCardError) return { ok: false, failure: "design_failed", message: error.message };
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`[pip-forge] colour card failed: ${detail.replace(/\s+/g, " ").slice(0, 300)}`);
    return { ok: false, failure: designFailureKind(classifyProviderError(detail)) };
  }
}

export async function POST(request: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ ok: false, error: "Supabase isn't configured." }, { status: 503 });
  }
  const access = await checkToolAccess(PIP_FORGE_SLUG);
  if (!access) {
    return NextResponse.json({ ok: false, error: "Pip Forge isn't open to you." }, { status: 404 });
  }
  if (!isGatewayConfigured()) {
    return NextResponse.json({ ok: false, error: "AI images aren't configured on this deployment." }, { status: 503 });
  }
  if (!isUserStorageConfigured() || !isAdminConfigured()) {
    return NextResponse.json({ ok: false, error: "Saving pips isn't available right now." }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Request body must be JSON." }, { status: 400 });
  }
  const parsed = forgePipSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Describe the pip's symbol." }, { status: 400 });
  }
  const subject = parsed.data.subject.trim();
  const idea = parsed.data.idea.trim();
  const chosenDisc = parsed.data.disc == null ? null : normaliseHex(parsed.data.disc);
  if (parsed.data.disc != null && !chosenDisc) {
    return NextResponse.json({ ok: false, error: "That disc colour isn't a colour." }, { status: 400 });
  }

  // Everything that can refuse without the AI refuses BEFORE the charge.
  const problem = pipPromptProblem(subject);
  if (problem) {
    return NextResponse.json({ ok: false, code: "PROMPT", error: PIP_PROMPT_PROBLEM_MESSAGES[problem] }, { status: 400 });
  }
  const ideaIssue = ideaProblem(idea);
  if (ideaIssue) {
    return NextResponse.json({ ok: false, code: "IDEA", error: IDEA_PROBLEM_MESSAGES[ideaIssue] }, { status: 400 });
  }
  const kept = await countPips(access.userId);
  if (kept === null) {
    return NextResponse.json({ ok: false, error: "Your pips couldn't be read. Try again." }, { status: 503 });
  }
  if (kept >= PIP_LIBRARY_MAX) {
    return NextResponse.json({ ok: false, code: "LIBRARY_FULL", error: LIBRARY_FULL_MESSAGE }, { status: 409 });
  }

  const rate = await checkAiRateLimit(access.userId);
  if (!rate.ok) return rateLimitedResponse(rate);
  if (!isBillingEnabled()) {
    const daily = await checkDailyActionLimit(access.userId, LABEL, BILLING_OFF_DAILY_LIMIT, "pip");
    if (!daily.ok) return rateLimitedResponse(daily);
  }

  if (isBillingEnabled()) {
    await reconcileUserSpends(createAdminClient(), access.userId);
  }

  const ref = `spend:pip-forge:${randomUUID()}`;
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

  const refund = async (code: AiFailureKind, message?: string, status = 502) => {
    const landed = spend.charged ? await refundCredits(access.userId, 1, LABEL, `refund:${ref}`) : true;
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
  try {
    const started = Date.now();
    const [drawing, writing] = await Promise.all([drawGlyph(subject, started), writeCard(subject, idea, chosenDisc)]);
    if (!drawing.ok) return await refund(drawing.failure, drawing.message, drawing.status);
    if (!writing.ok) return await refund(writing.failure, writing.message);

    const disc = chosenDisc ?? writing.disc ?? DISC_SWATCHES[0].hex;
    version = newPipVersion();
    const files = await storePipFiles(access.userId, version, drawing.clean.glyph, disc);
    const pip = await insertPipRow({
      userId: access.userId,
      name: writing.card.name,
      prompt: subject.slice(0, 400),
      idea: idea ? idea.slice(0, 600) : null,
      disc,
      version,
      files,
      card: writing.card,
      legibility: drawing.clean.legibility,
    });
    if (!pip) throw new Error("The pip row was not written.");

    // The pip is what the maker paid for: settled, so the reconcile sweep
    // leaves the charge alone.
    if (spend.charged) await settleSpend(ref);
    await recordToolEvent({
      slug: PIP_FORGE_SLUG,
      userId: access.userId,
      event: "forge",
      access: access.via,
      props: {
        rung: drawing.rung,
        redrawn: drawing.attempt > 0,
        thickened: drawing.clean.thickened,
        at16: drawing.clean.legibility.at16,
        at24: drawing.clean.legibility.at24,
        aiDisc: chosenDisc === null,
        idea: idea.length > 0,
      },
    });
    return NextResponse.json({ ok: true, pip, credits: await getFreshCreditBalance() });
  } catch (error) {
    if (version) await removePipFiles(access.userId, [pipFileName(version), glyphFileName(version)]);
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`[pip-forge] forge failed: ${detail.replace(/\s+/g, " ").slice(0, 300)}`);
    return await refund("art_store");
  }
}
