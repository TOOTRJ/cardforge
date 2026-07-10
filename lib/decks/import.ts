"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import {
  getCardByName,
  getCardCollection,
  SCRYFALL_COLLECTION_MAX,
  type ScryfallCard,
} from "@/lib/scryfall/client";
import {
  checkScryfallRateLimit,
  logScryfallCall,
} from "@/lib/scryfall/rate-limit";
import {
  MAX_DECKLIST_CHARS,
  MAX_DECKLIST_ENTRIES,
  MAX_ENTRY_QUANTITY,
  parseDecklist,
  frontFaceName,
  type ParseWarning,
} from "@/lib/decks/parse-decklist";
import {
  chunkIdentifiers,
  identifierFor,
  lookupEntry,
  nameFallbackIdentifiers,
  reconcileCollection,
  toResolvedCardData,
  type ResolvedCardData,
} from "@/lib/decks/import-resolution";
import { getDeckById } from "@/lib/decks/queries";
import { DECK_BOARD_VALUES } from "@/types/deck";
import type { DeckCardInsert } from "@/types/supabase";

// ---------------------------------------------------------------------------
// Decklist import — two-step, review-before-commit:
//   1. resolveDecklistAction(text): parse + resolve against Scryfall,
//      returning a review payload. NO WRITES.
//   2. commitDeckImportAction(deckId, lines): validate + write the entries
//      the user confirmed, merging quantities into existing rows.
// A resolve run costs a handful of /cards/collection calls (75 identifiers
// each, 500ms spacing) plus a bounded fuzzy rescue — all server-side.
// ---------------------------------------------------------------------------

export type ImportLineStatus = "resolved" | "fuzzy" | "unresolved";

export type ImportReviewLine = {
  /** 1-based source line (first occurrence when duplicates merged). */
  line: number;
  raw: string;
  name: string;
  quantity: number;
  board: (typeof DECK_BOARD_VALUES)[number];
  status: ImportLineStatus;
  /** Set when status is resolved/fuzzy. */
  resolved: ResolvedCardData | null;
};

export type ResolveDecklistResult =
  | {
      ok: true;
      title: string | null;
      lines: ImportReviewLine[];
      parseWarnings: ParseWarning[];
    }
  | { ok: false; error: string; retryAfterSeconds?: number };

// Bound the per-run fuzzy rescue so a garbage paste can't burn function
// time at 500ms per /cards/named call.
const MAX_FUZZY_RESCUES = 15;

