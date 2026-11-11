import "server-only";

import { requireAdminClient } from "./users-queries";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { FunnelEvent } from "@/lib/analytics/funnel-events";
import { attributionSource, attributionSurface, sanitizeAttribution } from "@/lib/analytics/attribution";
import { SCREEN_WIDTH_BUCKETS, type ScreenWidthBucket } from "@/lib/analytics/screen-width";
import { selectAllRows } from "@/lib/supabase/select-all-rows";
import type { AnalyticsPeriod } from "@/lib/admin/analytics/params";
import { fillDays, type DayPoint } from "@/lib/admin/analytics/series";

// ---------------------------------------------------------------------------
// The Funnel tab's data (/admin/analytics, the 2026-11 analytics audit).
//
// Everything is read for ONE PERIOD — [since, until), `since` the start of a
// UTC day — and, where a number is compared, for the same stretch N days
// earlier, [previousSince, previousUntil) (lib/admin/analytics/params.ts).
// What changed with the page:
//   - the windows were hard-coded (7 and 30 days back from "now"); they are
//     the page's period and the previous one, read in parallel;
//   - "Rate 30d" is gone: it divided one step's EVENT count by the step
//     before's — unrelated counts (109 first cards over 42 signups). The
//     honest question — of the people who signed up, how many got how far —
//     is the COHORT (admin_funnel_cohort, migration 0200);
//   - each trial is measured over its own length, not a fixed 7 days.
//
// The pure shaping is exported and unit-tested; the reads are the SQL
// functions of 0200 plus paged row reads. A read that fails is NULL (the tab
// says it could not load), never zeros and never part of a list.
// ---------------------------------------------------------------------------

type AdminClient = ReturnType<typeof createAdminClient>;

export type FunnelCounts = Partial<Record<FunnelEvent, { n: number; users: number }>>;

/** One step of a section's table: this period beside the one before. `users`
 *  are the distinct signed-in people behind the count (0 for a step visitors
 *  take before they have an account). */
export type FunnelStep = {
  key: FunnelEvent;
  label: string;
  n: number;
  users: number;
  previousN: number;
  previousUsers: number;
};
export type FunnelSection = { title: string; steps: FunnelStep[] };
export type SignupSource = { source: string; n: number };
export type SignupSurface = { surface: string; n: number };
/** One row of "Cancellations by reason": the portal's feedback choice when
 *  the customer gave one, else Stripe's cancellation reason. */
export type CancelReasonRow = { reason: string; label: string; n: number };
/** One step of the cohort: how many of the period's new accounts have
 *  reached it, at any time since. */
export type CohortStep = { key: CohortStepKey; label: string; users: number };
/** How the period's accounts were made. */
export type SignupMethodRow = { method: string; label: string; n: number };
export type SignupsDaily = {
  /** One point per UTC day of the period, oldest first, zero-filled. */
  points: DayPoint[];
  /** Biggest first; only the ways somebody used. */
  methods: SignupMethodRow[];
  total: number;
};
export type TrialEngagementRow = {
  userId: string;
  username: string | null;
  startedAt: string;
  /** When the trial converted or lapsed; null while no end is recorded. */
  endedAt: string | null;
  /** The length it was measured over, in whole days (its own, 60 at most). */
  windowDays: number;
  /** `trial_converted` / `trial_lapsed` / `ongoing` / `unknown`. */
  outcome: string;
  activeDays: number;
  saves: number;
  generations: number;
  downloads: number;
};
/** One row of the "Screen widths" table: tab sessions per bucket and their
 *  share of every bucketed session in the period (null when there are none). */
export type ScreenWidthRow = { bucket: ScreenWidthBucket; label: string; sessions: number; share: number | null };

