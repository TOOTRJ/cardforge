"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import {
  ImagePlus,
  Loader2,
  Move,
  Trash2,
  Upload,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  SOFT_PRINT_PPI,
  artPrintPpi,
  focalTravel,
  positionerSurfaceStyle,
  recommendedArtSize,
  type ArtWindow,
} from "@/lib/cards/art-positioner-window";
import { uploadCardArtFile } from "@/lib/cards/art-upload-client";
import { CARD_ART_MAX_LABEL, CARD_ART_MIME_TYPES, cardArtFileProblem } from "@/lib/cards/art-upload-limits";
import { cn, clamp } from "@/lib/utils";
import type { ArtPosition } from "@/types/card";

// ---------------------------------------------------------------------------
// Premium artwork uploader.
//
// Surface: a full-bleed dropzone that doubles as the artwork preview. The
// user can drop a file onto it, click to open the file picker, paste an
// image from the clipboard (while the page is focused), or grab the
// already-uploaded artwork and drag to PAN it under the crop. Shift + mouse
// wheel adjusts zoom; arrow keys nudge for keyboard users, and the zoom
// buttons under the surface do the same for touch. Positioning is drag-first
// — there are no sliders.
//
// The surface IS the card's art window (TODO 3b.13): with art loaded it has
// the aspect of the box the renderers crop this face's art to (`artWindow`,
// lib/cards/art-positioner-window.ts — the frame's own slot, a second
// face's, a double-faced back's), and the picture is laid in it with the
// renderers' own CSS. So what shows here is the crop the preview draws and
// the bake stores, and it follows a frame change. The dragged pixel tracks
// the cursor 1:1 because one unit of focal moves the picture by exactly
// (box − covered·zoom) px (focalTravel); we divide the drag by that.
// ---------------------------------------------------------------------------

// The renderers' own clamps (card-preview.tsx / card-image.tsx: 0.5 – 4).
const MIN_SCALE = 0.5;
const MAX_SCALE = 4;
const ZOOM_STEP = 0.05;
const ACCEPTED_TYPES = CARD_ART_MIME_TYPES.join(",");
// The EMPTY dropzone: a file target, not a crop — a comfortable fixed box.
const EMPTY_ASPECT_RATIO_CLASS = "aspect-[5/4]";
// Pointer must travel this far before a press becomes a pan — so a plain
// click (or a tap) never nudges the framing.
const DRAG_THRESHOLD_PX = 3;

type ArtUploaderProps = {
  userId: string | null;
  artUrl: string | null | undefined;
  artPosition: ArtPosition;
  /** The box this face's art is cropped to on the card (TODO 3b.13;
   *  artPositionerWindows in lib/cards/art-positioner-window.ts). The
   *  positioning surface takes its aspect. */
  artWindow: Pick<ArtWindow, "aspect" | "width" | "height" | "rotation">;
  onArtChange: (next: { artUrl: string | null; artPosition: ArtPosition }) => void;
  /** When several uploaders are mounted at once (front art + an inline second
   *  face), a page-level paste must land in exactly one of them. A hovered or
   *  focused dropzone always wins; failing that, the single primary instance
   *  takes the paste. Mark every non-front uploader `primaryPasteTarget={false}`. */
  primaryPasteTarget?: boolean;
  className?: string;
  /** Rendered beside the Choose file button — the creator's "Generate AI
   *  artwork and title" button lives here. */
  actionSlot?: React.ReactNode;
};

