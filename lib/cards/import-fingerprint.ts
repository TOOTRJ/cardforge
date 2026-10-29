// ---------------------------------------------------------------------------
// A card's import provenance (TODO DK2.5, migration 0144): the Scryfall
// printing it was started from (`cards.import_scryfall_id`) and a fingerprint
// of the card as it was first saved from that import
// (`cards.import_fingerprint`). Both are written by createCardAction's
// insert (lib/cards/import-provenance.ts) — never by a trigger, never by an
// edit: the 0144 guard refuses an API role's change, so neither the editor
// nor a client can move them. The one later writer is a PLATFORM rewrite of
// a covered field, on the trusted path (fingerprintAfterRewrite, below).
//
// "Edited" = ANY change to the card (owner 2026-10-29: "Edited should be
// counted when anything is changed on the card"): the fingerprint covers
// every column a maker can set — the printed text, the colour, the rarity,
// the frame and every anatomy switch in `frame_style` (crown, two-colour,
// collector line, stamp, border, text alignment, self-name, part colour…),
// the picture and its crop / zoom / position, the set icon and collector
// fields, the watermark, the footer text, the structured rows
// (`face_content`: walker, saga and station rows, the station P/T tier), the
// Types field (`printed_types`) and the whole second face (`back_face`). It
// leaves out only what the maker can't set or what isn't the card: ids and
// owner, slug, visibility, tags, the provenance columns themselves, render
// pointers and stamps, counters, timestamps, derived columns.
// IMPORT_FINGERPRINT_FIELDS and IMPORT_FINGERPRINT_EXCLUDED name every
// column of `cards` between them (a test reads types/supabase.ts), so a new
// column is a decision, never a miss.
//
// ONE fingerprint, this module, read everywhere: the create action computes
// it from the row it inserts, the deck pages (lib/decks/entry-status.ts)
// recompute it from the row they read. Both sides are ROW-shaped, so the
// normalisation is only what a database round trip can change: a blank text,
// an empty array or object and an absent key are one "nothing"; an absent
// `lang` is the column's default; a jsonb object's key order never counts.
// `printed_types` and `footer_text` keep "" apart from NULL — there the two
// are different choices (CLAUDE.md "The type line", migration 0090).
//
// Versioned ("v1:" + SHA-256 hex). v1's field list was widened before any
// fingerprint was stored in production (0144 ships with it), so v1 stays v1;
// from here on a change of the field list is a NEW version, and a stored v1
// is compared the v1 way. A platform rewrite of a covered field (a frame
// sweep, a typography fix) keeps an untouched import untouched only by
// re-fingerprinting the rows it changes: fingerprintAfterRewrite, below.
// Pure and synchronous (its own SHA-256, no node:crypto), so the deck list
// computes a status in the browser too.
// ---------------------------------------------------------------------------

/** The `cards` columns the fingerprint covers, in hashing order: everything
 *  a maker can set on the card. */
export const IMPORT_FINGERPRINT_FIELDS = [
  "title",
  "nickname",
  "cost",
  "color_identity",
  "supertype",
  "card_type",
  "subtypes",
  "printed_types",
  "rarity",
  "rules_text",
  "flavor_text",
  "power",
  "toughness",
  "loyalty",
  "defense",
  "artist_credit",
  "art_url",
  "art_position",
  "frame_style",
  "face_content",
  "back_face",
  "watermark",
  "footer_text",
  "set_icon_url",
  "set_icon_code",
  "set_code",
  "collector_number",
  "lang",
] as const;

/** The `cards` columns it leaves out — the maker can't set them, or they
 *  aren't the card. */
export const IMPORT_FINGERPRINT_EXCLUDED = [
  "id",
  "owner_id",
  "slug",
  "visibility",
  "tags",
  "game_system_id",
  "template_id",
  "parent_card_id",
  "back_card_id",
  "source_scryfall_id",
  "import_scryfall_id",
  "import_fingerprint",
  "frame_preview",
  "metadata",
  "oracle_text",
  "mana_value",
  "layout",
  "color_count",
  "search_vector",
  "rendered_image_url",
  "rendered_thumb_url",
  "rendered_back_image_url",
  "rendered_back_thumb_url",
  "rendered_at",
  "layout_version",
  "view_count",
  "likes_count",
  "share_count",
  "created_at",
  "updated_at",
] as const;

export const IMPORT_FINGERPRINT_VERSION = 1;

type Field = (typeof IMPORT_FINGERPRINT_FIELDS)[number];

/** What the fingerprint reads: a card row, an insert, or anything with the
 *  same columns (absent = nothing). */
export type FingerprintCard = Partial<Record<Field, unknown>>;

/** The provenance columns as a row carries them (absent on a database 0144
 *  has not reached: read as "not tracked"). */
export type ImportProvenanceColumns = {
  import_scryfall_id?: string | null;
  import_fingerprint?: string | null;
};

const FINGERPRINT_FORMAT = /^v([1-9][0-9]*):([0-9a-f]{64})$/;

/** Keys whose "" is a choice of its own, never "nothing". */
const BLANK_IS_A_VALUE: ReadonlySet<string> = new Set(["printed_types", "footer_text"]);

