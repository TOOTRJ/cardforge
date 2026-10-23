import { describe, expect, it } from "vitest";
import fixture from "./fixtures/adventure-part-colour-printings.json";
import { frameMatchFromScryfall, mapScryfallToFormPatch } from "@/lib/scryfall/import-mapper";
import { finalizeImportMatch, remixFrameFor } from "@/lib/creator/frame-resolve";
import { importedAnatomy, newCardFrameStyle } from "@/lib/cards/anatomy";
import { scryfallRemixMechanics } from "@/lib/ai/remix-mechanics";
import type { ScryfallCard } from "@/lib/scryfall/client";
import { FRAME_TEMPLATE_VALUES, type FrameStyle } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 4.26 — an ADVENTURE printing imports with its spell's page in the
// spell's own colour, as it is printed (tests/unit/scryfall/fixtures/
// adventure-part-colour-printings.json, captured from Scryfall 2026-10-22):
//   • the card's colour is the CREATURE's (Scryfall's card `colors`), as on
//     main — no first part's colour (the creature IS the card's master);
//   • the spell's colour is its back face's `color_identity`, from its cost;
//   • the look is ON (the new-card default) where the spell's colour is
//     verified on the adventure frame (M1) — else OFF, main's look, never a
//     save refused after the art;
//   • the landings are main's: WOE #221 (a red page beside a black frame)
//     exact; the crowned, two-colour and Omen printings keep their gaps.
// ---------------------------------------------------------------------------

const PRINTINGS = (fixture as { printings: Record<string, ScryfallCard> }).printings;
const card = (key: string) => {
  const found = PRINTINGS[key];
  if (!found) throw new Error(`no captured printing ${key}`);
  return found;
};
const ALL_VERIFIED = new Set(FRAME_TEMPLATE_VALUES.flatMap((t) => ["w", "u", "b", "r", "g", "m", "c"].map((k) => `${t}/${k}`)));
const without = (...keys: string[]) => new Set([...ALL_VERIFIED].filter((k) => !keys.includes(k)));

