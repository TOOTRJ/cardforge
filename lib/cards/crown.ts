// ---------------------------------------------------------------------------
// The legendary crown (TODO 4.6a; design 2026-09-29 §1.1) — the questions
// the creator, the admin compare page and the tests ask about one card's
// crown, answered by the ONE overlay rule both renderers draw with
// (lib/cards/anatomy.ts resolveFrameOverlays). The band itself is
// M15_CROWN in lib/cards/template-layout.ts, declared on the m15,
// m15artifact and m15land PROFILES entries only.
//
// The crown is an ADDITION (owner rule 2026-09-29, docs/FRAMES.md
// "Additions vs corrections"): drawn only when the card's switch
// (FrameStyle.crown) is exactly `true`, the supertype has the word
// Legendary, the card type prints one (not a planeswalker, token, battle or
// emblem) and the template draws it. Its key is the pinline of the master
// actually drawn: the colour; gold "m" for three or more colours or a pair
// drawn gold; the pair itself where the two-colour frame is drawn (4.6b);
// the colourless grey "c" on m15, the artifact silver "a" on m15artifact,
// the land grey "l" on m15land.
//
// On the borderless frames (4.6f, wave 2a) the crown is not a band but baked
// into the masters' crowned twins (`<key>-legendary`, FrameProfile.
// crownMasters): crownKeyFor names the twin's key there (the colour, or the
// pair where the two-colour frame is drawn), and crownOverlayFor is null.
//
// Pure and client-safe.
// ---------------------------------------------------------------------------

import { pickFrameColorKey } from "@/components/cards/frame-layer";
import {
  crownKeyOf,
  resolveFrameOverlays,
  type AnatomyFacts,
  type FrameAnatomyStyle,
  type ResolvedFrameOverlay,
} from "@/lib/cards/anatomy";
import type { FrameProfile } from "@/lib/cards/template-layout";
import type { ColorIdentity, FrameTemplate } from "@/types/card";

/** The card facts the crown depends on — a CardPreviewData or a form's
 *  values, reshaped. */
export type CrownCard = {
  colorIdentity: readonly ColorIdentity[] | null | undefined;
  cost?: string | null;
  cardType?: string | null;
  supertype?: string | null;
  frameStyle?: FrameAnatomyStyle | null;
};

type CrownProfile = Pick<FrameProfile, "overlays" | "twoColorMasters" | "twoColorForLands" | "crownMasters">;

function factsOf(card: CrownCard): AnatomyFacts & { colorKey: string } {
  return {
    colors: card.colorIdentity,
    cost: card.cost ?? null,
    cardType: card.cardType ?? null,
    supertype: card.supertype ?? null,
    colorKey: pickFrameColorKey(card.colorIdentity ?? undefined),
  };
}

/** The crown OVERLAY band `card` draws on `profile` (M15_CROWN's), or null —
 *  none on a profile whose crown is baked into its masters (4.6f:
 *  crownKeyFor still names it). */
export function crownOverlayFor(card: CrownCard, profile: CrownProfile): ResolvedFrameOverlay | null {
  return resolveFrameOverlays(profile, card.frameStyle, factsOf(card)).find((o) => o.anatomy === "crown") ?? null;
}

/** True when `card` draws the legendary crown on `profile` — as the overlay
 *  band or baked into its crowned master. */
export function showsCrown(card: CrownCard, profile: CrownProfile): boolean {
  return crownKeyFor(card, profile) !== null;
}

/** The crown key `card` draws on `profile` ("w", "m", "a", "l", "wu" … — the
 *  band's key, or the crowned master's colour or pair), or null when it
 *  draws none (lib/cards/anatomy.ts crownKeyOf). */
export function crownKeyFor(card: CrownCard, profile: CrownProfile): string | null {
  return crownKeyOf(profile, card.frameStyle, factsOf(card));
}

/** A crowned print the crown is judged against (the admin compare page's
 *  "Legendary" toggle, the PR's print sheet). Printing data only — no scan
 *  is kept (docs/FRAMES.md "Provenance and legal"). */
export type CrownReference = {
  name: string;
  set: string;
  collectorNumber: string;
  scryfallId: string;
};

const ref = (name: string, set: string, collectorNumber: string, scryfallId: string): CrownReference => ({
  name,
  set,
  collectorNumber,
  scryfallId,
});

/**
 * The crowned prints per crowned template × frame colour key (design
 * 2026-09-29 §1.1 "Crown key"): FDN's WotC digital renders for absolute
 * registration (pixel-identical across the set), the NEO lands, UMA's
 * colourless crowns. A key with no crowned print on that frame has none.
 */
