import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScryfallCard } from "@/lib/scryfall/client";

// ---------------------------------------------------------------------------
// buildFrameComparePayload — the frame-compare tool's "our render" input,
// built from a real printing at request time (TODO 0.18: the function itself
// with a second face; preview-from-patch.test.ts covers the pure reshape).
// It is what the compare page renders, what the score route scores and what
// the stepper walk-through is seeded with, so it must:
//
//   * carry the SECOND FACE (adventure / split / flip / aftermath draw their
//     other half from it — TODO 0.2), with the template under test pinned;
//   * keep a two-colour printing TWO colours (a split-wing frame draws the
//     scan's two colours; the creator's patch says "multicolor");
//   * point the overlay at the printing's PNG — the front face's for a card
//     whose images live on its faces;
//   * hand back the mapper's patch (the walk-through seed, back face
//     included) and the Scryfall page;
//   * answer null when Scryfall has no such card.
// Only the Scryfall lookup is stubbed; the mapper and the reshape are real.
// ---------------------------------------------------------------------------

const lookup = vi.hoisted(() => ({ card: null as ScryfallCard | null, ids: [] as string[] }));

vi.mock("@/lib/scryfall/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/scryfall/client")>();
  return {
    ...actual,
    getCardById: async (id: string) => {
      lookup.ids.push(id);
      return lookup.card;
    },
  };
});

import { buildFrameComparePayload } from "@/lib/scryfall/reference-preview";

const PNG = (id: string) => `https://cards.scryfall.io/png/front/${id[0]}/${id[1]}/${id}.png`;

// Fire // Ice (DMR #215; the id is a stand-in): a two-colour split card,
// images on the card.
const FIRE_ICE_ID = "2a1a9a4d-3c1b-4ae6-9a0e-7b0a2cf4d0a1";
const fireIce = {
  id: FIRE_ICE_ID,
  name: "Fire // Ice",
  layout: "split",
  set: "dmr",
  collector_number: "215",
  type_line: "Instant // Instant",
  rarity: "uncommon",
  colors: ["U", "R"],
  color_identity: ["R", "U"],
  artist: "David Martin & Franz Vohwinkel",
  scryfall_uri: "https://scryfall.com/card/dmr/215/fire-ice",
  image_status: "highres_scan",
  image_uris: { png: PNG(FIRE_ICE_ID), normal: "https://cards.scryfall.io/normal/x.jpg" },
  card_faces: [
    {
      name: "Fire",
      mana_cost: "{1}{R}",
      type_line: "Instant",
      oracle_text: "Fire deals 2 damage divided as you choose among one or two targets.",
      artist: "David Martin",
    },
    {
      name: "Ice",
      mana_cost: "{1}{U}",
      type_line: "Instant",
      oracle_text: "Tap target permanent.\nDraw a card.",
      artist: "Franz Vohwinkel",
    },
  ],
} as unknown as ScryfallCard;

// Bonecrusher Giant // Stomp (ELD #115): a one-colour adventure.
const BONECRUSHER_ID = "09fd2d9c-1793-4beb-a3fb-7a869f660cd4";
const bonecrusher = {
  id: BONECRUSHER_ID,
  name: "Bonecrusher Giant // Stomp",
  layout: "adventure",
  set: "eld",
  type_line: "Creature — Giant // Instant — Adventure",
  rarity: "rare",
  colors: ["R"],
  color_identity: ["R"],
  artist: "Victor Adame Minguez",
  image_uris: { png: PNG(BONECRUSHER_ID) },
  card_faces: [
    {
      name: "Bonecrusher Giant",
      mana_cost: "{2}{R}",
      type_line: "Creature — Giant",
      oracle_text:
        "Whenever Bonecrusher Giant becomes the target of a spell, Bonecrusher Giant deals 2 damage to that spell's controller.",
      power: "4",
      toughness: "3",
    },
    {
      name: "Stomp",
      mana_cost: "{1}{R}",
      type_line: "Instant — Adventure",
      oracle_text: "Damage can't be prevented this turn. Stomp deals 2 damage to any target.",
    },
  ],
} as unknown as ScryfallCard;

