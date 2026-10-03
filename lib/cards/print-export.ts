import { z } from "zod";
import { faceQuery, type CardFace } from "@/lib/cards/card-face";

// ---------------------------------------------------------------------------
// PRINT exports of one card (TODO 6.1a bleed, 6.1b 800 ppi, on 6.10's
// full-resolution art path — lib/render/card-print.ts draws them). Shared by
// the png/pdf routes and the download modal (client-safe, no imports but
// zod), so the link, the file name and the served bytes agree.
//
// Sizes. A card is 2.5 × 3.5 in at trim. The HD render (1500 × 2100) is
// 600 ppi; the 800 ppi export is 2000 × 2800. The bleed adds 1/8 in
// (3.175 mm) on every side — 75 px at 600 ppi (1650 × 2250), 100 px at 800
// (2200 × 3000) — extending the card past the trim line, never scaling it:
// the trim box is the same card, pixel for pixel, as the export without
// bleed. A landscape render (Battle, Split) swaps width and height.
//
// Both are print outputs: always SQUARE corners (TODO 3.26 — a bleed can't
// be round, and a print is cut along the rectangle) and always drawn live
// (never stored), PNG only (6.1b); the bleed also comes as a single-card PDF
// with crop marks on the trim line (6.1a, lib/render/card-pdf.ts).
//
// Entitlement: the bleed is a clean-download feature (the same gate as the
// clean HD PNG — TODO 6.1a). 800 ppi is paid-only too, behind the ONE
// constant below while its [decide] is open (TODO 6.1b).
//
// The 600 ppi PRINT render without a bleed (`print=1`, TODO 6.15): the HD
// card's 1500 × 2100 with the art at full resolution (6.10) instead of the
// bake's 1600 px inlined copy — what every Pro export (deck and selection
// PDFs, their HD ZIP images) prints from. Clean-download only, like the
// bleed: a watermarked viewer's image is capped at 750 px.
//
// MakePlayingCards (TODO 6.1, `bleed=mpc`): the image MPC's upload asks for
// on a poker-size card — its own bleed PER AXIS (MPC_BLEED_IN), always
// PORTRAIT (a Battle or Split is turned into the card the way every print
// turns it, lib/render/card-pdf.ts). Otherwise the bleed's rules: square,
// live, PNG only, clean-download only.
// ---------------------------------------------------------------------------

/** The print resolutions a card image comes in: 600 ppi is the HD render
 *  (1500 × 2100), 800 ppi the 6.1b export (2000 × 2800). */
export const PRINT_PPIS = [600, 800] as const;
export type PrintPpi = (typeof PRINT_PPIS)[number];

/** What the png route renders when the request names no (or an unknown)
 *  `ppi`: the HD render it always served. */
export const DEFAULT_PRINT_PPI: PrintPpi = 600;

/** The card's trim size, in inches (portrait). */
export const CARD_TRIM_IN = { width: 2.5, height: 3.5 } as const;

/** The bleed on every side, in inches: 1/8 in = 3.175 mm (TODO 6.1a). */
export const BLEED_IN = 0.125;

/** A bleed PER AXIS, in inches, on the PORTRAIT card: `x` on its left and
 *  right edges, `y` on its top and bottom (a landscape render is the card
 *  turned, so its horizontal edges take `y` — lib/render/card-print.ts). */
export type BleedInches = { x: number; y: number };

/**
 * MakePlayingCards' poker-size card (2.5 × 3.5 in), as MPC's own upload pages
 * ask for it (checked 2026-09-29): "the minimum image upload size
 * requirements are 822 x 1122 pixels (300DPI)", of which "36 pixels each
 * side based on a 300DPI image" is bleed, scaled with the resolution ("If
 * your image upload is 900DPI, then the bleeding area for each side would
 * multiply to 108px") — https://www.makeplayingcards.com/pops/faq-photo.html,
 * and the product page's "1/8" (approx 36 pixels based on a 300dpi image)"
 * (…/design/custom-blank-card-traditional-size.html). So 36 / 300 in =
 * 0.12 in on BOTH axes: 822 × 1122 at 300 dpi, 1644 × 2244 at 600, 2192 ×
 * 2992 at 800. (816 × 1110 — Card Conjurer's margin pack, 33 × 30 px — is the
 * older size; MPC asks for 822 × 1122 now.) MPC's safe area is a further
 * 36 px (0.12 in) inside each side of the trim: MPC_SAFE_IN.
 */
