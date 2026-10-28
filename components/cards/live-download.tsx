"use client";

// ---------------------------------------------------------------------------
// A download link that shows its file being drawn (TODO 6.30) — the download
// modal's PNG / JPEG / print image and PDF buttons.
//
// The link stays a real `<a href download>` (a middle-click, "Save link as"
// and a modifier-click still go straight to the browser), but a plain click
// fetches the same URL itself (lib/cards/live-download.ts): the button shows
// a spinner and "Preparing your image…", the surface's ONE polite live
// region (`LiveDownloadStatus`) says large files can take up to a minute,
// the file is saved under the link's own name when it lands, and a refusal,
// a time-out or a dropped connection is said in words — never a dead click.
// What is downloaded is exactly what the link names.
//
//   * ONE file at a time per surface: while it is prepared EVERY download
//     button of the surface keeps the spinner and the busy look (an option
//     changed meanwhile moves the link, never the file being prepared), and
//     a Cancel button stops it.
//   * The saved file stays reachable: a browser may drop a save that comes
//     long after the click, so "Saved" says "if nothing appeared, use Save
//     file", and Save file is a plain link to the same bytes until the next
//     download or the surface closes.
//   * iOS (every browser there is WebKit) keeps the native link, as before
//     6.30 — its Safari can drop a programmatic save made after the tap.
//   * A download lives in this tab: a reload or a closed tab ends it.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Download, Loader2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DOWNLOAD_CANCELLED_MESSAGE,
  LONG_DOWNLOAD_NOTE,
  LiveDownloadError,
  fetchLiveDownload,
  isIosBrowser,
  liveDownloadMessage,
  preparingLabel,
  type LiveDownloadNoun,
} from "@/lib/cards/live-download";
import { cn } from "@/lib/utils";

export type LiveDownloadState =
  | { status: "idle" }
  | { status: "preparing"; href: string; noun: LiveDownloadNoun }
  | { status: "saved"; filename: string; url: string }
  | { status: "cancelled" }
  | { status: "failed"; message: string };

export type LiveDownload = {
  state: LiveDownloadState;
  /** Fetches `href` and saves it as `filename`; ignored while another file
   *  of this surface is being prepared. */
  start: (href: string, filename: string, noun: LiveDownloadNoun) => void;
  /** Stops the file being prepared. */
  cancel: () => void;
};

/** Hands an object URL to the browser under the link's name. */
export function saveObjectUrl(url: string, filename: string): void {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

/** Whether this browser keeps the native link (iOS). */
function keepsNativeLink(): boolean {
  if (typeof navigator === "undefined") return false;
  return isIosBrowser({
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints,
  });
}

/** One surface's download state: one file at a time. */
export function useLiveDownload(): LiveDownload {
  const [state, setState] = useState<LiveDownloadState>({ status: "idle" });
  const busyRef = useRef(false);
  const mountedRef = useRef(true);
  const abortRef = useRef<AbortController | null>(null);
  // The last saved file's object URL: kept for "Save file" until the next
  // download or the surface goes away.
  const urlRef = useRef<string | null>(null);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    };
  }, []);
  const start = useCallback((href: string, filename: string, noun: LiveDownloadNoun) => {
    if (busyRef.current) return;
    busyRef.current = true;
    // The previous file's Save file link goes with the new download.
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
    const controller = new AbortController();
    abortRef.current = controller;
    setState({ status: "preparing", href, noun });
    void fetchLiveDownload(href, { signal: controller.signal })
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        // Saved even when the dialog was closed meanwhile, as the browser's
        // own download would have been.
        saveObjectUrl(url, filename);
        if (mountedRef.current) {
          urlRef.current = url;
          setState({ status: "saved", filename, url });
        } else {
          setTimeout(() => URL.revokeObjectURL(url), 60_000);
        }
      })
      .catch((error: unknown) => {
        if (!mountedRef.current) return;
        if (error instanceof LiveDownloadError && error.code === "CANCELLED") setState({ status: "cancelled" });
        else setState({ status: "failed", message: liveDownloadMessage(error) });
      })
      .finally(() => {
        busyRef.current = false;
        if (abortRef.current === controller) abortRef.current = null;
      });
  }, []);
  const cancel = useCallback(() => abortRef.current?.abort(), []);
  return { state, start, cancel };
}

/** The download button: a real link, drawn as a Button, that reports its
 *  file through `live`. */
export function LiveDownloadLink({
  live,
  href,
  filename,
  noun,
  onDownload,
  variant,
  className,
  children,
}: {
  live: LiveDownload;
  href: string;
  filename: string;
  noun: LiveDownloadNoun;
  /** Runs as the download starts (the PDF remembers its options) — on
   *  every click, a modifier click included. */
  onDownload?: () => void;
  variant?: "primary" | "outline";
  className?: string;
  /** The idle label, after the download icon. */
  children: ReactNode;
}) {
  const { state } = live;
  const preparing = state.status === "preparing";
  return (
    <Button asChild variant={variant} className={className}>
      <a
        href={href}
        download={filename}
        aria-busy={preparing || undefined}
        aria-disabled={preparing || undefined}
        className={cn(preparing && "cursor-progress opacity-80")}
        onClick={(event) => {
          // Whatever happens next, the click asked for this file.
          onDownload?.();
          // A modifier or a middle click is the browser's own (a new tab, a
          // "save as"), and iOS keeps the native link.
          if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          if (keepsNativeLink()) return;
          event.preventDefault();
          if (preparing) return;
          live.start(href, filename, noun);
        }}
      >
        {state.status === "preparing" ? (
          // The surface's ONE file, whichever button shows it.
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {preparingLabel(state.noun)}
          </>
        ) : (
          <>
            <Download className="h-4 w-4" aria-hidden /> {children}
          </>
        )}
      </a>
    </Button>
  );
}

/** The surface's ONE polite live region: mounted empty, so the first
 *  message is heard; it says what is being prepared and how long it can
 *  take, that the file was saved, or why it wasn't. Beside it (never in it):
 *  Cancel while a file is prepared, Save file once one is saved. */
export function LiveDownloadStatus({ live, className }: { live: LiveDownload; className?: string }) {
  const { state } = live;
  return (
    <div className={cn("flex flex-col items-start gap-2", state.status === "idle" && "gap-0", className)}>
      <p
        role="status"
        aria-live="polite"
        data-testid="live-download-status"
        className={cn(
          "text-xs leading-5",
          state.status === "failed" ? "text-danger" : "text-muted",
          state.status === "idle" && "sr-only",
        )}
      >
        {state.status === "preparing" ? (
          <>
            <span className="sr-only">{preparingLabel(state.noun)} </span>
            {LONG_DOWNLOAD_NOTE}
          </>
        ) : state.status === "saved" ? (
          `Saved ${state.filename} — if nothing appeared, use Save file.`
        ) : state.status === "cancelled" ? (
          DOWNLOAD_CANCELLED_MESSAGE
        ) : state.status === "failed" ? (
          <span className="inline-flex items-start gap-1.5">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>{state.message}</span>
          </span>
        ) : null}
      </p>
      {state.status === "preparing" ? (
        <Button type="button" variant="ghost" size="sm" onClick={live.cancel}>
          Cancel
        </Button>
      ) : state.status === "saved" ? (
        <Button asChild variant="ghost" size="sm">
          <a href={state.url} download={state.filename} data-testid="live-download-save">
            <Download className="h-4 w-4" aria-hidden /> Save file
          </a>
        </Button>
      ) : null}
    </div>
  );
}
