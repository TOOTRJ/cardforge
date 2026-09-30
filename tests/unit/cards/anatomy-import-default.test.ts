import { describe, expect, it } from "vitest";
import type { ScryfallCard } from "@/lib/scryfall/client";
import { mapScryfallToFormPatch } from "@/lib/scryfall/import-mapper";
import { scryfallRemixMechanics } from "@/lib/ai/remix-mechanics";
import {
  NEW_CARD_ANATOMY,
  frameAnatomyOf,
  importedAnatomy,
  importedFormAnatomy,
  newCardFrameStyle,
  qualifiesForCrown,
  resolveTwoColor,
  twoColorFitsTemplate,
} from "@/lib/cards/anatomy";
import { crownKeyFor } from "@/lib/cards/crown";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import { getFrameProfile } from "@/lib/cards/template-layout";
import { FRAME_COLOR_KEYS } from "@/lib/creator/card-kinds";
import { FRAME_TEMPLATE_VALUES, type ColorIdentity, type FrameStyle } from "@/types/card";
import printings from "../scryfall/fixtures/anatomy-printings.json";

// ---------------------------------------------------------------------------
// TODO 4.6a / 4.6b, owner round 17 (2026-09-30) — IMPORTS = PRINTING-ONLY.
// An import names a switch only where its printing says something about it:
// the crown for a Legendary printing (on with the `legendary` frame effect,
// off without it — the M15–RIX legendaries — and off on any showcase), the
// two-colour frame (and its pair) for a two-colour printing. Every other
// switch is left out, so the save stamps the NEW-card default (on) — and a
// card later made Legendary, or given a pair, starts with the piece on like
// any new card, where an explicit `false` from the import used to keep it
// off. The creator (its form holds NEW_CARD_ANATOMY under the printing's
// switches, importedFormAnatomy) and the AI deck remix (the printing's
// switches alone, stamped by createCardAction's newCardFrameStyle) store the
// same frame style for every printing.
// Fixtures: the real Scryfall printings of import-anatomy.test.ts.
// ---------------------------------------------------------------------------

const P = printings as unknown as Record<string, ScryfallCard>;
const EVERY_COMBO: ReadonlySet<string> = new Set(
  FRAME_TEMPLATE_VALUES.flatMap((t) => FRAME_COLOR_KEYS.map((k) => frameComboKey(t, k))),
);

/** What each path stores for a printing, on the frame the remix lands on. */
function stored(key: string) {
  const patch = mapScryfallToFormPatch(P[key]);
  const remix = scryfallRemixMechanics(patch, key, EVERY_COMBO);
  if (!remix.ok) throw new Error(`${key}: ${remix.error}`);
  const { frame_template: template, card_type: cardType, color_identity: colors } = remix.mechanics;
  // The AI deck remix (executeDeckRemixStep → createCardAction).
  const ai = newCardFrameStyle({ template, ...remix.mechanics.anatomy }, cardType);
  // The creator: the form's switches after the import, saved the same way.
  const imported = importedAnatomy(patch, template);
  const creator = newCardFrameStyle({ template, ...importedFormAnatomy(imported.style) }, cardType);
  return { patch, template, cardType, colors, ai, creator, style: remix.mechanics.anatomy };
}

