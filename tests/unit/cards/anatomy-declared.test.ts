import { describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// TODO 4.6.0 — the plumbing with the anatomy 4.6a / 4.6b will declare
// (tests/unit/cards/anatomy-fixture.ts: the crown band on m15, m15artifact
// and m15land; pair masters on the same three). What a new card, a save, an
// edit and an import store once a template draws a piece — the owner rule
// (2026-09-29): new cards on, stored cards untouched (absent = off), imports
// follow the printing, a save keeps only the switches its template draws.
// ---------------------------------------------------------------------------

vi.mock("@/lib/cards/template-layout", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/cards/template-layout")>();
  const { declaredGetFrameProfile } = await import("./anatomy-fixture");
  return { ...real, getFrameProfile: declaredGetFrameProfile(real.getFrameProfile) };
});

import {
  NEW_CARD_ANATOMY,
  anatomyDefaults,
  applyFrameAnatomyPatch,
  frameAnatomyOf,
  importedAnatomy,
  newCardFrameStyle,
  normalizeAnatomy,
} from "@/lib/cards/anatomy";
import { frameColorKeysFor, frameMasterKey } from "@/components/cards/frame-layer";
import { getFrameProfile } from "@/lib/cards/template-layout";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";

describe("where the pieces are declared", () => {
  it("only the m15, m15artifact, m15land and borderless entries draw them — never a profile that spreads them", () => {
    // 4.6f (wave 2a): the two borderless frames draw the crown from crowned
    // twin masters and the pairs from pinline-split masters; extendedart the
    // crown alone, as an overlay band (wave 2b); the snow pair the standard
    // band and the split pairs (wave 2c). (The snow pair and devoid carry
    // the collector line's slot since 4.9b; the borderless land and
    // extendedart have none; devoid draws neither crown nor pair — owner
    // round 20: its two-colour printings are the gold frame.) The
    // borderless LAND draws its split pairs since 4.56 and still no crown
    // (its masters have no crowned twin): it is not in the list below.
    // 5.1d: the double-faced bodies draw the crown cut round their well or
    // housing (a printed legendary face exists on each) — every transform
    // body but the ▼ land back, and the modal spell pair; the modal land
    // pair and the ▼ land back draw none (no print).
    const DRAWN = [
      "m15", "m15land", "m15snowland", "m15artifact", "m15borderless", "m15borderlessartifact", "m15snow", "extendedart",
      "m15dfcfront", "m15dfcback", "m15dfcbackleft", "m15dfclandfront", "m15mdfcfront", "m15mdfcback",
    ];
    expect(FRAME_TEMPLATE_VALUES.filter((t) => frameAnatomyOf(t).crown)).toEqual(FRAME_TEMPLATE_VALUES.filter((t) => DRAWN.includes(t)));
    // (…and the holofoil stamp's notch, 4.9c, on the seven wave-1 entries —
    // the snow pair included; never extendedart or the borderless land. The
    // transform icon family, 5.0a, on no entry yet.)
    expect(frameAnatomyOf("extendedart")).toEqual({ crown: true, twoColor: [], collector: false, stamp: false, dfcIcon: false, rulesAlign: true });
    expect(anatomyDefaults("extendedart")).toEqual({ crown: true });
    // The borderless land (TODO 4.56): the split pair alone — no crown, no
    // collector slot, no stamp notch — so a new card on it stores that one
    // switch and nothing else.
    expect(frameAnatomyOf("m15borderlessland")).toEqual({ crown: false, twoColor: ["split"], collector: false, stamp: false, dfcIcon: false });
    expect(anatomyDefaults("m15borderlessland")).toEqual({ twoColor: true });
    expect(getFrameProfile("m15borderlessland").overlays).toBeUndefined();
    expect(getFrameProfile("m15borderlessland").crownMasters).toBeUndefined();
    expect(frameAnatomyOf("m15snow")).toEqual({ crown: true, twoColor: ["split"], collector: true, stamp: true, dfcIcon: false });
    expect(frameAnatomyOf("m15snowland")).toEqual({ crown: true, twoColor: ["split"], collector: true, stamp: true, dfcIcon: false });
    expect(frameAnatomyOf("m15devoid")).toEqual({ crown: false, twoColor: [], collector: true, stamp: true, dfcIcon: false });
    // A legacy template draws the m15 frame, so it has m15's anatomy.
    expect(frameAnatomyOf("regular")).toEqual(frameAnatomyOf("m15"));
  });
});

