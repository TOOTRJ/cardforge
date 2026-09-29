import { z } from "zod";
import { FRAME_TEMPLATE_VALUES, type FrameTemplate } from "@/types/card";
import { isUuid } from "@/lib/ids";
import {
  FRAME_SIGNATURE_RULES,
  isKnownFrameSignature,
} from "@/lib/scryfall/frame-signatures";
import { withVerification } from "@/lib/creator/frame-resolve";
import { pickFrameColorKey } from "@/components/cards/frame-layer";
import type { ScryfallImportPatch } from "@/lib/scryfall/import-mapper";

// ---------------------------------------------------------------------------
// The "most-requested missing frames" log (TODO 1.6, migration 0123): every
// Scryfall import whose printing PipGlyph can't reproduce exactly writes one
// frame_requests row — the registry's signature and label, the printing, the
// frame the card landed on and, when the art came along, what that art is
// (TODO 1.18). /admin/frame-requests counts them per signature + set, and
// that order decides which frames get built next (frames plan 4.7 / 4.11).
//
// Pure and client-safe: the creator builds the row here and hands it to
// recordFrameRequestAction (lib/frames/frame-request-actions.ts), which
// validates it with frameRequestSchema before the RPC.
// ---------------------------------------------------------------------------

export const FRAME_REQUEST_STATUSES = ["nearest", "unsupported"] as const;
export type FrameRequestStatus = (typeof FRAME_REQUEST_STATUSES)[number];

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
export const frameRequestSchema = z.object({
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
  template: z.enum(FRAME_TEMPLATE_VALUES).nullable(),
  artFlag: z.enum(FRAME_REQUEST_ART_FLAGS).nullable(),
  source: z.enum(FRAME_REQUEST_SOURCES),
});

type PatchForRequest = Pick<
  ScryfallImportPatch,
  | "frame_match"
  | "frame_template"
  | "color_identity"
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
 * patch carries no match (an older cached patch).
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
  const match = options.verifiedKeys
    ? withVerification(raw, pickFrameColorKey(patch.color_identity ?? []), options.verifiedKeys)
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
    template: options.landedTemplate ?? match.landOn ?? match.template,
    artFlag: artFlagForImport(patch, options.artImported),
    source: options.source,
  };
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
 *  add a reason for one printing, never a different item. */
export function signatureBlockedBy(signature: string): string | null {
  return RULE_BY_KEY.get(signature)?.outcome.blockedBy ?? null;
}

/** The Scryfall page of a printing, or null without a set + number. */
export function scryfallPrintingUrl(
  setCode: string | null,
  collectorNumber: string | null,
): string | null {
  if (!setCode || !collectorNumber) return null;
  return `https://scryfall.com/card/${encodeURIComponent(setCode)}/${encodeURIComponent(collectorNumber)}`;
}
