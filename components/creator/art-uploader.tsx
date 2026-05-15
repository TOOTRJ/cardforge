"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type PointerEvent,
  type WheelEvent,
} from "react";
import { ImagePlus, Loader2, Move, Trash2, Upload } from "lucide-react";
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
// image from the clipboard (while the page is focused), or drag the
// already-uploaded artwork around to set the focal point. Mouse wheel /
// pinch on the preview adjusts zoom. Sliders below stay as a fine-tune
// surface so keyboard users can still nudge values precisely.
// ---------------------------------------------------------------------------

const MIN_SCALE = 0.5;
const MAX_SCALE = 3;
const ACCEPTED_TYPES = "image/png,image/jpeg,image/webp,image/gif";
const ASPECT_RATIO_CLASS = "aspect-[5/4]";

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
  const isDraggingArtRef = useRef(false);
  const [uploading, setUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isDraggingArt, setIsDraggingArt] = useState(false);

  const focalX = clamp(artPosition.focalX ?? 0.5, 0, 1);
  const focalY = clamp(artPosition.focalY ?? 0.5, 0, 1);
  const scale = clamp(artPosition.scale ?? 1, MIN_SCALE, MAX_SCALE);

  // ---- Upload ------------------------------------------------------------

  const handleFile = useCallback(
    async (file: File) => {
      if (!userId) {
        toast.error("You need to be signed in to upload artwork.");
        return;
      }
      // Cheap client-side gate to short-circuit obviously-wrong files
      // before the network round-trip. The real validation lives in the
      // server action — Sharp decodes the bytes and rejects anything
      // that isn't a real PNG / JPEG / WebP / GIF.
      if (!file.type.startsWith("image/")) {
        toast.error("That doesn't look like an image.");
        return;
      }
      setUploading(true);
      try {
        // Pass the File via FormData. Server actions accept FormData
        // arguments natively in Next.js — the file streams over the
        // wire without us having to base64 it ourselves.
        const formData = new FormData();
        formData.append("file", file);
        const result = await uploadCardArtServerAction(formData);
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
        setUploading(false);
        if (inputRef.current) {
          inputRef.current.value = "";
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

  // ---- Drag-to-reposition focal point -----------------------------------

  const updatePosition = useCallback(
    (patch: Partial<ArtPosition>) => {
      onArtChange({
        artUrl: artUrl ?? null,
        artPosition: { ...artPosition, ...patch },
      });
    },
    [artUrl, artPosition, onArtChange],
  );

  const handleArtPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!artUrl || uploading) return;
    // Skip secondary buttons so right-click context menu still works and
    // middle-click doesn't accidentally enter pan mode.
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    isDraggingArtRef.current = true;
    setIsDraggingArt(true);
    pointToFocal(event);
  };

  const handleArtPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!isDraggingArtRef.current) return;
    pointToFocal(event);
  };

  const handleArtPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (!isDraggingArtRef.current) return;
    isDraggingArtRef.current = false;
    setIsDraggingArt(false);
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // releasePointerCapture throws if the capture was already released
      // (e.g. pointer-up fired on a different element); swallow.
    }
  };

  function pointToFocal(event: PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    const y = clamp((event.clientY - rect.top) / rect.height, 0, 1);
    updatePosition({ focalX: x, focalY: y });
  }

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
          }
        }}
        role={artUrl ? "img" : "button"}
        aria-label={
          artUrl
            ? "Drag to set focal point. Shift-scroll to zoom."
            : "Drop an image here or click to upload"
        }
        tabIndex={0}
        className={cn(
          "group relative overflow-hidden rounded-lg border-2 border-dashed bg-elevated/40 transition-colors",
          ASPECT_RATIO_CLASS,
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
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
              className="pointer-events-none h-full w-full select-none object-cover"
              style={{
                objectPosition: `${focalX * 100}% ${focalY * 100}%`,
                transform: `scale(${scale})`,
                transformOrigin: `${focalX * 100}% ${focalY * 100}%`,
              }}
            />
            <FocalCrosshair x={focalX} y={focalY} active={isDraggingArt} />
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
      {!userId ? (
        <p className="text-xs text-subtle">
          Sign in first to upload artwork. Until then the form still saves text.
        </p>
      ) : null}

      {artUrl ? (
        <div className="flex flex-col gap-3 rounded-lg border border-border/60 bg-surface/60 p-4">
          <p className="text-[11px] uppercase tracking-wider text-subtle">
            Fine-tune
          </p>
          <SliderRow
            label="Focal X"
            value={focalX}
            min={0}
            max={1}
            step={0.01}
            display={`${Math.round(focalX * 100)}%`}
            onChange={(value) => updatePosition({ focalX: value })}
          />
          <SliderRow
            label="Focal Y"
            value={focalY}
            min={0}
            max={1}
            step={0.01}
            display={`${Math.round(focalY * 100)}%`}
            onChange={(value) => updatePosition({ focalY: value })}
          />
          <SliderRow
            label="Zoom"
            value={scale}
            min={MIN_SCALE}
            max={MAX_SCALE}
            step={0.05}
            display={`${scale.toFixed(2)}×`}
            onChange={(value) => updatePosition({ scale: value })}
          />
        </div>
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
            ? "border-primary/80 text-primary"
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

function FocalCrosshair({
  x,
  y,
  active,
}: {
  x: number;
  y: number;
  active: boolean;
}) {
  // The crosshair sits over the art and shows the current focal anchor.
  // It tracks pointer drags 1:1 and fades when idle so it doesn't compete
  // with the artwork visually.
  return (
    <div
      className={cn(
        "pointer-events-none absolute z-10 transition-opacity",
        active ? "opacity-100" : "opacity-70",
      )}
      style={{
        left: `${x * 100}%`,
        top: `${y * 100}%`,
        transform: "translate(-50%, -50%)",
      }}
      aria-hidden
    >
      <div className="h-6 w-6 rounded-full border-2 border-white/80 shadow-[0_0_0_2px_rgba(0,0,0,0.4)]" />
      <div className="absolute inset-x-0 top-1/2 -mx-2 h-px -translate-y-1/2 bg-white/70" />
      <div className="absolute inset-y-0 left-1/2 -my-2 w-px -translate-x-1/2 bg-white/70" />
    </div>
  );
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  display,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-subtle">
        {label}
        <span className="font-mono text-foreground">{display}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-elevated accent-primary"
      />
    </label>
  );
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}