export type FunnelSummary = {
  /** Counts per event, this period and the one before — the headline tiles
   *  and the step tables. Null when either read failed. */
  counts: { current: FunnelCounts; previous: FunnelCounts } | null;
  /** The people who signed up in the period and how far they have come. */
  cohort: CohortStep[] | null;
  /** Signups per day and by how the account was made. */
  signups: SignupsDaily | null;
  /** Signups of the period by first-touch source. */
  signupSources: SignupSource[];
  /** Signups by the create button pressed last ("none" = no tracked button). */
  signupSurfaces: SignupSurface[];
  /** Plans that ended in the period, by the reason the customer gave in the
   *  portal (or Stripe's own reason), biggest first. */
  cancelReasons: CancelReasonRow[];
  /** A guest's card through sign-up (TODO HM3): signups made while one
   *  waited in the browser, and first cards saved from one. A null count
   *  where the read failed. */
  guestCard: { signups: number; firstCardsSaved: number | null };
  /** The row lists above are EMPTY, never partial, when their rows could
   *  not be read whole — these say which, so the tab can say so too. */
  failed: { signups: boolean; cancellations: boolean };
  /** Trials started in the period, each measured over its own length. */
  trials: TrialEngagementRow[] | null;
  /** Anonymous viewport-width buckets of the period (TODO WD9); null when
   *  the read failed — never zeros standing in for an error. */
  screenWidths: ScreenWidthRow[] | null;
};

const LABEL: Record<FunnelEvent, string> = {
  signup: "Signups",
  card_saved: "Cards saved",
  ai_generation: "AI generations",
  download: "Downloads",
  first_card_saved: "First card saved",
  first_ai_generation: "First AI generation",
  first_download: "First download",
  pricing_view: "Pricing views",
  cta_click: "CTA clicks",
  checkout_started: "Checkouts started",
  checkout_completed: "Checkouts completed",
  checkout_expired: "Checkouts expired",
  trial_started: "Trials started",
  trial_converted: "Trials converted",
  trial_lapsed: "Trials lapsed",
  subscription_started: "Paid subscriptions started",
  subscription_changed: "Plan changes",
  subscription_cancelled: "Cancellations (plan ended)",
  subscription_resumed: "Cancellations undone (resumed)",
  bank_days_applied: "Banked days applied",
  payment_received: "Payments received",
  payment_failed: "Payments failed",
  upgrade_modal_open: "Upgrade modal opens",
  nav_click: "Nav clicks",
  screen_width: "Screen-width sessions",
  pack_purchased: "Packs purchased",
  deck_created: "Decks created",
  deck_card_customized: "Deck cards customized",
  deck_export_clicked: "Deck export clicks",
  create_cta_click: "Home create-button clicks",
  guest_save_gate: "Guest creator: asked to sign up",
};

/** The step tables. Counts only: a step is never divided by the step above
 *  it (different people, different visits) — the cohort answers that. */
const SECTIONS: Array<{ title: string; chain: FunnelEvent[] }> = [
  { title: "Activation", chain: ["signup", "first_card_saved", "first_ai_generation", "first_download"] },
  { title: "Storefront", chain: ["pricing_view", "cta_click", "checkout_started", "checkout_completed"] },
  { title: "Trials", chain: ["trial_started", "trial_converted"] },
  { title: "Out of credits", chain: ["upgrade_modal_open", "pack_purchased"] },
  { title: "Money", chain: ["payment_received", "subscription_started", "subscription_changed", "subscription_cancelled", "subscription_resumed"] },
  { title: "Leaks", chain: ["checkout_expired", "trial_lapsed", "payment_failed"] },
  // The deck plan's upgrade moments (TODO DK3.8).
  { title: "Decks", chain: ["deck_created", "deck_card_customized", "deck_export_clicked"] },
  // The home page's create buttons (TODO HM2) — never in the Storefront
  // list, whose steps are billing moments alone.
  { title: "Home create buttons", chain: ["create_cta_click"] },
  // A guest's Save or AI press that asked for a sign-up (TODO HM3).
  { title: "Guest creator", chain: ["guest_save_gate"] },
];

/** Pure: every section's steps, this period beside the previous one. */
export function buildFunnel(current: FunnelCounts, previous: FunnelCounts = {}): FunnelSection[] {
  return SECTIONS.map(({ title, chain }) => ({
    title,
    steps: chain.map((key) => {
      const now = current[key] ?? { n: 0, users: 0 };
      const before = previous[key] ?? { n: 0, users: 0 };
      return { key, label: LABEL[key], n: now.n, users: now.users, previousN: before.n, previousUsers: before.users };
    }),
  }));
}

/** The cohort's steps, in funnel order (migration 0200 answers the same six). */
export const COHORT_STEPS = [
  "signup",
  "first_card_saved",
  "first_ai_generation",
  "first_download",
  "trial_started",
  "trial_converted",
] as const;
export type CohortStepKey = (typeof COHORT_STEPS)[number];

