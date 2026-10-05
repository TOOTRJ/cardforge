import { describe, expect, it } from "vitest";
import dfcPrintings from "./fixtures/dfc-import-printings.json";
import signaturePrintings from "./fixtures/signature-printings.json";
import { scryfallCardSchema, type ScryfallCard } from "@/lib/scryfall/client";
import { dfcImportOf, frameMatchFromScryfall, kindFromScryfall, mapScryfallToFormPatch } from "@/lib/scryfall/import-mapper";
import { finalizeImportMatch } from "@/lib/creator/frame-resolve";
import { remixCreditsOf, scryfallRemixMechanics } from "@/lib/ai/remix-mechanics";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import type { FrameTemplate } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 5.4 — a MODAL printing on the REAL modal bodies (5.1b: `bodyFor`'s
// modal rows, `m15mdfcfront` / `m15mdfcback` and the land pair). Until 5.1b
// this file stood four other templates in for them under mocks; the same
// mapper, registry and remix code now turns a modal printing onto the
// bodies by itself. A modal LAND face keeps the colour its mana ability
// adds (the modal land pair is one tint per colour, verified per colour —
// the transform land pair's colourless rule is that pair's alone); a devoid
// or snow modal printing lands on the era's dress frame with a legacy back
// (`dress`: no body carries the dress, 5.11).
// ---------------------------------------------------------------------------

// The double-faced fixture file wins: signature-printings.json carries
// trimmed twins of a few of its printings (ZNR #12's back without its text).
const ALL = { ...signaturePrintings, ...dfcPrintings } as Record<string, unknown>;
const printing = (key: string): ScryfallCard => scryfallCardSchema.parse(ALL[key]);
const keys = (...combos: [string, string][]) =>
  new Set(combos.map(([template, colour]) => frameComboKey(template as FrameTemplate, colour)));

describe("a modal printing on the modal bodies (5.1b)", () => {
  it("lands on the modal bodies: the Modal kind, the front body by the front's type, the back by the back's, each face's own colour (no family)", () => {
    // STX #147 Augmenter Pugilist // Echoing Equation: a green creature
    // front, a blue sorcery back — the back keeps its cost.
    const facts = dfcImportOf(printing("stx-147"));
    expect(facts).toMatchObject({ layout: "modal", kind: "mdfc", blocked: null, frontBody: "m15mdfcfront", backBody: "m15mdfcback" });
    expect(kindFromScryfall(printing("stx-147"))).toBe("mdfc");
    const patch = mapScryfallToFormPatch(printing("stx-147"));
    expect(patch).toMatchObject({ kind: "mdfc", frame_template: "m15mdfcfront", color_identity: ["green"] });
    expect(patch.printed_dfc_icon).toBeUndefined();
    expect(patch.back_face).toMatchObject({ title: "Echoing Equation", card_type: "sorcery", cost: "{3}{U}{U}", frame_style: { template: "m15mdfcback" }, color_identity: ["blue"] });
    // ZNR #12 Emeria's Call: a sorcery front // a land back on the modal
    // land back in its OWN colour — white, the mana its ability adds
    // (never colourless: that is the transform land back's one-master rule).
    expect(mapScryfallToFormPatch(printing("znr-12"))).toMatchObject({
      kind: "mdfc",
      frame_template: "m15mdfcfront",
      color_identity: ["white"],
      back_face: { card_type: "land", frame_style: { template: "m15mdfclandback" }, color_identity: ["white"] },
    });
    // KHM #112 Tergrid: a black artifact back with a cost.
    expect(mapScryfallToFormPatch(printing("khm-112")).back_face).toMatchObject({
      card_type: "artifact",
      cost: "{3}{B}",
      frame_style: { template: "m15mdfcback" },
      color_identity: ["black"],
    });
    // A land // land Pathway (ZNR #284 Branchloft, the borderless printing):
    // the land pair, the front in the colour its ability adds (green). The
    // fixture's back face carries no text, so its colour reads colourless
    // here; a real Boulderloft back ("{T}: Add {W}.") is white.
    expect(mapScryfallToFormPatch(printing("znr-284"))).toMatchObject({
      kind: "mdfc",
      frame_template: "m15mdfclandfront",
      color_identity: ["green"],
      back_face: { card_type: "land", frame_style: { template: "m15mdfclandback" } },
    });
  });

  it("the registry: exact on the modal front body; a colourless Avatar front and a devoid or snow dress are the body's frame landing on the era frame (5.11); borderless is nearest on the body", () => {
    expect(frameMatchFromScryfall(printing("stx-147"))).toMatchObject({ signature: "modal/2015", status: "exact", template: "m15mdfcfront" });
    expect(frameMatchFromScryfall(printing("znr-12"))).toMatchObject({ signature: "modal/2015", status: "exact", template: "m15mdfcfront" });
    expect(frameMatchFromScryfall(printing("znr-12")).onceVerified).toBeUndefined();
    // STX #6 Wandering Archaic: a colourless creature front with no
    // Artifact word.
    expect(dfcImportOf(printing("stx-6"))).toMatchObject({ blocked: "colourless-face", frontBody: "m15mdfcfront", backBody: "m15mdfcback" });
    expect(frameMatchFromScryfall(printing("stx-6"))).toMatchObject({ signature: "dfc/colourless-face", status: "nearest", template: "m15mdfcfront", landOn: "m15", blockedBy: "5.11" });
    expect(mapScryfallToFormPatch(printing("stx-6"))).toMatchObject({ kind: "creature", frame_template: "m15" });
    // MH3 #253 Drowner of Truth, a devoid MDFC: the devoid frame with a
    // legacy back, as before 5.4 — never the plain body.
    expect(dfcImportOf(printing("mh3-253"))).toMatchObject({ blocked: "dress", frontBody: "m15mdfcfront", backBody: "m15mdfclandback" });
    expect(frameMatchFromScryfall(printing("mh3-253"))).toMatchObject({ signature: "dfc/devoid", status: "nearest", template: "m15mdfcfront", landOn: "m15devoid", blockedBy: "5.11" });
    const drowner = mapScryfallToFormPatch(printing("mh3-253"));
    expect(drowner).toMatchObject({ kind: "creature", frame_template: "m15devoid" });
    expect(drowner.back_face?.frame_style).toBeUndefined();
    expect(drowner.back_face?.color_identity).toBeUndefined();
    // KHM #179 Jorn, God of Winter, a SNOW MDFC: the snow frame, the same way.
    expect(dfcImportOf(printing("khm-179"))).toMatchObject({ blocked: "dress", frontBody: "m15mdfcfront", backBody: "m15mdfcback" });
    expect(frameMatchFromScryfall(printing("khm-179"))).toMatchObject({ signature: "dfc/snow", status: "nearest", template: "m15mdfcfront", landOn: "m15snow", blockedBy: "5.11" });
    expect(mapScryfallToFormPatch(printing("khm-179"))).toMatchObject({ kind: "creature", frame_template: "m15snow" });
    // ZNR #284 Branchloft Pathway, borderless: nearest on the land front
    // (no bordered twin to land on).
    expect(frameMatchFromScryfall(printing("znr-284"))).toMatchObject({ signature: "borderless/dfc", status: "nearest", template: "m15mdfclandfront", blockedBy: "5.7" });
    expect(frameMatchFromScryfall(printing("znr-284")).landOn).toBeUndefined();
    // ZNR #305 Kazandu Mammoth, the hedron showcase: the showcase frame
    // can't dress the Modal kind, so it lands on the body.
    expect(frameMatchFromScryfall(printing("znr-305"))).toMatchObject({ status: "nearest", template: "fullart", landOn: "m15mdfcfront" });
  });

  it("the landing is verified on both faces, and the remix keeps both at two credits", () => {
    const patch = mapScryfallToFormPatch(printing("stx-147"));
    const frontOnly = finalizeImportMatch(patch, keys(["m15mdfcfront", "g"]));
    expect(frontOnly).toMatchObject({ kind: "creature", frame_template: "m15" });
    expect(frontOnly.frame_match).toMatchObject({ status: "nearest", landOn: "m15", unverified: true, reason: "the back face's frame isn't verified in blue yet" });
    const both = keys(["m15mdfcfront", "g"], ["m15mdfcback", "u"]);
    expect(finalizeImportMatch(patch, both)).toMatchObject({ kind: "mdfc", frame_template: "m15mdfcfront", frame_match: { status: "exact" } });
    // The land back in its own colour is what the landing checks: Emeria's
    // white back needs `m15mdfclandback/w`, not the colourless key.
    const emeria = mapScryfallToFormPatch(printing("znr-12"));
    expect(finalizeImportMatch(emeria, keys(["m15mdfcfront", "w"], ["m15mdfclandback", "c"])).frame_match).toMatchObject({ unverified: true, reason: "the back face's frame isn't verified in white yet" });
    expect(finalizeImportMatch(emeria, keys(["m15mdfcfront", "w"], ["m15mdfclandback", "w"]))).toMatchObject({ kind: "mdfc", frame_template: "m15mdfcfront", back_face: { color_identity: ["white"] } });
    const remix = scryfallRemixMechanics(patch, "Augmenter Pugilist", both);
    if (!remix.ok) throw new Error(remix.error);
    expect(remix.mechanics).toMatchObject({
      frame_template: "m15mdfcfront",
      card_type: "creature",
      back_face: { title: "Echoing Equation", cost: "{3}{U}{U}", frame_style: { template: "m15mdfcback" }, color_identity: ["blue"] },
    });
    expect(remix.mechanics.anatomy.dfcIcon).toBeUndefined();
    expect(remixCreditsOf(remix.mechanics)).toBe(2);
    const standard = scryfallRemixMechanics(patch, "Augmenter Pugilist", keys(["m15", "g"]));
    if (!standard.ok) throw new Error(standard.error);
    expect(standard.mechanics.frame_template).toBe("m15");
    expect(standard.mechanics.back_face).toBeUndefined();
  });
});
