"use server";

import { z } from "zod";
import { getEntitlements } from "@/lib/billing/entitlements";
import { isUuid } from "@/lib/ids";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { selectAllRows } from "@/lib/supabase/select-all-rows";
import {
  removeDeckEntriesAction,
  restoreDeckEntriesAction,
  updateDeckEntriesAction,
} from "@/lib/decks/card-actions";
import {
  deckStateAfter,
  groupChanges,
  HISTORY_PAGE_ROWS,
  historyAccessFor,
  historySince,
  isEmptyPlan,
  MAX_RESTORE_CHANGES,
  parseChangeRow,
  parseSnapshot,
  planRestore,
  withinHistory,
  type ChangeRow,
  type DeckRow,
  type HistoryAccess,
  type HistoryVersion,
} from "@/lib/decks/deck-history";

// ---------------------------------------------------------------------------
// The deck History view's read and its "Restore this version" (TODO DK5.13,
// migration 0165; the data rules are lib/decks/deck-history.ts).
//
//   * THE PLAN is read here, on the server, every call (getEntitlements: an
//     admin and billing off are Pro; `isPaid` is not "has a subscription"):
//     Pro reads and restores the full history, Plus the last 30 days, free
//     nothing ("locked" — the session's undo / redo is everyone's).
//   * ONLY THE OWNER'S DECK: the deck is read and its owner checked before
//     anything else, the log is read through the caller's session (0165's
//     RLS: a deck the caller owns) and held to `deck_id` as well, and a
//     restore writes through the batch actions, which check the owner again
//     and hold every statement to the deck. A version id of another deck is
//     "not found".
//   * A RESTORE never inserts a row itself: entries come back through
//     restoreDeckEntriesAction (the decklist commit / the membership writer
//     — D3 and the private-card rules judged again: another creator's card
//     that is no longer public comes back as the real card, or not at all,
//     and says so), go through removeDeckEntriesAction and change through
//     updateDeckEntriesAction. Each of them revalidates the deck page.
//   * ONE RESTORE AT A TIME, FROM WHAT IT READ: the writes are several
//     requests, so no transaction holds the deck's entry lock across them;
//     claim_deck_restore (0165) takes that lock, re-reads the deck's newest
//     change and refuses when it moved since the plan was read ("stale":
//     another tab, an import) or another restore holds the deck ("busy"),
//     and else leases the deck to this restore until it is released.
//   * A PAGE of the History view ends on a version's boundary: a burst
//     longer than a page is read on to its end (HISTORY_PAGE_READS).
// ---------------------------------------------------------------------------

export type DeckHistoryResult =
  | {
      ok: true;
      access: Exclude<HistoryAccess, { kind: "locked" }>;
      versions: HistoryVersion[];
      /** The deck's newest change (the version it reads as now). */
      headId: number | null;
      /** Pass back as `before` for the next page; null: no more. */
      nextBefore: number | null;
    }
  | { ok: false; error: "signed_out" | "locked" | "not_found" | "failed" };

export type DeckVersionRestoreResult =
  | {
      ok: true;
      /** The deck's newest change before the restore — restoring it takes
       *  the restore back (the toolbar's Undo). */
      headBefore: number | null;
      removed: number;
      changed: number;
      restored: number;
      /** What couldn't come back as it was, in words. */
      notes: string[];
    }
  | { ok: false; error: string; stale?: true };

type SessionClient = Awaited<ReturnType<typeof createClient>>;

const LOG_COLUMNS = "id, entry_id, op, before, after, actor_id, tx, changed_at";
type LogRow = Parameters<typeof parseChangeRow>[0];
const parsedRows = (raw: readonly LogRow[]) => raw.map(parseChangeRow).filter((row): row is ChangeRow => row !== null);

/** The most page-sized reads one History page makes to end on a version. */
const HISTORY_PAGE_READS = 34;

async function ownedDeck(supabase: SessionClient, userId: string, deckId: string) {
  const { data } = await supabase.from("decks").select("id, owner_id").eq("id", deckId).maybeSingle();
  return data && data.owner_id === userId ? data : null;
}