describe("imports = printing-only (owner round 17, 2026-09-30)", () => {
  it("the creator and the AI deck remix store the same switches for every printing", () => {
    for (const key of Object.keys(P)) {
      const got = stored(key);
      expect(got.creator, key).toEqual(got.ai);
    }
  });

  it("a switch the printing names none for gets the new-card default wherever the frame can draw it", () => {
    let unnamedCrowns = 0;
    let unnamedPairs = 0;
    for (const key of Object.keys(P)) {
      const { patch, template, cardType, ai, style } = stored(key);
      if (patch.printed_crown === undefined) {
        expect("crown" in style, key).toBe(false);
        if (frameAnatomyOf(template).crown) {
          expect(ai.crown, key).toBe(true);
          unnamedCrowns += 1;
        }
      }
      if (patch.printed_two_color === undefined) {
        expect("twoColor" in style, key).toBe(false);
        if (twoColorFitsTemplate(template, cardType)) {
          expect(ai.twoColor, key).toBe(true);
          unnamedPairs += 1;
        }
      }
    }
    // The fixtures hold both kinds on m15-family frames (not a vacuous pass).
    expect(unnamedCrowns).toBeGreaterThan(0);
    expect(unnamedPairs).toBeGreaterThan(0);
  });

  it("an import never stores false for a nonlegendary or one-colour printing", () => {
    // Daemogoth Woe-Eater STX #175 (not Legendary), Arahbo FDN #2 (mono
    // white), Muldrotha FDN #243 (three colours), Fabled Passage ELD #244.
    expect(stored("stx-175").ai).toMatchObject({ crown: true, twoColor: true });
    expect(stored("fdn-2").ai).toMatchObject({ crown: true, twoColor: true });
    expect(stored("fdn-243").ai).toMatchObject({ crown: true, twoColor: true });
    expect(stored("eld-244").ai).toMatchObject({ crown: true, twoColor: true });
    // …and so none of them draws anything its printing doesn't: the crown
    // needs Legendary, the two-colour frame a stored pair.
    expect(crownKeyFor({ colorIdentity: ["black", "green"], cardType: "creature", supertype: "", frameStyle: stored("stx-175").ai }, getFrameProfile("m15"))).toBeNull();
    expect(resolveTwoColor(getFrameProfile("m15"), stored("fdn-2").ai, { colors: ["white"], cost: "{3}{W}{W}", cardType: "creature" })).toBeNull();
  });

  it("made Legendary later, a nonlegendary import wears the crown like any new card", () => {
    const { ai, colors } = stored("stx-175");
    expect(qualifiesForCrown({ cardType: "creature", supertype: "Legendary" })).toBe(true);
    expect(
      crownKeyFor(
        { colorIdentity: colors as ColorIdentity[], cost: "{1}{B}{B/G}{G}", cardType: "creature", supertype: "Legendary", frameStyle: ai },
        getFrameProfile("m15"),
      ),
    ).toBe("bg");
  });

  it("given a pair later, a one-colour import wears the two-colour frame like any new card", () => {
    const { ai } = stored("fdn-2");
    expect(resolveTwoColor(getFrameProfile("m15"), ai, { colors: ["white", "blue"], cost: "{1}{W}{U}", cardType: "creature" })?.masterKey).toBe("wu");
  });

  it("a crownless Legendary printing and a showcase stay OFF — explicit false", () => {
    // M15 #3 Avacyn (M15–RIX: no `legendary` effect — owner 2026-09-29).
    expect(stored("m15-3").ai).toMatchObject({ template: "m15", crown: false });
    // MUL #66 Anafenza (a showcase signature, landing on m15) — Q6 → b.
    expect(stored("mul-66").ai).toMatchObject({ template: "m15", crown: false });
    // LTR #302 Boromir (Scryfall's `showcase` effect) where it lands on m15.
    const ltr = mapScryfallToFormPatch(P["ltr-302"]);
    expect(ltr.printed_crown).toBe(false);
    const onM15: FrameStyle = { template: "m15", ...importedFormAnatomy(importedAnatomy(ltr, "m15").style) };
    expect(newCardFrameStyle(onM15, ltr.card_type)).toMatchObject({ crown: false });
  });

  it("a two-colour printing and a crowned one name their switches ON", () => {
    expect(stored("fdn-122").style).toEqual({ crown: true, twoColor: true }); // Kykar
    expect(stored("fdn-122").colors).toEqual(["white", "blue"]);
    expect(stored("mkm-264").style).toEqual({ twoColor: true }); // Meticulous Archive (a land)
    expect(stored("fdn-2").style).toEqual({ crown: true });
    expect(NEW_CARD_ANATOMY).toEqual({ crown: true, twoColor: true });
  });
});
