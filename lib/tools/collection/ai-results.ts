import "server-only";

import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { isUuid } from "@/lib/ids";
import type { Json } from "@/types/supabase";

// ---------------------------------------------------------------------------
// What became of each paid Collection AI call (migration 0198).
//
// "Build with AI" and "Suggest a commander" save nothing — the answer goes
// to the page — and their credit is settled once the answer exists. An
// answer whose response never arrived was paid for and lost. The routes
// write here what became of each request, by the id the page made for it:
//
//   start   the request reached the route, BEFORE any charge   → `running`
//           (the call is refused when this can't be written: a request
//           that could be charged always has a row)
//   end     turned down before the charge                      → `refused`
//           failed after it (the route refunds the credit)     → `failed`
//   keep    the answer, BEFORE the credit is settled            → `done`
//           (a credit is settled only for an answer that was kept)
//
// and the page that lost its response asks (ai-recover.ts →
// GET /api/tools/collection-builder/ai-result) and is told which. "No row"
// therefore means the request never reached the route: nothing was charged.
//
// Service role only — every caller has checked the tool's access and passes
// the viewer's own id. Nothing here throws.
// ---------------------------------------------------------------------------

export const COLLECTION_AI_KINDS = ["build", "suggest"] as const;
export type CollectionAiKind = (typeof COLLECTION_AI_KINDS)[number];

export function isCollectionAiKind(value: unknown): value is CollectionAiKind {
  return typeof value === "string" && (COLLECTION_AI_KINDS as readonly string[]).includes(value);
}

/** How long a row stays at most (the weekly prune). */
export const COLLECTION_AI_RESULT_DAYS = 7;
/** A new call drops the same user's rows of its kind older than this: a
 *  page stops asking about a request long before. */
export const COLLECTION_AI_TRIM_AFTER_MS = 60 * 60_000;

/** What became of a request, as the page is told. */
export type CollectionAiState =
  | { state: "done"; result: Record<string, unknown> }
  | { state: "running" | "refused" | "failed" }
  /** No row for that request: it never reached the route. */
  | { state: "none" };

/** The table is not there yet: the app deployed before 0198 landed. */
const tableMissing = (error: { code?: string } | null) => error?.code === "PGRST205" || error?.code === "42P01";

const usable = (requestId: string | null | undefined): requestId is string => Boolean(requestId) && isUuid(requestId as string);

/**
 * The request reached the route: put it on record as `running`, BEFORE
 * anything is charged.
 *   started      on record
 *   skipped      no request id (a page from before this): nothing to record,
 *                and nothing can be asked for again
 *   unavailable  the table is not there yet, or there is no service role:
 *                the call goes on as it did before this existed
 *   failed       the write failed — the caller REFUSES the call: a request
 *                that can be charged must have a row
 */
export async function startCollectionAiResult(
  userId: string,
  kind: CollectionAiKind,
  requestId: string | null | undefined,
): Promise<"started" | "skipped" | "unavailable" | "failed"> {
  if (!usable(requestId)) return "skipped";
  if (!isAdminConfigured()) return "unavailable";
  try {
    const admin = createAdminClient();
    const { error } = await admin
      .from("collection_ai_results")
      .upsert(
        { user_id: userId, request_id: requestId, kind, status: "running", result: null, created_at: new Date().toISOString() },
        { onConflict: "user_id,request_id" },
      );
    if (error) {
      if (tableMissing(error)) return "unavailable";
      console.warn(`[collection] AI ${kind} request not put on record:`, error.message);
      return "failed";
    }
    // The user's older rows of this kind go (best effort; the weekly prune
    // is the backstop). Never this request's, never a call still in flight.
    const { error: trimError } = await admin
      .from("collection_ai_results")
      .delete()
      .eq("user_id", userId)
      .eq("kind", kind)
      .lt("created_at", new Date(Date.now() - COLLECTION_AI_TRIM_AFTER_MS).toISOString());
    if (trimError) console.warn(`[collection] AI ${kind} older rows not trimmed:`, trimError.message);
    return "started";
  } catch (error) {
    console.warn(`[collection] AI ${kind} request not put on record:`, error instanceof Error ? error.message : error);
    return "failed";
  }
}

