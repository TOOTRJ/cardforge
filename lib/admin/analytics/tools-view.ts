import type { AnalyticsParams } from "@/lib/admin/analytics/params";
import { analyticsHref } from "@/lib/admin/analytics/params";
import { formatCount, formatRate } from "@/lib/admin/analytics/series";
import { TOOL_CATALOG, toolBySlug, toolEventKind, type ToolDefinition, type ToolEventKind } from "@/lib/tools/catalog";

// ---------------------------------------------------------------------------
// /admin/analytics — the Tools tab's shapes and words (2026-11): what
// migration 0204's readers answer, read defensively, and how a row is said
// to a person. Pure and client-safe: the data module (tools.ts, server-only),
// the tab's components and the tests share it.
//
// The vocabulary is the tools' own (lib/tools/catalog.ts): an OPEN is a
// visit to a tool's page, a USE is the tool doing one of its jobs
// (TOOL_USE_EVENTS), a FAILURE is a refusal or an error (`…_failed`,
// `…_refused`, `…_lost`), anything else is a step on the way.
// ---------------------------------------------------------------------------

/** `admin_tool_breakdown`'s slug for every tool together (never a tool's:
 *  a slug starts with a letter). */
export const ALL_TOOLS = "*";

/** People per page of "Everyone who used it". */
export const TOOL_USERS_PAGE_SIZE = 50;

/** Rows of one person's event log. */
export const TOOL_EVENT_LOG_LIMIT = 100;

export type ToolTotals = {
  /** Distinct signed-in people with any event. */
  users: number;
  /** Distinct signed-in people with a use. */
  usingUsers: number;
  opens: number;
  uses: number;
  failures: number;
  /** Credits spent on the tool's AI in the period — the credit LEDGER's, by
   *  the tool's own spend reasons (lib/admin/analytics/credits.ts), never an
   *  event's `credits` prop (a start's price, a refused run's price). Null
   *  where the ledger cannot tell (Token Kit's art spends as a card fill)
   *  or could not be read. Filled in by the loader, not by the tool log. */
  credits: number | null;
  /** Events with no account behind them (a shared sheet's visitors, or an
   *  account since deleted). */
  visitorEvents: number;
  lastEventAt: string | null;
};

export type ToolOverviewRow = {
  slug: string;
  users: number;
  usingUsers: number;
  opens: number;
  uses: number;
  failures: number;
  /** The ledger's (see ToolTotals.credits). */
  credits: number | null;
  lastEventAt: string | null;
};

export type ToolDailyPoint = { day: string; opens: number; uses: number; failures: number; users: number };
export type ToolEventRow = { event: string; count: number; users: number };
export type ToolReasonRow = { event: string; reason: string; count: number };

export type ToolBreakdown = {
  totals: ToolTotals;
  /** Every UTC day of the period, oldest first, zero-filled. */
  daily: ToolDailyPoint[];
  /** Every event name, most frequent first. */
  events: ToolEventRow[];
  /** Failures that carry a reason, most frequent first. */
  reasons: ToolReasonRow[];
};

export type ToolUserRow = {
  userId: string;
  username: string | null;
  isAdmin: boolean;
  /** The path of their newest event: 'admin' | 'grant' | 'release'. */
  access: string | null;
  opens: number;
  uses: number;
  failures: number;
  activeDays: number;
  firstAt: string;
  lastAt: string;
};

export type ToolUsersPage = {
  rows: ToolUserRow[];
  /** Everyone with an event of the tool in the period, not just this page. */
  total: number;
  page: number;
  pageSize: number;
};

export type ToolEventProps = Record<string, unknown>;
export type ToolUserEvent = { at: string; event: string; access: string | null; props: ToolEventProps };
export type ToolUserLog = { username: string | null; events: ToolUserEvent[] };

export type UserToolUsageRow = { slug: string; opens: number; uses: number; failures: number; lastAt: string | null };

// ---- reading what the database answers ------------------------------------

const num = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : 0;
const text = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const object = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** The tools whose AI the credit ledger cannot tell from the card creator's:
 *  Token Kit's art spends as `fill_card`, the reason every creator fill
 *  uses. Their "Credits spent" is "not known", never a number. */
export const LEDGER_BLIND_TOOLS: readonly string[] = ["token-kit"];

export const EMPTY_TOOL_TOTALS: ToolTotals = {
  users: 0,
  usingUsers: 0,
  opens: 0,
  uses: 0,
  failures: 0,
  credits: null,
  visitorEvents: 0,
  lastEventAt: null,
};

