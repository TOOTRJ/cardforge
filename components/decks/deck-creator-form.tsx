"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Controller, useForm, useWatch, type SubmitHandler } from "react-hook-form";
import {
  ArrowLeft,
  Globe2,
  ImagePlus,
  Link2,
  Loader2,
  Lock,
  Save,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SurfaceCard } from "@/components/ui/surface-card";
import { createDeckAction, updateDeckAction } from "@/lib/decks/actions";
import { slugify } from "@/lib/validation/card";
import { uploadSetCover } from "@/lib/sets/upload-cover";
import { cn } from "@/lib/utils";
import {
  DECK_FORMAT_LABELS,
  DECK_FORMAT_VALUES,
  coverObjectPosition,
  type Deck,
  type DeckCoverPosition,
  type DeckFormat,
} from "@/types/deck";
import type { Visibility } from "@/types/card";

type FormValues = {
  title: string;
  slug: string;
  description: string;
  cover_url: string;
  /** Cover focal point ({focalX, focalY} in 0..1); null = centered. */
  cover_position: DeckCoverPosition | null;
  format: DeckFormat;
  visibility: Visibility;
};

type DeckCreatorFormProps = {
  mode: "create" | "edit";
  userId: string | null;
  deck?: Deck | null;
};

const VISIBILITY_OPTIONS: Array<{
  value: Visibility;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
}> = [
  {
    value: "private",
    label: "Private",
    description: "Only you can see this deck.",
    icon: Lock,
  },
  {
    value: "unlisted",
    label: "Unlisted",
    description: "Anyone with the link can view. Not in listings.",
    icon: Link2,
  },
  {
    value: "public",
    label: "Public",
    description: "Listed publicly in the community decks index.",
    icon: Globe2,
  },
];

// Short blurbs shown under the format picker so newcomers know what each
// format expects. Deck-size rules are enforced as soft warnings later, never
// as save blockers.
const FORMAT_HINTS: Partial<Record<DeckFormat, string>> = {
  commander: "100 cards including your commander, singleton.",
  standard: "60+ cards, up to 4 copies each, recent sets.",
  pioneer: "60+ cards, up to 4 copies each, Return to Ravnica forward.",
  modern: "60+ cards, up to 4 copies each, 8th Edition forward.",
  legacy: "60+ cards, up to 4 copies each, full card pool.",
  vintage: "60+ cards, restricted list applies.",
  pauper: "60+ cards, commons only.",
  brawl: "100 cards including your commander, Arena card pool.",
  standard_brawl: "60 cards including your commander, Standard pool.",
  oathbreaker: "60 cards: planeswalker + signature spell + 58.",
  limited: "40+ cards, no copy limit.",
  casual: "Kitchen table rules — anything goes.",
};

function defaultValuesFor(deck: Deck | null | undefined): FormValues {
  if (!deck) {
    return {
      title: "",
      slug: "",
      description: "",
      cover_url: "",
      cover_position: null,
      format: "commander",
      visibility: "public",
    };
  }
  return {
    title: deck.title,
    slug: deck.slug,
    description: deck.description ?? "",
    cover_url: deck.cover_url ?? "",
    cover_position: (deck.cover_position as DeckCoverPosition | null) ?? null,
    format: deck.format,
    visibility: deck.visibility,
  };
}

