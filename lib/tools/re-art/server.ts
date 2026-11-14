import "server-only";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { listDeckPageCards, type DeckItem, type DeckPageCard } from "@/lib/decks/queries";
import { checkScryfallRateLimit, logScryfallCall } from "@/lib/scryfall/rate-limit";
import { getVerifiedFrameKeys } from "@/lib/cards/frame-reviews";
import { getEntitlements } from "@/lib/billing/entitlements";
import { rowHasBakedBack } from "@/lib/cards/faces";
import { discardGeneratedArt } from "@/lib/ai/random-art";
import { isUuid } from "@/lib/ids";
import type { Json } from "@/types/supabase";
import { DEFAULT_BULK_CHOICES, type BulkChoices } from "@/lib/tools/bulk-customize/model";
import { planCustomizedCard } from "@/lib/tools/bulk-customize/planner";
import { fetchBulkPrintings, importPatchOf } from "@/lib/tools/bulk-customize/server";
import {
  REART_CHANGED_COPY,
  REART_CREDITS_PER_FACE,
  REART_MAX_CARDS,
  REART_SKIP_COPY,
  classifyReartEntry,
  cleanReartCardWords,
  normalizeReartStyle,
  sameReartStyleFields,
  reartEntryState,
  reartStateIsSettled,
  reartStyleProblem,
  sameReartStyle,
  scopeTakes,
  typeBucketOf,
  type NormalReartStyle,
  type ReartCardWords,
  type ReartEntryKind,
  type ReartScope,
  type ReartStyle,
  type ReartVisibility,
} from "@/lib/tools/re-art/model";

// ---------------------------------------------------------------------------
// Re-art deck's reads and writes (server only). Every read of the deck, its
// entries and its cards goes through the caller's OWN session (RLS: their
// deck, their cards); the tool's two tables (0191) are written with the
// service role after the caller's gate, and their triggers hold every row
// to the deck's and the card's owner.
// ---------------------------------------------------------------------------

export type ReartDeck = { id: string; slug: string; title: string; visibility: string };

/** The caller's own deck, or null. */
export async function getOwnedDeck(userId: string, deckId: string): Promise<ReartDeck | null> {
  if (!isUuid(deckId)) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("decks")
    .select("id, slug, title, visibility")
    .eq("id", deckId)
    .eq("owner_id", userId)
    .maybeSingle();
  return data ? { id: data.id, slug: data.slug, title: data.title, visibility: data.visibility } : null;
}

export type StoredReartStyle = NormalReartStyle & { version: number };

type StyleRow = { preset: string; theme: string; version: number; mode?: string | null; prompt?: string | null; owner_id?: string };

/** The style's columns; `mode` and `prompt` are 0209's. */
const STYLE_COLUMNS = "preset, theme, mode, prompt, version";
/** The same read on a database 0209 hasn't reached (a deploy that lands
 *  before its migration): every style there is the template. Remove once
 *  0209 is on production and dev. */
const STYLE_COLUMNS_BEFORE_0209 = "preset, theme, version";

const undefinedColumn = (error: { code?: string } | null | undefined) => error?.code === "42703";

function storedStyleOf(row: StyleRow): StoredReartStyle {
  return {
    ...normalizeReartStyle({
      preset: row.preset,
      theme: row.theme,
      mode: row.mode === "custom" ? "custom" : "preset",
      prompt: row.prompt ?? "",
    }),
    version: row.version,
  };
}

/** The deck's stored style (the owner's session), or null. */
export async function readDeckStyle(deckId: string): Promise<StoredReartStyle | null> {
  const supabase = await createClient();
  const read = (columns: string) => supabase.from("deck_art_styles").select(columns).eq("deck_id", deckId).maybeSingle();
  let { data, error } = await read(STYLE_COLUMNS);
  if (undefinedColumn(error)) ({ data, error } = await read(STYLE_COLUMNS_BEFORE_0209));
  return data ? storedStyleOf(data as unknown as StyleRow) : null;
}

/** The style row as the service role reads it, with its owner. */
async function readStyleRowAdmin(deckId: string): Promise<StyleRow | null> {
  const admin = createAdminClient();
  const read = (columns: string) => admin.from("deck_art_styles").select(`${columns}, owner_id`).eq("deck_id", deckId).maybeSingle();
  let { data, error } = await read(STYLE_COLUMNS);
  if (undefinedColumn(error)) ({ data, error } = await read(STYLE_COLUMNS_BEFORE_0209));
  return (data as unknown as StyleRow | null) ?? null;
}

