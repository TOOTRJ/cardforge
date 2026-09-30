import { describe, expect, it } from "vitest";
import type { ScryfallCard } from "@/lib/scryfall/client";
import { crownSwitchFromPrinting, mapScryfallToFormPatch, printsStandardCrown } from "@/lib/scryfall/import-mapper";
import { scryfallRemixMechanics } from "@/lib/ai/remix-mechanics";
import { importedAnatomy, twoColorDressOf } from "@/lib/cards/anatomy";
import printings from "./fixtures/anatomy-printings.json";
import signaturePrintings from "./fixtures/signature-printings.json";

// ---------------------------------------------------------------------------
// TODO 4.6.0 — "imports follow the printing" (owner rule 2026-09-29): the
// import patch carries the printing's own anatomy for the card's switches,
// and names a switch only where the printing says something about it
// (owner round 17, 2026-09-30: printing-only).
//   • printed_crown: ON for Scryfall's `legendary` frame effect (DOM 2018
//     on); OFF for a Legendary card printed without it (the M15–RIX
//     legendaries, owner 2026-09-29; kept as built, owner 2026-09-30 pick
//     (a)) and for a Legendary SHOWCASE printing (the LTR ring and scroll,
//     TDM draconic, BLB woodland, TLA avatar …), which prints no standard
//     crown (owner's choice over the design's Q6 recommendation); ABSENT for
//     a nonlegendary printing — a nonlegendary SHOWCASE too (owner
//     2026-09-30, pick (b)), so it gets the new-card default if it is made
//     Legendary later.
//   • printed_two_color: ON for a 2015-frame printing whose front face is
//     exactly two colours, else ABSENT (never false); color_pair: those two
//     colours, printed order.
// An absent switch gets the new-card default at the save (on), so a card
// made Legendary or given a pair later starts on like any new card.
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

  it("is off for an M15–RIX legendary (no effect)", () => {
    expect(patchOf("m15-3").printed_crown).toBe(false); // Avacyn, Guardian Angel
  });

  it("is not named for a nonlegendary printing — the new-card default applies (round 17: printing-only)", () => {
    expect(patchOf("stx-175").printed_crown).toBeUndefined(); // Daemogoth Woe-Eater
    expect(patchOf("mkm-264").printed_crown).toBeUndefined(); // Meticulous Archive
    expect(patchOf("tla-212").printed_crown).toBeUndefined();
    expect(patchOf("eld-244").printed_crown).toBeUndefined(); // Fabled Passage
    for (const key of ["stx-175", "mkm-264"]) {
      expect("printed_crown" in importedAnatomy(patchOf(key), "m15").style, key).toBe(false);
    }
  });

  it("is off for a LEGENDARY showcase printing, which prints no standard crown (Q6 → b)", () => {
    expect(P["ltr-302"].frame_effects).toEqual(["legendary", "showcase"]);
    expect(patchOf("ltr-302").printed_crown).toBe(false); // Boromir, LTR ring
    expect(patchOf("ltr-321").printed_crown).toBe(false); // Galadriel, LTR ring
  });

  it("names NO crown for a nonlegendary showcase — like any nonlegendary printing (owner 2026-09-30, pick (b))", () => {
    const S = signaturePrintings as unknown as Record<string, ScryfallCard>;
    // DSK #389 Overlord of the Floodpits, LTR #482 Slip On the Ring: not
    // Legendary, Scryfall's `showcase` effect. (2735012e wrote `false`.)
    for (const key of ["dsk-389", "ltr-482"]) {
      expect(S[key].type_line, key).not.toMatch(/Legendary/);
      expect(S[key].frame_effects, key).toContain("showcase");
      const patch = mapScryfallToFormPatch(S[key]);
      expect(patch.printed_crown, key).toBeUndefined();
      expect("crown" in importedAnatomy(patch, patch.frame_template).style, key).toBe(false);
    }
    // A registry showcase signature without the effect (MUL, the Japan
    // promos) on a nonlegendary card: no key either.
    const plain = P["stx-175"];
    const match = mapScryfallToFormPatch(plain).frame_match!;
    const face = { cardType: "creature", supertype: "" };
    expect(crownSwitchFromPrinting(plain, match, face)).toBeUndefined();
    expect(crownSwitchFromPrinting(plain, { ...match, signature: "showcase/mul" }, face)).toBeUndefined();
    expect(crownSwitchFromPrinting(plain, { ...match, signature: "japan-showcase" }, face)).toBeUndefined();
    expect(crownSwitchFromPrinting(plain, { ...match, signature: "showcase" }, face)).toBeUndefined();
  });

  it("a showcase's crown key follows the Legendary word: `false` when Legendary, none when not", () => {
    // The same printing and showcase signature, told apart only by the
    // supertype — Legendary still stores the crown OFF (Q6 → b, "match
    // scan"); nonlegendary names nothing. (2735012e wrote `false` for both.)
    const plain = P["stx-175"];
    const match = { ...mapScryfallToFormPatch(plain).frame_match!, signature: "showcase/mul" };
    expect(crownSwitchFromPrinting(plain, match, { cardType: "creature", supertype: "Legendary" })).toBe(false);
    expect(crownSwitchFromPrinting(plain, match, { cardType: "creature", supertype: "Legendary Snow" })).toBe(false);
    expect(crownSwitchFromPrinting(plain, match, { cardType: "creature", supertype: "" })).toBeUndefined();
    expect(crownSwitchFromPrinting(plain, match, { cardType: "creature", supertype: null })).toBeUndefined();
    expect(crownSwitchFromPrinting(plain, match, { cardType: "creature", supertype: "Snow" })).toBeUndefined();

    // Every showcase printing among the fixtures, through the mapper: a
    // Legendary one (planeswalkers too, as before) stores `false`, any
    // other stores no key.
    const S = signaturePrintings as unknown as Record<string, ScryfallCard>;
    const showcases = Object.entries({ ...S, ...P }).filter(([, card]) =>
      (card.frame_effects ?? []).includes("showcase"),
    );
    let legendary = 0;
    let nonlegendary = 0;
    for (const [key, card] of showcases) {
      const got = mapScryfallToFormPatch(card).printed_crown;
      if (/\bLegendary\b/.test(card.type_line ?? "")) {
        expect(got, key).toBe(false);
        legendary += 1;
      } else {
        expect(got, key).toBeUndefined();
        nonlegendary += 1;
      }
    }
    // Both kinds are in the fixtures (not a vacuous pass).
    expect(legendary).toBeGreaterThanOrEqual(10);
    expect(nonlegendary).toBeGreaterThanOrEqual(10);
  });

  it("is off for a showcase frame the registry knows without Scryfall's `showcase` effect", () => {
    // MUL's etched run (#66–130) prints the Multiverse Legends frames — no
    // standard crown — and carries `legendary` + `etched`, not `showcase`.
    expect(P["mul-66"].frame_effects).toEqual(["legendary", "inverted", "etched"]);
    expect(patchOf("mul-66").frame_match?.signature).toBe("showcase/mul");
    expect(patchOf("mul-66").printed_crown).toBe(false); // Anafenza, MUL #66 etched
    // The Japan showcase promos: the registry's own showcase signature.
    const legend = P["fdn-2"];
    const match = mapScryfallToFormPatch(legend).frame_match!;
    expect(printsStandardCrown(legend, match)).toBe(true);
    expect(printsStandardCrown(legend, { ...match, signature: "japan-showcase" })).toBe(false);
    expect(printsStandardCrown(legend, { ...match, signature: "showcase" })).toBe(false);
    // A gap rule on the standard frame is not a showcase.
    expect(printsStandardCrown(legend, { ...match, signature: "layout/2015+crown" })).toBe(true);
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

  it("no pair for mono, three colours or a gold land; no two-colour frame before 2015 — the switch not named (never false)", () => {
    for (const key of ["fdn-2", "m15-3", "fdn-243", "eld-244", "uma-241"]) {
      expect(patchOf(key).color_pair, key).toBeUndefined();
      expect(patchOf(key).printed_two_color, key).toBeUndefined();
    }
    // Azorius Charm RTR #145: two colours on the 2003 frame, which prints gold.
    expect(patchOf("rtr-145").color_pair).toBe("wu");
    expect(patchOf("rtr-145").printed_two_color).toBeUndefined();
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

describe("what the import stores on the frame it lands on (4.6b: m15, m15artifact and m15land draw pairs)", () => {
  it("a two-colour printing stores its PAIR and the two-colour switch on a frame with pair masters", () => {
    // Kykar FDN #122 (gold WU, crowned): the pair on m15.
    expect(importedAnatomy(patchOf("fdn-122"), "m15")).toEqual({
      style: { crown: true, twoColor: true },
      colorIdentity: ["white", "blue"],
    });
    // Cat-Owl TLA #212 (hybrid), Daemogoth Woe-Eater STX #175 (mixed cost).
    expect(importedAnatomy(patchOf("tla-212"), "m15").colorIdentity).toEqual(["white", "blue"]);
    expect(importedAnatomy(patchOf("stx-175"), "m15").colorIdentity).toEqual(["black", "green"]);
    // Riptide Gearhulk DFT #219 on the artifact frame, Meticulous Archive
    // MKM #264 on the land frame.
    expect(importedAnatomy(patchOf("dft-219"), "m15artifact")).toMatchObject({ style: { twoColor: true }, colorIdentity: ["white", "blue"] });
    expect(importedAnatomy(patchOf("mkm-264"), "m15land")).toMatchObject({ style: { twoColor: true }, colorIdentity: ["white", "blue"] });
  });

  it("mono, three colours and the gold fetch lands keep their colour and name no two-colour switch", () => {
    expect(importedAnatomy(patchOf("m15-3"), "m15")).toEqual({
      style: { crown: false },
      colorIdentity: ["white"],
    });
    expect(importedAnatomy(patchOf("fdn-243"), "m15")).toEqual({ style: { crown: true }, colorIdentity: ["multicolor"] });
    // Fabled Passage ELD #244 prints the gold land frame (landFrameColorRule).
    expect(importedAnatomy(patchOf("eld-244"), "m15land")).toEqual({ style: {}, colorIdentity: ["multicolor"] });
    // Azorius Charm RTR #145: the 2003 frame prints gold, and modern draws no pair.
    expect(importedAnatomy(patchOf("rtr-145"), "modern")).toEqual({ style: {}, colorIdentity: ["multicolor"] });
    // Landed on m15 (a frame that draws pairs), a printing that ISN'T
    // two-coloured stores no pair either: it keeps its gold "multicolor".
    expect(importedAnatomy(patchOf("rtr-145"), "m15")).toEqual({ style: {}, colorIdentity: ["multicolor"] });
  });

  it("the AI deck remix carries the printing's switches and pair onto its frame", () => {
    const remix = scryfallRemixMechanics(patchOf("fdn-122"), "Kykar", new Set(["m15/m"]));
    expect(remix.ok).toBe(true);
    if (remix.ok) {
      expect(remix.mechanics.frame_template).toBe("m15");
      expect(remix.mechanics.anatomy).toEqual({ crown: true, twoColor: true });
      expect(remix.mechanics.color_identity).toEqual(["white", "blue"]);
    }
  });
});
