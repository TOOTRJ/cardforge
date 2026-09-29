import { describe, expect, it } from "vitest";
import {
  SIGN_OFF_LOW_MATCH_PCT,
  frameMatchPct,
  isLowFrameScore,
  recordedOverall,
  signOffStatus,
} from "@/lib/cards/frame-signoff";
import { CARD_LAYOUT_VERSION } from "@/lib/cards/layout-version";
import type { FrameColorKey } from "@/lib/cards/frame-reference-registry";

// ---------------------------------------------------------------------------
// The per-template sign-off rule (TODO 2.4): every colour with a reference
// carries a CURRENT auto-score (same staleness as a tick: layout version +
// override hash, and taken against today's reference printing) → ready; a
// colour with no real printing stays out (its own checkbox). The view and the
// publish action both derive it from here. A low score (match below 90 %,
// owner 2026-09-28) is flagged, never a block.
// ---------------------------------------------------------------------------

const HASH = "none";
const score = (
  overrides: Partial<{
    layoutVersion: number | null;
    overrideHash: string | null;
    overall: unknown;
    referenceScryfallId: string | null;
  }> = {},
) => ({
  layoutVersion: "layoutVersion" in overrides ? overrides.layoutVersion! : CARD_LAYOUT_VERSION,
  overrideHash: "overrideHash" in overrides ? overrides.overrideHash! : HASH,
  referenceScryfallId: "referenceScryfallId" in overrides ? overrides.referenceScryfallId! : "ref",
  scoreJson: { overall: "overall" in overrides ? overrides.overall : 7.5 },
  createdAt: "2026-09-28T10:00:00Z",
});

const colour = (
  colorKey: FrameColorKey,
  input: Partial<{ referenceId: string | null; score: ReturnType<typeof score> | null }> = {},
) => ({
  colorKey,
  referenceId: "referenceId" in input ? input.referenceId! : "ref",
  score: "score" in input ? input.score! : score(),
});

describe("signOffStatus", () => {
  it("every referenced colour scored on today's renderer → ready, all publishable", () => {
    const status = signOffStatus({
      template: "saga",
      currentOverrideHash: HASH,
      colours: (["w", "u", "b"] as const).map((k) => colour(k)),
    });
    expect(status.ready).toBe(true);
    expect(status.publishable).toEqual(["w", "u", "b"]);
    expect(status.blocking).toEqual([]);
    expect(status.colours.map((c) => c.overall)).toEqual([7.5, 7.5, 7.5]);
  });

  it("an unscored colour blocks the template", () => {
    const status = signOffStatus({
      template: "saga",
      currentOverrideHash: HASH,
      colours: [colour("w"), colour("u", { score: null })],
    });
    expect(status.ready).toBe(false);
    expect(status.blocking).toEqual(["u"]);
    expect(status.colours[1].state).toBe("unscored");
  });

  it("a score taken before an override edit is stale and blocks", () => {
    const status = signOffStatus({
      template: "saga",
      currentOverrideHash: "abcd1234",
      colours: [colour("w")],
    });
    expect(status.colours[0].state).toBe("stale");
    expect(status.colours[0].reasons.join(" ")).toMatch(/override changed/);
    expect(status.ready).toBe(false);
  });

  it("a score that recorded no version or override is not current", () => {
    const status = signOffStatus({
      template: "saga",
      currentOverrideHash: HASH,
      colours: [colour("w", { score: score({ layoutVersion: null }) })],
    });
    expect(status.colours[0].state).toBe("stale");
  });

  it("a score row without a number counts as unscored", () => {
    const status = signOffStatus({
      template: "saga",
      currentOverrideHash: HASH,
      colours: [colour("w", { score: score({ overall: "n/a" }) })],
    });
    expect(status.colours[0].state).toBe("unscored");
  });

  it("colours with no real printing stay out: neither publishable nor blocking", () => {
    const status = signOffStatus({
      template: "split",
      currentOverrideHash: HASH,
      colours: [colour("w", { referenceId: null, score: null }), colour("m")],
    });
    expect(status.sampleOnly).toEqual(["w"]);
    expect(status.publishable).toEqual(["m"]);
    expect(status.ready).toBe(true);
  });

  it("nothing scorable → not ready", () => {
    const status = signOffStatus({
      template: "split",
      currentOverrideHash: HASH,
      colours: [colour("w", { referenceId: null, score: null })],
    });
    expect(status.ready).toBe(false);
  });

  it("a score taken against another reference (re-pinned since) is stale and blocks", () => {
    const status = signOffStatus({
      template: "saga",
      currentOverrideHash: HASH,
      colours: [
        colour("w", { referenceId: "pinned-today", score: score({ referenceScryfallId: "old-default" }) }),
        colour("u", { referenceId: "pinned-today", score: score({ referenceScryfallId: null }) }),
      ],
    });
    expect(status.colours.map((c) => c.state)).toEqual(["stale", "stale"]);
    expect(status.colours[0].reasons.join(" ")).toMatch(/another reference printing/);
    expect(status.colours[1].reasons.join(" ")).toMatch(/no reference printing/);
    expect(status.blocking).toEqual(["w", "u"]);
    expect(status.ready).toBe(false);
  });

  it("a later renderer bump that touches the template stales an older score", () => {
    const status = signOffStatus({
      template: "saga",
      currentOverrideHash: HASH,
      currentVersion: CARD_LAYOUT_VERSION + 1,
      colours: [colour("w", { score: score({ layoutVersion: 1 }) })],
    });
    expect(status.colours[0].state).toBe("stale");
  });
});

