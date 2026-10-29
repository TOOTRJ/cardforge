// ---------------------------------------------------------------------------
// Strong language in a card's TEXT (owner policy 2026-10-28). Violence is
// fine and some profanity is ALLOWED — but a card whose text holds strong
// profanity or a slur is saved PRIVATE, whatever visibility was asked for,
// and its maker is told why. ONE detector for every save path: the creator
// (its live note and the visibility it sends), both card actions
// (lib/cards/actions.ts — which the AI jobs, the deck remix and every
// import save through) and My Cards' bulk publish. Pure, client-safe, no
// network, no imports.
//
// The list is STRONG language only. Mild words that real cards print —
// "damn" (Damnation), "hell" (Hell's Caretaker), "bastard", "ass" — never
// count; neither does a word whose innocent spelling a slur shares
// ("Dickens", "Cockatrice", "Scunthorpe", "assassin", "class", "snigger").
// Matching is per WORD: a listed form must stand alone (no letter or digit
// on either side), so a listed word inside another word never counts. The
// one exception is the INFIX list: a stem no English word contains, matched
// anywhere ("motherf…").
//
// A PREFIX stem (one no English word begins with) counts at a word's start
// whatever follows it.
//
// A word may be disguised: case, accents and full-width letters (NFKD),
// Cyrillic / Greek look-alikes, leetspeak (4→a, 3→e, 1→i, 0→o, 5/$→s, 7→t,
// @→a, v→u…), a `*` masking any letter ("f*ck", "f**k" — a match keeps two
// real letters), letters repeated ("fuuuu…"), invisible characters inside
// it, and every letter spaced out ("f u c k", "f.u.c.k"). A match with no
// real letter at all is a number, never a word ("600k").
//
// The repo is PUBLIC: the words are stored ROT13'd below (a light
// obfuscation, not a secret — decode with any ROT13 tool). Tests use the
// encoded forms too (tests/unit/moderation/profanity.test.ts).
// ---------------------------------------------------------------------------

/** Stems matched ANYWHERE inside a word (ROT13). No English word holds one. */
const INFIX_ROT13 = "shpx";

/** Stems matched at the START of a word, whatever follows (ROT13): no
 *  English word begins with one ("…ing", "…ers", compounds). A stem an
 *  innocent word starts with — "shittim", "twattle", "spice", "retardant",
 *  "beanery", "coonhound", "niggard", "Pakistan" — is never here: its forms
 *  are listed whole below instead. */
const PREFIX_ROT13 =
  "phag avttre snttbg pbpxfhpx nffubyr nefrubyr qvpxurnq ovgpu juber fyhg wvmm qvyqb oybjwbo jrgonpx enturnq gbjryurnq fuvgurnq ohyyfuvg ubefrfuvg qvcfuvg";

/** Whole-word forms (ROT13), grouped by stem. A form counts only on its own. */
const WORDS_ROT13 = [
  "shx shxx shxxvat shxvat spx spxvat sphx sxvat cuhpx cuhpxvat",
  "fuvg fuvgf fuvggl fuvggvre fuvggvrfg fuvggvat fuvggrq fuvgr fuvgurnq fuvgurnqf fuvgubyr fuvgubyrf fuvgsnpr fuvgont fuvgybnq fuvgfgbez fuvgfubj ohyyfuvg ohyyfuvggvat ohyyfuvggre ubefrfuvg qvcfuvg ncrfuvg ongfuvg puvpxrafuvg qbtfuvg",
  "phag phagf phagl",
  "pbpxfhpxre pbpxfhpxref pbpxfhpxvat",
  "nffubyr nffubyrf nefrubyr nefrubyrf nffung nffungf",
  "qvpxurnq qvpxurnqf",
  "ovgpu ovgpurf ovgpul ovgpuvat ovgpurq fbabsnovgpu",
  "gjng gjngf jnaxre jnaxref jnax jnaxvat jnaxrq",
  "juber juberf fyhg fyhgf fyhggl chffl chffvrf wvmm qvyqb qvyqbf oybjwbo oybjwbof",
  // Slurs.
  "avttre avttref avttn avttnf avttnm",
  "snttbg snttbgf snt sntf snttl",
  "xvxr xvxrf fcvp fcvpf tbbx tbbxf jrgonpx jrgonpxf genaal genaavrf ergneq ergneqf ergneqrq",
  "enturnq enturnqf gbjryurnq gbjryurnqf ornare ornaref pbba pbbaf cnxv cnxvf",
];