export async function resolveDecklistAction(
  payload: unknown,
): Promise<ResolveDecklistResult> {
  const parsedPayload = z
    .object({ text: z.string().min(1).max(MAX_DECKLIST_CHARS) })
    .safeParse(payload);
  if (!parsedPayload.success) {
    return {
      ok: false,
      error: `Paste a decklist (up to ${MAX_DECKLIST_CHARS.toLocaleString()} characters).`,
    };
  }

  if (!isSupabaseConfigured()) {
    return { ok: false, error: "Supabase isn't configured." };
  }
  const user = await getCurrentUser();
  if (!user) {
    return { ok: false, error: "Sign in to import a decklist." };
  }

  const { title, entries, warnings } = parseDecklist(parsedPayload.data.text);
  if (entries.length === 0) {
    return {
      ok: false,
      error:
        warnings[0]?.reason ??
        "No cards found — expected lines like “4 Lightning Bolt”.",
    };
  }
  if (entries.length > MAX_DECKLIST_ENTRIES) {
    return {
      ok: false,
      error: `That list has ${entries.length} distinct cards — the importer caps at ${MAX_DECKLIST_ENTRIES}.`,
    };
  }

  // One quota row per RUN (not per API call) — see SCRYFALL_LIMITS.
  const rate = await checkScryfallRateLimit(user.id, "deck_import");
  if (!rate.ok) {
    return {
      ok: false,
      error: rate.message,
      retryAfterSeconds: rate.retryAfterSeconds,
    };
  }
  await logScryfallCall(user.id, "deck_import");

  // Pass 1: batch the preferred identifiers (printing when known, else name).
  const uniqueIdentifiers = new Map<string, ReturnType<typeof identifierFor>>();
  for (const entry of entries) {
    const id = identifierFor(entry);
    uniqueIdentifiers.set(JSON.stringify(id), id);
  }
  const allCards: ScryfallCard[] = [];
  for (const batch of chunkIdentifiers(
    Array.from(uniqueIdentifiers.values()),
    SCRYFALL_COLLECTION_MAX,
  )) {
    const result = await getCardCollection(batch);
    if (result === null) {
      return {
        ok: false,
        error:
          "Scryfall didn't respond — nothing was imported. Try again in a moment.",
      };
    }
    allCards.push(...result.cards);
  }
  let { byKey } = reconcileCollection([], allCards);

  // Pass 2: printings that missed (bad set codes) retry as bare names.
  const fallbacks = nameFallbackIdentifiers(entries, byKey);
  if (fallbacks.length > 0) {
    for (const batch of chunkIdentifiers(fallbacks, SCRYFALL_COLLECTION_MAX)) {
      const result = await getCardCollection(batch);
      if (result) allCards.push(...result.cards);
    }
    byKey = reconcileCollection([], allCards).byKey;
  }

  // Pass 3: bounded fuzzy rescue for whatever's still missing (typos).
  let fuzzyBudget = MAX_FUZZY_RESCUES;
  const fuzzyByName = new Map<string, ScryfallCard | null>();
  for (const entry of entries) {
    if (lookupEntry(byKey, entry)) continue;
    if (fuzzyBudget <= 0) break;
    const name = frontFaceName(entry.name) ?? entry.name;
    const cacheKey = name.toLowerCase();
    if (fuzzyByName.has(cacheKey)) continue;
    fuzzyBudget -= 1;
    fuzzyByName.set(cacheKey, await getCardByName({ fuzzy: name }));
  }

  const lines: ImportReviewLine[] = entries.map((entry) => {
    const exact = lookupEntry(byKey, entry);
    if (exact) {
      return {
        line: entry.line,
        raw: entry.raw,
        name: entry.name,
        quantity: entry.quantity,
        board: entry.board,
        status: "resolved",
        resolved: toResolvedCardData(exact),
      };
    }
    const fuzzyKey = (frontFaceName(entry.name) ?? entry.name).toLowerCase();
    const fuzzy = fuzzyByName.get(fuzzyKey) ?? null;
    if (fuzzy) {
      return {
        line: entry.line,
        raw: entry.raw,
        name: entry.name,
        quantity: entry.quantity,
        board: entry.board,
        status: "fuzzy",
        resolved: toResolvedCardData(fuzzy),
      };
    }
    return {
      line: entry.line,
      raw: entry.raw,
      name: entry.name,
      quantity: entry.quantity,
      board: entry.board,
      status: "unresolved",
      resolved: null,
    };
  });

  return { ok: true, title, lines, parseWarnings: warnings };
}

// ---------------------------------------------------------------------------
// Commit
// ---------------------------------------------------------------------------

const commitLineSchema = z.object({
  name: z.string().trim().min(1).max(200),
  quantity: z.number().int().min(1).max(MAX_ENTRY_QUANTITY),
  board: z.enum(DECK_BOARD_VALUES),
  resolved: z
    .object({
      scryfall_id: z.string().min(1).max(64),
      name: z.string().min(1).max(200),
      set_code: z.string().max(10).nullable(),
      collector_number: z.string().max(20).nullable(),
      type_line: z.string().max(300).nullable(),
      mana_cost: z.string().max(100).nullable(),
      mana_value: z.number().nullable(),
      color_identity: z.array(z.enum(["W", "U", "B", "R", "G"])).max(5),
      rarity: z.string().max(20).nullable(),
      // https-gated app-side; Scryfall image hosts are already normalized
      // by the client, but the DB column just stores a URL string.
      image_url: z.string().url().max(2048).nullable(),
    })
    .nullable(),
});

const commitSchema = z.object({
  deckId: z.string().uuid("Invalid deck id."),
  lines: z.array(commitLineSchema).min(1).max(MAX_DECKLIST_ENTRIES),
});

export type CommitDeckImportResult =
  | { ok: true; added: number; merged: number; placeholders: number }
  | { ok: false; error: string };

