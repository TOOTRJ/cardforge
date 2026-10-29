import { FRAME_TEMPLATE_VALUES, type FrameTemplate } from "@/types/card";
import {
  FRAME_SIGNATURE_KEYS,
  FRAME_SIGNATURE_RULES,
  signatureDrawnOn,
  templatesOfRule,
} from "@/lib/scryfall/frame-signatures";
import { isForGoodSignature } from "@/lib/frames/frame-requests";
import { FRAME_COLOR_KEYS, frameComboKey, frameReferenceOptions } from "@/lib/cards/frame-reference-registry";

// ---------------------------------------------------------------------------
// The public "Requested frames" list (TODO NV12, part 1; /frames/requested).
//
// Every Scryfall import whose printing PipGlyph can't draw exactly writes a
// frame_requests row (TODO 1.6, migration 0123) — the admin page counts them
// per signature and set. The public list is the same log, told as a
// roadmap: per frame, how many PEOPLE asked in the last six months and where
// it stands. Migration 0147's requested_frame_counts() publishes only a
// signature and a count of distinct non-admin accounts — counted up to
// today's UTC midnight, and only once REQUESTED_FRAMES_MIN_PEOPLE asked —
// and nothing from the rows themselves.
//
// What a reader sees is decided HERE, never by a row:
//   * the NAME, from the registry: a row's signature and label are whatever
//     text record_frame_request() was handed (the RPC takes any text from a
//     signed-in caller; only the app's own action validates it), so the
//     function returns a signature only when it is one of the keys this
//     module passes (`publicSignatures()`), and the label comes from the
//     rule (`exactLabel` when it is plain text, else the table below) plus a
//     phrase for the missing piece of a gap signature
//     ("borderless/standard+nickname" → "Borderless frame" · "The nickname
//     plate"). A test holds both tables to the registry, key for key;
//   * the STATUS, from the registry and the verified combos
//     (`requestedFrameStatus`) — never from why the latest row was logged,
//     which would flip the moment one person imported again.
//
// Pure and client-safe; the read is lib/frames/requested-frames-queries.ts.
// ---------------------------------------------------------------------------

/** The window the database counts over (fixed in 0147, not a parameter):
 *  180 days up to today's UTC midnight. */
export const REQUESTED_FRAMES_WINDOW_LABEL = "the last six months";

/** k — the fewest distinct people a frame needs before it is listed, so no
 *  count is one person's import. The database applies it
 *  (requested_frame_counts' `min_people`, migration 0147); this mirrors it
 *  for the page's words and a defensive filter, and a test holds the two
 *  together. The owner's to change: a new migration and this constant. */
export const REQUESTED_FRAMES_MIN_PEOPLE = 2;

/** The most signatures / answered pairs one call may pass (0147's
 *  `max_keys`; the database refuses more). A test keeps the app under it. */
export const REQUESTED_FRAMES_MAX_KEYS = 600;

/** Below this many frames the page is thin: noindex, and out of the
 *  sitemap (CLAUDE.md's SEO contract). */
export const REQUESTED_FRAMES_MIN_INDEXED = 3;

/** Where a reader asks for a frame by hand. */
export const REQUEST_A_FRAME_HREF = "/feedback?category=frame_request";

export type RequestedFrameStatus = "requested" | "checking" | "built";

export const REQUESTED_FRAME_STATUS_LABELS: Record<RequestedFrameStatus, string> = {
  requested: "Requested",
  checking: "Being checked",
  built: "Built",
};

export const REQUESTED_FRAME_STATUS_HINTS: Record<RequestedFrameStatus, string> = {
  requested: "PipGlyph doesn't draw this yet. The more people ask, the sooner it's built.",
  checking: "The frame is built. We're checking it against the printed cards, colour by colour, before imports use it.",
  built: "Built and checked in every colour it was printed in. Imports use it now.",
};

/** Signatures that never belong on a roadmap: families PipGlyph will never
 *  build (the registry's `forGood` — posters, The Zeta Set, substitute and
 *  art cards) and these, whose answer no request count changes. */
const NOT_ON_THE_LIST: ReadonlySet<string> = new Set([
  // Planes, schemes, vanguards: not a card PipGlyph makes.
  "no-card-type",
  // The one-off emblems are 4.52's "not planned".
  "emblem/one-off",
  // A frame Scryfall names that the registry doesn't know: no label to give.
  "unknown-frame",
]);

/** A public name for the rules whose `exactLabel` is a function of the
 *  printing (its set, its frame, its kind) — one name for the family. Keyed
 *  by the rule's BASE key, so its gap signatures share it. */
