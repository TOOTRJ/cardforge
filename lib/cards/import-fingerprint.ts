// ---------------------------------------------------------------------------
// A card's import provenance (TODO DK2.5, migration 0144): the Scryfall
// printing it was started from (`cards.import_scryfall_id`) and a fingerprint
// of what it printed when it was first saved from that import
// (`cards.import_fingerprint`). Both are written ONCE, by createCardAction's
// insert (lib/cards/import-provenance.ts) — never by a trigger, never by an
// edit: the 0144 guard refuses an API role's change, so a platform migration
// that rewrites a card can't move them and neither can the editor.
//
// "Edited" = the card's printed fields today hash to something else than the
// stored fingerprint. ONE fingerprint, this module, read everywhere: the
// create action computes it from the row it inserts, the deck pages
// (lib/decks/entry-status.ts) recompute it from the row they read. Both
// sides are ROW-shaped (the insert and the stored row), so the only
// normalisation is "no text" = "".
//
// The fields are the ones the card PRINTS, as stored (already through print
// typography, TODO 6.11, and the cost through normalizeManaCost — the create
// action's own pipeline), plus its picture: a card whose only change is new
// art is no longer the plain import (owner vocabulary 2026-10-28: Imported =
// "a real card, not yet changed"). Not the frame, the colour, the rarity or
// the set symbol: platform migrations move those on stored cards (0129's
// token text box, the retired templates) and they would turn every such
// import "Edited" by themselves. A face's structured rows
// (`face_content`) are left out too: the editor writes them beside the
// canonical `rules_text`, and an untouched edit's dual write adds them to a
// plain-text walker — the text is what prints.
//
// Versioned ("v1:" + SHA-256 hex): a later change of the field list is a
// new version, and a stored v1 is still compared the v1 way. Pure and
// synchronous (its own SHA-256, no node:crypto), so the deck list computes a
// status in the browser too.
// ---------------------------------------------------------------------------

/** The front-face columns the fingerprint covers, in hashing order. */
export const IMPORT_FINGERPRINT_FIELDS = [
  "title",
  "nickname",
  "cost",
  "supertype",
  "card_type",
  "subtypes",
  "printed_types",
  "rules_text",
  "flavor_text",
  "power",
  "toughness",
  "loyalty",
  "defense",
  "artist_credit",
  "art_url",
] as const;

/** The second face's keys (`cards.back_face`), in hashing order. The
 *  front's minus the nickname (a front-face field, TODO 6.3). */
export const IMPORT_FINGERPRINT_BACK_FIELDS = [
  "title",
  "cost",
  "supertype",
  "card_type",
  "subtypes",
  "printed_types",
  "rules_text",
  "flavor_text",
  "power",
  "toughness",
  "loyalty",
  "defense",
  "artist_credit",
  "art_url",
] as const;

export const IMPORT_FINGERPRINT_VERSION = 1;

type FrontField = (typeof IMPORT_FINGERPRINT_FIELDS)[number];
type BackField = (typeof IMPORT_FINGERPRINT_BACK_FIELDS)[number];

/** What the fingerprint reads: a card row, an insert, or anything with the
 *  same columns (absent = no text). */
export type FingerprintCard = Partial<Record<Exclude<FrontField, "subtypes">, string | null>> & {
  subtypes?: readonly string[] | null;
  back_face?: unknown;
};

/** The provenance columns as a row carries them (absent on a database 0144
 *  has not reached: read as "not tracked"). */
export type ImportProvenanceColumns = {
  import_scryfall_id?: string | null;
  import_fingerprint?: string | null;
};

const FINGERPRINT_FORMAT = /^v([1-9][0-9]*):([0-9a-f]{64})$/;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function words(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((word): word is string => typeof word === "string").map((word) => word.trim()).filter(Boolean);
}

/** `printed_types` keeps its two "empty" meanings apart (CLAUDE.md "The type
 *  line": NULL = the built line, "" = the maker emptied the field). */
function printedTypes(value: unknown): string | null {
  return typeof value === "string" ? value.trim() : null;
}

function fieldValue(source: Record<string, unknown>, field: FrontField | BackField): unknown {
  const value = source[field];
  if (field === "subtypes") return words(value);
  if (field === "printed_types") return printedTypes(value);
  return text(value);
}

/** The canonical text the fingerprint hashes: arrays in a fixed order, so
 *  no key order of a row or a jsonb object can move it. Exported for the
 *  tests and the seeds' check. */
export function importFingerprintText(card: FingerprintCard): string {
  const front = card as Record<string, unknown>;
  const back =
    card.back_face && typeof card.back_face === "object" && !Array.isArray(card.back_face)
      ? (card.back_face as Record<string, unknown>)
      : null;
  return JSON.stringify([
    IMPORT_FINGERPRINT_VERSION,
    IMPORT_FINGERPRINT_FIELDS.map((field) => fieldValue(front, field)),
    back ? IMPORT_FINGERPRINT_BACK_FIELDS.map((field) => fieldValue(back, field)) : null,
  ]);
}

/** The fingerprint of what this card prints (the stored value's format,
 *  0144's CHECK: `v<version>:<64 hex>`). */
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
 *   "unchanged"  started from a Scryfall printing and still prints what it
 *                printed then;
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
