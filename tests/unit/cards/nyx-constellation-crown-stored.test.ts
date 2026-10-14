import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyFrameAnatomyPatch, importedAnatomy, importedFormAnatomy, newCardFrameStyle } from "@/lib/cards/anatomy";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import { defaultValuesFor, remixValuesFrom } from "@/lib/creator/card-fields";
import { FRAME_COLOR_KEYS } from "@/lib/creator/card-kinds";
import { finalizeImportMatch, remixFrameFor } from "@/lib/creator/frame-resolve";
import { legendaryVariationOf } from "@/lib/creator/legendary-variation";
import { frameAnatomyPatchFor } from "@/lib/creator/revise";
import type { ScryfallCard } from "@/lib/scryfall/client";
import { mapScryfallToFormPatch } from "@/lib/scryfall/import-mapper";
import type { Card, FrameTemplate } from "@/types/card";
import signaturePrintings from "../scryfall/fixtures/signature-printings.json";

// ---------------------------------------------------------------------------
// The Nyx Constellation frame's crown (template `nyx`) — what the independent
// check of #555 pinned beside the builder's tests:
//
//   • a STORED legendary card on the frame names no `crown` switch (the save
//     dropped the key while the frame drew no crown). Opening it in the
//     editor and saving it sends no `frame_anatomy` — the crown is never
//     stamped on by an edit its maker did not make; only the switch does it;
//   • a REMIX of that card is a new card and starts with the crown on;
//   • a THB constellation printing's import follows its printing wherever it
//     LANDS: on production's verified list `nyx` is not ticked, so today it
//     lands on M15 — now with the crown ON (it was off: a behaviour change
//     of this PR outside `nyx`); once `nyx` is ticked it lands there, on.
// ---------------------------------------------------------------------------

function stored(frameStyle: unknown, over: Record<string, unknown> = {}): Card {
  return {
    id: "00000000-0000-4000-8000-000000000116",
    title: "Orrin, Keeper of the Low Tide",
    slug: "orrin-keeper-of-the-low-tide",
    game_system_id: "gs",
    cost: "{1}{U}{U}",
    color_identity: ["blue"],
    supertype: "Legendary Enchantment",
    card_type: "creature",
    subtypes: ["Demigod"],
    tags: [],
    rarity: "uncommon",
    rules_text: "Orrin's power is equal to your devotion to blue.",
    flavor_text: null,
    power: "*",
    toughness: "3",
    loyalty: null,
    defense: null,
    artist_credit: null,
    art_url: null,
    art_position: {},
    frame_style: frameStyle,
    visibility: "unlisted",
    back_face: null,
    back_card_id: null,
    source_scryfall_id: null,
    set_icon_url: null,
    set_icon_code: null,
    face_content: null,
    watermark: null,
    footer_text: null,
    ...over,
  } as unknown as Card;
}

describe("a stored legendary card on the frame, saved before the crown shipped", () => {
  const card = stored({ template: "nyx", finish: "regular" });

  it("opens with no crown switch set, and an untouched save sends no frame_anatomy", () => {
    const values = defaultValuesFor(card, []);
    expect(values.frame_style).toEqual({ template: "nyx", finish: "regular" });
    expect("crown" in values.frame_style).toBe(false);
    expect(frameAnatomyPatchFor(card, values)).toBeUndefined();
    // The switch is offered (the card is legendary, the frame draws a crown) and reads OFF.
    expect(
      legendaryVariationOf({ template: "nyx", cardType: "creature", supertype: "Legendary Enchantment", colorIdentity: ["blue"], crown: values.frame_style.crown }),
    ).toMatchObject({ available: true, selected: false, switchShown: true });
  });

  it("only the switch turns it on — and off again leaves an explicit false, never a redraw", () => {
    const values = defaultValuesFor(card, []);
    const on = frameAnatomyPatchFor(card, { ...values, frame_style: { ...values.frame_style, crown: true } });
    expect(on).toEqual({ crown: true });
    const applied = applyFrameAnatomyPatch({ frameStyle: card.frame_style as Record<string, unknown>, colorIdentity: ["blue"], cardType: "creature" }, on!);
    expect(applied).toMatchObject({ ok: true, frameStyle: { template: "nyx", finish: "regular", crown: true }, colorIdentity: null });
    const switchedOn = stored({ template: "nyx", finish: "regular", crown: true });
    const reopened = defaultValuesFor(switchedOn, []);
    expect(frameAnatomyPatchFor(switchedOn, reopened)).toBeUndefined();
    expect(frameAnatomyPatchFor(switchedOn, { ...reopened, frame_style: { ...reopened.frame_style, crown: false } })).toEqual({ crown: false });
  });

  it("a remix of it is a NEW card: the crown starts on; an owner's explicit off is kept", () => {
    expect(remixValuesFrom(card, []).frame_style.crown).toBe(true);
    expect(remixValuesFrom(stored({ template: "nyx", finish: "regular", crown: false }), []).frame_style.crown).toBe(false);
  });
});

