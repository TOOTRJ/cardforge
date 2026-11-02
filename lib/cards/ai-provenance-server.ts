import "server-only";
import type { Json } from "@/types/supabase";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import {
  aiFieldValue,
  aiTextPartsPresent,
  isAiTextFieldKey,
  type AiFieldSource,
  type AiTextFieldKey,
} from "@/lib/cards/ai-provenance";

// ---------------------------------------------------------------------------
// The server's half of AI provenance (TODO CP1, migration 0161;
// lib/cards/ai-provenance.ts holds the vocabulary). Every write here goes
// through the service role — no API role may touch `cards.ai_fields`
// (0161's guard) or `card_ai_receipts`.
//
//   * recordAiReceipt — what an AI fill or a "Get ideas" batch wrote, kept
//     as the server received it, so a later save's claim can be checked.
//   * verifiedAiClaims — the parts a creator's save CLAIMS (an AI fill or
//     idea it applied, still exactly as written) that a receipt of the same
//     owner from the last 30 days holds with the same text as the row being
//     saved. A claim no receipt backs is dropped, never trusted.
//   * inheritedAiParts — a remix's parts that are still its parent's AI
//     text (the parent's row is the proof: the server read it).
//   * addCardAiFields — `add_card_ai_fields`: adds the parts, never removes.
//     The art parts need no writer: the database derives them from the
//     picture's address.
//
// All best effort: provenance never fails a save or a job step (a missing
// label is the safe failure — it never claims AI where there was none).
// ---------------------------------------------------------------------------

/** How far back a claim's receipt may be (the creator's open session; an
 *  unclaimed fill is offered for a day). The weekly prune keeps 90 days. */
export const AI_RECEIPT_WINDOW_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The service role is configured (read inside each writer's try: a test
 *  double of the admin module may not have it). */
function adminReady(): boolean {
  return isAdminConfigured();
}

/** Postgres / PostgREST's answers for a database 0161 hasn't reached. */
const MISSING = new Set(["PGRST202", "PGRST205", "42883", "42P01", "42703", "PGRST204"]);

export type AiReceiptSource = "fill" | "idea";

/** A fill or idea in row shape (title, cost, card_type, supertype,
 *  subtypes, rules_text, flavor_text, the stats, back_face). */
export type AiReceiptValue = AiFieldSource;

/** Only the text parts' columns travel into a receipt. */
function receiptValueOf(value: AiReceiptValue): Record<string, unknown> {
  const pick = (source: Record<string, unknown>) => {
    const out: Record<string, unknown> = {};
    for (const key of [
      "title",
      "cost",
      "card_type",
      "supertype",
      "subtypes",
      "printed_types",
      "rules_text",
      "flavor_text",
      "power",
      "toughness",
      "loyalty",
      "defense",
    ]) {
      if (source[key] !== undefined) out[key] = source[key];
    }
    return out;
  };
  const front = pick(value as Record<string, unknown>);
  const back = value.back_face && typeof value.back_face === "object" ? pick(value.back_face as Record<string, unknown>) : null;
  return back && Object.keys(back).length > 0 ? { ...front, back_face: back } : front;
}

export async function recordAiReceipt(
  ownerId: string,
  source: AiReceiptSource,
  values: readonly AiReceiptValue[],
): Promise<void> {
  if (values.length === 0) return;
  try {
    if (!adminReady()) return;
    const { error } = await createAdminClient()
      .from("card_ai_receipts")
      .insert({ owner_id: ownerId, source, values: values.map(receiptValueOf) as unknown as Json });
    if (error && !MISSING.has(error.code ?? "")) {
      console.error(`[ai-provenance] receipt (${source}) not stored: ${error.message}`);
    }
  } catch (error) {
    console.error("[ai-provenance] receipt not stored:", error);
  }
}

/** The claimed parts a receipt backs: same owner, the last 30 days, the
 *  same canonical text as the row being saved (aiFieldValue). */
export async function verifiedAiClaims(
  ownerId: string,
  claims: readonly unknown[] | null | undefined,
  saved: AiFieldSource,
): Promise<AiTextFieldKey[]> {
  const wanted = [...new Set((claims ?? []).filter(isAiTextFieldKey))].filter(
    (key) => aiFieldValue(key, saved) !== null,
  );
  if (wanted.length === 0) return [];
  try {
    if (!adminReady()) return [];
    const since = new Date(Date.now() - AI_RECEIPT_WINDOW_DAYS * DAY_MS).toISOString();
    const { data, error } = await createAdminClient()
      .from("card_ai_receipts")
      .select("values")
      .eq("owner_id", ownerId)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) {
      if (!MISSING.has(error.code ?? "")) console.error(`[ai-provenance] receipts unread: ${error.message}`);
      return [];
    }
    const received: AiFieldSource[] = [];
    for (const row of data ?? []) {
      const values = (row as { values: unknown }).values;
      if (Array.isArray(values)) {
        for (const value of values) if (value && typeof value === "object") received.push(value as AiFieldSource);
      }
    }
    return wanted.filter((key) => {
      const value = aiFieldValue(key, saved);
      return received.some((receipt) => aiFieldValue(key, receipt) === value);
    });
  } catch (error) {
    console.error("[ai-provenance] claims unchecked:", error);
    return [];
  }
}

/** A remix's parts that still hold its parent's AI text (and the parent
 *  said so). Pure: the caller read the parent row. */
export function inheritedAiParts(
  parent: (AiFieldSource & { ai_fields?: readonly string[] | null }) | null | undefined,
  saved: AiFieldSource,
): AiTextFieldKey[] {
  if (!parent?.ai_fields?.length) return [];
  return parent.ai_fields.filter(isAiTextFieldKey).filter((key) => {
    const value = aiFieldValue(key, saved);
    return value !== null && value === aiFieldValue(key, parent);
  });
}

/** Every text part a card the AI wrote whole HAS (an AI job's card). */
export function generatedCardParts(saved: AiFieldSource): AiTextFieldKey[] {
  return aiTextPartsPresent(saved);
}

export async function addCardAiFields(
  cardId: string,
  ownerId: string,
  parts: readonly AiTextFieldKey[],
): Promise<void> {
  const fields = [...new Set(parts.filter(isAiTextFieldKey))].sort();
  if (fields.length === 0) return;
  try {
    if (!adminReady()) return;
    const { error } = await createAdminClient().rpc("add_card_ai_fields", {
      p_card_id: cardId,
      p_owner_id: ownerId,
      p_fields: fields,
    });
    if (error && !MISSING.has(error.code ?? "")) {
      console.error(`[ai-provenance] parts not stored for ${cardId}: ${error.message}`);
    }
  } catch (error) {
    console.error(`[ai-provenance] parts not stored for ${cardId}:`, error);
  }
}
