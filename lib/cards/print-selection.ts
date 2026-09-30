import { z } from "zod";
import { isUuid } from "@/lib/ids";
import {
  DEFAULT_SHEET_OPTIONS,
  SHEET_CARD_SIZES,
  SHEET_GAPS,
  SHEET_MARKS,
  type SheetCardSize,
  type SheetGap,
  type SheetMarks,
} from "@/lib/render/sheet-layout";

// ---------------------------------------------------------------------------
// PRINT / DOWNLOAD A SELECTION of cards (TODO 6.15) — My Cards' bulk action
// on your own cards and on the ones you liked. Shared by the manifest route
// (app/api/cards/export/route.ts), the browser pipeline
// (lib/decks/export-client.ts runCardsExport) and the dialog
// (components/cards/print-selection-dialog.tsx); client-safe.
//
// It is the Pro deck export pointed at an id list: the same entitlement
// (Pro — allowBatchExport; the manifest route answers 403 UPGRADE_REQUIRED
// otherwise), the same clean per-card renders from /api/cards/[id]/png, the
// same PDF builder (lib/render/card-pdf.ts buildDeckPdf) and ZIP layout.
// What the selection adds is the sheet options (lib/render/sheet-layout.ts)
// and per-card copies, remembered per browser (localStorage — a per-viewer
// convenience; the dialog works the same without it).
// ---------------------------------------------------------------------------

/** Unique cards per export — the deck export's cap. */
export const MAX_SELECTION_CARDS = 150;
/** Physical copies across all sheets — the deck export's cap. */
export const MAX_SELECTION_COPIES = 150;
/** Copies of one card (the dialog's stepper; the budget above still wins). */
export const MAX_COPIES_PER_CARD = 99;

export const selectionManifestRequestSchema = z.object({
  cards: z
    .array(
      z.object({
        id: z.string().refine(isUuid, "Invalid card id"),
        copies: z.number().int().min(1).max(MAX_COPIES_PER_CARD),
      }),
    )
    .min(1, "Select at least one card.")
    .max(MAX_SELECTION_CARDS, `Select at most ${MAX_SELECTION_CARDS} cards at once.`),
});
export type SelectionManifestRequest = z.infer<typeof selectionManifestRequestSchema>;

/**
 * Hand out at most MAX_SELECTION_COPIES physical cards: duplicate ids fold
 * into the first, the first MAX_SELECTION_CARDS unique cards are kept, each
 * keeps ONE copy, and the extra copies go in order until the budget is
 * spent — so the total never passes the cap, and no card is dropped for a
 * card before it asking for many.
 */
export function budgetCopies<T extends { id: string; copies: number }>(cards: readonly T[]): T[] {
  const unique: T[] = [];
  const indexById = new Map<string, number>();
  for (const card of cards) {
    const copies = Math.max(1, Math.floor(card.copies) || 1);
    const existing = indexById.get(card.id);
    if (existing !== undefined) {
      unique[existing] = { ...unique[existing], copies: unique[existing].copies + copies };
    } else if (unique.length < MAX_SELECTION_CARDS) {
      indexById.set(card.id, unique.length);
      unique.push({ ...card, copies });
    }
  }
  let extra = Math.max(0, MAX_SELECTION_COPIES - unique.length);
  return unique.map((card) => {
    const add = Math.min(card.copies - 1, extra);
    extra -= add;
    return { ...card, copies: 1 + add };
  });
}

// ---------------------------------------------------------------------------
// The dialog's settings — what "Remember the last settings" keeps.
// ---------------------------------------------------------------------------

export const SELECTION_EXPORT_KINDS = ["pdf", "zip"] as const;
export type SelectionExportKind = (typeof SELECTION_EXPORT_KINDS)[number];

export const SELECTION_PDF_LAYOUTS = ["sheet-letter", "sheet-a4", "pages"] as const;
export type SelectionPdfLayout = (typeof SELECTION_PDF_LAYOUTS)[number];

export const SELECTION_IMAGE_SIZES = ["hd", "default"] as const;
export type SelectionImageSize = (typeof SELECTION_IMAGE_SIZES)[number];

export type PrintSelectionSettings = {
  kind: SelectionExportKind;
  layout: SelectionPdfLayout;
  gap: SheetGap;
  marks: SheetMarks;
  cardSize: SheetCardSize;
  /** 1/8 in bleed — PDF (pages and sheets) and the HD ZIP images. */
  bleed: boolean;
  /** ZIP image size; the PDF is always HD. */
  quality: SelectionImageSize;
};

export const DEFAULT_PRINT_SELECTION_SETTINGS: PrintSelectionSettings = {
  kind: "pdf",
  layout: "sheet-letter",
  gap: DEFAULT_SHEET_OPTIONS.gap,
  marks: DEFAULT_SHEET_OPTIONS.marks,
  cardSize: DEFAULT_SHEET_OPTIONS.cardSize,
  bleed: false,
  quality: "hd",
};

/** Per field: a stored value that is no longer valid falls back to its
 *  default instead of discarding the rest. */
const settingsFields = {
  kind: z.enum(SELECTION_EXPORT_KINDS),
  layout: z.enum(SELECTION_PDF_LAYOUTS),
  gap: z.enum(SHEET_GAPS),
  marks: z.enum(SHEET_MARKS),
  cardSize: z.enum(SHEET_CARD_SIZES),
  bleed: z.boolean(),
  quality: z.enum(SELECTION_IMAGE_SIZES),
} as const;

export function parsePrintSelectionSettings(value: unknown): PrintSelectionSettings {
  const out = { ...DEFAULT_PRINT_SELECTION_SETTINGS } as Record<string, unknown>;
  if (value && typeof value === "object") {
    for (const [key, schema] of Object.entries(settingsFields)) {
      const parsed = schema.safeParse((value as Record<string, unknown>)[key]);
      if (parsed.success) out[key] = parsed.data;
    }
  }
  return out as PrintSelectionSettings;
}

export const PRINT_SELECTION_SETTINGS_KEY = "pipglyph:print-selection:v1";

/** The last settings this browser used (defaults when none, or when storage
 *  is blocked — private windows, previews). */
export function loadPrintSelectionSettings(): PrintSelectionSettings {
  try {
    const raw = globalThis.localStorage?.getItem(PRINT_SELECTION_SETTINGS_KEY);
    return parsePrintSelectionSettings(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...DEFAULT_PRINT_SELECTION_SETTINGS };
  }
}

export function savePrintSelectionSettings(settings: PrintSelectionSettings): void {
  try {
    globalThis.localStorage?.setItem(PRINT_SELECTION_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Storage full or blocked — the next visit starts from the defaults.
  }
}

/** The file name of a selection export: one card is named after it, more
 *  after the count — `pipglyph-12-cards-sheets-a4-bleed.pdf`. */
export function selectionExportFilename(
  cards: ReadonlyArray<{ slug: string }>,
  opts: { kind: SelectionExportKind; layout: SelectionPdfLayout; bleed: boolean },
): string {
  const base = cards.length === 1 ? cards[0].slug : `pipglyph-${cards.length}-cards`;
  if (opts.kind === "zip") return `${base}${opts.bleed ? "-bleed" : ""}.zip`;
  const layout = opts.layout === "pages" ? "" : opts.layout === "sheet-a4" ? "-sheets-a4" : "-sheets";
  return `${base}${layout}${opts.bleed ? "-bleed" : ""}.pdf`;
}
