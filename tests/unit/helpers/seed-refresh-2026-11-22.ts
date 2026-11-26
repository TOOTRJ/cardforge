// ---------------------------------------------------------------------------
// The combos supabase/seed.sql gained when it was refreshed from production
// on 2026-11-22 (353 → 655 combos; none removed). Suites whose expectations
// were RECORDED against the list before it — a fixture of main's landings,
// "as on origin/main", "production's own list (2026-10-14)" — read the seed
// through `asBeforeSeedRefresh`: a data refresh is not a classification
// change. Re-recording such a fixture is the time to drop it there; a suite
// that says what production does TODAY reads the seed as it is.
// ---------------------------------------------------------------------------

const EVERY_KEY = ["w", "u", "b", "r", "g", "c", "m"] as const;

/** Templates the refresh brought in, in every colour key. */
const ADDED_IN_EVERY_COLOUR = [
  "avatar", "bloomanime", "bloomburrow", "breakingnews", "dndsourcebook", "dossier", "enchantingtales",
  "extendedart", "extendedartland", "extendedartprepare", "extendedartstation", "fullart", "lotr", "lotrscroll",
  "m15borderlessdfcback", "m15borderlessdfcfront", "m15borderlessmdfcback", "m15borderlessmdfcfront", "m15borderlessstation",
  "m15fullartlandsnc", "m15fullartlandthb", "m15fullartlandzen", "m15tokenartifacttall", "m15tokentall",
  "m20tokenartifactnyx", "m20tokenartifactnyxtall", "m20tokenartifactnyxtext", "m20tokennyx", "m20tokennyxtall", "m20tokennyxtext",
  "mysticalarchive", "prepare", "sagacreature", "sagadfcback", "sagadfcfront", "sncartdeco", "stainedglass", "tardis",
  "tarkirdraconic", "tarkirdragon", "tarkirghostfire",
] as const;

/** …and these colour keys of templates it already held, or held in part. */
const ADDED_IN_SOME_COLOURS: Readonly<Record<string, string>> = {
  m15stationland: "cm",
  expeditionland: "rcm",
  expeditionlandbfz: "cm",
  fullartland: "m",
  m15fullartland: "m",
  nyx: "wubrgm",
};

export const TICKED_BY_SEED_REFRESH_2026_11_22: ReadonlySet<string> = new Set([
  ...ADDED_IN_EVERY_COLOUR.flatMap((template) => EVERY_KEY.map((key) => `${template}/${key}`)),
  ...Object.entries(ADDED_IN_SOME_COLOURS).flatMap(([template, keys]) => [...keys].map((key) => `${template}/${key}`)),
]);

/** The verified combos as the seed listed them before the 2026-11-22
 *  refresh (a combo key: "template/colour"). */
export function asBeforeSeedRefresh(keys: Iterable<string>): Set<string> {
  return new Set([...keys].filter((key) => !TICKED_BY_SEED_REFRESH_2026_11_22.has(key)));
}