async function headOf(supabase: SessionClient, deckId: string): Promise<{ id: number | null; error: boolean }> {
  const { data, error } = await supabase
    .from("deck_entry_changes")
    .select("id")
    .eq("deck_id", deckId)
    .order("id", { ascending: false })
    .limit(1);
  if (error) return { id: null, error: true };
  return { id: data && data[0] ? Number(data[0].id) : null, error: false };
}

const listSchema = z.object({
  deckId: z.string().refine(isUuid),
  before: z.number().int().positive().optional(),
});

export async function listDeckHistoryAction(payload: unknown): Promise<DeckHistoryResult> {
  const parsed = listSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, error: "not_found" };
  if (!isSupabaseConfigured()) return { ok: false, error: "failed" };
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "signed_out" };
  const access = historyAccessFor((await getEntitlements()).effectiveTier);
  if (access.kind === "locked") return { ok: false, error: "locked" };

  const supabase = await createClient();
  const deck = await ownedDeck(supabase, user.id, parsed.data.deckId);
  if (!deck) return { ok: false, error: "not_found" };

  // A page ends on a VERSION's boundary: one burst of more than a page's
  // rows (a restore, an import) is read on until it ends — never shown as
  // two versions across "Show older changes" (at most HISTORY_PAGE_READS
  // reads; past them the burst is split, as it must be somewhere).
  const since = historySince(access);
  const readPage = (before: number | undefined) => {
    let query = supabase
      .from("deck_entry_changes")
      .select(LOG_COLUMNS)
      .eq("deck_id", deck.id)
      .order("id", { ascending: false })
      .limit(HISTORY_PAGE_ROWS + 1);
    if (since) query = query.gte("changed_at", since);
    if (before) query = query.lt("id", before);
    return query;
  };
  const head = headOf(supabase, deck.id);
  const raw: LogRow[] = [];
  let cursor = parsed.data.before;
  let more = false;
  for (let reads = 0; reads < HISTORY_PAGE_READS; reads += 1) {
    const { data, error } = await readPage(cursor);
    if (error) {
      console.error("[deck-history] read failed", error.message);
      return { ok: false, error: "failed" };
    }
    const got = (data ?? []) as LogRow[];
    more = got.length > HISTORY_PAGE_ROWS;
    raw.push(...got.slice(0, HISTORY_PAGE_ROWS));
    if (!more) break;
    cursor = Number(got[HISTORY_PAGE_ROWS - 1]!.id);
    // Two versions read: every one but the last has ended.
    if (groupChanges(parsedRows(raw), user.id).length > 1) break;
  }
  const headRead = await head;
  if (headRead.error) {
    console.error("[deck-history] head read failed");
    return { ok: false, error: "failed" };
  }

  const rows = parsedRows(raw);
  let versions = groupChanges(rows, user.id);
  let nextBefore: number | null = null;
  if (more) {
    // The last version may go on past what was read: it opens the next
    // page — unless it is the only one (a burst past HISTORY_PAGE_READS).
    if (versions.length > 1) versions = versions.slice(0, -1);
    const kept = versions.reduce((sum, version) => sum + version.count, 0);
    nextBefore = rows[kept - 1]?.id ?? null;
  }
  return { ok: true, access, versions, headId: headRead.id, nextBefore };
}

const restoreSchema = z.object({
  deckId: z.string().refine(isUuid, "Invalid deck id."),
  changeId: z.number().int().positive("Pick a version to restore."),
});

