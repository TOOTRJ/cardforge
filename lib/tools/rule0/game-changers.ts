// ---------------------------------------------------------------------------
// The official Commander GAME CHANGERS list — DATA, read by the Rule 0 table
// sheet's light bracket estimate (lib/tools/rule0/bracket-estimate.ts).
//
// Wizards of the Coast keeps the list (the Commander Format Panel's bracket
// updates); the last change before this file was read is the February 9,
// 2026 update (Farewell and Biorhythm added). The names below are the list
// as Scryfall's `is:gamechanger` search returned it on the date in
// GAME_CHANGERS_SOURCE.read — 53 cards, one entry per card, a two-faced card
// by its full "Front // Back" name.
//
// When Wizards updates the list: replace the names, move `updated` and
// `read`, and point `announcement` at the new article
// (tests/unit/tools/rule0-sheet.test.ts holds the shape). Pure,
// client-safe.
// ---------------------------------------------------------------------------

export const GAME_CHANGERS_SOURCE = {
  title: "Commander Brackets — Game Changers",
  /** The last list change Wizards announced before `read`. */
  updated: "2026-02-09",
  announcement: "https://magic.wizards.com/en/news/announcements/commander-brackets-beta-update-february-9-2026",
  /** Where the full list was read (it tracks Wizards' list). */
  list: "https://scryfall.com/search?q=is%3Agamechanger",
  read: "2026-11-08",
} as const;

export const GAME_CHANGERS: readonly string[] = [
  "Ad Nauseam",
  "Ancient Tomb",
  "Aura Shards",
  "Biorhythm",
  "Bolas's Citadel",
  "Braids, Cabal Minion",
  "Chrome Mox",
  "Coalition Victory",
  "Consecrated Sphinx",
  "Crop Rotation",
  "Cyclonic Rift",
  "Demonic Tutor",
  "Drannith Magistrate",
  "Enlightened Tutor",
  "Farewell",
  "Field of the Dead",
  "Fierce Guardianship",
  "Force of Will",
  "Gaea's Cradle",
  "Gamble",
  "Gifts Ungiven",
  "Glacial Chasm",
  "Grand Arbiter Augustin IV",
  "Grim Monolith",
  "Humility",
  "Imperial Seal",
  "Intuition",
  "Jeska's Will",
  "Lion's Eye Diamond",
  "Mana Vault",
  "Mishra's Workshop",
  "Mox Diamond",
  "Mystical Tutor",
  "Narset, Parter of Veils",
  "Natural Order",
  "Necropotence",
  "Notion Thief",
  "Opposition Agent",
  "Orcish Bowmasters",
  "Panoptic Mirror",
  "Rhystic Study",
  "Seedborn Muse",
  "Serra's Sanctum",
  "Smothering Tithe",
  "Survival of the Fittest",
  "Teferi's Protection",
  "Tergrid, God of Fright // Tergrid's Lantern",
  "Thassa's Oracle",
  "The One Ring",
  "The Tabernacle at Pendrell Vale",
  "Underworld Breach",
  "Vampiric Tutor",
  "Worldly Tutor",
];

/** A card name folded for matching: lower case, curly apostrophes straight
 *  (print typography stores ’), spaces collapsed. */
export function foldCardName(name: string): string {
  return name
    .normalize("NFKC")
    .replace(/[‘’ʼ]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Every name a list entry answers to: the whole name and, for a two-faced
 *  card, its front face (a deck entry may name the front alone). */
const BY_NAME: ReadonlyMap<string, string> = new Map(
  GAME_CHANGERS.flatMap((name) => {
    const whole = foldCardName(name);
    const front = whole.split(" // ")[0]!;
    return front === whole ? [[whole, name] as const] : [[whole, name] as const, [front, name] as const];
  }),
);

/** The list's own name for a card name, or null when it is no Game
 *  Changer. A deck entry's "Front // Back" matches by its front too. */
export function gameChangerName(name: string | null | undefined): string | null {
  if (!name) return null;
  const folded = foldCardName(name);
  return BY_NAME.get(folded) ?? BY_NAME.get(folded.split(" // ")[0]!) ?? null;
}
