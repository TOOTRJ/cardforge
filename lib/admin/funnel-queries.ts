import "server-only";

import { requireAdminClient } from "./users-queries";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { FunnelEvent } from "@/lib/analytics/funnel-events";
import { attributionSource, attributionSurface, sanitizeAttribution } from "@/lib/analytics/attribution";
import { SCREEN_WIDTH_BUCKETS, type ScreenWidthBucket } from "@/lib/analytics/screen-width";
import { selectAllRows } from "@/lib/supabase/select-all-rows";

// ---------------------------------------------------------------------------
// The admin Funnel panel's data: counts per funnel event for two trailing
// windows, shaped into the steps and ratios that matter. Pure math in
// buildFunnel() so it's unit-tested; the read is one RPC per window.
// ---------------------------------------------------------------------------

export type FunnelCounts = Partial<Record<FunnelEvent, { n: number; users: number }>>;

export type FunnelStep = { key: FunnelEvent; label: string; n: number; users: number; rate: number | null };
export type FunnelSection = { title: string; steps: FunnelStep[] };
export type FunnelWindow = { days: number; sections: FunnelSection[] };
export type SignupSource = { source: string; n: number };
export type SignupSurface = { surface: string; n: number };
/** One row of "Cancellations by reason": the portal's feedback choice when
 *  the customer gave one, else Stripe's cancellation reason. */
export type CancelReasonRow = { reason: string; label: string; n: number };
export type TrialEngagementRow = {
  userId: string;
  username: string | null;
  startedAt: string;
  outcome: string;
  activeDays: number;
  saves: number;
  generations: number;
  downloads: number;
};
/** One row of the "Screen widths" table: tab sessions per bucket and their
 *  share of every bucketed session in the window (null when there are none). */
export type ScreenWidthRow = { bucket: ScreenWidthBucket; label: string; sessions: number; share: number | null };
export type FunnelSummary = {
  windows: FunnelWindow[];
  /** Signups by first-touch source, last 30 days. */
  signupSources: SignupSource[];
  /** Signups by the create button pressed last ("none" = no tracked button). */
  signupSurfaces: SignupSurface[];
  /** Plans that ended in the last 30 days, by the reason the customer gave
   *  in the portal (or Stripe's own reason), biggest first. */
  cancelReasons: CancelReasonRow[];
  /** A guest's card through sign-up (TODO HM3), last 30 days: signups made
   *  while one waited in the browser, and first cards saved from one. Null
   *  counts where the read failed. */
  guestCard: { signups: number; firstCardsSaved: number | null };
  /** Trials started in the last 30 days and what they did in their 7 days. */
  trials: TrialEngagementRow[];
  /** Anonymous viewport-width buckets, last 30 days (TODO WD9); null when
   *  the read failed — never zeros standing in for an error. */
  screenWidths: ScreenWidthRow[] | null;
};

export const FUNNEL_WINDOWS_DAYS = [7, 30] as const;

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

/** Each section is a chain: a step's rate is its count over the previous
 *  step's count (null when the previous step is empty or it's the first). */
const SECTIONS: Array<{ title: string; chain: FunnelEvent[] }> = [
  { title: "Activation", chain: ["signup", "first_card_saved", "first_ai_generation", "first_download"] },
  { title: "Storefront", chain: ["pricing_view", "cta_click", "checkout_started", "checkout_completed"] },
  { title: "Trials", chain: ["trial_started", "trial_converted"] },
  { title: "Out of credits", chain: ["upgrade_modal_open", "pack_purchased"] },
  { title: "Money", chain: ["payment_received", "subscription_started", "subscription_changed", "subscription_cancelled", "subscription_resumed"] },
  { title: "Leaks", chain: ["checkout_expired", "trial_lapsed", "payment_failed"] },
  // Counts only: the deck plan's upgrade moments (TODO DK3.8).
  { title: "Decks", chain: ["deck_created", "deck_card_customized", "deck_export_clicked"] },
  // Counts only: the home page's create buttons (TODO HM2) — never in the
  // Storefront chain, whose steps are billing moments alone.
  { title: "Home create buttons", chain: ["create_cta_click"] },
  // Counts only: a guest's Save or AI press that asked for a sign-up (TODO HM3).
  { title: "Guest creator", chain: ["guest_save_gate"] },
];

/** Rates are chained inside the four sections named here; the rest are
 *  counts only. */
const RATE_SECTIONS = new Set(["Activation", "Storefront", "Trials", "Out of credits"]);

export function buildFunnel(counts: FunnelCounts, days: number): FunnelWindow {
  const sections = SECTIONS.map(({ title, chain }) => {
    let prev: number | null = null;
    const steps = chain.map((key) => {
      const c = counts[key] ?? { n: 0, users: 0 };
      const rate = RATE_SECTIONS.has(title) && prev != null && prev > 0 ? Math.round((c.n / prev) * 1000) / 10 : null;
      prev = c.n;
      return { key, label: LABEL[key], n: c.n, users: c.users, rate };
    });
    return { title, steps };
  });
  return { days, sections };
}

/** Pure: count signup rows by one attribution label, biggest first. */
function groupSignupsBy(rows: Array<{ props: unknown }>, labelOf: (props: Record<string, unknown>) => string, limit: number) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const props = row.props && typeof row.props === "object" ? (row.props as Record<string, unknown>) : {};
    const label = labelOf(props);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit);
}

