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
// with a progress card; each card's render reads through the same limits
// (lib/decks/export-client.ts), so a render that hangs is a skipped card,
// never an export that never ends.
//
// TWO limits, never one clock over the whole file (#628's check):
//   * the wait for the response's HEADERS — the render itself — is the
//     server's own limit (LIVE_DOWNLOAD_HEADERS_TIMEOUT_MS): a slow render
//     the server would still finish is never cancelled by the browser;
//   * the BODY is read chunk by chunk under a STALL timer that restarts on
//     every chunk (LIVE_DOWNLOAD_STALL_TIMEOUT_MS): a 20 MB 800 ppi + bleed
//     PNG on a slow link takes as long as it takes while bytes keep coming,
//     and a connection that stops sending is said, not waited on forever.
//
// Pure and client-safe: no React, no DOM but what the caller passes in.
// ---------------------------------------------------------------------------

/** How long the browser waits for a live render to START answering: the
 *  server's own limit. The card png / pdf routes declare no `maxDuration`,
 *  so Vercel's default applies — 300 s with Fluid compute (a test reads the
 *  routes and fails if one declares a longer one). */
export const LIVE_DOWNLOAD_HEADERS_TIMEOUT_MS = 300_000;

/** How long the body may go without a single new byte before the download
 *  is stopped. Restarted on every chunk — never a limit on the whole file. */
export const LIVE_DOWNLOAD_STALL_TIMEOUT_MS = 30_000;

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
export const DOWNLOAD_STALLED_MESSAGE =
  "The file stopped arriving, so the download was stopped. Check your connection and try again.";
export const DOWNLOAD_OFFLINE_MESSAGE =
  "The download didn't go through. Check your connection and try again.";
export const DOWNLOAD_FAILED_MESSAGE = "This file couldn't be prepared. Try again in a moment.";
export const DOWNLOAD_CANCELLED_MESSAGE = "Download cancelled.";

export class LiveDownloadError extends Error {
  constructor(
    message: string,
    readonly code?: "TIMEOUT" | "STALLED" | "NETWORK" | "CANCELLED" | string,
  ) {
    super(message);
    this.name = "LiveDownloadError";
  }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type LiveFetchLimits = {
  /** The wait for the response headers (the render). */
  headersTimeoutMs?: number;
  /** The longest gap between two body chunks. */
  stallTimeoutMs?: number;
};

/** A fetched response with its whole body read. */
export type LiveFetchResult = {
  ok: boolean;
  status: number;
  contentType: string | null;
  bytes: Uint8Array;
};

/**
 * Fetches `href` under the two limits: the headers within
 * `headersTimeoutMs`, then the body with no gap longer than
 * `stallTimeoutMs`. Resolves with the status and the whole body (a refusal's
 * too — it carries the route's words); rejects with a LiveDownloadError:
 * TIMEOUT (no answer in time), STALLED (the body stopped), NETWORK (the
 * connection failed), CANCELLED (`signal` aborted).
 */
export async function fetchWithLimits(
  href: string,
  {
    fetchImpl = fetch,
    signal,
    headersTimeoutMs = LIVE_DOWNLOAD_HEADERS_TIMEOUT_MS,
    stallTimeoutMs = LIVE_DOWNLOAD_STALL_TIMEOUT_MS,
  }: { fetchImpl?: FetchLike; signal?: AbortSignal } & LiveFetchLimits = {},
): Promise<LiveFetchResult> {
  const controller = new AbortController();
  let expired: "TIMEOUT" | "STALLED" | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = (ms: number, why: "TIMEOUT" | "STALLED") => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      expired = why;
      controller.abort();
    }, ms);
  };
  const onParentAbort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener("abort", onParentAbort, { once: true });
  const failure = (): LiveDownloadError =>
    expired === "TIMEOUT"
      ? new LiveDownloadError(DOWNLOAD_TIMED_OUT_MESSAGE, "TIMEOUT")
      : expired === "STALLED"
        ? new LiveDownloadError(DOWNLOAD_STALLED_MESSAGE, "STALLED")
        : signal?.aborted
          ? new LiveDownloadError(DOWNLOAD_CANCELLED_MESSAGE, "CANCELLED")
          : new LiveDownloadError(DOWNLOAD_OFFLINE_MESSAGE, "NETWORK");

  try {
    if (controller.signal.aborted) throw failure();
    arm(headersTimeoutMs, "TIMEOUT");
    let response: Response;
    try {
      response = await fetchImpl(href, { signal: controller.signal, credentials: "same-origin" });
    } catch {
      throw failure();
    }
    // The render answered: from here only a STALL stops it.
    arm(stallTimeoutMs, "STALLED");
    let bytes: Uint8Array;
    try {
      const reader = response.body?.getReader();
      if (!reader) {
        bytes = new Uint8Array(await response.arrayBuffer());
      } else {
        const chunks: Uint8Array[] = [];
        let total = 0;
        const abortRead = () => void reader.cancel().catch(() => {});
        controller.signal.addEventListener("abort", abortRead, { once: true });
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (controller.signal.aborted) throw failure();
            if (done) break;
            if (value) {
              chunks.push(value);
              total += value.byteLength;
            }
            arm(stallTimeoutMs, "STALLED");
          }
        } finally {
          controller.signal.removeEventListener("abort", abortRead);
        }
        bytes = new Uint8Array(total);
        let at = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, at);
          at += chunk.byteLength;
        }
      }
    } catch (error) {
      if (error instanceof LiveDownloadError) throw error;
      throw failure();
    }
    return { ok: response.ok, status: response.status, contentType: response.headers.get("content-type"), bytes };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onParentAbort);
  }
}