// A transforming battle: Scryfall puts the images on the FACES.
const INVASION_ID = "11798730-6788-4e0b-a828-b46cab1a4fa7";
const invasion = {
  id: INVASION_ID,
  name: "Invasion of Gobakhan // Lightshield Array",
  layout: "transform",
  set: "mom",
  type_line: "Battle — Siege // Enchantment",
  rarity: "rare",
  color_identity: ["W"],
  card_faces: [
    {
      name: "Invasion of Gobakhan",
      mana_cost: "{1}{W}",
      type_line: "Battle — Siege",
      oracle_text: "(As a Siege enters, choose an opponent to protect it.)",
      defense: "3",
      colors: ["W"],
      image_uris: { png: PNG(INVASION_ID), large: "https://cards.scryfall.io/large/front.jpg" },
    },
    {
      name: "Lightshield Array",
      mana_cost: "",
      type_line: "Enchantment",
      oracle_text: "At the beginning of your end step, put a +1/+1 counter on each creature that attacked this turn.",
      colors: ["W"],
      image_uris: { png: "https://cards.scryfall.io/png/back/1/1/back.png" },
    },
  ],
} as unknown as ScryfallCard;

beforeEach(() => {
  lookup.card = null;
  lookup.ids = [];
});

describe("buildFrameComparePayload", () => {
  it("answers null when Scryfall has no such printing", async () => {
    expect(await buildFrameComparePayload(FIRE_ICE_ID, "split")).toBeNull();
    expect(lookup.ids).toEqual([FIRE_ICE_ID]);
  });

  it("carries the second half of a split printing, pinned to the template under test", async () => {
    lookup.card = fireIce;
    const payload = await buildFrameComparePayload(FIRE_ICE_ID, "split");
    if (!payload) throw new Error("no payload");

    expect(payload.preview.frameStyle).toEqual({ template: "split" });
    expect(payload.preview.title).toBe("Fire");
    expect(payload.preview.cost).toBe("{1}{R}");
    expect(payload.preview.rulesText).toContain("divided as you choose");
    // No rehosted art: the scan shows it.
    expect(payload.preview.artUrl).toBeNull();

    const back = payload.preview.backFace;
    expect(back).not.toBeNull();
    expect(back?.title).toBe("Ice");
    expect(back?.cost).toBe("{1}{U}");
    expect(back?.card_type).toBe("instant");
    expect(back?.rules_text).toContain("Draw a card.");
    expect(back?.artist_credit).toBe("Franz Vohwinkel");
    expect(back?.art_url).toBeUndefined();
  });

  it("keeps a two-colour printing two colours, where the creator's patch says multicolor", async () => {
    lookup.card = fireIce;
    const payload = await buildFrameComparePayload(FIRE_ICE_ID, "split");
    expect(payload?.patch.color_identity).toEqual(["multicolor"]);
    expect([...(payload?.preview.colorIdentity ?? [])].sort()).toEqual(["blue", "red"]);
  });

  it("carries an adventure's Stomp half and keeps one colour one colour", async () => {
    lookup.card = bonecrusher;
    const payload = await buildFrameComparePayload(BONECRUSHER_ID, "adventure");
    expect(payload?.preview.frameStyle).toEqual({ template: "adventure" });
    expect(payload?.preview.colorIdentity).toEqual(["red"]);
    expect(payload?.preview.power).toBe("4");
    expect(payload?.preview.backFace?.title).toBe("Stomp");
    expect(payload?.preview.backFace?.subtypes).toEqual(["Adventure"]);
  });

  it("returns the scan, the name, the Scryfall page and the patch the walk-through seeds from", async () => {
    lookup.card = fireIce;
    const payload = await buildFrameComparePayload(FIRE_ICE_ID, "split");
    expect(payload?.scanUrl).toBe(PNG(FIRE_ICE_ID));
    expect(payload?.cardName).toBe("Fire // Ice");
    expect(payload?.scryfallUri).toBe("https://scryfall.com/card/dmr/215/fire-ice");
    // The seed carries the second face too.
    expect(payload?.patch.back_face?.title).toBe("Ice");
    expect(payload?.patch.title).toBe("Fire");
  });

  it("overlays the FRONT face's PNG when the images live on the faces, with no Scryfall page", async () => {
    lookup.card = invasion;
    const payload = await buildFrameComparePayload(INVASION_ID, "battle");
    expect(payload?.scanUrl).toBe(PNG(INVASION_ID));
    expect(payload?.scryfallUri).toBeNull();
    expect(payload?.preview.frameStyle).toEqual({ template: "battle" });
    expect(payload?.preview.defense).toBe("3");
    expect(payload?.preview.backFace?.title).toBe("Lightshield Array");
  });
});