/** The label of a signup whose first touch was never recorded: a row
 *  migration 0197 wrote for an account that had none (made with Google or
 *  Discord before those were recorded, or older than the funnel). Its own
 *  line — never "direct" or "none", which say the visitor came with no
 *  referrer and pressed no button. */
export const SIGNUP_NOT_RECORDED = "not recorded";

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
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([reason, n]) => ({ reason, label: CANCEL_REASON_LABEL[reason] ?? reason, n }));
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

/** One exact head count per bucket (seven small index reads): a row read
 *  would stop at PostgREST's row cap, and the counts need no SQL function. */
async function readScreenWidths(
  admin: ReturnType<typeof createAdminClient>,
  since: string,
): Promise<ScreenWidthRow[] | null> {
  const results = await Promise.all(
    SCREEN_WIDTH_BUCKETS.map(({ key }) =>
      admin
        .from("funnel_events")
        .select("id", { count: "exact", head: true })
        .eq("event", "screen_width")
        .eq("props->>bucket", key)
        .gte("created_at", since),
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
 * The PostgREST `or` filter that keeps every row but the admins': null when
 * there is no admin to leave out. `user_id.is.null` first: a row whose
 * account is gone has no user id, and `not.in` alone would drop it.
 */
export function adminIdFilter(adminIds: string[]): string | null {
  const ids = adminIds.filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  return ids.length ? `user_id.is.null,user_id.not.in.(${ids.join(",")})` : null;
}

export async function getFunnelSummary(): Promise<FunnelSummary | null> {
  const admin = await requireAdminClient();
  if (!admin) return null;
  const windows: FunnelWindow[] = [];
  for (const days of FUNNEL_WINDOWS_DAYS) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await admin.rpc("admin_funnel_counts", { p_since: since });
    if (error) {
      console.warn("getFunnelSummary: rpc error", error.message);
      return null;
    }
    const counts: FunnelCounts = {};
    for (const row of data ?? []) {
      counts[row.event as FunnelEvent] = { n: Number(row.n), users: Number(row.users) };
    }
    windows.push(buildFunnel(counts, days));
  }
  const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  // The team's own accounts are not the funnel: the two counting functions
  // leave admins out themselves (migration 0197), and the row reads below
  // filter on the same ids. A row whose account was deleted (user_id NULL)
  // stays — `not.in` alone would drop it.
  const { data: adminRows, error: adminError } = await admin.from("profiles").select("id").eq("is_admin", true);
  if (adminError) console.warn("getFunnelSummary: admin ids", adminError.message);
  const notAdmin = adminIdFilter((adminRows ?? []).map((row) => row.id));
  /** A page that failed leaves part of a list: that is not the list. And
   *  without the admins' ids the rows would count the team while the two
   *  counting functions do not — so neither is shown (empty, as a failed
   *  read always was here), never part of one as if it were all of it. */
  const whole = <T,>(res: { data: T[]; error: { message: string } | null }): T[] => (res.error || adminError ? [] : res.data);
  /** Every `props` of one event in the window — in pages: an un-ranged
   *  read stops at 1,000 rows whatever `.limit()` says. */
  const propsOf = (event: FunnelEvent) =>
    selectAllRows<{ props: unknown }>((from, to) => {
      let query = admin.from("funnel_events").select("props").eq("event", event).gte("created_at", since30);
      if (notAdmin) query = query.or(notAdmin);
      return query.order("created_at", { ascending: true }).order("id", { ascending: true }).range(from, to);
    });
  let guestFirstSavesQuery = admin
    .from("funnel_events")
    .select("id", { count: "exact", head: true })
    .eq("event", "first_card_saved")
    .contains("props", { guestDraft: true })
    .gte("created_at", since30);
  if (notAdmin) guestFirstSavesQuery = guestFirstSavesQuery.or(notAdmin);
  const [signups, trials, screenWidths, guestFirstSaves, cancellations] = await Promise.all([
    propsOf("signup"),
    admin.rpc("admin_trial_engagement", { p_since: since30 }),
    readScreenWidths(admin, since30),
    guestFirstSavesQuery,
    propsOf("subscription_cancelled"),
  ]);
  if (cancellations.error) console.warn("getFunnelSummary: cancellations", cancellations.error.message);
  if (guestFirstSaves.error) console.warn("getFunnelSummary: guest first saves", guestFirstSaves.error.message);
  if (signups.error) console.warn("getFunnelSummary: signups", signups.error.message);
  if (trials.error) console.warn("getFunnelSummary: trials", trials.error.message);
  return {
    windows,
    signupSources: groupSignupSources(whole(signups)),
    signupSurfaces: groupSignupSurfaces(whole(signups)),
    cancelReasons: groupCancelReasons(whole(cancellations)),
    guestCard: {
      signups: countGuestDraftSignups(whole(signups)),
      firstCardsSaved: guestFirstSaves.error ? null : (guestFirstSaves.count ?? 0),
    },
    trials: (trials.data ?? []).map((row) => ({
      userId: row.user_id,
      username: row.username,
      startedAt: row.started_at,
      outcome: row.outcome,
      activeDays: Number(row.active_days),
      saves: Number(row.saves),
      generations: Number(row.generations),
      downloads: Number(row.downloads),
    })),
    screenWidths,
  };
}
