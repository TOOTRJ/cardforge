import { describe, expect, it } from "vitest";
import emblemData from "./fixtures/emblem-printings.json";
import { scryfallCardSchema, type ScryfallCard } from "@/lib/scryfall/client";
import {
  emblemPrintsSubtype,
  emblemTitleFromName,
  frameMatchFromScryfall,
  kindFromScryfall,
  mapScryfallToFormPatch,
} from "@/lib/scryfall/import-mapper";
import { isM20DesignPrinting } from "@/lib/scryfall/frame-signatures";
import { withVerification } from "@/lib/creator/frame-resolve";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import { buildTypeLine } from "@/lib/cards/card-display";
import { parseSubtypes } from "@/lib/creator/card-fields";
import { importPatchTypeLine } from "@/components/creator/import/import-detail";

// ---------------------------------------------------------------------------
// TODO 1.23's emblem half, 6.23 and 4.52: every printed emblem (Scryfall
// `t:emblem`, 141 printings captured 2026-09-29 in
// tests/unit/scryfall/fixtures/emblem-printings.json) imports on the emblem
// kind with the source's name, no colour, cost, supertype or stats, common,
// and a subtype only where the printing prints one; the registry calls the
// M20 design exact on the emblem frame, the 2014–19 look and the 2003
// plaque nearest, and the one-offs unsupported. Tests never call Scryfall.
// ---------------------------------------------------------------------------

type Raw = { set: string; collector_number: string };
const printings = (emblemData as { printings: Raw[] }).printings;
const all: ScryfallCard[] = printings.map((raw) => scryfallCardSchema.parse(raw));
const find = (set: string, cn: string): ScryfallCard => {
  const card = all.find((c) => c.set === set && c.collector_number === cn);
  if (!card) throw new Error(`no fixture ${set} #${cn}`);
  return card;
};

describe("every printed emblem imports on the emblem kind (TODO 1.23 / 6.23)", () => {
  it("covers Scryfall's 141 emblems", () => {
    expect(all).toHaveLength(141);
  });

  it.each(all.map((card) => [`${card.set} #${card.collector_number}`, card] as const))(
    "%s: the emblem kind and card type, colourless, common, no cost / supertype / stats",
    (_label, card) => {
      expect(kindFromScryfall(card)).toBe("emblem");
      const patch = mapScryfallToFormPatch(card);
      expect(patch.kind).toBe("emblem");
      expect(patch.card_type).toBe("emblem");
      expect(patch.color_identity).toEqual(["colorless"]);
      expect(patch.rarity).toBe("common");
      expect(patch.cost).toBeUndefined();
      expect(patch.supertype).toBeUndefined();
      for (const stat of [patch.power, patch.toughness, patch.loyalty, patch.defense]) expect(stat).toBeUndefined();
      // The title bar prints the source's name, never "… Emblem".
      expect(patch.title).not.toMatch(/\sEmblem$/);
      expect(frameMatchFromScryfall(card).template).toBe("emblem");
    },
  );

  it("answers the M20 design exact, the 2014–19 look and the 2003 plaque nearest, the one-offs unsupported", () => {
    const tally: Record<string, number> = {};
    for (const card of all) {
      const m = frameMatchFromScryfall(card);
      const key = `${m.signature} ${m.status}${m.blockedBy ? ` ${m.blockedBy}` : ""}`;
      tally[key] = (tally[key] ?? 0) + 1;
    }
    expect(tally).toEqual({
      "emblem/m20 exact": 67,
      "emblem/2014-19 nearest 4.52": 56,
      "emblem/old-frame nearest 4.43": 13,
      "emblem/one-off unsupported": 5,
    });
    // 4.52's count: 76 released from 2019-07-12 on — the 67, the four M20-era
    // one-offs and TLTR #H13, and the four List reprints of pre-M20 prefixes.
    const released = all.filter((c) => (c.released_at ?? "") >= "2019-07-12");
    expect(released).toHaveLength(76);
    expect(all.filter((c) => c.frame === "2015" && isM20DesignPrinting(c))).toHaveLength(72);
  });

  it.each([
    ["tfdn", "24"],
    ["tfdn", "25"],
    ["tm20", "11"],
    ["tdsk", "17"],
    ["tblb", "30"],
    ["tfra", "16"],
    ["tkhm", "20"],
    ["tafr", "16"],
    ["tmoc", "44"],
    ["plst", "TSTX-8"],
  ])("%s #%s: today's design, exact on emblem/c once verified", (set, cn) => {
    const match = frameMatchFromScryfall(find(set, cn));
    expect(match).toMatchObject({ status: "exact", template: "emblem", signature: "emblem/m20", reason: null });
    // Until the owner verifies emblem/c, the finalized answer is "not yet
    // verified" (1.6's `unverified` cause), never exact.
    expect(withVerification(match, "c", new Set())).toMatchObject({ status: "nearest", unverified: true });
    expect(withVerification(match, "c", new Set([frameComboKey("emblem", "c")]))).toMatchObject({ status: "exact" });
  });

  it.each([
    ["tm15", "13"],
    ["tkld", "10"],
    ["plst", "TORI-14"],
  ])("%s #%s: the 2014–19 EMBLEM bar — nearest the emblem frame (4.52's later variant)", (set, cn) => {
    expect(frameMatchFromScryfall(find(set, cn))).toMatchObject({
      status: "nearest",
      template: "emblem",
      signature: "emblem/2014-19",
      blockedBy: "4.52",
    });
  });

  it("the 2003 plaque (TDKA #3, the first emblem) is nearest, blocked by the old borders (4.43)", () => {
    expect(frameMatchFromScryfall(find("tdka", "3"))).toMatchObject({
      status: "nearest",
      template: "emblem",
      signature: "emblem/old-frame",
      blockedBy: "4.43",
    });
  });

  it.each([
    ["tltr", "H13", "Double-faced emblem", "The Ring"],
    ["tacr", "7", "Universes Beyond full-bleed emblem", "The Capitoline Triad"],
    ["tfin", "24", "Universes Beyond full-bleed emblem", "Sephiroth, One-Winged Angel"],
    ["wfin", "1", "Universes Beyond full-bleed emblem", "Sephiroth, One-Winged Angel"],
    ["mb2", "513", "Playtest emblem", "Essence of Ajani"],
  ])("%s #%s: a one-off (%s) — unsupported, logged, imported on the emblem frame", (set, cn, label, title) => {
    const card = find(set, cn);
    expect(frameMatchFromScryfall(card)).toMatchObject({
      status: "unsupported",
      template: "emblem",
      signature: "emblem/one-off",
      exactLabel: label,
    });
    expect(mapScryfallToFormPatch(card).title).toBe(title);
  });
});

