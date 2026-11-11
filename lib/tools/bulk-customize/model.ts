// ---------------------------------------------------------------------------
// Bulk Customize (beta tool `bulk-customize`, migration 0186) — the CHOICES
// the dialog asks and the words it says about them. Pure and client-safe:
// the dialog, the server actions and the unit tests share it.
//
// One batch turns several REAL cards (Scryfall printings — a deck's printing
// entries, collection rows, search results) into the maker's own PipGlyph
// cards with ONE look for all of them and ONE choice of art. It is built
// once: the Collection page, the deck page's selection and the tool page's
// search all open the same dialog (components/tools/bulk-customize/), and
// later tools (the Token Kit's shared style, a "Re-art this deck") reuse the
// same choices and batch.
//
// Owner 2026-11-06: "a slot is something you designed". A card still EXACTLY
// the real card it came from is never saved (lib/cards/exact-copy.ts) — so a
// batch whose choices change nothing is refused before anything is made
// (`choicesChangeSomething`), and a card the planner finds unchanged (its
// look didn't apply) is skipped, never saved.
// ---------------------------------------------------------------------------

import { z } from "zod";
import { STYLE_PRESETS, SURPRISE_PRESET_ID, TWIST_MAX } from "@/lib/ai/presets";
import { WATERMARK_PRESETS } from "@/lib/cards/watermark";

/** The tool's slug in the catalog (lib/tools/catalog.ts) and in SQL
 *  (`has_tool_access`). */
export const BULK_CUSTOMIZE_TOOL_SLUG = "bulk-customize";

/** The most cards one batch makes. A deck's 500 entries are a safety limit;
 *  a batch is one sitting at the dialog (and one Scryfall collection call
 *  per 75), so it is kept well under that. */
export const BULK_CUSTOMIZE_MAX_CARDS = 100;

/** The credits an AI picture costs — one per face painted (a double-faced
 *  card two, as the AI deck remix prices it: lib/scryfall/dfc-import.ts
 *  DFC_REMIX_CREDITS). */
export const BULK_AI_ART_CREDITS_PER_FACE = 1;

// ---------------------------------------------------------------------------
// The choices
// ---------------------------------------------------------------------------

/** One FRAME for every card. "keep" = each printing's own landing (what the
 *  creator's import would give it). Every other look is applied to a card
 *  only where it can wear it — published in the card's colour, right for
 *  its kind (the save's own gates) — and a card it can't keeps its
 *  printing's frame (said per card). Two-part, double-faced, token, saga
 *  and other layout cards always keep their own frame. */
export const BULK_LOOK_VALUES = ["keep", "m15", "borderless", "extended", "retro", "modern", "classic"] as const;
export type BulkLook = (typeof BULK_LOOK_VALUES)[number];

export const BULK_LOOK_LABELS: Record<BulkLook, string> = {
  keep: "Each printing's frame",
  m15: "2015 frame",
  borderless: "Borderless",
  extended: "Extended art",
  retro: "1997 frame",
  modern: "2003 frame",
  classic: "1993 frame",
};

export const BULK_LOOK_HINTS: Record<BulkLook, string> = {
  keep: "The frame each card would get from its printing.",
  m15: "Today's frame (2015 onward).",
  borderless: "Art to the edges.",
  extended: "The art runs under the sides of the frame.",
  retro: "The old border, Mirage to Scourge.",
  modern: "8th Edition to Magic 2014.",
  classic: "Alpha and Beta.",
};

/** The border, on the frames that draw a white one (the 1997 and 2003
 *  frames — lib/cards/white-border.ts). "keep" = the printing's. */
export const BULK_BORDER_VALUES = ["keep", "black", "white"] as const;
export type BulkBorder = (typeof BULK_BORDER_VALUES)[number];

export const BULK_BORDER_LABELS: Record<BulkBorder, string> = {
  keep: "Each printing's border",
  black: "Black",
  white: "White",
};

/** The set symbol. An import draws none (the collector line keeps the
 *  printed set code); "printing" draws the printing's own set symbol where
 *  PipGlyph has its Keyrune glyph. */
export const BULK_SET_SYMBOL_VALUES = ["none", "printing"] as const;
export type BulkSetSymbol = (typeof BULK_SET_SYMBOL_VALUES)[number];

export const BULK_SET_SYMBOL_LABELS: Record<BulkSetSymbol, string> = {
  none: "No set symbol",
  printing: "The printing's set symbol",
};

/** The watermark: "keep" = what a new card starts with (none, or the
 *  PipGlyph Rose a free account's creatures and spells always carry),
 *  "none", or one of PipGlyph's own marks. */
export const BULK_WATERMARK_NONE = "none";
export const BULK_WATERMARK_KEEP = "keep";
export type BulkWatermark = typeof BULK_WATERMARK_KEEP | typeof BULK_WATERMARK_NONE | (typeof WATERMARK_PRESETS)[number]["key"];