/** The deck's style as the SERVER reads it (a step: the stored row is the
 *  authority on the version a run paints in). */
export async function readDeckStyleAdmin(userId: string, deckId: string): Promise<StoredReartStyle | null> {
  if (!isAdminConfigured()) return null;
  const row = await readStyleRowAdmin(deckId);
  if (!row || row.owner_id !== userId) return null;
  return storedStyleOf(row);
}

/**
 * The deck's style saved as `style`: the same style keeps its version; a
 * new one moves it on (a new look — cards painted in the old one are no
 * longer "in this style"). Returns the version, or null when it couldn't be
 * written.
 */
export async function saveDeckStyle(userId: string, deckId: string, style: ReartStyle): Promise<StoredReartStyle | null> {
  if (!isAdminConfigured()) return null;
  const clean = normalizeReartStyle(style);
  const stored = await readStyleRowAdmin(deckId);
  if (stored && stored.owner_id !== userId) return null;
  const before = stored ? storedStyleOf(stored) : null;
  // The same LOOK keeps its version (nothing a run paints changed). The
  // row is still written when the OTHER mode's draft changed — a prompt
  // written and then left for the template, or the other way: it was
  // dropped on a reload — and never when nothing changed at all.
  const sameLook = Boolean(before && sameReartStyle(before, clean));
  if (before && sameLook && sameReartStyleFields(before, clean)) return { ...clean, version: before.version };
  const version = before ? (sameLook ? before.version : before.version + 1) : 1;
  const { error } = await createAdminClient()
    .from("deck_art_styles")
    .upsert(
      { deck_id: deckId, owner_id: userId, preset: clean.preset, theme: clean.theme, mode: clean.mode, prompt: clean.prompt, version },
      { onConflict: "deck_id" },
    );
  if (error) {
    console.error(`[re-art] style for deck ${deckId} not saved: ${error.message}`);
    return null;
  }
  return { ...clean, version };
}

// ---------------------------------------------------------------------------
// One card's own words (0209 deck_reart_prompts), by deck entry
// ---------------------------------------------------------------------------

type WordsRow = { entry_id: string; prompt: string; only_words: boolean; owner_id?: string };

const wordsOf = (row: WordsRow): ReartCardWords => ({ text: row.prompt, only: row.only_words === true });

/** The deck's cards' own words (the owner's session), by entry id. A read
 *  that fails — the table isn't there yet — is "none". */
export async function readCardWords(deckId: string): Promise<Map<string, ReartCardWords>> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("deck_reart_prompts").select("entry_id, prompt, only_words").eq("deck_id", deckId);
  if (error || !data) return new Map();
  return new Map((data as WordsRow[]).map((row) => [row.entry_id, wordsOf(row)]));
}

/** The table isn't there: a database 0209 hasn't reached (a deploy that
 *  lands before its migration). No card has words yet. */
const missingTable = (error: { code?: string } | null | undefined) => error?.code === "42P01" || error?.code === "PGRST205";

/**
 * One entry's own words as the server reads them (a step) — FAIL CLOSED: a
 * read that didn't answer is `ok: false`, never "no words". The step then
 * stops before any charge; read as "none", a card with words of its own was
 * painted from the deck's prompt, charged, and recorded as in the style.
 */
export async function readCardWordsAdmin(
  userId: string,
  deckId: string,
  entryId: string,
): Promise<{ ok: true; words: ReartCardWords | null } | { ok: false }> {
  if (!isAdminConfigured()) return { ok: false };
  const { data, error } = await createAdminClient()
    .from("deck_reart_prompts")
    .select("entry_id, prompt, only_words, owner_id")
    .eq("deck_id", deckId)
    .eq("entry_id", entryId)
    .maybeSingle();
  if (error) return missingTable(error) ? { ok: true, words: null } : { ok: false };
  const row = data as WordsRow | null;
  return { ok: true, words: row && row.owner_id === userId ? wordsOf(row) : null };
}

/** Saves (or, `words` null, removes) one entry's own words. The trigger
 *  holds the row to the deck's owner and to an entry of that deck (0209).
 *  False when the write failed. */
