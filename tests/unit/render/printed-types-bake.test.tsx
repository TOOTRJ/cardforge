import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { CardPreviewData } from "@/components/cards/card-preview";
import { renderCardImage } from "@/lib/render/card-image";

// ---------------------------------------------------------------------------
// The Types field on REAL bakes (TODO 3b.16): a card with no typed line
// bakes the bytes it always did; a typed line prints as typed — its order,
// with or without the card type's word, "" included — and what the card IS
// (its P/T) does not follow the printed words. On the 1993 frame, whose
// masters are in git (public/frames/agclassic): offline and deterministic.
// ---------------------------------------------------------------------------

function card(over: Partial<CardPreviewData> = {}): CardPreviewData {
  return {
    title: "Probe Goblin",
    // A generic cost: the 1993 colour pips are bucket images (never git).
    cost: "{2}",
    cardType: "creature",
    supertype: "Goblin",
    subtypes: ["Wizard"],
    rarity: "common",
    colorIdentity: ["red"],
    rulesText: "Haste",
    flavorText: null,
    power: "2",
    toughness: "1",
    loyalty: null,
    defense: null,
    artistCredit: "Probe",
    artUrl: null,
    artPosition: {},
    frameStyle: { template: "agclassic", finish: "regular" },
    setIconUrl: null,
    setIconCode: null,
    backFace: null,
    faceContent: null,
    watermark: null,
    ...over,
  } as CardPreviewData;
}

async function bake(data: CardPreviewData): Promise<string> {
  const res = await renderCardImage(data, "default", { brandMark: false, watermarkText: null });
  return createHash("sha256").update(Buffer.from(await res.arrayBuffer())).digest("hex");
}

describe("cards.printed_types on a real bake", () => {
  it("no typed line (absent, undefined, null) is one bake — the stored cards'", async () => {
    const stored = await bake(card());
    expect(await bake(card({ printedTypes: undefined }))).toBe(stored);
    expect(await bake(card({ printedTypes: null }))).toBe(stored);
  }, 120_000);

  it("a typed line that reads as the built one is the same picture; another order is another picture", async () => {
    const built = await bake(card()); // "Goblin Creature — Wizard"
    expect(await bake(card({ printedTypes: "Goblin Creature" }))).toBe(built);
    expect(await bake(card({ printedTypes: "Creature Goblin" }))).not.toBe(built);
  }, 120_000);

  it("“Creature” removed prints the words left — exactly a line that never had it — and the P/T stays", async () => {
    // The same printed line from a card with no card type's word to add: an
    // instant-less stand-in is not possible, so compare with the built line
    // of the same creature whose ONLY difference is the word.
    const without = await bake(card({ printedTypes: "Goblin" }));
    expect(without).not.toBe(await bake(card()));
    // The P/T is still drawn: removing it changes the picture.
    expect(await bake(card({ printedTypes: "Goblin", power: null, toughness: null }))).not.toBe(without);
  }, 120_000);

  it("an emptied field bakes: the subtypes alone, or an empty type bar — never the “Type” placeholder", async () => {
    const subtypesOnly = await bake(card({ printedTypes: "" }));
    // "Wizard" alone is what a typed "Wizard" with no subtypes prints.
    expect(await bake(card({ printedTypes: "Wizard", subtypes: [] }))).toBe(subtypesOnly);
    const nothing = await bake(card({ printedTypes: "", subtypes: [] }));
    expect(nothing).not.toBe(subtypesOnly);
    expect(nothing).not.toBe(await bake(card({ printedTypes: "Type", subtypes: [] })));
  }, 120_000);
});
