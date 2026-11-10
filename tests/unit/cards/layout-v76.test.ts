import { describe, expect, it } from "vitest";
import {
  CARD_LAYOUT_VERSION,
  CUSTOM_SYMBOLS_LAYOUT_VERSION,
  VERIFICATION_NEUTRAL_VERSIONS,
  VERIFICATION_SCOPED_VERSIONS,
  VERSION_ROLLOUT,
  VERSION_SCOPES,
  classifyForSweep,
  customSymbolsChanged,
  hasNewerLook,
  hasPendingCorrection,
  isRenderStale,
  latestOptInVersion,
} from "@/lib/cards/layout-version";
import { SCOPE_CARD_COLUMNS } from "@/lib/cards/bake-select";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";
import { UNTOUCHED_SINCE_V22 } from "@/tests/stubs/layout-scope-cards";

// ---------------------------------------------------------------------------
// Layout v76 (owner 2026-11-09): the card owner's own mana symbols — `{*CODE}`
// draws the symbol's picture, or a placeholder disc — where both renderers
// drew nothing. A card scope alone, on any template; verification-neutral;
// no badge. Renumbered with CUSTOM_SYMBOLS_LAYOUT_VERSION if another bump
// merges first.
// ---------------------------------------------------------------------------

const V = CUSTOM_SYMBOLS_LAYOUT_VERSION;
const png = "https://x/y.png";
/** A v75 bake: only v76 can be pending. */
const at = (over: Record<string, unknown> = {}) => ({
  ...UNTOUCHED_SINCE_V22,
  visibility: "public",
  layout_version: V - 1,
  rendered_image_url: png,
  cost: "{2}{G}",
  rules_text: "Flying",
  face_content: null,
  back_face: null,
  ...over,
});
const AT = { current: V } as const;
const sweep = (row: Parameters<typeof classifyForSweep>[0]) => classifyForSweep(row, undefined, { current: V });

describe("v76 — the owner's own mana symbols", () => {
  it("is the current version: a sweep, never a badge, on ANY template — a card scope alone, verification-neutral", () => {
    expect(V).toBe(76);
    expect(CARD_LAYOUT_VERSION).toBeGreaterThanOrEqual(V);
    expect(VERSION_ROLLOUT[V]).toBe("sweep");
    expect(latestOptInVersion()).toBe(22);
    expect(VERSION_SCOPES[V]).toBe(customSymbolsChanged);
    expect(VERIFICATION_NEUTRAL_VERSIONS).toContain(V);
    expect(VERIFICATION_SCOPED_VERSIONS[V]).toEqual([]);
    // Without a card to judge by, every template is touched.
    for (const t of FRAME_TEMPLATE_VALUES) expect(isRenderStale(V - 1, t, undefined, V), t).toBe(true);
  });

  it("re-bakes a card that names {*CODE} anywhere it is drawn, on any template", () => {
    for (const over of [
      { cost: "{1}{*ABC}" },
      { cost: "{*a1}" },
      { rules_text: "{T}: Add {*FIRE}." },
      { rules_text: "Pay {*z}: Draw a card." },
      { face_content: { v: 1, loyalty: { abilities: [{ cost: "+1", text: "Add {*AE1}." }] } } },
      { back_face: { title: "Back", cost: "{*MOON}" } },
      { back_face: { title: "Back", rules_text: "{*MOON}, {T}: Scry 1." } },
    ]) {
      for (const template of ["m15", "saga", "split", "retro", "m15borderless", "agclassic"]) {
        const row = at({ ...over, frame_style: { template } });
        expect(sweep(row), `${template} ${JSON.stringify(over)}`).toBe("rebake");
        expect(isRenderStale(V - 1, template, undefined, V, row)).toBe(true);
        expect(hasPendingCorrection(row, AT)).toBe(true);
        expect(hasNewerLook(row, AT)).toBe(false);
      }
    }
  });

  it("stamps every other card: no symbol, a shape that is no code, a code in the flavour or the name", () => {
    for (const over of [
      {},
      { cost: "{*}" },
      { cost: "{*1}" },
      { cost: "{* ABC}" },
      { cost: "{*ABCDEFG}" },
      { rules_text: "A star * in the rules, {*_x}." },
      { flavor_text: "{*ABC} in the flavour prints as typed." },
      { title: "{*ABC}" },
      { back_face: { title: "Back", rules_text: "Flying" } },
    ]) {
      const row = at(over);
      expect(sweep(row), JSON.stringify(over)).toBe("stamp");
      expect(isRenderStale(V - 1, "m15", undefined, V, row)).toBe(false);
      expect(hasPendingCorrection(row, AT), JSON.stringify(over)).toBe(false);
    }
  });

  it("can't judge a row without the columns it reads → affected; the scan selects them", () => {
    expect(customSymbolsChanged({ rules_text: null, face_content: null, back_face: null })).toBe(true);
    expect(customSymbolsChanged({ cost: null, face_content: null, back_face: null })).toBe(true);
    expect(customSymbolsChanged({ cost: null, rules_text: null, back_face: null })).toBe(true);
    expect(customSymbolsChanged({ cost: null, rules_text: null, face_content: null })).toBe(true);
    expect(customSymbolsChanged({ cost: null, rules_text: null, face_content: null, back_face: null })).toBe(false);
    for (const column of ["cost", "rules_text", "face_content", "back_face"]) {
      expect(SCOPE_CARD_COLUMNS as readonly string[]).toContain(column);
    }
  });

  // A version with no rollout and no scope reads as a SWEEP OF EVERY CARD,
  // so v76 never ships over a gap.
  it("ships only after v75: no gap below it", () => {
    expect(VERSION_ROLLOUT[V - 1]).toBeDefined();
    expect(isRenderStale(V - 2, "m15", undefined, V - 1)).toBe(false);
  });
});