export async function saveCardWords(
  userId: string,
  deckId: string,
  entryId: string,
  words: ReartCardWords | null,
): Promise<boolean> {
  if (!isAdminConfigured()) return false;
  const admin = createAdminClient();
  const text = cleanReartCardWords(words?.text);
  const { error } = text
    ? await admin
        .from("deck_reart_prompts")
        .upsert({ deck_id: deckId, entry_id: entryId, owner_id: userId, prompt: text, only_words: words?.only === true }, { onConflict: "deck_id,entry_id" })
    : await admin.from("deck_reart_prompts").delete().eq("deck_id", deckId).eq("entry_id", entryId).eq("owner_id", userId);
  if (error) console.warn(`[re-art] words for entry ${entryId} on deck ${deckId} not saved: ${error.message}`);
  return !error;
}

/** One card Re-art has painted on a deck (0191 deck_reart_cards). */
export type PaintedCard = {
  cardId: string;
  /** The entry a made card came from (null: an own card, or unknown). */
  entryId: string | null;
  styleVersion: number;
  artUrl: string | null;
  backArtUrl: string | null;
  made: boolean;
  previousArtUrl: string | null;
  previousArtPosition: Json | null;
  previousBackArtUrl: string | null;
  previousBackArtPosition: Json | null;
  previousArtistCredit: string | null;
  previousBackArtistCredit: string | null;
  paintedAt: string;
  /** The run whose step wrote the row last (null: the tool's own write —
   *  "old art back" — or a pruned run). A step that finds its OWN run's row
   *  for a picture the card doesn't show is finishing a paint that never
   *  landed (step.ts). */
  jobId: string | null;
  /** The gateway model that painted the picture(s) (0211) — one id, or two
   *  joined by " + ". Null: painted before 0211, or not known. */
  imageModel: string | null;
};

type PaintedRow = {
  card_id: string;
  entry_id: string | null;
  style_version: number;
  art_url: string | null;
  back_art_url: string | null;
  made: boolean;
  previous_art_url: string | null;
  previous_art_position: Json | null;
  previous_back_art_url: string | null;
  previous_back_art_position: Json | null;
  previous_artist_credit: string | null;
  previous_back_artist_credit: string | null;
  painted_at: string;
  job_id?: string | null;
  image_model?: string | null;
};

/** The row's columns before 0211 (which added `image_model`). */
const PAINTED_COLUMNS_BEFORE_0211 =
  "card_id, entry_id, style_version, art_url, back_art_url, made, previous_art_url, previous_art_position, previous_back_art_url, previous_back_art_position, previous_artist_credit, previous_back_artist_credit, painted_at, job_id";
const PAINTED_COLUMNS = `${PAINTED_COLUMNS_BEFORE_0211}, image_model`;

/** A column the database doesn't have yet: a select names it (42703), or a
 *  write does (PostgREST's schema cache: PGRST204). */
const unknownColumn = (error: { code?: string } | null | undefined) => error?.code === "42703" || error?.code === "PGRST204";

/**
 * A read of painted rows with 0211's column — and, on a database 0211
 * hasn't reached (a deploy that lands before its migration), the same read
 * without it: a failed read there showed every card as never painted.
 * Remove once 0211 is on production and dev.
 */
async function readPainted<T extends { data: unknown; error: { code?: string } | null }>(
  read: (columns: string) => PromiseLike<T>,
): Promise<T> {
  const first = await read(PAINTED_COLUMNS);
  return unknownColumn(first.error) ? read(PAINTED_COLUMNS_BEFORE_0211) : first;
}

function paintedOf(row: PaintedRow): PaintedCard {
  return {
    cardId: row.card_id,
    entryId: row.entry_id,
    styleVersion: row.style_version,
    artUrl: row.art_url,
    backArtUrl: row.back_art_url,
    made: row.made,
    previousArtUrl: row.previous_art_url,
    previousArtPosition: row.previous_art_position,
    previousBackArtUrl: row.previous_back_art_url,
    previousBackArtPosition: row.previous_back_art_position,
    previousArtistCredit: row.previous_artist_credit,
    previousBackArtistCredit: row.previous_back_artist_credit,
    paintedAt: row.painted_at,
    jobId: row.job_id ?? null,
    imageModel: row.image_model ?? null,
  };
}

