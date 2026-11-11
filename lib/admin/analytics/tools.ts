import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";
import { requireAdminClient } from "@/lib/admin/users-queries";
import type { Json } from "@/types/supabase";
import type { AnalyticsPeriod } from "@/lib/admin/analytics/params";
import { TOOL_USE_EVENTS, toolBySlug } from "@/lib/tools/catalog";
import { getCreditFlow, spendingByTool } from "@/lib/admin/analytics/credits";
import {
  ALL_TOOLS,
  LEDGER_BLIND_TOOLS,
  TOOL_EVENT_LOG_LIMIT,
  TOOL_USERS_PAGE_SIZE,
  parseToolBreakdown,
  parseToolEventProps,
  type ToolBreakdown,
  type ToolOverviewRow,
  type ToolTotals,
  type ToolUserLog,
  type ToolUserRow,
  type ToolUsersPage,
  type UserToolUsageRow,
} from "@/lib/admin/analytics/tools-view";

// ---------------------------------------------------------------------------
// /admin/analytics — the Tools tab's data (2026-11): who used each beta
// tool, how often, and what happened. Service role; the page has checked
// the viewer is an admin. Every read is one of migration 0204's functions
// over `tool_events`, for the period the page asks for.
//
// WHAT COUNTS AS A USE is the app's list, TOOL_USE_EVENTS, handed to every
// reader as `p_uses` exactly as /admin/tools does (lib/tools/admin-queries.ts)
// — never a list restated in SQL. "Include admins" is `p_include_admins`.
//
// A read that fails is logged and answers null: the tab says "Couldn't load
// …" for that block, never zeros that read as "nobody used it".
// Every reader here checks the viewer is an admin ITSELF (requireAdminClient:
// null for anyone else) — the page's gate is not the only thing between a
// service-role read and a caller, so a later import of one of these into a
// route or an action cannot hand the data out.
// ---------------------------------------------------------------------------

type AdminClient = ReturnType<typeof createAdminClient>;

// WHAT A TOOL COST is the credit LEDGER's, by the tool's own spend reasons
// (credits.ts CREDIT_REASON_TOOLS) — never the tool log. An event's
// `credits` prop is a start's price, or the price of a run that was refused
// for lack of credits, or a charge that was refunded a moment later: summed,
// it read 40 credits for a run that never began.

export { LEDGER_BLIND_TOOLS };

type LedgerSpend = { bySlug: ReadonlyMap<string, number>; total: number };

/** What each tool's AI cost in a window, from the ledger. Null when the
 *  ledger could not be read. (Admins are never charged, so there is nothing
 *  of theirs to leave out; the switch is passed through all the same.) */
async function readLedgerSpend(window: { since: Date; until: Date }, includeAdmins: boolean): Promise<LedgerSpend | null> {
  const flow = await getCreditFlow(window, includeAdmins);
  if (!flow) return null;
  const { tools } = spendingByTool(flow.spentByReason);
  return {
    bySlug: new Map(tools.map((tool) => [tool.slug as string, tool.spent])),
    total: tools.reduce((sum, tool) => sum + tool.spent, 0),
  };
}

/** One tool's spend: the ledger's figure for a tool with reasons of its own
 *  (0 when nobody spent), 0 for a catalog tool with nothing to pay for, and
 *  null where nothing supports a number — the ledger was not read, the tool
 *  is ledger-blind, or the catalog no longer lists it (its reasons, if it
 *  had any, are no longer mapped to it). */
export function ledgerCreditsOf(spend: LedgerSpend | null, slug: string): number | null {
  if (!spend) return null;
  const known = spend.bySlug.get(slug);
  if (known !== undefined) return known;
  if (LEDGER_BLIND_TOOLS.includes(slug) || !toolBySlug(slug)) return null;
  return 0;
}

/** What counts as a use, per tool — the readers' `p_uses`. */
const USES = TOOL_USE_EVENTS as unknown as Json;

const iso = (date: Date) => date.toISOString();

