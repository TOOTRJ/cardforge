import { z } from "zod";
import { FRAME_TEMPLATE_SET, FRAME_TEMPLATE_VALUES, type FrameTemplate } from "@/types/card";
import { isUuid } from "@/lib/ids";
import {
  FRAME_SIGNATURE_RULES,
  blockedByOn,
  borderedLandingOf,
  isKnownFrameSignature,
  legacyTallBoxAnswered,
  signatureDrawnOn,
  templatesOfRule,
  type FrameMatch,
} from "@/lib/scryfall/frame-signatures";
import { importFrameColorKey, withVerification } from "@/lib/creator/frame-resolve";
import { CARD_KIND_VALUES, templateSupportsKind, type CardKind } from "@/lib/creator/card-kinds";
import { FRAME_COLOR_KEYS, frameComboKey, frameReferenceOptions } from "@/lib/cards/frame-reference-registry";
import type { ScryfallImportPatch } from "@/lib/scryfall/import-mapper";

// ---------------------------------------------------------------------------
// The "most-requested missing frames" log (TODO 1.6, migration 0123): every
// Scryfall import whose printing PipGlyph can't reproduce exactly writes one
// frame_requests row — the registry's signature and label, the printing, the
// frame the card landed on and, when the art came along, what that art is
// (TODO 1.18) — and WHY it was logged: no exact frame ('missing': the
// registry's nearest or unsupported answer), or an exact frame not verified
// in the card's colour yet ('unverified', owner decision D1 2026-09-29).
// /admin/frame-requests counts them per signature + set in those two groups,
// most distinct users first, and that order decides which frames get built
// (frames plan 4.7 / 4.11) or verified next.
//
// Pure and client-safe: the creator builds the row here and hands it to
// recordFrameRequestAction (lib/frames/frame-request-actions.ts), which
// validates it with frameRequestSchema before the RPC.
// ---------------------------------------------------------------------------

export const FRAME_REQUEST_STATUSES = ["nearest", "unsupported"] as const;
export type FrameRequestStatus = (typeof FRAME_REQUEST_STATUSES)[number];

/** Why a row is logged (owner decision D1, 2026-09-29): */
export const FRAME_REQUEST_CAUSES = ["missing", "unverified"] as const;
/** 'missing' — the registry has no exact frame for this printing (its
 *  nearest or unsupported answer): something to BUILD. 'unverified' — the
 *  registry's exact frame exists but isn't verified in the card's colour
 *  (withVerification downgraded it): something to VERIFY. Always
 *  `nearest`. */
export type FrameRequestCause = (typeof FRAME_REQUEST_CAUSES)[number];

export const FRAME_REQUEST_CAUSE_LABELS: Record<FrameRequestCause, string> = {
  missing: "Missing frames",
  unverified: "Not yet verified",
};

export const FRAME_REQUEST_SOURCES = ["import", "deck_prefill"] as const;
/** The import dialog, or the /create?deckCard pre-fill. */
export type FrameRequestSource = (typeof FRAME_REQUEST_SOURCES)[number];

export const FRAME_REQUEST_ART_FLAGS = ["window-cropped", "frame-in-crop"] as const;
/** What the imported art_crop is (TODO 1.18): the M15 window on a borderless
 *  printing, or a crop with printed frame pieces on a full-art / textless
 *  one. */
export type FrameRequestArtFlag = (typeof FRAME_REQUEST_ART_FLAGS)[number];

/** One frame_requests row, as recordFrameRequestAction takes it. */
export type FrameRequestInput = {
  signature: string;
  label: string;
  setCode: string | null;
  collectorNumber: string | null;
  scryfallId: string | null;
  status: FrameRequestStatus;
  /** Why it is logged; 'unverified' only with status 'nearest'. */
  cause: FrameRequestCause;
  /** The frame the card landed on. */
  template: FrameTemplate | null;
  artFlag: FrameRequestArtFlag | null;
  source: FrameRequestSource;
};

/** Scryfall set codes are 2–6 lower-case letters and digits today ("dmu",
 *  "pl24", "p30a"); 10 is the column's cap. */
export const FRAME_REQUEST_SET_PATTERN = /^[a-z0-9]{2,10}$/;

