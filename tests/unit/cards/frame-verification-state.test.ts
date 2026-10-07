import { describe, expect, it } from "vitest";
import { CARD_LAYOUT_VERSION } from "@/lib/cards/layout-version";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";
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
    expect(CARD_LAYOUT_VERSION).toBeGreaterThanOrEqual(33);
    // A v32, v31 or v30 tick stays fresh on every template — v33 moves text
    // inside every rules box, but no slot. (Pinned at v33: v34 stales the
    // token frames' ticks, below.)
    for (const template of ["m15", "m15pw", "saga", "m15token", "fullartland", "modern", "split", "battle", "lotr", "flip"]) {
      for (const v of [32, 31, 30]) expect(verificationState(tick(v), template, "h", 33).stale, `${template}@${v}`).toBe(false);
    }
    // Older changes still stale a tick, now reported against v33.
    expect(verificationState(tick(29), "fullartland", "h", 33).stale).toBe(true);
    const v28 = verificationState(tick(28), "m15", "h", 33);
    expect(v28.stale).toBe(true);
    expect(v28.reasons[0]).toMatch(/renderer changed since layout v28 \(now v33\)/);
  });

  it("v34 (the token release) stales the 14 token-frame ticks — still verified — and no other template's (owner decision 7)", () => {
    expect(CARD_LAYOUT_VERSION).toBeGreaterThanOrEqual(34);
    // Production's 14 token ticks: every colour of both token frames, all
    // legacy rows (no verified_layout_version, ticked 2026-07-08).
    const legacy = { verified: true, verifiedLayoutVersion: null, verifiedOverrideHash: null };
    const ticks = ["m15token", "m15tokenartifact"].flatMap((template) =>
      ["w", "u", "b", "r", "g", "c", "m"].map((color) => ({ template, color })),
    );
    expect(ticks).toHaveLength(14);
    for (const { template, color } of ticks) {
      const state = verificationState(legacy, template, "none", 34);
      // Still verified: the creator keeps offering the frame…
      expect(state.verified, `${template}/${color}`).toBe(true);
      // …and the admin pages say "needs re-verification".
      expect(state.stale, `${template}/${color}`).toBe(true);
      expect(state.reasons).toEqual(["the renderer changed since this tick (made before layout v33; now v34)"]);
    }
    // A stamped tick from v33 / v32 / v30 on them goes stale too; a v34 re-tick is fresh.
    const tick = (v: number) => ({ verified: true, verifiedLayoutVersion: v, verifiedOverrideHash: "h" });
    for (const template of ["m15token", "m15tokenartifact"]) {
      for (const v of [33, 32, 30]) expect(verificationState(tick(v), template, "h", 34).stale, `${template}@${v}`).toBe(true);
      expect(verificationState(tick(34), template, "h", 34).stale, template).toBe(false);
    }
    // Every other template's tick — a legacy one or a v33 one — stays fresh:
    // the token wording (the showcases, flip's Roles) moves no slot.
    for (const template of FRAME_TEMPLATE_VALUES.filter((t) => t !== "m15token" && t !== "m15tokenartifact")) {
      expect(verificationState(legacy, template, "none", 34).stale, `${template} legacy`).toBe(false);
      expect(verificationState(tick(33), template, "h", 34).stale, `${template}@33`).toBe(false);
    }
  });

  it("v35 (the art-area corrections) is verification-neutral: no tick goes stale on any template", () => {
    expect(CARD_LAYOUT_VERSION).toBeGreaterThanOrEqual(35);
    const tick = (v: number) => ({ verified: true, verifiedLayoutVersion: v, verifiedOverrideHash: "h" });
    const legacy = { verified: true, verifiedLayoutVersion: null, verifiedOverrideHash: null };
    // The templates whose art moved — the CC M15 family, the see-through
    // masters, nyx, fullart — keep a v34 tick fresh, and a legacy one too
    // (the token frames' legacy ticks stay stale from v34, not from v35).
    for (const template of FRAME_TEMPLATE_VALUES) {
      expect(verificationState(tick(34), template, "h", 35).stale, `${template}@34`).toBe(false);
      if (template !== "m15token" && template !== "m15tokenartifact") {
        expect(verificationState(legacy, template, "none", 35).stale, `${template} legacy`).toBe(false);
      }
    }
  });

  it("v36 (the second correction round) stales no tick — the walkers' included (owner round 18: verification-neutral)", () => {
    expect(CARD_LAYOUT_VERSION).toBeGreaterThanOrEqual(36);
    const tick = (v: number) => ({ verified: true, verifiedLayoutVersion: v, verifiedOverrideHash: "h" });
    const legacy = { verified: true, verifiedLayoutVersion: null, verifiedOverrideHash: null };
    // Production's seven m15pw ticks are legacy rows (2026-07-08): they stay
    // fresh — the owner signed 4.47's symbolRect move off on the round-18
    // walker sheet, as v32's m15pw costRect move. The pips move text inside
    // the rules boxes (as v33), the set symbols change size (as v32).
    for (const template of FRAME_TEMPLATE_VALUES) {
      expect(verificationState(tick(35), template, "h", 36).stale, `${template}@35`).toBe(false);
      expect(verificationState(tick(36), template, "h", 36).stale, `${template}@36`).toBe(false);
      // (The token frames' legacy ticks stay stale from v34, not from v36.)
      if (template !== "m15token" && template !== "m15tokenartifact") {
        const state = verificationState(legacy, template, "none", 36);
        expect(state.verified, `${template} legacy`).toBe(true);
        expect(state.stale, `${template} legacy`).toBe(false);
      }
    }
    for (const template of ["m15token", "m15tokenartifact"]) {
      expect(verificationState(legacy, template, "none", 36).reasons, template).toEqual([
        "the renderer changed since this tick (made before layout v33; now v36)",
      ]);
    }
  });
});
