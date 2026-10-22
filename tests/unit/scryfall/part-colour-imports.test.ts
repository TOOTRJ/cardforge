import { describe, expect, it } from "vitest";
import fixture from "./fixtures/part-colour-printings.json";
import prepareFixture from "./fixtures/prepare-printings.json";
import { frameMatchFromScryfall, mapScryfallToFormPatch } from "@/lib/scryfall/import-mapper";
import { finalizeImportMatch, remixFrameFor } from "@/lib/creator/frame-resolve";
import { importedAnatomy, newCardFrameStyle } from "@/lib/cards/anatomy";
import { scryfallRemixMechanics } from "@/lib/ai/remix-mechanics";
import type { ScryfallCard } from "@/lib/scryfall/client";
import { FRAME_TEMPLATE_VALUES, type FrameStyle } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 4.26 — a split or aftermath printing imports with EACH HALF IN ITS
// OWN COLOUR, as it is printed (tests/unit/scryfall/fixtures/
// part-colour-printings.json, captured from Scryfall 2026-10-21):
//   • the card's colour stays the WHOLE card's, as on main (owner decision
//     M2: Fire // Ice is red and blue — the gold "multicolor" — so the card
//     page, the filters and the deck stats don't move);
//   • its FIRST half's frame colour is `printed_first_part_color` (→
//     frame_style.firstPartColor), read from that half's cost, where it is
//     not the card's whole colour;
//   • the second half's colour is its back face's `color_identity`, read
//     from its cost (a colour, a pair, gold for three or more); a Room
//     names none (L1);
//   • the look is ON only where both halves' colours are verified on the
//     frame (M1) — else OFF, the card's whole colour as on main, never a
//     save refused after the art; the landing is verified in the first
//     half's colour with the look on;
//   • a two-colour printing on these frames is EXACT (the two-colour gap
//     was 4.26's there); a HYBRID half is still nearest.
// ---------------------------------------------------------------------------

const PRINTINGS = (fixture as { printings: Record<string, ScryfallCard> }).printings;
const card = (key: string) => {
  const found = PRINTINGS[key];
  if (!found) throw new Error(`no captured printing ${key}`);
  return found;
};
const PREPARE = (prepareFixture as { printings: Record<string, ScryfallCard> }).printings;
const ALL_VERIFIED = new Set(FRAME_TEMPLATE_VALUES.flatMap((t) => ["w", "u", "b", "r", "g", "m", "c"].map((k) => `${t}/${k}`)));
const without = (...keys: string[]) => new Set([...ALL_VERIFIED].filter((k) => !keys.includes(k)));

describe("split and aftermath printings, each half in its own colour", () => {
  it.each([
    // [printing, the card's whole colour (main's), its first half's frame colour, the second half's]
    ["dmr-215", ["multicolor"], ["red"], ["blue"]], // Fire // Ice
    ["dmr-210", ["multicolor"], ["red"], ["green"]], // Assault // Battery
    ["dmr-214", ["multicolor"], ["black"], ["white"]], // Night // Day
    ["cmr-456", ["multicolor"], ["red"], ["white"]], // Wear // Tear (fuse)
    ["akh-223", ["multicolor"], ["red"], ["black"]], // Cut // Ribbons
    ["akh-216", ["multicolor"], ["blue"], ["red"]], // Reduce // Rubble
    ["akh-215", ["multicolor"], ["white"], ["black"]], // Start // Finish
    // One colour: the card's IS its first half's — no key to store.
    ["akh-213", ["red"], undefined, ["red"]], // Insult // Injury
    // A gold or hybrid first half paints gold, as the whole card does.
    ["c21-219", ["multicolor"], undefined, ["green", "blue"]], // Incubation {G/U} // Incongruity {1}{G}{U}
    ["clu-185", ["multicolor"], undefined, ["white", "blue"]], // Depose {1}{W/U} // Deploy {2}{W}{U}
  ] as const)("%s: the card %j, its first half %j, its second %j", (key, whole, first, back) => {
    const patch = mapScryfallToFormPatch(card(key));
    expect(patch.color_identity, key).toEqual(whole);
    expect(patch.printed_first_part_color, key).toEqual(first);
    expect(patch.back_face?.color_identity, key).toEqual(back);
  });

  it("names the frame exact — a two-colour printing too (the gap was 4.26's on these frames); a hybrid half nearest", () => {
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

  it("saves the look ON with the first half's colour where both halves' colours are verified", () => {
    const patch = finalizeImportMatch(mapScryfallToFormPatch(card("dmr-215")), without("split/m"));
    // Verified in Fire's red (split/m — the whole card's gold — need not be).
    expect(patch.frame_match).toMatchObject({ status: "exact", template: "split" });
    expect(patch.printed_part_color).toBeUndefined();
    const { style, colorIdentity } = importedAnatomy(patch, "split");
    expect(style.firstPartColor).toEqual(["red"]);
    expect(colorIdentity).toEqual(["multicolor"]);
    expect(newCardFrameStyle<FrameStyle>({ template: "split", ...style }, "instant")).toMatchObject({ partColor: true, firstPartColor: ["red"] });
  });

  it("M1: a half's colour not verified on the frame — the look OFF, main's landing, never a refused save", () => {
    // Ice's blue unticked: the card lands as on main, in its whole colour
    // (split/m, verified here), the look off.
    const noBlue = finalizeImportMatch(mapScryfallToFormPatch(card("dmr-215")), without("split/u"));
    expect(noBlue.printed_part_color).toBe(false);
    expect(noBlue.frame_match).toMatchObject({ status: "exact", template: "split" });
    expect(importedAnatomy(noBlue, "split").style.partColor).toBe(false);
    // …and with the gold unticked too: main's nearest landing.
    const neither = finalizeImportMatch(mapScryfallToFormPatch(card("dmr-215")), without("split/u", "split/m"));
    expect(neither.printed_part_color).toBe(false);
    expect(neither.frame_match?.status).not.toBe("exact");
  });

  it("M1: the AI deck remix of the printing — the same rule", () => {
    const ok = scryfallRemixMechanics(mapScryfallToFormPatch(card("dmr-215")), "Fire // Ice", without("split/m"));
    expect(ok.ok && ok.mechanics).toMatchObject({ frame_template: "split", color_identity: ["multicolor"], anatomy: { firstPartColor: ["red"] } });
    expect(ok.ok && ok.mechanics.anatomy.partColor).toBeUndefined();
    expect(ok.ok && ok.mechanics.back_face?.color_identity).toEqual(["blue"]);
    const off = scryfallRemixMechanics(mapScryfallToFormPatch(card("dmr-215")), "Fire // Ice", without("split/u"));
    expect(off.ok && off.mechanics.frame_template).toBe("split");
    expect(off.ok && off.mechanics.anatomy.partColor).toBe(false);
    expect(remixFrameFor(mapScryfallToFormPatch(card("dmr-215")), without("split/m"))).toMatchObject({ ok: true, template: "split" });
  });

  it("M1: a Prepare printing whose spell's page colour isn't verified — the look OFF", () => {
    const fra3 = PREPARE["fra-3"]!; // a white creature, a {G/W} spell: the gold key gates the pair page
    const off = finalizeImportMatch(mapScryfallToFormPatch(fra3), without("prepare/m"));
    expect(off.kind).toBe("prepare");
    expect(off.printed_part_color).toBe(false);
    const on = finalizeImportMatch(mapScryfallToFormPatch(fra3), ALL_VERIFIED);
    expect(on.printed_part_color).toBeUndefined();
  });
});