function rot13(text: string): string {
  return text.replace(/[a-z]/g, (c) => String.fromCharCode(((c.charCodeAt(0) - 97 + 13) % 26) + 97));
}

// What may stand for each letter (always lower-case, after NFKD and the
// look-alike fold). `v` is the Roman-style u. No digit stands for g: "600k
// bounty" and "900K gold" are numbers, not a slur. A `*` masks ANY letter
// ("f*ck", "f**k") — a match must still hold real letters (realEnough).
const LEET: Readonly<Record<string, string>> = {
  a: "a4@",
  b: "b8",
  c: "c",
  e: "e3",
  i: "i1!|",
  l: "l1|",
  o: "o0",
  s: "s5$",
  t: "t7+",
  u: "uv",
};

const escapeClass = (chars: string) => chars.replace(/[\\\]^-]/g, "\\$&");
const classOf = (letter: string) => `[${escapeClass(`${LEET[letter] ?? letter}*`)}]`;

/** A form's letters, each run of k equal letters allowing k or more. */
function compactPattern(word: string): string {
  let out = "";
  for (let i = 0; i < word.length; ) {
    let run = 1;
    while (word[i + run] === word[i]) run += 1;
    out += `${classOf(word[i])}${run === 1 ? "+" : `{${run},}`}`;
    i += run;
  }
  return out;
}

/** Every letter spaced out by the same kind of gap: "f u c k", "f.u.c.k". */
function spacedPattern(word: string): string {
  return [...word].map(classOf).join("[ \\t._~·•-]{1,2}");
}

const WORD_FORMS: readonly string[] = WORDS_ROT13.flatMap((group) => group.split(" ")).map(rot13);
const PREFIX_FORMS: readonly string[] = PREFIX_ROT13.split(" ").map(rot13);
const INFIX_FORMS: readonly string[] = INFIX_ROT13.split(" ").map(rot13);

// No letter or digit on either side of a whole word.
const BEFORE = "(?<![\\p{L}\\p{N}])";
const AFTER = "(?![\\p{L}\\p{N}])";

const MATCHERS: readonly RegExp[] = [
  // A listed form on its own.
  new RegExp(`${BEFORE}(?:${[...WORD_FORMS, ...INFIX_FORMS].map(compactPattern).join("|")})${AFTER}`, "gu"),
  // A stem at a word's start, whatever follows.
  new RegExp(`${BEFORE}(?:${PREFIX_FORMS.map(compactPattern).join("|")})`, "gu"),
  // An infix stem anywhere.
  new RegExp(`(?:${INFIX_FORMS.map(compactPattern).join("|")})`, "gu"),
  // A form spelled out letter by letter.
  new RegExp(`${BEFORE}(?:${[...WORD_FORMS, ...INFIX_FORMS].map(spacedPattern).join("|")})${AFTER}`, "gu"),
];

/** A match is a word only with real letters in it: one at least ("$h1t"
 *  has two, "5007" none), two once a `*` masks any ("f**k" yes, "c***" no,
 *  "****" no). */
function realEnough(match: string): boolean {
  const letters = match.match(/\p{L}/gu)?.length ?? 0;
  return match.includes("*") ? letters >= 2 : letters >= 1;
}

// Characters that draw nothing: a soft hyphen or a zero-width joiner inside
// a word must not split it.
const INVISIBLE = new RegExp("[\\u00AD\\u200B-\\u200F\\u2060\\uFEFF]", "g");