export const CROWN_REFERENCES: Partial<Record<FrameTemplate, Partial<Record<string, CrownReference>>>> = {
  m15: {
    w: ref("Arahbo, the First Fang", "fdn", "2", "524a5d93-26ed-436d-a437-dc9460acce98"),
    u: ref("Kiora, the Rising Tide", "fdn", "45", "83f20a32-9f5d-4a68-8995-549e57554da2"),
    b: ref("Tinybones, Bauble Burglar", "fdn", "72", "ff3d85bc-ef2d-4251-baf4-a14bd0cee61e"),
    r: ref("Kellan, Planar Trailblazer", "fdn", "91", "f46a9329-7b91-441d-8653-50c1152c9120"),
    g: ref("Loot, Exuberant Explorer", "fdn", "106", "09980ce6-425b-4e03-94d0-0f02043cb361"),
    m: ref("Muldrotha, the Gravetide", "fdn", "243", "51710b19-68e3-4853-901f-e618bde61161"),
    c: ref("Kozilek, Butcher of Truth", "uma", "6", "6d47a1c7-d32b-425a-b15d-24eb35318f6f"),
  },
  m15artifact: {
    u: ref("The Reality Chip", "neo", "74", "d859de3a-0be1-4e66-b438-1c3d4ee756cd"),
    r: ref("Chandra's Regulator", "m20", "131", "8f1b1d5c-f71e-4c68-8baf-c134e42ed6f2"),
    c: ref("Pyromancer's Goggles", "fdn", "677", "f340d8a4-196a-4433-807c-b7124e96e44f"),
  },
  m15land: {
    w: ref("Eiganjo, Seat of the Empire", "neo", "268", "c375a022-5b57-496d-a802-e4ea8376e9e4"),
    u: ref("Otawara, Soaring City", "neo", "271", "486d7edc-d983-41f0-8b78-c99aecd72996"),
    b: ref("Takenuma, Abandoned Mire", "neo", "278", "499037cc-a577-41cb-8ca2-5e117945634f"),
    r: ref("Sokenzan, Crucible of Defiance", "neo", "276", "aa548dcd-c1dd-492d-a69f-c65dfeef0633"),
    g: ref("Boseiju, Who Endures", "neo", "266", "2135ac5a-187b-4dc9-8f82-34e8d1603416"),
    c: ref("Dark Depths", "uma", "241", "e00d16f9-ea27-4aa3-a134-4e04f934d020"),
  },
  // The borderless floating crown (TODO 4.6f, wave 2a): FDN's digital
  // renders for the five colours; a three-colour gold crown (2XM #354); the
  // colourless Eldrazi crown on the see-through frame (2X2 #336).
  m15borderless: {
    w: ref("Arahbo, the First Fang", "fdn", "294", "813a39af-bafe-4a38-a270-39a0ce0f4aa5"),
    u: ref("Kiora, the Rising Tide", "fdn", "309", "5a123794-096f-4d01-bfd4-1d23f22608f7"),
    b: ref("Tinybones, Bauble Burglar", "fdn", "324", "daf8d5d4-b52d-42c7-aa56-c104a539133c"),
    r: ref("Kellan, Planar Trailblazer", "fdn", "330", "0e413f37-b59a-4302-86d3-2abce81edc78"),
    g: ref("Loot, Exuberant Explorer", "fdn", "336", "73ce9555-a687-4a37-864c-eb59b1e80a8f"),
    m: ref("Kaalia of the Vast", "2xm", "354", "86f670f9-c5b7-4eb0-a7d0-d16513fadf74"),
    c: ref("Kozilek, Butcher of Truth", "2x2", "336", "64b4b6cd-6d0f-4060-b51f-61f481000d51"),
  },
  // The extended-art floating crown (TODO 4.6f, wave 2b): FDN's digital
  // renders for the five colours, a three-colour gold crown (M21 #278) and
  // the colourless Eldrazi crown of the Ultimate Masters box toppers
  // (PUMA U1).
  extendedart: {
    w: ref("Arahbo, the First Fang", "fdn", "442", "52605015-ba08-4427-8c06-b47ecd603b27"),
    u: ref("Kiora, the Rising Tide", "fdn", "455", "6b137e8d-3537-454d-8d6b-24d2a6d81993"),
    b: ref("Tinybones, Bauble Burglar", "fdn", "463", "f01d5f4b-a780-4a89-82b1-84d4f3b62a7b"),
    r: ref("Kellan, Planar Trailblazer", "fdn", "466", "64e35fbe-55b7-40c8-b24b-2d9d933bcdaa"),
    g: ref("Loot, Exuberant Explorer", "fdn", "470", "b6671b19-28d3-4d67-a8fa-83e4f6596c68"),
    m: ref("Rin and Seri, Inseparable", "m21", "278", "d605c780-a42a-4816-8fb9-63e3114a8246"),
    c: ref("Emrakul, the Aeons Torn", "puma", "U1", "38cd438d-be12-40aa-bd6c-be55e88b63ce"),
  },
  // The artifact dress: a crowned borderless artifact per colour where one
  // was printed; its colourless crown is CC's artifact crown (2XM #362).
  m15borderlessartifact: {
    w: ref("Rammas Echor, Ancient Shield", "ltc", "505", "558c1fcc-cb01-4031-ada5-4e39d65aee27"),
    u: ref("The Water Crystal", "fin", "333", "7572888a-c394-4d9f-b66f-30d91364d265"),
    b: ref("The Last Ride", "dft", "308", "f2d563b1-f03b-4ce3-9de0-05dab257b67c"),
    r: ref("The Fire Crystal", "fin", "337", "58306c68-5de8-48f4-9ce5-ea69792af58c"),
    g: ref("The Skullspore Nexus", "lci", "340", "85c4b837-1557-4dda-a324-9646ce702dfd"),
    m: ref("Breya, Etherium Shaper", "mh3", "372", "468e5d5a-01cc-4d01-88fb-ab556e2383cb"),
    c: ref("Mox Opal", "2xm", "362", "547e3aa5-d88a-4418-ab9d-dd65385f031b"),
  },
};

/** The crowned print for a template × frame colour key, or null. */
export function crownReferenceFor(template: FrameTemplate, colorKey: string): CrownReference | null {
  return CROWN_REFERENCES[template]?.[colorKey] ?? null;
}