const COHORT_LABEL: Record<CohortStepKey, string> = {
  signup: "Signed up",
  first_card_saved: "Saved a first card",
  first_ai_generation: "Made a first AI generation",
  first_download: "Downloaded a card",
  trial_started: "Started a trial",
  trial_converted: "Trial became a paid plan",
};

/** Pure: the cohort in funnel order whatever order the rows came in; a step
 *  the read did not name is 0. */
export function buildCohort(rows: ReadonlyArray<{ step: string; users: number | string }>): CohortStep[] {
  const byStep = new Map(rows.map((row) => [row.step, Number(row.users) || 0]));
  return COHORT_STEPS.map((key) => ({ key, label: COHORT_LABEL[key], users: byStep.get(key) ?? 0 }));
}

/** The label of a signup whose first touch was never recorded: a row
 *  migration 0197 wrote for an account that had none (made with Google or
 *  Discord before those were recorded, or older than the funnel). Its own
 *  line — never "direct" or "none", which say the visitor came with no
 *  referrer and pressed no button. */
export const SIGNUP_NOT_RECORDED = "not recorded";

/** How an account was made, in the order the list breaks ties. Migration
 *  0200 counts a row with no method as `email` (until 0197 the email form
 *  was the only writer of a signup row), so `not recorded` no longer comes
 *  back from it; its label stays for an older database. An unknown value
 *  prints as it came. */
const SIGNUP_METHOD_LABEL: Record<string, string> = {
  email: "Email",
  google: "Google",
  discord: "Discord",
  other: "Other",
  [SIGNUP_NOT_RECORDED]: "Not recorded",
};
const SIGNUP_METHOD_ORDER = Object.keys(SIGNUP_METHOD_LABEL);

/** Pure: admin_signups_daily's rows as one zero-filled point per day of the
 *  period and one row per method, biggest first. Both add up to `total`
 *  (a row of a day outside the period is in neither). */
export function buildSignupsDaily(
  dayKeys: readonly string[],
  rows: ReadonlyArray<{ day: string; method: string; n: number | string }>,
): SignupsDaily {
  const days = new Set(dayKeys);
  const inPeriod = rows
    .map((row) => ({ day: String(row.day).slice(0, 10), method: row.method, n: Number(row.n) || 0 }))
    .filter((row) => days.has(row.day));
  const byMethod = new Map<string, number>();
  for (const row of inPeriod) byMethod.set(row.method, (byMethod.get(row.method) ?? 0) + row.n);
  const rank = (method: string) => {
    const index = SIGNUP_METHOD_ORDER.indexOf(method);
    return index === -1 ? SIGNUP_METHOD_ORDER.length : index;
  };
  const methods = [...byMethod.entries()]
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1] || rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]))
    .map(([method, n]) => ({ method, label: SIGNUP_METHOD_LABEL[method] ?? method, n }));
  return {
    points: fillDays(
      dayKeys,
      inPeriod.map((row) => ({ day: row.day, value: row.n })),
    ),
    methods,
    total: inPeriod.reduce((sum, row) => sum + row.n, 0),
  };
}

/** Pure: count signup rows by one attribution label, biggest first. */
function groupSignupsBy(rows: Array<{ props: unknown }>, labelOf: (props: Record<string, unknown>) => string, limit: number) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const props = row.props && typeof row.props === "object" ? (row.props as Record<string, unknown>) : {};
    const label = labelOf(props);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return withRest(
    [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
    limit,
  );
}

/** The row a long list ends on: what is past the `limit` biggest, added up
 *  — so a list always adds up to the number it breaks down (a "top 8" alone
 *  came to less than the Signups tile beside it, with nothing saying why). */
export const FUNNEL_LIST_REST = "everything else";

function withRest(sorted: Array<[string, number]>, limit: number): Array<[string, number]> {
  if (sorted.length <= limit) return sorted;
  const rest = sorted.slice(limit).reduce((sum, [, n]) => sum + n, 0);
  return [...sorted.slice(0, limit), [FUNNEL_LIST_REST, rest]];
}

const wasBackfilled = (props: unknown) =>
  Boolean(props && typeof props === "object" && (props as Record<string, unknown>).backfilled === true);

