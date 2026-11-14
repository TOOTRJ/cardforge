import "server-only";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { updateCardAction } from "@/lib/cards/actions";
import { fitArtToWindow } from "@/lib/cards/art-fit";
import { rowHasBakedBack } from "@/lib/cards/faces";
import { buildTypeLine } from "@/lib/cards/card-display";
import { withCreditedStep } from "@/lib/ai/credited-step";
import { logAiCall } from "@/lib/ai/rate-limit";
import { generateImageWithFallbacks, restyleWithFallbacks, type RestyleSource } from "@/lib/ai/image-gen";
import { discardGeneratedArt, persistGeneratedArt } from "@/lib/ai/random-art";
import { artPromptLadder, exactArtPromptLadder } from "@/lib/ai/art-prompt-safety";
import { artShapeForBackFace, artShapeForFace, type ArtFace } from "@/lib/ai/art-aspect";
import type { AiFailureKind } from "@/lib/ai/failure";
import type { JobStep } from "@/lib/ai/generation-jobs";
import { checkToolAccess } from "@/lib/tools/queries";
import { getCardById } from "@/lib/scryfall/client";
import { checkScryfallRateLimit, logScryfallCall } from "@/lib/scryfall/rate-limit";
import { fetchScryfallArtCrop } from "@/lib/scryfall/art-crop";
import { fetchStoredArt } from "@/lib/tools/re-art/restyle-source";
import { customizeSourceStep, type BulkStepDeps } from "@/lib/tools/bulk-customize/step";
import type { BulkCardPayload } from "@/lib/tools/bulk-customize/planner";
import type { CardBackFace, CardType, ColorIdentity } from "@/types/card";
import type { Json } from "@/types/supabase";
import {
  REART_CREDITS_PER_FACE,
  REART_DEFAULT_MODEL,
  REART_DEFAULT_METHOD,
  REART_MAX_CARDS,
  REART_METHODS,
  REART_MODEL_IDS,
  REART_MODEL_NOT_YOURS,
  REART_NO_ART_COPY,
  REART_SKIP_COPY,
  REART_TOOL_SLUG,
  REART_VISIBILITY_VALUES,
  canPickReartModel,
  reartArtPrompt,
  reartEntryState,
  reartGatewayModel,
  reartWordingOf,
  reartPromptIsMakers,
  reartLadderStyle,
  reartStateIsSettled,
  reartStepKey,
  reartStyleSchema,
  sameReartStyle,
  withBackArt,
  type ReartCardWords,
  type ReartFraming,
  type ReartMethod,
  type ReartStyle,
} from "@/lib/tools/re-art/model";
import {
  discardReartArtIfUnused,
  readCardWordsAdmin,
  readDeckStyleAdmin,
  readMadeForEntryAdmin,
  readPaintedCardAdmin,
  readPaintedRowsForCardAdmin,
  reartBulkChoices,
  revertPaintedCard,
  writePaintedCard,
  type PaintedCard,
} from "@/lib/tools/re-art/server";
import { linkDeckCardAction } from "@/lib/decks/card-actions";
import { backFaceSchema } from "@/lib/validation/card";

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
    /** The model that paints the run (0211) — one of the tool's own list,
     *  whoever wrote the plan. Absent (a run started before it): Automatic. */
    model: z.enum(REART_MODEL_IDS).default(REART_DEFAULT_MODEL),
    /** What each picture starts from (0212). Absent (a run started before
     *  it): the prompt alone. */
    method: z.enum(REART_METHODS).default(REART_DEFAULT_METHOD),
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
  artist_credit: string | null;
  frame_style: unknown;
  back_face: unknown;
  art_url: string | null;
  art_position: unknown;
};

const OWN_CARD_COLUMNS =
  "id, owner_id, title, card_type, supertype, subtypes, cost, color_identity, rules_text, flavor_text, artist_credit, frame_style, back_face, art_url, art_position";

