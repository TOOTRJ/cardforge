import { describe, expect, it } from "vitest";
import { CARD_LAYOUT_VERSION } from "@/lib/cards/layout-version";
import {
  LEGACY_TICK_LAYOUT_VERSION,
  canonicalJson,
  overrideHash,
  verificationState,
} from "@/lib/cards/frame-verification-state";

// A verification records the layout version and override hash it measured
// (migration 0115). The checklist must flag a tick as stale when either
// moved on, and must NOT nag about the 71 rows ticked before this existed.

describe("canonicalJson / overrideHash", () => {
  it("hashes equal overrides equally regardless of key order", () => {
    const a = { title: { rect: { topPct: 5, leftPct: 8 } }, costRect: { topPct: 1 } };
    const b = { costRect: { topPct: 1 }, title: { rect: { leftPct: 8, topPct: 5 } } };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
    expect(overrideHash(a)).toBe(overrideHash(b));
    expect(overrideHash(a)).toMatch(/^[0-9a-f]{8}$/);
  });

  it("changes when a value changes and reads 'none' for an absent override", () => {
    expect(overrideHash({ title: { rect: { topPct: 5 } } })).not.toBe(
      overrideHash({ title: { rect: { topPct: 5.1 } } }),
    );
    expect(overrideHash(null)).toBe("none");
    expect(overrideHash(undefined)).toBe("none");
    expect(overrideHash({})).toBe("none");
  });

  it("ignores undefined properties like JSON does", () => {
    expect(overrideHash({ a: 1, b: undefined })).toBe(overrideHash({ a: 1 }));
  });
});