/** The deck's painted cards (the owner's session), by card id. */
export async function readPaintedCards(deckId: string): Promise<Map<string, PaintedCard>> {
  const supabase = await createClient();
  const { data } = await readPainted((columns) => supabase.from("deck_reart_cards").select(columns).eq("deck_id", deckId));
  return new Map(((data ?? []) as unknown as PaintedRow[]).map((row) => [row.card_id, paintedOf(row)]));
}

/** One painted card as the server reads it (a step). */
export async function readPaintedCardAdmin(userId: string, deckId: string, cardId: string): Promise<PaintedCard | null> {
  if (!isAdminConfigured()) return null;
  const admin = createAdminClient();
  const { data } = await readPainted((columns) =>
    admin.from("deck_reart_cards").select(`${columns}, owner_id`).eq("deck_id", deckId).eq("card_id", cardId).maybeSingle(),
  );
  if (!data || (data as unknown as { owner_id: string }).owner_id !== userId) return null;
  return paintedOf(data as unknown as PaintedRow);
}

/** Every deck's row for one of the caller's cards (a card can be in several
 *  decks): which pictures on it are Re-art's, and what was there before. */
export async function readPaintedRowsForCardAdmin(userId: string, cardId: string): Promise<PaintedCard[]> {
  if (!isAdminConfigured()) return [];
  const admin = createAdminClient();
  const { data } = await readPainted((columns) =>
    admin.from("deck_reart_cards").select(columns).eq("card_id", cardId).eq("owner_id", userId),
  );
  return ((data ?? []) as unknown as PaintedRow[]).map(paintedOf);
}

/** The card a Re-art run MADE from this deck entry, if any (a link that
 *  didn't land is linked again, never made twice). */
export async function readMadeForEntryAdmin(userId: string, deckId: string, entryId: string): Promise<string | null> {
  if (!isAdminConfigured()) return null;
  const { data } = await createAdminClient()
    .from("deck_reart_cards")
    .select("card_id")
    .eq("deck_id", deckId)
    .eq("entry_id", entryId)
    .eq("owner_id", userId)
    .eq("made", true)
    .limit(1)
    .maybeSingle();
  return data?.card_id ?? null;
}

/** Records (or replaces) a painted card. False when the write failed. */
export async function writePaintedCard(
  userId: string,
  deckId: string,
  jobId: string | null,
  painted: Omit<PaintedCard, "paintedAt" | "jobId">,
): Promise<boolean> {
  if (!isAdminConfigured()) return false;
  const row = {
    deck_id: deckId,
    card_id: painted.cardId,
    owner_id: userId,
    style_version: painted.styleVersion,
    job_id: jobId,
    entry_id: painted.entryId,
    art_url: painted.artUrl,
    back_art_url: painted.backArtUrl,
    made: painted.made,
    previous_art_url: painted.previousArtUrl,
    previous_art_position: painted.previousArtPosition,
    previous_back_art_url: painted.previousBackArtUrl,
    previous_back_art_position: painted.previousBackArtPosition,
    previous_artist_credit: painted.previousArtistCredit,
    previous_back_artist_credit: painted.previousBackArtistCredit,
    painted_at: new Date().toISOString(),
  };
  const admin = createAdminClient();
  const write = (values: typeof row & { image_model?: string | null }) =>
    admin.from("deck_reart_cards").upsert(values, { onConflict: "deck_id,card_id" });
  // Who painted (0211) — clipped to the column's limit, never an empty
  // text. On a database 0211 hasn't reached the row is written without it
  // (the paint must still be recorded: it holds the art to put back).
  const imageModel = painted.imageModel?.trim().slice(0, 200) || null;
  let { error } = await write({ ...row, image_model: imageModel });
  if (unknownColumn(error)) ({ error } = await write(row));
  if (error) console.warn(`[re-art] painted card ${painted.cardId} on deck ${deckId} not recorded: ${error.message}`);
  return !error;
}

/**
 * A paint's row put back to what it said before the paint (the step writes
 * the row first, then edits the card: an edit that was refused must not
 * leave a row for a paint that never landed). `before` null: there was no
 * row. Best effort — a row left behind reads "has other art now", which a
 * re-roll clears.
 */
