import type { FrameMatch } from "@/lib/scryfall/frame-signatures";
import type { PrintingTreatment } from "@/lib/scryfall/import-mapper";

// ---------------------------------------------------------------------------
// The import dialog's printings list (TODO 1.5): which slice of a card's
// printings each filter chip asks /api/scryfall/printings for, and the
// trimmed shape every printing comes back in. Client-safe (types and plain
// data only), so the route, the dialog and the tests share one table.
// ---------------------------------------------------------------------------

export const PRINTING_VIEW_VALUES = [
  "representative",
  "all",
  "regular",
  "borderless",
  "showcase",
  "extendedart",
  "fullart",
  "textless",
  "oldborder",
] as const;

export type PrintingView = (typeof PRINTING_VIEW_VALUES)[number];

export const DEFAULT_PRINTING_VIEW: PrintingView = "representative";

/** The filter chips' labels, in chip order. */
export const PRINTING_VIEW_LABELS: Record<PrintingView, string> = {
  representative: "Representative",
  all: "All",
  regular: "Regular",
  borderless: "Borderless",
  showcase: "Showcase",
  extendedart: "Extended art",
  fullart: "Full art",
  textless: "Textless",
  oldborder: "Old border",
};

/**
 * The Scryfall search qualifier each paged view appends to
 * `oracleid:<id>` (unique=prints, newest first). Each one checked on
 * scryfall.com/docs/syntax and against the live API on 2026-09-28 (no
 * "unknown keyword" warning; Plains: 916 printings, 148 `is:full`, 16
 * `is:textless`, 17 `border:borderless`, 440 `-frame:2015`):
 *   • border:borderless — the border colour;
 *   • frame:showcase / frame:extendedart — frame effects ("frame:" takes
 *     an effect as well as a frame year);
 *   • is:full — Scryfall's `full_art` flag;
 *   • is:textless — the `textless` flag (not on the syntax page, but a
 *     live keyword);
 *   • -frame:2015 — the 1993 / 1997 / 2003 borders (and Future Sight);
 *   • regular — none of the above: the plain 2015 frame.
 * `representative` isn't a search: it is the capped strip the dialog opens
 * with (selectRepresentatives in the route). `all` adds nothing.
 */
export const PRINTING_VIEW_QUALIFIERS: Record<Exclude<PrintingView, "representative">, string> = {
  all: "",
  regular:
    "frame:2015 -border:borderless -frame:showcase -frame:extendedart -is:full -is:textless",
  borderless: "border:borderless",
  showcase: "frame:showcase",
  extendedart: "frame:extendedart",
  fullart: "is:full",
  textless: "is:textless",
  oldborder: "-frame:2015",
};

export function isPrintingView(value: unknown): value is PrintingView {
  return (PRINTING_VIEW_VALUES as readonly unknown[]).includes(value);
}

/** The Scryfall `q` for one paged view of an oracle card's printings. */
export function printingsQuery(
  oracleId: string,
  view: Exclude<PrintingView, "representative">,
): string {
  const qualifier = PRINTING_VIEW_QUALIFIERS[view];
  return qualifier ? `oracleid:${oracleId} ${qualifier}` : `oracleid:${oracleId}`;
}

/** THIS PRINTING's frame match, finalized against the verified combos
 *  (withVerification): the dialog's Exact / Nearest / Not available badge. */
export type PrintingMatch = Pick<
  FrameMatch,
  "status" | "exactLabel" | "template" | "reason" | "landOn" | "reject"
>;

/** One printing as the dialog's grid shows it. */
export type PrintingSummary = {
  id: string;
  set: string | null;
  set_name: string | null;
  released_at: string | null;
  collector_number: string | null;
  /** Scryfall border generation: "1993" | "1997" | "2003" | "2015" | "future". */
  frame: string | null;
  /** "black" | "white" | "borderless" | "yellow" | "silver" | "gold". */
  border_color: string | null;
  full_art: boolean;
  textless: boolean;
  snow: boolean;
  devoid: boolean;
  /** The printing's treatment, most visible first (printingTreatmentFromScryfall). */
  treatment: PrintingTreatment | null;
  artist: string | null;
  /** The second face carries its own art (a transform / modal DFC). */
  has_back_image: boolean;
  thumb_url: string | null;
  image_status: string | null;
  /** Null for a card PipGlyph can't make (an Emblem, a Plane). */
  match: PrintingMatch | null;
};

export type PrintingsResponse =
  | {
      ok: true;
      printings: PrintingSummary[];
      /** Another page exists (`page + 1`); always false for representative. */
      has_more: boolean;
      /** Scryfall's count for the whole query (every page). */
      total_cards: number;
    }
  | { ok: false; error: string };

/** The treatment badge on a printing tile ("Borderless", "Full art", …). A
 *  borderless full-art printing says both; a full-art token (whose frame
 *  PipGlyph has, so it carries no treatment) still says "Full art". Null for
 *  a plain printing. */
export function printingTreatmentBadge(
  p: Pick<PrintingSummary, "treatment" | "full_art">,
): string | null {
  const label = p.treatment ? TREATMENT_BADGES[p.treatment] : null;
  if (p.full_art && p.treatment !== "fullart" && p.treatment !== "textless") {
    return label ? `${label} · Full art` : "Full art";
  }
  return label;
}

const TREATMENT_BADGES: Record<PrintingTreatment, string> = {
  borderless: "Borderless",
  showcase: "Showcase",
  extendedart: "Extended art",
  fullart: "Full art",
  textless: "Textless",
};
