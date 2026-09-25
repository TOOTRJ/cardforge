import { describe, expect, it } from "vitest";
import {
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
});
