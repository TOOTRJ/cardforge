import "server-only";

import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { afterResponse } from "@/lib/api/after-response";
import { TOOL_EVENT_RE, isToolSlug } from "./catalog";
import type { ToolAccessPath } from "./access";

// ---------------------------------------------------------------------------
// tool_events writes (migration 0182) — what /admin/tools' analytics read.
// Best effort by design: instrumentation never fails a tool action, so every
// error is logged and swallowed. `open` is a tool page view; anything else is
// a USE (a search, a generation, a download) named by the tool.
// Props: at most 12 scalar values (string ≤ 120 chars, finite number,
// boolean) — never a card's text, a prompt, an email or a file name. Keys
// are lower-case snake_case; any other key is dropped.
//
// HOW a tool records (2026-11-10, the tools audit):
//   - an action's OUTCOME, not its attempt: the success under the action's
//     name (`generate`, `ai_build`, `export`) with what it made and, for a
//     paid one, `credits`; the failure under `<name>_failed` with a short
//     `reason` code and `refunded: true` when the credit went back. An
//     admin reads "started, worked, failed, cost" per tool from these;
//   - with `recordToolEventLater`: after the response, never awaited in the
//     action — instrumentation adds no round trip to what the user did;
//   - a page view with `recordToolOpen`: ONE `open` a visit.
// ---------------------------------------------------------------------------

export type ToolEventProps = Record<string, string | number | boolean | null>;

const MAX_PROPS = 12;
const MAX_STRING = 120;

export function sanitizeToolEventProps(props: unknown): ToolEventProps {
  if (!props || typeof props !== "object" || Array.isArray(props)) return {};
  const out: ToolEventProps = {};
  for (const [key, value] of Object.entries(props as Record<string, unknown>)) {
    if (Object.keys(out).length >= MAX_PROPS) break;
    if (!/^[a-z][a-z0-9_]{0,31}$/.test(key)) continue;
    if (typeof value === "string") out[key] = value.slice(0, MAX_STRING);
    else if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
    else if (typeof value === "boolean" || value === null) out[key] = value;
  }
  return out;
}

/**
 * Rows ONE user may write to ONE tool's log a minute, from this instance.
 * Every refusal is recorded now, and a refusal costs nothing: without a
 * ceiling a loop over a tool route with a bad body (or a broken renderer
 * under a 300-token export) wrote a row a request. Far above anything a
 * person does (a batch of 100 cards that all fail writes 100 in several
 * minutes); past it the rows of that minute are dropped, with one log line.
 * Rows with no user (a shared sheet's visitors) share a larger one per tool.
 * In memory: no read before a write, nothing to go stale — an instance's own
 * count, which is what a loop hits.
 */
export const TOOL_EVENTS_PER_MINUTE = 120;
export const ANONYMOUS_TOOL_EVENTS_PER_MINUTE = 600;

const minuteCounts = new Map<string, { minute: number; count: number }>();

/** Count one row for `key` in the current minute; false once it is over. */
function underMinuteCap(key: string, cap: number, now = Date.now()): boolean {
  const minute = Math.floor(now / 60_000);
  if (minuteCounts.size > 5_000) {
    for (const [k, v] of minuteCounts) if (v.minute !== minute) minuteCounts.delete(k);
  }
  const entry = minuteCounts.get(key);
  if (!entry || entry.minute !== minute) {
    minuteCounts.set(key, { minute, count: 1 });
    return true;
  }
  entry.count += 1;
  if (entry.count === cap + 1) console.warn(`[tools] ${key}: more than ${cap} events this minute — the rest are dropped.`);
  return entry.count <= cap;
}

/** Write one row. Answers whether it was written (false: a name the table
 *  refuses, over the minute's ceiling, or a write that failed — logged). */
export async function recordToolEvent(input: {
  slug: string;
  userId: string | null;
  event: string;
  access: ToolAccessPath | null;
  props?: unknown;
}): Promise<boolean> {
  if (!isToolSlug(input.slug) || !TOOL_EVENT_RE.test(input.event) || !isAdminConfigured()) return false;
  const underCeiling = input.userId
    ? underMinuteCap(`${input.slug}/${input.userId}`, TOOL_EVENTS_PER_MINUTE)
    : underMinuteCap(`${input.slug}/visitors`, ANONYMOUS_TOOL_EVENTS_PER_MINUTE);
  if (!underCeiling) return false;
  try {
    const { error } = await createAdminClient()
      .from("tool_events")
      .insert({
        tool_slug: input.slug,
        user_id: input.userId,
        event: input.event,
        access: input.access,
        props: sanitizeToolEventProps(input.props),
      });
    if (error) console.warn(`[tools] ${input.slug}/${input.event} not recorded:`, error.message);
    return !error;
  } catch (error) {
    console.warn(
      `[tools] ${input.slug}/${input.event} not recorded:`,
      error instanceof Error ? error.message : error,
    );
    return false;
  }
}

type ToolEventInput = Parameters<typeof recordToolEvent>[0];

/**
 * The same write, after the response is on its way (lib/api/after-response):
 * what a tool action calls. Never awaited, never able to fail the action.
 * Identity is passed in as plain values — nothing inside re-reads the
 * session.
 */
export function recordToolEventLater(input: ToolEventInput): void {
  if (!isAdminConfigured()) return;
  afterResponse(() => recordToolEvent(input));
}

/** A visit: opens of one tool by one user closer together than this are
 *  the same one. */
export const TOOL_VISIT_GAP_MS = 30 * 60_000;

/**
 * A tool page's `open` — ONE a visit. A tool page is rendered again after
 * every server action that revalidates it, every `router.refresh()` (the
 * re-art studio's poll, the collection browser's filters) and every reload,
 * and each render used to write an `open`: a session of adding cards read
 * as dozens of visits. An `open` by this user of this tool in the last
 * TOOL_VISIT_GAP_MS means this is still that visit. Answers whether it
 * wrote one. Best effort: an unreadable log records nothing (never a guess
 * that inflates the count).
 */
export async function recordToolOpen(input: {
  slug: string;
  userId: string;
  access: ToolAccessPath | null;
  props?: unknown;
  now?: Date;
}): Promise<boolean> {
  return recordToolEventOncePerVisit({ ...input, event: "open" });
}

/**
 * Any event a page RENDER records (a view of the page computed something:
 * "Decks you can build") — once a visit, for the reason `open` is: the
 * render happens again on every refresh. An action's event is never this:
 * each press is its own.
 */
export async function recordToolEventOncePerVisit(input: {
  slug: string;
  userId: string;
  event: string;
  access: ToolAccessPath | null;
  props?: unknown;
  now?: Date;
}): Promise<boolean> {
  if (!isToolSlug(input.slug) || !TOOL_EVENT_RE.test(input.event) || !isAdminConfigured()) return false;
  const since = new Date((input.now ?? new Date()).getTime() - TOOL_VISIT_GAP_MS).toISOString();
  try {
    const { data, error } = await createAdminClient()
      .from("tool_events")
      .select("id")
      .eq("user_id", input.userId)
      .eq("tool_slug", input.slug)
      .eq("event", input.event)
      .gte("created_at", since)
      .limit(1)
      .maybeSingle();
    if (error || data) return false;
  } catch {
    return false;
  }
  return recordToolEvent({ slug: input.slug, userId: input.userId, event: input.event, access: input.access, props: input.props });
}
