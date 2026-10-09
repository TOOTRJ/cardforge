import { describe, expect, it } from "vitest";
import type { ScryfallCard } from "@/lib/scryfall/client";
import {
  TWO_COLOUR_1997_LAND_FROM,
  TWO_COLOUR_2003_GOLD_EARLY_SETS,
  TWO_COLOUR_2003_GOLD_FROM,
  frameColorsFromScryfall,
  frameMatchFromScryfall,
  mapScryfallToFormPatch,
  printsTwoColorFrame,
} from "@/lib/scryfall/import-mapper";
import { importedAnatomy } from "@/lib/cards/anatomy";
import printings from "./fixtures/old-frame-pair-printings.json";

// ---------------------------------------------------------------------------
// TODO 4.6h — "imports follow the printing" on the old frames. Measured on
// Scryfall's scans (2026-10-08):
//   • the 2003 frame's two-colour GOLD cards print their two colours from
//     Ravnica (October 2005) on — pinline and text box — and plain gold
//     before it (Iname as One, SOK #151, the frame's one earlier two-colour
//     gold card); a HYBRID card splits the frame body, which is not drawn;
//   • the 2003 frame's two-colour LANDS print them from Eighth Edition on;
//   • the 1997 frame's two-colour lands print them only where the land taps
//     for both colours and was printed from 1999 on (Sixth Edition → Torment,
//     Battle Royale, Deckmasters) or is an Onslaught fetch land; the lands
//     of 1997–98 and the ones coloured only by their abilities print the
//     plain land;
//   • the 1997 frame's two-colour gold SPELLS print one gold frame.
// Fixtures: real Scryfall printings, trimmed.
// ---------------------------------------------------------------------------

const P = printings as unknown as Record<string, ScryfallCard>;
const match = (key: string) => {
  const m = frameMatchFromScryfall(P[key]);
  return [m.status, m.template, (m.gaps ?? []).join("+")];
};
const patch = (key: string) => mapScryfallToFormPatch(P[key]);

describe("the dates", () => {
  it("are the first day each look printed", () => {
    expect(TWO_COLOUR_2003_GOLD_FROM).toBe("2005-08-01");
    expect(TWO_COLOUR_1997_LAND_FROM).toBe("1999-01-01");
    expect(P["rav-239"].released_at! >= TWO_COLOUR_2003_GOLD_FROM).toBe(true);
    expect(P["sok-151"].released_at! < TWO_COLOUR_2003_GOLD_FROM).toBe(true);
    expect(P["6ed-319"].released_at! >= TWO_COLOUR_1997_LAND_FROM).toBe(true);
    expect(P["ath-71"].released_at! < TWO_COLOUR_1997_LAND_FROM).toBe(true);
  });
});

describe("the 2003 frame", () => {
  it("a two-colour gold card from Ravnica on: exact on `modern`, its pair and the switch stored", () => {
    expect(match("rav-239")).toEqual(["exact", "modern", ""]);
    expect(printsTwoColorFrame(P["rav-239"])).toBe(true);
    expect(patch("rav-239")).toMatchObject({ color_pair: "gw", printed_two_color: true });
    expect(importedAnatomy(patch("rav-239"), "modern")).toMatchObject({ style: { twoColor: true }, colorIdentity: ["green", "white"] });
  });

  it("Iname as One (June 2005) printed plain gold: exact on the gold master, no switch named, the colour stays multicolor", () => {
    expect(match("sok-151")).toEqual(["exact", "modern", ""]);
    expect(printsTwoColorFrame(P["sok-151"])).toBe(false);
    expect(patch("sok-151").printed_two_color).toBeUndefined();
    const stored = importedAnatomy(patch("sok-151"), "modern");
    expect("twoColor" in stored.style).toBe(false);
    expect(stored.colorIdentity).toEqual(["multicolor"]);
  });

  it("Arena League 2005's Skyknight Legionnaire carries Scryfall's placeholder date and prints the split (PAL05 #8)", () => {
    expect(P["pal05-8"].released_at).toBe("2005-01-01");
    expect(P["pal05-8"].set_type).toBe("promo");
    expect(printsTwoColorFrame(P["pal05-8"])).toBe(true);
  });

  it("the date cannot tell the 2005 promos apart: Player Rewards' Psychatog (P05 #1) printed plain gold — only the named set counts", () => {
    expect(P["p05-1"].released_at).toBe(P["pal05-8"].released_at);
    expect(P["p05-1"].set_type).toBe("promo");
    expect([...TWO_COLOUR_2003_GOLD_EARLY_SETS]).toEqual(["pal05"]);
    expect(printsTwoColorFrame(P["p05-1"])).toBe(false);
    expect(patch("p05-1").printed_two_color).toBeUndefined();
    const stored = importedAnatomy(patch("p05-1"), "modern");
    expect("twoColor" in stored.style).toBe(false);
    expect(stored.colorIdentity).toEqual(["multicolor"]);
    expect(match("p05-1")).toEqual(["exact", "modern", ""]);
  });

  it("Unhinged's gold cards (November 2004) printed plain gold; a promo from 2006 on prints the split by its date (F06 #4)", () => {
    expect(printsTwoColorFrame(P["unh-118"])).toBe(false);
    expect(patch("unh-118").printed_two_color).toBeUndefined();
    expect(P["f06-4"].released_at! >= TWO_COLOUR_2003_GOLD_FROM).toBe(true);
    expect(printsTwoColorFrame(P["f06-4"])).toBe(true);
    expect(patch("f06-4")).toMatchObject({ color_pair: "ub", printed_two_color: true });
  });

  it("a hybrid card stays a gap: its print splits the frame body, and no switch is named", () => {
    expect(match("rav-242")).toEqual(["nearest", "modern", "two-colour-hybrid"]);
    expect(printsTwoColorFrame(P["rav-242"])).toBe(false);
    expect(patch("rav-242").printed_two_color).toBeUndefined();
  });

  it("a two-colour land, from Eighth Edition on: its pair on `modernland` (a white-bordered one keeps its border gap)", () => {
    expect(match("rav-284")).toEqual(["exact", "modernland", ""]);
    expect(patch("rav-284")).toMatchObject({ color_pair: "gw", printed_two_color: true });
    expect(importedAnatomy(patch("rav-284"), "modernland")).toMatchObject({ style: { twoColor: true }, colorIdentity: ["green", "white"] });
    expect(match("8ed-323")).toEqual(["nearest", "modernland", "border"]);
    expect(patch("8ed-323")).toMatchObject({ color_pair: "wu", printed_two_color: true });
  });

  it("a land coloured only by its abilities prints the plain land, as before (GPT #163)", () => {
    expect(frameColorsFromScryfall(P["gpt-163"])).toEqual(["colorless"]);
    expect(match("gpt-163")).toEqual(["exact", "modernland", ""]);
    expect(patch("gpt-163").printed_two_color).toBeUndefined();
  });
});

