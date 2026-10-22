import { describe, expect, it } from "vitest";
import printingsData from "./fixtures/expedition-printings.json";
import { scryfallCardSchema } from "@/lib/scryfall/client";
import { frameColorsFromScryfall, frameMatchFromScryfall, frontFaceColors, mapScryfallToFormPatch } from "@/lib/scryfall/import-mapper";
import { importedAnatomy, normalizeAnatomy, storedAnatomyOf } from "@/lib/cards/anatomy";
import { frameGateColors } from "@/lib/cards/part-color";
import { frameGateError } from "@/lib/cards/frame-availability";
import { getFrameProfile } from "@/lib/cards/template-layout";
import { frameMasterKey } from "@/components/cards/frame-layer";
import { pickFrameColorKey } from "@/lib/cards/frame-color-key";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import { finalizeImportMatch, importFrameColorKey, resolveImportFrame } from "@/lib/creator/frame-resolve";
import { appliedImportFrameChoice, frameFitsImport, importFramePlan } from "@/lib/creator/import-frame-choice";
import { frameRequestFromImport } from "@/lib/frames/frame-requests";
import { ownCardRemixFrame, scryfallRemixMechanics } from "@/lib/ai/remix-mechanics";

// ---------------------------------------------------------------------------
// TODO 4.11 wave 1: every Zendikar Expedition printing on Scryfall (ZNE #1–30,
// 2020; EXP #1–45, 2015–16 — fixtures/expedition-printings.json, captured
// 2026-10-21 and trimmed to what the import reads) lands on ITS look's frame:
// ZNE on `expeditionland` (Card Conjurer's 'ZNR Expeditions (2020)'), EXP on
// `expeditionlandbfz` ('BFZ Expeditions (2015)'). Exact once verified, but a
// two-colour land — the duals and the fetch lands, whose pinline prints their
// two colours — is nearest through the two-colour gap (the pair masters are
// 4.11's follow-up). Before: all 75 on `expeditionland`, exact.
// ---------------------------------------------------------------------------

const printings = printingsData as Record<string, unknown>;
const card = (key: string) => scryfallCardSchema.parse(printings[key]);

