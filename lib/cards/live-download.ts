// ---------------------------------------------------------------------------
// A download that is RENDERED LIVE says so (TODO 6.30, owner 2026-10-09).
//
// A clean PNG, an 800 ppi or bleed file, a PDF and every export card is
// drawn on our servers when it is asked for, and can take many seconds. The
// download modal used to hand the link to the browser, which showed nothing
// until the file arrived — or nothing at all when it failed: a dead click.
// It now fetches the SAME URL itself (same bytes, same file name — nothing
// about what is downloaded changes), shows a spinner and a line saying large
// files can take up to a minute, saves the file when it lands, and says why
// when it doesn't. The exports (My Cards' selection, a deck) already run
// with a progress card; they use the same time limit for each card's render
// (lib/decks/export-client.ts), so a render that hangs is a skipped card,
// never an export that never ends.
//
// Pure and client-safe: no React, no DOM but what the caller passes in.
// ---------------------------------------------------------------------------

/** How long one live render may take before the download gives up. The
 *  copy promises "up to a minute"; this leaves room past it for a slow
 *  connection, but never an endless wait. */
export const LIVE_DOWNLOAD_TIMEOUT_MS = 120_000;

/** The line under a download while it is prepared. */
export const LONG_DOWNLOAD_NOTE = "Large files are drawn live and can take up to a minute.";

/** What is being prepared, in the button's words. */
export type LiveDownloadNoun = "image" | "PDF";

/** "Preparing your image…" / "Preparing your PDF…" — the button while the
 *  file is drawn. */
export function preparingLabel(noun: LiveDownloadNoun): string {
  return `Preparing your ${noun}…`;
}

/** The one sentence the live region says while a file is prepared. */
export function preparingAnnouncement(noun: LiveDownloadNoun): string {
  return `${preparingLabel(noun)} ${LONG_DOWNLOAD_NOTE}`;
}

export const DOWNLOAD_TIMED_OUT_MESSAGE =
  "This file took too long to prepare, so the download was stopped. Try again in a moment.";
export const DOWNLOAD_OFFLINE_MESSAGE =
  "The download didn't go through. Check your connection and try again.";
export const DOWNLOAD_FAILED_MESSAGE = "This file couldn't be prepared. Try again in a moment.";

export class LiveDownloadError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = "LiveDownloadError";
  }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * A signal that aborts when `parent` does or after `ms`, whichever is first.
 * `timedOut()` tells the two apart; `clear()` stops the timer once the
 * request is done. (AbortSignal.any / .timeout would do it too, but not in
 * every browser the site supports.)
 */
export function timeoutSignal(
  ms: number,
  parent?: AbortSignal,
): { signal: AbortSignal; timedOut: () => boolean; clear: () => void } {
  const controller = new AbortController();
  let expired = false;
  const timer = setTimeout(() => {
    expired = true;
    controller.abort();
  }, ms);
  const onParentAbort = () => controller.abort();
  if (parent) {
    if (parent.aborted) controller.abort();
    else parent.addEventListener("abort", onParentAbort, { once: true });
  }
  return {
    signal: controller.signal,
    timedOut: () => expired,
    clear: () => {
      clearTimeout(timer);
      parent?.removeEventListener("abort", onParentAbort);
    },
  };
}

/** The message a refused response carries (the routes answer
 *  `{ error, code }`), else the generic one. */
async function refusalOf(response: Response): Promise<LiveDownloadError> {
  const body = (await response.json().catch(() => null)) as { error?: unknown; code?: unknown } | null;
  const message = typeof body?.error === "string" && body.error.trim() ? body.error : DOWNLOAD_FAILED_MESSAGE;
  return new LiveDownloadError(message, typeof body?.code === "string" ? body.code : undefined);
}

/**
 * Fetches a download's file — the URL the link names, unchanged — within
 * `timeoutMs`. Resolves with its bytes; rejects with a LiveDownloadError
 * whose message is meant for the reader: the route's own refusal, a time-out,
 * a dropped connection. An abort from `signal` rejects with code
 * "CANCELLED".
 */
export async function fetchLiveDownload(
  href: string,
  {
    fetchImpl = fetch,
    signal,
    timeoutMs = LIVE_DOWNLOAD_TIMEOUT_MS,
  }: { fetchImpl?: FetchLike; signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<Blob> {
  const limit = timeoutSignal(timeoutMs, signal);
  try {
    let response: Response;
    try {
      response = await fetchImpl(href, { signal: limit.signal, credentials: "same-origin" });
    } catch {
      throw failureOf(limit.timedOut(), signal);
    }
    if (!response.ok) throw await refusalOf(response);
    try {
      return await response.blob();
    } catch {
      throw failureOf(limit.timedOut(), signal);
    }
  } finally {
    limit.clear();
  }
}

function failureOf(timedOut: boolean, signal: AbortSignal | undefined): LiveDownloadError {
  if (timedOut) return new LiveDownloadError(DOWNLOAD_TIMED_OUT_MESSAGE, "TIMEOUT");
  if (signal?.aborted) return new LiveDownloadError("Download cancelled.", "CANCELLED");
  return new LiveDownloadError(DOWNLOAD_OFFLINE_MESSAGE, "NETWORK");
}

/** The reader's message for anything a download threw. */
export function liveDownloadMessage(error: unknown): string {
  return error instanceof LiveDownloadError ? error.message : DOWNLOAD_FAILED_MESSAGE;
}
