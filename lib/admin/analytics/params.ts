// ---------------------------------------------------------------------------
// /admin/analytics — the page's URL state (2026-11, the analytics audit).
//
// Everything the page shows is decided by its address: the open TAB, the
// PERIOD (7 / 30 / 90 days), whether admins' own activity is counted, and a
// tab's own selection (a tool, a user's event log, a page of a table). Tabs
// and filters are plain links, so a view can be bookmarked and sent, and
// only the open tab's queries run.
//
// Client-safe (no imports): the nav, the tabs and the tests share it.
// ---------------------------------------------------------------------------

export const ANALYTICS_PATH = "/admin/analytics";

export const ANALYTICS_TABS = [
  { id: "overview", label: "Overview" },
  { id: "funnel", label: "Funnel" },
  { id: "revenue", label: "Revenue" },
  { id: "credits", label: "Credits and AI" },
  { id: "referrals", label: "Referrals" },
  { id: "tools", label: "Tools" },
  { id: "content", label: "Content" },
] as const;

export type AnalyticsTabId = (typeof ANALYTICS_TABS)[number]["id"];

export const ANALYTICS_RANGES = [7, 30, 90] as const;
export type AnalyticsRange = (typeof ANALYTICS_RANGES)[number];
export const DEFAULT_ANALYTICS_RANGE: AnalyticsRange = 30;

/** The tabs whose numbers can leave the team's own accounts out — the
 *  "Include admins" switch shows on these only. Revenue is money taken
 *  whoever paid it, and a referral is a referral. */
export const ADMIN_FILTER_TABS: readonly AnalyticsTabId[] = ["overview", "funnel", "credits", "tools", "content"];

export type AnalyticsParams = {
  tab: AnalyticsTabId;
  days: AnalyticsRange;
  /** Count admins' own activity too (off by default: in beta it is most of it). */
  admins: boolean;
  /** Tools tab: the tool whose detail is open. */
  tool: string | null;
  /** Tools tab: the user whose event log is open (a uuid). */
  user: string | null;
  /** A table's page, 1-based. */
  page: number;
};

type Raw = Record<string, string | string[] | undefined>;
const one = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z][a-z0-9-]{1,47}$/;

export function parseAnalyticsParams(raw: Raw): AnalyticsParams {
  const tab = one(raw.tab);
  const days = Number(one(raw.days));
  const tool = one(raw.tool);
  const user = one(raw.user);
  const page = Number(one(raw.page));
  return {
    tab: ANALYTICS_TABS.some((t) => t.id === tab) ? (tab as AnalyticsTabId) : "overview",
    days: (ANALYTICS_RANGES as readonly number[]).includes(days) ? (days as AnalyticsRange) : DEFAULT_ANALYTICS_RANGE,
    admins: one(raw.admins) === "1",
    tool: tool && SLUG.test(tool) ? tool : null,
    user: user && UUID.test(user) ? user.toLowerCase() : null,
    page: Number.isInteger(page) && page >= 1 && page <= 10_000 ? page : 1,
  };
}

/**
 * The address of a view: `params` with `patch` applied. Defaults are left
 * out, so the plain page is `/admin/analytics`. Changing the tab drops the
 * tab's own selection (tool, user, page); changing anything but `page`
 * goes back to page 1.
 */
export function analyticsHref(params: AnalyticsParams, patch: Partial<AnalyticsParams> = {}): string {
  const next: AnalyticsParams = { ...params, ...patch };
  if (patch.tab !== undefined && patch.tab !== params.tab) {
    next.tool = patch.tool ?? null;
    next.user = patch.user ?? null;
  }
  if (patch.tool !== undefined && patch.tool !== params.tool) next.user = patch.user ?? null;
  if (patch.page === undefined) next.page = 1;
  const query = new URLSearchParams();
  if (next.tab !== "overview") query.set("tab", next.tab);
  if (next.days !== DEFAULT_ANALYTICS_RANGE) query.set("days", String(next.days));
  if (next.admins) query.set("admins", "1");
  if (next.tool) query.set("tool", next.tool);
  if (next.user) query.set("user", next.user);
  if (next.page > 1) query.set("page", String(next.page));
  const text = query.toString();
  return text ? `${ANALYTICS_PATH}?${text}` : ANALYTICS_PATH;
}

export type AnalyticsPeriod = {
  days: AnalyticsRange;
  /** The period: [since, until). `since` is the start of a UTC day, so the
   *  totals and a per-day chart count the same rows; `until` is now, so
   *  today counts as far as it has got. */
  since: Date;
  until: Date;
  /**
   * What it is compared with: [previousSince, previousUntil) — the SAME
   * stretch `days` days earlier, cut at the same time of day. So the two are
   * exactly as long as each other. (Comparing a period whose last day is
   * part-way through with N whole days read every steady number as a fall:
   * −13% on the 7-day view in the small hours.) The rest of that earlier
   * day belongs to neither period.
   */
  previousSince: Date;
  previousUntil: Date;
  /** The period's UTC days, oldest first: `days` of them, ending today. */
  dayKeys: string[];
};

const DAY_MS = 86_400_000;

/** The period a view covers: the last `days` UTC days, today included. */
export function analyticsPeriod(days: AnalyticsRange, now: Date = new Date()): AnalyticsPeriod {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const since = new Date(today - (days - 1) * DAY_MS);
  const previousSince = new Date(since.getTime() - days * DAY_MS);
  const previousUntil = new Date(now.getTime() - days * DAY_MS);
  const dayKeys = Array.from({ length: days }, (_, i) => new Date(since.getTime() + i * DAY_MS).toISOString().slice(0, 10));
  return { days, since, until: now, previousSince, previousUntil, dayKeys };
}

/** "the last 30 days" / "the previous 30 days". */
export const periodLabel = (days: number) => `the last ${days} days`;
export const previousPeriodLabel = (days: number) => `the previous ${days} days`;