/** Pure: group signup rows by first-touch source, biggest first. */
export function groupSignupSources(rows: Array<{ props: unknown }>, limit = 8): SignupSource[] {
  return groupSignupsBy(
    rows,
    (props) => (wasBackfilled(props) ? SIGNUP_NOT_RECORDED : attributionSource(sanitizeAttribution(props))),
    limit,
  ).map(([source, n]) => ({ source, n }));
}

/** The portal's feedback options (`cancellation_details.feedback`) and
 *  Stripe's own reasons (`cancellation_details.reason`), in the customer's
 *  words. An unknown value prints as it came. */
const CANCEL_REASON_LABEL: Record<string, string> = {
  too_expensive: "Too expensive",
  missing_features: "Missing features",
  switched_service: "Switched to another service",
  unused: "Didn't use it enough",
  customer_service: "Customer service",
  too_complex: "Too complex",
  low_quality: "Quality not good enough",
  other: "Other",
  cancellation_requested: "Cancelled, no reason given",
  payment_disputed: "Payment disputed",
  payment_failed: "Payment failed (retries exhausted)",
  none: "No reason recorded",
};

/** Pure: `subscription_cancelled` rows grouped by the customer's reason —
 *  the portal's feedback when given, else Stripe's reason — biggest first,
 *  ties alphabetical. Stripe audit 2026-11-05: the portal has asked the
 *  question since 2026-09; this is where the answers show. */