export const BULK_WATERMARK_VALUES: readonly BulkWatermark[] = [
  BULK_WATERMARK_KEEP,
  BULK_WATERMARK_NONE,
  ...WATERMARK_PRESETS.map((preset) => preset.key),
];

export function bulkWatermarkLabel(value: BulkWatermark): string {
  if (value === BULK_WATERMARK_KEEP) return "As a new card starts";
  if (value === BULK_WATERMARK_NONE) return "No watermark";
  return WATERMARK_PRESETS.find((preset) => preset.key === value)?.label ?? value;
}

/** The ART: each printing's own art (Scryfall's art crop, as the creator's
 *  import keeps it), none yet (the maker adds their own later — the cards
 *  save private until they have a picture), or a NEW AI picture for every
 *  card in one style (credits, priced before anything is made). */
export const BULK_ART_VALUES = ["keep", "later", "ai"] as const;
export type BulkArt = (typeof BULK_ART_VALUES)[number];

export const BULK_ART_LABELS: Record<BulkArt, string> = {
  keep: "Each printing's art",
  later: "I'll add my own later",
  ai: "New AI art, one style",
};

export const BULK_ART_HINTS: Record<BulkArt, string> = {
  keep: "The art from each real card.",
  later: "No picture yet. The cards stay private until you add one.",
  ai: "A new picture for every card, in the style you pick. Costs credits.",
};

/** Where the new cards are shown. "Add art later" saves every card private
 *  whatever this says (a card with no picture is never published). */
export const BULK_VISIBILITY_VALUES = ["public", "unlisted", "private"] as const;
export type BulkVisibility = (typeof BULK_VISIBILITY_VALUES)[number];

const STYLE_IDS = [SURPRISE_PRESET_ID, ...STYLE_PRESETS.map((preset) => preset.id)] as [string, ...string[]];

export const bulkChoicesSchema = z
  .object({
    look: z.enum(BULK_LOOK_VALUES),
    border: z.enum(BULK_BORDER_VALUES),
    setSymbol: z.enum(BULK_SET_SYMBOL_VALUES),
    watermark: z.enum(BULK_WATERMARK_VALUES as unknown as [BulkWatermark, ...BulkWatermark[]]),
    art: z.enum(BULK_ART_VALUES),
    /** The AI art's style (art: "ai" only): a style preset's id, or
     *  "surprise" for the plain painterly default. */
    artStyle: z.enum(STYLE_IDS),
    /** The maker's own words for the style, beside the preset. */
    artTwist: z.string().max(TWIST_MAX).optional(),
    visibility: z.enum(BULK_VISIBILITY_VALUES),
  })
  .strict();

export type BulkChoices = z.infer<typeof bulkChoicesSchema>;

export const DEFAULT_BULK_CHOICES: BulkChoices = {
  look: "keep",
  border: "keep",
  setSymbol: "none",
  watermark: BULK_WATERMARK_KEEP,
  art: "keep",
  artStyle: SURPRISE_PRESET_ID,
  visibility: "public",
};

/**
 * True when the choices change SOMETHING about the cards, as a whole: a
 * look, a border, a set symbol, a watermark or new AI art. "Each printing's
 * art" and "add my own later" change nothing by themselves — with nothing
 * else picked every card would be the real card it came from, an exact copy
 * (lib/cards/exact-copy.ts), and the batch is refused. A choice that changes
 * something can still leave ONE card unchanged (its look didn't apply): the
 * planner skips that card (planCustomizedCard).
 */
export function choicesChangeSomething(choices: BulkChoices): boolean {
  return (
    choices.look !== "keep" ||
    choices.border !== "keep" ||
    choices.setSymbol !== "none" ||
    choices.watermark !== BULK_WATERMARK_KEEP ||
    choices.art === "ai"
  );
}

/** Why Create is off while the choices change nothing (the dialog's reason
 *  beside the button; the server's refusal says the same). The creator's
 *  EXACT_COPY_SAVE_REASON, in a batch's words. */
export const BULK_EXACT_COPY_REASON =
  "Pick at least one change — a frame, a border, a set symbol, a watermark or new AI art. Unchanged real cards aren't saved as your own: add them to a deck as the real card instead.";

/** The refusal code a start answers with when the choices change nothing
 *  (the card action's EXACT_COPY, at the batch's door). */
export const BULK_EXACT_COPY_CODE = "EXACT_COPY";

// ---------------------------------------------------------------------------
// The sources
// ---------------------------------------------------------------------------

/** Where one card comes from. The server resolves every source from the
 *  caller's OWN rows (a deck entry of a deck they own, a collection row of
 *  theirs) or a Scryfall id — never from anything the browser says about
 *  the card itself. */
export type BulkSource =
  | { kind: "deck_entry"; id: string }
  | { kind: "collection"; id: string }
  | { kind: "scryfall"; id: string };

const UUID = z.string().uuid();
const SCRYFALL_ID = z.string().regex(/^[0-9a-f-]{8,64}$/i);

