import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CardPreviewData } from "@/components/cards/card-preview";
import { backPreviewData, facesOf, frontPreviewData, manaLineOf, otherFaceOf, typeWordOf } from "@/lib/cards/faces";
import { drawableCardMedia } from "@/lib/cards/drawable-media";
import { rowToPreviewData, type CardRowForBake } from "@/lib/cards/bake-core";
import type { CardBackFace, CardType, ColorIdentity, FrameStyle, Rarity } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 5.0a — lib/cards/faces.ts on the REAL profiles, where no template is a
// DFC body: every card's front is returned AS IT IS (no `dfc` block), and a
// `back_face` maps to EXACTLY what the live preview has always drawn for a
// legacy back (components/cards/card-preview.tsx backFaceData on the front's
// faceProps): the back's content on the FRONT's template, colour, finish,
// set symbol and switches, no structured content, no watermark, no
// collector fields — so the 8 imported double-faced cards (and the one
// adventure stored as a back) look the same the day the renderers start
// reading this module (5.2). Fixture: the shapes of production's nine
// visible back_face rows (tests/unit/cards/fixtures/dfc-legacy-backs.json).
// The strip's word and line (D9) are pinned on the scan cases of the design.
// ---------------------------------------------------------------------------

type FixtureRow = {
  label: string;
  layout: "transform" | "modal" | "adventure";
  front: {
    title: string;
    card_type: CardType;
    supertype: string | null;
    subtypes: string[];
    cost: string | null;
    power: string | null;
    toughness: string | null;
    rules_text: string;
    frame_style: FrameStyle;
    color_identity: ColorIdentity[];
    rarity: Rarity;
  };
  back_face: CardBackFace;
};

const fixture = JSON.parse(readFileSync(join(process.cwd(), "tests/unit/cards/fixtures/dfc-legacy-backs.json"), "utf8")) as {
  rows: FixtureRow[];
};

/** The preview's data for a stored row, as the card page and the bake build it. */
function previewOf(row: FixtureRow): CardPreviewData {
  return drawableCardMedia({
    title: row.front.title,
    cost: row.front.cost,
    cardType: row.front.card_type,
    supertype: row.front.supertype,
    subtypes: row.front.subtypes,
    rarity: row.front.rarity,
    colorIdentity: row.front.color_identity,
    rulesText: row.front.rules_text,
    flavorText: null,
    power: row.front.power,
    toughness: row.front.toughness,
    loyalty: null,
    defense: null,
    artistCredit: "Front Artist",
    artUrl: "https://auth.pipglyph.com/storage/v1/object/public/card-art/00000000-0000-4000-8000-000000000001/front.webp",
    artPosition: { scale: 1, focalX: 0.5, focalY: 0.5 },
    frameStyle: row.front.frame_style,
    setIconUrl: null,
    setIconCode: "mid",
    setCode: "MID",
    collectorNumber: "169",
    lang: "en",
    faceContent: null,
    watermark: null,
    backFace: row.back_face,
    brandMark: true,
  });
}

/** What CardPreview draws for a legacy back today: backFaceData over the
 *  front's faceProps (template / colour / rarity / finish / set icon /
 *  switches), with no structured content and no watermark. */
function todaysLegacyBack(card: CardPreviewData): CardPreviewData {
  const back = card.backFace!;
  return {
    ...card,
    title: back.title ?? null,
    cost: back.cost ?? null,
    cardType: back.card_type ?? null,
    supertype: back.supertype ?? null,
    subtypes: back.subtypes ?? [],
    rulesText: back.rules_text ?? null,
    flavorText: back.flavor_text ?? null,
    power: back.power ?? null,
    toughness: back.toughness ?? null,
    loyalty: back.loyalty ?? null,
    defense: back.defense ?? null,
    artistCredit: back.artist_credit ?? null,
    artUrl: back.art_url ?? null,
    artPosition: back.art_position ?? {},
    faceContent: null,
    watermark: null,
    setCode: null,
    collectorNumber: null,
    lang: null,
    backFace: null,
    backCard: null,
    dfc: null,
  };
}