/** The action's validation — the DB CHECKs, plus the app's vocabularies (a
 *  registry signature, a PipGlyph template) that the table can't know. */
export const frameRequestSchema = z
  .object({
    signature: z
      .string()
      .min(1)
      .max(120)
      .refine((value) => isKnownFrameSignature(value), "Unknown frame signature."),
    label: z.string().trim().min(1).max(160),
    setCode: z.string().regex(FRAME_REQUEST_SET_PATTERN).nullable(),
    collectorNumber: z.string().trim().min(1).max(16).nullable(),
    scryfallId: z
      .string()
      .refine((value) => isUuid(value), "Not a Scryfall id.")
      .nullable(),
    status: z.enum(FRAME_REQUEST_STATUSES),
    cause: z.enum(FRAME_REQUEST_CAUSES),
    template: z.enum(FRAME_TEMPLATE_VALUES).nullable(),
    artFlag: z.enum(FRAME_REQUEST_ART_FLAGS).nullable(),
    source: z.enum(FRAME_REQUEST_SOURCES),
  })
  // An unverified exact frame is only ever downgraded to nearest (the
  // table's frame_requests_unverified_is_nearest CHECK).
  .refine((row) => row.cause !== "unverified" || row.status === "nearest", {
    message: "An unverified frame is logged as nearest.",
    path: ["cause"],
  });

type PatchForRequest = Pick<
  ScryfallImportPatch,
  | "frame_match"
  | "frame_template"
  | "color_identity"
  | "printed_plain_land_master"
  | "printing"
  | "printing_treatment"
  | "printing_detail"
  | "source_scryfall_id"
>;

/**
 * What the imported art is, for the request row (TODO 1.18). Null without
 * imported art. A full-art or textless printing's crop carries printed
 * frame pieces or is window-shaped anyway ('frame-in-crop'); a borderless
 * printing's crop is the M15 window ('window-cropped', 626×457 on DMU #435).
 * Reads `printing` (the patch since 1.6), else the 1.16 treatment fields an
 * older cached patch carries.
 */
export function artFlagForImport(
  patch: Pick<PatchForRequest, "printing" | "printing_treatment" | "printing_detail">,
  artImported: boolean,
): FrameRequestArtFlag | null {
  if (!artImported) return null;
  const printing = patch.printing;
  const fullArt = printing?.full_art ?? patch.printing_detail?.fullArt ?? false;
  const textless = printing?.textless ?? patch.printing_detail?.textless ?? false;
  const borderless = printing
    ? printing.border_color === "borderless"
    : patch.printing_treatment === "borderless";
  if (fullArt || textless) return "frame-in-crop";
  if (borderless) return "window-cropped";
  return null;
}

/**
 * The frame_requests row for an import, or null when there is nothing to
 * log: the final match is exact (the static registry match, finalized
 * against the verified combos when `verifiedKeys` is given — the
 * /api/scryfall/named route already did that for its own patch), or the
 * patch carries no match (an older cached patch). The row's cause comes
 * from that finalization: withVerification marks the exact frames it
 * downgraded `unverified`; any other inexact answer is the registry's own
 * ('missing').
 */
export function frameRequestFromImport(
  patch: PatchForRequest,
  options: {
    artImported: boolean;
    source: FrameRequestSource;
    /** The template the form ended up on, after resolveImportFrame; else the
     *  match's own `landOn ?? template`. */
    landedTemplate?: FrameTemplate | null;
    verifiedKeys?: ReadonlySet<string>;
  },
): FrameRequestInput | null {
  const raw = patch.frame_match;
  if (!raw) return null;
  // Verified in the key the card paints on its landing (a two-colour
  // Expedition's plain land master `c`, TODO 4.11), as the import is.
  const match = options.verifiedKeys
    ? withVerification(raw, importFrameColorKey(raw.landOn ?? raw.template, patch), options.verifiedKeys)
    : raw;
  if (match.status === "exact") return null;

  const set = (patch.printing?.set ?? patch.printing_detail?.set ?? "").trim().toLowerCase();
  const collector = (patch.printing?.collector_number ?? "").trim();
  return {
    signature: match.signature,
    label: match.exactLabel.slice(0, 160),
    setCode: FRAME_REQUEST_SET_PATTERN.test(set) ? set : null,
    collectorNumber: collector && collector.length <= 16 ? collector : null,
    scryfallId: isUuid(patch.source_scryfall_id) ? patch.source_scryfall_id : null,
    status: match.status,
    cause: frameRequestCause(match),
    template: options.landedTemplate ?? match.landOn ?? match.template,
    artFlag: artFlagForImport(patch, options.artImported),
    source: options.source,
  };
}