/** The language a row has when an insert names none (the column default). */
const DEFAULT_LANG = "en";

/** A value as a database round trip leaves it: trimmed text, "nothing" for
 *  a blank, an empty array or object, objects with sorted keys and their
 *  "nothing" keys dropped. */
function canonical(value: unknown, key?: string): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed) return trimmed;
    return key && BLANK_IS_A_VALUE.has(key) ? "" : null;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    const items = value.map((item) => canonical(item));
    return items.length > 0 ? items : null;
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const inner of Object.keys(value as Record<string, unknown>).sort()) {
      const settled = canonical((value as Record<string, unknown>)[inner], inner);
      if (settled !== null) out[inner] = settled;
    }
    return Object.keys(out).length > 0 ? out : null;
  }
  return null;
}

function fieldValue(card: Record<string, unknown>, field: Field): unknown {
  const value = canonical(card[field], field);
  if (field === "lang") return value ?? DEFAULT_LANG;
  return value;
}

/** The canonical text the fingerprint hashes: the fields in a fixed order,
 *  so no key order of a row or a jsonb object can move it. Exported for the
 *  tests and the seeds' check. */
export function importFingerprintText(card: FingerprintCard): string {
  const row = card as Record<string, unknown>;
  return JSON.stringify([IMPORT_FINGERPRINT_VERSION, IMPORT_FINGERPRINT_FIELDS.map((field) => fieldValue(row, field))]);
}

/** The fingerprint of the card as it is (the stored value's format, 0144's
 *  CHECK: `v<version>:<64 hex>`). */
export function importFingerprintOf(card: FingerprintCard): string {
  return `v${IMPORT_FINGERPRINT_VERSION}:${sha256Hex(importFingerprintText(card))}`;
}

/** Whether a stored fingerprint still describes the card. A fingerprint of
 *  a version this code doesn't know (or a malformed one) never matches. */
export function fingerprintMatches(card: FingerprintCard, stored: string | null | undefined): boolean {
  if (!stored) return false;
  const parsed = FINGERPRINT_FORMAT.exec(stored);
  if (!parsed || Number(parsed[1]) !== IMPORT_FINGERPRINT_VERSION) return false;
  return importFingerprintOf(card) === stored;
}

/**
 * What a card's provenance says about it:
 *   "unchanged"  started from a Scryfall printing and nothing on it changed
 *                since its first save;
 *   "edited"     started from a printing and changed since — or already
 *                changed when it was first saved (an import the maker
 *                altered before saving, an AI restyle: the row keeps the
 *                source with NO fingerprint);
 *   "untracked"  no import recorded: a card made from scratch, a remix, or
 *                any card saved before 0144 (an older import included — the
 *                deck flow derives those from what the entry knows,
 *                lib/decks/entry-status.ts).
 */
export type ImportEditState = "unchanged" | "edited" | "untracked";

export function importEditStateOf(card: FingerprintCard & ImportProvenanceColumns): ImportEditState {
  if (!card.import_scryfall_id) return "untracked";
  return fingerprintMatches(card, card.import_fingerprint) ? "unchanged" : "edited";
}

/**
 * The fingerprint to store beside a PLATFORM rewrite of a card (a frame
 * sweep, a typography fix — not the maker's edit): an untouched import stays
 * untouched (the rewritten row's fingerprint), anything else keeps what it
 * has (an edited import stays edited, an untracked card untracked). Written
 * on the trusted path in the same UPDATE as the change (the service role, a
 * script), which 0144's insert-only guard allows. SQL can't compute it (the
 * canonical text is this module's JSON), so a SQL migration rewrites only
 * rows `where import_fingerprint is null` and leaves the fingerprinted rows
 * to a script that calls this; CLAUDE.md "Decks".
 */
export function fingerprintAfterRewrite(
  before: FingerprintCard & ImportProvenanceColumns,
  after: FingerprintCard,
): string | null {
  const stored = before.import_fingerprint ?? null;
  if (!before.import_scryfall_id || !fingerprintMatches(before, stored)) return stored;
  return importFingerprintOf(after);
}

// ---------------------------------------------------------------------------
// SHA-256 (FIPS 180-4) over the UTF-8 bytes of a string. Synchronous and
// dependency-free, so the module stays safe in the client bundle; a unit
// test holds it to node:crypto.
// ---------------------------------------------------------------------------

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

export function sha256Hex(message: string): string {
  const bytes = new TextEncoder().encode(message);
  // The message, a 1 bit, zeros, then its length in bits (64-bit, big
  // endian): a whole number of 64-byte blocks.
  const blocks = Math.ceil((bytes.length + 9) / 64);
  const padded = new Uint8Array(blocks * 64);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  const bits = bytes.length * 8;
  view.setUint32(padded.length - 8, Math.floor(bits / 0x100000000));
  view.setUint32(padded.length - 4, bits >>> 0);

  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Uint32Array(64);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
    for (let i = 0; i < 64; i++) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + s1 + ch + K[i] + w[i]) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0;
    h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0;
    h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0;
    h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0;
    h[7] = (h[7] + hh) >>> 0;
  }
  return Array.from(h, (word) => word.toString(16).padStart(8, "0")).join("");
}
