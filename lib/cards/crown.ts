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
  // The snow frame (TODO 4.6f, wave 2c): the twelve crowned snow printings
  // are three KHM pairs (U|B, G|U, R|G — the m key's references, and the
  // pair bands'), two mono blues (J22 #12 Isu, #319 Marit Lage's Slumber),
  // two mono greens (PH19 #5 Myntasha, KHM #179 Jorn — an MDFC), three
  // List reprints and one land (below); no w, b, r or artifact snow crown
  // was ever printed, so those keys have none.
  m15snow: {
    u: ref("Isu the Abominable", "j22", "12", "1e1d50c3-3219-49cb-8f63-c1faff93215c"),
    g: ref("Myntasha, Honored One", "ph19", "5", "d7e57d2f-141f-461a-8f5a-4cec3020442e"),
    m: ref("Narfi, Betrayer King", "khm", "224", "421376e4-a4ad-427c-bc9c-d315308dcf68"),
  },
  // The snow land: DMR #244 Dark Depths, the only crowned snow-frame land
  // (colourless, so the land grey "l" crown over the snow land bars).
  m15snowland: {
    c: ref("Dark Depths", "dmr", "244", "3a8b11ad-d077-40b6-988c-0462e118fe3d"),
  },
  // The artifact dress: a crowned borderless artifact per colour where one
  // was printed; its colourless crown is CC's artifact crown (2XM #362).
  // The double-faced bodies (TODO 5.1d): a crowned printing per face per
  // colour where one exists on the plain 2015 frame (Scryfall, 2026-10-05:
  // every transform / modal printing with the `legendary` effect on the
  // black-bordered 2015 frame, no showcase — scratchpad dfc-1d/research/
  // classified.json). The transform FRONT in every colour and pair; the
  // 2016–22 back (MID / VOW / BOT) in w u b r m and two pairs — no g, no a;
  // the ▼ back (MOM / FIN / ECL / LCC) in every colour, a and two pairs; the
  // transform land front SLX #9 Havengul Laboratory (a colourless legendary
  // land front: the `l` crown through the entry's keyMap); the modal front
  // (the KHM gods, STX's deans, MSH) in the five colours and two pairs; the
  // modal back in the five colours, gold (KHM #168 The Prismatic Bridge)
  // and five pairs (MSH's heroes). A back body's reference is the
  // printing's BACK face (faceUnderTest). No crowned print exists for the
  // ▼ land back or the modal land pair on this frame (LCI's and XLN's
  // legendary land backs are the parchment back, SLX #9's back the 2016–22
  // one), so those entries draw no crown.
  m15dfcfront: {
    w: ref("Katilda, Dawnhart Martyr", "vow", "21", "0ef240aa-2a88-4ec4-888a-918466372adb"),
    u: ref("Jacob Hauken, Inspector", "vow", "65", "6b4529c3-8edb-4909-b910-806450a39d2e"),
    b: ref("Jerren, Corrupted Bishop", "mid", "109", "0f6e668d-2502-4e82-b4c2-ef34c9afa27e"),
    r: ref("Etali, Primal Conqueror", "mom", "137", "95c14c4d-6c16-4826-8d93-d89ad04aee09"),
    g: ref("Polukranos Reborn", "mom", "200", "47f7d313-8333-41fe-8bfa-c96774dac228"),
    m: ref("Kefka, Court Mage", "fin", "231", "8fcf3fbb-1ddd-437e-81c1-f5a3133f5ee8"),
    a: ref("Matzalantli, the Great Door", "lci", "256", "b4c31b29-06ba-436d-a3d9-18f4796c39be"),
    rg: ref("Tovolar, Dire Overlord", "mid", "246", "f953fad3-0cd1-48aa-8ed9-d7d2e293e6e2"),
    wu: ref("Dennick, Pious Apprentice", "mid", "217", "35cf2d72-931f-47b1-a1b4-916f0383551a"),
    wb: ref("Edgar, Charmed Groom", "vow", "236", "63ba8eef-b834-4031-b0a1-0f8505d53813"),
    br: ref("Garland, Knight of Cornelia", "fin", "221", "dd463dbe-5f2c-4d4f-86f8-ad8ff407af62"),
    ub: ref("Ludevic, Necrogenius", "mid", "233", "788288f6-7944-48f4-91b0-f452e209c9ce"),
    rw: ref("Arcee, Sharpshooter", "bot", "7", "21462db4-7739-4853-845f-0c2aa38fd2a6"),
    ur: ref("The Emperor of Palamecia", "fin", "219", "3d75e8fd-6139-4b10-9ce3-195b47d72e0c"),
    bg: ref("Exdeath, Void Warlock", "fin", "220", "1b4bab87-4000-461d-8b58-d34928fee305"),
    gw: ref("Serah Farron", "fin", "240", "62fa74c0-43ae-445c-8039-ca9d00e9709a"),
  },
  m15dfcbackleft: {
    w: ref("Katilda's Rising Dawn", "vow", "21", "0ef240aa-2a88-4ec4-888a-918466372adb"),
    u: ref("Hauken's Insight", "vow", "65", "6b4529c3-8edb-4909-b910-806450a39d2e"),
    b: ref("Ormendahl, the Corrupter", "mid", "109", "0f6e668d-2502-4e82-b4c2-ef34c9afa27e"),
    r: ref("Slicer, High-Speed Antagonist", "bot", "6", "9d9a9350-4734-4cc1-986d-467e6715199f"),
    m: ref("Megatron, Destructive Force", "bot", "12", "ac6ded62-7bf2-476f-ad8e-020da6327c6b"),
    rg: ref("Tovolar, the Midnight Scourge", "mid", "246", "f953fad3-0cd1-48aa-8ed9-d7d2e293e6e2"),
    ub: ref("Olag, Ludevic's Hubris", "mid", "233", "788288f6-7944-48f4-91b0-f452e209c9ce"),
  },
  m15dfcback: {
    w: ref("Hydaelyn, the Mothercrystal", "fin", "39", "2625c00d-0a51-4481-bf36-cf13a2546242"),
    u: ref("Caetus, Sea Tyrant of Segovia", "mom", "63", "9df3e743-7bb8-482a-afd1-4d51119d416c"),
    b: ref("Marchesa, Resolute Monarch", "mom", "114", "b3af679b-6ee6-4a1d-8ec3-b659bdd90b4a"),
    r: ref("Grub, Notorious Auntie", "ecl", "105", "1f51adf8-8234-4dae-aedf-7633310d5111"),
    g: ref("Zilortha, Apex of Ikoria", "mom", "190", "5d59c8f2-f6af-40a6-8dfe-8cc45bf231ce"),
    m: ref("Kefka, Ruler of Ruin", "fin", "231", "8fcf3fbb-1ddd-437e-81c1-f5a3133f5ee8"),
    a: ref("Balamb Garden, Airborne", "fin", "272", "001e9f20-5b15-41cb-bf82-46172decc235"),
    gw: ref("Polukranos, Engine of Ruin", "mom", "200", "47f7d313-8333-41fe-8bfa-c96774dac228"),
    ub: ref("Rona, Tolarian Obliterator", "mom", "75", "f487b582-e73f-4325-939f-95fc5a9aba49"),
  },
  m15dfclandfront: {
    c: ref("Havengul Laboratory", "slx", "9", "823b019e-10c0-4712-8167-d4f37a71e782"),
  },
  m15mdfcfront: {
    w: ref("Halvar, God of Battle", "khm", "15", "97502411-5c93-434c-b77b-ceb2c32feae7"),
    u: ref("Alrund, God of the Cosmos", "khm", "40", "5d131784-c1a3-463e-a37b-b720af67ab62"),
    b: ref("Tergrid, God of Fright", "khm", "112", "14dc88ee-bba9-4625-af0d-89f3762a0ead"),
    r: ref("Birgi, God of Storytelling", "khm", "123", "44657ab1-0a6a-4a5f-9688-86f239083821"),
    g: ref("Esika, God of the Tree", "khm", "168", "f6cd7465-9dd0-473c-ac5e-dd9e2f22f5f6"),
    wu: ref("King T'Challa", "msh", "219", "add7d3ce-aa58-4da0-8c2a-cfd01c3a8975"),
    wb: ref("Extus, Oriq Overlord", "stx", "149", "ba09360a-067e-48a5-bdc5-a19fd066a785"),
  },
  m15mdfcback: {
    w: ref("Sword of the Realms", "khm", "15", "97502411-5c93-434c-b77b-ceb2c32feae7"),
    u: ref("Hakka, Whispering Raven", "khm", "40", "5d131784-c1a3-463e-a37b-b720af67ab62"),
    b: ref("Tergrid's Lantern", "khm", "112", "14dc88ee-bba9-4625-af0d-89f3762a0ead"),
    r: ref("Harnfel, Horn of Bounty", "khm", "123", "44657ab1-0a6a-4a5f-9688-86f239083821"),
    g: ref("The Ringhart Crest", "khm", "181", "b76bed98-30b1-4572-b36c-684ada06826c"),
    m: ref("The Prismatic Bridge", "khm", "168", "f6cd7465-9dd0-473c-ac5e-dd9e2f22f5f6"),
    wu: ref("Black Panther, Hope Enduring", "msh", "219", "add7d3ce-aa58-4da0-8c2a-cfd01c3a8975"),
    rw: ref("Photon, Living Light", "msh", "23", "3f995518-b12a-4623-9ab3-b79a5cef3cba"),
    rg: ref("The Incredible Hulk", "msh", "49", "e0dbbdcf-84e1-494f-8b8c-0a094f603fa9"),
    ur: ref("The Invincible Iron Man", "msh", "80", "4cea42fd-035e-4b8f-8b1d-ff363b694f14"),
    gw: ref("The Sensational She-Hulk", "msh", "18", "61237530-ad49-469c-a952-67c92315708e"),
  },
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
