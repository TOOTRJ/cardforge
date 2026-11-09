import JSZip from "jszip";
import { buildCockatrice, type CockatricePicture } from "./cockatrice";
import { buildDraftmancer } from "./draftmancer";
import { hasSharedPictures, lineCount, type PlayExport, type PlayTarget } from "./model";
import { buildTts } from "./tts";

// ---------------------------------------------------------------------------
// The play export's FILE, built in the browser from the server's model
// (lib/tools/play-exports/actions.ts) — the deck export's pattern
// (lib/decks/export-client.ts): a few requests in flight, live progress, no
// function holding a deck's pictures.
//
//   cockatrice   <stem>-cockatrice.zip: the set's .xml, the deck's .cod, the
//                pictures (each card's STORED display bake — its 600 px
//                thumbnail — as a JPEG: Cockatrice reads PNG and JPEG only)
//                and HOW-TO-IMPORT.txt
//   draftmancer  <stem>-draftmancer.txt
//   tts          <stem>-tts.json
//
// A picture is fetched from THIS site's /render-cdn (the model's absolute
// URL made same-origin: a preview deployment's own host may differ from the
// one the viewer is on), never through a print or live render.
// ---------------------------------------------------------------------------

export type PlayFetch = (input: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; blob(): Promise<Blob> }>;

export type PlayDownloadDeps = {
  fetchImpl: PlayFetch;
  /** A fetched picture as a JPEG (the browser's canvas; tests pass bytes through). */
  toJpeg: (picture: Blob) => Promise<Blob>;
  /** "2026-11-08" */
  today: string;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
};

export type PlaySummary = {
  target: PlayTarget;
  /** Custom cards written as custom cards. */
  customCards: number;
  /** Physical real cards written by name. */
  realCards: number;
  /** Custom cards with no shared picture — a private card, or one whose
   *  picture is still being drawn: Cockatrice and Draftmancer show their
   *  text; TTS leaves them out. */
  unpictured: Array<{ name: string; reason: "private" | "pending" }>;
  /** TTS: physical cards left out for want of a shared picture. */
  leftOutCards: number;
  /** Cockatrice: pictures that couldn't be fetched (the card still plays
   *  as text, and from `picurl` where downloads are on). */
  picturesFailed: number;
  /** Entries hidden from the viewer (or gone) and maybeboard cards. */
  hiddenEntries: number;
  maybeboard: number;
};

export type PlayDownload = { blob: Blob; filename: string; summary: PlaySummary };

const PICTURE_CONCURRENCY = 4;

/** An absolute /render-cdn URL as a same-origin path; any other URL as is. */
export function sameOriginPicture(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.pathname.startsWith("/render-cdn/")) return `${parsed.pathname}${parsed.search}`;
  } catch {
    // Not absolute: already a path.
  }
  return url;
}

function unpicturedOf(exp: PlayExport): PlaySummary["unpictured"] {
  return exp.cards
    .filter((card) => !hasSharedPictures(card))
    .map((card) => ({ name: card.front.name, reason: card.isPrivate ? "private" : "pending" }));
}

function realCardsOf(exp: PlayExport): number {
  return lineCount(exp.lines.filter((line) => line.kind === "real"));
}

async function fetchPictures(
  pictures: CockatricePicture[],
  deps: PlayDownloadDeps,
): Promise<{ files: Array<{ path: string; data: Uint8Array }>; failed: number }> {
  const files: Array<{ path: string; data: Uint8Array }> = [];
  let failed = 0;
  let done = 0;
  let next = 0;
  deps.onProgress?.(0, pictures.length);
  const worker = async () => {
    while (next < pictures.length) {
      const picture = pictures[next];
      next += 1;
      if (deps.signal?.aborted) return;
      try {
        const response = await deps.fetchImpl(sameOriginPicture(picture.url), { signal: deps.signal });
        if (!response.ok) throw new Error("picture unavailable");
        const jpeg = await deps.toJpeg(await response.blob());
        files.push({ path: picture.path, data: new Uint8Array(await jpeg.arrayBuffer()) });
      } catch {
        if (deps.signal?.aborted) return;
        failed += 1;
      }
      done += 1;
      deps.onProgress?.(done, pictures.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(PICTURE_CONCURRENCY, pictures.length) }, worker));
  // The archive lists them in the set's order, whatever finished first.
  const order = new Map(pictures.map((picture, i) => [picture.path, i]));
  files.sort((a, b) => (order.get(a.path) ?? 0) - (order.get(b.path) ?? 0));
  return { files, failed };
}

export async function buildPlayDownload(exp: PlayExport, target: PlayTarget, deps: PlayDownloadDeps): Promise<PlayDownload> {
  const base: Omit<PlaySummary, "picturesFailed" | "leftOutCards"> = {
    target,
    customCards: exp.cards.length,
    realCards: realCardsOf(exp),
    unpictured: unpicturedOf(exp),
    hiddenEntries: exp.leftOut.hidden,
    maybeboard: exp.leftOut.maybeboard,
  };

  if (target === "draftmancer") {
    const { text } = buildDraftmancer(exp);
    return {
      blob: new Blob([text], { type: "text/plain;charset=utf-8" }),
      filename: `${exp.fileStem}-draftmancer.txt`,
      summary: { ...base, picturesFailed: 0, leftOutCards: 0 },
    };
  }

  if (target === "tts") {
    const tts = buildTts(exp);
    return {
      blob: new Blob([tts.json], { type: "application/json" }),
      filename: `${exp.fileStem}-tts.json`,
      summary: { ...base, picturesFailed: 0, leftOutCards: tts.leftOut },
    };
  }

  const files = buildCockatrice(exp, { today: deps.today });
  const { files: pictures, failed } = await fetchPictures(files.pictures, deps);
  if (deps.signal?.aborted) throw new DOMException("Export cancelled", "AbortError");
  const zip = new JSZip();
  const folder = zip.folder(exp.fileStem)!;
  folder.file(`${exp.fileStem}.xml`, files.xml);
  if (files.cod) folder.file(`${exp.fileStem}.cod`, files.cod);
  folder.file("HOW-TO-IMPORT.txt", files.readme);
  for (const picture of pictures) folder.file(picture.path, picture.data);
  // Pictures are JPEGs already: storing them again costs nothing.
  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
  return {
    blob,
    filename: `${exp.fileStem}-cockatrice.zip`,
    summary: { ...base, picturesFailed: failed, leftOutCards: 0 },
  };
}

/**
 * The browser's JPEG of a fetched picture (a WebP thumbnail or a PNG): drawn
 * on a canvas over black, so the bake's rounded corners — transparent —
 * read as the black border every card print has there.
 */
export async function browserToJpeg(picture: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(picture);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("No canvas");
    context.fillStyle = "#000";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("JPEG encode failed"))), "image/jpeg", 0.9),
    );
  } finally {
    bitmap.close();
  }
}

/** Save a blob under a file name (an object URL on a link, released after). */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
