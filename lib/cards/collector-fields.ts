// ---------------------------------------------------------------------------
// Collector fields (TODO 4.9a, folding in 6.6): the three `cards` columns that
// hold what a printing's collector line says — the PRINTED set code, the
// collector number and the language (migration 0133). They are card DATA:
// nothing draws them yet (4.9b draws the line, opt-in per card), the Scryfall
// import fills them from the printing (owner 2026-09-29: imports follow the
// printing), and the "Set & collector info" step edits them on any card.
//
// Pure and dependency-free: the zod schemas (lib/validation/card.ts), the
// editor, the import mapper and the migration parity test all read these
// same constants. Every rule here mirrors a CHECK in the migration.
// ---------------------------------------------------------------------------

/** `cards_set_code_format`: the printed set code, 2–6 upper-case letters or
 *  digits ("DMU", "FDN", "PRM"; a token set prints its parent). NOT
 *  deck_cards.set_code, which holds Scryfall's own lower-case code. */
export const SET_CODE_PATTERN = /^[A-Z0-9]{2,6}$/;
export const SET_CODE_MIN = 2;
export const SET_CODE_MAX = 6;

/** `cards_collector_number_format`: 1–12 of digits, letters, ★, †, `/` and
 *  `-` — Scryfall's numbers ("107", "237a", "H13", "XLN-117", "★") and the
 *  stored 2015-style size ("107/281"). */
export const COLLECTOR_NUMBER_PATTERN = /^[0-9A-Za-z★†/-]+$/;
export const COLLECTOR_NUMBER_MAX = 12;

/** `cards_lang_valid`: every language Scryfall prints (all 18), so an import
 *  never fails the CHECK. The six without a scan-verified printed code (he,
 *  la, grc, ar, sa, qya) are stored but print nothing (4.9b: never
 *  invented); the editor's select offers the twelve PRINTED_LANGS and shows
 *  a stored other as "Other (not printed)". */
export const CARD_LANG_VALUES = [
  "en",
  "es",
  "fr",
  "de",
  "it",
  "pt",
  "ja",
  "ko",
  "ru",
  "zhs",
  "zht",
  "ph",
  "he",
  "la",
  "grc",
  "ar",
  "sa",
  "qya",
] as const;
export type CardLang = (typeof CARD_LANG_VALUES)[number];
export const DEFAULT_CARD_LANG: CardLang = "en";

const CARD_LANG_SET: ReadonlySet<string> = new Set(CARD_LANG_VALUES);

export function isCardLang(value: unknown): value is CardLang {
  return typeof value === "string" && CARD_LANG_SET.has(value);
}

/** The twelve languages with a scan-verified PRINTED code (4.9 design §1.1:
 *  es prints SP and ko prints KR, not ES / KO). `printed` is what 4.9b will
 *  draw after the separator ("DMU • SP"); `label` is the editor's option. */
export const PRINTED_LANGS: ReadonlyArray<{
  code: CardLang;
  printed: string;
  label: string;
}> = [
  { code: "en", printed: "EN", label: "English" },
  { code: "es", printed: "SP", label: "Spanish" },
  { code: "fr", printed: "FR", label: "French" },
  { code: "de", printed: "DE", label: "German" },
  { code: "it", printed: "IT", label: "Italian" },
  { code: "pt", printed: "PT", label: "Portuguese" },
  { code: "ja", printed: "JP", label: "Japanese" },
  { code: "ko", printed: "KR", label: "Korean" },
  { code: "ru", printed: "RU", label: "Russian" },
  { code: "zhs", printed: "CS", label: "Chinese (Simplified)" },
  { code: "zht", printed: "CT", label: "Chinese (Traditional)" },
  { code: "ph", printed: "PH", label: "Phyrexian" },
];

/** The printed code for a stored language, or null for one of the six
 *  Scryfall languages no scan has verified a printed code for. */
export function printedLangCode(lang: string | null | undefined): string | null {
  return PRINTED_LANGS.find((entry) => entry.code === lang)?.printed ?? null;
}

/** A set code as the column stores it: trimmed and upper-cased ("dmu" →
 *  "DMU"); the pattern is checked by the caller (zod, the import). */
export function normalizeSetCode(input: string | null | undefined): string {
  return (input ?? "").trim().toUpperCase();
}

export function isValidSetCode(value: string): boolean {
  return SET_CODE_PATTERN.test(value);
}

export function isValidCollectorNumber(value: string): boolean {
  return value.length >= 1 && value.length <= COLLECTOR_NUMBER_MAX && COLLECTOR_NUMBER_PATTERN.test(value);
}
