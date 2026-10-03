import { describe, expect, it } from "vitest";
import {
  FRAME_ANATOMY_KEYS,
  NEW_CARD_ANATOMY,
  anatomyDefaults,
  anatomyOn,
  applyFrameAnatomyPatch,
  frameAnatomyOf,
  importedAnatomy,
  importedFormAnatomy,
  newCardFrameStyle,
  normalizeAnatomy,
  storedAnatomyOf,
} from "@/lib/cards/anatomy";
import { COLLECTOR_TEMPLATES } from "@/lib/cards/collector-line";
import { defaultValuesFor, remixValuesFrom } from "@/lib/creator/card-fields";
import { frameAnatomyPatchFor } from "@/lib/creator/revise";
import { frameAnatomyPatchSchema, frameStyleSchema, updateCardSchema } from "@/lib/validation/card";
import { FRAME_TEMPLATE_VALUES, type Card, type FrameStyle } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 4.9b — the collector line's switches through 4.6.0's plumbing
// (lib/cards/anatomy.ts): `collector` ("2015" | "2023" | "off" | absent)
// and `star` (`true` | absent) join FRAME_ANATOMY_KEYS, so they travel in
// the edit-time frame_anatomy patch (owner 2026-09-29: the edit lock is
// relaxed for look switches only). The owner rule: a NEW card starts with
// the line on in today's style; a stored card from before it keeps its
// look — key-less stays key-less through hydrate and save, the editor
// hints; "off" is the owner's explicit choice; a remix starts on unless
// the parent turned it off (4.6.0's rule); the save drops both keys on a
// template without the slot; an import follows the printing.
// ---------------------------------------------------------------------------

describe("the keys and the defaults", () => {
  it("collector and star are anatomy keys; a new card starts with the line on in the 2023 style and no ★", () => {
    expect([...FRAME_ANATOMY_KEYS]).toEqual(["crown", "twoColor", "collector", "star"]);
    expect(NEW_CARD_ANATOMY).toEqual({ crown: true, twoColor: true, collector: "2023" });
    expect("star" in NEW_CARD_ANATOMY).toBe(false);
    for (const template of FRAME_TEMPLATE_VALUES) {
      const slotted = (COLLECTOR_TEMPLATES as readonly string[]).includes(template);
      expect(frameAnatomyOf(template).collector, template).toBe(slotted);
      expect(anatomyDefaults(template).collector, template).toBe(slotted ? "2023" : undefined);
      expect("star" in anatomyDefaults(template), template).toBe(false);
    }
  });

  it("the render rule: on only for a style; off, absent and anything else draw nothing; the ★ only when exactly true", () => {
    expect(anatomyOn({ collector: "2015" }, "collector")).toBe(true);
    expect(anatomyOn({ collector: "2023" }, "collector")).toBe(true);
    expect(anatomyOn({ collector: "off" }, "collector")).toBe(false);
    expect(anatomyOn({}, "collector")).toBe(false);
    expect(anatomyOn(null, "collector")).toBe(false);
    expect(anatomyOn({ collector: true as unknown as "2015" }, "collector")).toBe(false);
    expect(anatomyOn({ star: true }, "star")).toBe(true);
    expect(anatomyOn({}, "star")).toBe(false);
  });
});