describe("the 1997 frame's lands", () => {
  it.each(["inv-321", "tor-140"])("%s taps for both colours, printed from 1999 on: exact on `retroland`, its pair and the switch stored", (key) => {
    expect(match(key)).toEqual(["exact", "retroland", ""]);
    expect(printsTwoColorFrame(P[key])).toBe(true);
    expect(patch(key).printed_two_color).toBe(true);
    expect(importedAnatomy(patch(key), "retroland").style.twoColor).toBe(true);
    expect(importedAnatomy(patch(key), "retroland").colorIdentity).toHaveLength(2);
  });

  it("the white-bordered ones keep their border gap and still store the pair (6ED #319, BRB #13)", () => {
    for (const key of ["6ed-319", "brb-13"]) {
      expect(match(key), key).toEqual(["nearest", "retroland", "border"]);
      expect(patch(key).printed_two_color, key).toBe(true);
    }
    expect(patch("6ed-319").color_pair).toBe("wu");
    expect(patch("brb-13").color_pair).toBe("br");
  });

  it.each(["tmp-316", "5ed-410", "ath-71"])("%s (1997–98) prints the plain land's orange box: colourless, no pair, no switch", (key) => {
    expect(frameColorsFromScryfall(P[key])).toEqual(["colorless"]);
    expect(patch(key).color_pair).toBeUndefined();
    expect(patch(key).printed_two_color).toBeUndefined();
    expect(match(key).slice(1, 2)).toEqual(["retroland"]);
    expect(match(key)[2]).not.toContain("two-colour");
  });

  it.each(["jud-142", "ons-323"])("%s is coloured only by its abilities: the plain land, at any date", (key) => {
    expect(P[key].released_at! >= TWO_COLOUR_1997_LAND_FROM).toBe(true);
    expect(frameColorsFromScryfall(P[key])).toEqual(["colorless"]);
    expect(match(key)).toEqual(["exact", "retroland", ""]);
    expect(patch(key).printed_two_color).toBeUndefined();
  });

  it("Riftstone Portal (JUD #143) taps for {C} alone — Scryfall lists the {G} and {W} it grants other lands — and prints the plain land", () => {
    expect(P["jud-143"].produced_mana).toEqual(expect.arrayContaining(["G", "W"]));
    expect(P["jud-143"].released_at! >= TWO_COLOUR_1997_LAND_FROM).toBe(true);
    expect(frameColorsFromScryfall(P["jud-143"])).toEqual(["colorless"]);
    expect(patch("jud-143").color_pair).toBeUndefined();
    expect(patch("jud-143").printed_two_color).toBeUndefined();
    expect(match("jud-143").slice(1, 2)).toEqual(["retroland"]);
    expect(match("jud-143")[2]).not.toContain("two-colour");
  });

  it("Krosan Verge (JUD #141) fetches a Forest AND a Plains, not one of two: the plain land, as printed", () => {
    expect(frameColorsFromScryfall(P["jud-141"])).toEqual(["colorless"]);
    expect(patch("jud-141").printed_two_color).toBeUndefined();
    expect(match("jud-141")).toEqual(["exact", "retroland", ""]);
  });

  it("an Onslaught fetch land prints the two land types it fetches (ONS #316)", () => {
    expect(P["ons-316"].color_identity).toEqual([]);
    expect(patch("ons-316")).toMatchObject({ color_pair: "wu", printed_two_color: true });
    expect(match("ons-316")).toEqual(["exact", "retroland", ""]);
  });

  it("a three-colour land is no pair: the gold stand-in, as before (PLS #136)", () => {
    expect(frameColorsFromScryfall(P["pls-136"])).toEqual(["multicolor"]);
    expect(patch("pls-136").color_pair).toBeUndefined();
    expect(patch("pls-136").printed_two_color).toBeUndefined();
  });
});

describe("the 1997 frame's gold spells", () => {
  it.each(["inv-264", "apc-126"])("%s prints one gold frame: exact on `retro`'s gold master, no switch, no pair stored", (key) => {
    expect(match(key)).toEqual(["exact", "retro", ""]);
    expect(printsTwoColorFrame(P[key])).toBe(false);
    expect(patch(key).printed_two_color).toBeUndefined();
    const stored = importedAnatomy(patch(key), "retro");
    expect("twoColor" in stored.style).toBe(false);
    expect(stored.colorIdentity).toEqual(["multicolor"]);
  });
});
