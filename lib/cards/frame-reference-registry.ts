import type { FrameTemplate } from "@/types/card";

// ---------------------------------------------------------------------------
// Frame reference registry — one REAL printed card per (template, color)
// combination, used by the admin frame-compare tool to verify that every
// frame the site ships renders like the real thing.
//
// Every reference was resolved against the live Scryfall API (2026-07-01)
// and is a `highres_scan` printing. `null` means no real printing exists
// for that combination (e.g. mono-color split cards were never printed in
// the M15 frame) — the combo can still be eyeballed in the tool, just
// without a scan overlay.
//
// M15-era combos are fully researched. Other eras carry the Serra Angel
// anchors from the tool's first iteration; fill them in as those eras get
// their verification pass.
// ---------------------------------------------------------------------------

export type FrameReference = {
  /** Card name as printed. */
  name: string;
  /** Scryfall set code of the exact printing. */
  set: string;
  /** Scryfall id of the exact printing (highres_scan verified). */
  scryfallId: string;
};

export const FRAME_COLOR_KEYS = ["w", "u", "b", "r", "g", "c", "m"] as const;

export type FrameColorKey = (typeof FRAME_COLOR_KEYS)[number];

type ReferenceRow = Record<FrameColorKey, FrameReference | null>;

const NONE: ReferenceRow = { w: null, u: null, b: null, r: null, g: null, c: null, m: null };