describe("every save (normalizeAnatomy / newCardFrameStyle)", () => {
  it("keeps the keys on a slotted template — a style, the explicit off, the ★ — and drops them elsewhere", () => {
    expect(normalizeAnatomy({ template: "m15", collector: "2015", star: true }, "m15", "creature")).toEqual({ template: "m15", collector: "2015", star: true });
    expect(normalizeAnatomy({ template: "m15pw", collector: "off" }, "m15pw", "planeswalker")).toEqual({ template: "m15pw", collector: "off" });
    expect(normalizeAnatomy({ template: "emblem", collector: "2023" }, "emblem", "emblem")).toEqual({ template: "emblem", collector: "2023" });
    for (const template of ["m15borderless", "saga", "adventure", "extendedart", "lotr", "m20token", "fullartland"] as const) {
      expect(normalizeAnatomy({ template, finish: "foil", collector: "2023", star: true }, template, "creature"), template).toEqual({ template, finish: "foil" });
    }
    // A stored key-less card: nothing to drop, the same object back.
    const untouched: FrameStyle = { template: "m15", finish: "regular" };
    expect(normalizeAnatomy(untouched, "m15", "creature")).toBe(untouched);
  });

  it("a new card gets collector '2023' where the template has the slot, never a ★; an explicit value survives", () => {
    expect(newCardFrameStyle({ template: "m15" }, "creature")).toMatchObject({ collector: "2023" });
    expect("star" in newCardFrameStyle({ template: "m15" }, "creature")).toBe(false);
    expect(newCardFrameStyle({ template: "m15pw" }, "planeswalker")).toEqual({ template: "m15pw", collector: "2023" });
    expect(newCardFrameStyle({ template: "m15token", finish: "regular" }, "token")).toEqual({ template: "m15token", finish: "regular", collector: "2023" });
    expect(newCardFrameStyle({ template: "m15", collector: "2015", star: true }, "creature")).toMatchObject({ collector: "2015", star: true });
    expect(newCardFrameStyle({ template: "m15", collector: "off" }, "creature")).toMatchObject({ collector: "off" });
    // No slot on m15borderless: no collector key (it starts with the crown
    // and pair switches it draws, 4.6f wave 2a).
    expect(newCardFrameStyle({ template: "m15borderless" }, "creature")).toEqual({ template: "m15borderless", crown: true, twoColor: true });
    // The creator's all-on switches on a frame with the slot but no crown.
    expect(newCardFrameStyle({ template: "m15devoid", ...NEW_CARD_ANATOMY }, "creature")).toEqual({ template: "m15devoid", collector: "2023" });
  });
});

describe("the schema (frameStyleSchema, frameAnatomyPatchSchema)", () => {
  it("accepts the three switch values and a true ★; refuses anything else", () => {
    for (const collector of ["2015", "2023", "off"]) expect(frameStyleSchema.parse({ template: "m15", collector })).toEqual({ template: "m15", collector });
    expect(frameStyleSchema.parse({ template: "m15", star: true })).toEqual({ template: "m15", star: true });
    expect(() => frameStyleSchema.parse({ collector: "on" })).toThrow();
    expect(() => frameStyleSchema.parse({ collector: true })).toThrow();
    expect(() => frameStyleSchema.parse({ star: false })).toThrow();
    expect(() => frameStyleSchema.parse({ star: "yes" })).toThrow();
    expect(() => frameStyleSchema.parse({ stamp: "auto" })).toThrow(); // 4.9c's key is not here yet
  });

  it("an edit's patch: a style or off, and a boolean ★ (false takes a stored ★ off)", () => {
    expect(frameAnatomyPatchSchema.parse({ collector: "2015" })).toEqual({ collector: "2015" });
    expect(frameAnatomyPatchSchema.parse({ collector: "off", star: false })).toEqual({ collector: "off", star: false });
    expect(frameAnatomyPatchSchema.parse({ star: true })).toEqual({ star: true });
    expect(() => frameAnatomyPatchSchema.parse({ collector: "2024" })).toThrow();
    expect(updateCardSchema.parse({ frame_anatomy: { collector: "2023", star: true } }).frame_anatomy).toEqual({ collector: "2023", star: true });
  });
});

