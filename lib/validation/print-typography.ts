// ---------------------------------------------------------------------------
// Print typography on input (TODO 6.11) — what a maker types on a plain
// keyboard becomes the characters a printed card sets:
//
//   "quoted"            → “quoted”
//   can't, {T}'s, '90s  → can’t, {T}’s, ’90s
//   'quoted'            → ‘quoted’
//   Landfall - Whenever → Landfall — Whenever   (so the ability word is italic)
//   Landfall--Whenever  → Landfall — Whenever   (rules: the dash is spaced)
//   wait--what          → wait—what             (names, flavor: as typed)
//   Choose one -        → Choose one —
//   - Destroy / * Draw  → • Destroy / • Draw    (rules only, start of a line)
//   -Serra / -- Serra   → —Serra                (flavor only: the attribution)
//
// WHERE it runs (one function, the same answer everywhere):
//   * the creator, when a field loses focus (and when an AI fill, an idea or
//     a Scryfall import pours text into the form) — the field and the live
//     preview show the result at once, so nothing changes unseen at save;
//   * the server, on every save (lib/cards/actions.ts) — the one gate the
//     creator, the AI jobs, the deck remix and a crafted payload all pass.
//
// It never rewrites what is already right (a pasted ’ or — stays), never
// reads inside a `{…}` symbol token or a URL, and is idempotent. It converts
// to NOTHING a face cannot draw: the characters each field may gain are
// listed in PRINT_TYPOGRAPHY_CHARACTERS and a unit test holds that list to
// the ink of every face that field is drawn in (MPlantin, MPlantin italic,
// Beleren). That is why there is no U+2212 minus here: MPlantin maps it to
// an EMPTY glyph and both renderers set it as a hyphen (lib/cards/
// rules-box.ts) — "-1/-1" and "X-1" stay as typed. An ellipsis stays three
// full stops (the item never asked for one).
//
// No stored card changes by itself: a NEW card is converted whole, an EDIT
// only in the fields whose text the save changes (withPrintTypographyUpdate).
//
// Pure; shared client + server.
// ---------------------------------------------------------------------------

import { serializeLoyalty, serializeSaga } from "@/lib/cards/face-content";

/** How a field is read: a card name, a type-line part (supertype, subtype),
 *  rules-style text (rules, a loyalty row, a saga's intro and chapters) or
 *  flavor text. */
export type TypographyField = "name" | "type" | "rules" | "flavor";

/** Every character the conversion can put into a field that the maker did
 *  not type. Held to each face's ink by tests/unit/validation/
 *  print-typography.test.ts — add one here only with its ink. */
export const PRINT_TYPOGRAPHY_CHARACTERS: Readonly<Record<TypographyField, readonly string[]>> = {
  name: ["‘", "’", "“", "”", "—"],
  type: ["‘", "’", "“", "”", "—"],
  rules: ["‘", "’", "“", "”", "—", "•"],
  flavor: ["‘", "’", "“", "”", "—"],
};

// A `{…}` symbol token (never read inside: `{W/U}`, `{CHAOS}`, anything in
// braces on one line) or a URL up to its next whitespace.
const PROTECTED = /\{[^{}\n]*\}|(?:https?:\/\/|www\.)\S+/gi;

/** Words that open with an apostrophe (an elision), not with a quote. */
const ELISIONS = /^(?:tis|twas|twere|twill|til|em|n)(?![\p{L}\p{N}])/iu;

/** After these a quote OPENS: the start, whitespace, an opening bracket, a
 *  dash, or another opening quote. */
