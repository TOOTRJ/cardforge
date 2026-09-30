import { CARD_LAYOUT_VERSION } from "@/lib/cards/layout-version";
import {
  FRAME_COLOR_KEYS,
  frameComboKey,
} from "@/lib/cards/frame-reference-registry";
import {
  overrideHash,
  verificationState,
} from "@/lib/cards/frame-verification-state";
import { leaseIsLive, type LeaseHolder } from "@/lib/cards/auto-rebake-state";
import { eraForTemplate } from "@/lib/creator/frame-picker";
import { describeFrame, eraGroupFrameLabel } from "@/lib/creator/frame-resolve";
import { frameMatchPct, isLowFrameScore, recordedOverall } from "@/lib/cards/frame-signoff";
import {
  FRAME_ERA_VALUES,
  FRAME_TEMPLATE_VALUES,
  type FrameEra,
  type FrameTemplate,
} from "@/types/card";
import type { FrameReview } from "@/lib/cards/frame-reviews";
import type { AutoRebakeOverview } from "@/lib/cards/auto-rebake-queries";
import type { FrameRequestCause } from "@/lib/frames/frame-requests";
import type {
  FrameRequestSummary,
  FrameRequestWindow,
} from "@/lib/frames/frame-request-queries";

// ---------------------------------------------------------------------------
// The admin dashboard tile (TODO 7.4): frame verification, the automatic
// re-bake and frame-request demand in one glance, on /dashboard for admins.
// Pure: the server loader (ops-summary-queries.ts) reads, these fold the
// reads into the counts the tile prints, and tests pin them.
//
// Every number here is the SAME number its admin page shows — the tile is a
// summary with links, never a second definition:
//   * frames   = /admin/frame-compare's checklist: every template in
//                FRAME_TEMPLATE_VALUES × FRAME_COLOR_KEYS, "needs
//                re-verification" from verificationState() (a stale tick is
//                still verified — the creator still offers the combo);
//   * re-bake  = /admin/renders: the pending estimate (countSweepCandidates,
//                poison list excluded), the poison list, the lease/pause;
//   * requests = /admin/frame-requests' default 30-day window.
//
// Nothing that names a card leaves the server: the poison list is a count
// (render_sweep_state is service-role only because it names unlisted cards).
// ---------------------------------------------------------------------------

/** The review fields the summary reads (FrameReview has more). */
export type VerificationReview = Pick<
  FrameReview,
  "verified" | "verifiedLayoutVersion" | "verifiedOverrideHash" | "scoreJson"
>;

export type TemplateVerificationRow = {
  template: FrameTemplate;
  /** The checklist's label inside its era group ("Snow"). */
  label: string;
  /** Era/set-qualified, for a list outside the era groups ("M15 (2015) Snow"). */
  fullLabel: string;
  era: FrameEra;
  /** Colour combos the checklist lists for it (FRAME_COLOR_KEYS). */
  combos: number;
  /** Ticked combos — stale ones included, as the checklist header counts. */
  verified: number;
  /** Ticked, but the renderer or the layout override moved since. */
  stale: number;
  unverified: number;
  /** The worst frame match recorded with a tick, in percent (100 − the
   *  recorded edge difference, frameMatchPct); null when no tick carries a
   *  score. */
  worstMatchPct: number | null;
  /** Ticks whose recorded match is below the sign-off's warning line
   *  (isLowFrameScore). */
  lowMatch: number;
};

export type FrameVerificationSummary = {
  combos: number;
  verified: number;
  stale: number;
  unverified: number;
  /** Ticks whose recorded frame match is below the warning line. */
  lowMatch: number;
  /** Templates with every combo verified and none stale. */
  completeTemplates: number;
  /** Checklist order: era, then FRAME_TEMPLATE_VALUES order. */
  templates: TemplateVerificationRow[];
};

/**
 * Per-template verification counts, from the frame_reviews rows (keyed
 * "template/color", as getFrameReviews() returns them) and the saved layout
 * overrides (a changed override stales a tick).
 */
export function summariseFrameVerification(
  reviews: ReadonlyMap<string, VerificationReview>,
  overrides: Readonly<Record<string, unknown>>,
  options: { templates?: readonly FrameTemplate[]; currentVersion?: number } = {},
): FrameVerificationSummary {
  const templates = options.templates ?? FRAME_TEMPLATE_VALUES;
  const currentVersion = options.currentVersion ?? CARD_LAYOUT_VERSION;

  const rows: TemplateVerificationRow[] = [];
  for (const era of FRAME_ERA_VALUES) {
    for (const template of templates) {
      if (eraForTemplate(template) !== era) continue;
      const hash = overrideHash(overrides[template] ?? null);
      let verified = 0;
      let stale = 0;
      let lowMatch = 0;
      // The recorded number is an edge DIFFERENCE (0–100, lower is better):
      // the worst match is the largest one.
      let worstDifference: number | null = null;
      for (const colorKey of FRAME_COLOR_KEYS) {
        const review = reviews.get(frameComboKey(template, colorKey));
        const state = verificationState(
          {
            verified: review?.verified ?? false,
            verifiedLayoutVersion: review?.verifiedLayoutVersion ?? null,
            verifiedOverrideHash: review?.verifiedOverrideHash ?? null,
          },
          template,
          hash,
          currentVersion,
        );
        if (!state.verified) continue;
        verified += 1;
        if (state.stale) stale += 1;
        const difference = recordedOverall(review?.scoreJson);
        if (difference == null) continue;
        worstDifference = worstDifference == null ? difference : Math.max(worstDifference, difference);
        if (isLowFrameScore(difference)) lowMatch += 1;
      }
      rows.push({
        template,
        label: eraGroupFrameLabel(template),
        fullLabel: describeFrame(template),
        era,
        combos: FRAME_COLOR_KEYS.length,
        verified,
        stale,
        unverified: FRAME_COLOR_KEYS.length - verified,
        worstMatchPct: worstDifference == null ? null : frameMatchPct(worstDifference),
        lowMatch,
      });
    }
  }

  const sum = (pick: (row: TemplateVerificationRow) => number) =>
    rows.reduce((total, row) => total + pick(row), 0);
  return {
    combos: sum((row) => row.combos),
    verified: sum((row) => row.verified),
    stale: sum((row) => row.stale),
    unverified: sum((row) => row.unverified),
    lowMatch: sum((row) => row.lowMatch),
    completeTemplates: rows.filter((row) => row.unverified === 0 && row.stale === 0).length,
    templates: rows,
  };
}