describe("the emblem's printed line (TODO 1.23's subtype rule)", () => {
  // [set, collector number, title, printed type line]
  const rows: [string, string, string, string][] = [
    ["tfdn", "24", "Kaito, Cunning Infiltrator", "Emblem"],
    // Scryfall's Oracle line says "Emblem — Vivien"; the card prints "Emblem".
    ["tfdn", "25", "Vivien Reid", "Emblem"],
    // AFR re-added the subtype.
    ["tafr", "16", "Ellywick Tumblestrum", "Emblem — Ellywick"],
    // The 2014–19 look.
    ["tm15", "13", "Ajani Steadfast", "Emblem — Ajani"],
    ["plst", "TORI-14", "Chandra, Roaring Flame", "Emblem — Chandra"],
    ["plst", "TSOI-18", "Arlinn, Embraced by the Moon", "Emblem — Arlinn"],
    // A List reprint of an M20-era set prints today's "Emblem".
    ["plst", "TSTX-8", "Lukka, Wayward Bonder", "Emblem"],
    ["plst", "TKHM-21", "Tibalt, Cosmic Impostor", "Emblem"],
    // The 2003 plaque prints no type line; the import writes none.
    ["tdka", "3", "Sorin, Lord of Innistrad", "Emblem"],
  ];

  it.each(rows)("%s #%s: %s — %s", (set, cn, title, line) => {
    const patch = mapScryfallToFormPatch(find(set, cn));
    expect(patch.title).toBe(title);
    expect(
      buildTypeLine({
        supertype: patch.supertype,
        cardType: patch.card_type,
        subtypes: parseSubtypes(patch.subtypes_text ?? ""),
      }),
    ).toBe(line);
  });

  it("the import dialog's Type row reads the same line", () => {
    for (const [set, cn, , line] of rows) {
      expect(importPatchTypeLine(mapScryfallToFormPatch(find(set, cn))), `${set} #${cn}`).toBe(line);
    }
  });

  it("strips only Scryfall's trailing ' Emblem'", () => {
    expect(emblemTitleFromName("Kaito, Cunning Infiltrator Emblem")).toBe("Kaito, Cunning Infiltrator");
    expect(emblemTitleFromName("The Ring")).toBe("The Ring");
    expect(emblemTitleFromName("Emblem")).toBe("Emblem");
    expect(emblemTitleFromName("  Nissa, Who Shakes the World Emblem  ")).toBe("Nissa, Who Shakes the World");
  });

  it("prints a subtype on the 2014–19 look and AFR only", () => {
    const subtype = (set: string, cn: string) => emblemPrintsSubtype(find(set, cn));
    expect(subtype("tm15", "13")).toBe(true);
    expect(subtype("tkld", "10")).toBe(true);
    expect(subtype("plst", "TORI-14")).toBe(true);
    expect(subtype("tafr", "16")).toBe(true);
    expect(subtype("tfdn", "25")).toBe(false);
    expect(subtype("tm20", "11")).toBe(false);
    expect(subtype("plst", "TSTX-8")).toBe(false);
    expect(subtype("tdka", "3")).toBe(false);
    const printed = all.filter((c) => emblemPrintsSubtype(c));
    // The 56 2014–19 printings and AFR's four.
    expect(printed).toHaveLength(60);
  });
});