export async function commitDeckImportAction(
  payload: unknown,
): Promise<CommitDeckImportResult> {
  const parsed = commitSchema.safeParse(payload);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid import payload.",
    };
  }

  if (!isSupabaseConfigured()) {
    return { ok: false, error: "Supabase isn't configured." };
  }
  const user = await getCurrentUser();
  if (!user) {
    return { ok: false, error: "Sign in to import a decklist." };
  }

  const deck = await getDeckById(parsed.data.deckId);
  if (!deck || deck.owner_id !== user.id) {
    return { ok: false, error: "Deck not found or not yours." };
  }

  // Only image URLs from Scryfall's CDN survive — belt-and-braces against a
  // tampered client posting arbitrary hotlinks into public deck pages.
  const safeImage = (url: string | null): string | null =>
    url && url.startsWith("https://cards.scryfall.io/") ? url : null;

  const supabase = await createClient();
  const { data: existingRows, error: existingError } = await supabase
    .from("deck_cards")
    .select("id, board, quantity, position, scryfall_id, name")
    .eq("deck_id", deck.id);
  if (existingError) {
    return { ok: false, error: existingError.message };
  }

  // Merge key: same board + same card. Scryfall id when both sides have
  // one, else case-insensitive name (covers placeholders).
  const keyFor = (row: {
    board: string;
    scryfall_id: string | null;
    name: string;
  }) =>
    `${row.board}|${row.scryfall_id ?? `name:${row.name.trim().toLowerCase()}`}`;

  const existingByKey = new Map(
    (existingRows ?? []).map((row) => [keyFor(row), row]),
  );
  let maxPosition = (existingRows ?? []).reduce(
    (max, row) => Math.max(max, row.position ?? 0),
    -1,
  );

  const inserts: DeckCardInsert[] = [];
  const quantityUpdates: Array<{ id: string; quantity: number }> = [];
  let placeholders = 0;

  // Duplicate keys WITHIN the payload merge as we go.
  const pendingByKey = new Map<string, DeckCardInsert>();

  for (const line of parsed.data.lines) {
    const resolved = line.resolved;
    if (!resolved) placeholders += 1;
    const candidate: DeckCardInsert = {
      deck_id: deck.id,
      board: line.board,
      quantity: line.quantity,
      position: 0, // assigned below for fresh inserts
      scryfall_id: resolved?.scryfall_id ?? null,
      name: resolved?.name ?? line.name,
      set_code: resolved?.set_code ?? null,
      collector_number: resolved?.collector_number ?? null,
      type_line: resolved?.type_line ?? null,
      mana_cost: resolved?.mana_cost ?? null,
      mana_value: resolved?.mana_value ?? null,
      color_identity: resolved?.color_identity ?? [],
      rarity: resolved?.rarity ?? null,
      image_url: safeImage(resolved?.image_url ?? null),
    };
    const key = keyFor({
      board: candidate.board ?? "main",
      scryfall_id: candidate.scryfall_id ?? null,
      name: candidate.name,
    });

    const pending = pendingByKey.get(key);
    if (pending) {
      pending.quantity = Math.min(
        (pending.quantity ?? 1) + line.quantity,
        MAX_ENTRY_QUANTITY,
      );
      continue;
    }

    const existing = existingByKey.get(key);
    if (existing) {
      quantityUpdates.push({
        id: existing.id,
        quantity: Math.min(
          existing.quantity + line.quantity,
          MAX_ENTRY_QUANTITY,
        ),
      });
      continue;
    }

    maxPosition += 1;
    candidate.position = maxPosition;
    pendingByKey.set(key, candidate);
    inserts.push(candidate);
  }

  if (inserts.length > 0) {
    const { error: insertError } = await supabase
      .from("deck_cards")
      .insert(inserts);
    if (insertError) {
      return { ok: false, error: insertError.message };
    }
  }
  if (quantityUpdates.length > 0) {
    const results = await Promise.all(
      quantityUpdates.map((update) =>
        supabase
          .from("deck_cards")
          .update({ quantity: update.quantity })
          .eq("id", update.id)
          .eq("deck_id", deck.id),
      ),
    );
    const failure = results.find((r) => r.error);
    if (failure?.error) {
      return { ok: false, error: failure.error.message };
    }
  }

  revalidatePath(`/deck/${deck.slug}`);
  revalidatePath(`/deck/${deck.slug}/edit`);
  revalidatePath("/dashboard/decks");
  revalidatePath("/decks");

  return {
    ok: true,
    added: inserts.length,
    merged: quantityUpdates.length,
    placeholders,
  };
}