describe("a new card (createCardAction, the creator's initial state)", () => {
  it("defaults every piece its template draws to on, whatever the card's type or colours", () => {
    // …and the collector line in today's printed style where the template
    // has its slot (TODO 4.9b; the walker has one, not the crown).
    // …and the stamp on "auto" where the template has the notch (4.9c).
    expect(anatomyDefaults("m15")).toEqual({ crown: true, twoColor: true, collector: "2023", stamp: "auto" });
    expect(anatomyDefaults("m15land")).toEqual({ crown: true, twoColor: true, collector: "2023", stamp: "auto" });
    expect(anatomyDefaults("m15pw")).toEqual({ collector: "2023", stamp: "auto" });
    expect(anatomyDefaults("m15token")).toEqual({ collector: "2023" });
    expect(newCardFrameStyle({ template: "m15" }, "creature")).toEqual({ template: "m15", crown: true, twoColor: true, collector: "2023", stamp: "auto" });
    // The AI jobs send no frame_style at all: the default template's pieces.
    expect(newCardFrameStyle({}, "creature")).toEqual({ crown: true, twoColor: true, collector: "2023", stamp: "auto" });
  });

  it("keeps an explicit off (an import of a crownless printing, the creator's switch)", () => {
    expect(newCardFrameStyle({ template: "m15", crown: false }, "creature")).toEqual({ template: "m15", crown: false, twoColor: true, collector: "2023", stamp: "auto" });
    expect(newCardFrameStyle({ template: "m15", crown: false, twoColor: false }, "creature")).toEqual({
      template: "m15",
      crown: false,
      twoColor: false,
      collector: "2023",
      stamp: "auto",
    });
    // The collector line's explicit off and an import's printed style stay too.
    expect(newCardFrameStyle({ template: "m15", collector: "off" }, "creature")).toEqual({ template: "m15", crown: true, twoColor: true, collector: "off", stamp: "auto" });
    expect(newCardFrameStyle({ template: "m15", collector: "2015", star: true }, "creature")).toEqual({
      template: "m15",
      crown: true,
      twoColor: true,
      collector: "2015",
      star: true,
      stamp: "auto",
    });
    // …and the stamp's "none" (the owner's Never, an unstamped printing).
    expect(newCardFrameStyle({ template: "m15", stamp: "none" }, "creature")).toEqual({ template: "m15", crown: true, twoColor: true, collector: "2023", stamp: "none" });
  });

  it("the creator's all-on switches store only what the template draws", () => {
    // m15devoid draws no crown or pair but has the collector slot (4.9b)
    // and the stamp's notch (4.9c).
    expect(newCardFrameStyle({ template: "m15devoid", finish: "regular", ...NEW_CARD_ANATOMY }, "creature")).toEqual({
      template: "m15devoid",
      finish: "regular",
      collector: "2023",
      stamp: "auto",
    });
    // m15snow draws both since 4.6f wave 2c, and the line.
    expect(newCardFrameStyle({ template: "m15snow", finish: "regular", ...NEW_CARD_ANATOMY }, "creature")).toEqual({
      template: "m15snow",
      finish: "regular",
      crown: true,
      twoColor: true,
      collector: "2023",
      stamp: "auto",
    });
    // A frame with no collector slot drops the line's keys too (m15borderless
    // keeps the crown and pair switches it draws since 4.6f wave 2a).
    expect(newCardFrameStyle({ template: "m15borderless", finish: "regular", ...NEW_CARD_ANATOMY, star: true }, "creature")).toEqual({
      template: "m15borderless",
      finish: "regular",
      crown: true,
      twoColor: true,
    });
    expect(newCardFrameStyle({ template: "m15artifact", ...NEW_CARD_ANATOMY }, "creature")).toEqual({
      template: "m15artifact",
      crown: true,
      twoColor: true,
      collector: "2023",
      stamp: "auto",
    });
    // The borderless land (4.56) keeps the two-colour switch alone — a NEW
    // two-colour land on it draws the pair by default — and an explicit off
    // stays off.
    expect(newCardFrameStyle({ template: "m15borderlessland", finish: "regular", ...NEW_CARD_ANATOMY }, "land")).toEqual({
      template: "m15borderlessland",
      finish: "regular",
      twoColor: true,
    });
    expect(newCardFrameStyle({ template: "m15borderlessland" }, "land")).toEqual({ template: "m15borderlessland", twoColor: true });
    expect(newCardFrameStyle({ template: "m15borderlessland", twoColor: false }, "land")).toEqual({ template: "m15borderlessland", twoColor: false });
    // A token frame has the collector slot but no notch: the stamp's key
    // is dropped (4.9c — tokens print no stamp).
    expect(newCardFrameStyle({ template: "m15token", finish: "regular", ...NEW_CARD_ANATOMY }, "token")).toEqual({
      template: "m15token",
      finish: "regular",
      collector: "2023",
    });
  });
});