export async function revertPaintedCard(
  userId: string,
  deckId: string,
  cardId: string,
  before: PaintedCard | null,
): Promise<void> {
  if (before) {
    await writePaintedCard(userId, deckId, before.jobId, before);
    return;
  }
  if (!isAdminConfigured()) return;
  const { error } = await createAdminClient()
    .from("deck_reart_cards")
    .delete()
    .eq("deck_id", deckId)
    .eq("card_id", cardId)
    .eq("owner_id", userId);
  if (error) console.warn(`[re-art] row of an unsaved paint (card ${cardId}, deck ${deckId}) not removed: ${error.message}`);
}

/** How many card ids one read names (a deck holds up to 500 entries). */
const PICTURE_READ_CHUNK = 100;

/**
 * Every picture Re-art has on record for these cards, from ANY of the
 * caller's decks (their session: their own rows), by card id — the studio
 * says "this replaces the picture Re-art painted" for a card another deck's
 * run painted too. `complete` is false when a read failed: the studio then
 * promises nothing about a picture it couldn't ask about.
 */
export async function readReartPicturesByCard(
  cardIds: ReadonlyArray<string>,
): Promise<{ pictures: Map<string, string[]>; complete: boolean }> {
  const pictures = new Map<string, string[]>();
  const ids = [...new Set(cardIds)];
  if (ids.length === 0) return { pictures, complete: true };
  const supabase = await createClient();
  const chunks: string[][] = [];
  for (let at = 0; at < ids.length; at += PICTURE_READ_CHUNK) chunks.push(ids.slice(at, at + PICTURE_READ_CHUNK));
  const reads = await Promise.all(
    chunks.map((chunk) => supabase.from("deck_reart_cards").select("card_id, art_url").in("card_id", chunk).not("art_url", "is", null)),
  );
  let complete = true;
  for (const { data, error } of reads) {
    if (error || !data) {
      complete = false;
      continue;
    }
    for (const row of data as Array<{ card_id: string; art_url: string | null }>) {
      if (!row.art_url) continue;
      pictures.set(row.card_id, [...(pictures.get(row.card_id) ?? []), row.art_url]);
    }
  }
  return { pictures, complete };
}

// ---------------------------------------------------------------------------
// Removing a picture Re-art painted
// ---------------------------------------------------------------------------

/**
 * Whether anything of the caller's still shows, or keeps, the picture at
 * `url`: one of their cards (front or back face — a remix of their OWN card
 * shares its parent's art file, lib/cards/remix-media.ts, and a card can be
 * in several decks), or a Re-art row that holds it as the art to put back.
 *
 * Read with the service role and the owner named in every statement (as the
 * step's other reads of these rows): the caller's own read of
 * deck_reart_cards is gated on the tool being open to them (0191), and a
 * count a policy emptied would read as "nothing holds it". FAIL CLOSED:
 * no service role, an error or a count that didn't come back all answer
 * "in use" — the picture stays, and a leftover is the storage orphan
 * sweep's.
 *
 * The cards are asked BEFORE the rows, never together: a paint writes its
 * row (the art to put back) before it edits the card (step.ts), so a
 * picture another step is taking off a card is named by that card until
 * after its row names it — asked in this order, no moment misses both.
 */
async function reartArtInUse(userId: string, url: string): Promise<boolean> {
  if (!isAdminConfigured()) return true;
  const admin = createAdminClient();
  const held = (results: Array<{ count: number | null; error: unknown }>) =>
    results.some((result) => Boolean(result.error) || !Number.isFinite(result.count) || (result.count as number) > 0);
  const onCards = await Promise.all([
    admin.from("cards").select("id", { count: "exact", head: true }).eq("owner_id", userId).eq("art_url", url),
    admin
      .from("cards")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", userId)
      .filter("back_face->>art_url", "eq", url),
  ]);
  if (held(onCards)) return true;
  const kept = await Promise.all([
    admin
      .from("deck_reart_cards")
      .select("card_id", { count: "exact", head: true })
      .eq("owner_id", userId)
      .eq("previous_art_url", url),
    admin
      .from("deck_reart_cards")
      .select("card_id", { count: "exact", head: true })
      .eq("owner_id", userId)
      .eq("previous_back_art_url", url),
  ]);
  return held(kept);
}