export const MPC_BLEED_IN: BleedInches = { x: 0.12, y: 0.12 };

/** MPC's safe area: keep text this far inside the trim, in inches. */
export const MPC_SAFE_IN = 0.12;

/** A print render's bleed: none (`false`), the 1/8 in bleed (`true` — TODO
 *  6.1a), or MakePlayingCards' (`"mpc"` — TODO 6.1). */
export type PrintBleed = boolean | "mpc";

/** The bleed per axis, in inches, of a named bleed (or a per-axis one, as
 *  is). */
export function printBleedInches(bleed: PrintBleed | BleedInches): BleedInches {
  if (typeof bleed === "object") return bleed;
  if (bleed === "mpc") return MPC_BLEED_IN;
  return bleed ? { x: BLEED_IN, y: BLEED_IN } : { x: 0, y: 0 };
}

/** True when the print file is always PORTRAIT — MPC's card has one
 *  orientation, so a landscape render (Battle, Split) is turned into it. */
export function printTurnsPortrait(bleed: PrintBleed | BleedInches): boolean {
  return bleed === "mpc";
}

/**
 * TODO 6.1b [decide]: is the 800 ppi export paid-only? RECOMMENDED yes, the
 * same gate as the clean HD download and the bleed — a print-shop file is
 * what Plus sells, and a free 800 ppi render would have to carry the
 * watermark anyway. `false` would give free viewers a watermarked 800 ppi
 * PNG (a live render, rate-limited when signed out). The ONE switch: the
 * route and the modal both read it.
 */
export const PRINT_800_PPI_PAID_ONLY = true;

/**
 * Frame templates whose masters (and every overlay they use — stat plates,
 * badges, holo stamps) are published at ≥ 2000 px native, so the 800 ppi
 * export is sharp end to end. EMPTY today: the Card Conjurer importer
 * downscales every master once to 1500 × 2100 (TODO 6.1b / "12." in the CC
 * audit), so an 800 ppi frame is the 600 ppi master upscaled — the art and
 * every text and vector layer are drawn at 800 ppi regardless. A template
 * joins only once the manifest carries its native masters;
 * tests/unit/cards/print-export.test.ts fails for a template listed here
 * whose manifest masters are narrower than 2000 px.
 */
export const PRINT_NATIVE_800_TEMPLATES: ReadonlySet<string> = new Set<string>();

/** True when the 800 ppi export of `template` upscales its frame. */
export function printFrameUpscaledAt800(template: string | null | undefined): boolean {
  return !PRINT_NATIVE_800_TEMPLATES.has(template ?? "");
}

/** The render scale of a print resolution against the HD (600 ppi) layout. */
export function printScale(ppi: PrintPpi): number {
  return ppi / 600;
}

/** The 1/8 in bleed in px on every side at `ppi`: 75 at 600, 100 at 800. */
export function bleedPx(ppi: PrintPpi): number {
  return Math.round(BLEED_IN * ppi);
}

/** A bleed in px per axis of the portrait card at `ppi` (a whole number of
 *  px — MPC's is 72 at 600 ppi, 96 at 800). */
export function bleedPxPerAxis(ppi: number, bleed: PrintBleed | BleedInches): { x: number; y: number } {
  const inches = printBleedInches(bleed);
  return { x: Math.round(inches.x * ppi), y: Math.round(inches.y * ppi) };
}

/** The output's pixel size: the trim at `ppi` (landscape swapped — unless
 *  the file is always portrait, MPC), plus the bleed per axis when asked.
 *  `bleedX` / `bleedY` are the file's own left-right / top-bottom bleed. */
export function printPixelSize(
  ppi: number,
  opts: { bleed: PrintBleed | BleedInches; landscape?: boolean },
): { width: number; height: number; bleedX: number; bleedY: number } {
  const w = Math.round(CARD_TRIM_IN.width * ppi);
  const h = Math.round(CARD_TRIM_IN.height * ppi);
  const axis = bleedPxPerAxis(ppi, opts.bleed);
  if (opts.landscape && !printTurnsPortrait(opts.bleed)) {
    // The card turned: its long side runs across, its x bleed up and down.
    return { width: h + 2 * axis.y, height: w + 2 * axis.x, bleedX: axis.y, bleedY: axis.x };
  }
  return { width: w + 2 * axis.x, height: h + 2 * axis.y, bleedX: axis.x, bleedY: axis.y };
}