describe("the nine production shapes (8 imported DFCs + 1 adventure) — legacy backs", () => {
  it("the fixture is the read: nine rows, every one a body-less back face on a standard frame", () => {
    expect(fixture.rows).toHaveLength(9);
    expect(fixture.rows.filter((r) => r.layout !== "adventure")).toHaveLength(8);
    for (const row of fixture.rows) {
      expect(Object.keys(row.front.frame_style).sort(), row.label).toEqual(["finish", "template"]);
      expect(row.back_face.frame_style, row.label).toBeUndefined();
      expect(row.back_face.color_identity, row.label).toBeUndefined();
    }
  });

  it.each(fixture.rows.map((row) => [row.label, row] as const))("%s: the front is untouched and the back is today's flip, byte for byte", (_label, row) => {
    const card = previewOf(row);
    const front = frontPreviewData(card);
    expect(front).toBe(card); // the very object: nothing added, no block
    expect(front.dfc).toBeUndefined();
    const back = backPreviewData(card);
    expect(back).toEqual(todaysLegacyBack(card));
    // The back wears the FRONT's template, finish, colour and switches.
    expect(back?.frameStyle).toEqual(row.front.frame_style);
    expect(back?.colorIdentity).toEqual(row.front.color_identity);
    expect(back?.rarity).toBe(row.front.rarity);
    expect(back?.dfc).toBeNull();
    expect(facesOf(card)).toEqual({ front, back });
  });

  it("a card with no back face has no back", () => {
    const card = previewOf(fixture.rows[0]);
    expect(backPreviewData({ ...card, backFace: null })).toBeNull();
    expect(frontPreviewData({ ...card, backFace: null })).toEqual({ ...card, backFace: null });
    expect(facesOf({ ...card, backFace: undefined })).toEqual({ front: { ...card, backFace: undefined }, back: null });
  });

  it("the bake's row mapping reaches the same legacy back", () => {
    const row = fixture.rows[5]; // the land back
    const bakeRow: CardRowForBake = {
      id: "22222222-2222-4222-8222-222222222222",
      owner_id: "11111111-1111-4111-8111-111111111111",
      title: row.front.title,
      cost: row.front.cost,
      card_type: row.front.card_type,
      supertype: row.front.supertype,
      subtypes: row.front.subtypes,
      rarity: row.front.rarity,
      color_identity: row.front.color_identity,
      rules_text: row.front.rules_text,
      flavor_text: null,
      power: row.front.power,
      toughness: row.front.toughness,
      loyalty: null,
      defense: null,
      artist_credit: "Front Artist",
      art_url: null,
      art_position: null,
      frame_style: row.front.frame_style,
      set_icon_url: null,
      set_icon_code: null,
      back_face: row.back_face,
      face_content: null,
      watermark: null,
    };
    const card = rowToPreviewData(bakeRow);
    const back = backPreviewData(card)!;
    expect(back.title).toBe("Temple of Civilization");
    expect(back.cardType).toBe("land");
    expect(back.frameStyle).toEqual(row.front.frame_style);
    expect(back.dfc).toBeNull();
    expect(frontPreviewData(card)).toBe(card);
  });
});

