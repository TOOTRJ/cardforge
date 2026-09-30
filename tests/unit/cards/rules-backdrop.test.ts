import { describe, expect, it } from "vitest";
import { drawsRulesBackdrop, type RulesBackdropState } from "@/lib/cards/rules-backdrop";
import { getFrameProfile } from "@/lib/cards/template-layout";

// ---------------------------------------------------------------------------
// WHEN the rules box's backdrop is drawn (lib/cards/rules-backdrop.ts) — the
// one rule the preview and the bake share. TODO 4.33, owner round 15
// (2026-09-29): a borderless walker with no ability text shows the light
// first stripe in its window, never the bare art; nothing else changes.
// ---------------------------------------------------------------------------

const EMPTY: RulesBackdropState = { hasRulesContent: false, textless: false, chapters: false, rowsDrawn: false };
const TEXT: RulesBackdropState = { ...EMPTY, hasRulesContent: true };

describe("drawsRulesBackdrop", () => {
  it("draws a backdrop behind text, never without a backdrop colour", () => {
    expect(drawsRulesBackdrop({ backdropHex: "rgba(0,0,0,0.5)" }, TEXT)).toBe(true);
    expect(drawsRulesBackdrop({}, TEXT)).toBe(false);
    expect(drawsRulesBackdrop({ backdropWhenEmpty: true }, EMPTY)).toBe(false);
  });

  it("draws an EMPTY box's backdrop only when its slot says so", () => {
    expect(drawsRulesBackdrop({ backdropHex: "rgba(0,0,0,0.5)" }, EMPTY)).toBe(false);
    expect(drawsRulesBackdrop({ backdropHex: "rgba(0,0,0,0.5)", backdropWhenEmpty: true }, EMPTY)).toBe(true);
  });

  it("never under ability rows (or the editor's hint rows), a saga rail or on a textless frame", () => {
    const slot = { backdropHex: "rgba(0,0,0,0.5)", backdropWhenEmpty: true };
    for (const state of [TEXT, EMPTY]) {
      expect(drawsRulesBackdrop(slot, { ...state, rowsDrawn: true })).toBe(false);
      expect(drawsRulesBackdrop(slot, { ...state, chapters: true })).toBe(false);
      expect(drawsRulesBackdrop(slot, { ...state, textless: true })).toBe(false);
    }
  });

  it("fills only the borderless walkers' empty windows, with their light first stripe", () => {
    for (const template of ["m15borderlesspw", "m15borderlesspwtall"]) {
      const p = getFrameProfile(template);
      expect(p.rules.backdropWhenEmpty).toBe(true);
      expect(p.rules.backdropHex).toBe(p.loyaltyRows!.stripeAHex);
      expect(p.rules.backdropHex).toBe("rgba(255,255,255,0.608)");
    }
    // The bordered walker (and every other profile) keeps its empty box bare.
    expect(getFrameProfile("m15pw").rules.backdropWhenEmpty).toBeUndefined();
  });
});