/**
 * Removes a picture Re-art painted that the tool has just taken OFF a card
 * (a re-roll replaced it, "Put the old art back" replaced it) — only when
 * nothing else of the caller's shows or keeps it. It used to be removed
 * unasked, which left a remix of the card (the same art file) and any other
 * card holding the picture with a dead link. True when it was removed.
 * Never throws; call it AFTER the card's edit landed, so the card itself no
 * longer counts.
 */
export async function discardReartArtIfUnused(userId: string, url: string | null | undefined): Promise<boolean> {
  if (!url) return false;
  try {
    if (await reartArtInUse(userId, url)) return false;
  } catch (error) {
    console.warn("[re-art] couldn't tell whether a replaced picture is still used; keeping it:", error);
    return false;
  }
  await discardGeneratedArt(userId, url);
  return true;
}

// ---------------------------------------------------------------------------
// Planning a run
// ---------------------------------------------------------------------------

/** The Bulk Customize choices a real card of a Re-art run is made with:
 *  everything as its printing has it, new AI art (the style block is the
 *  step's own prompt), the maker's visibility. */
export function reartBulkChoices(style: ReartStyle, visibility: ReartVisibility): BulkChoices {
  return { ...DEFAULT_BULK_CHOICES, art: "ai", artStyle: normalizeReartStyle(style).preset, visibility };
}

export type ReartPlannedEntry = {
  entryId: string;
  name: string;
  kind: Exclude<ReartEntryKind, "skip">;
  credits: number;
  /** The maker's own card (kind "own"). */
  cardId: string | null;
  /** Paint it even if it is in the style already (a sample, a re-roll). */
  repaint: boolean;
  /** Re-art has painted this card on this deck before (in any style). The
   *  tool's log alone reads it: a first paint of one card is `paint_one`, a
   *  later one `reroll`. Never in the job's plan. */
  paintedBefore: boolean;
  /** The card has words of its own (0209): said in the confirm's list and
   *  counted in the tool's log. Never in the job's plan — the step reads
   *  the words themselves. */
  ownWords: boolean;
  notes: string[];
};

export type ReartPlan = {
  deck: ReartDeck;
  style: NormalReartStyle;
  /** The version the run paints in (the stored one, or the next). */
  version: number;
  styleChanged: boolean;
  entries: ReartPlannedEntry[];
  skipped: Array<{ name: string; reason: string }>;
  /** Cards left out because they are in this style already. */
  inStyle: number;
};

export type ReartPlanFailure = { ok: false; error: string; code?: "RATE_LIMITED"; retryAfterSeconds?: number };

/**
 * What a run over the deck paints, priced — the ONE plan the studio's
 * confirm (quota `deck_import`) and the start (`deck_import_commit`, which
 * decides) both read. Real cards are planned with Bulk Customize's own
 * planner on one Scryfall /cards/collection run; the maker's own cards are
 * read through their session.
 */