export type ToolsOverview = {
  /** One row per tool with an event in the period. */
  rows: ToolOverviewRow[];
  /** Every tool together: a person who used three tools is one person. */
  totals: ToolTotals;
  /** The same, for the period just before. */
  previous: ToolTotals;
  /** The ledger's spend per tool for the period (for a tool with no event
   *  row of its own); null when the ledger could not be read. */
  spend: LedgerSpend | null;
};

/**
 * The all-tools view: the per-tool rows of the period, and the totals
 * across tools for the period and the one before — three reads of the tool
 * log and two of the credit ledger, in parallel.
 * The totals come from `admin_tool_breakdown('*')` and not from adding the
 * rows up: opens, uses and failures would add, PEOPLE would not.
 */
export async function getToolsOverview(period: AnalyticsPeriod, includeAdmins: boolean): Promise<ToolsOverview | null> {
  const admin = await requireAdminClient();
  if (!admin) return null;
  const scope = { p_uses: USES, p_include_admins: includeAdmins };
  const [rows, current, previous, spend, previousSpend] = await Promise.all([
    admin.rpc("admin_tools_overview", { p_since: iso(period.since), p_until: iso(period.until), ...scope }),
    admin.rpc("admin_tool_breakdown", { p_slug: ALL_TOOLS, p_since: iso(period.since), p_until: iso(period.until), ...scope }),
    admin.rpc("admin_tool_breakdown", { p_slug: ALL_TOOLS, p_since: iso(period.previousSince), p_until: iso(period.previousUntil), ...scope }),
    readLedgerSpend({ since: period.since, until: period.until }, includeAdmins),
    readLedgerSpend({ since: period.previousSince, until: period.previousUntil }, includeAdmins),
  ]);
  const failed = rows.error ?? current.error ?? previous.error;
  if (failed) {
    console.error("[admin/analytics] tools overview read failed:", failed.message);
    return null;
  }
  return {
    rows: (rows.data ?? []).map((row) => ({
      slug: row.tool_slug,
      users: Number(row.users ?? 0),
      usingUsers: Number(row.using_users ?? 0),
      opens: Number(row.opens ?? 0),
      uses: Number(row.uses ?? 0),
      failures: Number(row.failures ?? 0),
      credits: ledgerCreditsOf(spend, row.tool_slug),
      lastEventAt: row.last_event_at ?? null,
    })),
    // Across tools: what the tools with spend reasons of their own cost.
    totals: { ...parseToolBreakdown(current.data).totals, credits: spend ? spend.total : null },
    previous: { ...parseToolBreakdown(previous.data).totals, credits: previousSpend ? previousSpend.total : null },
    spend,
  };
}

export type ToolNumbers = {
  /** The period: totals, the day series, every event, why failures failed. */
  current: ToolBreakdown;
  /** The period just before, for "vs the previous N days". */
  previous: ToolTotals;
};

/** One tool's numbers for the period and the one before. */
export async function getToolNumbers(slug: string, period: AnalyticsPeriod, includeAdmins: boolean): Promise<ToolNumbers | null> {
  const admin = await requireAdminClient();
  if (!admin) return null;
  const scope = { p_slug: slug, p_uses: USES, p_include_admins: includeAdmins };
  const [current, previous, spend, previousSpend] = await Promise.all([
    admin.rpc("admin_tool_breakdown", { p_since: iso(period.since), p_until: iso(period.until), ...scope }),
    admin.rpc("admin_tool_breakdown", { p_since: iso(period.previousSince), p_until: iso(period.previousUntil), ...scope }),
    readLedgerSpend({ since: period.since, until: period.until }, includeAdmins),
    readLedgerSpend({ since: period.previousSince, until: period.previousUntil }, includeAdmins),
  ]);
  const failed = current.error ?? previous.error;
  if (failed) {
    console.error(`[admin/analytics] ${slug} numbers read failed:`, failed.message);
    return null;
  }
  const now = parseToolBreakdown(current.data);
  return {
    current: { ...now, totals: { ...now.totals, credits: ledgerCreditsOf(spend, slug) } },
    previous: { ...parseToolBreakdown(previous.data).totals, credits: ledgerCreditsOf(previousSpend, slug) },
  };
}

