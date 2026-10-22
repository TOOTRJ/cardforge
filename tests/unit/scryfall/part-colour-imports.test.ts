import { describe, expect, it } from "vitest";
import fixture from "./fixtures/part-colour-printings.json";
import { frameMatchFromScryfall, mapScryfallToFormPatch } from "@/lib/scryfall/import-mapper";
import { finalizeImportMatch } from "@/lib/creator/frame-resolve";
import { newCardFrameStyle } from "@/lib/cards/anatomy";
import type { ScryfallCard } from "@/lib/scryfall/client";
import { FRAME_TEMPLATE_VALUES, type FrameStyle } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 4.26 — a split or aftermath printing imports with EACH HALF IN ITS
// OWN COLOUR, as it is printed (tests/unit/scryfall/fixtures/
// part-colour-printings.json, captured from Scryfall 2026-10-21):
//   • the card's colour is its FIRST half's, read from that half's cost
//     (Scryfall gives a split card's faces no colours of their own — the
//     card's are both halves');
//   • the second half's colour is its back face's `color_identity`, read
//     from its cost (a colour, a pair, gold for three or more);
//   • the switch is the new-card default on split and aftermath (on), so
//     the saved card draws the seam;
//   • a two-colour printing on them is EXACT now (the two-colour gap was
//     4.26's on these frames).
// ---------------------------------------------------------------------------

const PRINTINGS = (fixture as { printings: Record<string, ScryfallCard> }).printings;
const card = (key: string) => {
  const found = PRINTINGS[key];
  if (!found) throw new Error(`no captured printing ${key}`);
  return found;
};
const ALL_VERIFIED = new Set(FRAME_TEMPLATE_VALUES.flatMap((t) => ["w", "u", "b", "r", "g", "m", "c"].map((k) => `${t}/${k}`)));

describe("split and aftermath printings, each half in its own colour", () => {
  it.each([
    // [printing, the card's (first half's) colour, the second half's]
    ["dmr-215", ["red"], ["blue"]], // Fire // Ice
    ["dmr-210", ["red"], ["green"]], // Assault // Battery
    ["dmr-214", ["black"], ["white"]], // Night // Day
    ["cmr-456", ["red"], ["white"]], // Wear // Tear (fuse)
    ["akh-223", ["red"], ["black"]], // Cut // Ribbons
    ["akh-216", ["blue"], ["red"]], // Reduce // Rubble
    ["akh-215", ["white"], ["black"]], // Start // Finish
    ["akh-213", ["red"], ["red"]], // Insult // Injury (one colour)
    // A gold or hybrid half: its pair — the first half's as the card's
    // colour (multicolor + its pair), the second's on the back face.
    ["c21-219", ["multicolor"], ["green", "blue"]], // Incubation {G/U} // Incongruity {1}{G}{U}
    ["clu-185", ["multicolor"], ["white", "blue"]], // Depose {1}{W/U} // Deploy {2}{W}{U}
  ] as const)("%s: the card %j, its second half %j", (key, front, back) => {
    const patch = mapScryfallToFormPatch(card(key));
    expect(patch.color_identity, key).toEqual(front);
    expect(patch.back_face?.color_identity, key).toEqual(back);
  });

  it("names the frame exact — a two-colour printing too (the gap was 4.26's on these frames)", () => {
    for (const key of Object.keys(PRINTINGS)) {
      const m = frameMatchFromScryfall(card(key));
      // (An aftermath card is Scryfall layout "split" with the Aftermath keyword.)
      expect(m.template, key).toBe((card(key).keywords ?? []).includes("Aftermath") ? "aftermath" : "split");
      // A HYBRID first half (Incubation {G/U}, Depose {1}{W/U}) prints a
      // hybrid half PipGlyph draws gold: still nearest, the hybrid gap.
      const hybridHalf = key === "c21-219" || key === "clu-185";
      expect(m.status, key).toBe(hybridHalf ? "nearest" : "exact");
      if (hybridHalf) expect(m.signature, key).toMatch(/two-colour-hybrid$/);
    }
  });

  it("saves the look switched on: the new-card default on the frames that draw it", () => {
    const patch = finalizeImportMatch(mapScryfallToFormPatch(card("dmr-215")), ALL_VERIFIED);
    expect(patch.frame_match).toMatchObject({ status: "exact", template: "split" });
    expect(newCardFrameStyle<FrameStyle>({ template: "split" }, "instant").partColor).toBe(true);
    expect(newCardFrameStyle<FrameStyle>({ template: "aftermath" }, "sorcery").partColor).toBe(true);
  });
});