export async function planReartRun(
  userId: string,
  input: {
    deckId: string;
    style?: ReartStyle;
    scope: ReartScope;
    visibility: ReartVisibility;
    entryIds?: string[];
  },
  quota: "deck_import" | "deck_import_commit",
): Promise<({ ok: true } & ReartPlan) | ReartPlanFailure> {
  const deck = await getOwnedDeck(userId, input.deckId);
  if (!deck) return { ok: false, error: "That deck isn't one of yours." };
  const stored = await readDeckStyle(deck.id);
  const wanted = input.style ? normalizeReartStyle(input.style) : stored ? normalizeReartStyle(stored) : null;
  if (!wanted) return { ok: false, error: "Pick the deck's style first." };
  const problem = reartStyleProblem(wanted);
  if (problem) return { ok: false, error: problem };
  const styleChanged = !stored || !sameReartStyle(stored, wanted);
  const version = stored ? (styleChanged ? stored.version + 1 : stored.version) : 1;

  const [items, painted, words] = await Promise.all([listDeckPageCards(deck.id), readPaintedCards(deck.id), readCardWords(deck.id)]);
  const OWN_WORDS_NOTE = "Its own words.";
  const explicit = input.entryIds ? new Set(input.entryIds.map((id) => id.toLowerCase())) : null;
  const chosen: DeckItem<DeckPageCard>[] = explicit
    ? items.filter((item) => explicit.has(item.entry.id.toLowerCase()))
    : items;
  const skipped: Array<{ name: string; reason: string }> = [];
  if (explicit && chosen.length < explicit.size) {
    skipped.push({ name: "A card", reason: "Not in this deck any more." });
  }

  // Cards a run MADE from an entry whose link didn't land: the step links
  // them again (never makes them twice) — priced as what they are.
  const madeByEntry = new Map(
    [...painted.values()].filter((row) => row.made && row.entryId).map((row) => [row.entryId!, row]),
  );
  const own: ReartPlannedEntry[] = [];
  const printings: DeckItem<DeckPageCard>[] = [];
  const seenCards = new Set<string>();
  let inStyle = 0;
  for (const item of chosen) {
    const { entry, card } = item;
    const classified = classifyReartEntry({
      board: entry.board,
      cardId: entry.card_id,
      scryfallId: entry.scryfall_id,
      typeLine: entry.type_line,
      card,
      ownerId: userId,
    });
    if (classified.kind === "skip") {
      // The maybeboard is said only when the maker picked one of its cards.
      if (classified.reason !== "maybeboard" || explicit) skipped.push({ name: entry.name, reason: classified.message });
      continue;
    }
    if (!explicit && !scopeTakes(input.scope, classified.kind)) continue;
    if (classified.kind === "own" && card) {
      if (seenCards.has(card.id)) continue;
      seenCards.add(card.id);
      const done = painted.get(card.id);
      // In the style only while it still SHOWS the style's picture: a record
      // of a paint is not the paint. A run over the deck leaves a settled
      // card as it is (in the style, given its own art back, or showing
      // other art now — someone's later choice; a re-roll paints it).
      const state = reartEntryState({ painted: done, styleVersion: version, cardArtUrl: card.art_url });
      if (!explicit && !styleChanged && reartStateIsSettled(state)) {
        // A card that shows other art now is not "in this style", and the
        // run says why it leaves it (the confirm's list).
        if (state === "changed") skipped.push({ name: card.title || entry.name, reason: REART_CHANGED_COPY });
        else inStyle += 1;
        continue;
      }
      const twoFaces = rowHasBakedBack(card);
      const ownWords = words.has(entry.id);
      own.push({
        entryId: entry.id,
        name: card.title || entry.name,
        kind: "own",
        credits: REART_CREDITS_PER_FACE * (twoFaces ? 2 : 1),
        cardId: card.id,
        repaint: Boolean(explicit),
        paintedBefore: Boolean(done),
        ownWords,
        notes: [...(twoFaces ? ["Two faces: two pictures."] : []), ...(ownWords ? [OWN_WORDS_NOTE] : [])],
      });
      continue;
    }
    const made = madeByEntry.get(entry.id);
    if (made) {
      if (!explicit && !styleChanged && made.styleVersion === version && made.artUrl) {
        inStyle += 1;
        continue;
      }
      own.push({
        entryId: entry.id,
        name: entry.name,
        kind: "own",
        credits: REART_CREDITS_PER_FACE * (made.backArtUrl ? 2 : 1),
        cardId: made.cardId,
        repaint: Boolean(explicit),
        paintedBefore: true,
        ownWords: words.has(entry.id),
        notes: ["Made by an earlier run — linked to its entry again.", ...(words.has(entry.id) ? [OWN_WORDS_NOTE] : [])],
      });
      continue;
    }
    printings.push(item);
  }

  const planned: ReartPlannedEntry[] = [];
  if (printings.length > 0) {
    const limit = await checkScryfallRateLimit(userId, quota);
    if (!limit.ok) return { ok: false, error: limit.message, code: "RATE_LIMITED", retryAfterSeconds: limit.retryAfterSeconds };
    await logScryfallCall(userId, quota);
    const fetched = await fetchBulkPrintings(printings.map((item) => item.entry.scryfall_id!));
    if (!fetched) return { ok: false, error: "Scryfall didn't answer — try again in a moment." };
    const verifiedKeys = new Set(await getVerifiedFrameKeys());
    const entitlements = await getEntitlements();
    const choices = reartBulkChoices(wanted, input.visibility);
    for (const item of printings) {
      const { entry } = item;
      const card = fetched.get(entry.scryfall_id!.toLowerCase());
      if (!card) {
        skipped.push({ name: entry.name, reason: "Scryfall doesn't know this printing." });
        continue;
      }
      const plan = planCustomizedCard({
        patch: await importPatchOf(card, verifiedKeys),
        fallbackTitle: entry.name || card.name,
        scryfallSet: card.set ?? null,
        choices,
        verifiedKeys,
        removeWatermark: entitlements.removeWatermark,
      });
      if (!plan.ok) {
        skipped.push({ name: plan.title, reason: plan.message });
        continue;
      }
      if (plan.payload.card_type === "emblem") {
        skipped.push({ name: plan.title, reason: REART_SKIP_COPY.emblem });
        continue;
      }
      planned.push({
        entryId: entry.id,
        name: plan.title,
        kind: "printing",
        credits: plan.credits,
        cardId: null,
        repaint: Boolean(explicit),
        paintedBefore: false,
        ownWords: words.has(entry.id),
        notes: [...(plan.doubleFaced ? ["Two faces: two pictures."] : []), ...(words.has(entry.id) ? [OWN_WORDS_NOTE] : [])],
      });
    }
  }

  // The deck's order: the commander first as the deck lists it.
  const order = new Map(chosen.map((item, index) => [item.entry.id, index]));
  let entries = [...own, ...planned].sort((a, b) => (order.get(a.entryId) ?? 0) - (order.get(b.entryId) ?? 0));
  if (entries.length > REART_MAX_CARDS) {
    skipped.push({
      name: `${entries.length - REART_MAX_CARDS} more cards`,
      reason: `One run paints up to ${REART_MAX_CARDS} cards — run it again for the rest.`,
    });
    entries = entries.slice(0, REART_MAX_CARDS);
  }
  return { ok: true, deck, style: wanted, version, styleChanged, entries, skipped, inStyle };
}

