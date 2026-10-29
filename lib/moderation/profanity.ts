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
// A word may be disguised: case, accents and full-width letters
// (NFKD), leetspeak (4→a, 3→e, 1→i, 0→o, 5/$→s, 7→t, @→a, v→u…), a `*`
// standing for a vowel, letters repeated ("fuuuu…"), invisible characters
// inside it, and every letter spaced out ("f u c k", "f.u.c.k").
//
// The repo is PUBLIC: the words are stored ROT13'd below (a light
// obfuscation, not a secret — decode with any ROT13 tool). Tests use the
// encoded forms too (tests/unit/moderation/profanity.test.ts).
// ---------------------------------------------------------------------------

/** Stems matched ANYWHERE inside a word (ROT13). No English word holds one. */
const INFIX_ROT13 = "shpx";

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

// What may stand for each letter (always lower-case, after NFKD). `*` is a
// masked vowel ("f*ck"); `v` is the Roman-style u.
const LEET: Readonly<Record<string, string>> = {
  a: "a4@*",
  b: "b8",
  c: "c(",
  e: "e3*",
  g: "g69",
  i: "i1!|*",
  l: "l1|",
  o: "o0*",
  s: "s5$",
  t: "t7+",
  u: "uv*",
};

const escapeClass = (chars: string) => chars.replace(/[\\\]^-]/g, "\\$&");
const classOf = (letter: string) => `[${escapeClass(LEET[letter] ?? letter)}]`;

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
const INFIX_FORMS: readonly string[] = INFIX_ROT13.split(" ").map(rot13);

// No letter or digit on either side of a whole word.
const BEFORE = "(?<![\\p{L}\\p{N}])";
const AFTER = "(?![\\p{L}\\p{N}])";

const WORD_RE = new RegExp(
  `${BEFORE}(?:${[...WORD_FORMS, ...INFIX_FORMS].map(compactPattern).join("|")})${AFTER}`,
  "u",
);
const SPACED_RE = new RegExp(
  `${BEFORE}(?:${[...WORD_FORMS, ...INFIX_FORMS].map(spacedPattern).join("|")})${AFTER}`,
  "u",
);
const INFIX_RE = new RegExp(`(?:${INFIX_FORMS.map(compactPattern).join("|")})`, "u");

// Characters that draw nothing: a soft hyphen or a zero-width joiner inside
// a word must not split it.
const INVISIBLE = /[­​-‏⁠﻿]/g;

/** The text as the matcher reads it: no accents, no invisible characters,
 *  full-width and other compatibility forms folded, lower case. */
function normalized(text: string): string {
  return text.normalize("NFKD").replace(/\p{M}/gu, "").replace(INVISIBLE, "").toLowerCase();
}

/** True when `text` holds strong language — a listed word on its own (or
 *  disguised), or an infix stem anywhere. */
export function containsProfanity(text: string | null | undefined): boolean {
  if (!text) return false;
  const value = normalized(text);
  return WORD_RE.test(value) || INFIX_RE.test(value) || SPACED_RE.test(value);
}

// ---------------------------------------------------------------------------
// A card's text fields
// ---------------------------------------------------------------------------

/** The places a card's text lives, as the creator and the notice name them.
 *  The type line is one field (supertype, the typed Types line, subtypes);
 *  a walker's / saga's / station card's rows are its rules text. */
export const PROFANITY_FIELDS = [
  "title",
  "nickname",
  "type_line",
  "rules_text",
  "flavor_text",
  "artist_credit",
  "footer_text",
  "tags",
  "back_face.title",
  "back_face.type_line",
  "back_face.rules_text",
  "back_face.flavor_text",
  "back_face.artist_credit",
] as const;

export type ProfanityField = (typeof PROFANITY_FIELDS)[number];

const FIELD_LABELS: Readonly<Record<ProfanityField, string>> = {
  title: "name",
  nickname: "nickname",
  type_line: "type line",
  rules_text: "rules text",
  flavor_text: "flavor text",
  artist_credit: "artist credit",
  footer_text: "footer mark",
  tags: "tags",
  "back_face.title": "second face's name",
  "back_face.type_line": "second face's type line",
  "back_face.rules_text": "second face's rules text",
  "back_face.flavor_text": "second face's flavor text",
  "back_face.artist_credit": "second face's artist credit",
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
  footer_text?: unknown;
  tags?: unknown;
  tags_text?: unknown;
  /** The second face / part: the same keys (its own name, type line,
   *  rules, flavour and artist). */
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

const anyProfane = (...values: unknown[]) => values.some((value) => textsOf(value).some(containsProfanity));

/** The face fields of one face that hold strong language, unprefixed. */
function faceFields(face: ProfanityScanInput, front: boolean): ProfanityField[] {
  const out: ProfanityField[] = [];
  if (anyProfane(face.title)) out.push("title");
  if (front && anyProfane(face.nickname)) out.push("nickname");
  if (anyProfane(face.supertype, face.printed_types, face.subtypes, face.subtypes_text)) out.push("type_line");
  if (
    anyProfane(
      face.rules_text,
      ...(front ? [face.face_content, face.loyalty_abilities, face.saga_intro, face.saga_chapters] : []),
    )
  ) {
    out.push("rules_text");
  }
  if (anyProfane(face.flavor_text)) out.push("flavor_text");
  if (anyProfane(face.artist_credit)) out.push("artist_credit");
  return out;
}

/** The fields of a card whose text holds strong language, in the order
 *  PROFANITY_FIELDS lists them — empty for a clean card. */
export function profaneFields(card: ProfanityScanInput | null | undefined): ProfanityField[] {
  if (!card) return [];
  const found = new Set<ProfanityField>(faceFields(card, true));
  if (anyProfane(card.footer_text)) found.add("footer_text");
  if (anyProfane(card.tags, card.tags_text)) found.add("tags");
  const back = card.back_face;
  if (back && typeof back === "object" && !Array.isArray(back)) {
    for (const field of faceFields(back as ProfanityScanInput, false)) {
      found.add(`back_face.${field}` as ProfanityField);
    }
  }
  return PROFANITY_FIELDS.filter((field) => found.has(field));
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
 * or unlisted is left as it is when it adds no strong language (every field
 * that holds some held some before) and asks for no wider audience: the
 * policy is not applied retroactively, and an edit never changes what its
 * maker did not touch (CLAUDE.md). Typing a new word, or publishing a draft
 * whose text holds one, makes it private.
 */
export function languageForcesPrivate(input: {
  saved: ProfanityScanInput;
  visibility: VisibilityValue | string | null | undefined;
  stored?: { card: ProfanityScanInput; visibility: VisibilityValue | string | null | undefined } | null;
}): ProfanityField[] {
  const visibility = input.visibility as VisibilityValue;
  if (!(visibility in AUDIENCE) || visibility === "private") return [];
  const fields = profaneFields(input.saved);
  if (fields.length === 0 || !input.stored) return fields;
  const storedVisibility = input.stored.visibility as VisibilityValue;
  if (!(storedVisibility in AUDIENCE) || storedVisibility === "private") return fields;
  if (AUDIENCE[visibility] > AUDIENCE[storedVisibility]) return fields;
  const before = new Set(profaneFields(input.stored.card));
  return fields.every((field) => before.has(field)) ? [] : fields;
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