/**
 * Keep `result` as that request's answer — called BEFORE the credit is
 * settled, and tried twice.
 *   kept     safe: the credit may be settled
 *   skipped  no request id, or nothing to keep it in: settle as before
 *   failed   NOT kept — the caller leaves the credit unsettled (the
 *            reconcile sweep returns it): a paid answer is always a kept one
 */
export async function keepCollectionAiResult(
  userId: string,
  kind: CollectionAiKind,
  requestId: string | null | undefined,
  result: Record<string, unknown>,
): Promise<"kept" | "skipped" | "failed"> {
  if (!usable(requestId) || !isAdminConfigured()) return "skipped";
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const { error } = await createAdminClient()
        .from("collection_ai_results")
        .upsert(
          { user_id: userId, request_id: requestId, kind, status: "done", result: result as Json, created_at: new Date().toISOString() },
          { onConflict: "user_id,request_id" },
        );
      if (!error) return "kept";
      if (tableMissing(error)) return "skipped";
      console.warn(`[collection] AI ${kind} answer not kept (try ${attempt}):`, error.message);
    } catch (error) {
      console.warn(`[collection] AI ${kind} answer not kept (try ${attempt}):`, error instanceof Error ? error.message : error);
    }
  }
  return "failed";
}

/** How the request ended without an answer — on ITS row only: `refused`
 *  (turned down before the charge) or `failed` (after it; the route refunds
 *  the credit). Best effort. */
export async function endCollectionAiResult(
  userId: string,
  kind: CollectionAiKind,
  requestId: string | null | undefined,
  status: "refused" | "failed",
): Promise<void> {
  if (!usable(requestId) || !isAdminConfigured()) return;
  try {
    const { error } = await createAdminClient()
      .from("collection_ai_results")
      .update({ status, result: null })
      .eq("user_id", userId)
      .eq("request_id", requestId)
      // Never an answer already kept.
      .eq("status", "running");
    if (error && !tableMissing(error)) console.warn(`[collection] AI ${kind} ending (${status}) not written:`, error.message);
  } catch (error) {
    console.warn(`[collection] AI ${kind} ending (${status}) not written:`, error instanceof Error ? error.message : error);
  }
}

/** A paid call's bookkeeping, filled in by its route as it goes. */
export type CollectionAiCall = {
  /** The viewer, once the tool's access check let them in. */
  userId: string | null;
  /** The request's id, once it is ON RECORD (`started`). */
  requestId: string | null;
  /** The credit was reserved. */
  charged: boolean;
  /** The route wrote the row's ending itself (done / failed). */
  ended: boolean;
};

/**
 * Run a paid route's handler so that EVERY way out leaves the request's row
 * with an ending: a return that wrote none was a refusal before the charge
 * (`refused`) — or, after it, something nobody caught (`failed`: the credit
 * was never settled, so the reconcile sweep returns it). One place, instead
 * of a write beside each of a route's dozen returns.
 */
export async function withCollectionAiRecord(
  kind: CollectionAiKind,
  handle: (call: CollectionAiCall) => Promise<Response>,
): Promise<Response> {
  const call: CollectionAiCall = { userId: null, requestId: null, charged: false, ended: false };
  try {
    return await handle(call);
  } finally {
    if (call.userId && call.requestId && !call.ended) {
      await endCollectionAiResult(call.userId, kind, call.requestId, call.charged ? "failed" : "refused");
    }
  }
}

/** What became of THAT request, or null when it can't be read (the page
 *  asks again — never "no record"). */
export async function readCollectionAiResult(
  userId: string,
  kind: CollectionAiKind,
  requestId: string,
): Promise<CollectionAiState | null> {
  if (!isUuid(requestId) || !isAdminConfigured()) return null;
  try {
    const { data, error } = await createAdminClient()
      .from("collection_ai_results")
      .select("status, result")
      .eq("user_id", userId)
      .eq("request_id", requestId)
      .eq("kind", kind)
      .maybeSingle();
    if (error) return null;
    if (!data) return { state: "none" };
    if (data.status === "running" || data.status === "refused" || data.status === "failed") return { state: data.status };
    const result = data.result;
    return data.status === "done" && result && typeof result === "object" && !Array.isArray(result)
      ? { state: "done", result: result as Record<string, unknown> }
      : null;
  } catch {
    return null;
  }
}
