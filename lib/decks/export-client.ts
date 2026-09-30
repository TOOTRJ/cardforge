import JSZip from "jszip";
import { buildDeckPdf, type DeckPdfLayout, type DeckPdfSheetOptions } from "@/lib/render/card-pdf";
import { cardPngHref } from "@/lib/cards/output-corners";
import { BLEED_IN, CARD_TRIM_IN, cardPrintPngHref, printPixelSize } from "@/lib/cards/print-export";
import { selectionExportFilename, type SelectionPdfLayout } from "@/lib/cards/print-selection";

// ---------------------------------------------------------------------------
// Client-side deck export pipeline — runs in the browser (no server-only
// imports) so a Pro owner's whole-deck export happens in the background
// with live progress while they keep using the site:
//
//   1. manifest   GET /api/decks/[id]/download?part=manifest
//   2. cards      GET /api/cards/[id]/png — a few in flight at once, each
//                 ~1–3 s of live rendering, clean for a paid viewer. Every
//                 PDF card and every HD ZIP image is the 600 ppi PRINT
//                 render (?ppi=600&corners=square&print=1 — TODO 6.10/6.15:
//                 1500 × 2100 with the art composited at full resolution,
//                 not the bake's 1600 px inlined copy; + &bleed=1 with the
//                 1/8 in bleed, TODO 6.1a); a standard-size ZIP image is the
//                 750 px square render (?preset=default&corners=square),
//                 and an MPC ZIP image MakePlayingCards' file (&bleed=mpc,
//                 TODO 6.1: 1644 × 2244, always portrait).
//                 SQUARE (TODO 3.26) either way: both are print input — cut
//                 along the rectangle, corners in the border's colour.
//   3. package    ZIP → cover + deck.pdf report + decklist.txt + PNGs
//                 PDF → pdf-lib pages / sheets + checklist page; the sheets
//                 take the print options (gap, cut guides, card size — lib/
//                 render/sheet-layout.ts — and the bleed)
//
// Why here and not one server route (TODO 6.15): each card is its own
// function invocation (one render's memory, ~3 in flight), so no function
// holds more than one render or sits on its time limit, even for 150 cards.
// The BROWSER is not bounded: it keeps every card's PNG until the PDF is
// saved, plus the PDF itself. buildDeckPdf's embedImageNow only stops
// pdf-lib from also keeping each card DECODED. A 1500 × 2100 print render
// is ~3–7 MB (RGB, ~10 % smaller than the RGBA HD render this export used
// before); 150 busy cards measured 728 MB of PNGs and a 722 MB PDF.
//
// runCardsExport (TODO 6.15) is the same pipeline for ANY selection of cards
// (My Cards' "Print / download" bulk action): the manifest comes from
// POST /api/cards/export, with per-card copies.
//
/** The card body face, shipped as a static asset. Null on any failure. */
async function fetchChecklistFont(
  fetchImpl: FetchLike,
  signal?: AbortSignal,
): Promise<ArrayBuffer | null> {
  try {
    const response = await fetchImpl("/fonts/mplantin.ttf", { signal });
    if (!response.ok) return null;
    return await response.arrayBuffer();
  } catch {
    return null;
  }
}

// `fetchImpl` is injectable so the pipeline unit-tests without a network.
// ---------------------------------------------------------------------------

export type DeckExportManifest = {
  deck: { id: string; slug: string; title: string };
  /** Unique custom cards in deck order; `copies` = physical copies to print. */
  cards: Array<{ id: string; slug: string; title: string; copies: number }>;
  /** Un-remixed entries, one line each ("4× Lightning Bolt  (Sideboard)"). */
  checklist: string[];
  hasCover: boolean;
  totalEntries: number;
};

/** A selection's manifest (POST /api/cards/export): the printable cards in
 *  the order asked, copies budgeted; `skipped` = ids it can't print. */
export type CardsExportManifest = {
  cards: Array<{ id: string; slug: string; title: string; copies: number }>;
  skipped: string[];
  totalCopies: number;
};

export type DeckExportKind = "zip" | "pdf";
/** A ZIP's image size: HD (the 600 ppi print render), standard (750 px), or
 *  MakePlayingCards' poker-size file (TODO 6.1). A PDF is always HD. */
export type DeckExportQuality = "hd" | "default" | "mpc";