// ---------------------------------------------------------------------------
// The studio's reads
// ---------------------------------------------------------------------------

/** A past or paused run of the deck: when, how many cards, how many landed. */
export type ReartRun = {
  id: string;
  deckId: string | null;
  createdAt: string;
  cards: number;
  made: number;
  failed: number;
  waiting: number;
  sample: boolean;
  status: string;
};

type JobRowLite = { id: string; created_at: string; steps: unknown; request: unknown; status: string };

function runOf(row: JobRowLite): ReartRun {
  const steps = Array.isArray(row.steps) ? (row.steps as Array<{ status?: unknown }>) : [];
  const request = (row.request ?? {}) as { deck_id?: unknown; sample?: unknown };
  return {
    id: row.id,
    deckId: typeof request.deck_id === "string" ? request.deck_id : null,
    createdAt: row.created_at,
    cards: steps.length,
    made: steps.filter((step) => step?.status === "done").length,
    failed: steps.filter((step) => step?.status === "failed").length,
    waiting: steps.filter((step) => step?.status === "pending" || step?.status === "running").length,
    sample: request.sample === true,
    status: row.status,
  };
}

/** The caller's recent runs — of one deck, or of every deck (the tool
 *  page). Their own job rows, through their session; never the plan. */
export async function listReartRuns(userId: string, deckId: string | null, limit = 8): Promise<ReartRun[]> {
  const supabase = await createClient();
  let query = supabase
    .from("ai_generation_jobs")
    .select("id, created_at, steps, request, status")
    .eq("owner_id", userId)
    .eq("kind", "deck_reart");
  if (deckId) query = query.filter("request->>deck_id", "eq", deckId);
  const { data } = await query.order("created_at", { ascending: false }).limit(limit);
  return ((data ?? []) as JobRowLite[]).map(runOf);
}

/** A planned entry's words for the studio's confirm list. */
export type ReartPlanLine = Pick<ReartPlannedEntry, "entryId" | "name" | "kind" | "credits" | "notes">;

export function planLines(plan: ReartPlan): ReartPlanLine[] {
  return plan.entries.map(({ entryId, name, kind, credits, notes }) => ({ entryId, name, kind, credits, notes }));
}

/** A type bucket for the studio's sample, from what the entry knows. */
export function bucketOfItem(item: DeckItem<DeckPageCard>): string {
  return typeBucketOf(item.entry.type_line, item.card?.card_type ?? null);
}
