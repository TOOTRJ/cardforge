import { z } from "zod";
import {
  DEFAULT_SHEET_OPTIONS,
  SHEET_CARD_SIZES,
  SHEET_GAPS,
  SHEET_MARKS,
  type SheetOptions,
  type SheetPaper,
} from "@/lib/render/sheet-layout";

// ---------------------------------------------------------------------------
// ONE card's PDF download (/api/cards/[id]/pdf) — the link the download
// modal builds, the query the route reads and the file name both give it
// (TODO 6.15: the sheet options on the single-card sheet). Client-safe.
//
//   layout=card                     one card on a 2.5 × 3.5 in page (+ bleed)
//   layout=sheet&paper=letter|a4    a sheet of copies of the card, with the
//                                   sheet options of lib/render/sheet-layout.ts:
//     gap=sixteenth                 1/16 in between cards (default: none)
//     marks=lines                   full-length cut lines (default: corners)
//     size=mm                       63 × 88 mm cards (default: 2.5 × 3.5 in)
//     bleed=1                       every card with its 1/8 in bleed; the
//                                   grid makes room (Letter turns landscape,
//                                   3 × 2; A4 4 × 2 — planSheet)
//
//   faces (TODO 5.3, a double-faced card):
//     face=back                     the BACK face alone (one card, or a
//                                   sheet of backs)
//     faces=both                    one card: TWO pages, the front then
//                                   the back
//     backs=0                       a sheet: the front only — by default a
//                                   sheet places the back beside its front
//                                   (a proxy of a DFC without its back is
//                                   unplayable), so only turning it OFF is
//                                   named in the link
//
// A default option is left out of the link, so the plain 3 × 3 sheet keeps
// the URL it always had (`layout=sheet&paper=letter`).
// ---------------------------------------------------------------------------

/** What the modal asks for: one card, or a sheet on Letter / A4. */
export type CardPdfLayout = "card" | "sheet-letter" | "sheet-a4";

/** The sheet options a link carries (the bleed is its own flag). */
export type CardPdfSheetOptions = Omit<SheetOptions, "bleed">;

/** Which face(s) a card PDF holds (TODO 5.3): the front (the default, as
 *  every link before 5.3), the back alone, or both — two pages for one
 *  card, front-beside-back on a sheet. */
export type CardPdfFaces = "front" | "back" | "both";

/** The faces a request names: `face=back` the back alone, `faces=both` both
 *  (one card: two pages); on a sheet both is the DEFAULT unless `backs=0`
 *  (a sheet of a double-faced card carries its backs). A request naming
 *  nothing is the front — exactly the PDF every link before 5.3 got — on
 *  the one-card layout. */
export function parsePdfFaces(params: URLSearchParams, layout: "card" | "sheet"): CardPdfFaces {
  if (params.get("face") === "back") return "back";
  if (params.get("faces") === "both") return "both";
  if (layout === "sheet") return params.get("backs") === "0" ? "front" : "both";
  return "front";
}

const gapParam = z.enum(SHEET_GAPS);
const marksParam = z.enum(SHEET_MARKS);
const sizeParam = z.enum(SHEET_CARD_SIZES);

/** The paper of a sheet layout. */
export function paperOf(layout: Exclude<CardPdfLayout, "card">): SheetPaper {
  return layout === "sheet-a4" ? "a4" : "letter";
}

/** The sheet options named in a query — an unknown or missing value is the
 *  default (the old 3 × 3 sheet). */
export function parseSheetQuery(params: URLSearchParams): CardPdfSheetOptions {
  const pick = <T>(schema: z.ZodType<T>, value: string | null, fallback: T): T => {
    const parsed = schema.safeParse(value);
    return parsed.success ? parsed.data : fallback;
  };
  return {
    gap: pick(gapParam, params.get("gap"), DEFAULT_SHEET_OPTIONS.gap),
    marks: pick(marksParam, params.get("marks"), DEFAULT_SHEET_OPTIONS.marks),
    cardSize: pick(sizeParam, params.get("size"), DEFAULT_SHEET_OPTIONS.cardSize),
  };
}

/** The pdf route's URL for one card. `faces` (TODO 5.3, a double-faced
 *  card) is named only when it is not the layout's default — the back, both
 *  faces of one card, a sheet WITHOUT backs (`backs=0`); a caller that names
 *  none (every single-faced card) gets the link it always had. */
export function cardPdfHref(
  cardId: string,
  opts: { layout: CardPdfLayout; bleed: boolean; sheet?: Partial<CardPdfSheetOptions>; faces?: CardPdfFaces },
): string {
  const query =
    opts.layout === "card" ? ["layout=card"] : ["layout=sheet", `paper=${paperOf(opts.layout)}`];
  if (opts.layout !== "card") {
    const sheet = { ...DEFAULT_SHEET_OPTIONS, ...opts.sheet };
    if (sheet.gap !== DEFAULT_SHEET_OPTIONS.gap) query.push(`gap=${sheet.gap}`);
    if (sheet.marks !== DEFAULT_SHEET_OPTIONS.marks) query.push(`marks=${sheet.marks}`);
    if (sheet.cardSize !== DEFAULT_SHEET_OPTIONS.cardSize) query.push(`size=${sheet.cardSize}`);
  }
  if (opts.bleed) query.push("bleed=1");
  if (opts.faces === "back") query.push("face=back");
  else if (opts.layout === "card" && opts.faces === "both") query.push("faces=both");
  else if (opts.layout !== "card" && opts.faces === "front") query.push("backs=0");
  return `/api/cards/${cardId}/pdf?${query.join("&")}`;
}

/** The file name: `<slug>.pdf`, `<slug>-bleed.pdf`, `<slug>-sheet.pdf`,
 *  `<slug>-sheet-a4.pdf`, `<slug>-sheet-bleed.pdf`, `<slug>-sheet-a4-bleed.pdf`
 *  — `<slug>-back….pdf` for the back alone, `<slug>-both-faces.pdf` for the
 *  two-page card (a sheet with backs keeps its name: that is its default). */
export function cardPdfFilename(
  slug: string,
  opts: { layout: CardPdfLayout; bleed: boolean; faces?: CardPdfFaces },
): string {
  const faces = opts.faces ?? "front";
  const base = faces === "back" ? `${slug}-back` : faces === "both" && opts.layout === "card" ? `${slug}-both-faces` : slug;
  const layout = opts.layout === "card" ? "" : opts.layout === "sheet-a4" ? "-sheet-a4" : "-sheet";
  return `${base}${layout}${opts.bleed ? "-bleed" : ""}.pdf`;
}