// Cyrillic and Greek letters that look like Latin ones (lower case, after
// NFKD), folded to the Latin letter they pass for.
const LOOK_ALIKES: Readonly<Record<string, string>> = {
  "а": "a", "в": "b", "е": "e", "ё": "e", "к": "k", "м": "m", "н": "h", "о": "o", "р": "p", "с": "c", "т": "t", "у": "y", "х": "x",
  "і": "i", "ї": "i", "ј": "j", "ѕ": "s", "ԁ": "d", "ɡ": "g", "ɩ": "i",
  "α": "a", "β": "b", "ε": "e", "η": "n", "ι": "i", "κ": "k", "μ": "u", "ν": "v", "ο": "o", "ρ": "p", "τ": "t", "υ": "u", "χ": "x", "ζ": "z",
};
const LOOK_ALIKE_RE = new RegExp(`[${Object.keys(LOOK_ALIKES).join("")}]`, "gu");

/** The text as the matcher reads it: no accents, no invisible characters,
 *  full-width and other compatibility forms folded, Cyrillic / Greek
 *  look-alikes folded to Latin, lower case. */
function normalized(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(INVISIBLE, "")
    .toLowerCase()
    .replace(LOOK_ALIKE_RE, (c) => LOOK_ALIKES[c] ?? c);
}

/** True when `text` holds strong language — a listed word on its own (or
 *  disguised), a listed stem at a word's start, or an infix stem anywhere. */
export function containsProfanity(text: string | null | undefined): boolean {
  if (!text) return false;
  const value = normalized(text);
  for (const matcher of MATCHERS) {
    matcher.lastIndex = 0;
    for (const match of value.matchAll(matcher)) {
      if (realEnough(match[0])) return true;
    }
  }
  return false;
}

/** A field's text as an EDIT compares it (lib/cards/actions.ts, the
 *  creator): its words, normalised, as a set — so a stored text and the
 *  same text resent (typography kept, rows dual-written beside the rules,
 *  tags as a list or as typed) read as unchanged, and any word added,
 *  changed or removed reads as an edit. */
function wordsOf(texts: readonly string[]): string {
  const words = new Set<string>();
  for (const text of texts) {
    for (const word of normalized(text).split(/[^\p{L}\p{N}*$@!|+(]+/u)) if (word) words.add(word);
  }
  return [...words].sort().join(" ");
}

// ---------------------------------------------------------------------------
// A card's text fields
// ---------------------------------------------------------------------------

/** The places a card's text lives, as the creator and the notice name them.
 *  The type line is one field (supertype, the typed Types line, subtypes);
 *  a walker's / saga's / station card's rows are its rules text; the
 *  printed stats and the collector line (P/T, loyalty, defense, set code,
 *  collector number, a cost's unrecognised `{…}` symbols) are one. */
export const PROFANITY_FIELDS = [
  "title",
  "nickname",
  "type_line",
  "rules_text",
  "flavor_text",
  "artist_credit",
  "stats",
  "footer_text",
  "tags",
  "back_face.title",
  "back_face.type_line",
  "back_face.rules_text",
  "back_face.flavor_text",
  "back_face.artist_credit",
  "back_face.stats",
] as const;

export type ProfanityField = (typeof PROFANITY_FIELDS)[number];

const FIELD_LABELS: Readonly<Record<ProfanityField, string>> = {
  title: "name",
  nickname: "nickname",
  type_line: "type line",
  rules_text: "rules text",
  flavor_text: "flavor text",
  artist_credit: "artist credit",
  stats: "stats / collector line",
  footer_text: "footer mark",
  tags: "tags",
  "back_face.title": "second face's name",
  "back_face.type_line": "second face's type line",
  "back_face.rules_text": "second face's rules text",
  "back_face.flavor_text": "second face's flavor text",
  "back_face.artist_credit": "second face's artist credit",
  "back_face.stats": "second face's stats",
};

/** A card's text as any save path holds it: a payload or a stored row
 *  (`subtypes`, `tags`, `face_content`) or the creator's form values
 *  (`subtypes_text`, `tags_text`, the loyalty / saga rows). Every key is
 *  optional and read loosely — a value of the wrong shape is no text. */
export type ProfanityScanInput = {
  title?: unknown;
  nickname?: unknown;
  supertype?: unknown;
  printed_types?: unknown;
  subtypes?: unknown;
  subtypes_text?: unknown;
  rules_text?: unknown;
  /** Walker / saga / station rows (cards.face_content). */
  face_content?: unknown;
  loyalty_abilities?: unknown;
  saga_intro?: unknown;
  saga_chapters?: unknown;
  flavor_text?: unknown;
  artist_credit?: unknown;
  /** The printed stats and collector line. */
  cost?: unknown;
  power?: unknown;
  toughness?: unknown;
  loyalty?: unknown;
  defense?: unknown;
  set_code?: unknown;
  collector_number?: unknown;
  footer_text?: unknown;
  tags?: unknown;
  tags_text?: unknown;
  /** The second face / part: the same keys (its own name, type line,
   *  rules, flavour, artist and stats). */
  back_face?: unknown;
};

/** Every string inside a value (a string, an array of them, rows of
 *  objects), depth-first. Numbers, booleans and null hold no text. */
function textsOf(value: unknown, depth = 0): string[] {
  if (typeof value === "string") return [value];
  if (depth > 4 || value === null || typeof value !== "object") return [];
  const children = Array.isArray(value) ? value : Object.values(value as Record<string, unknown>);
  return children.flatMap((child) => textsOf(child, depth + 1));
}

// A cost's symbols the card prints as symbols — colours, generic numbers,
// X / Y / Z, snow, tap / untap, energy, Phyrexian, hybrid and twobrid,
// half, infinity, chaos. Anything else inside `{…}` is text to the reader.
const COST_SYMBOL =
  /^(?:[wubrgcsxyzteqpa]|\d{1,3}|[wubrgc2](?:\/[wubrgcp])(?:\/p)?|h[wubrgcr]|½|∞|chaos|pw|tk|l)$/i;

/** A cost as text: what sits outside its symbols, and every `{…}` that is
 *  no symbol. */
function costTexts(cost: unknown): string[] {
  if (typeof cost !== "string") return [];
  return [cost.replace(/\{([^}]*)\}/g, (_token, inner: string) => (COST_SYMBOL.test(inner.trim()) ? " " : ` ${inner} `))];
}

