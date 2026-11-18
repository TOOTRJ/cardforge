"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/ids";
import { checkToolAccess } from "@/lib/tools/queries";
import { recordToolEventLater } from "@/lib/tools/events";
import { toolHref } from "@/lib/tools/catalog";
import { REART_BACKGROUND_UNAVAILABLE, REART_TOOL_SLUG } from "@/lib/tools/re-art/model";
import { getOwnedDeck } from "@/lib/tools/re-art/server";
import {
  FRESH_TOKEN_S,
  driveBackgroundRuns,
  kickMs,
  requestBackgroundStop,
  startBackground,
  tokenSecondsLeft,
} from "@/lib/tools/re-art/background";
import type { JobStep } from "@/lib/ai/generation-jobs";

// ---------------------------------------------------------------------------
// Handing a Re-art run to the server, and taking it back (migration 0218;
// lib/tools/re-art/background.ts). Both are the maker's own requests: the
// hand-over is the one moment the server is given a sign-in to borrow.
// ---------------------------------------------------------------------------

const NO_ACCESS = "Re-art deck isn't open to you.";

/** This request's own address (a local dev server is reached by it; a
 *  deployed site by its configured address — background.ts stepDoorUrl). */
async function requestUrl(): Promise<string | null> {
  try {
    const list = await headers();
    const host = list.get("host");
    return host ? `${list.get("x-forwarded-proto") ?? "http"}://${host}/` : null;
  } catch {
    return null;
  }
}

/**
 * "Keep painting if I close this page": the run is handed to the server.
 * The session is refreshed first unless its token is fresh already — in
 * THIS request, where the rotated cookies reach the browser — so the run
 * has the best part of an hour. The access token (never the refresh token)
 * is then kept, encrypted, for as long as the run is carried. Nothing is
 * charged; a hand-over that can't be made leaves the run as it always was
 * (the page paints it).
 *
 * This request is the run's first driver, after its response: it asks the
 * step door for cards for a few minutes, and the cron takes over from it.
 */
export async function handReartRunToServerAction(jobId: unknown): Promise<{ ok: true; state: "started" | "already" } | { ok: false; error: string }> {
  const access = await checkToolAccess(REART_TOOL_SLUG);
  if (!access) return { ok: false, error: NO_ACCESS };
  if (typeof jobId !== "string" || !isUuid(jobId)) return { ok: false, error: "That run couldn't be read." };
  const refused = (reason: string) => {
    recordToolEventLater({ slug: REART_TOOL_SLUG, userId: access.userId, event: "background_start_failed", access: access.via, props: { reason } });
    return { ok: false as const, error: REART_BACKGROUND_UNAVAILABLE };
  };
  // The caller's own Re-art run, still going (their session: RLS).
  const supabase = await createClient();
  const { data: job } = await supabase
    .from("ai_generation_jobs")
    .select("id, owner_id, kind, status, request, steps")
    .eq("id", jobId)
    .eq("owner_id", access.userId)
    .eq("kind", "deck_reart")
    .maybeSingle();
  const deckId = (job?.request as { deck_id?: unknown } | null)?.deck_id;
  if (!job || typeof deckId !== "string" || !isUuid(deckId)) return { ok: false, error: "That run isn't one of yours." };
  if (job.status !== "generating") return refused("not_running");
  if (!(await getOwnedDeck(access.userId, deckId))) return { ok: false, error: "That run's deck isn't one of yours any more." };

  // The token the server borrows.
  const { data: held } = await supabase.auth.getSession();
  let accessToken = held.session?.access_token ?? null;
  if (tokenSecondsLeft(accessToken) < FRESH_TOKEN_S) {
    const { data: fresh, error } = await supabase.auth.refreshSession();
    if (!error && fresh.session?.access_token) accessToken = fresh.session.access_token;
  }
  if (!accessToken) return refused("no_session");

  const url = await requestUrl();
  const steps = (Array.isArray(job.steps) ? job.steps : []) as unknown as JobStep[];
  const result = await startBackground({ userId: access.userId, jobId: job.id, deckId, accessToken, steps, requestUrl: url });
  if (!result.ok) return refused(result.reason);
  if (result.state === "started") {
    recordToolEventLater({
      slug: REART_TOOL_SLUG,
      userId: access.userId,
      event: "background_start",
      access: access.via,
      props: { minutes: Math.floor(tokenSecondsLeft(accessToken) / 60) },
    });
  }
  // The first driver. Everything it needs is passed in as plain values:
  // nothing after the response reads this request's session.
  const preset = { jobId: job.id, accessToken, headers: result.headers };
  after(async () => {
    try {
      await driveBackgroundRuns({ forMs: kickMs(), only: preset.jobId, requestUrl: url, preset });
    } catch (error) {
      console.error(`[re-art] background run ${preset.jobId}: its first driver failed:`, error);
    }
  });
  // The page reads the run's row with this answer (it then says the run
  // can be left, and stops warning about leaving).
  revalidatePath(toolHref(REART_TOOL_SLUG));
  return { ok: true, state: result.state };
}

/** The maker's Stop, for the server's part of a run: it asks for no more
 *  cards (the ones being painted finish). */
export async function stopReartBackgroundAction(jobId: unknown): Promise<{ ok: boolean }> {
  const access = await checkToolAccess(REART_TOOL_SLUG);
  if (!access || typeof jobId !== "string" || !isUuid(jobId)) return { ok: false };
  const ok = await requestBackgroundStop(access.userId, jobId);
  if (ok) revalidatePath(toolHref(REART_TOOL_SLUG));
  return { ok };
}
