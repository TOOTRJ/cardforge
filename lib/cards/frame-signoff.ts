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
// content. No score threshold: the number is information, the tick is the
// decision (an owner question in the PR). Colours stay individually
// withdrawable (the per-colour checkbox). Pure.
// ---------------------------------------------------------------------------

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
  /** The recorded frame score (0–100), when there is one. */
  overall: number | null;
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
      return { colorKey: colour.colorKey, state: "no-reference", overall: null, reasons: [] };
    }
    const overall = colour.score ? recordedOverall(colour.score.scoreJson) : null;
    if (!colour.score || overall === null) {
      return { colorKey: colour.colorKey, state: "unscored", overall: null, reasons: [] };
    }
    if (colour.score.layoutVersion == null || colour.score.overrideHash == null) {
      return {
        colorKey: colour.colorKey,
        state: "stale",
        overall,
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
      reasons: state.reasons,
    };
  });
  const publishable = colours.filter((c) => c.state === "scored").map((c) => c.colorKey);
  const blocking = colours
    .filter((c) => c.state === "unscored" || c.state === "stale")
    .map((c) => c.colorKey);
  const sampleOnly = colours.filter((c) => c.state === "no-reference").map((c) => c.colorKey);
  return {
    colours,
    publishable,
    blocking,
    sampleOnly,
    ready: blocking.length === 0 && publishable.length > 0,
  };
}
