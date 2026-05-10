"use client";

import { useRef, useState } from "react";
import { ImagePlus, Loader2, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { uploadCardArt } from "@/lib/cards/upload-art";
import { cn } from "@/lib/utils";
import type { ArtPosition } from "@/types/card";

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
  const [uploading, setUploading] = useState(false);

  const focalX = artPosition.focalX ?? 0.5;
  const focalY = artPosition.focalY ?? 0.5;
  const scale = artPosition.scale ?? 1;

  const handleFile = async (file: File) => {
    if (!userId) {
      toast.error("You need to be signed in to upload artwork.");
      return;
    }
    setUploading(true);
    try {
      const result = await uploadCardArt(userId, file);
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
  };

  const handleRemove = () => {
    onArtChange({
      artUrl: null,
      artPosition: { focalX: 0.5, focalY: 0.5, scale: 1 },
    });
  };

  const updatePosition = (patch: Partial<ArtPosition>) => {
    onArtChange({
      artUrl: artUrl ?? null,
      artPosition: { ...artPosition, ...patch },
    });
  };

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <div className="flex flex-col gap-2">
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
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="sr-only"
          aria-label="Upload card art"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) handleFile(file);
          }}
        />

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => inputRef.current?.click()}
            disabled={uploading || !userId}
          >
            {uploading ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : artUrl ? (
              <Upload className="h-4 w-4" aria-hidden />
            ) : (
              <ImagePlus className="h-4 w-4" aria-hidden />
            )}
            {uploading ? "Uploading…" : artUrl ? "Replace artwork" : "Upload artwork"}
          </Button>
          {artUrl ? (
            <Button
              type="button"
              variant="ghost"
              onClick={handleRemove}
              disabled={uploading}
            >
              <Trash2 className="h-4 w-4" aria-hidden />
              Remove
            </Button>
          ) : null}
        </div>
        {!userId ? (
          <p className="text-xs text-subtle">
            Sign in first to upload artwork. Until then the form still saves text.
          </p>
        ) : null}
      </div>

      {artUrl ? (
        <div className="flex flex-col gap-3 rounded-lg border border-border/60 bg-surface/60 p-4">
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
            min={0.5}
            max={3}
            step={0.05}
            display={`${scale.toFixed(2)}×`}
            onChange={(value) => updatePosition({ scale: value })}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="self-start"
            onClick={() =>
              onArtChange({
                artUrl,
                artPosition: { focalX: 0.5, focalY: 0.5, scale: 1 },
              })
            }
          >
            Reset position
          </Button>
        </div>
      ) : null}
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