type FieldTexts = Map<ProfanityField, string[]>;

/** One face's texts, field by field (unprefixed). */
function faceTexts(face: ProfanityScanInput, front: boolean): Array<[ProfanityField, string[]]> {
  return [
    ["title", textsOf(face.title)],
    ["nickname", front ? textsOf(face.nickname) : []],
    ["type_line", [face.supertype, face.printed_types, face.subtypes, face.subtypes_text].flatMap((v) => textsOf(v))],
    [
      "rules_text",
      [face.rules_text, ...(front ? [face.face_content, face.loyalty_abilities, face.saga_intro, face.saga_chapters] : [])].flatMap((v) =>
        textsOf(v),
      ),
    ],
    ["flavor_text", textsOf(face.flavor_text)],
    ["artist_credit", textsOf(face.artist_credit)],
    [
      "stats",
      [
        ...costTexts(face.cost),
        ...[face.power, face.toughness, face.loyalty, face.defense, ...(front ? [face.set_code, face.collector_number] : [])].flatMap((v) =>
          textsOf(v),
        ),
      ],
    ],
  ];
}

/** Every field's texts. */
function fieldTextsOf(card: ProfanityScanInput): FieldTexts {
  const out: FieldTexts = new Map(faceTexts(card, true));
  out.set("footer_text", textsOf(card.footer_text));
  out.set("tags", [card.tags, card.tags_text].flatMap((v) => textsOf(v)));
  const back = card.back_face;
  if (back && typeof back === "object" && !Array.isArray(back)) {
    for (const [field, texts] of faceTexts(back as ProfanityScanInput, false)) {
      out.set(`back_face.${field}` as ProfanityField, texts);
    }
  }
  return out;
}

const profaneIn = (texts: FieldTexts) =>
  PROFANITY_FIELDS.filter((field) => (texts.get(field) ?? []).some(containsProfanity));

/** The fields of a card whose text holds strong language, in the order
 *  PROFANITY_FIELDS lists them — empty for a clean card. */
export function profaneFields(card: ProfanityScanInput | null | undefined): ProfanityField[] {
  return card ? profaneIn(fieldTextsOf(card)) : [];
}