export type DeckExportRequest = {
  deckId: string;
  kind: DeckExportKind;
  /** ZIP: image size (HD, standard or MPC). PDF: always HD (print). */
  quality: DeckExportQuality;
  /** PDF only. */
  layout: DeckPdfLayout;
  /** PDF sheets only: gap, cut guides, card size (default: the 3×3). */
  sheet?: DeckPdfSheetOptions;
  /** PDF only: every card with a 1/8 in bleed (the print render). */
  bleed?: boolean;
};

/** Print / download a selection of cards (TODO 6.15). */
export type CardsExportRequest = {
  cards: Array<{ id: string; copies: number }>;
  kind: DeckExportKind;
  /** ZIP: image size (a bleed ZIP is always the 600 ppi print render; an
   *  MPC one carries MPC's own bleed, never the 1/8 in). PDF: always HD
   *  (print). */
  quality: DeckExportQuality;
  /** PDF only. */
  layout: SelectionPdfLayout;
  /** PDF sheets only: gap, cut guides, card size. */
  sheet?: DeckPdfSheetOptions;
  /** Every card with a 1/8 in bleed (the print render) — PDF and ZIP. */
  bleed?: boolean;
};

/** Either export; DeckExportProvider runs one at a time. */
export type ExportRequest = DeckExportRequest | CardsExportRequest;

export function isCardsExportRequest(request: ExportRequest): request is CardsExportRequest {
  return "cards" in request;
}

export type DeckExportProgress = {
  phase: "preparing" | "rendering" | "packaging";
  total: number;
  done: number;
  failed: string[];
  deckTitle: string;
};

export type DeckExportResult = {
  blob: Blob;
  filename: string;
  cardsIncluded: number;
  failed: string[];
  deck: DeckExportManifest["deck"];
};

export class DeckExportError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

/** Rough on-disk size per card, used for the estimate in the export modal. */
export const APPROX_BYTES_PER_CARD: Record<DeckExportQuality, number> = {
  hd: 3.2 * 1024 * 1024,
  default: 0.9 * 1024 * 1024,
  // 1644 × 2244: the HD card's area plus MPC's bleed, ~17 % more.
  mpc: 3.75 * 1024 * 1024,
};

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  const mb = bytes / (1024 * 1024);
  if (mb < 1000) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

/** How many card renders run at once — each is a live Satori render. */
const EXPORT_CONCURRENCY = 3;

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

async function readError(response: Response, fallback: string): Promise<DeckExportError> {
  const body = (await response.json().catch(() => null)) as { error?: string; code?: string } | null;
  return new DeckExportError(body?.error ?? fallback, body?.code);
}

async function fetchDeckExportManifest(
  deckId: string,
  fetchImpl: FetchLike = fetch,
  signal?: AbortSignal,
): Promise<DeckExportManifest> {
  const response = await fetchImpl(`/api/decks/${deckId}/download?part=manifest`, { signal });
  if (!response.ok) throw await readError(response, "Couldn't start the export.");
  return (await response.json()) as DeckExportManifest;
}

/** A PNG's pixel size, from its IHDR chunk; null when the bytes aren't one. */
export function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.byteLength < 24 || signature.some((b, i) => bytes[i] !== b)) return null;
  if (String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]) !== "IHDR") return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/** The shape of a render WITH the 1/8 in bleed: 2.75 × 3.75 in (1650 × 2250
 *  at 600 ppi), short side over long (a landscape card is turned). */
const BLEED_ASPECT = (CARD_TRIM_IN.width + 2 * BLEED_IN) / (CARD_TRIM_IN.height + 2 * BLEED_IN);

/** True when `bytes` is a PNG shaped like a bleed render — not the 5:7 card
 *  without one (2.6 % apart). A bleed sheet puts each image's bleed box in
 *  its cell, so a card WITHOUT the bleed would be stretched into it and its
 *  trim would miss the cut marks by ~1/8 in: such a card counts as failed. */
export function carriesPrintBleed(bytes: Uint8Array): boolean {
  const size = pngSize(bytes);
  if (!size || size.width === 0 || size.height === 0) return false;
  const shortOverLong = Math.min(size.width, size.height) / Math.max(size.width, size.height);
  return Math.abs(shortOverLong / BLEED_ASPECT - 1) < 0.01;
}

/** MakePlayingCards' file at 600 ppi (TODO 6.1): 1644 × 2244, portrait. */
const MPC_EXPORT_SIZE = printPixelSize(600, { bleed: "mpc" });