const PUBLIC_RULE_LABELS: Readonly<Record<string, string>> = {
  "emblem/old-frame": "Emblem on an older frame (1993, 1997 or 2003)",
  "emblem/other": "Emblem in another design",
  "borderless/unsupported-set": "Borderless frames of Amonkhet Invocations, Unstable and Transformers",
  "borderless/showcase": "A set's borderless showcase frame",
  "token/old-frame": "Token on an older frame (1993, 1997 or 2003)",
  "token/other-type": "Planeswalker and land tokens",
  "fullart/basic/per-set": "A set's own full-art basic lands",
  "showcase/snc/art-deco": "Streets of New Capenna Art Deco showcase",
  "showcase/dmu/stained-glass": "Dominaria United stained-glass showcase",
  "showcase/afr/sourcebook": "D&D Sourcebook showcase (Forgotten Realms, Baldur's Gate)",
  "showcase/thb/constellation": "Theros constellation showcase",
  masterpiece: "Masterpiece Series frames",
  showcase: "A set's showcase frame",
  "layout/2015": "Saga, adventure, split and other layout frames",
  "layout/older": "Layout frames on an older border",
  "station/2015": "Station frame (Spacecraft and Planets)",
};

/** The missing piece a gap signature names ("…+nickname"), for the line
 *  under the frame's name. Keyed by the registry's gap keys. */
const GAP_PHRASES: Readonly<Record<string, string>> = {
  crown: "The legendary crown",
  "two-colour": "The two-colour split frame",
  "two-colour-hybrid": "The two-colour hybrid frame",
  "part-colour": "Each part in its own colour",
  "colour-indicator": "The colour indicator",
  vehicle: "The Vehicle P/T plate",
  station: "The Station frame",
  "universes-beyond": "The Universes Beyond dress",
  dfc: "The double-faced marks",
  "marvel-variant-face": "Marvel's variant faces",
  "nyx-saga-front": "The Nyx saga front",
  "dfc-token-transform": "Tokens that transform",
  "borderless-dfc-face": "Its borderless back face",
  "parchment-land-back": "Ixalan's parchment land back",
  layout: "Its own layout (Class, Case, Room, leveler, mutate…)",
  omen: "The Omen layout",
  etched: "The foil-etched frame",
  border: "A white, silver or gold border",
  marks: "The frame mark (miracle, companion, lesson…)",
  colourshifted: "The colour-shifted frame",
  "timeshifted-frame": "The 2006 timeshifted redrawing",
  "reprint-colours": "The lighter reprint colours",
  "two-line-footer": "The later two-line footer",
  nickname: "The nickname plate",
  "nyx-dress": "The Nyx dress",
  nyx: "The Nyx starfield",
  "nyx-inverted": "The inverted Nyx frame",
  "nyx-own-frame": "A Nyx frame in the card's own colour",
  "light-box": "The light text box",
  "dark-type-and-box": "The dark type bar and text box",
  "dark-type-bar": "The dark type bar",
  "shadow-box": "The see-through text box",
  "short-box": "The short text box",
  inverted: "The inverted frame",
  "dark-bars": "Dark name and type bars",
  "lettered-name": "The name lettered across the art",
  "row-box": "The other ability box",
  "tall-box": "The tall text box",
  "znr-type-line": "Zendikar Rising's type line",
};

const RULE_BY_KEY = new Map(FRAME_SIGNATURE_RULES.map((rule) => [rule.key, rule]));

/** A signature's base key and its gap ("a/b+gap" → ["a/b", "gap"]). */
export function splitSignature(signature: string): { base: string; gap: string | null } {
  const plus = signature.indexOf("+");
  return plus < 0
    ? { base: signature, gap: null }
    : { base: signature.slice(0, plus), gap: signature.slice(plus + 1) };
}

/** The public name of a signature — the frame, and the piece missing from
 *  it — or null for a key this list doesn't name (unknown, excluded, or a
 *  label this module has no words for). */
export function publicFrameLabel(signature: string): { label: string; detail: string | null } | null {
  if (NOT_ON_THE_LIST.has(signature) || isForGoodSignature(signature)) return null;
  const rule = RULE_BY_KEY.get(signature);
  if (!rule) return null;
  const { base, gap } = splitSignature(signature);
  const label = typeof rule.exactLabel === "string" ? rule.exactLabel : PUBLIC_RULE_LABELS[base];
  if (!label) return null;
  if (gap === null) return { label, detail: null };
  const detail = GAP_PHRASES[gap];
  return detail ? { label, detail } : null;
}

let signaturesMemo: string[] | null = null;
/** The registry keys the list may name — what the page passes the database
 *  as `p_signatures`, so nothing else can come back. */
export function publicSignatures(): string[] {
  signaturesMemo ??= FRAME_SIGNATURE_KEYS.filter((key) => publicFrameLabel(key) !== null);
  return signaturesMemo;
}

