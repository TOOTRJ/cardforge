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
import { createSetAction, updateSetAction } from "@/lib/sets/actions";
import { slugify } from "@/lib/validation/card";
import { uploadSetCover } from "@/lib/sets/upload-cover";
import { SetSymbol } from "@/components/cards/set-symbol";
import { cn } from "@/lib/utils";
import type { CardSet } from "@/lib/sets/queries";
import type { Visibility } from "@/types/card";

type FormValues = {
  title: string;
  slug: string;
  description: string;
  cover_url: string;
  /** Set symbol: an uploaded image (icon_url) OR a preset Keyrune code
   *  (icon_code). Mutually exclusive — setting one clears the other. */
  icon_url: string;
  icon_code: string;
  visibility: Visibility;
};

type SetCreatorFormProps = {
  mode: "create" | "edit";
  userId: string | null;
  set?: CardSet | null;
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
    description: "Only you can see this set.",
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
    description: "Listed publicly in the future sets index.",
    icon: Globe2,
  },
];

function defaultValuesFor(set: CardSet | null | undefined): FormValues {
  if (!set) {
    return {
      title: "",
      slug: "",
      description: "",
      cover_url: "",
      icon_url: "",
      icon_code: "",
      visibility: "private",
    };
  }
  return {
    title: set.title,
    slug: set.slug,
    description: set.description ?? "",
    cover_url: set.cover_url ?? "",
    icon_url: set.icon_url ?? "",
    icon_code: set.icon_code ?? "",
    visibility: set.visibility,
  };
}

export function SetCreatorForm({ mode, userId, set }: SetCreatorFormProps) {
  const router = useRouter();
  const [isSubmitting, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);

  const defaults = useMemo(() => defaultValuesFor(set), [set]);

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
      icon_url: values.icon_url.trim() || undefined,
      icon_code: values.icon_code.trim() || undefined,
      visibility: values.visibility,
    };

    startTransition(async () => {
      if (mode === "create") {
        const result = await createSetAction(payload);
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
        router.replace(`/set/${result.slug}/edit`);
        router.refresh();
        return;
      }

      if (!set?.id) {
        setServerError("Cannot find this set to update.");
        return;
      }
      const result = await updateSetAction(set.id, payload);
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
      if (result.slug !== set.slug) {
        router.replace(`/set/${result.slug}/edit`);
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
          helper="The set's name."
          error={errors.title?.message}
        >
          <input
            {...register("title")}
            placeholder="Frostbound Prologue"
            className={inputClass(Boolean(errors.title))}
            autoComplete="off"
          />
        </FieldGroup>

        <FieldGroup
          label="Set URL"
          helper="Generated automatically from the title — not editable."
        >
          <p className="break-all rounded-md border border-border bg-background/60 px-3 py-2 text-sm text-muted">
            /set/{watched.slug || slugify(watched.title || "untitled-set")}
          </p>
        </FieldGroup>

        <FieldGroup
          label="Description"
          helper="Up to 1000 characters. Markdown not rendered (yet)."
          error={errors.description?.message}
        >
          <textarea
            {...register("description")}
            rows={3}
            placeholder="A short intro to the set — themes, mechanics, vibe."
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

        <IconField
          userId={userId}
          iconUrl={watched.icon_url}
          iconCode={watched.icon_code}
          onChange={(next) => {
            setValue("icon_url", next.iconUrl, { shouldDirty: true });
            setValue("icon_code", next.iconCode, { shouldDirty: true });
          }}
        />

        <FieldGroup label="Visibility">
          <Controller
            control={control}
            name="visibility"
            render={({ field }) => (
              <VisibilityPicker
                value={field.value}
                onChange={field.onChange}
              />
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
              <Link href={mode === "edit" && set ? `/set/${set.slug}` : "/dashboard/sets"}>
                <ArrowLeft className="h-4 w-4" aria-hidden />
                {mode === "edit" ? "View set" : "Back to sets"}
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
                  : "Create set"}
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

// A curated set of recognizable Keyrune set-symbol codes for the "pick a glyph"
// option. The full Keyrune library has hundreds; these cover popular sets.
const PRESET_SET_CODES = [
  "dom",
  "war",
  "eld",
  "thb",
  "iko",
  "znr",
  "khm",
  "stx",
  "afr",
  "mid",
  "neo",
  "dmu",
];

function IconField({
  userId,
  iconUrl,
  iconCode,
  onChange,
}: {
  userId: string | null;
  iconUrl: string;
  iconCode: string;
  onChange: (next: { iconUrl: string; iconCode: string }) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);

  const handleFile = async (file: File) => {
    if (!userId) {
      toast.error("You need to be signed in to upload an icon.");
      return;
    }
    setUploading(true);
    try {
      const result = await uploadSetCover(userId, file);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      onChange({ iconUrl: result.publicUrl, iconCode: "" });
      toast.success("Icon uploaded.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <span className="text-xs font-semibold uppercase tracking-wider text-subtle">
          Set icon
        </span>
        <span className="text-[11px] text-muted">
          The set symbol shown on every card in this set. Upload an image or pick
          a preset — leave empty to use the default PipGlyph mark.
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md border border-border bg-elevated/50">
          <SetSymbol
            rarity="rare"
            iconUrl={iconUrl || null}
            setCode={iconCode || null}
            size={30}
          />
        </span>
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
          className="sr-only"
          aria-label="Upload set icon"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) handleFile(file);
          }}
        />
        <Button
          type="button"
          variant="outline"
          disabled={!userId || uploading}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? "Uploading…" : "Upload image"}
        </Button>
        {iconUrl || iconCode ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() => onChange({ iconUrl: "", iconCode: "" })}
          >
            Use default
          </Button>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] uppercase tracking-wider text-subtle">
          Or pick a preset symbol
        </span>
        <div className="flex flex-wrap gap-2">
          {PRESET_SET_CODES.map((code) => {
            const active = !iconUrl && iconCode === code;
            return (
              <button
                key={code}
                type="button"
                aria-pressed={active}
                onClick={() => onChange({ iconUrl: "", iconCode: code })}
                title={code.toUpperCase()}
                className={cn(
                  "flex h-9 w-9 items-center justify-center rounded-md border text-lg transition-colors",
                  active
                    ? "border-primary bg-primary/15 text-primary-bright"
                    : "border-border bg-elevated/50 text-muted hover:border-border-strong hover:text-foreground",
                )}
              >
                <i className={cn("ss", `ss-${code}`, "ss-grad")} aria-hidden />
              </button>
            );
          })}
        </div>
      </div>
    </div>
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
        aria-label="Upload set cover"
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
              alt="Set cover preview"
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