export const FRAME_REFERENCES: Record<FrameTemplate, ReferenceRow> = {
  // M15 era — fully researched (2026-07-01).
  m15: {
    w: { name: "Serra Angel", set: "dom", scryfallId: "b56b9131-4f7e-4912-ba47-63ed82f21d1b" },
    u: { name: "Frost Lynx", set: "iko", scryfallId: "dfcaeccc-fc8c-4a9e-80d5-b48da71d7ff1" },
    b: { name: "Murder", set: "m20", scryfallId: "6a2b22bc-e81b-4f27-a52b-9f3edad25439" },
    r: { name: "Shock", set: "m21", scryfallId: "59fa8e8d-bcb8-47bf-b71a-df11c8d0f2c9" },
    g: { name: "Llanowar Elves", set: "dom", scryfallId: "581b7327-3215-4a4f-b4ae-d9d4002ba882" },
    c: { name: "Meteor Golem", set: "m19", scryfallId: "1bdb0b15-d651-4730-8be9-d0e01145311b" },
    m: { name: "Siege Rhino", set: "ktk", scryfallId: "9011126a-20bd-4c86-a63b-1691f79ac247" },
  },
  m15land: {
    w: { name: "Plains", set: "dom", scryfallId: "023d333b-14f2-40ad-bb76-8b9e38040f89" },
    u: { name: "Island", set: "dom", scryfallId: "0ce67a27-aa80-46ac-955a-8fea336995d9" },
    b: { name: "Swamp", set: "dom", scryfallId: "09eeb6aa-45ac-4a0e-bab2-1a004aac841f" },
    r: { name: "Mountain", set: "dom", scryfallId: "621aa8e1-aebf-4eea-beb5-7fb47700a87a" },
    g: { name: "Forest", set: "dom", scryfallId: "ae21165c-cc6d-45cc-b5c1-97b73e85dddd" },
    c: { name: "Wastes", set: "ogw", scryfallId: "9cc070d3-4b83-4684-9caf-063e5c473a77" },
    m: { name: "Azorius Guildgate", set: "rna", scryfallId: "93cf5412-c711-41b4-ab3b-7788a0a22228" },
  },
  m15token: {
    w: { name: "Soldier", set: "tdom", scryfallId: "f9b56129-17a2-4512-a4d6-34779224473f" },
    u: { name: "Drake", set: "tfdn", scryfallId: "f4a73034-e20f-4e7e-ac15-3460b1e9c69b" },
    b: { name: "Zombie", set: "tsoc", scryfallId: "b0d6fd21-48f0-4151-9671-762c25d95592" },
    r: { name: "Goblin", set: "tdom", scryfallId: "bd79264f-0734-48b7-8333-4035e518d46c" },
    g: { name: "Saproling", set: "tdom", scryfallId: "5371de1b-db33-4db4-a518-e35c71aa72b7" },
    c: { name: "Treasure", set: "txln", scryfallId: "720f3e68-84c0-462e-a0d1-90236ccc494a" },
    m: null,
  },
  m15snow: {
    w: { name: "Axgard Braggart", set: "khm", scryfallId: "4de5ff64-6fe7-4fc5-be27-cdbaa14545ab" },
    u: { name: "Berg Strider", set: "khm", scryfallId: "f3567bdc-450e-4481-9349-a80fe52fe431" },
    b: { name: "Deathknell Berserker", set: "khm", scryfallId: "f9f2029f-ffda-4374-9a78-79866ac23fca" },
    r: { name: "Frost Bite", set: "khm", scryfallId: "9423318a-c5a8-48d2-92f5-280d15a050a6" },
    g: { name: "Sarulf's Packmate", set: "khm", scryfallId: "6061113e-7dd8-4739-b4dd-55bb7f9e39a2" },
    c: { name: "Replicating Ring", set: "khm", scryfallId: "b079e285-8431-46aa-bb04-70cac586ed0b" },
    m: { name: "Narfi, Betrayer King", set: "khm", scryfallId: "421376e4-a4ad-427c-bc9c-d315308dcf68" },
  },
  m15devoid: {
    w: { name: "Eldrazi Displacer", set: "ogw", scryfallId: "f0bb1a5c-0f59-4951-827f-fe9df968232d" },
    u: { name: "Drowner of Hope", set: "bfz", scryfallId: "0fd5b48c-6850-47d4-8106-297be6c8f708" },
    b: { name: "Bearer of Silence", set: "ogw", scryfallId: "50460cce-ee1c-4384-bb0c-d90616e0d2e9" },
    r: { name: "Reality Hemorrhage", set: "ogw", scryfallId: "c044168d-cb08-493d-98c1-b66b6149fe5a" },
    g: { name: "Void Attendant", set: "bfz", scryfallId: "1f66eb97-b151-48b1-aff0-f1280af66291" },
    c: { name: "Kozilek's Channeler", set: "bfz", scryfallId: "c550d179-32ec-4ad8-91c2-d79320a21cba" },
    m: { name: "Void Grafter", set: "ogw", scryfallId: "6c2e37e2-a4bd-4f90-9191-3125784a3369" },
  },
  m15pw: {
    w: { name: "Gideon, Ally of Zendikar", set: "bfz", scryfallId: "187e887c-c39d-4d25-a506-cdc95fc70316" },
    u: { name: "Jace, Unraveler of Secrets", set: "soi", scryfallId: "20d5521d-e9f1-49e0-aa13-8e6de794cb12" },
    b: { name: "Liliana, Death's Majesty", set: "akh", scryfallId: "40d8f490-f04d-4d59-9ab0-a977527fd529" },
    r: { name: "Chandra, Torch of Defiance", set: "kld", scryfallId: "ff8086cd-b868-4f4e-823e-2635ad7ebc07" },
    g: { name: "Nissa, Vital Force", set: "kld", scryfallId: "bbaaa98a-ec40-4ff1-8762-a719cf1c475d" },
    c: { name: "Karn, Scion of Urza", set: "dom", scryfallId: "07a3d9e8-8597-498b-869c-cff79e0df516" },
    m: { name: "Sarkhan Unbroken", set: "dtk", scryfallId: "192452f8-93c2-4a20-a52b-0093741a9e45" },
  },
  battle: {
    w: { name: "Invasion of Gobakhan // Lightshield Array", set: "mom", scryfallId: "11798730-6788-4e0b-a828-b46cab1a4fa7" },
    u: { name: "Invasion of Segovia // Caetus, Sea Tyrant of Segovia", set: "mom", scryfallId: "9df3e743-7bb8-482a-afd1-4d51119d416c" },
    b: { name: "Invasion of Innistrad // Deluge of the Dead", set: "mom", scryfallId: "77720d2e-2b7b-492b-852c-eea5061eb31b" },
    r: { name: "Invasion of Mercadia // Kyren Flamewright", set: "mom", scryfallId: "407d6723-bf58-403e-b2ac-ba52c51d356f" },
    g: { name: "Invasion of Ikoria // Zilortha, Apex of Ikoria", set: "mom", scryfallId: "5d59c8f2-f6af-40a6-8dfe-8cc45bf231ce" },
    c: { name: "Invasion of Ravnica // Guildpact Paragon", set: "mom", scryfallId: "73f8fc4f-2f36-4932-8d04-3c2651c116dc" },
    m: { name: "Invasion of Alara // Awaken the Maelstrom", set: "mom", scryfallId: "318c363b-61cc-4e2f-8f86-a4287539ea07" },
  },
  saga: {
    w: { name: "History of Benalia", set: "dom", scryfallId: "d134385d-b01c-41c7-bb2d-30722b44dc5a" },
    u: { name: "The Antiquities War", set: "dom", scryfallId: "bbda670a-00a7-419c-b4b5-bfdb323f006d" },
    b: { name: "The Eldest Reborn", set: "dom", scryfallId: "c8318f40-ecd5-429e-8fe2-febf31f64841" },
    r: { name: "The First Eruption", set: "dom", scryfallId: "0efc241f-64b5-4e28-b14a-b3f19ca6e7b5" },
    g: { name: "The Mending of Dominaria", set: "dom", scryfallId: "0d5e4d9a-34e1-46eb-814b-8e3bd4475b8a" },
    c: { name: "Urza's Saga", set: "mh2", scryfallId: "c1e0f201-42cb-46a1-901a-65bb4fc18f6c" },
    m: { name: "The Kami War // O-Kagachi Made Manifest", set: "neo", scryfallId: "36052532-5028-43a8-9fc4-56221ec867fd" },
  },
  adventure: {
    w: { name: "Faerie Guidemother // Gift of the Fae", set: "eld", scryfallId: "e8bbece8-9620-44d9-b991-350fe952538a" },
    u: { name: "Brazen Borrower // Petty Theft", set: "eld", scryfallId: "c2089ec9-0665-448f-bfe9-d181de127814" },
    b: { name: "Foulmire Knight // Profane Insight", set: "eld", scryfallId: "c5f6c745-e46a-42eb-8eca-b7b74ab1245e" },
    r: { name: "Bonecrusher Giant // Stomp", set: "eld", scryfallId: "09fd2d9c-1793-4beb-a3fb-7a869f660cd4" },
    g: { name: "Lovestruck Beast // Heart's Desire", set: "eld", scryfallId: "4ccdef9c-1e85-4358-8059-8972479f7556" },
    c: null,
    m: { name: "Beluna Grandsquall // Seek Thrills", set: "woe", scryfallId: "3f5acc0d-33a6-476f-95ca-a1ad788334dd" },
  },
  split: {
    w: null,
    u: null,
    b: null,
    r: null,
    g: null,
    c: null,
    m: { name: "Expansion // Explosion", set: "grn", scryfallId: "e0644c92-4d67-475e-8c8e-0e2c493682fb" },
  },
  flip: {
    w: { name: "Bushi Tenderfoot // Kenzo the Hardhearted", set: "chk", scryfallId: "864ad989-19a6-4930-8efc-bbc077a18c32" },
    u: { name: "Student of Elements // Tobita, Master of Winds", set: "chk", scryfallId: "9de1eebf-5725-438c-bcf0-f3a4d8a89fb0" },
    b: { name: "Nezumi Graverobber // Nighteyes the Desecrator", set: "chk", scryfallId: "77ffd913-8efa-48e5-a5cf-293d3068dbbf" },
    r: { name: "Akki Lavarunner // Tok-Tok, Volcano Born", set: "chk", scryfallId: "6ee6cd34-c117-4d7e-97d1-8f8464bfaac8" },
    g: { name: "Budoka Gardener // Dokai, Weaver of Life", set: "chk", scryfallId: "49999b95-5e62-414c-b975-4191b9c1ab39" },
    c: null,
    m: null,
  },
  aftermath: {
    w: { name: "Dusk // Dawn", set: "akh", scryfallId: "937dbc51-b589-4237-9fce-ea5c757f7c48" },
    u: { name: "Commit // Memory", set: "akh", scryfallId: "06c9e2e8-2b4c-4087-9141-6aa25a506626" },
    b: { name: "Never // Return", set: "akh", scryfallId: "a4b32135-7061-4278-a01a-4fcbaadc9706" },
    r: { name: "Insult // Injury", set: "akh", scryfallId: "eeac671f-2606-43ed-ad60-a69df5c150f6" },
    g: { name: "Mouth // Feed", set: "akh", scryfallId: "a47070a0-fd05-4ed9-a175-847a864478da" },
    c: null,
    m: { name: "Driven // Despair", set: "hou", scryfallId: "7713ba59-dd4c-4b49-93a7-292728df86b8" },
  },
  // Classic (1993)
  agclassic: {
    ...NONE,
    w: { name: "Serra Angel", set: "lea", scryfallId: "f8ac5006-91bd-4803-93da-f87cf196dd2f" },
  },
  alphaland: { ...NONE },
  alphatoken: { ...NONE },
  // Retro (1997)
  retro: {
    ...NONE,
    w: { name: "Serra Angel", set: "dmr", scryfallId: "e430b8c9-9439-4256-9066-e9b57f257fe7" },
  },
  retroland: { ...NONE },
  // Modern border (2003)
  modern: {
    ...NONE,
    w: { name: "Serra Angel", set: "m12", scryfallId: "3c31fb9d-ec0d-4555-814d-62642d52c710" },
  },
  modernland: { ...NONE },
  // Showcase & Universes Beyond — references TBD with that era's pass.
  lotr: { ...NONE },
  lotrscroll: { ...NONE },
  avatar: { ...NONE },
  bloomburrow: { ...NONE },
  bloomanime: { ...NONE },
  tarkirdragon: { ...NONE },
  tarkirdraconic: { ...NONE },
  tarkirghostfire: { ...NONE },
};

