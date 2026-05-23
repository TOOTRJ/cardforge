"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { Camera, ImagePlus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  clearProfileMediaServerAction,
  uploadProfileMediaServerAction,
  type ProfileMediaKind,
} from "@/lib/profile/upload-server";

// ---------------------------------------------------------------------------
// ProfileMediaUploader — shared component for both avatar and banner.
// Renders a current-image preview (or a fallback), a "Choose image" file
// input, and a "Remove" button when an image is set. Uploads happen on
// file selection (no submit needed) so the UX feels instant.
// ---------------------------------------------------------------------------

type ProfileMediaUploaderProps = {
  kind: ProfileMediaKind;
  currentUrl: string | null;
  /** Display label used in aria text + button copy. */
  label: string;
  /** Helper copy beneath the preview. */
  hint?: string;
  /** Aspect ratio class for the preview (e.g. "aspect-square", "aspect-[4/1]"). */
  previewClassName?: string;
};

export function ProfileMediaUploader({
  kind,
  currentUrl,
  label,
  hint,
  previewClassName,
}: ProfileMediaUploaderProps) {
  const [url, setUrl] = useState<string | null>(currentUrl);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    setError(null);
    setPending(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const result = await uploadProfileMediaServerAction(kind, formData);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setUrl(result.publicUrl);
    } finally {
      setPending(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleClear = async () => {
    setError(null);
    setPending(true);
    try {
      const result = await clearProfileMediaServerAction(kind);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setUrl(null);
    } finally {
      setPending(false);
    }
  };

  const PlaceholderIcon = kind === "avatar" ? Camera : ImagePlus;

  return (
    <div className="flex flex-col gap-3">
      <div
        className={cn(
          "relative overflow-hidden rounded-md border border-border/60 bg-background/40",
          previewClassName ?? "aspect-square w-32",
        )}
      >
        {url ? (
          <Image
            src={url}
            alt={`${label} preview`}
            fill
            sizes={kind === "banner" ? "100vw" : "256px"}
            className="object-cover"
            unoptimized
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-subtle">
            <PlaceholderIcon
              className={kind === "avatar" ? "h-8 w-8" : "h-10 w-10"}
              aria-hidden
            />
          </div>
        )}
        {pending ? (
          <div className="absolute inset-0 flex items-center justify-center bg-background/70 text-xs uppercase tracking-wider text-muted">
            Uploading…
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => fileInputRef.current?.click()}
        >
          {url ? "Replace image" : `Choose ${label.toLowerCase()}`}
        </Button>
        {url ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={handleClear}
            aria-label={`Remove ${label.toLowerCase()}`}
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden /> Remove
          </Button>
        ) : null}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />

      {error ? (
        <p className="text-xs text-danger" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted">{hint}</p>
      ) : null}
    </div>
  );
}