/** True when `bytes` is a PNG of MPC's exact size at 600 ppi — what an MPC
 *  ZIP takes (the 1/8 in bleed's 1650 × 2250 is 0.1 % from its shape, so
 *  only the size tells them apart; a render without MPC's bleed, or turned
 *  landscape, would be the wrong file to upload). */
export function isMpcExportRender(bytes: Uint8Array): boolean {
  const size = pngSize(bytes);
  return size?.width === MPC_EXPORT_SIZE.width && size.height === MPC_EXPORT_SIZE.height;
}

/** True when a request's ZIP images are MakePlayingCards' files. */
function mpcZip(request: { kind: DeckExportKind; quality: DeckExportQuality }): boolean {
  return request.kind === "zip" && request.quality === "mpc";
}

/**
 * Which render an export fetches for a card: the 600 ppi PRINT render (full-
 * resolution art; with the bleed when asked) for a PDF and for HD images,
 * MakePlayingCards' file for an MPC ZIP (TODO 6.1), the 750 px square render
 * for a standard-size ZIP.
 */
export function exportCardHref(
  cardId: string,
  opts: { kind: DeckExportKind; quality: DeckExportQuality; bleed: boolean },
): string {
  if (mpcZip(opts)) return cardPrintPngHref(cardId, { ppi: 600, bleed: "mpc" });
  if (opts.bleed || opts.kind === "pdf" || opts.quality === "hd") {
    return cardPrintPngHref(cardId, { ppi: 600, bleed: opts.bleed });
  }
  return cardPngHref(cardId, { preset: "default", corners: "square" });
}

/** Fetch every card's PNG with a small worker pool, reporting each finish.
 *  `hrefOf` names the render (exportCardHref: the print render, or the
 *  750 px square one);
 *  a response `accept` turns down counts as a failure. */
async function fetchCardPngs(
  cards: ReadonlyArray<{ id: string; title: string }>,
  hrefOf: (card: { id: string }) => string,
  fetchImpl: FetchLike,
  signal: AbortSignal | undefined,
  onOne: (title: string, ok: boolean) => void,
  accept?: (bytes: Uint8Array) => boolean,
): Promise<Map<string, Uint8Array>> {
  const out = new Map<string, Uint8Array>();
  let cursor = 0;
  const worker = async () => {
    while (cursor < cards.length) {
      if (signal?.aborted) return;
      const card = cards[cursor++];
      try {
        const response = await fetchImpl(hrefOf(card), { signal });
        if (!response.ok) {
          onOne(card.title, false);
          continue;
        }
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (accept && !accept(bytes)) {
          onOne(card.title, false);
          continue;
        }
        out.set(card.id, bytes);
        onOne(card.title, true);
      } catch (error) {
        if (signal?.aborted) return;
        void error;
        onOne(card.title, false);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(EXPORT_CONCURRENCY, cards.length) }, worker));
  if (signal?.aborted) throw new DeckExportError("Export cancelled.", "CANCELLED");
  return out;
}

function extensionOf(contentType: string | null): string {
  if (!contentType) return "png";
  if (contentType.includes("webp")) return "webp";
  if (contentType.includes("jpeg") || contentType.includes("jpg")) return "jpg";
  return "png";
}