/** The model a run names, as its step paints with it: the gateway id
 *  (undefined: the image door's default and backup), the wording it is sent
 *  and the most of a prompt's body it reads. */
type StepModel = { gateway: string | undefined; framing: ReartFraming; bodyMax: number; method: ReartMethod };

/** A card's own words are its FRONT's picture: a back face is painted from
 *  the deck's prompt alone. */
const wordsFor = (face: "front" | "back", words: ReartCardWords | null) => (face === "front" ? words : null);

/** The prompt of a real card's picture: the card's own subject (or its own
 *  words), in the deck's style or the maker's own deck prompt. `exact`: the
 *  prompt is the maker's, and is never swapped for a generic one. */
function payloadPrompt(
  payload: BulkCardPayload,
  face: "front" | "back",
  style: ReartStyle,
  words: ReartCardWords | null,
  model: StepModel,
) {
  const back = face === "back" ? payload.back_face : undefined;
  const typeLine = buildTypeLine({
    cardType: (back?.card_type ?? payload.card_type) as CardType | undefined,
    supertype: back ? (back.supertype ?? null) : (payload.supertype ?? null),
    subtypes: back ? (back.subtypes ?? []) : payload.subtypes,
  });
  const own = wordsFor(face, words);
  return {
    style: reartLadderStyle(style),
    exact: promptIsExact(style, own, model.framing),
    prompt: reartArtPrompt(
      {
        title: back?.title ?? payload.title,
        typeLine,
        rulesText: back ? back.rules_text : payload.rules_text,
        flavorText: back ? back.flavor_text : payload.flavor_text,
      },
      style,
      own,
      model.framing,
      model.bodyMax,
      model.method,
    ),
  };
}

/**
 * The prompt is never swapped for the safety ladder's generic third rung:
 * the maker wrote it — or it is in the PLAIN wording a named model other
 * than FLUX.2 is sent (that rung is FLUX.2's wording, "trading-card
 * illustration evoking “Name”…", which made those models paint a card
 * frame with the title in it). Refused twice, the step fails and is
 * refunded.
 */