describe("adventure printings, the spell's page in its own colour", () => {
  it.each([
    // [printing, the creature's (the card's) colour, the spell's]
    ["woe-221", ["black"], ["red"]], // Callous Sell-Sword // Burn Together
    ["woe-224", ["black"], ["white"]], // Devouring Sugarmaw // Have for Dinner
    ["woe-229", ["red"], ["white"]], // Imodane's Recruiter // Train Troops
    ["woe-233", ["white"], ["green"]], // Pollen-Shield Hare // Hare Raising
    ["woe-239", ["blue"], ["white"]], // Threadbind Clique // Rip the Seams
    ["woe-223", ["red"], ["black"]], // Decadent Dragon // Expensive Taste
    ["lci-231", ["white"], ["green"]], // Kellan, Daring Traveler // Journey On
    ["hob-170", ["colorless"], ["white"]], // The Arkenstone // Seek the Heart
    // One colour: the spell's is the creature's (no page drawn).
    ["eld-115", ["red"], ["red"]], // Bonecrusher Giant // Stomp
    // Gold creature, gold spell; two-colour spells beside the same pair.
    ["woe-220", ["multicolor"], ["multicolor"]], // Beluna Grandsquall // Seek Thrills
    ["mkm-212", ["multicolor"], ["green", "blue"]], // Kellan, Inquisitive Prodigy
    ["eld-212", ["multicolor"], ["green", "white"]], // Oakhame Ranger // Bring Back
    ["mh3-196", ["multicolor"], ["white", "black"]], // Ondu Knotmaster // Throw a Line
  ] as const)("%s: the creature %j, the spell %j", (key, whole, back) => {
    const patch = mapScryfallToFormPatch(card(key));
    expect(patch.color_identity, key).toEqual(whole);
    expect(patch.printed_first_part_color, key).toBeUndefined();
    expect(patch.back_face?.color_identity, key).toEqual(back);
  });

  it("lands where main landed: a page of another colour is exact, the other gaps stay", () => {
    const want: Record<string, [string, string]> = {
      "woe-221": ["exact", "layout/2015"],
      "woe-224": ["exact", "layout/2015"],
      "woe-229": ["exact", "layout/2015"],
      "woe-233": ["exact", "layout/2015"],
      "woe-239": ["exact", "layout/2015"],
      "woe-223": ["exact", "layout/2015"],
      "eld-115": ["exact", "layout/2015"],
      "woe-220": ["nearest", "layout/2015+crown"],
      "mkm-212": ["nearest", "layout/2015+crown"],
      "eld-212": ["nearest", "layout/2015+two-colour-hybrid"],
      "mh3-196": ["nearest", "layout/2015+two-colour"],
      "hob-170": ["nearest", "layout/2015+crown"],
      "lci-231": ["nearest", "layout/2015+crown"],
      "tdm-178": ["nearest", "layout/2015+omen"],
    };
    for (const [key, [status, signature]] of Object.entries(want)) {
      const m = frameMatchFromScryfall(card(key));
      expect([m.status, m.template, m.signature], key).toEqual([status, "adventure", signature]);
    }
  });

  it("saves the look ON where the spell's colour is verified (the new-card default)", () => {
    const patch = finalizeImportMatch(mapScryfallToFormPatch(card("woe-221")), ALL_VERIFIED);
    expect(patch.frame_match).toMatchObject({ status: "exact", template: "adventure" });
    expect(patch.printed_part_color).toBeUndefined();
    const { style, colorIdentity } = importedAnatomy(patch, "adventure");
    expect(colorIdentity).toEqual(["black"]);
    expect(style.firstPartColor).toBeUndefined();
    expect(newCardFrameStyle<FrameStyle>({ template: "adventure", ...style }, "creature")).toMatchObject({ partColor: true });
  });

  it("M1: the spell's colour not verified on the frame — the look OFF, main's landing", () => {
    const off = finalizeImportMatch(mapScryfallToFormPatch(card("woe-221")), without("adventure/r"));
    expect(off.printed_part_color).toBe(false);
    expect(off.frame_match).toMatchObject({ status: "exact", template: "adventure" });
    expect(importedAnatomy(off, "adventure").style.partColor).toBe(false);
    expect(newCardFrameStyle<FrameStyle>({ template: "adventure", ...importedAnatomy(off, "adventure").style }, "creature").partColor).toBe(false);
    // The creature's colour unticked: main's landing (no exact), the look off.
    const neither = finalizeImportMatch(mapScryfallToFormPatch(card("woe-221")), without("adventure/b"));
    expect(neither.frame_match?.status).not.toBe("exact");
    // A one-colour adventure is never gated on anything but its own colour.
    expect(finalizeImportMatch(mapScryfallToFormPatch(card("eld-115")), without("adventure/b")).printed_part_color).toBeUndefined();
  });

  it("a colourless creature with a coloured spell (HOB #170): the look ON, the white page over adventure/c", () => {
    const patch = finalizeImportMatch(mapScryfallToFormPatch(card("hob-170")), ALL_VERIFIED);
    expect(patch.color_identity).toEqual(["colorless"]);
    expect(patch.back_face?.color_identity).toEqual(["white"]);
    expect(patch.printed_part_color).toBeUndefined();
    expect(patch.frame_match).toMatchObject({ template: "adventure" });
    // The spell's white not verified: the look OFF.
    expect(finalizeImportMatch(mapScryfallToFormPatch(card("hob-170")), without("adventure/w")).printed_part_color).toBe(false);
  });

  it("M1: the AI deck remix of the printing — the same rule", () => {
    const on = scryfallRemixMechanics(mapScryfallToFormPatch(card("woe-221")), "Callous Sell-Sword // Burn Together", ALL_VERIFIED);
    expect(on.ok && on.mechanics).toMatchObject({ frame_template: "adventure", color_identity: ["black"] });
    expect(on.ok && on.mechanics.anatomy.partColor).toBeUndefined();
    expect(on.ok && on.mechanics.back_face?.color_identity).toEqual(["red"]);
    const off = scryfallRemixMechanics(mapScryfallToFormPatch(card("woe-221")), "Callous Sell-Sword // Burn Together", without("adventure/r"));
    expect(off.ok && off.mechanics.frame_template).toBe("adventure");
    expect(off.ok && off.mechanics.anatomy.partColor).toBe(false);
    expect(remixFrameFor(mapScryfallToFormPatch(card("woe-221")), without("adventure/r"))).toMatchObject({ ok: true, template: "adventure" });
  });
});