describe("the strip's word and line (D9) on the design's scan cases", () => {
  it.each([
    ["ZNR #12 Emeria, Shattered Skyclave", { cardType: "land", subtypes: [] }, "Land"],
    ["KHM #15 Halvar's Sword of the Realms", { cardType: "artifact", supertype: "Legendary", subtypes: ["Equipment"] }, "Equipment"],
    ["KHM #179 Tergrid's Lantern (no subtype)", { cardType: "artifact", supertype: "Legendary", subtypes: [] }, "Artifact"],
    ["KHM #114 Tibalt, Cosmic Impostor", { cardType: "planeswalker", supertype: "Legendary", subtypes: ["Tibalt"] }, "Tibalt"],
    ["KHM God backs (Kolvori)", { cardType: "creature", supertype: "Legendary", subtypes: ["God"] }, "God"],
    ["ZNR #134 Akoum Warrior", { cardType: "creature", subtypes: ["Minotaur", "Warrior"] }, "Warrior"],
    ["STX #147 Augmenter Pugilist // Echoing Equation's druid", { cardType: "creature", subtypes: ["Troll", "Druid"] }, "Druid"],
    ["MH3 #246 a 2024 creature face", { cardType: "creature", subtypes: ["Human", "Monk"] }, "Monk"],
    ["a sorcery front", { cardType: "sorcery", subtypes: [] }, "Sorcery"],
    ["an instant front", { cardType: "instant", subtypes: [] }, "Instant"],
    ["a token face", { cardType: "token", supertype: "Creature", subtypes: ["Soldier"] }, "Soldier"],
    ["a bare token", { cardType: "token", subtypes: [] }, "Token"],
  ] as const)("%s → %s", (_label, face, word) => {
    expect(typeWordOf(face as never)).toBe(word);
  });

  it("no type line at all → null; whitespace in subtypes is ignored", () => {
    expect(typeWordOf({ cardType: null, supertype: null, subtypes: [] })).toBeNull();
    expect(typeWordOf({})).toBeNull();
    expect(typeWordOf({ cardType: "creature", subtypes: ["Human ", " Warrior"] })).toBe("Warrior");
  });

  it("the line: the cost; a land's MANA ability (its first `{T}: Add` line, wherever it prints — not the first printed line); else nothing", () => {
    expect(manaLineOf({ cost: "{3}{B}", cardType: "artifact" })).toBe("{3}{B}");
    expect(manaLineOf({ cost: "  {2}{G}  ", cardType: "sorcery" })).toBe("{2}{G}");
    // ZNR #12's back prints "As Emeria … enters" first; the strip reads the mana line.
    expect(manaLineOf({ cardType: "land", rulesText: "As Emeria, Shattered Skyclave enters, you may pay 3 life. If you don't, it enters tapped.\n{T}: Add {W}." })).toBe("{T}: Add {W}.");
    // The production land back: the reminder line first, the ability second.
    expect(manaLineOf({ cardType: "land", rulesText: "(Transforms from Ojer Taq, Deepest Foundation.)\n{T}: Add {W}.\n{2}{W}, {T}: Transform it." })).toBe("{T}: Add {W}.");
    expect(manaLineOf({ cardType: "land", rulesText: "{T}: Add {C}.\n{T}: Add {R} or {G}." })).toBe("{T}: Add {C}.");
    expect(manaLineOf({ cardType: "land", rulesText: "{t}: add one mana of any color." })).toBe("{t}: add one mana of any color.");
    // A land with a cost (an artifact land printing's crafted cost) prints the cost.
    expect(manaLineOf({ cost: "{1}", cardType: "land", rulesText: "{T}: Add {W}." })).toBe("{1}");
    // A land without a mana ability, a creature without a cost: nothing.
    expect(manaLineOf({ cardType: "land", rulesText: "Agadeem enters tapped." })).toBeNull();
    expect(manaLineOf({ cardType: "land", rulesText: "{T}, Sacrifice: Add {W}." })).toBeNull();
    expect(manaLineOf({ cardType: "creature", rulesText: "{T}: Add {G}." })).toBeNull();
    expect(manaLineOf({ cost: "", cardType: "creature" })).toBeNull();
    expect(manaLineOf({})).toBeNull();
  });

  it("the other face's block: printsPt follows the plate rule (a land back prints none; a vehicle prints by its subtype)", () => {
    expect(otherFaceOf({ cardType: "creature", power: "6", toughness: "5" })).toEqual({ typeWord: "Creature", line: null, printsPt: true, power: "6", toughness: "5", stripKey: "c" });
    expect(otherFaceOf({ cardType: "land", rulesText: "{T}: Add {W}." })).toEqual({ typeWord: "Land", line: "{T}: Add {W}.", printsPt: false, power: null, toughness: null, stripKey: "l" });
    expect(otherFaceOf({ cardType: "artifact", subtypes: ["Vehicle"], cost: "{3}", power: "4", toughness: "4" })).toEqual({ typeWord: "Vehicle", line: "{3}", printsPt: true, power: "4", toughness: "4", stripKey: "c" });
    // A P/T on a face whose type shows none is not printed (the tab stays empty, Q7).
    expect(otherFaceOf({ cardType: "sorcery", power: "1", toughness: "1" }).printsPt).toBe(false);
  });
});
