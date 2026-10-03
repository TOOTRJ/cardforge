import type { ScryfallCard } from "@/lib/scryfall/client";

// ---------------------------------------------------------------------------
// Scryfall-shaped double-faced printings for the per-face admin tools (TODO
// 5.0b) — the SOURCES of production's imported double-faced cards (the nine
// `back_face` rows of tests/unit/cards/fixtures/dfc-legacy-backs.json: 8
// DFCs + 1 adventure), in the shapes Scryfall serves them: `image_uris` on
// each face (never at the top level), per-face `colors`, a `color_indicator`
// on a back of another colour, a colourless artifact back with a cost, a
// planeswalker back, a land back whose colour is its mana ability, a
// colourless Avatar back. The ids are stand-ins; the content is the
// printing's.
// ---------------------------------------------------------------------------

const PNG = (id: string, face: "front" | "back") =>
  `https://cards.scryfall.io/png/${face}/${id[0]}/${id[1]}/${id}.png`;
const ART = (id: string, face: "front" | "back") =>
  `https://cards.scryfall.io/art_crop/${face}/${id[0]}/${id[1]}/${id}.jpg`;

const faceImages = (id: string, face: "front" | "back") => ({
  png: PNG(id, face),
  normal: `https://cards.scryfall.io/normal/${face}/${id[0]}/${id[1]}/${id}.jpg`,
  art_crop: ART(id, face),
});

/** Archangel Avacyn // Avacyn, the Purifier (SOI #5) — the source of
 *  Titânia's and Erza Scarlet's backs: a white front, a RED back (colour
 *  indicator), both faces scanned. */
export const ARCHANGEL_AVACYN_ID = "a1a1a1a1-0001-4001-8001-000000000001";
export const archangelAvacyn = {
  id: ARCHANGEL_AVACYN_ID,
  name: "Archangel Avacyn // Avacyn, the Purifier",
  layout: "transform",
  set: "soi",
  collector_number: "5",
  rarity: "mythic",
  frame: "2015",
  frame_effects: ["sunmoondfc"],
  color_identity: ["R", "W"],
  image_status: "highres_scan",
  scryfall_uri: "https://scryfall.com/card/soi/5/archangel-avacyn-avacyn-the-purifier",
  card_faces: [
    {
      name: "Archangel Avacyn",
      mana_cost: "{3}{W}{W}",
      type_line: "Legendary Creature — Angel",
      oracle_text:
        "Flash\nFlying, vigilance\nWhen Archangel Avacyn enters, creatures you control gain indestructible until end of turn.\nWhen a non-Angel creature you control dies, transform Archangel Avacyn at the beginning of the next upkeep.",
      colors: ["W"],
      power: "4",
      toughness: "4",
      artist: "James Ryman",
      image_uris: faceImages(ARCHANGEL_AVACYN_ID, "front"),
    },
    {
      name: "Avacyn, the Purifier",
      mana_cost: "",
      type_line: "Legendary Creature — Angel",
      oracle_text:
        "Flying\nWhen this creature transforms into Avacyn, the Purifier, it deals 3 damage to each other creature and each opponent.",
      colors: ["R"],
      color_indicator: ["R"],
      power: "6",
      toughness: "5",
      artist: "James Ryman",
      image_uris: faceImages(ARCHANGEL_AVACYN_ID, "back"),
    },
  ],
} as unknown as ScryfallCard;

/** Tergrid, God of Fright // Tergrid's Lantern (KHM #110) — Darth Vader's
 *  and Sung Jin-Woo's back: a black front, a COLOURLESS artifact back with
 *  a cost. */