export function groupCancelReasons(rows: Array<{ props: unknown }>, limit = 10): CancelReasonRow[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const props = row.props && typeof row.props === "object" ? (row.props as Record<string, unknown>) : {};
    const feedback = typeof props.cancelFeedback === "string" && props.cancelFeedback ? props.cancelFeedback : null;
    const reason = typeof props.cancelReason === "string" && props.cancelReason ? props.cancelReason : null;
    const key = feedback ?? reason ?? "none";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return withRest(
    [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
    limit,
  ).map(([reason, n]) => ({
    reason,
    label: reason === FUNNEL_LIST_REST ? "Everything else" : (CANCEL_REASON_LABEL[reason] ?? reason),
    n,
  }));
}

/** Pure: how many signup rows say a guest's card waited (TODO HM3). */
export function countGuestDraftSignups(rows: Array<{ props: unknown }>): number {
  return rows.filter((row) => {
    const props = row.props && typeof row.props === "object" ? (row.props as Record<string, unknown>) : {};
    return props.guestDraft === true;
  }).length;
}

/** Pure: group signup rows by the create button pressed last, biggest first. */
export function groupSignupSurfaces(rows: Array<{ props: unknown }>, limit = 8): SignupSurface[] {
  return groupSignupsBy(
    rows,
    (props) => (wasBackfilled(props) ? SIGNUP_NOT_RECORDED : attributionSurface(sanitizeAttribution(props))),
    limit,
  ).map(([surface, n]) => ({ surface, n }));
}

/** Pure: every bucket in width order (empty ones too, so the table's shape
 *  never moves), each with its share of the total to one decimal. */
export function buildScreenWidths(counts: Partial<Record<ScreenWidthBucket, number>>): ScreenWidthRow[] {
  const total = SCREEN_WIDTH_BUCKETS.reduce((sum, b) => sum + (counts[b.key] ?? 0), 0);
  return SCREEN_WIDTH_BUCKETS.map(({ key, label }) => {
    const sessions = counts[key] ?? 0;
    return { bucket: key, label, sessions, share: total > 0 ? Math.round((sessions / total) * 1000) / 10 : null };
  });
}

/**
 * The PostgREST `or` filter that keeps every row but the admins': null when
 * there is no admin to leave out. `user_id.is.null` first: a row whose
 * account is gone has no user id, and `not.in` alone would drop it.
 */
export function adminIdFilter(adminIds: string[]): string | null {
  const ids = adminIds.filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  return ids.length ? `user_id.is.null,user_id.not.in.(${ids.join(",")})` : null;
}

// ---------------------------------------------------------------------------
// Reads. Each takes the client, so the Overview tab can ask for just the two
// it shows (lib/admin/analytics/overview.ts) without the rest of this tab.
// ---------------------------------------------------------------------------

/** A stretch of time: [since, until). */
export type TimeRange = { since: Date; until: Date };

/** Counts per event in a range (admin_funnel_counts, 0200). Null when the
 *  read failed. */
export async function readFunnelCounts(admin: AdminClient, range: TimeRange, includeAdmins: boolean): Promise<FunnelCounts | null> {
  const { data, error } = await admin.rpc("admin_funnel_counts", {
    p_since: range.since.toISOString(),
    p_until: range.until.toISOString(),
    p_include_admins: includeAdmins,
  });
  if (error) {
    console.error("[admin/analytics] admin_funnel_counts failed:", error.message);
    return null;
  }
  const counts: FunnelCounts = {};
  for (const row of data ?? []) {
    counts[row.event as FunnelEvent] = { n: Number(row.n), users: Number(row.users) };
  }
  return counts;
}

/** The period's counts beside the previous period's, read in parallel. Null
 *  when either failed: a comparison with half its numbers is not one. */
export async function readFunnelCountsWithPrevious(
  admin: AdminClient,
  period: AnalyticsPeriod,
  includeAdmins: boolean,
): Promise<{ current: FunnelCounts; previous: FunnelCounts } | null> {
  const [current, previous] = await Promise.all([
    readFunnelCounts(admin, { since: period.since, until: period.until }, includeAdmins),
    readFunnelCounts(admin, { since: period.previousSince, until: period.previousUntil }, includeAdmins),
  ]);
  return current && previous ? { current, previous } : null;
}

/** Signups per day and by method (admin_signups_daily, 0200). */
export async function readSignupsDaily(admin: AdminClient, period: AnalyticsPeriod, includeAdmins: boolean): Promise<SignupsDaily | null> {
  const { data, error } = await admin.rpc("admin_signups_daily", {
    p_since: period.since.toISOString(),
    p_until: period.until.toISOString(),
    p_include_admins: includeAdmins,
  });
  if (error) {
    console.error("[admin/analytics] admin_signups_daily failed:", error.message);
    return null;
  }
  return buildSignupsDaily(period.dayKeys, data ?? []);
}

async function readCohort(admin: AdminClient, period: AnalyticsPeriod, includeAdmins: boolean): Promise<CohortStep[] | null> {
  const { data, error } = await admin.rpc("admin_funnel_cohort", {
    p_since: period.since.toISOString(),
    p_until: period.until.toISOString(),
    p_include_admins: includeAdmins,
  });
  if (error) {
    console.error("[admin/analytics] admin_funnel_cohort failed:", error.message);
    return null;
  }
  return buildCohort(data ?? []);
}

async function readTrials(admin: AdminClient, period: AnalyticsPeriod, includeAdmins: boolean): Promise<TrialEngagementRow[] | null> {
  const { data, error } = await admin.rpc("admin_trial_engagement", {
    p_since: period.since.toISOString(),
    p_until: period.until.toISOString(),
    p_include_admins: includeAdmins,
  });
  if (error) {
    console.error("[admin/analytics] admin_trial_engagement failed:", error.message);
    return null;
  }
  return (data ?? []).map((row) => ({
    userId: row.user_id,
    username: row.username,
    startedAt: row.started_at,
    endedAt: row.ended_at ?? null,
    windowDays: Number(row.window_days),
    outcome: row.outcome,
    activeDays: Number(row.active_days),
    saves: Number(row.saves),
    generations: Number(row.generations),
    downloads: Number(row.downloads),
  }));
}

/** One exact head count per bucket (seven small index reads): a row read
 *  would stop at PostgREST's row cap, and the counts need no SQL function.
 *  The rows are anonymous (no user id), so there is no admin to leave out. */
async function readScreenWidths(admin: AdminClient, range: { since: string; until: string }): Promise<ScreenWidthRow[] | null> {
  const results = await Promise.all(
    SCREEN_WIDTH_BUCKETS.map(({ key }) =>
      admin
        .from("funnel_events")
        .select("id", { count: "exact", head: true })
        .eq("event", "screen_width")
        .eq("props->>bucket", key)
        .gte("created_at", range.since)
        .lt("created_at", range.until),
    ),
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) {
    console.error("getFunnelSummary: screen widths read failed", failed.error.message);
    return null;
  }
  const counts: Partial<Record<ScreenWidthBucket, number>> = {};
  SCREEN_WIDTH_BUCKETS.forEach(({ key }, i) => {
    counts[key] = results[i].count ?? 0;
  });
  return buildScreenWidths(counts);
}

/**
 * The row reads of the period — every signup's and every ended plan's
 * `props`, and the guest-card first saves — with the team's own accounts
 * left out unless `includeAdmins`.
 *
 * The counting functions leave admins out themselves; these rows are
 * filtered on the same ids. A row whose account was deleted (user_id NULL)
 * stays — `not.in` alone would drop it. Without the admins' ids the rows
 * would count the team while the functions do not, so they are then not
 * shown at all.
 */
async function readPeriodRows(admin: AdminClient, range: { since: string; until: string }, includeAdmins: boolean) {
  let notAdmin: string | null = null;
  let adminIdsFailed = false;
  if (!includeAdmins) {
    const { data, error } = await admin.from("profiles").select("id").eq("is_admin", true);
    if (error) {
      console.error("getFunnelSummary: admin ids read failed", error.message);
      adminIdsFailed = true;
    }
    notAdmin = adminIdFilter((data ?? []).map((row) => row.id));
  }
  /** Every `props` of one event in the period — in pages: an un-ranged
   *  read stops at 1,000 rows whatever `.limit()` says. */
  const propsOf = (event: FunnelEvent) =>
    selectAllRows<{ props: unknown }>((from, to) => {
      let query = admin
        .from("funnel_events")
        .select("props")
        .eq("event", event)
        .gte("created_at", range.since)
        .lt("created_at", range.until);
      if (notAdmin) query = query.or(notAdmin);
      return query.order("created_at", { ascending: true }).order("id", { ascending: true }).range(from, to);
    });
  let guestFirstSavesQuery = admin
    .from("funnel_events")
    .select("id", { count: "exact", head: true })
    .eq("event", "first_card_saved")
    .contains("props", { guestDraft: true })
    .gte("created_at", range.since)
    .lt("created_at", range.until);
  if (notAdmin) guestFirstSavesQuery = guestFirstSavesQuery.or(notAdmin);
  const [signups, cancellations, guestFirstSaves] = await Promise.all([
    propsOf("signup"),
    propsOf("subscription_cancelled"),
    guestFirstSavesQuery,
  ]);
  if (signups.error) console.error("getFunnelSummary: signups read failed", signups.error.message);
  if (cancellations.error) console.error("getFunnelSummary: cancellations read failed", cancellations.error.message);
  if (guestFirstSaves.error) console.error("getFunnelSummary: guest first saves read failed", guestFirstSaves.error.message);
  /** A page that failed leaves part of a list: that is not the list. */
  const whole = <T,>(res: { data: T[]; error: { message: string } | null }): T[] => (res.error || adminIdsFailed ? [] : res.data);
  return {
    signups: whole(signups),
    cancellations: whole(cancellations),
    guestFirstSaves: guestFirstSaves.error || adminIdsFailed ? null : (guestFirstSaves.count ?? 0),
    failed: {
      signups: Boolean(signups.error) || adminIdsFailed,
      cancellations: Boolean(cancellations.error) || adminIdsFailed,
    },
  };
}

/**
 * Everything the Funnel tab shows, for `period` (lib/admin/analytics/params
 * analyticsPeriod) — every read at once. `includeAdmins` (the page's
 * "Include admins" switch) goes to every counting function and decides the
 * row reads' filter. Null when the viewer is not an admin; a single read
 * that failed is that block's own null.
 */
export async function getFunnelSummary(period: AnalyticsPeriod, includeAdmins = false): Promise<FunnelSummary | null> {
  const admin = await requireAdminClient();
  if (!admin) return null;
  const range = { since: period.since.toISOString(), until: period.until.toISOString() };
  const [counts, cohort, signups, trials, screenWidths, rows] = await Promise.all([
    readFunnelCountsWithPrevious(admin, period, includeAdmins),
    readCohort(admin, period, includeAdmins),
    readSignupsDaily(admin, period, includeAdmins),
    readTrials(admin, period, includeAdmins),
    readScreenWidths(admin, range),
    readPeriodRows(admin, range, includeAdmins),
  ]);
  return {
    counts,
    cohort,
    signups,
    signupSources: groupSignupSources(rows.signups),
    signupSurfaces: groupSignupSurfaces(rows.signups),
    cancelReasons: groupCancelReasons(rows.cancellations),
    guestCard: {
      signups: countGuestDraftSignups(rows.signups),
      firstCardsSaved: rows.guestFirstSaves,
    },
    failed: rows.failed,
    trials,
    screenWidths,
  };
}
