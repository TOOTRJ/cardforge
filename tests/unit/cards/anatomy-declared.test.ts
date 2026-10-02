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
  it("only the m15, m15artifact and m15land entries draw them — never a profile that spreads them", () => {
    expect(FRAME_TEMPLATE_VALUES.filter((t) => frameAnatomyOf(t).crown)).toEqual(["m15", "m15land", "m15artifact"]);
    // (Both carry the collector line's slot since 4.9b.)
    expect(frameAnatomyOf("m15snow")).toEqual({ crown: false, twoColor: [], collector: true });
    expect(frameAnatomyOf("m15snowland")).toEqual({ crown: false, twoColor: [], collector: true });
    // A legacy template draws the m15 frame, so it has m15's anatomy.
    expect(frameAnatomyOf("regular")).toEqual(frameAnatomyOf("m15"));
  });
});

describe("a new card (createCardAction, the creator's initial state)", () => {
  it("defaults every piece its template draws to on, whatever the card's type or colours", () => {
    // …and the collector line in today's printed style where the template
    // has its slot (TODO 4.9b; the walker has one, not the crown).
    expect(anatomyDefaults("m15")).toEqual({ crown: true, twoColor: true, collector: "2023" });
    expect(anatomyDefaults("m15land")).toEqual({ crown: true, twoColor: true, collector: "2023" });
    expect(anatomyDefaults("m15pw")).toEqual({ collector: "2023" });
    expect(newCardFrameStyle({ template: "m15" }, "creature")).toEqual({ template: "m15", crown: true, twoColor: true, collector: "2023" });
    // The AI jobs send no frame_style at all: the default template's pieces.
    expect(newCardFrameStyle({}, "creature")).toEqual({ crown: true, twoColor: true, collector: "2023" });
  });

  it("keeps an explicit off (an import of a crownless printing, the creator's switch)", () => {
    expect(newCardFrameStyle({ template: "m15", crown: false }, "creature")).toEqual({ template: "m15", crown: false, twoColor: true, collector: "2023" });
    expect(newCardFrameStyle({ template: "m15", crown: false, twoColor: false }, "creature")).toEqual({
      template: "m15",
      crown: false,
      twoColor: false,
      collector: "2023",
    });
    // The collector line's explicit off and an import's printed style stay too.
    expect(newCardFrameStyle({ template: "m15", collector: "off" }, "creature")).toEqual({ template: "m15", crown: true, twoColor: true, collector: "off" });
    expect(newCardFrameStyle({ template: "m15", collector: "2015", star: true }, "creature")).toEqual({
      template: "m15",
      crown: true,
      twoColor: true,
      collector: "2015",
      star: true,
    });
  });

  it("the creator's all-on switches store only what the template draws", () => {
    // m15snow draws no crown or pair but has the collector slot (4.9b).
    expect(newCardFrameStyle({ template: "m15snow", finish: "regular", ...NEW_CARD_ANATOMY }, "creature")).toEqual({
      template: "m15snow",
      finish: "regular",
      collector: "2023",
    });
    // A frame with no collector slot drops the line's keys too.
    expect(newCardFrameStyle({ template: "m15borderless", finish: "regular", ...NEW_CARD_ANATOMY, star: true }, "creature")).toEqual({
      template: "m15borderless",
      finish: "regular",
    });
    expect(newCardFrameStyle({ template: "m15artifact", ...NEW_CARD_ANATOMY }, "creature")).toEqual({
      template: "m15artifact",
      crown: true,
      twoColor: true,
      collector: "2023",
    });
  });
});

describe("every save (normalizeAnatomy)", () => {
  it("drops a switch the template can't draw, so a template that gains the piece later never changes the card", () => {
    expect(normalizeAnatomy({ template: "m15snow", crown: true, twoColor: false }, "m15snow", "creature")).toEqual({ template: "m15snow" });
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
    expect(frameMasterKey(getFrameProfile("m15snow"), ["white", "blue"], creature, { twoColor: true })).toBe("m");
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
        { frameStyle: { template: "m15snow" }, colorIdentity: ["multicolor"], cardType: "creature" },
        { twoColor: true, pair: ["white", "blue"] },
      ),
    ).toEqual({ ok: true, frameStyle: { template: "m15snow" }, colorIdentity: null });
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
    expect(importedAnatomy(facts, "m15snow").colorIdentity).toEqual(["multicolor"]);
    expect(importedAnatomy(facts, "tarkirdragon").colorIdentity).toEqual(["multicolor"]);
  });

  it("a crownless printing imports with the crown off, so the new-card default never crowns it", () => {
    const crownless = importedAnatomy({ ...facts, printed_crown: false }, "m15");
    expect(newCardFrameStyle({ template: "m15", ...crownless.style }, "creature")).toEqual({
      template: "m15",
      crown: false,
      twoColor: true,
      collector: "2023",
    });
  });
});
