import { describe, expect, it } from "vitest";
import fixture from "./fixtures/prepare-printings.json";
import { frameMatchFromScryfall, kindFromScryfall, mapScryfallToFormPatch } from "@/lib/scryfall/import-mapper";
import { finalizeImportMatch, remixFrameFor } from "@/lib/creator/frame-resolve";
import type { ScryfallCard } from "@/lib/scryfall/client";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 4.27 — every Prepare printing on Scryfall (124, captured 2026-10-21:
// tests/unit/scryfall/fixtures/prepare-printings.json) through the import:
//   • the Prepare kind KEEPS the spell — the second face is the card's back
//     face, which the frame draws as its page (main imported the creature
//     alone on M15, the spell a back face no frame drew: the `layout` gap);
//   • the bordered printings land EXACT on `prepare` once it is verified in
//     the card's colour — nearest, and the creature on M15 as on main, while
//     it isn't;
//   • the rest say why: a two-colour card's split frame (4.6f), a spell
//     page of another colour (4.26), extended art (no Prepare dress), and
//     the two TEXTLESS printings keep main's landing (the creature on the
//     textless frames).
// ---------------------------------------------------------------------------

const PRINTINGS = (fixture as { printings: Record<string, ScryfallCard> }).printings;
const card = (key: string) => {
  const found = PRINTINGS[key];
  if (!found) throw new Error(`no captured printing ${key}`);
  return found;
};
const KEYS = Object.keys(PRINTINGS);
const ALL_VERIFIED = new Set(FRAME_TEMPLATE_VALUES.flatMap((t) => ["w", "u", "b", "r", "g", "m", "c"].map((k) => `${t}/${k}`)));
const PREPARE_UNVERIFIED = new Set([...ALL_VERIFIED].filter((k) => !k.startsWith("prepare/")));

describe("the Prepare printings, imported", () => {
  it("captures all 124", () => {
    expect(KEYS).toHaveLength(124);
    for (const key of KEYS) expect(card(key).layout, key).toBe("prepare");
  });

  it("is the Prepare kind and keeps the spell as the back face — but a textless printing", () => {
    for (const key of KEYS) {
      const printing = card(key);
      const patch = mapScryfallToFormPatch(printing);
      const textless = printing.textless === true;
      expect(kindFromScryfall(printing), key).toBe(textless ? "creature" : "prepare");
      expect(patch.kind, key).toBe(textless ? "creature" : "prepare");
      expect(patch.card_type, key).toBe("creature");
      expect(patch.title, key).toBe(printing.card_faces![0]!.name);
      const spell = printing.card_faces![1]!;
      expect(patch.back_face, key).toMatchObject({ title: spell.name, cost: spell.mana_cost, rules_text: spell.oracle_text });
      expect(["instant", "sorcery"], key).toContain(patch.back_face!.card_type);
    }
    expect(KEYS.filter((k) => card(k).textless === true).sort()).toEqual(["fra-402", "sos-306"]);
  });

  it("names the frame and the reason for every printing", () => {
    const table: Record<string, number> = {};
    for (const key of KEYS) {
      const m = frameMatchFromScryfall(card(key));
      const row = `${m.status} ${m.template}${m.landOn ? `→${m.landOn}` : ""} ${m.signature} ${m.blockedBy ?? "-"}`;
      table[row] = (table[row] ?? 0) + 1;
    }
    expect(table).toEqual({
      "exact prepare layout/2015 -": 66,
      "nearest extendedart→prepare extendedart -": 29,
      "nearest prepare layout/2015+two-colour 4.6f": 12,
      "nearest prepare layout/2015+two-colour-hybrid 4.6f": 10,
      "nearest prepare layout/2015+part-colour 4.26": 5,
      "nearest m15textless textless/2015 4.42": 1,
      "nearest modern textless/old-frame 4.43": 1,
    });
    // SOS #109 Blazing Firesinger // Seething Song: the reference.
    expect(frameMatchFromScryfall(card("sos-109"))).toMatchObject({ status: "exact", template: "prepare" });
    // SOS #170 Abigale: a W/B creature — the split frame (4.6f) before its
    // hybrid spell's grey page.
    expect(frameMatchFromScryfall(card("sos-170"))).toMatchObject({ status: "nearest", template: "prepare", blockedBy: "4.6f" });
    // FRA #3 Blossom-Blessed Angel: a white creature, a {G/W} spell on a
    // grey page.
    expect(frameMatchFromScryfall(card("fra-3"))).toMatchObject({
      status: "nearest",
      template: "prepare",
      blockedBy: "4.26",
      reason: expect.stringMatching(/spell's page/),
    });
    // The textless printings keep main's landing and reason: the textless
    // frames' own gap (the creature kind, the spell a legacy back).
    expect(frameMatchFromScryfall(card("fra-402"))).toMatchObject({ status: "nearest", template: "m15textless", blockedBy: "4.42" });
  });

  it("a legendary printing wears the crown (SOS #55 Jadzi, exact)", () => {
    const patch = mapScryfallToFormPatch(card("sos-55"));
    expect(patch.printed_crown).toBe(true);
    expect(patch.frame_match).toMatchObject({ status: "exact", template: "prepare" });
  });

  it("lands exact on the frame once it is verified in the colour; nearest, and the creature on M15, while it isn't", () => {
    const patch = mapScryfallToFormPatch(card("sos-109"));
    expect(finalizeImportMatch(patch, ALL_VERIFIED).frame_match).toMatchObject({ status: "exact", template: "prepare" });
    expect(finalizeImportMatch(patch, PREPARE_UNVERIFIED).frame_match?.status).toBe("nearest");
    // The AI deck remix lands where the import does (remixFrameFor).
    expect(remixFrameFor(patch, ALL_VERIFIED)).toEqual({ ok: true, template: "prepare", card_type: "creature" });
    expect(remixFrameFor(patch, PREPARE_UNVERIFIED)).toMatchObject({ ok: true, template: "m15", card_type: "creature" });
  });
});
