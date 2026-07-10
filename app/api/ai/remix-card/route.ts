import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import {
  REMIX_DAILY_LIMIT,
  checkAiRateLimit,
  checkDailyActionLimit,
  consumeAiCredits,
  logAiCall,
  refundAiCredits,
} from "@/lib/ai/rate-limit";
import { isDesignAiConfigured } from "@/lib/ai/provider";
import { generateRemixIdentity } from "@/lib/ai/remix";
import { isImageRemixConfigured, restyleImage } from "@/lib/ai/image-gen";
import { generateRandomArt, persistGeneratedArt } from "@/lib/ai/random-art";
import { getCardById } from "@/lib/cards/queries";
import { remixCardAction } from "@/lib/cards/actions";

// ---------------------------------------------------------------------------
// /api/ai/remix-card — AI remix: fork a card with IDENTICAL mechanics but a
// new name, flavor, and art re-rendered in a user-chosen style ("anime",
// "pixel art", …).
//
// Pipeline: identity text (design model) → image-to-image restyle of the
// parent's art (gateway multimodal model or OpenAI images.edit; plain
// generation when the parent has no art) → remixCardAction fork with
// parent_card_id provenance, saved private.
//
// Quota: global burst caps + its own 10/day + 1 AI credit (reserved
// up-front, refunded when the TEXT step fails; art failures fall back to
// the parent's art and keep the charge, matching the random-card posture).
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const maxDuration = 120;

const requestSchema = z.object({
  card_id: z.string().uuid(),
  style: z.string().trim().min(1, "Pick a style.").max(200),
  theme: z.string().trim().max(300).optional(),
});

// Cap what we'll pull back in for restyling — card art is ~1-4MB; anything
// past 12MB is not something we should buffer per-request.
const MAX_SOURCE_ART_BYTES = 12 * 1024 * 1024;

export async function POST(request: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Supabase isn't configured." },
      { status: 503 },
    );
  }

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "Sign in to remix cards with AI." },
      { status: 401 },
    );
  }

  if (!isDesignAiConfigured() || !isImageRemixConfigured()) {
    return NextResponse.json(
      { ok: false, error: "AI remix isn't configured on this deployment." },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Request body must be JSON." },
      { status: 400 },
    );
  }
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid request." },
      { status: 400 },
    );
  }
  const { card_id, style, theme } = parsed.data;

  // ---- Quota ----
  const globalLimit = await checkAiRateLimit(user.id);
  if (!globalLimit.ok) {
    return NextResponse.json(
      { ok: false, error: globalLimit.message },
      {
        status: 429,
        headers: { "Retry-After": String(globalLimit.retryAfterSeconds) },
      },
    );
  }
  const dailyLimit = await checkDailyActionLimit(
    user.id,
    "remix_card",
    REMIX_DAILY_LIMIT,
    "AI remix",
  );
  if (!dailyLimit.ok) {
    return NextResponse.json(
      { ok: false, error: dailyLimit.message },
      {
        status: 429,
        headers: { "Retry-After": String(dailyLimit.retryAfterSeconds) },
      },
    );
  }

  // ---- Load the parent (RLS makes this an authorization check too) ----
  const parent = await getCardById(card_id);
  if (!parent) {
    return NextResponse.json(
      { ok: false, error: "Card not found." },
      { status: 404 },
    );
  }

  // ---- Reserve the credit; refund on any text-path failure ----
  const reserve = await consumeAiCredits("remix_card", { failClosed: true });
  if (!reserve.ok) {
    const insufficient = reserve.reason === "insufficient_credits";
    return NextResponse.json(
      {
        ok: false,
        error: reserve.message,
        ...(insufficient
          ? { code: "INSUFFICIENT_CREDITS", balance: reserve.balance }
          : {}),
      },
      { status: insufficient ? 402 : 503 },
    );
  }

  await logAiCall(user.id, "remix_card");

  let identity;
  try {
    identity = await generateRemixIdentity({ card: parent, style, theme });
  } catch (error) {
    await refundAiCredits(user.id, "remix_card");
    const detail = error instanceof Error ? error.message : "Remix failed.";
    return NextResponse.json(
      { ok: false, error: `AI remix failed: ${detail}` },
      { status: 502 },
    );
  }

  // ---- Art: restyle the parent's art; no parent art → generate fresh ----
  await logAiCall(user.id, "remix_art");
  let artUrl: string | undefined;
  let artError: string | null = null;

  if (parent.art_url) {
    try {
      const sourceResponse = await fetch(parent.art_url);
      const contentType =
        sourceResponse.headers.get("content-type") ?? "image/png";
      const contentLength = Number(
        sourceResponse.headers.get("content-length") ?? 0,
      );
      if (
        !sourceResponse.ok ||
        !contentType.startsWith("image/") ||
        contentLength > MAX_SOURCE_ART_BYTES
      ) {
        artError = "Couldn't load the original artwork to restyle.";
      } else {
        const source = new Uint8Array(await sourceResponse.arrayBuffer());
        const restyled = await restyleImage({
          source,
          sourceContentType: contentType,
          prompt: `Re-render this artwork in ${style} style. ${identity.art_instruction}`,
        });
        if (restyled.ok) {
          const persisted = await persistGeneratedArt(
            restyled.bytes,
            restyled.contentType,
          );
          if (persisted.ok) artUrl = persisted.publicUrl;
          else artError = persisted.error;
        } else {
          artError = restyled.error;
        }
      }
    } catch {
      artError = "Couldn't load the original artwork to restyle.";
    }
  } else {
    // Parent never had art — paint the described scene in the target style.
    const generated = await generateRandomArt(
      `${identity.art_instruction} Style: ${style}.`,
    );
    if (generated.ok) artUrl = generated.publicUrl;
    else artError = generated.error;
  }

  // ---- Fork (identical mechanics; new identity; private) ----
  const result = await remixCardAction({
    parentCardId: parent.id,
    title: identity.title,
    flavorText: identity.flavor_text,
    artUrl,
  });
  if (!result.ok) {
    // The fork itself failed (e.g. card capacity) — the user got nothing.
    await refundAiCredits(user.id, "remix_card");
    const detail =
      result.formError ??
      Object.values(result.fieldErrors ?? {})[0] ??
      "Couldn't create the remix.";
    return NextResponse.json({ ok: false, error: detail }, { status: 502 });
  }

  return NextResponse.json(
    {
      ok: true,
      cardId: result.cardId,
      slug: result.slug,
      artError,
      creditsRemaining: Number.isFinite(reserve.balance)
        ? reserve.balance
        : null,
    },
    { status: 200 },
  );
}
