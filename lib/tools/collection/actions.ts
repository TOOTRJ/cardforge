"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/ids";
import { getCardById } from "@/lib/scryfall/client";
import { checkScryfallRateLimit, logScryfallCall } from "@/lib/scryfall/rate-limit";
import { createDeckAction } from "@/lib/decks/actions";
import { commitImportLines } from "@/lib/decks/import-commit";
import { checkToolAccess } from "@/lib/tools/queries";
import { recordToolEventLater } from "@/lib/tools/events";
import { toolHref } from "@/lib/tools/catalog";
import { collectionRowFor } from "./card-row";
import {
  cardKey,
  commanderReason,
  draftCommanderDeck,
  DEFAULT_BASIC_PRINTINGS,
  BASIC_FOR_COLOR,
  ineligibleReason,
  isBasicLand,
  type CommanderDraft,
} from "./builder";
import { COLLECTION_TOOL_SLUG, COMMANDER_DECK_SIZE } from "./limits";
import type { ImportProblem } from "./parse-import";
import { finishFor } from "./resolve";
import {
  addCardSchema,
  clearCollectionSchema,
  draftSchema,
  finishImportSchema,
  importChunkSchema,
  removeCardSchema,
  saveDeckSchema,
  updateQuantitySchema,
} from "./schemas";
import { COLLECTION_FULL_MESSAGE, resolveImportLines, ScryfallUnavailableError, writeCollectionRows } from "./server";
import { getCollectionCard, listBuilderPool, listCollectionCardsById } from "./queries";
import { choiceError, deckTypeKeyFor, draftPlanFor } from "./archetypes";
import { getBracketCards } from "./bracket-cards";

// ---------------------------------------------------------------------------
// The Collection Deck Builder's server actions (migration 0185). Every one
// starts with the tool's gate (`checkToolAccess`: admins and testers while
// in beta, a plan once an admin releases it) and records what matters with
// `recordToolEventLater` (after the response, never awaited): a success
// under the action's name, a refusal under `<name>_failed` with a `reason`
// code — counts and codes only, never a card's or a deck's name. The
// collection's rows are the caller's own (RLS, gated by has_tool_access in
// SQL as well).
// ---------------------------------------------------------------------------

const PAGE = toolHref(COLLECTION_TOOL_SLUG);
const NO_ACCESS = "The Collection Deck Builder isn't open to you.";

type Fail = { ok: false; error: string; retryAfterSeconds?: number };

async function gate() {
  return checkToolAccess(COLLECTION_TOOL_SLUG);
}

type Access = NonNullable<Awaited<ReturnType<typeof gate>>>;