function promptIsExact(style: ReartStyle, words: ReartCardWords | null, framing: ReartFraming): boolean {
  // (A restyle is always in the plain wording: reartWordingOf.)
  return reartPromptIsMakers(style, words) || framing === "plain";
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
  // Naming the model — or what a picture starts from — is for admins and
  // testers: the plan is its owner's to write, so the step asks again,
  // before any read or charge.
  if ((plan.model !== REART_DEFAULT_MODEL || plan.method !== REART_DEFAULT_METHOD) && !canPickReartModel(access)) {
    return failed(step, REART_MODEL_NOT_YOURS);
  }

  // The deck's stored style is the authority: a run priced in a style the
  // deck no longer has stops here, before any charge.
  const stored = await readDeckStyleAdmin(userId, plan.deck_id);
  if (!stored || stored.version !== plan.style.version || !sameReartStyle(stored, plan.style)) {
    return failed(step, REART_STYLE_CHANGED);
  }
  const style: ReartStyle = { preset: stored.preset, theme: stored.theme, mode: stored.mode, prompt: stored.prompt };
  // The model the run names (the plan's schema holds it to the tool's own
  // list): painted with alone, in the wording that model takes.
  const model: StepModel = { gateway: reartGatewayModel(plan.model), ...reartWordingOf(plan.model, plan.method), method: plan.method };

  // The entry, from the caller's OWN deck again. The deck is embedded by
  // its foreign key's NAME: unnamed, the API refuses the read the day
  // another table links decks and deck_cards (PGRST201 — 0209 did, and
  // every card was told it had left its deck; deck-entry-embeds.test.ts).
  const supabase = await createClient();
  const { data: entry, error: entryError } = await supabase
    .from("deck_cards")
    .select("id, name, board, card_id, scryfall_id, decks!deck_cards_deck_id_fkey!inner(owner_id)")
    .eq("id", planned.entry_id)
    .eq("deck_id", plan.deck_id)
    .eq("decks.owner_id", userId)
    .maybeSingle();
  // A read that FAILED is never "the card is gone": said as it is, logged,
  // and nothing is charged.
  if (entryError) {
    console.error(`[re-art] deck entry ${planned.entry_id} not read: ${entryError.code ?? ""} ${entryError.message}`);
    return failed(step, "We couldn't read this card's deck entry — try it again.");
  }
  if (!entry) return failed(step, "This card is no longer in your deck.");
  if (entry.board === "maybe") return failed(step, REART_SKIP_COPY.maybeboard);
  // The card's own words (0209), read here: the plan is the owner's to
  // insert, so it names the entry and never the words. A read that didn't
  // answer stops the step before any charge — never "no words".
  const wordsRead = await readCardWordsAdmin(userId, plan.deck_id, entry.id);
  if (!wordsRead.ok) return failed(step, "This card's own words couldn't be read — try it again.");
  const words = wordsRead.words;

  let cardId = entry.card_id;
  // A real card a Re-art run already MADE from this entry whose link didn't
  // land (or that the maker unlinked since): linked again, never made (or
  // charged) a second time.
  if (!cardId) {
    const made = await readMadeForEntryAdmin(userId, plan.deck_id, entry.id);
    if (made) {
      const linked = await linkDeckCardAction(entry.id, made, { surface: "deck" });
      if (!linked.ok) return failed(step, "This card was made earlier but couldn't be linked to its entry — link it from the deck page.");
      cardId = made;
    }
  }

  // An entry that is (now) linked to a card: the own-card path — a real
  // card another run already made lands here too, and is found in style.
  if (cardId) {
    return paintOwnCard(userId, jobId, step, plan, style, stored.version, cardId, entry.scryfall_id, planned.repaint, words, model, deps);
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
      imageModel: model.gateway,
      restyle: model.method === "restyle",
      artPrompt: (payload, face) => payloadPrompt(payload, face, style, words, model),
      refusePlanned: (payload) => (payload.card_type === "emblem" ? REART_SKIP_COPY.emblem : null),
      onSaved: async (newCardId, art, models) => {
        const recorded = await writePaintedCard(userId, plan.deck_id, jobId, {
          cardId: newCardId,
          entryId: entry.id,
          styleVersion: stored.version,
          artUrl: art.front,
          backArtUrl: art.back,
          imageModel: models.join(" + ") || null,
          method: model.method,
          made: true,
          previousArtUrl: null,
          previousArtPosition: null,
          previousBackArtUrl: null,
          previousBackArtPosition: null,
          previousArtistCredit: null,
          previousBackArtistCredit: null,
        });
        return recorded ? null : "Saved, but the tool may offer to paint it again.";
      },
    },
    deps,
  );
}

type Previous = Pick<
  PaintedCard,
  | "made"
  | "previousArtUrl"
  | "previousArtPosition"
  | "previousBackArtUrl"
  | "previousBackArtPosition"
  | "previousArtistCredit"
  | "previousBackArtistCredit"
>;

/** How long a step waits when Scryfall's per-minute limit gives no number. */
const SCRYFALL_WAIT_FALLBACK_S = 20;

/**
 * The picture(s) a restyle of the maker's own card starts from, read before
 * anything is reserved:
 *
 *   * the entry stands for a printing → the REAL card's art, read from
 *     Scryfall on the caller's own quota (the lookup, then its art);
 *   * else the art the card had BEFORE Re-art (`previous`: what "old art
 *     back" would put back — never a picture Re-art painted, or a re-roll
 *     would restyle a restyle), from the app's own storage.
 *
 * A spent minute puts the step back in line (the runner waits); a card with
 * nothing to start from fails here, and nothing is charged.
 */
