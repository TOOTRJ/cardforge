import { z } from "zod";

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

/** The bleed in px on every side at `ppi`: 75 at 600, 100 at 800. */
export function bleedPx(ppi: PrintPpi): number {
  return Math.round(BLEED_IN * ppi);
}

/** The output's pixel size: the trim at `ppi` (landscape swapped), plus the
 *  bleed on every side when asked. */
export function printPixelSize(
  ppi: PrintPpi,
  opts: { bleed: boolean; landscape?: boolean },
): { width: number; height: number; bleed: number } {
  const w = Math.round(CARD_TRIM_IN.width * ppi);
  const h = Math.round(CARD_TRIM_IN.height * ppi);
  const bleed = opts.bleed ? bleedPx(ppi) : 0;
  const [tw, th] = opts.landscape ? [h, w] : [w, h];
  return { width: tw + 2 * bleed, height: th + 2 * bleed, bleed };
}

const ppiParam = z.enum(["600", "800"]);

/** The png route's `ppi` query value → the resolution it renders. */
export function parsePpiParam(value: string | null | undefined): PrintPpi {
  const parsed = ppiParam.safeParse(value);
  return parsed.success ? (Number(parsed.data) as PrintPpi) : DEFAULT_PRINT_PPI;
}

/** The routes' `bleed` query value: "1" or "true" adds the bleed. */
export function parseBleedParam(value: string | null | undefined): boolean {
  return value === "1" || value === "true";
}

/** True when a request asks for a print render (800 ppi and/or bleed)
 *  rather than the plain HD/default image. */
export function isPrintRequest(opts: { ppi: PrintPpi; bleed: boolean }): boolean {
  return opts.ppi !== DEFAULT_PRINT_PPI || opts.bleed;
}

/** A card's print PNG URL: always square, never a preset (the resolution is
 *  the `ppi`). */
export function cardPrintPngHref(cardId: string, opts: { ppi: PrintPpi; bleed: boolean }): string {
  return `/api/cards/${cardId}/png?ppi=${opts.ppi}&corners=square${opts.bleed ? "&bleed=1" : ""}`;
}

/** The print PNG's file name: `<slug>-800ppi.png`, `<slug>-bleed.png` or
 *  `<slug>-800ppi-bleed.png`. */
export function cardPrintFilename(slug: string, opts: { ppi: PrintPpi; bleed: boolean }): string {
  const parts = [slug];
  if (opts.ppi !== DEFAULT_PRINT_PPI) parts.push(`${opts.ppi}ppi`);
  if (opts.bleed) parts.push("bleed");
  return `${parts.join("-")}.png`;
}

/** The frame template named by a card's `frame_style` column (any shape),
 *  for the download modal's 800 ppi label. */
export function frameTemplateOf(frameStyle: unknown): string | undefined {
  if (!frameStyle || typeof frameStyle !== "object" || !("template" in frameStyle)) return undefined;
  const template = (frameStyle as { template?: unknown }).template;
  return typeof template === "string" ? template : undefined;
}