export const bulkSourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("deck_entry"), id: UUID }).strict(),
  z.object({ kind: z.literal("collection"), id: UUID }).strict(),
  z.object({ kind: z.literal("scryfall"), id: SCRYFALL_ID }).strict(),
]);

export const bulkSourcesSchema = z.array(bulkSourceSchema).min(1).max(BULK_CUSTOMIZE_MAX_CARDS);

/** A stable key per source (de-duplicating a selection). */
export function bulkSourceKey(source: BulkSource): string {
  return `${source.kind}:${source.id.toLowerCase()}`;
}

// ---------------------------------------------------------------------------
// The cost line
// ---------------------------------------------------------------------------

export type BulkCost = {
  /** Cards the batch will make (skipped ones left out). */
  creates: number;
  /** Saved-card slots left AFTER the batch, or null = no limit. */
  slotsLeftAfter: number | null;
  /** Credits the batch costs (AI art), 0 otherwise. */
  credits: number;
};

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/** "Creates 24 cards · 31 slots left · 0 credits" — what the batch costs
 *  before anything is made. The slots are what is left AFTER it; a plan
 *  with no card limit says nothing about slots. */
export function bulkCostLine(cost: BulkCost): string {
  const parts = [`Creates ${plural(cost.creates, "card")}`];
  if (cost.slotsLeftAfter !== null) parts.push(`${plural(Math.max(0, cost.slotsLeftAfter), "slot")} left`);
  parts.push(plural(cost.credits, "credit"));
  return parts.join(" · ");
}

// ---------------------------------------------------------------------------
// How a run ended (the tool's analytics)
// ---------------------------------------------------------------------------

/** What the summary reads of a job step (lib/ai/generation-jobs.ts JobStep). */
type BulkRunStep = { status: string; credits?: number; spend_ref?: string | null };

export type BulkRunEnd = {
  steps: readonly BulkRunStep[];
  /** The plan limit the run stopped on, if any. */
  stoppedBy: "CARD_CAPACITY" | "INSUFFICIENT_CREDITS" | null;
  /** A door error the run couldn't get past (offline, the job is gone). */
  error: string | null;
  /** Cards were still waiting to be made when the run ended. */
  paused: boolean;
  /** Which run of the batch this was: 1 = the first, more = continued or
   *  retried. */
  run: number;
};

/** The batch's running totals at the end of a run (what the next run's
 *  numbers are counted from). */
export type BulkRunTotals = { made: number; credits: number };

/**
 * What ONE ended run of a batch records (`run_finished` — the browser runs
 * the steps, so only the dialog knows a run is over). `made` and `credits`
 * are THIS run's (so they add up across a batch's runs — a batch continued
 * after a stop is two runs): the cards it made, and the credits really
 * spent on them (a made card's settled charge; a failed card's credit went
 * back). `failed` and `left` are where the batch stands now. `stopped` is
 * why the run ended short: the card limit, the credits, a door error, the
 * maker's own Stop ("cancelled") — or "none". Counts and codes only.
 */
export function bulkRunSummary(
  end: BulkRunEnd,
  before: BulkRunTotals = { made: 0, credits: 0 },
): { props: Record<string, string | number>; totals: BulkRunTotals } {
  const made = end.steps.filter((step) => step.status === "done");
  const failed = end.steps.filter((step) => step.status === "failed").length;
  const totals: BulkRunTotals = {
    made: made.length,
    credits: made.reduce((sum, step) => sum + (step.spend_ref ? (step.credits ?? BULK_AI_ART_CREDITS_PER_FACE) : 0), 0),
  };
  return {
    totals,
    props: {
      total: end.steps.length,
      made: Math.max(0, totals.made - before.made),
      failed,
      left: end.steps.length - made.length - failed,
      credits: Math.max(0, totals.credits - before.credits),
      stopped:
        end.stoppedBy === "CARD_CAPACITY"
          ? "capacity"
          : end.stoppedBy === "INSUFFICIENT_CREDITS"
            ? "credits"
            : end.error
              ? "error"
              : end.paused
                ? "cancelled"
                : "none",
      run: end.run,
    },
  };
}

// ---------------------------------------------------------------------------
// One card on its own
// ---------------------------------------------------------------------------

/** One real card customized on its own: the creator pre-fills from the
 *  printing, as a deck entry's Customize does (/create?printing=…). A
 *  collection row's save records the new card on the row. Read and checked
 *  by the create page — the row must be the caller's and hold this
 *  printing. */
export type PrintingPrefill = {
  scryfallId: string;
  name: string;
  collectionRowId: string | null;
};

/** The creator's address for one real card (the dialog's one-card door). */
export function printingCustomizeHref(scryfallId: string, collectionRowId?: string | null): string {
  const params = new URLSearchParams({ printing: scryfallId });
  if (collectionRowId) params.set("collectionRow", collectionRowId);
  return `/create?${params.toString()}`;
}