export async function runDeckExport(
  request: DeckExportRequest,
  options: {
    onProgress: (progress: DeckExportProgress) => void;
    signal?: AbortSignal;
    fetchImpl?: FetchLike;
  },
): Promise<DeckExportResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const { signal } = options;
  const progress: DeckExportProgress = { phase: "preparing", total: 0, done: 0, failed: [], deckTitle: "" };
  const emit = () => options.onProgress({ ...progress, failed: [...progress.failed] });
  emit();

  const manifest = await fetchDeckExportManifest(request.deckId, fetchImpl, signal);
  progress.deckTitle = manifest.deck.title;
  progress.total = manifest.cards.length;
  progress.phase = "rendering";
  emit();

  // The bleed is a PDF option (the ZIP's images are the plain print files,
  // or MPC's, which carry MPC's own bleed).
  const bleed = request.kind === "pdf" && request.bleed === true;
  const mpc = mpcZip(request);
  const hrefOf = (card: { id: string }) =>
    exportCardHref(card.id, { kind: request.kind, quality: request.quality, bleed });
  const pngs = await fetchCardPngs(
    manifest.cards,
    hrefOf,
    fetchImpl,
    signal,
    (title, ok) => {
      progress.done += 1;
      if (!ok) progress.failed.push(title);
      emit();
    },
    // A bleed PDF takes only renders that carry the bleed; an MPC ZIP only
    // MPC's files.
    mpc ? isMpcExportRender : bleed ? carriesPrintBleed : undefined,
  );

  progress.phase = "packaging";
  emit();

  if (request.kind === "pdf") {
    const entries = manifest.cards
      .filter((card) => pngs.has(card.id))
      .map((card) => ({ png: pngs.get(card.id) as Uint8Array, copies: card.copies }));
    if (entries.length === 0 && manifest.checklist.length === 0) {
      throw new DeckExportError("Nothing to print — remix some cards into custom proxies first.");
    }
    const bytes = await buildDeckPdf(entries, {
      title: manifest.deck.title,
      layout: request.layout,
      checklist:
        manifest.checklist.length > 0
          ? {
              heading: `${manifest.deck.title} — not yet remixed (originals to supply yourself)`,
              lines: manifest.checklist,
            }
          : null,
      // Unicode-capable font for the checklist text (card-pdf falls back to
      // Helvetica + "?" substitution if this fails, so it is best-effort).
      checklistFont:
        manifest.checklist.length > 0 ? await fetchChecklistFont(fetchImpl, signal) : null,
      sheet: request.sheet,
      bleed,
    });
    const suffix = request.layout === "pages" ? "" : request.layout === "sheet-a4" ? "-sheets-a4" : "-sheets";
    return {
      blob: new Blob([bytes as BlobPart], { type: "application/pdf" }),
      filename: `${manifest.deck.slug}${suffix}${bleed ? "-bleed" : ""}.pdf`,
      cardsIncluded: entries.length,
      failed: progress.failed,
      deck: manifest.deck,
    };
  }

  const zip = new JSZip();
  const [report, decklist, cover] = await Promise.all([
    fetchImpl(`/api/decks/${request.deckId}/download?part=report`, { signal })
      .then((r) => (r.ok ? r.arrayBuffer() : null))
      .catch(() => null),
    fetchImpl(`/api/decks/${request.deckId}/download?part=decklist`, { signal })
      .then((r) => (r.ok ? r.text() : null))
      .catch(() => null),
    manifest.hasCover
      ? fetchImpl(`/api/decks/${request.deckId}/download?part=cover`, { signal })
          .then(async (r) => (r.ok ? { bytes: await r.arrayBuffer(), ext: extensionOf(r.headers.get("content-type")) } : null))
          .catch(() => null)
      : Promise.resolve(null),
  ]);
  if (signal?.aborted) throw new DeckExportError("Export cancelled.", "CANCELLED");

  if (report) zip.file("deck.pdf", report);
  if (decklist) zip.file("decklist.txt", decklist);
  if (cover) zip.file(`cover.${cover.ext}`, cover.bytes);
  let added = 0;
  for (const card of manifest.cards) {
    const png = pngs.get(card.id);
    if (!png) continue;
    added += 1;
    zip.file(`cards/${String(added).padStart(2, "0")}-${card.slug}${mpc ? "-mpc" : ""}.png`, png);
  }
  const notes: string[] = [];
  if (manifest.cards.length === 0) {
    notes.push("No custom card images yet — remix cards into your own proxies and they will be included here.");
  }
  if (progress.failed.length > 0) {
    notes.push(`These cards failed to render and were skipped:\n${progress.failed.join("\n")}`);
  }
  if (manifest.checklist.length > 0) {
    notes.push(`Real cards in this deck (no custom proxy yet):\n${manifest.checklist.join("\n")}`);
  }
  if (notes.length > 0) zip.file("MISSING.txt", `${notes.join("\n\n")}\n`);

  // PNGs are already compressed — STORE keeps packaging near-instant.
  const blob = await zip.generateAsync({ type: "blob", compression: "STORE" });
  return {
    blob,
    filename: `${manifest.deck.slug}-deck${mpc ? "-mpc" : ""}.zip`,
    cardsIncluded: added,
    failed: progress.failed,
    deck: manifest.deck,
  };
}

// ---------------------------------------------------------------------------
// Print / download a SELECTION of cards (TODO 6.15).
// ---------------------------------------------------------------------------

export type CardsExportResult = {
  blob: Blob;
  filename: string;
  cardsIncluded: number;
  /** Titles of the cards left out: gone / not printable (the manifest's
   *  `skipped`), then any that failed to render. */
  failed: string[];
  /** "Stone Matriarch" for one card, "12 cards" for more. */
  title: string;
};