export function parseToolTotals(raw: unknown): ToolTotals {
  const o = object(raw);
  return {
    users: num(o.users),
    usingUsers: num(o.using_users),
    opens: num(o.opens),
    uses: num(o.uses),
    failures: num(o.failures),
    // Not in the tool log: the loader reads it from the ledger.
    credits: null,
    visitorEvents: num(o.visitor_events),
    lastEventAt: text(o.last_event_at),
  };
}

/** `admin_tool_breakdown`'s jsonb: a missing number is 0, a row with no
 *  name is dropped. */
export function parseToolBreakdown(raw: unknown): ToolBreakdown {
  const o = object(raw);
  return {
    totals: parseToolTotals(o.totals),
    daily: list(o.daily).flatMap((item) => {
      const d = object(item);
      const day = text(d.day);
      return day ? [{ day, opens: num(d.opens), uses: num(d.uses), failures: num(d.failures), users: num(d.users) }] : [];
    }),
    events: list(o.events).flatMap((item) => {
      const e = object(item);
      const event = text(e.event);
      return event ? [{ event, count: num(e.count), users: num(e.users) }] : [];
    }),
    reasons: list(o.reasons).flatMap((item) => {
      const r = object(item);
      const event = text(r.event);
      const reason = text(r.reason);
      return event && reason ? [{ event, reason, count: num(r.count) }] : [];
    }),
  };
}

/** An event's props as the log shows them: an object, or nothing. */
export function parseToolEventProps(raw: unknown): ToolEventProps {
  return object(raw);
}

// ---- the list of tools -----------------------------------------------------

export type ToolListRow = ToolOverviewRow & {
  name: string;
  /** False for a slug the log holds that the catalog no longer lists. */
  inCatalog: boolean;
};

const CATALOG: readonly ToolDefinition[] = TOOL_CATALOG;

/**
 * Every tool the page lists: each BUILT tool of the catalog — zeros when it
 * has no event in the period — then any slug the log holds that the catalog
 * doesn't (a removed tool keeps its numbers under its slug), so the list
 * always adds up to the totals. Most uses first; ties keep the catalog's
 * order.
 */
export function toolListRows(rows: readonly ToolOverviewRow[]): ToolListRow[] {
  const bySlug = new Map(rows.map((row) => [row.slug, row]));
  const zero = (slug: string): ToolOverviewRow => ({
    slug,
    users: 0,
    usingUsers: 0,
    opens: 0,
    uses: 0,
    failures: 0,
    credits: null,
    lastEventAt: null,
  });
  const listed: ToolListRow[] = CATALOG.filter((tool) => tool.built || bySlug.has(tool.slug)).map((tool) => ({
    ...(bySlug.get(tool.slug) ?? zero(tool.slug)),
    name: tool.name,
    inCatalog: true,
  }));
  const others: ToolListRow[] = rows
    .filter((row) => !toolBySlug(row.slug))
    .map((row) => ({ ...row, name: row.slug, inCatalog: false }));
  return [...listed, ...others]
    .map((row, index) => ({ row, index }))
    .sort((a, b) => b.row.uses - a.row.uses || a.index - b.index)
    .map(({ row }) => row);
}

/** A tool's name, or its slug when the catalog doesn't list it. */
export function toolNameOf(slug: string): string {
  return toolBySlug(slug)?.name ?? slug;
}

// ---- words -----------------------------------------------------------------

/** "63%": uses out of everything that was tried (uses + failures); "—" when
 *  nothing was. */
export function successRate(uses: number, failures: number): string {
  return formatRate(uses, uses + failures);
}

/** "1 person" / "12 people". */
export function peopleText(count: number): string {
  return `${formatCount(count)} ${count === 1 ? "person" : "people"}`;
}

/** An event's or a prop's name as words: `ai_build_failed` → "ai build failed". */
export function eventWords(name: string): string {
  return name.replace(/_/g, " ");
}

const KIND_WORDS: Record<ToolEventKind, string> = {
  open: "Visit",
  use: "Use",
  failure: "Failure",
  other: "Step",
};

/** What an event is, in a word: Visit / Use / Failure / Step. */
export function eventKindWords(slug: string, event: string): string {
  return KIND_WORDS[toolEventKind(slug, event)];
}