/** One tool event of the viewer the gate let in, after the response. */
function record(access: Access, event: string, props: Record<string, string | number | boolean | null> = {}): void {
  recordToolEventLater({ slug: COLLECTION_TOOL_SLUG, userId: access.userId, event, access: access.via, props });
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

export type ImportChunkResult =
  | { ok: true; added: number; updated: number; matched: number; unmatched: ImportProblem[]; full: boolean }
  | Fail;

/** One chunk of an import: resolved through Scryfall, written as it lands
 *  (the good rows now, the rest listed with why — never all-or-nothing). */
export async function importCollectionChunkAction(payload: unknown): Promise<ImportChunkResult> {
  const access = await gate();
  if (!access) return { ok: false, error: NO_ACCESS };
  const parsed = importChunkSchema.safeParse(payload);
  if (!parsed.success) {
    record(access, "import_failed", { reason: "invalid" });
    return { ok: false, error: "Those lines couldn't be read. Reload the page and try again." };
  }
  // Where in the import this chunk is (its index, its size) — with every
  // failure, so a stop can be read from the log.
  const at = { mode: parsed.data.mode, chunk: parsed.data.chunk, lines: parsed.data.lines.length };

  const rate = await checkScryfallRateLimit(access.userId, "collection_import");
  if (!rate.ok) {
    record(access, "import_failed", { reason: "rate_limited", ...at });
    return { ok: false, error: rate.message, retryAfterSeconds: rate.retryAfterSeconds };
  }
  await logScryfallCall(access.userId, "collection_import");

  let resolved;
  try {
    resolved = await resolveImportLines(parsed.data.lines);
  } catch (error) {
    if (error instanceof ScryfallUnavailableError) {
      record(access, "import_failed", { reason: "scryfall_unavailable", ...at });
      return { ok: false, error: "Scryfall didn't respond — this part wasn't added. Try again in a moment.", retryAfterSeconds: 5 };
    }
    throw error;
  }

  const write = await writeCollectionRows(resolved.rows, {
    batchId: parsed.data.batchId,
    mode: parsed.data.mode,
    chunk: parsed.data.chunk,
  });
  if (!write.ok) {
    record(access, "import_failed", { reason: "write_failed", ...at });
    return { ok: false, error: write.error };
  }
  // The first chunk in = an import under way (its end is `import`, recorded
  // by the finish action); a full collection is where one stops.
  if (at.chunk === 0) record(access, "import_started", { mode: at.mode, chunk_lines: at.lines });
  if (write.overCap.length > 0) {
    record(access, "import_failed", { reason: "collection_full", ...at, over_cap: write.overCap.length });
  }
  const overCap: ImportProblem[] = write.overCap.map(({ line }) => ({
    line: line?.line ?? 0,
    raw: line?.raw ?? "",
    reason: COLLECTION_FULL_MESSAGE,
  }));
  return {
    ok: true,
    added: write.added,
    updated: write.updated,
    matched: resolved.rows.length - write.overCap.length,
    unmatched: [...resolved.unmatched, ...overCap],
    full: write.overCap.length > 0,
  };
}

export type FinishImportResult = { ok: true; removed: number } | Fail;

/** After the last chunk: a COMPLETE "replace" import removes every row it
 *  didn't write (only once it wrote at least one — an import that matched
 *  nothing never empties a collection; one cut short by the cap removes
 *  nothing), and the import is recorded. */
export async function finishCollectionImportAction(payload: unknown): Promise<FinishImportResult> {
  const access = await gate();
  if (!access) return { ok: false, error: NO_ACCESS };
  const parsed = finishImportSchema.safeParse(payload);
  if (!parsed.success) {
    record(access, "import_failed", { reason: "invalid_finish" });
    return { ok: false, error: "That import couldn't be finished." };
  }
  const { batchId, mode, complete } = parsed.data;
  let removed = 0;
  if (mode === "replace" && complete) {
    const supabase = await createClient();
    const { count: written } = await supabase
      .from("collection_cards")
      .select("id", { count: "exact", head: true })
      .eq("import_batch", batchId);
    if ((written ?? 0) > 0) {
      const { error, count } = await supabase
        .from("collection_cards")
        .delete({ count: "exact" })
        .or(`import_batch.is.null,import_batch.neq.${batchId}`);
      if (error) {
        console.error("[collection] replace sweep failed:", error.message);
        record(access, "import_failed", { reason: "replace_sweep_failed", mode, lines: parsed.data.lines });
        return { ok: false, error: "The new cards are in, but the old ones couldn't be removed. Try the import again." };
      }
      removed = count ?? 0;
    }
  }
  record(access, "import", {
    format: parsed.data.format,
    mode,
    lines: parsed.data.lines,
    matched: parsed.data.matched,
    unmatched: parsed.data.unmatched,
    removed,
  });
  revalidatePath(PAGE);
  return { ok: true, removed };
}

// ---------------------------------------------------------------------------
// One card at a time
// ---------------------------------------------------------------------------

export type AddCardResult = { ok: true; name: string; owned: number } | Fail;

/** Add one printing (the search box, or the creator's exact-copy notice). */
export async function addToCollectionAction(payload: unknown): Promise<AddCardResult> {
  const access = await gate();
  if (!access) return { ok: false, error: NO_ACCESS };
  const parsed = addCardSchema.safeParse(payload);
  if (!parsed.success) {
    record(access, "add_card_failed", { reason: "invalid" });
    return { ok: false, error: "That card couldn't be added." };
  }
  const refused = (reason: string) =>
    record(access, "add_card_failed", { reason, surface: parsed.data.surface, quantity: parsed.data.quantity });

  const rate = await checkScryfallRateLimit(access.userId, "named");
  if (!rate.ok) {
    refused("rate_limited");
    return { ok: false, error: rate.message, retryAfterSeconds: rate.retryAfterSeconds };
  }
  await logScryfallCall(access.userId, "named");
  let card;
  try {
    card = await getCardById(parsed.data.scryfallId);
  } catch {
    card = null;
  }
  if (!card) {
    refused("printing_not_found");
    return { ok: false, error: "Scryfall didn't find that printing. Try again in a moment." };
  }

  const row = collectionRowFor(card, {
    finish: finishFor(card, parsed.data.finish),
    lang: card.lang,
    quantity: parsed.data.quantity,
  });
  const write = await writeCollectionRows([{ line: null, row }], { batchId: null, mode: "add" });
  if (!write.ok) {
    refused("write_failed");
    return { ok: false, error: write.error };
  }
  if (write.overCap.length > 0) {
    refused("collection_full");
    return { ok: false, error: COLLECTION_FULL_MESSAGE };
  }

  const supabase = await createClient();
  const { data } = await supabase.from("collection_cards").select("quantity").eq("scryfall_id", row.scryfall_id);
  const owned = (data ?? []).reduce((sum, r) => sum + (r.quantity ?? 0), 0);
  record(access, "add_card", { surface: parsed.data.surface, quantity: parsed.data.quantity });
  revalidatePath(PAGE);
  return { ok: true, name: card.name, owned };
}

export type PrintingState = { open: false } | { open: true; owned: number };

/** For the creator's exact-copy notice: is the tool open to the viewer, and
 *  how many of this printing do they own. Never an error — a closed tool is
 *  just no button. */
export async function getCollectionPrintingStateAction(scryfallId: string): Promise<PrintingState> {
  const access = await gate();
  if (!access || typeof scryfallId !== "string" || !isUuid(scryfallId)) return { open: false };
  const supabase = await createClient();
  const { data } = await supabase.from("collection_cards").select("quantity").eq("scryfall_id", scryfallId.toLowerCase());
  return { open: true, owned: (data ?? []).reduce((sum, r) => sum + (r.quantity ?? 0), 0) };
}

export type SimpleResult = { ok: true } | Fail;

export async function updateCollectionQuantityAction(payload: unknown): Promise<SimpleResult> {
  const access = await gate();
  if (!access) return { ok: false, error: NO_ACCESS };
  const parsed = updateQuantitySchema.safeParse(payload);
  if (!parsed.success) {
    record(access, "edit_quantity_failed", { reason: "invalid" });
    return { ok: false, error: "Enter a number of copies from 1 to 9,999." };
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("collection_cards")
    .update({ quantity: parsed.data.quantity })
    .eq("id", parsed.data.id)
    .select("id");
  if (error || !data?.length) {
    record(access, "edit_quantity_failed", { reason: error ? "write_failed" : "row_not_found" });
    return { ok: false, error: "That change didn't save. Try again." };
  }
  record(access, "edit_quantity", { quantity: parsed.data.quantity });
  revalidatePath(PAGE);
  return { ok: true };
}

export async function removeCollectionCardAction(payload: unknown): Promise<SimpleResult> {
  const access = await gate();
  if (!access) return { ok: false, error: NO_ACCESS };
  const parsed = removeCardSchema.safeParse(payload);
  if (!parsed.success) {
    record(access, "remove_card_failed", { reason: "invalid" });
    return { ok: false, error: "That card couldn't be removed." };
  }
  const supabase = await createClient();
  const { error } = await supabase.from("collection_cards").delete().eq("id", parsed.data.id);
  if (error) {
    record(access, "remove_card_failed", { reason: "write_failed" });
    return { ok: false, error: "That card couldn't be removed. Try again." };
  }
  record(access, "remove_card", { cards: 1 });
  revalidatePath(PAGE);
  return { ok: true };
}

export async function clearCollectionAction(payload: unknown): Promise<{ ok: true; removed: number } | Fail> {
  const access = await gate();
  if (!access) return { ok: false, error: NO_ACCESS };
  if (!clearCollectionSchema.safeParse(payload).success) return { ok: false, error: "Confirm to clear the collection." };
  const supabase = await createClient();
  const { error, count } = await supabase
    .from("collection_cards")
    .delete({ count: "exact" })
    .eq("owner_id", access.userId);
  if (error) {
    record(access, "clear_failed", { reason: "write_failed" });
    return { ok: false, error: "The collection couldn't be cleared. Try again." };
  }
  record(access, "clear", { removed: count ?? 0 });
  revalidatePath(PAGE);
  return { ok: true, removed: count ?? 0 };
}

// ---------------------------------------------------------------------------
// The builder
// ---------------------------------------------------------------------------

export type DraftResult = { ok: true; draft: CommanderDraft; truncated: boolean } | Fail;

/** The free draft: the rules alone (lib/tools/collection/builder.ts). */
export async function draftCollectionDeckAction(payload: unknown): Promise<DraftResult> {
  const access = await gate();
  if (!access) return { ok: false, error: NO_ACCESS };
  const parsed = draftSchema.safeParse(payload);
  if (!parsed.success) {
    record(access, "draft_failed", { reason: "invalid" });
    return { ok: false, error: "Pick a commander first." };
  }
  const { commanderId, ...choice } = parsed.data;
  const failed = (reason: string) =>
    record(access, "draft_failed", {
      reason,
      ...(choice.deckType ? { deck_type: choice.deckType } : {}),
      ...(choice.bracket ? { bracket: choice.bracket } : {}),
    });
  const refused = choiceError(choice);
  if (refused) {
    failed("invalid_choice");
    return { ok: false, error: refused };
  }
  const commander = await getCollectionCard(commanderId);
  if (!commander) {
    failed("commander_gone");
    return { ok: false, error: "That commander isn't in your collection any more." };
  }
  const why = commanderReason(commander);
  if (why) {
    failed("commander_ineligible");
    return { ok: false, error: `${commander.name} ${why}.` };
  }
  const [pool, lists] = await Promise.all([listBuilderPool(commander), choice.bracket ? getBracketCards() : null]);
  const draft = draftCommanderDeck({ commander, collection: pool.cards, plan: draftPlanFor(choice, lists) });
  record(access, "draft", {
    pool: draft.poolSize,
    total: draft.total,
    colours: commander.colorIdentity.join("") || "C",
    ...(choice.deckType ? { deck_type: choice.deckType } : {}),
    ...(choice.tribe ? { tribe: choice.tribe } : {}),
    ...(choice.bracket ? { bracket: choice.bracket } : {}),
  });
  return { ok: true, draft, truncated: pool.truncated };
}

export type SaveDeckResult = { ok: true; slug: string; title: string; placeholders: number } | Fail;

/**
 * Save a draft as a deck the user owns — through the deck writers every
 * import uses: `createDeckAction`, then the decklist commit
 * (`commitImportLines` → import_deck_entries, which fetches every printing
 * again by id). The server checks the list again first: every card the
 * caller's own row, legal, inside the commander's colours, one copy each,
 * basics only of the deck's colours (or Wastes), 100 cards at most.
 */
export async function saveCollectionDeckAction(payload: unknown): Promise<SaveDeckResult> {
  const access = await gate();
  if (!access) return { ok: false, error: NO_ACCESS };
  const parsed = saveDeckSchema.safeParse(payload);
  if (!parsed.success) {
    record(access, "save_deck_failed", { reason: "invalid" });
    return { ok: false, error: parsed.error.issues[0]?.message ?? "That deck couldn't be saved." };
  }
  const { commanderId, cardIds, basics, title, visibility, deckType, tribe, bracket } = parsed.data;
  const failed = (reason: string, props: Record<string, number> = {}) =>
    record(access, "save_deck_failed", { reason, visibility, retry: parsed.data.retry, ...props });

  const rows = await listCollectionCardsById([commanderId, ...cardIds]);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const commander = byId.get(commanderId);
  if (!commander) {
    failed("commander_gone");
    return { ok: false, error: "That commander isn't in your collection any more." };
  }
  const why = commanderReason(commander);
  if (why) {
    failed("commander_ineligible");
    return { ok: false, error: `${commander.name} ${why}.` };
  }

  const seen = new Set<string>([cardKey(commander.name)]);
  const lines: Array<{ name: string; quantity: number; board: "commander" | "main"; resolved: { scryfall_id: string } }> = [
    { name: commander.name, quantity: 1, board: "commander", resolved: { scryfall_id: commander.scryfallId } },
  ];
  for (const id of cardIds) {
    const card = byId.get(id);
    if (!card) {
      failed("card_gone");
      return { ok: false, error: "A card in this draft isn't in your collection any more. Draft it again." };
    }
    if (isBasicLand(card)) continue;
    const reason = ineligibleReason(card, commander);
    if (reason) {
      failed("card_ineligible");
      return { ok: false, error: `${card.name} ${reason}.` };
    }
    const key = cardKey(card.name);
    if (seen.has(key)) {
      failed("duplicate_card");
      return { ok: false, error: `${card.name} is in the draft twice — a Commander deck has one of each card.` };
    }
    seen.add(key);
    lines.push({ name: card.name, quantity: 1, board: "main", resolved: { scryfall_id: card.scryfallId } });
  }
  const allowedBasics = new Set<string>(["Wastes", ...commander.colorIdentity.map((c) => BASIC_FOR_COLOR[c])]);
  for (const basic of basics) {
    if (!allowedBasics.has(basic.name)) {
      failed("basic_off_colour");
      return { ok: false, error: `${basic.name} is outside ${commander.name}'s colours.` };
    }
    lines.push({
      name: basic.name,
      quantity: basic.count,
      board: "main",
      resolved: { scryfall_id: DEFAULT_BASIC_PRINTINGS[basic.name].scryfallId },
    });
  }
  const total = lines.reduce((sum, l) => sum + l.quantity, 0);
  if (total > COMMANDER_DECK_SIZE) {
    failed("too_many_cards", { cards: total });
    return { ok: false, error: `That's ${total} cards — a Commander deck is ${COMMANDER_DECK_SIZE}. Remove ${total - COMMANDER_DECK_SIZE}.` };
  }

  // A press after a failed or unanswered one (`retry`) takes back the deck
  // that press made in the last minute (createDeckAction's reuseRecentTwin,
  // as the New deck dialog does) — never a second deck.
  const created = await createDeckAction(
    {
      title,
      format: "commander",
      // What the draft was built around (owner decision 7): the deck type
      // (or the creature type's tribe key) and the bracket, in the deck's
      // own columns.
      deck_type: deckTypeKeyFor({ deckType, tribe }),
      bracket: bracket ?? null,
      visibility,
      description: `Built from my collection around ${commander.name}.`,
    },
    { reuseRecentTwin: parsed.data.retry },
  );
  if (!created.ok) {
    failed("deck_not_created", { cards: total });
    return { ok: false, error: created.formError ?? Object.values(created.fieldErrors ?? {})[0] ?? "The deck couldn't be made. Try again." };
  }
  const supabase = await createClient();
  const cardCount = async () => {
    const { data } = await supabase
      .from("decks")
      .select("card_count")
      .eq("id", created.deckId)
      .eq("owner_id", access.userId)
      .maybeSingle();
    return data?.card_count ?? 0;
  };
  // The twin of a press whose list DID go in (only its answer was lost):
  // the deck is saved already.
  if (parsed.data.retry && (await cardCount()) > 0) {
    return { ok: true, slug: created.slug, title, placeholders: 0 };
  }

  let commit: Awaited<ReturnType<typeof commitImportLines>> | null = null;
  try {
    commit = await commitImportLines(
      { deckId: created.deckId, lines, firstImportOnly: true },
      { quota: "deck_import_commit" },
    );
  } finally {
    // A commit that THREW leaves here with the error: recorded on the way.
    if (!commit) failed("commit_error", { cards: total });
    if (!commit?.ok && (await cardCount()) === 0) {
      // An empty deck the user didn't ask for is removed again (their own,
      // made a moment ago) — whether the commit refused or threw; the draft
      // stays on screen to try once more.
      await supabase.from("decks").delete().eq("id", created.deckId).eq("owner_id", access.userId);
    }
  }
  if (!commit.ok) {
    if (commit.alreadyImported) return { ok: true, slug: created.slug, title, placeholders: 0 };
    failed(commit.retryAfterSeconds ? "rate_limited" : "commit_refused", { cards: total });
    return { ok: false, error: commit.error, retryAfterSeconds: commit.retryAfterSeconds };
  }
  record(access, "save_deck", { cards: total, visibility, placeholders: commit.placeholders });
  return { ok: true, slug: created.slug, title, placeholders: commit.placeholders };
}
