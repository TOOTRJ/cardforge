"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type PointerEvent,
  type WheelEvent,
} from "react";
import {
  ImagePlus,
  Loader2,
  Move,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { uploadCardArtServerAction } from "@/lib/cards/upload-art-server";
import { cn } from "@/lib/utils";
import type { ArtPosition } from "@/types/card";

// ---------------------------------------------------------------------------
// Premium artwork uploader.
//
// Surface: a full-bleed dropzone that doubles as the artwork preview. The
// user can drop a file onto it, click to open the file picker, paste an
// image from the clipboard (while the page is focused), or grab the
// already-uploaded artwork and drag to PAN it under the crop. Shift + mouse
// wheel adjusts zoom; arrow keys nudge for keyboard users. Positioning is
// drag-first — there are no sliders. The dragged pixel tracks the cursor 1:1
// because focalX/Y map to object-position, whose screen sensitivity is
// exactly (boxSize − displayedSize); we divide the drag delta by that overflow.
// ---------------------------------------------------------------------------

const MIN_SCALE = 0.5;
const MAX_SCALE = 3;
const ACCEPTED_TYPES = "image/png,image/jpeg,image/webp,image/gif";
const ASPECT_RATIO_CLASS = "aspect-[5/4]";
// Pointer must travel this far before a press becomes a pan — so a plain
// click (or a tap) never nudges the framing.
const DRAG_THRESHOLD_PX = 3;
// Mirror the server's byte cap so we fail fast on an oversized drop/paste
// before spending the upload round-trip. The server (upload-art-server.ts) is
// still the source of truth.
const MAX_FILE_BYTES = 8 * 1024 * 1024;

type ArtUploaderProps = {
  userId: string | null;
  artUrl: string | null | undefined;
  artPosition: ArtPosition;
  onArtChange: (next: { artUrl: string | null; artPosition: ArtPosition }) => void;
  className?: string;
};

export function ArtUploader({
  userId,
  artUrl,
  artPosition,
  onArtChange,
  className,
}: ArtUploaderProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const dropzoneRef = useRef<HTMLDivElement | null>(null);
  // Snapshot of an in-progress pan: the pointer + focal origin and the
  // overflow (displayed − box) captured on pointer-down, plus whether the
  // press has crossed the drag threshold yet.
  const panRef = useRef<{
    pointerX: number;
    pointerY: number;
    focalX: number;
    focalY: number;
    overflowX: number;
    overflowY: number;
    active: boolean;
  } | null>(null);
  // The loaded image's natural pixel size — needed to compute how far the art
  // overflows the crop box (and thus the drag→focal conversion). Null until the
  // <img> fires onLoad; reset when the art changes.
  const naturalSizeRef = useRef<{ w: number; h: number } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isDraggingArt, setIsDraggingArt] = useState(false);
  // In-flight + mounted guards. `uploadingRef` mirrors `uploading` but is
  // readable synchronously from the drop/paste closures (which the disabled
  // Button can't gate) so a second file dropped mid-upload can't start a
  // racing upload whose response order decides the winner. `mountedRef` stops
  // the post-await state writes (and the RHF onArtChange) from firing after the
  // panel unmounts — navigating away mid-upload otherwise warns + writes to a
  // dead form.
  const uploadingRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const focalX = clamp(artPosition.focalX ?? 0.5, 0, 1);
  const focalY = clamp(artPosition.focalY ?? 0.5, 0, 1);
  const scale = clamp(artPosition.scale ?? 1, MIN_SCALE, MAX_SCALE);

  // A new image's natural size is unknown until it loads — clear the cached
  // dimensions so the pan math doesn't use the previous art's overflow.
  useEffect(() => {
    naturalSizeRef.current = null;
  }, [artUrl]);

  // ---- Upload ------------------------------------------------------------

  const handleFile = useCallback(
    async (file: File) => {
      if (!userId) {
        toast.error("You need to be signed in to upload artwork.");
        return;
      }
      // One upload at a time. The Button + picker are disabled while
      // `uploading`, but the drop and paste paths call in here directly — an
      // unguarded second file would start a concurrent upload and the
      // last-to-resolve response would win non-deterministically.
      if (uploadingRef.current) {
        toast.info("Hang on — an upload is already in progress.");
        return;
      }
      // Cheap client-side gates to short-circuit obviously-wrong files
      // before the network round-trip. The real validation lives in the
      // server action — Sharp decodes the bytes and rejects anything
      // that isn't a real PNG / JPEG / WebP / GIF within the size cap.
      if (!file.type.startsWith("image/")) {
        toast.error("That doesn't look like an image.");
        return;
      }
      if (file.size > MAX_FILE_BYTES) {
        toast.error("That image is over 8 MB. Pick a smaller file.");
        return;
      }
      uploadingRef.current = true;
      setUploading(true);
      try {
        // Pass the File via FormData. Server actions accept FormData
        // arguments natively in Next.js — the file streams over the
        // wire without us having to base64 it ourselves.
        const formData = new FormData();
        formData.append("file", file);
        const result = await uploadCardArtServerAction(formData);
        // Bail if the panel unmounted mid-upload — writing to the (now dead)
        // form would warn and land nowhere useful.
        if (!mountedRef.current) return;
        if (!result.ok) {
          toast.error(result.error);
          return;
        }
        onArtChange({
          artUrl: result.publicUrl,
          artPosition: { focalX: 0.5, focalY: 0.5, scale: 1 },
        });
        toast.success("Artwork uploaded.");
      } finally {
        uploadingRef.current = false;
        if (mountedRef.current) {
          setUploading(false);
          if (inputRef.current) {
            inputRef.current.value = "";
          }
        }
      }
    },
    [userId, onArtChange],
  );

  // ---- Paste-from-clipboard ---------------------------------------------

  useEffect(() => {
    // Only listen while we're the sole uploader on screen. The handler is
    // global because pasting into a focused-but-non-input area dispatches
    // the event on `document`. We bail if the active element is text-like —
    // pasting into rules text shouldn't accidentally upload an image that
    // happens to also be on the clipboard.
    function onPaste(event: ClipboardEvent) {
      const target = document.activeElement;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }
      const items = event.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) {
            event.preventDefault();
            void handleFile(file);
            return;
          }
        }
      }
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [handleFile]);

  // ---- Drag-drop file ----------------------------------------------------

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    // Block the browser from navigating away on drop, AND from drawing the
    // default "no-go" cursor while hovering. Must be on both dragenter and
    // dragover for cross-browser reliability.
    if (Array.from(event.dataTransfer.types).includes("Files")) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      if (!isDragOver) setIsDragOver(true);
    }
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    // Only flip off the overlay when the pointer actually leaves the
    // dropzone (vs. moves between child elements). We check that the
    // related target isn't a descendant.
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
      return;
    }
    setIsDragOver(false);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragOver(false);
    const file = event.dataTransfer.files?.[0];
    if (file) {
      void handleFile(file);
    }
  };

  // ---- Drag-to-pan the art ----------------------------------------------

  const updatePosition = useCallback(
    (patch: Partial<ArtPosition>) => {
      onArtChange({
        artUrl: artUrl ?? null,
        artPosition: { ...artPosition, ...patch },
      });
    },
    [artUrl, artPosition, onArtChange],
  );

  // How far the displayed art overflows the crop box, per axis, in CSS px.
  // The art is object-fit:cover (so it's first scaled to cover the box), then
  // CSS-scaled by `scale`. object-position can only shift the art across this
  // overflow, so it's exactly the pixel range one axis of focal (0→1) spans.
  const overflowFor = (rect: DOMRect) => {
    const nat = naturalSizeRef.current;
    if (!nat || nat.w <= 0 || nat.h <= 0) return { x: 0, y: 0 };
    const coverScale = Math.max(rect.width / nat.w, rect.height / nat.h);
    const displayedW = nat.w * coverScale * scale;
    const displayedH = nat.h * coverScale * scale;
    return {
      x: Math.max(0, displayedW - rect.width),
      y: Math.max(0, displayedH - rect.height),
    };
  };

  const handleArtPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!artUrl || uploading) return;
    // Skip secondary buttons so right-click context menu still works and
    // middle-click doesn't accidentally enter pan mode.
    if (event.button !== 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const overflow = overflowFor(rect);
    panRef.current = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      focalX,
      focalY,
      overflowX: overflow.x,
      overflowY: overflow.y,
      active: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleArtPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const pan = panRef.current;
    if (!pan) return;
    const dx = event.clientX - pan.pointerX;
    const dy = event.clientY - pan.pointerY;
    // Hold until the press clears the threshold, so a click never pans.
    if (!pan.active) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      pan.active = true;
      setIsDraggingArt(true);
    }
    // Grab-and-drag: moving the pointer right pulls the art right, revealing
    // its left side — i.e. focalX decreases. Dividing by the overflow makes
    // the dragged pixel track the cursor 1:1 at any zoom.
    const nextFocalX =
      pan.overflowX > 0
        ? clamp(pan.focalX - dx / pan.overflowX, 0, 1)
        : pan.focalX;
    const nextFocalY =
      pan.overflowY > 0
        ? clamp(pan.focalY - dy / pan.overflowY, 0, 1)
        : pan.focalY;
    updatePosition({ focalX: nextFocalX, focalY: nextFocalY });
  };

  const handleArtPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (!panRef.current) return;
    panRef.current = null;
    setIsDraggingArt(false);
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // releasePointerCapture throws if the capture was already released
      // (e.g. pointer-up fired on a different element); swallow.
    }
  };

  // ---- Wheel zoom --------------------------------------------------------

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (!artUrl) return;
    // Don't hijack page scrolls — only zoom when the user is actively
    // holding shift (intentional zoom gesture). Wheel-only would steal the
    // page scroll while the cursor crossed the preview.
    if (!event.shiftKey) return;
    event.preventDefault();
    const direction = event.deltaY > 0 ? -1 : 1;
    const step = 0.05;
    const next = clamp(scale + direction * step, MIN_SCALE, MAX_SCALE);
    updatePosition({ scale: next });
  };

  // ---- Misc handlers -----------------------------------------------------

  const openPicker = () => {
    if (uploading || !userId) return;
    inputRef.current?.click();
  };

  const handleRemove = () => {
    onArtChange({
      artUrl: null,
      artPosition: { focalX: 0.5, focalY: 0.5, scale: 1 },
    });
  };

  const handleResetPosition = () => {
    updatePosition({ focalX: 0.5, focalY: 0.5, scale: 1 });
  };

  // Keyboard nudging on the dropzone — arrow keys move the focal point by
  // 1% (Shift = 5%), `+` / `=` zooms in, `-` / `_` zooms out, `r` / `0`
  // resets. Matches the v2 spec. Only fires when the dropzone has focus
  // AND there's an artUrl (no point nudging an empty slot).
  const handleDropzoneKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!artUrl) {
      // The pre-existing Enter/Space-to-open behaviour still applies; we
      // bail early so we don't intercept it.
      return;
    }
    const step = event.shiftKey ? 0.05 : 0.01;
    switch (event.key) {
      case "ArrowLeft":
        event.preventDefault();
        updatePosition({ focalX: clamp(focalX - step, 0, 1) });
        return;
      case "ArrowRight":
        event.preventDefault();
        updatePosition({ focalX: clamp(focalX + step, 0, 1) });
        return;
      case "ArrowUp":
        event.preventDefault();
        updatePosition({ focalY: clamp(focalY - step, 0, 1) });
        return;
      case "ArrowDown":
        event.preventDefault();
        updatePosition({ focalY: clamp(focalY + step, 0, 1) });
        return;
      case "+":
      case "=":
        event.preventDefault();
        updatePosition({ scale: clamp(scale + 0.05, MIN_SCALE, MAX_SCALE) });
        return;
      case "-":
      case "_":
        event.preventDefault();
        updatePosition({ scale: clamp(scale - 0.05, MIN_SCALE, MAX_SCALE) });
        return;
      case "r":
      case "R":
      case "0":
        event.preventDefault();
        handleResetPosition();
        return;
      default:
        return;
    }
  };

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-subtle">
          Artwork
        </span>
        <span className="text-[11px] text-subtle">
          PNG · JPEG · WebP · GIF · up to 8 MB
        </span>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_TYPES}
        className="sr-only"
        aria-label="Upload card art"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />

      {/* Dropzone + preview surface. */}
      <div
        ref={dropzoneRef}
        onDragEnter={handleDragOver}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onPointerDown={handleArtPointerDown}
        onPointerMove={handleArtPointerMove}
        onPointerUp={handleArtPointerUp}
        onPointerCancel={handleArtPointerUp}
        onWheel={handleWheel}
        onKeyDown={(event) => {
          if ((event.key === "Enter" || event.key === " ") && !artUrl) {
            event.preventDefault();
            openPicker();
            return;
          }
          handleDropzoneKeyDown(event);
        }}
        role={artUrl ? "img" : "button"}
        aria-label={
          artUrl
            ? "Drag to reposition the art. Shift-scroll to zoom. Arrow keys nudge, +/- zoom, R resets."
            : "Drop an image here or click to upload"
        }
        tabIndex={0}
        className={cn(
          "group relative overflow-hidden rounded-lg border-2 border-dashed bg-elevated/40 transition-colors",
          ASPECT_RATIO_CLASS,
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          isDragOver
            ? "border-primary/80 bg-primary/10"
            : artUrl
              ? "border-border/60 border-solid"
              : "border-border hover:border-border-strong",
          artUrl && !isDraggingArt ? "cursor-grab" : "",
          isDraggingArt ? "cursor-grabbing" : "",
          !artUrl ? "cursor-pointer" : "",
        )}
        onClick={() => {
          if (!artUrl) openPicker();
        }}
      >
        {artUrl ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={artUrl}
              alt="Card artwork preview"
              draggable={false}
              onLoad={(event) => {
                naturalSizeRef.current = {
                  w: event.currentTarget.naturalWidth,
                  h: event.currentTarget.naturalHeight,
                };
              }}
              className="pointer-events-none h-full w-full select-none object-cover"
              style={{
                // Must stay identical to the bake/preview renderer
                // (lib/render/card-image.tsx, components/cards/card-preview.tsx):
                // object-cover + object-position + scale about the same origin,
                // NO rotation. Any drift here would make the editor lie about
                // the saved card.
                objectPosition: `${focalX * 100}% ${focalY * 100}%`,
                transform: `scale(${scale})`,
                transformOrigin: `${focalX * 100}% ${focalY * 100}%`,
              }}
            />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between bg-linear-to-t from-background/80 to-transparent p-3 text-[10px] uppercase tracking-wider text-muted opacity-0 transition-opacity group-hover:opacity-100">
              <span className="inline-flex items-center gap-1.5">
                <Move className="h-3 w-3" aria-hidden /> Drag to reposition · Shift-scroll to zoom
              </span>
            </div>
          </>
        ) : (
          <EmptyDropzoneInner uploading={uploading} dragOver={isDragOver} />
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant={artUrl ? "outline" : "primary"}
          onClick={openPicker}
          disabled={uploading || !userId}
        >
          {uploading ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : artUrl ? (
            <Upload className="h-4 w-4" aria-hidden />
          ) : (
            <ImagePlus className="h-4 w-4" aria-hidden />
          )}
          {uploading ? "Uploading…" : artUrl ? "Replace artwork" : "Choose file"}
        </Button>
        {artUrl ? (
          <>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleResetPosition}
              disabled={uploading}
            >
              Reset position
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleRemove}
              disabled={uploading}
            >
              <Trash2 className="h-4 w-4" aria-hidden />
              Remove
            </Button>
          </>
        ) : null}
      </div>
      {artUrl ? (
        <p className="text-[11px] leading-5 text-subtle">
          Drag the art to position it, Shift-scroll to zoom. Arrow keys nudge for
          fine control.
        </p>
      ) : null}
      {!userId ? (
        <p className="text-xs text-subtle">
          Sign in first to upload artwork. Until then the form still saves text.
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function EmptyDropzoneInner({
  uploading,
  dragOver,
}: {
  uploading: boolean;
  dragOver: boolean;
}) {
  return (
    <div className="pointer-events-none flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <div
        className={cn(
          "flex h-12 w-12 items-center justify-center rounded-full border bg-surface/80 transition-colors",
          dragOver
            ? "border-primary/80 text-primary-bright"
            : "border-border text-muted",
        )}
        aria-hidden
      >
        {uploading ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : (
          <ImagePlus className="h-5 w-5" />
        )}
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-foreground">
          {dragOver ? "Drop to upload" : "Drag art here, or click to choose"}
        </p>
        <p className="text-[11px] uppercase tracking-wider text-subtle">
          Paste from clipboard with{" "}
          <kbd className="rounded-sm border border-border bg-elevated px-1 py-0.5 font-mono text-[10px]">
            ⌘V
          </kbd>{" "}
          /{" "}
          <kbd className="rounded-sm border border-border bg-elevated px-1 py-0.5 font-mono text-[10px]">
            Ctrl V
          </kbd>
        </p>
      </div>
    </div>
  );
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}