export const TERGRID_ID = "b2b2b2b2-0002-4002-8002-000000000002";
export const tergrid = {
  id: TERGRID_ID,
  name: "Tergrid, God of Fright // Tergrid's Lantern",
  layout: "modal_dfc",
  set: "khm",
  collector_number: "110",
  rarity: "rare",
  frame: "2015",
  frame_effects: ["mooneldrazidfc"],
  color_identity: ["B"],
  image_status: "highres_scan",
  card_faces: [
    {
      name: "Tergrid, God of Fright",
      mana_cost: "{3}{B}{B}",
      type_line: "Legendary Creature — God",
      oracle_text:
        "Menace\nWhenever an opponent sacrifices a nontoken permanent or discards a permanent card, you may put that card from a graveyard onto the battlefield under your control.",
      colors: ["B"],
      power: "4",
      toughness: "5",
      artist: "Yongjae Choi",
      image_uris: faceImages(TERGRID_ID, "front"),
    },
    {
      name: "Tergrid's Lantern",
      mana_cost: "{3}{B}",
      type_line: "Legendary Artifact",
      oracle_text:
        "{T}: Target player loses 3 life unless they sacrifice a nonland permanent or discard a card.\n{3}{B}: Untap Tergrid's Lantern.",
      colors: [],
      artist: "Yongjae Choi",
      image_uris: faceImages(TERGRID_ID, "back"),
    },
  ],
} as unknown as ScryfallCard;

/** Valki, God of Lies // Tibalt, Cosmic Impostor (KHM #114) — Chrollo's
 *  back: a PLANESWALKER back with a two-colour cost. */
export const VALKI_ID = "c3c3c3c3-0003-4003-8003-000000000003";
export const valki = {
  id: VALKI_ID,
  name: "Valki, God of Lies // Tibalt, Cosmic Impostor",
  layout: "modal_dfc",
  set: "khm",
  collector_number: "114",
  rarity: "mythic",
  frame: "2015",
  color_identity: ["B", "R"],
  image_status: "highres_scan",
  card_faces: [
    {
      name: "Valki, God of Lies",
      mana_cost: "{1}{B}",
      type_line: "Legendary Creature — God",
      oracle_text:
        "When Valki, God of Lies enters, each opponent reveals their hand. For each opponent, exile a creature card they revealed this way until Valki leaves the battlefield.",
      colors: ["B"],
      power: "2",
      toughness: "1",
      artist: "Yongjae Choi",
      image_uris: faceImages(VALKI_ID, "front"),
    },
    {
      name: "Tibalt, Cosmic Impostor",
      mana_cost: "{5}{B}{R}",
      type_line: "Legendary Planeswalker — Tibalt",
      oracle_text:
        "As Tibalt, Cosmic Impostor enters, you get an emblem with \"You may play cards exiled with Tibalt, Cosmic Impostor.\"\n+2: Exile the top card of each player's library.\n−3: Exile target artifact or creature.\n−8: Exile all cards from all opponents' graveyards.",
      colors: ["B", "R"],
      loyalty: "5",
      artist: "Yongjae Choi",
      image_uris: faceImages(VALKI_ID, "back"),
    },
  ],
} as unknown as ScryfallCard;

/** Agadeem's Awakening // Agadeem, the Undercrypt (ZNR #90) — ARISE!'s
 *  back: a LAND back, coloured by its mana ability. */
export const AGADEEM_ID = "d4d4d4d4-0004-4004-8004-000000000004";
export const agadeem = {
  id: AGADEEM_ID,
  name: "Agadeem's Awakening // Agadeem, the Undercrypt",
  layout: "modal_dfc",
  set: "znr",
  collector_number: "90",
  rarity: "mythic",
  frame: "2015",
  color_identity: ["B"],
  image_status: "highres_scan",
  card_faces: [
    {
      name: "Agadeem's Awakening",
      mana_cost: "{X}{B}{B}{B}",
      type_line: "Sorcery",
      oracle_text:
        "Return from your graveyard to the battlefield any number of target creature cards that each have a different mana value X or less.",
      colors: ["B"],
      artist: "Alayna Danner",
      image_uris: faceImages(AGADEEM_ID, "front"),
    },
    {
      name: "Agadeem, the Undercrypt",
      mana_cost: "",
      type_line: "Land",
      oracle_text:
        "As Agadeem, the Undercrypt enters, you may pay 3 life. If you don't, it enters tapped.\n{T}: Add {B}.",
      colors: [],
      artist: "Alayna Danner",
      image_uris: faceImages(AGADEEM_ID, "back"),
    },
  ],
} as unknown as ScryfallCard;

/** Aang, Hope's Avatar // Aang, Master of Elements (TLA) — Avatar Aang's
 *  back: a five-colour front, a COLOURLESS creature back (no Artifact
 *  word). */