const ppiParam = z.enum(["600", "800"]);

/** The png route's `ppi` query value → the resolution it renders. */
export function parsePpiParam(value: string | null | undefined): PrintPpi {
  const parsed = ppiParam.safeParse(value);
  return parsed.success ? (Number(parsed.data) as PrintPpi) : DEFAULT_PRINT_PPI;
}

/** The routes' `bleed` query value: "1" or "true" adds the 1/8 in bleed
 *  (the PDF route reads only this). */
export function parseBleedParam(value: string | null | undefined): boolean {
  return value === "1" || value === "true";
}

/** The png route's `bleed` query value: "mpc" is MakePlayingCards' file
 *  (TODO 6.1), "1" / "true" the 1/8 in bleed, anything else none. */
export function parsePrintBleedParam(value: string | null | undefined): PrintBleed {
  return value === "mpc" ? "mpc" : parseBleedParam(value);
}

/** The query value of a bleed (null: none). */
function bleedQueryValue(bleed: PrintBleed): string | null {
  return bleed === "mpc" ? "mpc" : bleed ? "1" : null;
}

/** The png route's `print` query value: "1" or "true" asks for the PRINT
 *  render even at 600 ppi without a bleed (TODO 6.15 — the exports). */
export function parsePrintParam(value: string | null | undefined): boolean {
  return value === "1" || value === "true";
}

/** What the png route is asked to print: the resolution, the bleed (none,
 *  1/8 in, MPC's), and whether the plain 600 ppi card is wanted as the
 *  print render (`print`). */
export type PrintRequest = { ppi: PrintPpi; bleed: PrintBleed; print?: boolean };

/** True when a request asks for a print render (800 ppi, a bleed, or
 *  `print`) rather than the plain HD/default image. */
export function isPrintRequest(opts: PrintRequest): boolean {
  return opts.print === true || opts.ppi !== DEFAULT_PRINT_PPI || opts.bleed !== false;
}

/** A card's print PNG URL: always square, never a preset (the resolution is
 *  the `ppi`), and always a PRINT render — at 600 ppi without a bleed it
 *  says so (`print=1`), since `ppi=600` alone is the plain HD download. The
 *  back face with `face: "back"` (TODO 5.3). */
export function cardPrintPngHref(cardId: string, opts: { ppi: PrintPpi; bleed: PrintBleed; face?: CardFace }): string {
  const print = isPrintRequest(opts) ? "" : "&print=1";
  const bleed = bleedQueryValue(opts.bleed);
  return `/api/cards/${cardId}/png?ppi=${opts.ppi}&corners=square${bleed ? `&bleed=${bleed}` : ""}${print}${faceQuery(opts.face)}`;
}

/** The print PNG's file name: `<slug>-800ppi.png`, `<slug>-bleed.png`,
 *  `<slug>-800ppi-bleed.png`, `<slug>-mpc.png`, `<slug>-800ppi-mpc.png`, or
 *  `<slug>-print.png` (600 ppi, no bleed). */
export function cardPrintFilename(slug: string, opts: { ppi: PrintPpi; bleed: PrintBleed }): string {
  const parts = [slug];
  if (opts.ppi !== DEFAULT_PRINT_PPI) parts.push(`${opts.ppi}ppi`);
  if (opts.bleed === "mpc") parts.push("mpc");
  else if (opts.bleed) parts.push("bleed");
  if (parts.length === 1) parts.push("print");
  return `${parts.join("-")}.png`;
}

/** The frame template named by a card's `frame_style` column (any shape),
 *  for the download modal's 800 ppi label. */
export function frameTemplateOf(frameStyle: unknown): string | undefined {
  if (!frameStyle || typeof frameStyle !== "object" || !("template" in frameStyle)) return undefined;
  const template = (frameStyle as { template?: unknown }).template;
  return typeof template === "string" ? template : undefined;
}
