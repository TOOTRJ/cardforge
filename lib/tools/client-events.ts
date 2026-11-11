import "server-only";

import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { TOOL_CLIENT_EVENTS, isToolClientEvent, type ToolSlug } from "./catalog";
import { recordToolEvent } from "./events";
import { checkToolAccess } from "./queries";

// ---------------------------------------------------------------------------
// A tool's event from the BROWSER — the moments no server action of the tool
// sees: a link copied, a file the browser built and saved, a run its own
// runner finished. POST /api/tools/usage hands them here.
//
// Recorded only for a viewer the access rule lets in, with the path that
// let them in, and only a name the tool lists for its browser
// (`TOOL_CLIENT_EVENTS`: never `open` — the page records its own visit —
// and never a server action's event, so a client can't inflate either), at
// most CLIENT_TOOL_EVENTS_PER_MINUTE a minute per user and tool. The limit
// counts the BROWSER's rows alone: a batch whose server steps wrote sixty
// rows in a minute must not cost the run its closing event.
// ---------------------------------------------------------------------------

/**
 * What the BROWSER says it saw is never the tool's cost. A run's own page
 * reports the credits it watched go (`run_finished`, `ai_art_done`) — useful
 * beside the run, forgeable by anyone who can post here, and absent when the
 * tab closes mid-run. So a browser's `credits` is stored as `credits_seen`:
 * a reader that sums `credits` reads the server's rows only, and the money
 * itself is the credit ledger's (credit_ledger, by the flow's label).
 */
export function browserEventProps(props: unknown): unknown {
  if (!props || typeof props !== "object" || Array.isArray(props)) return props;
  const { credits, ...rest } = props as Record<string, unknown>;
  return credits === undefined ? rest : { ...rest, credits_seen: credits };
}

/** Browser events one user may record per tool per minute. */
export const CLIENT_TOOL_EVENTS_PER_MINUTE = 60;

/** Record one browser event, or drop it. Answers whether a row was written.
 *  Never throws. */
export async function recordClientToolEvent(slug: unknown, event: unknown, props?: unknown): Promise<boolean> {
  if (typeof slug !== "string" || typeof event !== "string" || !isToolClientEvent(slug, event)) return false;
  try {
    const access = await checkToolAccess(slug);
    if (!access || !isAdminConfigured()) return false;
    const { count, error } = await createAdminClient()
      .from("tool_events")
      .select("id", { count: "exact", head: true })
      .eq("user_id", access.userId)
      .eq("tool_slug", slug)
      .in("event", [...TOOL_CLIENT_EVENTS[slug as ToolSlug]])
      .gte("created_at", new Date(Date.now() - 60_000).toISOString());
    if (error || (count ?? 0) >= CLIENT_TOOL_EVENTS_PER_MINUTE) return false;
    return await recordToolEvent({ slug, userId: access.userId, event, access: access.via, props: browserEventProps(props) });
  } catch {
    return false;
  }
}