describe("the Expedition imports", () => {
  const rows = Object.keys(printings).map((key) => {
    const c = card(key);
    const match = frameMatchFromScryfall(c);
    return { key, set: c.set, match, colour: pickFrameColorKey(frameColorsFromScryfall(c)) };
  });

  it("covers every printing: 30 ZNE, 45 EXP", () => {
    expect(rows.filter((r) => r.set === "zne")).toHaveLength(30);
    expect(rows.filter((r) => r.set === "exp")).toHaveLength(45);
  });

  it("lands each set on its own look's frame, never landing elsewhere", () => {
    for (const r of rows) {
      expect(r.match.template, r.key).toBe(r.set === "zne" ? "expeditionland" : "expeditionlandbfz");
      expect(r.match.landOn, r.key).toBeUndefined();
    }
  });

  it("is exact but for a two-colour land, nearest through the two-colour gap (4.11)", () => {
    const tally: Record<string, number> = {};
    for (const r of rows) {
      const twoColour = r.match.status === "nearest";
      tally[`${r.set} ${r.match.status}`] = (tally[`${r.set} ${r.match.status}`] ?? 0) + 1;
      if (twoColour) {
        expect(r.match.blockedBy, r.key).toBe("4.11");
        expect(r.match.gaps, r.key).toEqual(["two-colour"]);
        // Its colour stays gold (main's); the FRAME draws the plain land
        // master (below).
        expect(r.colour, r.key).toBe("m");
        expect(frontFaceColors(card(r.key)), r.key).toHaveLength(2);
      } else {
        expect(r.match.status, r.key).toBe("exact");
      }
    }
    // ZNE: the ten fetches, the ten duals, Celestial Colonnade, Creeping Tar
    // Pit, Grove of the Burnwillows and Horizon Canopy two-colour; EXP: the
    // fifteen duals, the ten fetches, the ten filter lands, Horizon Canopy.
    expect(tally).toEqual({ "zne exact": 6, "zne nearest": 24, "exp exact": 9, "exp nearest": 36 });
  });

  it("keeps a two-colour Expedition's colour exactly as main stores it and draws, gates and verifies its FRAME in the plain land master `c`", () => {
    for (const [key, template] of [["zne-1", "expeditionland"], ["exp-1", "expeditionlandbfz"]] as const) {
      const patch = mapScryfallToFormPatch(card(key));
      // The card's colour: main's, gold ("multicolor"; the page, the
      // filters, the decks) — never the frame's stand-in.
      expect(patch.color_identity, key).toEqual(["multicolor"]);
      expect(patch.color_identity, key).toEqual(frameColorsFromScryfall(card(key)));
      expect(patch.printed_plain_land_master, key).toBe(true);
      // The import's anatomy carries the frame data; the save keeps it on
      // the Expedition frames and drops it on any other.
      const { style, colorIdentity } = importedAnatomy(patch, template);
      expect(colorIdentity, key).toEqual(["multicolor"]);
      expect(style.plainLandMaster, key).toBe(true);
      expect(normalizeAnatomy({ ...style, template }, template, "land").plainLandMaster, key).toBe(true);
      expect("plainLandMaster" in normalizeAnatomy({ ...style, template: "m15land" }, "m15land", "land"), key).toBe(false);
      // Both renderers' master (frameMasterKey): the plain land `c`.
      const profile = getFrameProfile(template);
      expect(frameMasterKey(profile, colorIdentity, { cardType: "land" }, style), key).toBe("c");
      expect(frameMasterKey(profile, colorIdentity, { cardType: "land" }, {}), key).toBe("m");
      // The gate and the verification combo: `c` (frameGateColors).
      expect(frameGateColors(template, style, colorIdentity), key).toEqual(["colorless"]);
      const onlyC = new Set([`${template}/c`]);
      expect(frameGateError(template, frameGateColors(template, style, colorIdentity), onlyC), key).toBeNull();
      expect(frameGateError(template, colorIdentity, onlyC), key).not.toBeNull();
      // A remix keeps it (storedAnatomyOf).
      expect(storedAnatomyOf({ template, ...style }).plainLandMaster, key).toBe(true);
    }
    // Not on an any-colour land (gold, as printed), nor on the same land
    // printed in a regular set, nor once the card is recoloured.
    expect(mapScryfallToFormPatch(card("zne-22")).printed_plain_land_master).toBeUndefined();
    const strand = printings["zne-1"] as Record<string, unknown>;
    for (const over of [{ set: "ktk", set_type: "expansion" }, { set: "mps", set_type: "masterpiece" }]) {
      expect(mapScryfallToFormPatch(scryfallCardSchema.parse({ ...strand, ...over })).printed_plain_land_master, over.set).toBeUndefined();
    }
    expect(frameMasterKey(getFrameProfile("expeditionland"), ["red"], { cardType: "land" }, { plainLandMaster: true })).toBe("r");
    expect(frameMasterKey(getFrameProfile("m15land"), ["multicolor"], { cardType: "land" }, { plainLandMaster: true })).toBe("m");
  });

  // The import's chooser, its applied pick, its overwrite note and its
  // request row read the key the card PAINTS on each frame
  // (importFrameColorKey): `c` on the Expedition frames, gold anywhere else.
  // Before (#602's skeptic check): the chooser checked gold while the card
  // drew, saved and landed in `c`.
  it("offers and applies a two-colour Expedition's frame where its plain land `c` is ticked — never where only gold is", () => {
    for (const [key, template] of [["zne-1", "expeditionland"], ["exp-1", "expeditionlandbfz"]] as const) {
      const onlyC = new Set([frameComboKey(template, "c"), frameComboKey("m15land", "m")]);
      const onlyM = new Set([frameComboKey(template, "m"), frameComboKey("m15land", "m")]);
      const raw = mapScryfallToFormPatch(card(key));
      expect(importFrameColorKey(template, raw), key).toBe("c");
      expect(importFrameColorKey("m15land", raw), key).toBe("m");

      // Only `c` ticked: offered, preselected as the nearest, and applied.
      const patchC = finalizeImportMatch(raw, onlyC);
      expect(patchC.color_identity, key).toEqual(["multicolor"]);
      const planC = importFramePlan(patchC, onlyC, "m15");
      expect(planC.mode, key).toBe("choose");
      if (planC.mode !== "choose") continue;
      expect(planC.options.map((o) => o.template), key).toContain(template);
      expect(planC.options.find((o) => o.template === template)?.nearest, key).toBe(true);
      expect(planC.preselected, key).toEqual({ template });
      // (the "PipGlyph can't match … exactly yet" heading: the frame IS there)
      expect(planC.heading, key).toMatch(/can't match/);
      expect(frameFitsImport(template, { kind: "land", verifiedKeys: onlyC, patch: patchC }), key).toBe(true);
      expect(
        appliedImportFrameChoice({ choice: { template }, patch: patchC, kind: "land", templateBefore: "m15", verifiedKeys: onlyC }),
        key,
      ).toBe(template);
      // The landing without a pick, and the request row: verified in `c`,
      // still nearest through the two-colour gap (the registry's own cause).
      const landed = resolveImportFrame({ patch: patchC, kind: "land", current: { colors: [] }, verifiedKeys: onlyC });
      expect(landed.resolution, key).toEqual({ status: "exact", template, colorKey: "c" });
      const row = frameRequestFromImport(patchC, { artImported: true, source: "import", verifiedKeys: onlyC });
      expect(row?.status, key).toBe("nearest");
      expect(row?.cause, key).toBe("missing");

      // Only gold ticked: the Expedition frame is neither offered nor
      // applied; the land lands on m15land in its gold.
      const patchM = finalizeImportMatch(raw, onlyM);
      const planM = importFramePlan(patchM, onlyM, "m15");
      expect(planM.mode, key).toBe("choose");
      if (planM.mode !== "choose") continue;
      expect([...planM.options, ...planM.moreOptions].map((o) => o.template), key).not.toContain(template);
      expect(planM.preselected, key).toEqual({ template: "m15land" });
      expect(frameFitsImport(template, { kind: "land", verifiedKeys: onlyM, patch: patchM }), key).toBe(false);
      expect(
        appliedImportFrameChoice({ choice: { template }, patch: patchM, kind: "land", templateBefore: "m15", verifiedKeys: onlyM }),
        key,
      ).toBeNull();
      const fallback = resolveImportFrame({ patch: patchM, kind: "land", current: { colors: [] }, verifiedKeys: onlyM });
      expect(fallback.resolution, key).toMatchObject({ status: "frame-switched", template: "m15land", colorKey: "m" });
    }
  });

  // The AI deck remix lands where the import lands (remixFrameFor →
  // resolveImportFrame with the patch's plain-land key) and saves only what
  // the save's gate passes: never a refusal after the art. #602's fourth
  // check: the remix gated in `m` and saved in `c` (only `m` ticked → the
  // Expedition frame, refused at the save; only `c` → m15land, where the
  // import took the Expedition frame).
  it("the AI deck remix of a two-colour Expedition lands where the import lands and passes the save's gate, in every tick state", () => {
    for (const [key, template] of [["zne-1", "expeditionland"], ["exp-1", "expeditionlandbfz"]] as const) {
      const raw = mapScryfallToFormPatch(card(key));
      const states: Record<string, string[]> = {
        "only m": [frameComboKey(template, "m")],
        "only c": [frameComboKey(template, "c")],
        both: [frameComboKey(template, "c"), frameComboKey(template, "m")],
        neither: [],
      };
      const landings: Record<string, string> = {};
      for (const [state, ticks] of Object.entries(states)) {
        const keys = new Set([...ticks, frameComboKey("m15land", "m")]);
        const label = `${key} ${state}`;
        const remix = scryfallRemixMechanics(raw, "x", keys);
        expect(remix.ok, label).toBe(true);
        if (!remix.ok) continue;
        const m = remix.mechanics;
        // The import's landing of the same printing (the deck pre-fill's
        // path, and the chooser's preselected nearest).
        const finalized = finalizeImportMatch(raw, keys);
        const imported = resolveImportFrame({ patch: finalized, kind: "land", current: { colors: [] }, verifiedKeys: keys });
        expect(imported.resolution.status === "exact" || imported.resolution.status === "frame-switched", label).toBe(true);
        if (imported.resolution.status !== "exact" && imported.resolution.status !== "frame-switched") continue;
        expect(m.frame_template, label).toBe(imported.resolution.template);
        const plan = importFramePlan(finalized, keys, "m15");
        if (plan.mode === "choose") expect(plan.preselected, label).toEqual({ template: m.frame_template });
        landings[state] = m.frame_template;
        // The card's colour is the import's on that frame (gold on the
        // Expedition frames; m15land, which draws pairs, takes the
        // printing's pair as main does — still gold-keyed); the save's gate
        // (create: frameGateColors over the payload's frame_style) passes.
        expect(m.color_identity, label).toEqual(importedAnatomy(raw, m.frame_template).colorIdentity ?? raw.color_identity);
        expect(pickFrameColorKey(m.color_identity), label).toBe("m");
        const frameStyle = { template: m.frame_template, ...m.anatomy };
        expect(frameGateError(m.frame_template, frameGateColors(m.frame_template, frameStyle, m.color_identity), keys), label).toBeNull();
        const saved = normalizeAnatomy(frameStyle, m.frame_template, "land", m.color_identity);
        expect(frameGateError(m.frame_template, frameGateColors(m.frame_template, saved, m.color_identity), keys), label).toBeNull();
        // …and on the Expedition frame it draws the `c` it was gated in;
        // the key never reaches another frame.
        expect(frameMasterKey(getFrameProfile(m.frame_template), m.color_identity, { cardType: "land" }, saved) === "c", label).toBe(
          m.frame_template === template,
        );
      }
      expect(landings, key).toEqual({ "only m": "m15land", "only c": template, both: template, neither: "m15land" });

      // A remix of the user's OWN stored card agrees: kept on the
      // Expedition frame where `c` is ticked, else the default landing.
      const own = (ticks: string[]) =>
        ownCardRemixFrame(
          {
            frame_style: { template, plainLandMaster: true },
            color_identity: ["multicolor"],
            card_type: "land",
            supertype: null,
            subtypes: [],
            title: "x",
            rules_text: "",
          },
          new Set([...ticks, frameComboKey("m15land", "m")]),
        ).frame_template;
      expect(own(states["only c"]), key).toBe(template);
      expect(own(states.both), key).toBe(template);
      expect(own(states["only m"]), key).toBeUndefined();
      expect(own(states.neither), key).toBeUndefined();
    }
  });

  it("the save keeps the plain-land key only on a gold-keyed card", () => {
    const style = { template: "expeditionland", plainLandMaster: true as const };
    expect(normalizeAnatomy(style, "expeditionland", "land", ["multicolor"]).plainLandMaster).toBe(true);
    expect(normalizeAnatomy(style, "expeditionland", "land", ["green", "white"]).plainLandMaster).toBe(true);
    for (const colors of [["green"], ["colorless"], []] as const) {
      expect("plainLandMaster" in normalizeAnatomy(style, "expeditionland", "land", colors), colors.join()).toBe(false);
    }
    // Not judged by colour where the caller doesn't know it.
    expect(normalizeAnatomy(style, "expeditionland", "land").plainLandMaster).toBe(true);
  });

  it("reads each reference's colour as the registry lists it", () => {
    const colour = (key: string) => pickFrameColorKey(frameColorsFromScryfall(card(key)));
    // ZNE: Ancient Tomb / Strip Mine / Wasteland c, Valakut r, Cavern of
    // Souls and Prismatic Vista (gold: LAND_FRAME_OVERRIDES) m.
    expect(["zne-21", "zne-28", "zne-30"].map(colour)).toEqual(["c", "c", "c"]);
    expect(colour("zne-29")).toBe("r");
    expect(["zne-22", "zne-27"].map(colour)).toEqual(["m", "m"]);
    // EXP: Ancient Tomb, Strip Mine, Kor Haven c; Forbidden Orchard and Mana
    // Confluence m.
    expect(["exp-36", "exp-43", "exp-41"].map(colour)).toEqual(["c", "c", "c"]);
    expect(["exp-39", "exp-42"].map(colour)).toEqual(["m", "m"]);
  });
});