describe("recordedOverall", () => {
  it("reads a finite number only", () => {
    expect(recordedOverall({ overall: 4.2 })).toBe(4.2);
    expect(recordedOverall({ overall: Number.NaN })).toBeNull();
    expect(recordedOverall(null)).toBeNull();
    expect(recordedOverall({})).toBeNull();
  });
});

describe("the low-score warning (owner, 2026-09-28: below 90 % warns, never blocks)", () => {
  it("the warning line is 90 % match", () => {
    expect(SIGN_OFF_LOW_MATCH_PCT).toBe(90);
  });

  it("the recorded number is an edge difference, so the match is 100 − it", () => {
    expect(frameMatchPct(4.9)).toBe(95.1);
    expect(frameMatchPct(0)).toBe(100);
    expect(frameMatchPct(12.34)).toBe(87.7);
  });

  it("low = a match below the line; exactly on it is not low", () => {
    expect(isLowFrameScore(10)).toBe(false); // 90 % match
    expect(isLowFrameScore(10.1)).toBe(true); // 89.9 %
    expect(isLowFrameScore(4.9)).toBe(false);
    expect(isLowFrameScore(null)).toBe(false);
  });

  it("flags low colours but still publishes them: ready, publishable, named in lowPublishable", () => {
    const status = signOffStatus({
      template: "saga",
      currentOverrideHash: HASH,
      colours: [
        colour("w", { score: score({ overall: 4.9 }) }),
        colour("u", { score: score({ overall: 12.4 }) }),
        colour("b", { score: score({ overall: 30 }) }),
      ],
    });
    expect(status.colours.map((c) => c.low)).toEqual([false, true, true]);
    expect(status.ready).toBe(true);
    expect(status.publishable).toEqual(["w", "u", "b"]);
    expect(status.blocking).toEqual([]);
    expect(status.lowPublishable).toEqual(["u", "b"]);
  });

  it("a stale low score is marked but isn't named for Publish (it isn't published)", () => {
    const status = signOffStatus({
      template: "saga",
      currentOverrideHash: HASH,
      colours: [
        colour("w", { score: score({ overall: 25, referenceScryfallId: "old" }) }),
        colour("u", { score: null }),
        colour("c", { referenceId: null, score: null }),
      ],
    });
    expect(status.colours.map((c) => [c.state, c.low])).toEqual([
      ["stale", true],
      ["unscored", false],
      ["no-reference", false],
    ]);
    expect(status.lowPublishable).toEqual([]);
  });
});
