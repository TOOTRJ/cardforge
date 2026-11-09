import "server-only";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { updateCardAction } from "@/lib/cards/actions";
import { fitArtToWindow } from "@/lib/cards/art-fit";
import { rowHasBakedBack } from "@/lib/cards/faces";
import { buildTypeLine } from "@/lib/cards/card-display";
import { withCreditedStep } from "@/lib/ai/credited-step";
import { logAiCall } from "@/lib/ai/rate-limit";
import { generateImageWithFallbacks } from "@/lib/ai/image-gen";
import { discardGeneratedArt, persistGeneratedArt } from "@/lib/ai/random-art";
import { artPromptLadder } from "@/lib/ai/art-prompt-safety";
import { artShapeForBackFace, artShapeForFace, type ArtFace } from "@/lib/ai/art-aspect";
import type { AiFailureKind } from "@/lib/ai/failure";
import type { JobStep } from "@/lib/ai/generation-jobs";
import { checkToolAccess } from "@/lib/tools/queries";
import { customizeSourceStep, type BulkStepDeps } from "@/lib/tools/bulk-customize/step";
import type { BulkCardPayload } from "@/lib/tools/bulk-customize/planner";
import type { CardBackFace, CardType, ColorIdentity } from "@/types/card";
import type { Json } from "@/types/supabase";
import {
  REART_CREDITS_PER_FACE,
  REART_MAX_CARDS,
  REART_SKIP_COPY,
  REART_TOOL_SLUG,
  REART_VISIBILITY_VALUES,
  reartArtPrompt,
  reartLadderStyle,
  reartStepKey,
  reartStyleSchema,
  sameReartStyle,
  type ReartStyle,
} from "@/lib/tools/re-art/model";
import {
  readDeckStyleAdmin,
  readPaintedCardAdmin,
  reartBulkChoices,
  writePaintedCard,
  type PaintedCard,
} from "@/lib/tools/re-art/server";

// ---------------------------------------------------------------------------
// One step of a Re-art run (`ai_generation_jobs.kind` 'deck_reart', migration
// 0191) — one card of the deck. Run by runNextJobStep after the atomic
// claim; its outcome is written by patch_job_step.
//
// The plan is the owner's to insert (0059), so it names ENTRIES and the
// style it was priced in, nothing to write: the step re-reads the entry
// from the caller's own deck, the deck's stored style (the authority — a
// run whose style changed since stops before any charge) and the card.
//
//   * a REAL card's entry is made the maker's own through Bulk Customize's
//     one-card core (customizeSourceStep: its planner, createCardAction, the
//     entry linked by linkDeckCardAction) with the deck's style block as the
//     picture's prompt;
//   * an entry that is the maker's OWN card gets its new picture ON that
//     card: an EDIT of its art alone (art_url + art_position, a two-faced
//     card's back art too) through updateCardAction — every edit rule holds
//     (a field the maker didn't touch is not sent; the AI-art parts of
//     ai_fields are derived by the database from the `ai-` picture,
//     cards_track_ai_fields). Its earlier picture is kept on
//     deck_reart_cards so the maker can put it back;
//   * another creator's card, an emblem: never touched (failed with why,
//     before any charge).
//
// No card is made or painted twice: a step whose card is in the run's style
// already (painted by another run) is done without a charge unless the plan
// asked to paint it again (a sample, a re-roll).
// ---------------------------------------------------------------------------

const planEntrySchema = z
  .object({
    entry_id: z.string().uuid(),
    name: z.string().max(300),
    kind: z.enum(["printing", "own"]),
    credits: z.number().int().min(0).max(4),
    repaint: z.boolean(),
  })
  .strict();

const planSchema = z
  .object({
    deck_id: z.string().uuid(),
    style: reartStyleSchema.extend({ version: z.number().int().min(1) }),
    visibility: z.enum(REART_VISIBILITY_VALUES),
    entries: z.array(planEntrySchema).min(1).max(REART_MAX_CARDS),
  })
  .strict();

export type ReartJobPlan = z.infer<typeof planSchema>;

