import "server-only";

import { requireAdminClient } from "./users-queries";
import type { FunnelEvent } from "@/lib/analytics/funnel-events";
import { attributionSource, sanitizeAttribution } from "@/lib/analytics/attribution";

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
export type FunnelSummary = {
  windows: FunnelWindow[];
  /** Signups by first-touch source, last 30 days. */
  signupSources: SignupSource[];
  /** Trials started in the last 30 days and what they did in their 7 days. */
  trials: TrialEngagementRow[];
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
  subscription_cancelled: "Cancellations",
  payment_received: "Payments received",
  payment_failed: "Payments failed",
  upgrade_modal_open: "Upgrade modal opens",
  pack_purchased: "Packs purchased",
};

/** Each section is a chain: a step's rate is its count over the previous
 *  step's count (null when the previous step is empty or it's the first). */
const SECTIONS: Array<{ title: string; chain: FunnelEvent[] }> = [
  { title: "Activation", chain: ["signup", "first_card_saved", "first_ai_generation", "first_download"] },
  { title: "Storefront", chain: ["pricing_view", "cta_click", "checkout_started", "checkout_completed"] },
  { title: "Trials", chain: ["trial_started", "trial_converted"] },
  { title: "Out of credits", chain: ["upgrade_modal_open", "pack_purchased"] },
  { title: "Money", chain: ["payment_received", "subscription_started", "subscription_changed", "subscription_cancelled"] },
  { title: "Leaks", chain: ["checkout_expired", "trial_lapsed", "payment_failed"] },
];

/** Rates are chained inside a section except in the last two, which are
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

/** Pure: group signup rows by first-touch source, biggest first. */
export function groupSignupSources(rows: Array<{ props: unknown }>, limit = 8): SignupSource[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const props = row.props && typeof row.props === "object" ? (row.props as Record<string, unknown>) : {};
    const source = attributionSource(sanitizeAttribution(props));
    counts.set(source, (counts.get(source) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([source, n]) => ({ source, n }))
    .sort((a, b) => b.n - a.n || a.source.localeCompare(b.source))
    .slice(0, limit);
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
  const [signups, trials] = await Promise.all([
    admin.from("funnel_events").select("props").eq("event", "signup").gte("created_at", since30).limit(5000),
    admin.rpc("admin_trial_engagement", { p_since: since30 }),
  ]);
  if (signups.error) console.warn("getFunnelSummary: signups", signups.error.message);
  if (trials.error) console.warn("getFunnelSummary: trials", trials.error.message);
  return {
    windows,
    signupSources: groupSignupSources((signups.data ?? []) as Array<{ props: unknown }>),
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
  };
}