/** Why an inexact (finalized) match is logged — see FrameRequestCause. */
export function frameRequestCause(
  match: Pick<FrameMatch, "status" | "unverified">,
): FrameRequestCause {
  return match.unverified === true && match.status === "nearest" ? "unverified" : "missing";
}

const RULE_BY_KEY = new Map(FRAME_SIGNATURE_RULES.map((rule) => [rule.key, rule]));

/** A family PipGlyph will never build (artist-lettered posters, The Zeta
 *  Set's frameless cards, substitute and art cards): collapsed on the admin
 *  page, since no request count changes the answer. */
export function isForGoodSignature(signature: string): boolean {
  return RULE_BY_KEY.get(signature)?.outcome.forGood === true;
}

/** The TODO item the registry says would make this signature exact
 *  ("4.6"), or null. The rule's own answer — the kind and border checks can
 *  add a reason for one printing, never a different item; where the item
 *  depends on the frame the printing landed on (the layout frames'
 *  two-colour gap: 4.26 on split and aftermath, 4.6f elsewhere) the logged
 *  row's template decides. */
export function signatureBlockedBy(signature: string, template: string | null = null): string | null {
  const item = RULE_BY_KEY.get(signature)?.outcome.blockedBy;
  const on = template != null && Object.prototype.hasOwnProperty.call(FRAME_TEMPLATE_SET, template) ? (template as FrameTemplate) : null;
  return blockedByOn(item, on) ?? null;
}

/** The Scryfall page of a printing, or null without a set + number. */
export function scryfallPrintingUrl(
  setCode: string | null,
  collectorNumber: string | null,
): string | null {
  if (!setCode || !collectorNumber) return null;
  return `https://scryfall.com/card/${encodeURIComponent(setCode)}/${encodeURIComponent(collectorNumber)}`;
}

// ---------------------------------------------------------------------------
// Is a logged row answered (frames audit 2026-11-22)? A row keeps the
// signature its printing had and the frame it LANDED on — never its colour,
// border or faces — so the answer is read from what it carries: the frame
// draws the row's piece (signatureDrawnOn), the printing it stands for lands
// on a frame that does now that that frame is verified (below), or the
// arch's tall box (legacyTallBoxAnswered, by its set). The admin page asks
// per row (frameRequestAnswered, with the row's set); the public list per
// signature and frame (lib/frames/requested-frames.ts
// answeredSignaturePairs), which has no set.
// ---------------------------------------------------------------------------

/** The sets whose printings on the 1997 and 2003 frames are white-bordered
 *  in every non-foil printing — TODO 4.30's own (Fifth to Ninth Edition,
 *  Anthologies, Deckmasters: tests/unit/scryfall/fixtures/
 *  white-border-printings.json); their black-bordered foils log no
 *  "+border" row. A set not listed keeps its "+border" rows open — a World
 *  Championship deck (gold), Unglued / Unhinged (silver) — so the list can
 *  be short of a white set, never wrong about one. */
const WHITE_BORDER_ROW_SETS: ReadonlySet<string> = new Set(["5ed", "6ed", "7ed", "ath", "dkm", "8ed", "9ed"]);

/** The printed border a request row's set says, where it says one. */
export function printedBorderOfRowSet(setCode: string | null | undefined): "white" | undefined {
  return setCode && WHITE_BORDER_ROW_SETS.has(setCode.trim().toLowerCase()) ? "white" : undefined;
}

/** Whether a frame is verified in every colour a real printing exists in
 *  (the colours frameReferenceOptions has a printing for — a colour with no
 *  print can't be imported, so it never asks). A frame with no printed
 *  colour at all is never "done": nothing could check it. */
