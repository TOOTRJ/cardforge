import { describe, expect, it } from "vitest";
import type { ScryfallCard } from "@/lib/scryfall/client";
import { mapScryfallToFormPatch } from "@/lib/scryfall/import-mapper";
import { scryfallRemixMechanics } from "@/lib/ai/remix-mechanics";
import { importedAnatomy, twoColorDressOf } from "@/lib/cards/anatomy";
import printings from "./fixtures/anatomy-printings.json";

// ---------------------------------------------------------------------------
// TODO 4.6.0 — "imports follow the printing" (owner rule 2026-09-29): the
// import patch carries the printing's own anatomy for the card's switches.
//   • printed_crown: Scryfall's `legendary` frame effect (DOM 2018 on), OFF
//     for the M15–RIX legendaries (no effect) — and OFF for a SHOWCASE
//     printing (the LTR ring and scroll, TDM draconic, BLB woodland, TLA
//     avatar …), which prints no standard crown (owner's choice over the
//     design's Q6 recommendation).
//   • printed_two_color: a 2015-frame printing whose front face is exactly
//     two colours; color_pair: those two colours, printed order.
// Fixtures: real Scryfall printings (trimmed; oracle text left out).
// ---------------------------------------------------------------------------

const P = printings as unknown as Record<string, ScryfallCard>;
const patchOf = (key: string) => mapScryfallToFormPatch(P[key]);

describe("printed_crown", () => {
  it("is on for a printing with the legendary frame effect", () => {
    expect(patchOf("fdn-2").printed_crown).toBe(true); // Arahbo, FDN #2
    expect(patchOf("fdn-122").printed_crown).toBe(true); // Kykar (gold WU)
    expect(patchOf("fdn-243").printed_crown).toBe(true); // Muldrotha (3 colours)
    expect(patchOf("neo-268").printed_crown).toBe(true); // Eiganjo (a land)
    expect(patchOf("uma-241").printed_crown).toBe(true); // Dark Depths
    expect(patchOf("mh2-186").printed_crown).toBe(true); // colour indicator
  });

  it("is off for an M15–RIX legendary (no effect) and for a non-legendary printing", () => {
    expect(patchOf("m15-3").printed_crown).toBe(false); // Avacyn, Guardian Angel
    expect(patchOf("stx-175").printed_crown).toBe(false);
    expect(patchOf("mkm-264").printed_crown).toBe(false);
  });

  it("is off for a showcase printing, which prints no standard crown", () => {
    expect(P["ltr-302"].frame_effects).toEqual(["legendary", "showcase"]);
    expect(patchOf("ltr-302").printed_crown).toBe(false); // Boromir, LTR ring
    expect(patchOf("ltr-321").printed_crown).toBe(false); // Galadriel, LTR ring
  });
});

describe("the colour pair and printed_two_color", () => {
  it("a 2015 two-colour printing: the pair in printed order, two-colour frame on", () => {
    expect(patchOf("fdn-122")).toMatchObject({ color_identity: ["multicolor"], color_pair: "wu", printed_two_color: true });
    expect(patchOf("stx-175")).toMatchObject({ color_pair: "bg", printed_two_color: true }); // mixed cost
    expect(patchOf("mkm-238")).toMatchObject({ color_pair: "gw", printed_two_color: true }); // Trostani
    expect(patchOf("tla-212")).toMatchObject({ color_pair: "wu", printed_two_color: true }); // hybrid
    expect(patchOf("dft-219")).toMatchObject({ color_pair: "wu", printed_two_color: true }); // artifact
    expect(patchOf("mkm-264")).toMatchObject({ color_pair: "wu", printed_two_color: true }); // a land, by its mana
    expect(patchOf("mh2-186")).toMatchObject({ color_pair: "br", printed_two_color: true }); // colour indicator
    expect(patchOf("ltr-321")).toMatchObject({ color_pair: "gu", printed_two_color: true });
  });

  it("no pair for mono, three colours or a gold land; no two-colour frame before 2015", () => {
    for (const key of ["fdn-2", "m15-3", "fdn-243", "eld-244", "uma-241"]) {
      expect(patchOf(key).color_pair, key).toBeUndefined();
      expect(patchOf(key).printed_two_color, key).toBe(false);
    }
    // Azorius Charm RTR #145: two colours on the 2003 frame, which prints gold.
    expect(patchOf("rtr-145")).toMatchObject({ color_pair: "wu", printed_two_color: false });
  });

  it("print's dress for each, from the cost (derived at render, never stored)", () => {
    expect(twoColorDressOf(P["fdn-122"].mana_cost, "creature")).toBe("split");
    expect(twoColorDressOf(P["stx-175"].mana_cost, "creature")).toBe("split");
    expect(twoColorDressOf(P["mkm-238"].mana_cost, "creature")).toBe("split");
    expect(twoColorDressOf(P["tla-212"].mana_cost, "creature")).toBe("hybrid");
    expect(twoColorDressOf(P["mh2-186"].mana_cost, "creature")).toBe("hybrid");
    expect(twoColorDressOf(P["mkm-264"].mana_cost, "land")).toBe("split");
  });
});

describe("what the import stores on the frame it lands on (4.6.0: no frame draws the pieces yet)", () => {
  it("the switches take the printing's values; the colour stays the patch's multicolor", () => {
    expect(importedAnatomy(patchOf("fdn-122"), "m15")).toEqual({
      style: { crown: true, twoColor: true },
      colorIdentity: ["multicolor"],
    });
    expect(importedAnatomy(patchOf("m15-3"), "m15")).toEqual({
      style: { crown: false, twoColor: false },
      colorIdentity: ["white"],
    });
  });

  it("the AI deck remix carries the printing's switches onto its frame", () => {
    const remix = scryfallRemixMechanics(patchOf("fdn-122"), "Kykar", new Set(["m15/m"]));
    expect(remix.ok).toBe(true);
    if (remix.ok) {
      expect(remix.mechanics.frame_template).toBe("m15");
      expect(remix.mechanics.anatomy).toEqual({ crown: true, twoColor: true });
      expect(remix.mechanics.color_identity).toEqual(["multicolor"]);
    }
  });
});
