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