/** The message a refused response carries (the routes answer
 *  `{ error, code }`), else the generic one. */
function refusalOf(bytes: Uint8Array): LiveDownloadError {
  let body: { error?: unknown; code?: unknown } | null = null;
  try {
    body = JSON.parse(new TextDecoder().decode(bytes)) as { error?: unknown; code?: unknown };
  } catch {
    body = null;
  }
  const message = typeof body?.error === "string" && body.error.trim() ? body.error : DOWNLOAD_FAILED_MESSAGE;
  return new LiveDownloadError(message, typeof body?.code === "string" ? body.code : undefined);
}

/**
 * Fetches a download's file — the URL the link names, unchanged — under
 * the two limits. Resolves with its bytes as a Blob; rejects with a
 * LiveDownloadError whose message is meant for the reader: the route's own
 * refusal, a time-out, a stalled or dropped connection, a cancel.
 */
export async function fetchLiveDownload(
  href: string,
  options: { fetchImpl?: FetchLike; signal?: AbortSignal } & LiveFetchLimits = {},
): Promise<Blob> {
  const result = await fetchWithLimits(href, options);
  if (!result.ok) throw refusalOf(result.bytes);
  return new Blob([result.bytes as BlobPart], result.contentType ? { type: result.contentType } : undefined);
}

/** The reader's message for anything a download threw. */
export function liveDownloadMessage(error: unknown): string {
  return error instanceof LiveDownloadError ? error.message : DOWNLOAD_FAILED_MESSAGE;
}

/**
 * True on an iPhone, iPad or iPod — EVERY browser there is WebKit. Its
 * Safari can drop a programmatic save (`a.click()` on a blob URL) that comes
 * long after the tap, so on iOS the download modal leaves the link to the
 * browser, as before 6.30. An iPad asking for the desktop site says
 * "MacIntel" with touch points.
 */
export function isIosBrowser(env: { userAgent?: string; platform?: string; maxTouchPoints?: number }): boolean {
  if (/iPad|iPhone|iPod/.test(env.userAgent ?? "")) return true;
  return env.platform === "MacIntel" && (env.maxTouchPoints ?? 0) > 1;
}