export function DeckCreatorForm({ mode, userId, deck }: DeckCreatorFormProps) {
  const router = useRouter();
  const [isSubmitting, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);

  const defaults = useMemo(() => defaultValuesFor(deck), [deck]);

  const {
    register,
    handleSubmit,
    setValue,
    setError,
    control,
    reset,
    formState: { errors, isDirty },
  } = useForm<FormValues>({
    defaultValues: defaults,
    mode: "onSubmit",
  });

  useEffect(() => {
    reset(defaults);
  }, [defaults, reset]);

  const coverPosition = useWatch({ control, name: "cover_position" }) ?? null;

  const onSubmit: SubmitHandler<FormValues> = (values) => {
    setServerError(null);
    const payload = {
      title: values.title.trim(),
      slug: values.slug.trim() ? slugify(values.slug.trim()) : undefined,
      description: values.description.trim() || undefined,
      cover_url: values.cover_url.trim() || undefined,
      // null clears back to centered; only meaningful with a cover set.
      cover_position: values.cover_url.trim() ? values.cover_position : null,
      format: values.format,
      visibility: values.visibility,
    };

    startTransition(async () => {
      if (mode === "create") {
        const result = await createDeckAction(payload);
        if (!result.ok) {
          if (result.fieldErrors) {
            for (const [name, message] of Object.entries(result.fieldErrors)) {
              if (!message) continue;
              setError(name as keyof FormValues, { message });
            }
          }
          if (result.formError) {
            setServerError(result.formError);
            toast.error(result.formError);
          }
          return;
        }
        toast.success(`Created “${payload.title}”`);
        router.replace(`/deck/${result.slug}/edit`);
        router.refresh();
        return;
      }

      if (!deck?.id) {
        setServerError("Cannot find this deck to update.");
        return;
      }
      const result = await updateDeckAction(deck.id, payload);
      if (!result.ok) {
        if (result.fieldErrors) {
          for (const [name, message] of Object.entries(result.fieldErrors)) {
            if (!message) continue;
            setError(name as keyof FormValues, { message });
          }
        }
        if (result.formError) {
          setServerError(result.formError);
          toast.error(result.formError);
        }
        return;
      }
      toast.success("Changes saved.");
      // Editing is done — land on the deck itself.
      router.replace(`/deck/${result.slug}`);
      router.refresh();
    });
  };

  return (
    <SurfaceCard className="flex flex-col gap-6 p-6">
      <form
        noValidate
        onSubmit={handleSubmit(onSubmit)}
        className="flex flex-col gap-6"
      >
        {serverError ? (
          <div
            role="alert"
            className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-foreground"
          >
            {serverError}
          </div>
        ) : null}

        <FieldGroup
          label="Title"
          helper="The deck's name."
          error={errors.title?.message}
        >
          <input
            {...register("title")}
            placeholder="Atraxa Superfriends"
            className={inputClass(Boolean(errors.title))}
            autoComplete="off"
          />
        </FieldGroup>

        <FieldGroup label="Format" error={errors.format?.message}>
          <Controller
            control={control}
            name="format"
            render={({ field }) => (
              <div className="flex flex-col gap-1.5">
                <select
                  value={field.value}
                  onChange={(event) =>
                    field.onChange(event.target.value as DeckFormat)
                  }
                  className={cn(
                    inputClass(Boolean(errors.format)),
                    "appearance-none",
                  )}
                  aria-label="Deck format"
                >
                  {DECK_FORMAT_VALUES.map((format) => (
                    <option key={format} value={format}>
                      {DECK_FORMAT_LABELS[format]}
                    </option>
                  ))}
                </select>
                {FORMAT_HINTS[field.value] ? (
                  <span className="text-xs text-muted">
                    {FORMAT_HINTS[field.value]}
                  </span>
                ) : null}
              </div>
            )}
          />
        </FieldGroup>

        <FieldGroup
          label="Description"
          helper="Up to 2000 characters — strategy notes, the deck's story, upgrade ideas."
          error={errors.description?.message}
        >
          <textarea
            {...register("description")}
            rows={3}
            placeholder="What does this deck want to do?"
            className={textareaClass(Boolean(errors.description))}
          />
        </FieldGroup>

        <Controller
          control={control}
          name="cover_url"
          render={({ field }) => (
            <CoverField
              userId={userId}
              value={field.value}
              onChange={(next) => {
                field.onChange(next);
                setValue("cover_url", next, { shouldDirty: true });
                // A new (or removed) image starts centered.
                setValue("cover_position", null, { shouldDirty: true });
              }}
              position={coverPosition}
              onPositionChange={(next) =>
                setValue("cover_position", next, { shouldDirty: true })
              }
              error={errors.cover_url?.message}
            />
          )}
        />

        <FieldGroup label="Visibility">
          <Controller
            control={control}
            name="visibility"
            render={({ field }) => (
              <VisibilityPicker value={field.value} onChange={field.onChange} />
            )}
          />
        </FieldGroup>

        <div className="sticky bottom-0 -mx-6 -mb-6 flex flex-wrap items-center justify-between gap-3 border-t border-border/50 bg-surface/95 px-6 py-4 backdrop-blur-sm">
          <div className="flex items-center gap-2 text-xs text-muted">
            {isDirty ? (
              <Badge variant="accent" className="gap-1.5">
                <Sparkles className="h-3 w-3" aria-hidden /> Unsaved changes
              </Badge>
            ) : (
              <Badge>Up to date</Badge>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="ghost">
              <Link href="/dashboard/decks">
                <ArrowLeft className="h-4 w-4" aria-hidden />
                {mode === "edit" ? "All decks" : "Back to decks"}
              </Link>
            </Button>
            <Button type="submit" disabled={isSubmitting} size="lg">
              {isSubmitting ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Save className="h-4 w-4" aria-hidden />
              )}
              {isSubmitting
                ? "Saving…"
                : mode === "edit"
                  ? "Save changes"
                  : "Create deck"}
            </Button>
          </div>
        </div>
      </form>
    </SurfaceCard>
  );
}

function FieldGroup({
  label,
  helper,
  error,
  children,
}: {
  label: string;
  helper?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold uppercase tracking-wider text-subtle">
        {label}
      </span>
      {children}
      {error ? (
        <span className="text-xs text-danger">{error}</span>
      ) : helper ? (
        <span className="text-xs text-muted">{helper}</span>
      ) : null}
    </label>
  );
}

function inputClass(hasError: boolean): string {
  return cn(
    "h-10 w-full rounded-md border bg-background/60 px-3 text-sm text-foreground placeholder:text-subtle",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    hasError ? "border-danger/60" : "border-border",
  );
}

function textareaClass(hasError: boolean): string {
  return cn(
    "w-full rounded-md border bg-background/60 px-3 py-2 text-sm text-foreground placeholder:text-subtle",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    hasError ? "border-danger/60" : "border-border",
  );
}

function CoverField({
  userId,
  value,
  onChange,
  position,
  onPositionChange,
  error,
}: {
  userId: string | null;
  value: string;
  onChange: (next: string) => void;
  position: DeckCoverPosition | null;
  onPositionChange: (next: DeckCoverPosition) => void;
  error?: string;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const draggingRef = useRef(false);

  const handleFile = async (file: File) => {
    if (!userId) {
      toast.error("You need to be signed in to upload a cover.");
      return;
    }
    if (!file.type.startsWith("image/")) {
      toast.error("Drop an image file (PNG, JPEG, WebP, or GIF).");
      return;
    }
    setUploading(true);
    try {
      const result = await uploadSetCover(userId, file);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      onChange(result.publicUrl);
      toast.success("Cover uploaded — drag the image to reposition it.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  // Drag the image inside the preview to pick the focal point — the point
  // under the pointer becomes the CSS object-position, same mental model as
  // the card art positioner.
  const updateFocal = (event: React.PointerEvent) => {
    const rect = previewRef.current?.getBoundingClientRect();
    if (!rect) return;
    const clamp = (v: number) => Math.min(1, Math.max(0, v));
    onPositionChange({
      focalX: clamp((event.clientX - rect.left) / rect.width),
      focalY: clamp((event.clientY - rect.top) / rect.height),
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-subtle">
          Cover image
        </span>
        <span className="text-[11px] text-subtle">
          PNG · JPEG · WebP · GIF · up to 5 MB
        </span>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="sr-only"
        aria-label="Upload deck cover"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) handleFile(file);
        }}
      />

      {value ? (
        <>
          <div
            ref={previewRef}
            role="application"
            aria-label="Cover preview — drag to reposition"
            className="relative aspect-[5/2] w-full cursor-grab touch-none overflow-hidden rounded-lg border border-border/60 bg-elevated active:cursor-grabbing"
            onPointerDown={(event) => {
              draggingRef.current = true;
              event.currentTarget.setPointerCapture(event.pointerId);
              updateFocal(event);
            }}
            onPointerMove={(event) => {
              if (draggingRef.current) updateFocal(event);
            }}
            onPointerUp={() => {
              draggingRef.current = false;
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={value}
              alt="Deck cover preview"
              draggable={false}
              className="pointer-events-none h-full w-full select-none object-cover"
              style={{
                objectPosition: coverObjectPosition(position) ?? "50% 50%",
              }}
            />
            <span className="pointer-events-none absolute bottom-2 right-2 rounded-full bg-background/70 px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted backdrop-blur">
              Drag to reposition
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => inputRef.current?.click()}
              disabled={uploading || !userId}
            >
              {uploading ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Upload className="h-4 w-4" aria-hidden />
              )}
              {uploading ? "Uploading…" : "Replace"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onChange("")}
              disabled={uploading}
            >
              <Trash2 className="h-4 w-4" aria-hidden /> Remove
            </Button>
          </div>
        </>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(event) => {
            event.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragOver(false);
            const file = event.dataTransfer.files?.[0];
            if (file) handleFile(file);
          }}
          disabled={uploading || !userId}
          className={cn(
            "flex aspect-[5/2] w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed text-sm transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/50",
            dragOver
              ? "border-primary bg-primary/10 text-foreground"
              : "border-border bg-background/40 text-muted hover:border-border-strong hover:text-foreground",
          )}
        >
          {uploading ? (
            <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
          ) : (
            <ImagePlus className="h-6 w-6" aria-hidden />
          )}
          <span className="font-medium">
            {uploading ? "Uploading…" : "Drag a cover here, or click to choose"}
          </span>
          <span className="text-[11px] text-subtle">
            Best results: 1600 × 640 px or larger — shown as a wide banner
          </span>
        </button>
      )}
      {error ? <span className="text-xs text-danger">{error}</span> : null}
    </div>
  );
}

function VisibilityPicker({
  value,
  onChange,
}: {
  value: Visibility;
  onChange: (next: Visibility) => void;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      {VISIBILITY_OPTIONS.map((option) => {
        const Icon = option.icon;
        const active = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={active}
            className={cn(
              "flex flex-col gap-1 rounded-lg border bg-background/40 p-3 text-left transition-colors",
              active
                ? "border-primary bg-primary/10"
                : "border-border hover:border-border-strong",
            )}
          >
            <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Icon className="h-4 w-4" aria-hidden />
              {option.label}
            </span>
            <span className="text-xs leading-5 text-muted">
              {option.description}
            </span>
          </button>
        );
      })}
    </div>
  );
}