function opensAfter(prev: string | undefined): boolean {
  return prev === undefined || /[\s([{—–‘“]/.test(prev);
}

function convertLine(line: string, field: TypographyField): string {
  // The protected spans are lifted out, the line's plain text converted with
  // a private-use placeholder standing where each was (so "{T}'s" still
  // reads as a letter-like thing before the apostrophe), then put back.
  const kept: string[] = [];
  let text = line.replace(PROTECTED, (match) => {
    kept.push(match);
    return "";
  });

  // --- The start of a line ---
  if (field === "rules") {
    // A list item: "- Destroy…" / "* Destroy…" → "• Destroy…". Never a
    // loyalty line typed with a spaced sign ("- 3: …").
    text = text.replace(/^(\s*)[*-](\s+)(?=\S)(?!(?:\d+|X)\s*:)/i, "$1•$2");
  } else if (field === "flavor") {
    // An attribution: "-Serra" / "-- Serra" → "—Serra", as cards print it.
    text = text.replace(/^(\s*)--?[ \t]*(?=[^\s\d-])/, "$1—");
  }

  // --- Dashes ---
  // Two hyphens (never part of a longer rule of them): an em dash. Rules
  // text sets its dashes spaced ("Landfall — Whenever"); a name or a flavor
  // line keeps the spacing it was typed with ("wait—what").
  text = text.replace(/([ \t]*)(-{2,})([ \t]*)/g, (match, before: string, hyphens: string, after: string, offset: number, whole: string) => {
    if (hyphens.length !== 2) return match;
    if (field !== "rules") return `${before}—${after}`;
    const start = whole.slice(0, offset).trim() === "";
    const end = offset + match.length === whole.length;
    return `${start ? "" : " "}—${end ? "" : " "}`;
  });
  // A spaced hyphen between two words, or closing a line ("Choose one -").
  // Never before a number: "5 - 2" is a subtraction.
  text = text.replace(/(\S) - (?=[^\s\d])/g, "$1 — ").replace(/(\S) -$/, "$1 —");

  // --- Quotes ---
  if (text.includes('"') || text.includes("'")) {
    let out = "";
    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i];
      const prev = out[out.length - 1];
      if (ch === '"') {
        out += opensAfter(prev) ? "“" : "”";
      } else if (ch === "'") {
        const rest = text.slice(i + 1);
        // '90s, 'tis: an apostrophe although it opens the word.
        const elision = /^\d/.test(rest) || ELISIONS.test(rest);
        out += opensAfter(prev) && !elision ? "‘" : "’";
      } else {
        out += ch;
      }
    }
    text = out;
  }

  let next = 0;
  return text.replace(//g, () => kept[next++] ?? "");
}

/** `text` as a printed card sets it. Line breaks, leading and trailing
 *  space and everything inside `{…}` or a URL are kept as they are. */
export function printTypography(text: string, field: TypographyField): string {
  if (!text) return text;
  // (A private-use placeholder in the text itself would be mistaken for a
  // protected span: such a text is left alone.)
  if (text.includes("")) return text;
  return text
    .split("\n")
    .map((line) => convertLine(line, field))
    .join("\n");
}

/** printTypography that never grows a text past `max` characters (only the
 *  spaced rules dash adds any): a text it would push over keeps its typed
 *  form, so a save never fails on a length the maker did not type. */
function within(text: string, field: TypographyField, max: number): string {
  const converted = printTypography(text, field);
  return converted.length > max && converted.length > text.length ? text : converted;
}

// ---------------------------------------------------------------------------
// The creator form — which field is which
// ---------------------------------------------------------------------------

/** The field kind of a creator form field by its name (`rules_text`,
 *  `back_face.title`, `loyalty_abilities.2.text`…), or null for a field the
 *  conversion never touches (costs, stats, the artist, tags, the footer
 *  mark, the collector fields). */
export function typographyFieldOf(name: string): TypographyField | null {
  const key = name.replace(/^back_face\./, "");
  if (key === "title") return "name";
  if (key === "supertype" || key === "subtypes_text") return "type";
  if (key === "rules_text" || key === "saga_intro") return "rules";
  if (/^(?:loyalty_abilities|saga_chapters)\.\d+\.text$/.test(key)) return "rules";
  if (key === "flavor_text") return "flavor";
  return null;
}

type TextPatch = {
  title?: string;
  supertype?: string;
  subtypes_text?: string;
  rules_text?: string;
  flavor_text?: string;
};

function textPatch<T extends TextPatch>(patch: T): T {
  const out = { ...patch };
  if (typeof out.title === "string") out.title = printTypography(out.title, "name");
  if (typeof out.supertype === "string") out.supertype = printTypography(out.supertype, "type");
  if (typeof out.subtypes_text === "string") out.subtypes_text = printTypography(out.subtypes_text, "type");
  if (typeof out.rules_text === "string") out.rules_text = printTypography(out.rules_text, "rules");
  if (typeof out.flavor_text === "string") out.flavor_text = printTypography(out.flavor_text, "flavor");
  return out;
}

/** A patch poured into the creator form (an AI fill, an idea, a Scryfall
 *  import, a remix's starting values): its text fields — and its second
 *  face's, and its loyalty / saga rows — as print sets them. Keys that are
 *  absent stay absent. */
export function printTypographyPatch<
  T extends TextPatch & {
    back_face?: TextPatch | null;
    saga_intro?: string;
    loyalty_abilities?: ReadonlyArray<{ text: string }>;
    saga_chapters?: ReadonlyArray<{ text: string }>;
  },
>(patch: T): T {
  const out = textPatch(patch);
  if (out.back_face) out.back_face = textPatch(out.back_face);
  if (typeof out.saga_intro === "string") out.saga_intro = printTypography(out.saga_intro, "rules");
  if (out.loyalty_abilities) {
    out.loyalty_abilities = out.loyalty_abilities.map((row) => ({ ...row, text: printTypography(row.text, "rules") }));
  }
  if (out.saga_chapters) {
    out.saga_chapters = out.saga_chapters.map((row) => ({ ...row, text: printTypography(row.text, "rules") }));
  }
  return out;
}

// ---------------------------------------------------------------------------
// The server — a card payload as it is saved
// ---------------------------------------------------------------------------

// The lengths the schemas allow (lib/validation/card.ts); only rules-style
// text can grow, by one character per unspaced "--".
const RULES_MAX = 4000;
const ROW_MAX = 600;
const INTRO_MAX = 400;

type LoyaltyRow = { cost: string | null; text: string };
type SagaRow = { numerals: number[]; text: string };
type FaceContentText = {
  loyalty?: { abilities: LoyaltyRow[] };
  saga?: { intro?: string | null; chapters: SagaRow[] };
};

type FaceText = {
  title?: string;
  supertype?: string;
  subtypes?: string[];
  rules_text?: string;
  flavor_text?: string;
};

/** The text of a card payload the conversion reads (a structural slice of
 *  createCardSchema / updateCardSchema's output). */
export type TypographyPayload = FaceText & {
  back_face?: FaceText | null;
  face_content?: FaceContentText | null;
};

/** The same text of a stored row. */
export type StoredTypographyText = {
  title?: string | null;
  supertype?: string | null;
  subtypes?: readonly string[] | null;
  rules_text?: string | null;
  flavor_text?: string | null;
  back_face?: unknown;
  face_content?: unknown;
};

/** The rows as the creator serializes them into `rules_text`. */
function serializedRows(face: FaceContentText): string | null {
  if (face.loyalty) return serializeLoyalty(face.loyalty.abilities);
  if (face.saga) return serializeSaga(face.saga.intro, face.saga.chapters);
  return null;
}

/** Whether a field's text is converted: always on a new card; on an edit
 *  only when the save changes it (`stored` is what the row holds). */
type Changed = (next: string, stored: string | null | undefined) => boolean;

function faceText<T extends FaceText>(face: T, stored: StoredTypographyText | null, changed: Changed): T {
  const out = { ...face };
  if (typeof out.title === "string" && changed(out.title, stored?.title)) {
    out.title = printTypography(out.title, "name");
  }
  if (typeof out.supertype === "string" && changed(out.supertype, stored?.supertype)) {
    out.supertype = printTypography(out.supertype, "type");
  }
  if (out.subtypes) {
    const kept = new Set(stored?.subtypes ?? []);
    out.subtypes = out.subtypes.map((subtype) => (changed(subtype, kept.has(subtype) ? subtype : null) ? printTypography(subtype, "type") : subtype));
  }
  if (typeof out.flavor_text === "string" && changed(out.flavor_text, stored?.flavor_text)) {
    out.flavor_text = printTypography(out.flavor_text, "flavor");
  }
  return out;
}

function storedRowTexts(stored: unknown): Set<string> {
  const texts = new Set<string>();
  const face = (stored ?? null) as FaceContentText | null;
  for (const row of face?.loyalty?.abilities ?? []) if (typeof row?.text === "string") texts.add(row.text);
  for (const row of face?.saga?.chapters ?? []) if (typeof row?.text === "string") texts.add(row.text);
  if (typeof face?.saga?.intro === "string") texts.add(face.saga.intro);
  return texts;
}

function apply<T extends TypographyPayload>(data: T, stored: StoredTypographyText | null, changed: Changed): T {
  let out = faceText(data, stored, changed);

  // The rows of a planeswalker or a saga, each its own field in the editor:
  // a row whose text the stored card already holds is left as it is.
  const rawFace = out.face_content ?? null;
  let face = rawFace;
  if (rawFace) {
    const keptRows = storedRowTexts(stored?.face_content);
    const row = (text: string, max: number) => (changed(text, keptRows.has(text) ? text : null) ? within(text, "rules", max) : text);
    face = {
      ...rawFace,
      ...(rawFace.loyalty
        ? { loyalty: { ...rawFace.loyalty, abilities: rawFace.loyalty.abilities.map((r) => ({ ...r, text: row(r.text, ROW_MAX) })) } }
        : {}),
      ...(rawFace.saga
        ? {
            saga: {
              ...rawFace.saga,
              intro: typeof rawFace.saga.intro === "string" ? row(rawFace.saga.intro, INTRO_MAX) : rawFace.saga.intro,
              chapters: rawFace.saga.chapters.map((r) => ({ ...r, text: row(r.text, ROW_MAX) })),
            },
          }
        : {}),
    };
    out = { ...out, face_content: face };
  }

  if (typeof out.rules_text === "string" && changed(out.rules_text, stored?.rules_text)) {
    // A walker's or a saga's rules_text is the creator's serialized copy of
    // its rows: it follows the ROWS (a kept row stays kept in the copy too),
    // never a second reading of the joined text.
    const copyOfRows = rawFace && face && serializedRows(rawFace) === out.rules_text ? serializedRows(face) : null;
    out.rules_text =
      copyOfRows !== null && copyOfRows.length <= RULES_MAX ? copyOfRows : within(out.rules_text, "rules", RULES_MAX);
  }

  if (out.back_face) {
    const storedBack = (stored?.back_face ?? null) as StoredTypographyText | null;
    let back = faceText(out.back_face, storedBack, changed);
    if (typeof back.rules_text === "string" && changed(back.rules_text, storedBack?.rules_text)) {
      back = { ...back, rules_text: within(back.rules_text, "rules", RULES_MAX) };
    }
    out = { ...out, back_face: back };
  }
  return out;
}

/** A NEW card's payload (createCardAction — the creator, the AI jobs, the
 *  deck remix, an import): every text field as print sets it. */
export function withPrintTypography<T extends TypographyPayload>(data: T): T {
  return apply(data, null, () => true);
}

/** An EDIT's patch over the stored row: only the fields whose text the save
 *  CHANGES are converted — a field sent back as it is stored (the creator
 *  resends every revisable field) keeps its stored characters, straight
 *  quotes included. A changed field is converted whole. */
export function withPrintTypographyUpdate<T extends TypographyPayload>(data: T, stored: StoredTypographyText): T {
  return apply(data, stored, (next, kept) => next !== (kept ?? ""));
}