/** The deck's rows back as they read right after change `changeId`. */
export async function restoreDeckVersionAction(payload: unknown): Promise<DeckVersionRestoreResult> {
  const parsed = restoreSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid version." };
  if (!isSupabaseConfigured()) return { ok: false, error: "Supabase isn't configured." };
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sign in to edit decks." };
  const access = historyAccessFor((await getEntitlements()).effectiveTier);
  if (access.kind === "locked") return { ok: false, error: "Restoring an older version is part of Plus and Pro." };

  const supabase = await createClient();
  const deck = await ownedDeck(supabase, user.id, parsed.data.deckId);
  if (!deck) return { ok: false, error: "Deck not found or not yours." };

  const { data: version } = await supabase
    .from("deck_entry_changes")
    .select("id, changed_at")
    .eq("deck_id", deck.id)
    .eq("id", parsed.data.changeId)
    .maybeSingle();
  if (!version) return { ok: false, error: "That version is no longer in this deck's history." };
  if (!withinHistory(access, version.changed_at)) {
    return { ok: false, error: "That version is older than your plan keeps — Pro keeps the full history." };
  }

  const head = await headOf(supabase, deck.id);
  const since = await selectAllRows<LogRow>(
    (from, to) =>
      supabase
        .from("deck_entry_changes")
        .select(LOG_COLUMNS)
        .eq("deck_id", deck.id)
        .gt("id", parsed.data.changeId)
        .order("id", { ascending: false })
        .range(from, to),
    { maxRows: MAX_RESTORE_CHANGES },
  );
  const current = await selectAllRows<{ id: string } & Record<string, unknown>>((from, to) =>
    supabase
      .from("deck_cards")
      .select("id, name, board, quantity, scryfall_id, card_id, source, featured_rank")
      .eq("deck_id", deck.id)
      .order("id", { ascending: true })
      .range(from, to),
  );
  if (head.error || since.error || current.error) {
    return { ok: false, error: since.error?.message.includes("stopped") ? "That version is too far back to restore in one go." : "Couldn't read the deck's history. Try again." };
  }

  const changes = since.data.map(parseChangeRow).filter((row): row is ChangeRow => row !== null);
  const rows: DeckRow[] = current.data.flatMap((row) => {
    const snapshot = parseSnapshot(row);
    return snapshot ? [{ ...snapshot, id: row.id }] : [];
  });
  const plan = planRestore(rows, deckStateAfter(rows, changes));
  const result = { ok: true as const, headBefore: head.id, removed: 0, changed: 0, restored: 0, notes: [] as string[] };
  if (isEmptyPlan(plan)) return result;

  // ONE restore of a deck at a time, from the state it was planned on: the
  // claim re-reads the deck's newest change under its entry lock (0165) —
  // another tab, an import or a restore that wrote since the plan was read
  // makes it "stale"; another restore holding the deck, "busy".
  const claim = await supabase.rpc("claim_deck_restore", { p_deck_id: deck.id, p_head: head.id });
  const claimed = (claim.data ?? null) as { ok?: boolean; token?: string; reason?: string } | null;
  if (claim.error || !claimed?.ok || typeof claimed.token !== "string") {
    if (claimed?.reason === "busy") return { ok: false, error: "Another restore of this deck is on its way — try again in a moment." };
    if (claimed?.reason === "stale") {
      return { ok: false, error: "The deck changed while this version was being read — open History again and retry.", stale: true };
    }
    if (claimed?.reason === "not_found") return { ok: false, error: "Deck not found or not yours." };
    console.error("[deck-history] restore claim failed", claim.error?.message);
    return { ok: false, error: "Couldn't start the restore. Try again." };
  }
  const token = claimed.token;

  try {
    // Out first (room under the 500-entry cap), then counts and boards,
    // then the lines back.
    if (plan.remove.length > 0) {
      const out = await removeDeckEntriesAction({ deckId: deck.id, entryIds: plan.remove });
      if (out.ok) result.removed = out.removed.length;
      else if (!out.stale) return { ok: false, error: out.error };
    }
    if (plan.update.length > 0) {
      const changed = await updateDeckEntriesAction({ deckId: deck.id, updates: plan.update });
      if (changed.ok) result.changed = changed.entries.length;
      else if (!changed.stale) result.notes.push(`Some cards kept their count or board: ${changed.error}`);
    }
    if (plan.restore.length > 0) {
      const back = await restoreDeckEntriesAction({ deckId: deck.id, entries: plan.restore });
      if (!back.ok) result.notes.push(back.error);
      else {
        result.restored = back.restored.filter((row) => row.to).length;
        result.notes.push(...back.restored.flatMap((row) => (row.note ? [row.note] : [])));
      }
    }
  } finally {
    // A release that fails leaves the lease to run out (2 minutes).
    const released = await supabase.rpc("release_deck_restore", { p_deck_id: deck.id, p_token: token });
    if (released.error) console.error("[deck-history] restore release failed", released.error.message);
  }
  return result;
}
