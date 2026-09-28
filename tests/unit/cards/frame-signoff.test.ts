import { describe, expect, it } from "vitest";
import { recordedOverall, signOffStatus } from "@/lib/cards/frame-signoff";
import { CARD_LAYOUT_VERSION } from "@/lib/cards/layout-version";
import type { FrameColorKey } from "@/lib/cards/frame-reference-registry";

// ---------------------------------------------------------------------------
// The per-template sign-off rule (TODO 2.4): every colour with a reference
// carries a CURRENT auto-score (same staleness as a tick: layout version +
// override hash) → ready; a colour with no real printing stays out (its own
// checkbox). The view and the publish action both derive it from here.
// ---------------------------------------------------------------------------

const HASH = "none";
const score = (overrides: Partial<{ layoutVersion: number | null; overrideHash: string | null; overall: unknown }> = {}) => ({
  layoutVersion: "layoutVersion" in overrides ? overrides.layoutVersion! : CARD_LAYOUT_VERSION,
  overrideHash: "overrideHash" in overrides ? overrides.overrideHash! : HASH,
  referenceScryfallId: "ref",
  scoreJson: { overall: "overall" in overrides ? overrides.overall : 7.5 },
  createdAt: "2026-09-28T10:00:00Z",
});

const colour = (colorKey: FrameColorKey, input: Partial<{ hasReference: boolean; score: ReturnType<typeof score> | null }> = {}) => ({
  colorKey,
  hasReference: input.hasReference ?? true,
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
      colours: [colour("w", { hasReference: false, score: null }), colour("m")],
    });
    expect(status.sampleOnly).toEqual(["w"]);
    expect(status.publishable).toEqual(["m"]);
    expect(status.ready).toBe(true);
  });

  it("nothing scorable → not ready", () => {
    const status = signOffStatus({
      template: "split",
      currentOverrideHash: HASH,
      colours: [colour("w", { hasReference: false, score: null })],
    });
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