describe("verificationState", () => {
  const current = 23;

  it("is nothing special for an unverified combo", () => {
    expect(
      verificationState(
        { verified: false, verifiedLayoutVersion: null, verifiedOverrideHash: null },
        "m15",
        "none",
        current,
      ),
    ).toEqual({ verified: false, stale: false, legacy: false, reasons: [] });
  });

  it("treats a pre-0115 tick as legacy, not stale", () => {
    const state = verificationState(
      { verified: true, verifiedLayoutVersion: null, verifiedOverrideHash: null },
      "m15",
      "none",
      current,
    );
    expect(state).toEqual({ verified: true, stale: false, legacy: true, reasons: [] });
  });

  it("stales a legacy tick on a later bump that touches its template, and only then (TODO 4.49)", () => {
    const legacyTick = { verified: true, verifiedLayoutVersion: null, verifiedOverrideHash: null };
    // Every bump up to LEGACY_TICK_LAYOUT_VERSION is waived, as before…
    expect(LEGACY_TICK_LAYOUT_VERSION).toBe(33);
    expect(CARD_LAYOUT_VERSION).toBeGreaterThanOrEqual(LEGACY_TICK_LAYOUT_VERSION);
    for (const version of [23, 30, 33]) {
      expect(verificationState(legacyTick, "m15token", "none", version).stale, `v${version}`).toBe(false);
    }
    // …and the next one (v34: no scope recorded here, so every template) stales it,
    // still reported as legacy.
    const state = verificationState(legacyTick, "m15token", "none", LEGACY_TICK_LAYOUT_VERSION + 1);
    expect(state).toEqual({
      verified: true,
      stale: true,
      legacy: true,
      reasons: ["the renderer changed since this tick (made before layout v33; now v34)"],
    });
  });

  it("is current when the version and the override hash both match", () => {
    const state = verificationState(
      { verified: true, verifiedLayoutVersion: current, verifiedOverrideHash: "abcd1234" },
      "m15",
      "abcd1234",
      current,
    );
    expect(state.stale).toBe(false);
    expect(state.legacy).toBe(false);
  });

  it("goes stale when the renderer moved on", () => {
    const state = verificationState(
      { verified: true, verifiedLayoutVersion: current - 1, verifiedOverrideHash: "abcd1234" },
      "m15",
      "abcd1234",
      current,
    );
    expect(state.stale).toBe(true);
    expect(state.reasons[0]).toMatch(/renderer changed since layout v22 \(now v23\)/);
  });

  it("goes stale when the override changed, and lists both reasons when both did", () => {
    const one = verificationState(
      { verified: true, verifiedLayoutVersion: current, verifiedOverrideHash: "old" },
      "m15",
      "new",
      current,
    );
    expect(one.reasons).toEqual(["the layout override changed since this was verified"]);
    const both = verificationState(
      { verified: true, verifiedLayoutVersion: current - 2, verifiedOverrideHash: "old" },
      "m15",
      "new",
      current,
    );
    expect(both.reasons).toHaveLength(2);
  });

  it("a finish-scoped bump (v26 etched) doesn't stale a tick; a template-scoped one only its templates", () => {
    const tick = (v: number) => ({ verified: true, verifiedLayoutVersion: v, verifiedOverrideHash: "h" });
    expect(verificationState(tick(25), "m15", "h", 26).stale).toBe(false);
    expect(verificationState(tick(25), "saga", "h", 26).stale).toBe(false);
    expect(verificationState(tick(24), "saga", "h", 26).stale).toBe(false);
    expect(verificationState(tick(24), "modern", "h", 26).stale).toBe(true);
    expect(verificationState(tick(24), "tarkirdragon", "h", 26).stale).toBe(true);
  });

  it("v31 (the one corner radius) is verification-neutral: v29 / v30 ticks stay fresh, older changes still stale", () => {
    const tick = (v: number) => ({ verified: true, verifiedLayoutVersion: v, verifiedOverrideHash: "h" });
    expect(CARD_LAYOUT_VERSION).toBeGreaterThanOrEqual(31);
    for (const template of ["m15", "modern", "battle", "lotr", "fullartland", "m15borderless"]) {
      expect(verificationState(tick(30), template, "h", 31).stale, template).toBe(false);
    }
    expect(verificationState(tick(29), "m15", "h", 31).stale).toBe(false);
    expect(verificationState(tick(29), "modern", "h", 31).stale).toBe(false);
    // v30 re-sourced fullartland: a v29 tick on it is still stale.
    expect(verificationState(tick(29), "fullartland", "h", 31).stale).toBe(true);
    // v29 changed every m15 card (the display-footer word spacing).
    const v28 = verificationState(tick(28), "m15", "h", 31);
    expect(v28.stale).toBe(true);
    expect(v28.reasons[0]).toMatch(/renderer changed since layout v28 \(now v31\)/);
  });

  it("v32 (the M15 family's sizes) is verification-neutral too: the round-8 sign-off stands in for re-ticks", () => {
    const tick = (v: number) => ({ verified: true, verifiedLayoutVersion: v, verifiedOverrideHash: "h" });
    expect(CARD_LAYOUT_VERSION).toBeGreaterThanOrEqual(32);
    // A v31 or v30 tick on a family template — and on any other — stays fresh.
    for (const template of ["m15", "m15pw", "saga", "m15token", "fullartland", "m15borderless", "modern", "split"]) {
      expect(verificationState(tick(31), template, "h", 32).stale, template).toBe(false);
      expect(verificationState(tick(30), template, "h", 32).stale, template).toBe(false);
    }
    // Older changes still stale a tick, now reported against v32.
    expect(verificationState(tick(29), "fullartland", "h", 32).stale).toBe(true);
    const v28 = verificationState(tick(28), "m15", "h", 32);
    expect(v28.stale).toBe(true);
    expect(v28.reasons[0]).toMatch(/renderer changed since layout v28 \(now v32\)/);
  });

  it("v33 (the rules layout) is verification-neutral too: the round-9 sign-off stands in for re-ticks", () => {
    const tick = (v: number) => ({ verified: true, verifiedLayoutVersion: v, verifiedOverrideHash: "h" });
    expect(CARD_LAYOUT_VERSION).toBe(33);
    // A v32, v31 or v30 tick stays fresh on every template — v33 moves text
    // inside every rules box, but no slot.
    for (const template of ["m15", "m15pw", "saga", "m15token", "fullartland", "modern", "split", "battle", "lotr", "flip"]) {
      for (const v of [32, 31, 30]) expect(verificationState(tick(v), template, "h").stale, `${template}@${v}`).toBe(false);
    }
    // Older changes still stale a tick, now reported against v33.
    expect(verificationState(tick(29), "fullartland", "h").stale).toBe(true);
    const v28 = verificationState(tick(28), "m15", "h");
    expect(v28.stale).toBe(true);
    expect(v28.reasons[0]).toMatch(/renderer changed since layout v28 \(now v33\)/);
  });
});