export function ArtUploader({
  userId,
  artUrl,
  artPosition,
  artWindow,
  onArtChange,
  primaryPasteTarget = true,
  className,
  actionSlot,
}: ArtUploaderProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const dropzoneRef = useRef<HTMLDivElement | null>(null);
  // Snapshot of an in-progress pan: the pointer + focal origin and the px
  // the picture travels per unit of focal (focalTravel) captured on
  // pointer-down, plus whether the press has crossed the drag threshold yet.
  const panRef = useRef<{
    pointerX: number;
    pointerY: number;
    focalX: number;
    focalY: number;
    travelX: number;
    travelY: number;
    active: boolean;
  } | null>(null);
  // The loaded picture's natural pixel size, tagged with its picture — what
  // the drag (how far the art overflows the window) and the sharpness note
  // read. Null until the picture is known: its onLoad, or — for a picture
  // that finished loading BEFORE React attached onLoad (an edit page's art
  // is in the server HTML and usually in the browser's cache, so its load
  // event is gone by hydration) — the <img>'s own state when it mounts
  // (pictureRef). Without that second path a reopened card's art could not
  // be dragged and never got its sharpness note.
  const [loadedSize, setLoadedSize] = useState<{ src: string; width: number; height: number } | null>(null);
  const recordPicture = useCallback((img: HTMLImageElement) => {
    const src = img.getAttribute("src");
    const width = img.naturalWidth;
    const height = img.naturalHeight;
    if (!src || !(width > 0) || !(height > 0)) return;
    setLoadedSize((prev) =>
      prev && prev.src === src && prev.width === width && prev.height === height ? prev : { src, width, height },
    );
  }, []);
  const pictureRef = useCallback(
    (img: HTMLImageElement | null) => {
      if (img?.complete) recordPicture(img);
    },
    [recordPicture],
  );
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
  // This picture's size, once known (a size recorded for another picture —
  // the art was replaced — is not this one's).
  const natural = artUrl && loadedSize?.src === artUrl ? loadedSize : null;

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
      // Cheap client-side gates (lib/cards/art-upload-limits.ts: an image,
      // PNG / JPEG / WebP / GIF, up to 20 MB) to short-circuit obviously-
      // wrong files before the network round-trip. The real validation
      // lives on the server — the finish action decodes the bytes with Sharp
      // and rejects anything that isn't a real image within the size cap.
      const problem = cardArtFileProblem(file);
      if (problem) {
        toast.error(problem);
        return;
      }
      uploadingRef.current = true;
      setUploading(true);
      try {
        // start → PUT to the private staging bucket → finish
        // (lib/cards/art-upload-client.ts): a print-size file is too big for
        // a server action's body on Vercel (4.5 MB). Never throws.
        const result = await uploadCardArtFile(file);
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
      // Route the paste to exactly ONE uploader when several are mounted
      // (front art + an inline second face): the dropzone the user is
      // pointing at or has focused wins; with no engaged dropzone, the
      // primary (front) instance takes it. Without this gate, one ⌘V
      // uploaded into every mounted uploader — replacing the front art and
      // resetting its crop while the user was aiming at the back face.
      const zone = dropzoneRef.current;
      if (!zone) return;
      if (!zone.matches(":hover, :focus-within")) {
        if (!primaryPasteTarget) return;
        const engagedSibling = document.querySelector(
          "[data-art-uploader]:hover, [data-art-uploader]:focus-within",
        );
        if (engagedSibling) return;
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
  }, [handleFile, primaryPasteTarget]);

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

  // How far a grabbed point of the picture moves, per axis, for one unit of
  // focal — in CSS px of the surface (lib/cards/art-positioner-window.ts).
  // Signed: a picture zoomed out smaller than the window moves WITH the
  // focal, and the drag still follows the finger.
  const travelFor = (el: HTMLElement) => {
    if (!natural) return { x: 0, y: 0 };
    // The content box: what the <img> fills (clientWidth excludes borders).
    return focalTravel({ width: el.clientWidth, height: el.clientHeight }, natural, scale);
  };

  const handleArtPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!artUrl || uploading) return;
    // Skip secondary buttons so right-click context menu still works and
    // middle-click doesn't accidentally enter pan mode.
    if (event.button !== 0) return;
    const travel = travelFor(event.currentTarget);
    panRef.current = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      focalX,
      focalY,
      travelX: travel.x,
      travelY: travel.y,
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
    // its left side — i.e. focalX decreases (the travel is negative for a
    // picture larger than its window). Dividing by the travel makes the
    // dragged pixel track the cursor 1:1 at any zoom.
    const nextFocalX =
      pan.travelX !== 0
        ? clamp(pan.focalX + dx / pan.travelX, 0, 1)
        : pan.focalX;
    const nextFocalY =
      pan.travelY !== 0
        ? clamp(pan.focalY + dy / pan.travelY, 0, 1)
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

  // Rounded so repeated steps never drift off the 5 % grid (0.1 + 0.2).
  const zoomBy = (delta: number) => {
    const next = clamp(Math.round((scale + delta) * 100) / 100, MIN_SCALE, MAX_SCALE);
    if (next !== scale) updatePosition({ scale: next });
  };

  // A NATIVE, non-passive listener (the effect below): React attaches its
  // own wheel listeners passive, so a preventDefault in an onWheel prop is
  // ignored and the page scrolled under every Shift-scroll zoom.
  const handleWheel = (event: globalThis.WheelEvent) => {
    if (!artUrl) return;
    // Don't hijack page scrolls — only zoom when the user is actively
    // holding shift (intentional zoom gesture). Wheel-only would steal the
    // page scroll while the cursor crossed the preview.
    if (!event.shiftKey) return;
    // With Shift held, macOS and Chrome report a vertical wheel as a
    // horizontal one: deltaY is 0 and the turn is in deltaX.
    const turn = event.deltaY || event.deltaX;
    if (!turn) return;
    event.preventDefault();
    zoomBy(turn > 0 ? -ZOOM_STEP : ZOOM_STEP);
  };
  const wheelHandlerRef = useRef(handleWheel);
  useEffect(() => {
    wheelHandlerRef.current = handleWheel;
  });
  useEffect(() => {
    const zone = dropzoneRef.current;
    if (!zone) return;
    const onWheel = (event: globalThis.WheelEvent) => wheelHandlerRef.current(event);
    zone.addEventListener("wheel", onWheel, { passive: false });
    return () => zone.removeEventListener("wheel", onWheel);
  }, []);


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
        zoomBy(ZOOM_STEP);
        return;
      case "-":
      case "_":
        event.preventDefault();
        zoomBy(-ZOOM_STEP);
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

  const best = recommendedArtSize(artWindow);
  // Loaded: the surface is the art window. The window's edge is an OUTLINE,
  // never a border — a border would shrink the box the picture fills and
  // its aspect with it (2 px a side is 1.5 % on a saga's narrow window).
  const surfaceStyle = artUrl ? positionerSurfaceStyle(artWindow.aspect) : undefined;
  // How sharp this picture prints in this window at this zoom.
  const ppi = artPrintPpi(artWindow, natural, scale);

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-subtle">
          Artwork
        </span>
        <span className="text-[11px] text-subtle">
          PNG · JPEG · WebP · GIF · up to {CARD_ART_MAX_LABEL}
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
        data-art-uploader=""
        onDragEnter={handleDragOver}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onPointerDown={handleArtPointerDown}
        onPointerMove={handleArtPointerMove}
        onPointerUp={handleArtPointerUp}
        onPointerCancel={handleArtPointerUp}
        onKeyDown={(event) => {
          if ((event.key === "Enter" || event.key === " ") && !artUrl) {
            event.preventDefault();
            openPicker();
            return;
          }
          handleDropzoneKeyDown(event);
        }}
        // With art loaded this is an interactive positioning surface (drag to
        // pan, arrow keys nudge, Shift-scroll zoom) — not a static image, so
        // "group" rather than the misleading "img". Empty, it's a picker button.
        role={artUrl ? "group" : "button"}
        aria-label={
          artUrl
            ? "Drag to reposition the art. Shift-scroll to zoom. Arrow keys nudge, +/- zoom, R resets."
            : "Drop an image here or click to upload"
        }
        tabIndex={0}
        data-art-window-aspect={artUrl ? artWindow.aspect.toFixed(4) : undefined}
        style={surfaceStyle}
        className={cn(
          "group relative overflow-hidden bg-elevated/40 transition-colors",
          artUrl
            ? // touch-none: a finger on the picture pans it. Without it the
              // browser takes the drag as a page scroll after a few px and
              // cancels the pointer (the page scrolls from anywhere else).
              "mx-auto max-w-full touch-none rounded-sm outline-solid outline-1 outline-border-strong"
            : cn("rounded-lg border-2 border-dashed", EMPTY_ASPECT_RATIO_CLASS),
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          isDragOver
            ? artUrl
              ? "outline-primary/80"
              : "border-primary/80 bg-primary/10"
            : artUrl
              ? ""
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
              ref={pictureRef}
              onLoad={(event) => recordPicture(event.currentTarget)}
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
          <EmptyDropzoneInner uploading={uploading} dragOver={isDragOver} best={best} />
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
        {actionSlot}
        {artUrl ? (
          <>
            <div className="inline-flex items-center gap-1" role="group" aria-label="Zoom">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label="Zoom out"
                onClick={() => zoomBy(-ZOOM_STEP)}
                disabled={uploading || scale <= MIN_SCALE}
              >
                <ZoomOut className="h-4 w-4" aria-hidden />
              </Button>
              <span
                className="min-w-10 text-center text-xs tabular-nums text-muted"
                data-testid="art-zoom-readout"
              >
                {Math.round(scale * 100)}%
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label="Zoom in"
                onClick={() => zoomBy(ZOOM_STEP)}
                disabled={uploading || scale >= MAX_SCALE}
              >
                <ZoomIn className="h-4 w-4" aria-hidden />
              </Button>
            </div>
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
          This is the card&apos;s art window: what you see here is the crop the
          card gets. Drag the art to position it, Shift-scroll or the zoom
          buttons to zoom. Arrow keys nudge for fine control.
          {artWindow.rotation % 180 !== 0
            ? " Shown upright — the card turns this half on its side."
            : artWindow.rotation
              ? " Shown upright — the card turns this half upside down."
              : ""}{" "}
          Sharpest at {best.width} × {best.height} px or larger.
        </p>
      ) : null}
      {natural && ppi !== null && ppi < SOFT_PRINT_PPI ? (
        <p className="text-[11px] leading-5 text-accent" data-testid="art-soft-note">
          This picture is {natural.width} × {natural.height} px: about {ppi} ppi in this
          window at this zoom. It may look soft in print (300 ppi is sharp).
        </p>
      ) : null}
      {!userId ? (
        <p className="text-xs text-subtle">Sign in to upload artwork.</p>
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
  best,
}: {
  uploading: boolean;
  dragOver: boolean;
  best: { width: number; height: number };
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
        {/* This frame's art window on the HD card (1500 × 2100). */}
        <p className="text-[11px] text-subtle" data-testid="art-best-size">
          Best results: {best.width} × {best.height} px or larger
        </p>
      </div>
    </div>
  );
}

