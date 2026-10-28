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
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Download, Loader2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  LONG_DOWNLOAD_NOTE,
  fetchLiveDownload,
  liveDownloadMessage,
  preparingLabel,
  type LiveDownloadNoun,
} from "@/lib/cards/live-download";
import { cn } from "@/lib/utils";

export type LiveDownloadState =
  | { status: "idle" }
  | { status: "preparing"; href: string; noun: LiveDownloadNoun }
  | { status: "saved"; filename: string }
  | { status: "failed"; message: string };

export type LiveDownload = {
  state: LiveDownloadState;
  /** Fetches `href` and saves it as `filename`; ignored while another file
   *  of this surface is being prepared. */
  start: (href: string, filename: string, noun: LiveDownloadNoun) => void;
};

/** Hands a fetched file to the browser under its link's name. */
export function saveDownloadedBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Some browsers read the object URL after the click returns.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** One surface's download state: one file at a time. */
export function useLiveDownload(): LiveDownload {
  const [state, setState] = useState<LiveDownloadState>({ status: "idle" });
  const busyRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const start = useCallback((href: string, filename: string, noun: LiveDownloadNoun) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setState({ status: "preparing", href, noun });
    void fetchLiveDownload(href)
      .then((blob) => {
        // Saved even when the dialog was closed meanwhile, as the browser's
        // own download would have been.
        saveDownloadedBlob(blob, filename);
        if (mountedRef.current) setState({ status: "saved", filename });
      })
      .catch((error: unknown) => {
        if (mountedRef.current) setState({ status: "failed", message: liveDownloadMessage(error) });
      })
      .finally(() => {
        busyRef.current = false;
      });
  }, []);
  return { state, start };
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
  /** Runs as the download starts (the PDF remembers its options). */
  onDownload?: () => void;
  variant?: "primary" | "outline";
  className?: string;
  /** The idle label, after the download icon. */
  children: ReactNode;
}) {
  const preparing = live.state.status === "preparing";
  const mine = live.state.status === "preparing" && live.state.href === href;
  return (
    <Button asChild variant={variant} className={className}>
      <a
        href={href}
        download={filename}
        aria-busy={mine || undefined}
        aria-disabled={preparing || undefined}
        className={cn(preparing && "cursor-progress")}
        onClick={(event) => {
          // A modifier or a middle click is the browser's own (a new tab, a
          // "save as"): leave it alone.
          if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          if (preparing) return;
          onDownload?.();
          live.start(href, filename, noun);
        }}
      >
        {mine ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {preparingLabel(noun)}
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
 *  take, that the file was saved, or why it wasn't. */
export function LiveDownloadStatus({ live, className }: { live: LiveDownload; className?: string }) {
  const { state } = live;
  return (
    <p
      role="status"
      aria-live="polite"
      data-testid="live-download-status"
      className={cn(
        "text-xs leading-5",
        state.status === "failed" ? "text-danger" : "text-muted",
        state.status === "idle" && "sr-only",
        className,
      )}
    >
      {state.status === "preparing" ? (
        <>
          <span className="sr-only">{preparingLabel(state.noun)} </span>
          {LONG_DOWNLOAD_NOTE}
        </>
      ) : state.status === "saved" ? (
        `Saved ${state.filename} — check your downloads.`
      ) : state.status === "failed" ? (
        <span className="inline-flex items-start gap-1.5">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>{state.message}</span>
        </span>
      ) : null}
    </p>
  );
}