describe("every save (normalizeAnatomy)", () => {
  it("drops a switch the template can't draw, so a template that gains the piece later never changes the card", () => {
    expect(normalizeAnatomy({ template: "m15devoid", crown: true, twoColor: false }, "m15devoid", "creature")).toEqual({ template: "m15devoid" });
    expect(normalizeAnatomy({ template: "m15", crown: true, twoColor: false }, "m15", "creature")).toEqual({
      template: "m15",
      crown: true,
      twoColor: false,
    });
    expect(normalizeAnatomy({ template: "m15pw", crown: true }, "m15pw", "creature")).toEqual({ template: "m15pw" });
  });
});

describe("the two-colour master (frameMasterKey — both renderers)", () => {
  const m15 = getFrameProfile("m15");
  const creature = { cardType: "creature", supertype: null, cost: "{1}{W}{U}" };

  it("paints the pair master only with the switch on and a stored pair", () => {
    expect(frameMasterKey(m15, ["white", "blue"], creature, { twoColor: true })).toBe("wu");
    expect(frameMasterKey(m15, ["blue", "white", "multicolor"], creature, { twoColor: true })).toBe("wu");
    expect(frameMasterKey(m15, ["green", "white"], { ...creature, cost: "{G/W}{G/W}" }, { twoColor: true })).toBe("gw-h");
    expect(frameMasterKey(m15, ["white", "blue"], creature, {})).toBe("m");
    expect(frameMasterKey(m15, ["white", "blue"], creature)).toBe("m");
    expect(frameMasterKey(m15, ["white", "blue"], creature, { twoColor: false })).toBe("m");
    expect(frameMasterKey(m15, ["multicolor"], creature, { twoColor: true })).toBe("m");
    expect(frameMasterKey(m15, ["black"], { ...creature, cost: "{3}{U}{B}" }, { twoColor: true })).toBe("b");
    expect(frameColorKeysFor(m15, ["white", "blue"], creature, { twoColor: true })).toEqual(["wu"]);
  });

  it("an artifact with a hybrid cost wears the artifact frame's gold-split (no hybrid artifact plate yet)", () => {
    const artifact = getFrameProfile("m15artifact");
    expect(frameMasterKey(artifact, ["green", "white"], { cardType: "artifact", cost: "{G/W}{G/W}" }, { twoColor: true })).toBe("gw");
  });

  it("a template without pair masters stays gold", () => {
    expect(frameMasterKey(getFrameProfile("m15devoid"), ["white", "blue"], creature, { twoColor: true })).toBe("m");
  });

  it("the borderless land paints its split pair (TODO 4.56) — only with the switch on and a stored pair; a stored gold land keeps its master", () => {
    const land = getFrameProfile("m15borderlessland");
    const face = { cardType: "land", supertype: null, cost: null };
    expect(frameMasterKey(land, ["white", "blue"], face, { twoColor: true })).toBe("wu");
    // Any stored order, the AI's "multicolor" token ignored: printed order.
    expect(frameMasterKey(land, ["green", "red", "multicolor"], face, { twoColor: true })).toBe("rg");
    expect(frameColorKeysFor(land, ["black", "white"], face, { twoColor: true })).toEqual(["wb"]);
    // The stored look: no key, an explicit off, a plain "multicolor" land
    // (three colours or more), a mono land — the master each always drew.
    expect(frameMasterKey(land, ["white", "blue"], face)).toBe("m");
    expect(frameMasterKey(land, ["white", "blue"], face, {})).toBe("m");
    expect(frameMasterKey(land, ["white", "blue"], face, { twoColor: false })).toBe("m");
    expect(frameMasterKey(land, ["multicolor"], face, { twoColor: true })).toBe("m");
    expect(frameMasterKey(land, ["white", "blue", "black"], face, { twoColor: true })).toBe("m");
    expect(frameMasterKey(land, ["green"], face, { twoColor: true })).toBe("g");
    // A land's dress is always the split (no hybrid land), and the crown
    // switch never changes the master here (no crowned twin).
    expect(frameMasterKey(land, ["white", "blue"], { ...face, cost: "{W/U}" }, { twoColor: true })).toBe("wu");
    expect(frameMasterKey(land, ["white", "blue"], { ...face, supertype: "Legendary" }, { twoColor: true, crown: true })).toBe("wu");
  });

  it("the snow frames paint their split pair (4.6f, wave 2c); a hybrid cost falls back to it", () => {
    expect(frameMasterKey(getFrameProfile("m15snow"), ["white", "blue"], creature, { twoColor: true })).toBe("wu");
    expect(frameMasterKey(getFrameProfile("m15snow"), ["green", "white"], { cardType: "creature", cost: "{G/W}{G/W}" }, { twoColor: true })).toBe("gw");
    expect(frameMasterKey(getFrameProfile("m15snowland"), ["white", "blue"], { cardType: "land", cost: null }, { twoColor: true })).toBe("wu");
    expect(frameMasterKey(getFrameProfile("m15snow"), ["white", "blue"], { cardType: "land", cost: null }, { twoColor: true })).toBe("m");
  });
});