export function verifiedInEveryPrintedColour(template: FrameTemplate, verifiedKeys: ReadonlySet<string>): boolean {
  const printed = FRAME_COLOR_KEYS.filter((colour) => frameReferenceOptions(template, colour).length > 0);
  return printed.length > 0 && printed.every((colour) => verifiedKeys.has(frameComboKey(template, colour)));
}

const kindsMemo = new Map<FrameTemplate, ReadonlySet<CardKind>>();
const kindsOf = (template: FrameTemplate): ReadonlySet<CardKind> => {
  let kinds = kindsMemo.get(template);
  if (!kinds) {
    kinds = new Set(CARD_KIND_VALUES.filter((kind) => templateSupportsKind(template, kind)));
    kindsMemo.set(template, kinds);
  }
  return kinds;
};

const isTemplate = (value: string | null | undefined): value is FrameTemplate =>
  value != null && Object.prototype.hasOwnProperty.call(FRAME_TEMPLATE_SET, value);

/**
 * Whether a gap row logged on a STAND-IN is answered now that the frame it
 * stood in for is verified: the "+nyx" rows logged on the M15 frame before
 * the Nyx frame was ticked, the extended-art Spacecraft on the extended-art
 * frame, the borderless Spacecraft on the artifact frame. The row names a frame the
 * rule lands its printings on before (its own frames, or the bordered
 * landing of an edge-to-edge one); the frames the printing lands on once
 * verified are the ones its rule names — exact there (`onceVerified` +
 * `exactOnceVerified`), or the stand-in landing of a dress offered only as
 * a pick (`landOnOnceVerified.answersRows`) — and of those, the ones that
 * dress a kind the logged frame dresses (the row's printing is one of
 * them — never a Nyx land on the Nyx frame). Answered when every such frame
 * draws the row's piece and is verified in every printed colour — every
 * one, since a row carries no colour, and a frame no printing exists for is
 * never done (verifiedInEveryPrintedColour): so the M20 token's crown stays
 * open on the arch — three Nyx heights of its family print nothing. A row
 * logged on the later frame itself is signatureDrawnOn's.
 * The "+dfc" rows can't be read this way: the transform printings logged
 * `era/2015+dfc` on the standard frame before the double-faced bodies, and
 * today's live cause — FIN's transform cards whose back is a Saga creature
 * (4.5d part B) — logs the very same signature and frame, with nothing in
 * the row to tell them apart. They stay open (and leave the windows).
 */
export function signatureAnsweredOnceVerified(
  signature: string,
  template: string | null | undefined,
  verifiedKeys: ReadonlySet<string>,
): boolean {
  const rule = RULE_BY_KEY.get(signature);
  if (!rule || !signature.includes("+") || !isTemplate(template)) return false;
  const { outcome } = rule;
  const later: FrameTemplate[] = [];
  if (outcome.onceVerified !== undefined && outcome.exactOnceVerified === true) {
    later.push(...templatesOfRule({ ...rule, outcome: { ...outcome, template: outcome.onceVerified, onceVerified: undefined } }));
  }
  if (outcome.landOnOnceVerified?.answersRows) later.push(outcome.landOnOnceVerified.template);
  if (later.length === 0 || later.includes(template)) return false;
  const before = templatesOfRule({ ...rule, outcome: { ...outcome, onceVerified: undefined } });
  if (!before.includes(template) && !before.some((frame) => borderedLandingOf(frame) === template)) return false;
  const kinds = kindsOf(template);
  const frames = later.filter((frame) => [...kindsOf(frame)].some((kind) => kinds.has(kind)));
  return (
    frames.length > 0 &&
    frames.every((frame) => signatureDrawnOn(signature, frame) && verifiedInEveryPrintedColour(frame, verifiedKeys))
  );
}

/** Whether one admin-page row (a signature, its set, the frame it landed
 *  on) is answered today — see the section above. */
export function frameRequestAnswered(
  row: { signature: string; template: string | null; setCode: string | null },
  verifiedKeys: ReadonlySet<string>,
): boolean {
  return (
    signatureDrawnOn(row.signature, row.template, printedBorderOfRowSet(row.setCode)) ||
    signatureAnsweredOnceVerified(row.signature, row.template, verifiedKeys) ||
    legacyTallBoxAnswered(row.signature, row.setCode, verifiedKeys)
  );
}
