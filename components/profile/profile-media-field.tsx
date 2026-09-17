"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { Check, Shuffle, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  chooseDefaultProfileMediaAction,
  uploadProfileMediaServerAction,
} from "@/lib/profile/upload-server";
import {
  isDefaultProfileMedia,
  listDefaultMedia,
  randomDefaultMedia,
  type ProfileMediaKind,
} from "@/lib/profile/default-media";

// ---------------------------------------------------------------------------
// ProfileMediaField — avatar or banner chooser shared by onboarding and
// settings. Three ways to set it, each saved immediately:
//   * upload your own (validated + moderated in lib/profile/upload-server.ts)
//   * shuffle — another random built-in image
//   * pick from the gallery of built-in images (public/defaults)
// A profile always has an image: there is no "remove", only "use a built-in".
// ---------------------------------------------------------------------------

type ProfileMediaFieldProps = {
  kind: ProfileMediaKind;
  currentUrl: string | null;
  label: string;
  hint?: string;
  /** Start with the built-in gallery open (onboarding). */
  defaultOpen?: boolean;
};

export function ProfileMediaField({
  kind,
  currentUrl,
  label,
  hint,
  defaultOpen = false,
}: ProfileMediaFieldProps) {
  const [url, setUrl] = useState<string | null>(currentUrl);
  const [open, setOpen] = useState(defaultOpen);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isAvatar = kind === "avatar";
  const lower = label.toLowerCase();

  const run = async (
    work: () => Promise<{ ok: true; publicUrl: string } | { ok: false; error: string }>,
  ) => {
    setError(null);
    setPending(true);
    try {
      const result = await work();
      if (result.ok) setUrl(result.publicUrl);
      else setError(result.error);
    } finally {
      setPending(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const upload = (file: File) =>
    run(() => {
      const formData = new FormData();
      formData.append("file", file);
      return uploadProfileMediaServerAction(kind, formData);
    });

  const choose = (path: string) => run(() => chooseDefaultProfileMediaAction(kind, path));

  return (
    <div className="flex flex-col gap-3">
      <div className={cn("flex gap-4", isAvatar ? "items-center" : "flex-col")}>
        <div
          className={cn(
            "relative shrink-0 overflow-hidden border border-border/60 bg-background/40",
            isAvatar ? "h-24 w-24 rounded-full" : "aspect-[4/1] w-full rounded-md",
          )}
        >
          {url ? (
            <Image
              src={url}
              alt={`Your ${lower}`}
              fill
              sizes={isAvatar ? "96px" : "(min-width: 768px) 640px, 100vw"}
              className="object-cover"
              unoptimized
            />
          ) : null}
          {pending ? (
            <div className="absolute inset-0 flex items-center justify-center bg-background/70 text-[10px] font-semibold uppercase tracking-wider text-muted">
              Saving…
            </div>
          ) : null}
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-subtle">
            {label}
            {isDefaultProfileMedia(url, kind) ? (
              <span className="ml-2 font-normal normal-case tracking-normal text-muted">
                built-in
              </span>
            ) : null}
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="h-3.5 w-3.5" aria-hidden /> Upload your own
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => choose(randomDefaultMedia(kind, url))}
            >
              <Shuffle className="h-3.5 w-3.5" aria-hidden /> Shuffle
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-expanded={open}
              onClick={() => setOpen((value) => !value)}
            >
              {open ? "Hide built-in images" : "Browse built-in images"}
            </Button>
          </div>
          {error ? (
            <p className="text-xs text-danger" role="alert">
              {error}
            </p>
          ) : hint ? (
            <p className="text-xs text-muted">{hint}</p>
          ) : null}
        </div>
      </div>

      {open ? (
        <ul
          aria-label={`Built-in ${lower} images`}
          className={cn(
            "grid gap-2",
            isAvatar ? "grid-cols-5 sm:grid-cols-8" : "grid-cols-2 sm:grid-cols-3",
          )}
        >
          {listDefaultMedia(kind).map((path, index) => {
            const selected = path === url;
            return (
              <li key={path}>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => choose(path)}
                  aria-pressed={selected}
                  aria-label={`Built-in ${lower} ${index + 1}`}
                  className={cn(
                    "relative block w-full overflow-hidden border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                    isAvatar ? "aspect-square rounded-full" : "aspect-[4/1] rounded-md",
                    selected
                      ? "border-gold ring-2 ring-gold/60"
                      : "border-border/60 hover:border-primary-bright/70",
                  )}
                >
                  <Image
                    src={path}
                    alt=""
                    fill
                    sizes={isAvatar ? "80px" : "240px"}
                    className="object-cover"
                    loading="lazy"
                    unoptimized
                  />
                  {selected ? (
                    <span className="absolute inset-0 flex items-center justify-center bg-background/45">
                      <Check className="h-5 w-5 text-gold-strong" aria-hidden />
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void upload(file);
        }}
      />
    </div>
  );
}
