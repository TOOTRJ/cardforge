import JSZip from "jszip";
import { buildDeckPdf, type DeckPdfLayout } from "@/lib/render/card-pdf";

// ---------------------------------------------------------------------------
// Client-side deck export pipeline — runs in the browser (no server-only
// imports) so a Pro owner's whole-deck export happens in the background
// with live progress while they keep using the site:
//
//   1. manifest   GET /api/decks/[id]/download?part=manifest
//   2. cards      GET /api/cards/[id]/png?preset=…  (clean for a paid viewer;
//                 a few in flight at once, each ~1–3 s of live rendering)
//   3. package    ZIP → cover + deck.pdf report + decklist.txt + PNGs
//                 PDF → pdf-lib pages / 3×3 sheets + checklist page
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

export type DeckExportKind = "zip" | "pdf";
export type DeckExportQuality = "hd" | "default";

export type DeckExportRequest = {
  deckId: string;
  kind: DeckExportKind;
  /** ZIP: image size. PDF: always HD (print). */
  quality: DeckExportQuality;
  /** PDF only. */
  layout: DeckPdfLayout;
};

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

/** Fetch every card's PNG with a small worker pool, reporting each finish. */
async function fetchCardPngs(
  cards: DeckExportManifest["cards"],
  quality: DeckExportQuality,
  fetchImpl: FetchLike,
  signal: AbortSignal | undefined,
  onOne: (title: string, ok: boolean) => void,
): Promise<Map<string, Uint8Array>> {
  const out = new Map<string, Uint8Array>();
  let cursor = 0;
  const worker = async () => {
    while (cursor < cards.length) {
      if (signal?.aborted) return;
      const card = cards[cursor++];
      try {
        const response = await fetchImpl(`/api/cards/${card.id}/png?preset=${quality}`, { signal });
        if (!response.ok) {
          onOne(card.title, false);
          continue;
        }
        out.set(card.id, new Uint8Array(await response.arrayBuffer()));
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

  const quality: DeckExportQuality = request.kind === "pdf" ? "hd" : request.quality;
  const pngs = await fetchCardPngs(manifest.cards, quality, fetchImpl, signal, (title, ok) => {
    progress.done += 1;
    if (!ok) progress.failed.push(title);
    emit();
  });

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
    });
    const suffix = request.layout === "pages" ? "" : request.layout === "sheet-a4" ? "-sheets-a4" : "-sheets";
    return {
      blob: new Blob([bytes as BlobPart], { type: "application/pdf" }),
      filename: `${manifest.deck.slug}${suffix}.pdf`,
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
    zip.file(`cards/${String(added).padStart(2, "0")}-${card.slug}.png`, png);
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
    filename: `${manifest.deck.slug}-deck.zip`,
    cardsIncluded: added,
    failed: progress.failed,
    deck: manifest.deck,
  };
}