/** Templates to look at first: any stale tick, most stale first (then the
 *  checklist order). */
export function templatesNeedingReverification(
  summary: FrameVerificationSummary,
): TemplateVerificationRow[] {
  return summary.templates
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => row.stale > 0)
    .sort((a, b) => b.row.stale - a.row.stale || a.index - b.index)
    .map(({ row }) => row);
}

// ---------------------------------------------------------------------------
// The automatic re-bake.
// ---------------------------------------------------------------------------

export type RebakeTileStatus = "idle" | "running" | "paused";

export type RebakeTileSummary = {
  /** paused wins (cron runs skip); running = someone holds a live lease. */
  status: RebakeTileStatus;
  /** Who holds the live lease (null when none). */
  runner: LeaseHolder | null;
  /** Published cards that may owe a re-bake (an upper bound, the poison
   *  list excluded) — null when the count failed. */
  owed: number | null;
  /** Cards on the poison list (skipped until an admin retries them). */
  poisoned: number;
  pausedReason: string | null;
  pausedAt: string | null;
  lastRun: {
    finishedAt: string;
    rebaked: number;
    failed: number;
  } | null;
  layoutVersion: number;
  sweepVersion: number;
  billingEnabled: boolean;
  error: string | null;
};

export function summariseRebake(overview: AutoRebakeOverview, nowMs: number): RebakeTileSummary {
  const { state } = overview;
  const live = leaseIsLive(state, nowMs);
  const run = state.lastRun;
  return {
    status: state.paused ? "paused" : live ? "running" : "idle",
    runner: live ? state.lease.holder : null,
    owed: overview.pending,
    poisoned: state.poison.length,
    pausedReason: state.paused ? state.pausedReason : null,
    pausedAt: state.paused ? state.pausedAt : null,
    lastRun:
      run && typeof run.finishedAt === "string"
        ? {
            finishedAt: run.finishedAt,
            rebaked: Number(run.rebaked) || 0,
            failed: Number(run.failed) || 0,
          }
        : null,
    layoutVersion: overview.layoutVersion,
    sweepVersion: overview.sweepVersion,
    billingEnabled: overview.billingEnabled,
    error: overview.error,
  };
}

// ---------------------------------------------------------------------------
// Frame-request demand.
// ---------------------------------------------------------------------------

export type FrameDemandRow = {
  signature: string;
  label: string;
  setCode: string | null;
  cause: FrameRequestCause;
  users: number;
  count: number;
};

export type FrameDemandSummary = {
  window: FrameRequestWindow;
  /** Every logged request in the window (the admin page's badge). */
  requests: number;
  /** Distinct open frame SIGNATURES (families PipGlyph will never build
   *  left out), by cause: frames to build and exact frames to verify. The
   *  page's group headings count the same way ("N requests for M missing
   *  frames") — a signature logged under two set codes is two rows but one
   *  frame. */
  missing: number;
  unverified: number;
  /** The most-wanted open rows, in the page's order (users, requests, latest). */
  top: FrameDemandRow[];
  error: string | null;
};

export const FRAME_DEMAND_TOP = 3;

export function summariseFrameDemand(
  summary: FrameRequestSummary,
  limit: number = FRAME_DEMAND_TOP,
): FrameDemandSummary {
  const open = summary.rows.filter((row) => !row.forGood);
  const frames = (cause: FrameRequestCause) =>
    new Set(open.filter((row) => row.cause === cause).map((row) => row.signature)).size;
  return {
    window: summary.window,
    requests: summary.totalRequests,
    missing: frames("missing"),
    unverified: frames("unverified"),
    top: open.slice(0, Math.max(0, limit)).map((row) => ({
      signature: row.signature,
      label: row.label,
      setCode: row.setCode,
      cause: row.cause,
      users: row.users,
      count: row.count,
    })),
    error: summary.error,
  };
}

export type AdminOpsSummary = {
  frames: FrameVerificationSummary;
  rebake: RebakeTileSummary;
  requests: FrameDemandSummary;
  /** The one clock for every "5 min ago" on the tile. */
  readAt: number;
};