const KIND_ORDER: Record<ToolEventKind, number> = { use: 0, failure: 1, open: 2, other: 2 };

export type ToolEventListRow = ToolEventRow & { kind: ToolEventKind; kindWords: string };

/** "What happened": uses first, then failures, then the rest — each group
 *  in the order given (most frequent first). */
export function orderToolEvents(slug: string, events: readonly ToolEventRow[]): ToolEventListRow[] {
  return events
    .map((row, index) => {
      const kind = toolEventKind(slug, row.event);
      return { row: { ...row, kind, kindWords: KIND_WORDS[kind] }, index };
    })
    .sort((a, b) => KIND_ORDER[a.row.kind] - KIND_ORDER[b.row.kind] || a.index - b.index)
    .map(({ row }) => row);
}

// Maps, not objects: a code is whatever a row holds, and `toString` is not
// a reason.
const REASON_WORDS: ReadonlyMap<string, string> = new Map([
  ["insufficient_credits", "Out of credits"],
  ["rate_limited", "Too many at once"],
  ["daily_limit", "Daily limit reached"],
  ["capacity", "Card limit reached"],
  ["invalid", "Couldn't read the request"],
  ["ai_unavailable", "AI unavailable"],
  ["upgrade_required", "Needs a higher plan"],
]);

/**
 * Why something failed, in plain words: the reasons every tool shares
 * (lib/tools/catalog.ts toolReasonOfCode) by name, anything else as its
 * code with the underscores as spaces.
 */
export function failureReasonWords(reason: string): string {
  return REASON_WORDS.get(reason) ?? eventWords(reason);
}

/** A row of "Why things failed": `ai build failed · Out of credits`. */
export function failureLabel(row: Pick<ToolReasonRow, "event" | "reason">): string {
  return `${eventWords(row.event)} · ${failureReasonWords(row.reason)}`;
}

const ACCESS_WORDS: ReadonlyMap<string, string> = new Map([
  ["admin", "As an admin"],
  ["grant", "Tester access"],
  ["release", "Their plan"],
]);

/** How someone got into a tool (tool_events.access), in words. */
export function accessWords(access: string | null): string {
  return access ? (ACCESS_WORDS.get(access) ?? eventWords(access)) : "—";
}

/**
 * An event's props as `key: value` pairs for the log: keys with their
 * underscores as spaces, values as TEXT (yes / no for a boolean, "—" for
 * null). Props are counts, codes and booleans (lib/tools/events.ts); a
 * value of any other shape is shown as its JSON, never interpreted.
 */
export function propPairs(props: unknown): Array<{ key: string; value: string }> {
  return Object.entries(object(props)).map(([key, value]) => ({
    key: eventWords(key),
    value:
      value === null || value === undefined
        ? "—"
        : typeof value === "boolean"
          ? value
            ? "yes"
            : "no"
          : typeof value === "number"
            ? Number.isInteger(value)
              ? formatCount(value)
              : String(value)
            : typeof value === "string"
              ? value
              : JSON.stringify(value),
  }));
}

// ---- paging and links ------------------------------------------------------

/** "Showing a–b of N" and how many pages there are. */
export function pageWindow(page: number, pageSize: number, total: number): { from: number; to: number; pages: number } {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : Math.min(total, (page - 1) * pageSize + 1);
  const to = Math.min(total, page * pageSize);
  return { from, to, pages };
}

const BLANK: AnalyticsParams = { tab: "tools", days: 30, admins: false, tool: null, user: null, page: 1 };

/** The Tools tab, all tools. */
export function toolsAnalyticsHref(): string {
  return analyticsHref(BLANK);
}

/** One tool's analytics over `days` (the admin tool page's own period). */
export function toolAnalyticsHref(slug: string, days: AnalyticsParams["days"] = 30): string {
  return analyticsHref({ ...BLANK, days, tool: slug });
}

/** Where a person's event log sits on a tool's view (the block's id). */
export const EVENT_LOG_ANCHOR = "event-log";

/** Where "Everyone who used it" sits on a tool's view. */
export const PEOPLE_ANCHOR = "people";

/**
 * One person's event log in one tool, from the admin Users page: 90 days
 * and admins included, so the person is on the list whoever they are —
 * landing on the log itself.
 */
export function userToolLogHref(slug: string, userId: string): string {
  return `${analyticsHref({ ...BLANK, days: 90, admins: true, tool: slug, user: userId })}#${EVENT_LOG_ANCHOR}`;
}
