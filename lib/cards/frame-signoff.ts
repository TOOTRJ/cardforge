import { CARD_LAYOUT_VERSION } from "@/lib/cards/layout-version";
import { verificationState } from "@/lib/cards/frame-verification-state";
import type { FrameColorKey } from "@/lib/cards/frame-reference-registry";

// ---------------------------------------------------------------------------
// Per-template sign-off (TODO 2.4) — the rule the admin view shows and the
// server action enforces:
//
//   publishing a template = every colour that HAS a reference printing
//   carries a CURRENT auto-score (the registered, masked frame score of 0.9,
//   recorded by the sign-off's Score as a "score" event, or by a per-colour
//   tick in its "verify" event) + the owner's tick.
//
// "Current" is the tick's own staleness rule (frame-verification-state.ts):
// the score was taken on a layout version whose bumps since don't touch the
// template, on today's layout-override hash, AND against the combo's
// reference printing as it stands today (after a re-pin the old number is
// about another card). A colour with no real
// printing can't be scored — it stays out of the template sign-off and is
// published by its own checkbox after the owner has walked its sample
// content. Colours stay individually withdrawable (the per-colour checkbox).
//
// Low scores WARN, never block (owner, 2026-09-28): a colour whose match is
// below SIGN_OFF_LOW_MATCH_PCT is marked on its row and named in a confirm
// step before Publish; publishing stays allowed. The recorded number is an
// edge DIFFERENCE (0–100, lower is better — lib/frames/align.ts), so the
// match is 100 − it: "below 90 %" = a difference above 10. Pure.
// ---------------------------------------------------------------------------

/** The sign-off warns (never blocks) when a colour's frame match — 100 −
 *  the recorded edge difference — is below this, in percent (owner,
 *  2026-09-28). */
export const SIGN_OFF_LOW_MATCH_PCT = 90;

/** A recorded frame score (edge difference, 0–100, lower is better) as a
 *  match percentage, one decimal: 4.9 → 95.1. */
export function frameMatchPct(overall: number): number {
  return Math.round((100 - overall) * 10) / 10;
}

/** A recorded frame score whose match is below the warning line. */
export function isLowFrameScore(overall: number | null): boolean {
  return overall !== null && 100 - overall < SIGN_OFF_LOW_MATCH_PCT;
}

/** The part of a "score" (or scored "verify") event the rule reads. */
export type RecordedScore = {
  layoutVersion: number | null;
  overrideHash: string | null;
  referenceScryfallId: string | null;
  scoreJson: unknown;
  createdAt: string;
};

export type SignOffColourInput = {
  colorKey: FrameColorKey;
  /** The combo's reference printing today (pinned, else the registry
   *  default — pickFrameReference); null when no real printing exists, so
   *  the colour can't be scored. */
  referenceId: string | null;
  score: RecordedScore | null;
};

export type SignOffColourStatus = {
  colorKey: FrameColorKey;
  state: "scored" | "stale" | "unscored" | "no-reference";
  /** The recorded frame score (edge difference, 0–100, lower is better),
   *  when there is one. */
  overall: number | null;
  /** The recorded score's match is below SIGN_OFF_LOW_MATCH_PCT — a warning,
   *  never a block. */
  low: boolean;
  /** Why a recorded score no longer counts. */
  reasons: string[];
};

export type SignOffStatus = {
  colours: SignOffColourStatus[];
  /** Colours the sign-off publishes: scored on today's renderer + override. */
  publishable: FrameColorKey[];
  /** Colours with a reference that still need a (fresh) score. */
  blocking: FrameColorKey[];
  /** Colours with no real printing — published individually. */
  sampleOnly: FrameColorKey[];
  /** Publishable colours whose match is below the warning line: the view
   *  names them in a confirm step before Publish (never a block). */
  lowPublishable: FrameColorKey[];
  /** Nothing blocks and there is something to publish. */
  ready: boolean;
};

/** The overall frame score recorded in a score_json, or null. */
export function recordedOverall(scoreJson: unknown): number | null {
  const overall = (scoreJson as { overall?: unknown } | null)?.overall;
  return typeof overall === "number" && Number.isFinite(overall) ? overall : null;
}

export function signOffStatus(input: {
  template: string;
  currentOverrideHash: string;
  currentVersion?: number;
  colours: readonly SignOffColourInput[];
}): SignOffStatus {
  const currentVersion = input.currentVersion ?? CARD_LAYOUT_VERSION;
  const colours = input.colours.map((colour): SignOffColourStatus => {
    if (colour.referenceId === null) {
      return {
        colorKey: colour.colorKey,
        state: "no-reference",
        overall: null,
        low: false,
        reasons: [],
      };
    }
    const overall = colour.score ? recordedOverall(colour.score.scoreJson) : null;
    if (!colour.score || overall === null) {
      return { colorKey: colour.colorKey, state: "unscored", overall: null, low: false, reasons: [] };
    }
    const low = isLowFrameScore(overall);
    if (colour.score.layoutVersion == null || colour.score.overrideHash == null) {
      return {
        colorKey: colour.colorKey,
        state: "stale",
        overall,
        low,
        reasons: ["the score recorded no layout version or override"],
      };
    }
    // Publishing stamps the score's reference as verified_reference_id, so
    // it must be the printing the combo stands for today.
    if (colour.score.referenceScryfallId !== colour.referenceId) {
      return {
        colorKey: colour.colorKey,
        state: "stale",
        overall,
        low,
        reasons: [
          colour.score.referenceScryfallId
            ? "the score was taken against another reference printing than today's"
            : "the score recorded no reference printing",
        ],
      };
    }
    const state = verificationState(
      {
        verified: true,
        verifiedLayoutVersion: colour.score.layoutVersion,
        verifiedOverrideHash: colour.score.overrideHash,
      },
      input.template,
      input.currentOverrideHash,
      currentVersion,
    );
    return {
      colorKey: colour.colorKey,
      state: state.stale ? "stale" : "scored",
      overall,
      low,
      reasons: state.reasons,
    };
  });
  const publishable = colours.filter((c) => c.state === "scored").map((c) => c.colorKey);
  const blocking = colours
    .filter((c) => c.state === "unscored" || c.state === "stale")
    .map((c) => c.colorKey);
  const sampleOnly = colours.filter((c) => c.state === "no-reference").map((c) => c.colorKey);
  const lowPublishable = colours
    .filter((c) => c.state === "scored" && c.low)
    .map((c) => c.colorKey);
  return {
    colours,
    publishable,
    blocking,
    sampleOnly,
    lowPublishable,
    ready: blocking.length === 0 && publishable.length > 0,
  };
}