describe("an edit's switch flip (applyFrameAnatomyPatch — updateCardAction)", () => {
  const storedCard = (frameStyle: Record<string, unknown>) => ({ frameStyle, colorIdentity: ["black"] as const, cardType: "creature" });

  it("merges the style or the off over the stored frame_style and leaves every other key as stored", () => {
    expect(applyFrameAnatomyPatch(storedCard({ template: "m15", finish: "foil" }), { collector: "2015" })).toEqual({
      ok: true,
      frameStyle: { template: "m15", finish: "foil", collector: "2015" },
      colorIdentity: null,
    });
    expect(applyFrameAnatomyPatch(storedCard({ template: "m15", collector: "2023", crown: true }), { collector: "off" })).toEqual({
      ok: true,
      frameStyle: { template: "m15", collector: "off", crown: true },
      colorIdentity: null,
    });
    // A legacy template draws m15: the keys are kept, the template never rewritten.
    expect(applyFrameAnatomyPatch(storedCard({ template: "regular" }), { collector: "2023", star: true })).toEqual({
      ok: true,
      frameStyle: { template: "regular", collector: "2023", star: true },
      colorIdentity: null,
    });
  });

  it("the ★: true sets it, false takes it off (the stored key is true or absent)", () => {
    expect(applyFrameAnatomyPatch(storedCard({ template: "m15", collector: "2015" }), { star: true })).toMatchObject({ ok: true, frameStyle: { template: "m15", collector: "2015", star: true } });
    expect(applyFrameAnatomyPatch(storedCard({ template: "m15", collector: "2015", star: true }), { star: false })).toMatchObject({ ok: true, frameStyle: { template: "m15", collector: "2015" } });
    const offAgain = applyFrameAnatomyPatch(storedCard({ template: "m15", collector: "2015", star: true }), { star: false });
    expect(offAgain.ok && "star" in offAgain.frameStyle).toBe(false);
    expect(applyFrameAnatomyPatch(storedCard({ template: "m15" }), { star: false })).toMatchObject({ ok: true, frameStyle: { template: "m15" } });
  });

  it("a frame without the slot drops the flip", () => {
    expect(applyFrameAnatomyPatch(storedCard({ template: "m15borderless", finish: "etched" }), { collector: "2023", star: true })).toEqual({
      ok: true,
      frameStyle: { template: "m15borderless", finish: "etched" },
      colorIdentity: null,
    });
  });
});