describe("an edit's switch flip (applyFrameAnatomyPatch)", () => {
  it("merges the switch over the stored frame_style and keeps every other key exactly as stored", () => {
    expect(
      applyFrameAnatomyPatch({ frameStyle: { template: "m15", finish: "foil" }, colorIdentity: ["red"], cardType: "creature" }, { crown: true }),
    ).toEqual({ ok: true, frameStyle: { template: "m15", finish: "foil", crown: true }, colorIdentity: null });
    // A legacy template is never rewritten (it reads as m15).
    expect(applyFrameAnatomyPatch({ frameStyle: { template: "regular" }, colorIdentity: ["red"], cardType: "creature" }, { crown: false })).toEqual({
      ok: true,
      frameStyle: { template: "regular", crown: false },
      colorIdentity: null,
    });
  });

  it("gives a stored multicolour card the pair its owner confirmed", () => {
    expect(
      applyFrameAnatomyPatch(
        { frameStyle: { template: "m15" }, colorIdentity: ["multicolor"], cardType: "creature" },
        { twoColor: true, pair: ["blue", "white"] },
      ),
    ).toEqual({ ok: true, frameStyle: { template: "m15", twoColor: true }, colorIdentity: ["white", "blue"] });
    // An AI identity that already names the pair: nothing to re-colour.
    expect(
      applyFrameAnatomyPatch(
        { frameStyle: { template: "m15" }, colorIdentity: ["blue", "white", "multicolor"], cardType: "creature" },
        { twoColor: true, pair: ["white", "blue"] },
      ),
    ).toEqual({ ok: true, frameStyle: { template: "m15", twoColor: true }, colorIdentity: null });
  });

  it("never re-colours a stored card: a mono, three-colour or other-pair card is refused", () => {
    for (const colorIdentity of [["black"], ["white", "blue", "black"], ["white", "black"], ["colorless"]] as const) {
      const applied = applyFrameAnatomyPatch(
        { frameStyle: { template: "m15" }, colorIdentity: [...colorIdentity], cardType: "creature" },
        { twoColor: true, pair: ["white", "blue"] },
      );
      expect(applied.ok, colorIdentity.join()).toBe(false);
    }
  });

  it("ignores a pair on a frame that can't draw the two-colour frame", () => {
    expect(
      applyFrameAnatomyPatch(
        { frameStyle: { template: "m15devoid" }, colorIdentity: ["multicolor"], cardType: "creature" },
        { twoColor: true, pair: ["white", "blue"] },
      ),
    ).toEqual({ ok: true, frameStyle: { template: "m15devoid" }, colorIdentity: null });
  });
});

describe("an import (importedAnatomy)", () => {
  const facts = {
    color_identity: ["multicolor"] as const,
    color_pair: "wu" as const,
    printed_crown: true,
    printed_two_color: true as const,
  };

  it("stores the printing's pair where the landed frame draws the two-colour frame, else its multicolor", () => {
    expect(importedAnatomy(facts, "m15")).toEqual({
      style: { crown: true, twoColor: true },
      colorIdentity: ["white", "blue"],
    });
    expect(importedAnatomy(facts, "m15snow").colorIdentity).toEqual(["white", "blue"]);
    // The borderless land draws pairs since 4.56: an import landed on it
    // (the chooser's Borderless Land) keeps the printing's pair.
    expect(importedAnatomy(facts, "m15borderlessland").colorIdentity).toEqual(["white", "blue"]);
    expect(importedAnatomy(facts, "m15devoid").colorIdentity).toEqual(["multicolor"]);
    expect(importedAnatomy(facts, "tarkirdragon").colorIdentity).toEqual(["multicolor"]);
  });

  it("a crownless printing imports with the crown off, so the new-card default never crowns it", () => {
    const crownless = importedAnatomy({ ...facts, printed_crown: false }, "m15");
    // (The stamp a printing names nothing for takes the new-card "auto";
    // the mapper always names one — lib/scryfall/import-mapper.ts
    // stampOfPrinting — so a real import stores the printing's.)
    expect(newCardFrameStyle({ template: "m15", ...crownless.style }, "creature")).toEqual({
      template: "m15",
      crown: false,
      twoColor: true,
      collector: "2023",
      stamp: "auto",
    });
    const unstamped = importedAnatomy({ ...facts, printed_stamp: "none" }, "m15");
    expect(newCardFrameStyle({ template: "m15", ...unstamped.style }, "creature")).toMatchObject({ stamp: "none" });
    const oval = importedAnatomy({ ...facts, printed_stamp: "oval" }, "m15token");
    expect(newCardFrameStyle({ template: "m15token", ...oval.style }, "token")).not.toHaveProperty("stamp");
  });
});