describe("a THB constellation printing's import, today and after the frame is ticked", () => {
  /** Production's verified combos (supabase/seed.sql mirrors them). */
  function productionVerifiedKeys(): Set<string> {
    const sql = readFileSync(join(process.cwd(), "supabase/seed.sql"), "utf8");
    const block = /-- frame_reviews:begin\n([\s\S]*?)-- frame_reviews:end/.exec(sql)?.[1].replace(/--.*$/gm, "");
    if (!block) throw new Error("frame_reviews block missing from seed.sql");
    const everyColour = /unnest\(array\[([^\]]*)\]\)\s+as t/.exec(block)?.[1] ?? "";
    const out = new Set<string>();
    for (const [, template] of everyColour.matchAll(/'([^']+)'/g)) {
      for (const colour of FRAME_COLOR_KEYS) out.add(frameComboKey(template as FrameTemplate, colour));
    }
    for (const [, template, colour] of block.matchAll(/\('([^']+)',\s*'([wubrgcm])',\s*true/g)) {
      out.add(frameComboKey(template as FrameTemplate, colour));
    }
    return out;
  }
  const PROD = productionVerifiedKeys();
  const TICKED = new Set([...PROD, ...FRAME_COLOR_KEYS.map((c) => frameComboKey("nyx", c))]);
  const heliod = (signaturePrintings as unknown as Record<string, ScryfallCard>)["thb-259"];
  const patch = mapScryfallToFormPatch(heliod);
  const savedOn = (verified: Set<string>) => {
    const landed = remixFrameFor(patch, verified);
    if (!landed.ok) throw new Error(landed.error);
    const anatomy = importedAnatomy(finalizeImportMatch(patch, verified), landed.template);
    const form = importedFormAnatomy(anatomy.style);
    return { template: landed.template, form, saved: newCardFrameStyle({ template: landed.template, finish: "regular", ...anatomy.style }, landed.card_type) };
  };

  it("is the constellation signature, crown named ON by the printing", () => {
    expect(patch.frame_match?.signature).toBe("showcase/thb/constellation");
    expect(patch.frame_template).toBe("nyx");
    expect(patch.printed_crown).toBe(true);
  });

  it("today (nyx is not on production's list) it lands off the frame — with the crown on", () => {
    expect([...PROD].some((key) => key.startsWith("nyx/"))).toBe(false);
    const today = savedOn(PROD);
    expect(today.template).not.toBe("nyx");
    expect(today.form.crown).toBe(true);
    expect(today.saved.crown).toBe(true);
    expect(finalizeImportMatch(patch, PROD).frame_match).toMatchObject({ status: "nearest", unverified: true });
  });

  it("once nyx is ticked it lands on the frame, exact, crown on", () => {
    const ticked = savedOn(TICKED);
    expect(ticked.template).toBe("nyx");
    expect(ticked.saved).toMatchObject({ template: "nyx", crown: true });
    expect(finalizeImportMatch(patch, TICKED).frame_match).toMatchObject({ status: "exact", template: "nyx" });
  });
});
