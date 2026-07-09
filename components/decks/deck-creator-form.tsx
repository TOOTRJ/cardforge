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
  type Deck,
  type DeckFormat,
} from "@/types/deck";
import type { Visibility } from "@/types/card";

type FormValues = {
  title: string;
  slug: string;
  description: string;
  cover_url: string;
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
      format: "commander",
      visibility: "private",
    };
  }
  return {
    title: deck.title,
    slug: deck.slug,
    description: deck.description ?? "",
    cover_url: deck.cover_url ?? "",
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

  const watched = useWatch({ control, defaultValue: defaults }) as FormValues;

  const onSubmit: SubmitHandler<FormValues> = (values) => {
    setServerError(null);
    const payload = {
      title: values.title.trim(),
      slug: values.slug.trim() ? slugify(values.slug.trim()) : undefined,
      description: values.description.trim() || undefined,
      cover_url: values.cover_url.trim() || undefined,
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
      if (result.slug !== deck.slug) {
        router.replace(`/deck/${result.slug}/edit`);
      }
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
          label="Deck URL"
          helper="Generated automatically from the title — not editable."
        >
          <p className="break-all rounded-md border border-border bg-background/60 px-3 py-2 text-sm text-muted">
            /deck/{watched.slug || slugify(watched.title || "untitled-deck")}
          </p>
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
              }}
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
  error,
}: {
  userId: string | null;
  value: string;
  onChange: (next: string) => void;
  error?: string;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);

  const handleFile = async (file: File) => {
    if (!userId) {
      toast.error("You need to be signed in to upload a cover.");
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
      toast.success("Cover uploaded.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
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

      <div className="grid gap-3 sm:grid-cols-[1fr_240px]">
        <div className="flex flex-col gap-2">
          <input
            type="url"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder="https://example.com/cover.jpg (or upload below)"
            className={inputClass(Boolean(error))}
          />
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
              ) : value ? (
                <Upload className="h-4 w-4" aria-hidden />
              ) : (
                <ImagePlus className="h-4 w-4" aria-hidden />
              )}
              {uploading ? "Uploading…" : value ? "Replace" : "Upload"}
            </Button>
            {value ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onChange("")}
                disabled={uploading}
              >
                <Trash2 className="h-4 w-4" aria-hidden /> Remove
              </Button>
            ) : null}
          </div>
          {error ? <span className="text-xs text-danger">{error}</span> : null}
        </div>

        <div className="relative aspect-video w-full overflow-hidden rounded-lg border border-border/60 bg-elevated">
          {value ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={value}
              alt="Deck cover preview"
              className="h-full w-full object-cover"
            />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-[10px] uppercase tracking-[0.2em] text-subtle">
              No cover yet
            </span>
          )}
        </div>
      </div>
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