async function restyleSourcesFor(
  userId: string,
  step: JobStep,
  entryScryfallId: string | null,
  twoFaces: boolean,
  previous: Previous,
): Promise<{ ok: true; sources: { front: RestyleSource; back?: RestyleSource } } | { ok: false; step: JobStep }> {
  const stop = (error: string) => ({ ok: false as const, step: failed(step, error) });
  if (entryScryfallId) {
    const wait = (seconds: number | undefined) => ({
      ok: false as const,
      step: {
        ...step,
        ...CLEARED,
        status: "pending" as const,
        error: undefined,
        error_code: "RATE_LIMITED" as const,
        retry_after_seconds: Math.max(1, Math.min(120, Math.round(seconds || SCRYFALL_WAIT_FALLBACK_S))),
      },
    });
    for (const label of ["named", "restyle_art"] as const) {
      const quota = await checkScryfallRateLimit(userId, label);
      if (!quota.ok) return quota.reason === "per_day" ? stop(quota.message) : wait(quota.retryAfterSeconds);
    }
    await logScryfallCall(userId, "named");
    const printing = await getCardById(entryScryfallId);
    if (!printing) return stop("Scryfall didn't answer for this card — try it again.");
    const front = await fetchScryfallArtCrop(userId, printing, "front");
    if (!front.ok) return stop(front.error);
    if (!twoFaces) return { ok: true, sources: { front: { bytes: front.bytes, contentType: front.contentType } } };
    const back = await fetchScryfallArtCrop(userId, printing, "back");
    if (!back.ok) return stop("This card has two faces, and its printing has no art for the back to restyle.");
    return {
      ok: true,
      sources: {
        front: { bytes: front.bytes, contentType: front.contentType },
        back: { bytes: back.bytes, contentType: back.contentType },
      },
    };
  }
  const front = await fetchStoredArt(previous.previousArtUrl);
  if (!front) return stop(REART_NO_ART_COPY);
  if (!twoFaces) return { ok: true, sources: { front } };
  const back = await fetchStoredArt(previous.previousBackArtUrl);
  if (!back) return stop("This card's back has no art of its own to restyle — paint it from the prompt instead.");
  return { ok: true, sources: { front, back } };
}

/**
 * The maker's own card gets its new picture: an edit of its ART — the
 * picture, its fit and the artist credit that goes with it (the AI's, as
 * every AI picture's) — and nothing else.
 */