const CLEARED = { error_code: null, note: null, retry_after_seconds: null } as const;

function failed(step: JobStep, error: string, extra: Partial<JobStep> = {}): JobStep {
  return { ...step, ...CLEARED, status: "failed", error, ...extra };
}

/** Each picture's budget inside the 180 s step function (Bulk Customize's). */
const ONE_PICTURE_BUDGET_MS = 130_000;
const TWO_PICTURES_BUDGET_MS = 70_000;

export const REART_STYLE_CHANGED =
  "The deck's style changed since this run started — start a new run to paint in the new one.";

type OwnCard = {
  id: string;
  owner_id: string;
  title: string;
  card_type: string | null;
  supertype: string | null;
  subtypes: string[] | null;
  cost: string | null;
  color_identity: string[] | null;
  rules_text: string | null;
  flavor_text: string | null;
  frame_style: unknown;
  back_face: unknown;
  art_url: string | null;
  art_position: unknown;
};

const OWN_CARD_COLUMNS =
  "id, owner_id, title, card_type, supertype, subtypes, cost, color_identity, rules_text, flavor_text, frame_style, back_face, art_url, art_position";

/** The prompt of a real card's picture: the card's own subject, the deck's
 *  style block. */
function payloadPrompt(payload: BulkCardPayload, face: "front" | "back", style: ReartStyle) {
  const back = face === "back" ? payload.back_face : undefined;
  const typeLine = buildTypeLine({
    cardType: (back?.card_type ?? payload.card_type) as CardType | undefined,
    supertype: back ? (back.supertype ?? null) : (payload.supertype ?? null),
    subtypes: back ? (back.subtypes ?? []) : payload.subtypes,
  });
  return {
    style: reartLadderStyle(style),
    prompt: reartArtPrompt(
      {
        title: back?.title ?? payload.title,
        typeLine,
        rulesText: back ? back.rules_text : payload.rules_text,
        flavorText: back ? back.flavor_text : payload.flavor_text,
      },
      style,
    ),
  };
}

export async function runReartStep(
  userId: string,
  jobId: string,
  rawPlan: unknown,
  step: JobStep,
  stepIndex: number,
  deps: BulkStepDeps,
): Promise<JobStep> {
  // A beta tool: open to its testers only, step by step.
  const access = await checkToolAccess(REART_TOOL_SLUG);
  if (!access || access.userId !== userId) return failed(step, "Re-art deck isn't open to you.");

  const parsedPlan = planSchema.safeParse(rawPlan);
  if (!parsedPlan.success) return failed(step, "This run can't be read — start it again.");
  const plan = parsedPlan.data;
  const planned = plan.entries[stepIndex];
  if (!planned || step.key !== reartStepKey(stepIndex)) return failed(step, "Missing card plan.");

  // The deck's stored style is the authority: a run priced in a style the
  // deck no longer has stops here, before any charge.
  const stored = await readDeckStyleAdmin(userId, plan.deck_id);
  if (!stored || stored.version !== plan.style.version || !sameReartStyle(stored, plan.style)) {
    return failed(step, REART_STYLE_CHANGED);
  }
  const style: ReartStyle = { preset: stored.preset, theme: stored.theme };

  // The entry, from the caller's OWN deck again.
  const supabase = await createClient();
  const { data: entry } = await supabase
    .from("deck_cards")
    .select("id, name, board, card_id, scryfall_id, decks!inner(owner_id)")
    .eq("id", planned.entry_id)
    .eq("deck_id", plan.deck_id)
    .eq("decks.owner_id", userId)
    .maybeSingle();
  if (!entry) return failed(step, "This card is no longer in your deck.");

  // An entry that is (now) linked to a card: the own-card path — a real
  // card another run already made lands here too, and is found in style.
  if (entry.card_id) {
    return paintOwnCard(userId, jobId, step, plan, style, stored.version, entry.card_id, planned.repaint, deps);
  }
  if (planned.kind !== "printing" || !entry.scryfall_id) {
    return failed(step, "This entry has no card to re-art any more.");
  }

  // A real card: Bulk Customize's one-card core, in the deck's style.
  return customizeSourceStep(
    userId,
    jobId,
    step,
    {
      source: { kind: "deck_entry", id: entry.id },
      choices: reartBulkChoices(style, plan.visibility),
      aiLabel: "deck_reart_art",
      artPrompt: (payload, face) => payloadPrompt(payload, face, style),
      refusePlanned: (payload) => (payload.card_type === "emblem" ? REART_SKIP_COPY.emblem : null),
      onSaved: async (cardId, art) => {
        const recorded = await writePaintedCard(userId, plan.deck_id, jobId, {
          cardId,
          styleVersion: stored.version,
          artUrl: art.front,
          backArtUrl: art.back,
          made: true,
          previousArtUrl: null,
          previousArtPosition: null,
          previousBackArtUrl: null,
          previousBackArtPosition: null,
        });
        return recorded ? null : "Saved, but the tool may offer to paint it again.";
      },
    },
    deps,
  );
}

