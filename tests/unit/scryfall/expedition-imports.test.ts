import { describe, expect, it } from "vitest";
import printingsData from "./fixtures/expedition-printings.json";
import { scryfallCardSchema } from "@/lib/scryfall/client";
import { frameColorsFromScryfall, frameMatchFromScryfall, frontFaceColors } from "@/lib/scryfall/import-mapper";
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
        // …on the plain land master, not gold (owner 2026-10-22), until the
        // pinline pair masters exist.
        expect(r.colour, r.key).toBe("c");
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

  it("dresses a two-colour land in the plain land master only on an Expedition frame (twoColourLandOnPlainFrame)", () => {
    const strand = printings["zne-1"] as Record<string, unknown>;
    expect(frameColorsFromScryfall(card("zne-1"))).toEqual(["colorless"]);
    expect(frameColorsFromScryfall(card("exp-1"))).toEqual(["colorless"]);
    // The same land in a regular set (KTK's) or another masterpiece set keeps gold.
    for (const over of [{ set: "ktk", set_type: "expansion" }, { set: "mps", set_type: "masterpiece" }]) {
      expect(frameColorsFromScryfall(scryfallCardSchema.parse({ ...strand, ...over })), over.set).toEqual(["multicolor"]);
    }
    // One colour and any colour are untouched on the Expedition frames.
    expect(frameColorsFromScryfall(card("zne-29"))).toEqual(["red"]);
    expect(frameColorsFromScryfall(card("zne-22"))).toEqual(["multicolor"]);
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