export const AANG_ID = "e5e5e5e5-0005-4005-8005-000000000005";
export const aang = {
  id: AANG_ID,
  name: "Aang, Hope's Avatar // Aang, Master of Elements",
  layout: "transform",
  set: "tla",
  collector_number: "203",
  rarity: "mythic",
  frame: "2015",
  frame_effects: ["convertdfc"],
  color_identity: ["B", "G", "R", "U", "W"],
  image_status: "highres_scan",
  card_faces: [
    {
      name: "Aang, Hope's Avatar",
      mana_cost: "{W}{U}{B}{R}{G}",
      type_line: "Legendary Creature — Human Avatar",
      oracle_text: "Flying\nWhen this creature enters, you may transform it.",
      colors: ["W", "U", "B", "R", "G"],
      power: "4",
      toughness: "4",
      artist: "Jesper Ejsing",
      image_uris: faceImages(AANG_ID, "front"),
    },
    {
      name: "Aang, Master of Elements",
      mana_cost: "",
      type_line: "Legendary Creature — Avatar",
      oracle_text: "Flying, hexproof\nAt the beginning of your upkeep, transform this creature.",
      colors: [],
      power: "6",
      toughness: "6",
      artist: "Jesper Ejsing",
      image_uris: faceImages(AANG_ID, "back"),
    },
  ],
} as unknown as ScryfallCard;

/** Serra Angel (M15 #33 shape): one face, images at the top level. */
export const SERRA_ANGEL_ID = "f6f6f6f6-0006-4006-8006-000000000006";
export const serraAngel = {
  id: SERRA_ANGEL_ID,
  name: "Serra Angel",
  layout: "normal",
  set: "m15",
  collector_number: "33",
  rarity: "uncommon",
  frame: "2015",
  type_line: "Creature — Angel",
  mana_cost: "{3}{W}{W}",
  oracle_text: "Flying, vigilance",
  colors: ["W"],
  color_identity: ["W"],
  power: "4",
  toughness: "4",
  artist: "Greg Staples",
  image_status: "highres_scan",
  scryfall_uri: "https://scryfall.com/card/m15/33/serra-angel",
  image_uris: {
    png: PNG(SERRA_ANGEL_ID, "front"),
    normal: `https://cards.scryfall.io/normal/front/${SERRA_ANGEL_ID[0]}/${SERRA_ANGEL_ID[1]}/${SERRA_ANGEL_ID}.jpg`,
    art_crop: ART(SERRA_ANGEL_ID, "front"),
  },
} as unknown as ScryfallCard;

/** Beanstalk Giant // Fertile Footsteps (ELD #165) — the one `back_face`
 *  row that is NOT a DFC: an adventure, one picture, images at the top
 *  level and none on the faces. */
export const BEANSTALK_ID = "a7a7a7a7-0007-4007-8007-000000000007";
export const beanstalkGiant = {
  id: BEANSTALK_ID,
  name: "Beanstalk Giant // Fertile Footsteps",
  layout: "adventure",
  set: "eld",
  collector_number: "165",
  rarity: "uncommon",
  frame: "2015",
  type_line: "Creature — Giant // Sorcery — Adventure",
  colors: ["G"],
  color_identity: ["G"],
  artist: "Jason A. Engle",
  image_status: "highres_scan",
  image_uris: {
    png: PNG(BEANSTALK_ID, "front"),
    normal: `https://cards.scryfall.io/normal/front/${BEANSTALK_ID[0]}/${BEANSTALK_ID[1]}/${BEANSTALK_ID}.jpg`,
  },
  card_faces: [
    {
      name: "Beanstalk Giant",
      mana_cost: "{6}{G}",
      type_line: "Creature — Giant",
      oracle_text: "Beanstalk Giant's power and toughness are each equal to the number of lands you control.",
      power: "*",
      toughness: "*",
    },
    {
      name: "Fertile Footsteps",
      mana_cost: "{2}{G}",
      type_line: "Sorcery — Adventure",
      oracle_text: "Search your library for a basic land card, put it onto the battlefield, then shuffle.",
    },
  ],
} as unknown as ScryfallCard;

/** Every fixture by id, for a stubbed getCardById. */
export const DFC_PRINTINGS: Record<string, ScryfallCard> = Object.fromEntries(
  [archangelAvacyn, tergrid, valki, agadeem, aang, serraAngel, beanstalkGiant].map((card) => [card.id, card]),
);