/**
 * The maker's own card gets its new picture: an edit of its art alone.
 */
async function paintOwnCard(
  userId: string,
  jobId: string,
  step: JobStep,
  plan: ReartJobPlan,
  style: ReartStyle,
  version: number,
  cardId: string,
  repaint: boolean,
  _deps: BulkStepDeps,
): Promise<JobStep> {
  void _deps;
  const supabase = await createClient();
  const { data } = await supabase.from("cards").select(OWN_CARD_COLUMNS).eq("id", cardId).maybeSingle();
  const card = data as OwnCard | null;
  // Another creator's card is never edited (it is theirs); a card the
  // caller can't read is gone for them.
  if (!card) return failed(step, REART_SKIP_COPY.gone);
  if (card.owner_id !== userId) return failed(step, REART_SKIP_COPY.other_creator);
  if (card.card_type === "emblem") return failed(step, REART_SKIP_COPY.emblem);

  const painted = await readPaintedCardAdmin(userId, plan.deck_id, card.id);
  if (!repaint && painted?.styleVersion === version && painted.artUrl) {
    // Painted in this style by another run: nothing to do, nothing charged.
    return {
      ...step,
      ...CLEARED,
      status: "done",
      error: undefined,
      card_id: card.id,
      label: card.title,
      note: "Already in this style — nothing was charged.",
    };
  }

  const back = (card.back_face ?? null) as CardBackFace | null;
  const twoFaces = Boolean(back) && rowHasBakedBack({ frame_style: card.frame_style, back_face: card.back_face });
  const credits = REART_CREDITS_PER_FACE * (twoFaces ? 2 : 1);
  const frameStyle = (card.frame_style ?? {}) as ArtFace["style"] & { template?: string };
  const frontFace: ArtFace = {
    template: frameStyle?.template ?? null,
    colorIdentity: card.color_identity ?? [],
    cardType: card.card_type,
    supertype: card.supertype,
    cost: card.cost,
    style: frameStyle,
  };

  return withCreditedStep(userId, jobId, credits, "deck_reart_art", step, async () => {
    const attempt = (step.attempts ?? 0) + 1;
    const budgetMs = twoFaces ? TWO_PICTURES_BUDGET_MS : ONE_PICTURE_BUDGET_MS;
    const stored: string[] = [];
    const models: string[] = [];
    const paint = async (face: "front" | "back"): Promise<{ ok: true; url: string } | { ok: false; error: string; failure: AiFailureKind }> => {
      const onBack = face === "back" && back;
      const title = (onBack ? back.title : card.title) ?? card.title;
      const typeLine = buildTypeLine({
        cardType: ((onBack ? back.card_type : card.card_type) ?? undefined) as CardType | undefined,
        supertype: onBack ? (back.supertype ?? null) : card.supertype,
        subtypes: (onBack ? back.subtypes : card.subtypes) ?? [],
      });
      const prompt = reartArtPrompt(
        {
          title,
          typeLine,
          rulesText: onBack ? back.rules_text : card.rules_text,
          flavorText: onBack ? back.flavor_text : card.flavor_text,
        },
        style,
      );
      await logAiCall(userId, "deck_reart_art");
      const image = await generateImageWithFallbacks(
        artPromptLadder(attempt, prompt, {
          title,
          colors: (card.color_identity ?? []) as ColorIdentity[],
          style: reartLadderStyle(style),
        }),
        face === "back" ? artShapeForBackFace(frontFace, back) : artShapeForFace(frontFace),
        { budgetMs },
      );
      if (!image.ok) return { ok: false, error: image.error, failure: image.failure };
      const saved = await persistGeneratedArt(image.bytes, image.contentType);
      if (!saved.ok) return { ok: false, error: saved.error, failure: saved.failure };
      stored.push(saved.publicUrl);
      models.push(image.model);
      return { ok: true, url: saved.publicUrl };
    };
    const discard = () => Promise.all(stored.map((url) => discardGeneratedArt(userId, url)));

    const front = await paint("front");
    if (!front.ok) return { ...failed(step, front.error), failure: front.failure, attempts: attempt };
    let backUrl: string | null = null;
    if (twoFaces) {
      const painted2 = await paint("back");
      if (!painted2.ok) {
        await discard();
        return { ...failed(step, painted2.error), failure: painted2.failure, attempts: attempt };
      }
      backUrl = painted2.url;
    }

    // The edit: the art and its fit, nothing else (a two-faced card's back
    // is resent as stored with only its art changed).
    const result = await updateCardAction(card.id, {
      art_url: front.url,
      art_position: fitArtToWindow(),
      ...(backUrl && back ? { back_face: { ...back, art_url: backUrl, art_position: fitArtToWindow() } } : {}),
    });
    if (!result.ok) {
      await discard();
      const error = result.formError ?? Object.values(result.fieldErrors ?? {})[0] ?? "The card's new art couldn't be saved.";
      return { ...failed(step, error), failure: "save_failed", attempts: attempt };
    }

    // What to keep for "Put the old art back": the picture the card had
    // before Re-art first painted it — unless the maker has given it other
    // art since, which is then the one to go back to.
    const stillOurs = Boolean(painted?.artUrl && painted.artUrl === card.art_url);
    const backStillOurs = Boolean(painted?.backArtUrl && painted.backArtUrl === (back?.art_url ?? null));
    const previous: Pick<PaintedCard, "made" | "previousArtUrl" | "previousArtPosition" | "previousBackArtUrl" | "previousBackArtPosition"> =
      painted && stillOurs
        ? painted
        : {
            made: false,
            previousArtUrl: card.art_url,
            previousArtPosition: (card.art_position ?? null) as Json | null,
            previousBackArtUrl: twoFaces ? (back?.art_url ?? null) : null,
            previousBackArtPosition: twoFaces ? ((back?.art_position ?? null) as Json | null) : null,
          };
    const recorded = await writePaintedCard(userId, plan.deck_id, jobId, {
      cardId: card.id,
      styleVersion: version,
      artUrl: front.url,
      backArtUrl: backUrl,
      made: previous.made,
      previousArtUrl: previous.previousArtUrl,
      previousArtPosition: previous.previousArtPosition,
      previousBackArtUrl: previous.previousBackArtUrl,
      previousBackArtPosition: previous.previousBackArtPosition,
    });
    // The picture this one replaced, when Re-art painted it: no card holds
    // it any more (never the maker's own earlier art, which is kept).
    if (painted && stillOurs && painted.artUrl && painted.artUrl !== previous.previousArtUrl) {
      await discardGeneratedArt(userId, painted.artUrl);
    }
    if (painted && backStillOurs && painted.backArtUrl && twoFaces && painted.backArtUrl !== previous.previousBackArtUrl) {
      await discardGeneratedArt(userId, painted.backArtUrl);
    }
    return {
      ...step,
      ...CLEARED,
      status: "done",
      error: undefined,
      card_id: card.id,
      label: card.title,
      attempts: attempt,
      image_model: [...new Set(models)].join(" + ") || null,
      note: recorded ? null : "New art saved, but its old art can't be put back from the tool.",
      ...(result.forcedPrivate ? { forced_private: result.forcedPrivate } : {}),
    };
  });
}