let answeredMemo: string[] | null = null;
/** Every "signature|template" pair PipGlyph draws today: a gap signature
 *  logged before its piece shipped, on a frame that draws it now (the admin
 *  page's `drawnNow`, signatureDrawnOn). Passed as `p_answered`; those rows
 *  aren't requests any more. It has to be per row — whether a gap is drawn
 *  depends on the frame the import landed on (era/2015+crown is drawn on 7
 *  of its rule's 18 frames), and the database never returns a row's
 *  template — so the database does the dropping. */
export function answeredSignaturePairs(): string[] {
  answeredMemo ??= FRAME_SIGNATURE_KEYS.filter((key) => key.includes("+")).flatMap((key) =>
    FRAME_TEMPLATE_VALUES.filter((template) => signatureDrawnOn(key, template)).map(
      (template) => `${key}|${template}`,
    ),
  );
  return answeredMemo;
}

/** The frames an import of this signature would be EXACT on once they are
 *  verified: the rule's own frame(s) when the registry answers exact, or
 *  the frame it names once verified when that one is exact (`onceVerified`
 *  + `exactOnceVerified` — the M20 tokens, the tall box, the older full-art
 *  basics…). Empty for a gap signature (its piece is the missing part) and
 *  for a rule with no exact frame. Every frame the rule can land on counts:
 *  a family rule names all of the family's. */
export function exactFramesOfSignature(signature: string): readonly FrameTemplate[] {
  if (splitSignature(signature).gap !== null) return [];
  const rule = RULE_BY_KEY.get(signature);
  if (!rule) return [];
  const { outcome } = rule;
  if (outcome.status === "exact") return templatesOfRule(rule);
  if (outcome.onceVerified !== undefined && outcome.exactOnceVerified === true) {
    // templatesOfRule names the stand-in AND the later frame; only the later
    // one is the frame the printing wears.
    return templatesOfRule({ ...rule, outcome: { ...outcome, template: outcome.onceVerified, onceVerified: undefined } });
  }
  return [];
}

/** Whether a frame is verified in every colour a real printing exists in
 *  (the colours frameReferenceOptions has a printing for — a colour with no
 *  print can't be imported, so it never asks). A frame with no printed
 *  colour at all is never "done": nothing could check it. */
function verifiedInEveryPrintedColour(template: FrameTemplate, verifiedKeys: ReadonlySet<string>): boolean {
  const printed = FRAME_COLOR_KEYS.filter((colour) => frameReferenceOptions(template, colour).length > 0);
  return printed.length > 0 && printed.every((colour) => verifiedKeys.has(frameComboKey(template, colour)));
}

/** Where a frame stands — the registry's answer and the verified combos,
 *  never a row's:
 *    "Built": every frame it would be exact on is verified in every printed
 *      colour — imports of it are exact now;
 *    "Being checked": such a frame exists, but some printed colour of it
 *      isn't verified yet;
 *    "Requested": PipGlyph has no exact frame for it (every gap signature —
 *      the rows of a gap PipGlyph draws today are dropped before they are
 *      counted, `answeredSignaturePairs`). */
export function requestedFrameStatus(
  signature: string,
  verifiedKeys: ReadonlySet<string>,
): RequestedFrameStatus {
  const frames = exactFramesOfSignature(signature);
  if (frames.length === 0) return "requested";
  return frames.every((template) => verifiedInEveryPrintedColour(template, verifiedKeys)) ? "built" : "checking";
}

/** One row of requested_frame_counts() (migration 0147). */
export type RequestedFrameCountRow = {
  signature: string;
  people: number | string;
};

export type RequestedFrame = {
  signature: string;
  label: string;
  /** The piece missing from the frame, for a gap signature. */
  detail: string | null;
  /** Distinct accounts (never an admin's) in the window — at least k. */
  people: number;
  status: RequestedFrameStatus;
};

/** Pure: database rows → the list, most people first. A row whose
 *  signature isn't one this module names (it can't be, unless the function
 *  changes) or that counts fewer than k people is dropped. */
export function mapRequestedFrames(
  rows: readonly RequestedFrameCountRow[],
  verifiedKeys: ReadonlySet<string>,
): RequestedFrame[] {
  const frames: RequestedFrame[] = [];
  for (const row of rows) {
    const name = publicFrameLabel(row.signature);
    const people = Number(row.people) || 0;
    if (!name || people < REQUESTED_FRAMES_MIN_PEOPLE) continue;
    frames.push({
      signature: row.signature,
      label: name.label,
      detail: name.detail,
      people,
      status: requestedFrameStatus(row.signature, verifiedKeys),
    });
  }
  return frames.sort(
    (a, b) =>
      b.people - a.people ||
      a.label.localeCompare(b.label) ||
      (a.detail ?? "").localeCompare(b.detail ?? ""),
  );
}

/** "1 person" / "3 people". */
export function peopleLabel(people: number): string {
  return people === 1 ? "1 person" : `${people} people`;
}