async function fetchCardsExportManifest(
  cards: CardsExportRequest["cards"],
  fetchImpl: FetchLike,
  signal?: AbortSignal,
): Promise<CardsExportManifest> {
  const response = await fetchImpl("/api/cards/export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cards: cards.map(({ id, copies }) => ({ id, copies })) }),
    signal,
  });
  if (!response.ok) throw await readError(response, "Couldn't start the export.");
  return (await response.json()) as CardsExportManifest;
}

/** One card goes by its title; a bigger selection by its count. */
function selectionTitle(cards: CardsExportManifest["cards"]): string {
  return cards.length === 1 ? cards[0].title : `${cards.length} cards`;
}

export async function runCardsExport(
  request: CardsExportRequest & {
    /** Titles the dialog knows, so a skipped id can be named. */
    titles?: Record<string, string>;
  },
  options: {
    onProgress: (progress: DeckExportProgress) => void;
    signal?: AbortSignal;
    fetchImpl?: FetchLike;
  },
): Promise<CardsExportResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const { signal } = options;
  const progress: DeckExportProgress = { phase: "preparing", total: 0, done: 0, failed: [], deckTitle: "" };
  const emit = () => options.onProgress({ ...progress, failed: [...progress.failed] });
  emit();

  const manifest = await fetchCardsExportManifest(request.cards, fetchImpl, signal);
  const title = selectionTitle(manifest.cards);
  progress.deckTitle = title;
  progress.total = manifest.cards.length;
  progress.failed = manifest.skipped.map((id) => request.titles?.[id] ?? "A card that is no longer available");
  progress.phase = "rendering";
  emit();

  // Every PDF card and HD image is its 600 ppi PRINT render (1500 × 2100,
  // or 1650 × 2250 with the bleed; the art at full resolution, always
  // square); a standard-size ZIP image the 750 px square render; an MPC ZIP
  // image MakePlayingCards' file (1644 × 2244, MPC's own bleed — never the
  // 1/8 in on top).
  const mpc = mpcZip(request);
  const bleed = request.bleed === true && !mpc;
  const hrefOf = (card: { id: string }) =>
    exportCardHref(card.id, { kind: request.kind, quality: request.quality, bleed });
  const pngs = await fetchCardPngs(
    manifest.cards,
    hrefOf,
    fetchImpl,
    signal,
    (cardTitle, ok) => {
      progress.done += 1;
      if (!ok) progress.failed.push(cardTitle);
      emit();
    },
    // A bleed export takes only renders that carry the bleed; an MPC ZIP
    // only MPC's files.
    mpc ? isMpcExportRender : bleed ? carriesPrintBleed : undefined,
  );

  progress.phase = "packaging";
  emit();

  const filename = selectionExportFilename(manifest.cards, {
    kind: request.kind,
    layout: request.layout,
    bleed,
    quality: request.quality,
  });
  const rendered = manifest.cards.filter((card) => pngs.has(card.id));
  if (rendered.length === 0) {
    throw new DeckExportError("None of the cards could be rendered — try again in a moment.");
  }

  if (request.kind === "pdf") {
    const bytes = await buildDeckPdf(
      rendered.map((card) => ({ png: pngs.get(card.id) as Uint8Array, copies: card.copies })),
      {
        title,
        layout: request.layout,
        sheet: request.sheet,
        bleed,
        subject: "Custom MTG-style cards — fan-made, not affiliated with Wizards of the Coast.",
      },
    );
    return {
      blob: new Blob([bytes as BlobPart], { type: "application/pdf" }),
      filename,
      cardsIncluded: rendered.length,
      failed: progress.failed,
      title,
    };
  }

  const zip = new JSZip();
  rendered.forEach((card, index) => {
    zip.file(
      `cards/${String(index + 1).padStart(2, "0")}-${card.slug}${mpc ? "-mpc" : bleed ? "-bleed" : ""}.png`,
      pngs.get(card.id) as Uint8Array,
    );
  });
  if (progress.failed.length > 0) {
    zip.file("MISSING.txt", `These cards were skipped:\n${progress.failed.join("\n")}\n`);
  }
  // PNGs are already compressed — STORE keeps packaging near-instant.
  const blob = await zip.generateAsync({ type: "blob", compression: "STORE" });
  return { blob, filename, cardsIncluded: rendered.length, failed: progress.failed, title };
}