async function paintOwnCard(
  userId: string,
  jobId: string,
  step: JobStep,
  plan: ReartJobPlan,
  style: ReartStyle,
  version: number,
  cardId: string,
  /** The printing the card's entry stands for, if any (a restyle starts
   *  from its art). */
  entryScryfallId: string | null,
  repaint: boolean,
  words: ReartCardWords | null,
  model: StepModel,
  deps: BulkStepDeps,
): Promise<JobStep> {
  const supabase = await createClient();
  const { data } = await supabase.from("cards").select(OWN_CARD_COLUMNS).eq("id", cardId).maybeSingle();
  const card = data as OwnCard | null;
  // Another creator's card is never edited (it is theirs); a card the
  // caller can't read is gone for them.
  if (!card) return failed(step, REART_SKIP_COPY.gone);
  if (card.owner_id !== userId) return failed(step, REART_SKIP_COPY.other_creator);
  if (card.card_type === "emblem") return failed(step, REART_SKIP_COPY.emblem);

  const painted = await readPaintedCardAdmin(userId, plan.deck_id, card.id);
  // The plan's own answer (planReartRun), asked again now: a card painted
  // in this style since the plan — by another run, and whatever happened to
  // its art after — is left as it is, with nothing charged, unless the plan
  // named it to be painted again (a sample, a re-roll).
  const state = reartEntryState({ painted, styleVersion: version, cardArtUrl: card.art_url });
  // THIS run's own row for a picture the card doesn't show: an earlier try
  // of this step wrote the row (it is written before the card's edit) and
  // never reached the edit — the function was killed. That is a paint to
  // finish, not a card someone gave other art; left as "settled" it was
  // reported done with the card never painted.
  const unfinished = state === "changed" && Boolean(painted?.jobId) && painted?.jobId === jobId;
  if (!repaint && reartStateIsSettled(state) && !unfinished) {
    return {
      ...step,
      ...CLEARED,
      status: "done",
      error: undefined,
      card_id: card.id,
      label: card.title,
      note:
        state === "in_style"
          ? "Already in this style — nothing was charged."
          : state === "kept"
            ? "It keeps its own art — nothing was charged."
            : "It has other art now and was left as it is — nothing was charged.",
    };
  }

  const back = (card.back_face ?? null) as CardBackFace | null;
  const twoFaces = Boolean(back) && rowHasBakedBack({ frame_style: card.frame_style, back_face: card.back_face });
  // The back is resent as stored with its art changed: a stored back the
  // card action would refuse today is found BEFORE anything is paid for.
  if (twoFaces && !backFaceSchema.safeParse(back).success) {
    return failed(step, "This card's back face needs a fix in its editor before it can be re-arted.");
  }
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

  // What "Put the old art back" goes back to. A card can be in several
  // decks: when the picture on it now is one Re-art painted (from ANY
  // deck), the art before Re-art is that row's previous — never the AI
  // picture, and never lost (an unreferenced original would be swept).
  // Otherwise the maker's current art is the one to keep.
  const rows = await readPaintedRowsForCardAdmin(userId, card.id);
  const source = card.art_url ? rows.find((row) => row.artUrl && row.artUrl === card.art_url) : undefined;
  const previous: Previous = source
    ? {
        made: source.made,
        previousArtUrl: source.previousArtUrl,
        previousArtPosition: source.previousArtPosition,
        previousBackArtUrl: source.previousBackArtUrl,
        previousBackArtPosition: source.previousBackArtPosition,
        previousArtistCredit: source.previousArtistCredit,
        previousBackArtistCredit: source.previousBackArtistCredit,
      }
    : {
        made: false,
        previousArtUrl: card.art_url,
        previousArtPosition: (card.art_position ?? null) as Json | null,
        previousBackArtUrl: twoFaces ? (back?.art_url ?? null) : null,
        previousBackArtPosition: twoFaces ? ((back?.art_position ?? null) as Json | null) : null,
        previousArtistCredit: card.artist_credit ?? null,
        previousBackArtistCredit: twoFaces ? (back?.artist_credit ?? null) : null,
      };

  // A restyle's pictures to start from, read BEFORE anything is reserved: a
  // card with none is told so, and nothing is charged.
  let sources: { front?: RestyleSource; back?: RestyleSource } = {};
  if (model.method === "restyle") {
    const found = await restyleSourcesFor(userId, step, entryScryfallId, twoFaces, previous);
    if (!found.ok) return found.step;
    sources = found.sources;
  }
  // Said on the finished step: which picture it started from.
  const startedFrom =
    model.method === "restyle" ? (entryScryfallId ? "Restyled from the real card's art." : "Restyled from the art it had before Re-art.") : null;

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
      const own = wordsFor(face, words);
      const prompt = reartArtPrompt(
        {
          title,
          typeLine,
          rulesText: onBack ? back.rules_text : card.rules_text,
          flavorText: onBack ? back.flavor_text : card.flavor_text,
        },
        style,
        own,
        model.framing,
        model.bodyMax,
        model.method,
      );
      await logAiCall(userId, "deck_reart_art");
      const shape = face === "back" ? artShapeForBackFace(frontFace, back) : artShapeForFace(frontFace);
      const from = sources[face];
      const image = from
        ? // The card's own art, repainted: the prompt as written.
          await restyleWithFallbacks(exactArtPromptLadder(prompt), from, shape, { budgetMs, model: model.gateway })
        : await generateImageWithFallbacks(
            // The maker's own words — and a prompt in the plain wording — are
            // never swapped for a picture built from the card's name: refused
            // twice, the step fails and is refunded.
            promptIsExact(style, own, model.framing)
              ? exactArtPromptLadder(prompt)
              : artPromptLadder(attempt, prompt, {
                  title,
                  colors: (card.color_identity ?? []) as ColorIdentity[],
                  style: reartLadderStyle(style),
                }),
            shape,
            { budgetMs, model: model.gateway },
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
      const paintedBack = await paint("back");
      if (!paintedBack.ok) {
        await discard();
        return { ...failed(step, paintedBack.error), failure: paintedBack.failure, attempts: attempt };
      }
      backUrl = paintedBack.url;
    }

    // The row FIRST, then the card's edit: the row names the art the card
    // shows now as the art to put back, and that picture must be named
    // there before the card stops showing it. A run paints two cards at a
    // time, and another step's guarded discard (discardReartArtIfUnused: it
    // asks the cards, then the rows) would otherwise find a picture nothing
    // names in the moment between the two writes — a remix shares its
    // parent's art file.
    const recorded = await writePaintedCard(userId, plan.deck_id, jobId, {
      cardId: card.id,
      entryId: painted?.entryId ?? null,
      styleVersion: version,
      artUrl: front.url,
      backArtUrl: backUrl,
      imageModel: [...new Set(models)].join(" + ") || null,
      method: model.method,
      ...previous,
    });

    // The edit: the art, its fit and the AI's credit — nothing else (a
    // two-faced card's back is resent as stored with only those changed).
    const aiCredit = await deps.artistCredit();
    // The paint never landed: its pictures go, and its row says what it
    // said before (a row left for a picture the card doesn't show reads
    // "has other art now").
    const undo = async () => {
      await discard();
      if (recorded) await revertPaintedCard(userId, plan.deck_id, card.id, painted);
    };
    let result: Awaited<ReturnType<typeof updateCardAction>>;
    try {
      result = await updateCardAction(card.id, {
        art_url: front.url,
        art_position: fitArtToWindow(),
        artist_credit: aiCredit ?? null,
        ...(backUrl && back
          ? { back_face: withBackArt(back, backUrl, fitArtToWindow() as unknown as Json, aiCredit ?? null) }
          : {}),
      });
    } catch (error) {
      // A throw is a failed step too (the credit wrapper refunds and the
      // step door reports it): undone the same way, then handed on.
      await undo().catch(() => undefined);
      throw error;
    }
    if (!result.ok) {
      await undo();
      const error = result.formError ?? Object.values(result.fieldErrors ?? {})[0] ?? "The card's new art couldn't be saved.";
      return { ...failed(step, error), failure: "save_failed", attempts: attempt };
    }
    // The picture(s) of the try that never landed: no card ever showed them.
    if (unfinished) {
      await discardReartArtIfUnused(userId, painted?.artUrl);
      await discardReartArtIfUnused(userId, painted?.backArtUrl);
    }
    // The picture(s) this one replaced, when Re-art painted them: removed
    // once nothing else shows them (never the maker's own earlier art,
    // which is kept — and never a picture another card of theirs still
    // holds: a remix of this card shares its art file).
    if (source?.artUrl && source.artUrl !== previous.previousArtUrl) {
      await discardReartArtIfUnused(userId, source.artUrl);
    }
    const replacedBack = twoFaces ? (back?.art_url ?? null) : null;
    if (replacedBack && rows.some((row) => row.backArtUrl === replacedBack) && replacedBack !== previous.previousBackArtUrl) {
      await discardReartArtIfUnused(userId, replacedBack);
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
      note: [startedFrom, recorded ? null : "New art saved, but its old art can't be put back from the tool."].filter(Boolean).join(" ") || null,
      ...(result.forcedPrivate ? { forced_private: result.forcedPrivate } : {}),
    };
  });
}