describe("the editor (card-fields, revise)", () => {
  function savedCard(frame_style: unknown, over: Partial<Card> = {}): Card {
    return {
      id: "00000000-0000-4000-8000-000000000001",
      title: "Sheoldred, the Apocalypse",
      slug: "sheoldred",
      game_system_id: "gs",
      cost: "{2}{B}{B}",
      color_identity: ["black"],
      supertype: "Legendary",
      card_type: "creature",
      subtypes: ["Phyrexian", "Praetor"],
      tags: [],
      rarity: "mythic",
      rules_text: "Deathtouch",
      flavor_text: null,
      power: "4",
      toughness: "5",
      loyalty: null,
      defense: null,
      artist_credit: "Chris Rahn",
      art_url: null,
      art_position: {},
      frame_style,
      visibility: "public",
      back_face: null,
      back_card_id: null,
      source_scryfall_id: null,
      set_icon_url: null,
      set_icon_code: null,
      face_content: null,
      watermark: null,
      footer_text: null,
      set_code: "DMU",
      collector_number: "107/281",
      lang: "en",
      ...over,
    } as unknown as Card;
  }

  it("hydrate: a key-less row stays key-less (the hint shows); a keyed row round-trips exactly", () => {
    expect(storedAnatomyOf({ template: "m15", finish: "regular" })).toEqual({});
    expect(defaultValuesFor(savedCard({ template: "m15", finish: "regular" }), []).frame_style).toEqual({ finish: "regular", template: "m15" });
    for (const stored of [
      { template: "m15", collector: "2015" },
      { template: "m15", collector: "2023", star: true },
      { template: "m15", collector: "off" },
      { template: "m15", collector: "2015", crown: false },
    ] as const) {
      expect(storedAnatomyOf(stored), JSON.stringify(stored)).toEqual(Object.fromEntries(Object.entries(stored).filter(([k]) => k !== "template")));
      expect(defaultValuesFor(savedCard(stored), []).frame_style, JSON.stringify(stored)).toEqual({ finish: "regular", ...stored });
    }
    // Anything but a switch value is not a switch: never hydrated, never saved.
    expect(storedAnatomyOf({ collector: "on", star: "yes" })).toEqual({});
    expect(storedAnatomyOf({ collector: true, star: 1 })).toEqual({});
    expect(storedAnatomyOf({ star: false })).toEqual({});
  });

  it("save round-trip: an edit of a key-less card sends nothing, so it stays key-less; a flip sends only what changed", () => {
    const keyless = savedCard({ template: "m15", finish: "regular" });
    const values = defaultValuesFor(keyless, []);
    expect(frameAnatomyPatchFor(keyless, values)).toBeUndefined();
    // The owner switches the line on (the panel picks the 2015 style for a
    // number with a set size) — the patch carries just that.
    expect(frameAnatomyPatchFor(keyless, { ...values, frame_style: { ...values.frame_style, collector: "2015" } })).toEqual({ collector: "2015" });
    // …and the ★ on, then off again on a card that stored it.
    expect(frameAnatomyPatchFor(keyless, { ...values, frame_style: { ...values.frame_style, collector: "2015", star: true } })).toEqual({ collector: "2015", star: true });
    const starred = savedCard({ template: "m15", collector: "2015", star: true });
    const starredValues = defaultValuesFor(starred, []);
    expect(frameAnatomyPatchFor(starred, starredValues)).toBeUndefined();
    expect(frameAnatomyPatchFor(starred, { ...starredValues, frame_style: { ...starredValues.frame_style, star: undefined } })).toEqual({ star: false });
    // Switching off writes the explicit off.
    expect(frameAnatomyPatchFor(starred, { ...starredValues, frame_style: { ...starredValues.frame_style, collector: "off" } })).toEqual({ collector: "off" });
  });

  it("a new card starts on; a remix starts on unless the parent turned it off (4.6.0's rule), with the parent's ★", () => {
    expect(defaultValuesFor(null, []).frame_style).toMatchObject({ collector: "2023" });
    expect("star" in defaultValuesFor(null, []).frame_style).toBe(false);
    expect(remixValuesFrom(savedCard({ template: "m15", finish: "regular" }), []).frame_style).toMatchObject({ collector: "2023" });
    expect(remixValuesFrom(savedCard({ template: "m15", collector: "off" }), []).frame_style).toMatchObject({ collector: "off" });
    expect(remixValuesFrom(savedCard({ template: "m15", collector: "2015", star: true }), []).frame_style).toMatchObject({ collector: "2015", star: true });
    expect("star" in remixValuesFrom(savedCard({ template: "m15", collector: "2015" }), []).frame_style).toBe(false);
  });
});

describe("imports follow the printing (importedAnatomy / importedFormAnatomy)", () => {
  it("the printing's style and ★ ride the import's switches; a switch the printing doesn't name takes the new-card default", () => {
    expect(importedAnatomy({ printed_collector: "2015", printed_star: true }, "m15").style).toEqual({ collector: "2015", star: true });
    expect(importedAnatomy({ printed_collector: "off" }, "m15").style).toEqual({ collector: "off" });
    expect(importedAnatomy({}, "m15").style).toEqual({});
    expect(importedFormAnatomy({ collector: "2015", star: true })).toEqual({ crown: true, twoColor: true, collector: "2015", star: true });
    expect(importedFormAnatomy({ collector: "off" })).toEqual({ crown: true, twoColor: true, collector: "off" });
    expect(importedFormAnatomy({})).toEqual({ crown: true, twoColor: true, collector: "2023" });
    // Saved on a frame without the slot, the printing's switches are dropped.
    expect(newCardFrameStyle({ template: "lotr", collector: "2023", star: true }, "creature")).toEqual({ template: "lotr" });
  });
});