/**
 * EVERY signed-in person with an event of the tool in the period, a page at
 * a time (most uses first). `total` is all of them, whatever the page — a
 * page past the end asks once more for the count alone, so the tab can say
 * where the list really ends.
 */
export async function getToolUsers(
  slug: string,
  period: AnalyticsPeriod,
  includeAdmins: boolean,
  page: number,
): Promise<ToolUsersPage | null> {
  const admin = await requireAdminClient();
  if (!admin) return null;
  const read = (limit: number, offset: number) =>
    admin.rpc("admin_tool_users", {
      p_slug: slug,
      p_since: iso(period.since),
      p_until: iso(period.until),
      p_uses: USES,
      p_include_admins: includeAdmins,
      p_limit: limit,
      p_offset: offset,
    });
  const { data, error } = await read(TOOL_USERS_PAGE_SIZE, (page - 1) * TOOL_USERS_PAGE_SIZE);
  if (error) {
    console.error(`[admin/analytics] ${slug} users read failed:`, error.message);
    return null;
  }
  const rows: ToolUserRow[] = (data ?? []).map((row) => ({
    userId: row.user_id,
    username: row.username ?? null,
    isAdmin: row.is_admin === true,
    access: row.access ?? null,
    opens: Number(row.opens ?? 0),
    uses: Number(row.uses ?? 0),
    failures: Number(row.failures ?? 0),
    activeDays: Number(row.active_days ?? 0),
    firstAt: row.first_at,
    lastAt: row.last_at,
  }));
  let total = Number(data?.[0]?.total_count ?? 0);
  if (rows.length === 0 && page > 1) {
    const first = await read(1, 0);
    if (first.error) {
      console.error(`[admin/analytics] ${slug} users count read failed:`, first.error.message);
      return null;
    }
    total = Number(first.data?.[0]?.total_count ?? 0);
  }
  return { rows, total, page, pageSize: TOOL_USERS_PAGE_SIZE };
}

/** One person's newest events of one tool (whenever they happened), and
 *  their handle for the heading. */
export async function getToolUserLog(slug: string, userId: string): Promise<ToolUserLog | null> {
  const admin = await requireAdminClient();
  if (!admin) return null;
  const [events, person] = await Promise.all([
    admin.rpc("admin_tool_user_events", { p_slug: slug, p_user_id: userId, p_limit: TOOL_EVENT_LOG_LIMIT }),
    admin.from("profiles").select("username").eq("id", userId).maybeSingle(),
  ]);
  if (events.error) {
    console.error(`[admin/analytics] ${slug} event log read failed:`, events.error.message);
    return null;
  }
  // The handle only names the heading: without it the log still reads.
  if (person.error) console.warn("[admin/analytics] event log profile read failed:", person.error.message);
  return {
    username: person.data?.username ?? null,
    events: (events.data ?? []).map((row) => ({
      at: row.created_at,
      event: row.event,
      access: row.access ?? null,
      props: parseToolEventProps(row.props),
    })),
  };
}

/**
 * The tools one account has touched, all time — the admin Users page's
 * "Tools used". Null when it could not be read — a database 0204 has not
 * reached yet (the app can deploy first) included: the page then says it
 * couldn't load, never "hasn't opened a tool yet", which would be a claim
 * about the account that nothing was read to support.
 */
export async function getUserToolUsage(admin: AdminClient, userId: string): Promise<UserToolUsageRow[] | null> {
  const { data, error } = await admin.rpc("admin_user_tool_usage", { p_user_id: userId, p_uses: USES });
  if (error) {
    // PGRST202: the function is not there yet — quiet, and still "not read".
    if (error.code !== "PGRST202") console.error("[admin/users] tools used read failed:", error.message);
    return null;
  }
  return (data ?? []).map((row) => ({
    slug: row.tool_slug,
    opens: Number(row.opens ?? 0),
    uses: Number(row.uses ?? 0),
    failures: Number(row.failures ?? 0),
    lastAt: row.last_at ?? null,
  }));
}