// ---------------------------------------------------------------------------
// The rule every save applies
// ---------------------------------------------------------------------------

type VisibilityValue = "public" | "unlisted" | "private";
const AUDIENCE: Readonly<Record<VisibilityValue, number>> = { private: 0, unlisted: 1, public: 2 };

/**
 * The fields that make THIS save private — empty when the card saves as
 * asked. `saved` is the card as it will be stored, `visibility` the one the
 * save would store. A private save is never forced (nothing to force).
 *
 * An EDIT (`stored` = the row before it) of a card that is already public
 * or unlisted is left as it is only while every field that holds strong
 * language held it before with its text UNCHANGED (its words, normalised —
 * wordsOf) and the edit asks for no wider audience: the policy is not
 * applied retroactively, and an edit never changes what its maker did not
 * touch (CLAUDE.md). Typing a new word, editing a flagged field in any way,
 * or publishing a draft whose text holds one makes it private.
 */
export function languageForcesPrivate(input: {
  saved: ProfanityScanInput;
  visibility: VisibilityValue | string | null | undefined;
  stored?: { card: ProfanityScanInput; visibility: VisibilityValue | string | null | undefined } | null;
}): ProfanityField[] {
  const visibility = input.visibility as VisibilityValue;
  if (!(visibility in AUDIENCE) || visibility === "private") return [];
  const saved = fieldTextsOf(input.saved);
  const fields = profaneIn(saved);
  if (fields.length === 0 || !input.stored) return fields;
  const storedVisibility = input.stored.visibility as VisibilityValue;
  if (!(storedVisibility in AUDIENCE) || storedVisibility === "private") return fields;
  if (AUDIENCE[visibility] > AUDIENCE[storedVisibility]) return fields;
  const stored = fieldTextsOf(input.stored.card);
  const untouched = (field: ProfanityField) =>
    (stored.get(field) ?? []).some(containsProfanity) &&
    wordsOf(stored.get(field) ?? []) === wordsOf(saved.get(field) ?? []);
  return fields.every(untouched) ? [] : fields;
}

// ---------------------------------------------------------------------------
// The notice and its words — one copy source for the creator's note, its
// toasts, the AI runner and My Cards.
// ---------------------------------------------------------------------------

/** What a save says when it stored a card PRIVATE that asked to be public
 *  or unlisted, because its text holds strong language. */
export type ForcedPrivateNotice = { reason: "profanity"; fields: ProfanityField[] };

/** "rules text", "name and rules text", "name, tags and rules text". */
export function profaneFieldList(fields: readonly ProfanityField[]): string {
  const labels = fields.map((field) => FIELD_LABELS[field]);
  if (labels.length === 0) return "text";
  if (labels.length === 1) return labels[0];
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

/** The creator's note while the text holds strong language. */
export function strongLanguageNote(fields: readonly ProfanityField[]): string {
  return `This card's ${profaneFieldList(fields)} includes strong language, so it will be saved as private. Remove it to publish.`;
}

/** Why a save landed private (the toast after it). */
export function strongLanguageSavedMessage(title: string, fields: readonly ProfanityField[]): string {
  return `Saved “${title}” as private — its ${profaneFieldList(fields)} includes strong language. Remove it to publish.`;
}

/** An AI card saved private for its text (the job runner's toast). */
export function generatedPrivateMessage(label: string, fields: readonly ProfanityField[]): string {
  return `“${label}” was saved as private — its ${profaneFieldList(fields)} includes strong language. Remove it to publish.`;
}

/** The same in a batch (a deck): told once, the details list every card. */
export function generatedPrivateInBatchMessage(firstLabel: string): string {
  return `Cards whose text includes strong language were saved as private — “${firstLabel}” is one. The generation details list them all.`;
}

/** The line a generation's details show on such a card's step. */
export const GENERATED_PRIVATE_STEP_NOTE = "Saved as private — strong language";

/** The reason a Public / Unlisted choice is unavailable (its description). */
export const STRONG_LANGUAGE_CHOICE_REASON = "Unavailable — this card's text includes strong language.";