/** Thumbnail URL for a reference — Scryfall's CDN shards by the id's first
 *  two characters, so the URL is constructible without an API call. The CDN
 *  has no rate limits. */
export function referenceThumbUrl(ref: FrameReference): string {
  return `https://cards.scryfall.io/normal/front/${ref.scryfallId[0]}/${ref.scryfallId[1]}/${ref.scryfallId}.jpg`;
}

/** Stable key for a (template, color) combination — used by the review
 *  table, the availability set, and the compare tool's URLs. */
export function frameComboKey(template: string, colorKey: string): string {
  return `${template}/${colorKey}`;
}

// ---------------------------------------------------------------------------
// Sample content for combos with NO real printing (mono-color splits,
// colorless adventures, …): the compare tool still renders our frame with
// era-plausible placeholder content so geometry can be eyeballed.
// ---------------------------------------------------------------------------

const SAMPLE_COLOR_IDENTITY: Record<FrameColorKey, string[]> = {
  w: ["white"],
  u: ["blue"],
  b: ["black"],
  r: ["red"],
  g: ["green"],
  c: ["colorless"],
  m: ["white", "blue"],
};

const SAMPLE_COST: Record<FrameColorKey, string> = {
  w: "{2}{W}",
  u: "{2}{U}",
  b: "{2}{B}",
  r: "{2}{R}",
  g: "{2}{G}",
  c: "{3}",
  m: "{1}{W}{U}",
};

/** Placeholder CardPreviewData-shaped content for a (template, color) combo
 *  without a real reference. Kept schema-free (plain object) so this module
 *  stays client-safe; the page casts it where CardPreviewData is expected. */
export function sampleFramePreview(template: FrameTemplate, colorKey: FrameColorKey) {
  const isLand = template.endsWith("land");
  const isToken = template.includes("token");
  const isPw = template === "m15pw";
  const isBattle = template === "battle";
  return {
    title: "Sample Card",
    cost: isLand ? null : SAMPLE_COST[colorKey],
    cardType: isLand
      ? "land"
      : isToken
        ? "token"
        : isPw
          ? "planeswalker"
          : isBattle
            ? "battle"
            : "creature",
    supertype: null,
    subtypes: isLand || isPw ? [] : ["Sample"],
    rarity: "rare",
    colorIdentity: SAMPLE_COLOR_IDENTITY[colorKey],
    rulesText: isPw
      ? "+1: Draw a card.\n-2: Sample text for the middle row.\n-7: A longer emblem line to fill the last row."
      : "Sample ability text sized to fill the rules box.\nSecond line for spacing.",
    flavorText: isLand || isPw || isBattle ? null : "Placeholder flavor line.",
    power: !isLand && !isPw && !isBattle ? "3" : null,
    toughness: !isLand && !isPw && !isBattle ? "3" : null,
    loyalty: isPw ? "4" : null,
    defense: isBattle ? "5" : null,
    artistCredit: "Sample Artist",
    artUrl: null,
    frameStyle: { template },
  };
}
