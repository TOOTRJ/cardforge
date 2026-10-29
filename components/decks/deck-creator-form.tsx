"use client";

import { useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { Controller, useForm, useWatch, type SubmitHandler } from "react-hook-form";
import {
  ArrowLeft,
  ImagePlus,
  Loader2,
  Save,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SurfaceCard } from "@/components/ui/surface-card";
import { updateDeckAction } from "@/lib/decks/actions";
import { slugify } from "@/lib/validation/card";
import { uploadCoverImage } from "@/lib/media/upload-cover";
import { DECK_COVER_HEIGHT, DECK_COVER_WIDTH, HERO_CROP_ASPECTS, heroCropWindow } from "@/lib/decks/cover";
import { isAllowedMediaUrl } from "@/lib/media/media-urls";

/** The deck hero's two crops the cover preview frames (lib/decks/cover.ts). */
const HERO_CROPS = [
  { key: "wide", label: "Wide screen" },
  { key: "phone", label: "Phone" },
] as const;
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
import { VisibilityPicker } from "@/components/ui/visibility-picker";
import { inputClass, textareaClass } from "@/components/ui/field-classes";
import { FieldGroup, joinIds } from "@/components/creator/field-group";
import { DeckCapacityNotice } from "@/components/decks/deck-capacity";
import { useUpgradeModal } from "@/components/billing/upgrade-modal-provider";
import { deckCountsTowardCap, type DeckCapacity } from "@/lib/billing/deck-capacity-copy";

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

/** The fields a refused save can focus, in page order (the others have no
 *  control of their own to focus). */
const FOCUSABLE_FIELDS = ["title", "format", "description"] as const;

type DeckCreatorFormProps = {
  /** Only "edit" exists: creation goes through the wizard (DeckWizard). */
  mode: "edit";
  userId: string | null;
  deck?: Deck | null;
  /** The default background the deck shows without an upload
   *  (lib/decks/cover.ts deckCoverOf), previewed in the cover field. */
  defaultCoverSrc?: string | null;
  /** Inside a dialog on the deck page: no card chrome, no "All decks" link,
   *  and a successful save calls `onSaved` instead of navigating. */
  embedded?: boolean;
  onSaved?: (slug: string) => void;
  /** The owner's private-deck cap (TODO DK3.2): turning a PUBLIC deck
   *  private or unlisted past it is warned about here and refused by the
   *  server. A deck that is private or unlisted already holds its slot. */
  deckCapacity?: DeckCapacity | null;
};


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

export function DeckCreatorForm({ mode, userId, deck,
  defaultCoverSrc = null,
  embedded = false,
  onSaved,
  deckCapacity = null }: DeckCreatorFormProps) {
  const router = useRouter();
  const upgrade = useUpgradeModal();
  const [isSubmitting, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);

  const defaults = useMemo(() => defaultValuesFor(deck), [deck]);
  const formatHintId = `${useId()}-format-hint`;

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

  // Re-sync from the server row when it changes (another panel saved a cover,
  // a router.refresh() landed) — but NEVER over the user's unsaved edits.
  // `defaults` is a fresh object on every refresh, so without the isDirty
  // guard every refresh silently wiped whatever was being typed.
  useEffect(() => {
    if (!isDirty) reset(defaults);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- isDirty is read, not a trigger
  }, [defaults, reset]);

  const coverPosition = useWatch({ control, name: "cover_position" }) ?? null;
  const pickedVisibility = useWatch({ control, name: "visibility" });

  const onSubmit: SubmitHandler<FormValues> = (values) => {
    setServerError(null);
    const payload = {
      title: values.title.trim(),
      slug: values.slug.trim() ? slugify(values.slug.trim()) : undefined,
      // Edit mode sends an explicit null for an emptied field so the server
      // CLEARS it; `undefined` means "leave as is" and used to make "Remove
      // cover" / clearing the description a silent no-op.
      description: values.description.trim() || (mode === "edit" ? null : undefined),
      cover_url: values.cover_url.trim() || (mode === "edit" ? null : undefined),
      // null clears back to centered; only meaningful with a cover set.
      cover_position: values.cover_url.trim() ? values.cover_position : null,
      format: values.format,
      visibility: values.visibility,
    };

    startTransition(async () => {
      if (!deck?.id) {
        setServerError("Cannot find this deck to update.");
        return;
      }
      const result = await updateDeckAction(deck.id, payload);
      if (!result.ok) {
        if (result.fieldErrors) {
          // A refused save moves the focus to the FIRST refused field, which
          // then reads its error as its description (FieldGroup's rule) — no
          // alert per field; a form-level refusal is the form's one alert.
          const refused = Object.entries(result.fieldErrors).filter(([, message]) => Boolean(message));
          const first = FOCUSABLE_FIELDS.find((name) => refused.some(([key]) => key === name));
          for (const [name, message] of refused) {
            setError(name as keyof FormValues, { message: message as string }, { shouldFocus: name === first });
          }
        }
        if (result.formError) {
          setServerError(result.formError);
          toast.error(result.formError);
        }
        if (result.reason === "deck_capacity") upgrade.open("deck_capacity");
        return;
      }
      toast.success("Changes saved.");
      if (onSaved) {
        onSaved(result.slug);
        router.refresh();
        return;
      }
      // Editing is done — land on the deck itself.
      router.replace(`/deck/${result.slug}`);
      router.refresh();
    });
  };

  const Wrapper = embedded ? "div" : SurfaceCard;
  return (
    <Wrapper className="flex flex-col gap-6 p-6">
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

        {/* The select is the field's ONE control, inside a Controller: it
            takes its name ("Format", the caption) and its description (the
            error, then the format's hint) from the function child — a plain
            child there got neither, and an aria-label of other words named
            it (TODO 3b.36). */}
        <FieldGroup label="Format" error={errors.format?.message}>
          {(aria) => (
            <Controller
              control={control}
              name="format"
              render={({ field }) => (
                <div className="flex flex-col gap-1.5">
                  <select
                    {...aria}
                    aria-describedby={joinIds(
                      aria["aria-describedby"],
                      FORMAT_HINTS[field.value] ? formatHintId : null,
                    )}
                    ref={field.ref}
                    name={field.name}
                    value={field.value}
                    onBlur={field.onBlur}
                    onChange={(event) =>
                      field.onChange(event.target.value as DeckFormat)
                    }
                    className={cn(
                      inputClass(Boolean(errors.format)),
                      "appearance-none",
                    )}
                  >
                    {DECK_FORMAT_VALUES.map((format) => (
                      <option key={format} value={format}>
                        {DECK_FORMAT_LABELS[format]}
                      </option>
                    ))}
                  </select>
                  {FORMAT_HINTS[field.value] ? (
                    <span id={formatHintId} className="text-xs text-muted">
                      {FORMAT_HINTS[field.value]}
                    </span>
                  ) : null}
                </div>
              )}
            />
          )}
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
              defaultCoverSrc={defaultCoverSrc}
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

        <FieldGroup kind="group" label="Visibility">
          <Controller
            control={control}
            name="visibility"
            render={({ field }) => (
              <VisibilityPicker subject="deck" value={field.value} onChange={field.onChange} />
            )}
          />
        </FieldGroup>
        <DeckCapacityNotice
          capacity={deckCapacity}
          visibility={pickedVisibility}
          alreadyCounted={deckCountsTowardCap(deck?.visibility ?? "public")}
          onMakePublic={() => setValue("visibility", "public", { shouldDirty: true })}
        />

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
            {embedded ? null : (
              <Button asChild variant="ghost">
                <Link href="/dashboard/decks">
                  <ArrowLeft className="h-4 w-4" aria-hidden />
                  {mode === "edit" ? "All decks" : "Back to decks"}
                </Link>
              </Button>
            )}
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
    </Wrapper>
  );
}

export function CoverField({
  userId,
  value,
  defaultCoverSrc = null,
  onChange,
  position,
  onPositionChange,
  error,
}: {
  userId: string | null;
  value: string;
  /** Shown (never stored) while there is no upload: the default background
   *  the deck's colours pick (lib/decks/cover.ts). */
  defaultCoverSrc?: string | null;
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
      const result = await uploadCoverImage(userId, file, { purpose: "deck-cover" });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      onChange(result.publicUrl);
      toast.success("Cover uploaded — drag it to choose what the deck page shows.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  // Only a cover a surface may draw (migration 0127): an older cover on
  // another host is not drawn anywhere — the deck shows its default — so the
  // field says so instead of drawing it here.
  const drawable = Boolean(value) && isAllowedMediaUrl("deck-cover", value, userId);

  // Drag the image inside the preview to pick the focal point — the point
  // under the pointer becomes the CSS object-position, same mental model as
  // the card art positioner. The picture is 16:9 like the box, so the image
  // itself never moves: the two frames do — what the deck page's hero shows
  // of it on a wide screen and on a phone (HERO_CROP_ASPECTS).
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

      {value && !drawable ? (
        <div className="flex flex-col gap-2">
          {defaultCoverSrc ? (
            <div className="relative aspect-video w-full overflow-hidden rounded-lg border border-border/60 bg-elevated">
              <Image src={defaultCoverSrc} alt="The deck's default background" fill sizes="(min-width: 768px) 640px, 100vw" className="object-cover" />
            </div>
          ) : null}
          <p role="status" className="rounded-md border border-gold/40 bg-gold/5 px-3 py-2 text-xs leading-5 text-muted">
            This deck&apos;s cover was added before covers had to be stored on PipGlyph, so it isn&apos;t shown
            anywhere — the deck shows {defaultCoverSrc ? "the default background above" : "its default background"}.
            Upload a new cover, or remove the old one.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()} disabled={uploading || !userId}>
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Upload className="h-4 w-4" aria-hidden />}
              {uploading ? "Uploading…" : "Upload a new cover"}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => onChange("")} disabled={uploading}>
              <Trash2 className="h-4 w-4" aria-hidden /> Remove the old cover
            </Button>
          </div>
        </div>
      ) : value ? (
        <>
          <div
            ref={previewRef}
            role="application"
            aria-label="Cover preview — drag to choose what the deck page shows"
            className="relative aspect-video w-full cursor-grab touch-none overflow-hidden rounded-lg border border-border/60 bg-elevated active:cursor-grabbing"
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
            {/* The real 16:9 box every deck surface draws (lib/decks/cover.ts). */}
            <Image
              src={value}
              alt="Deck cover preview"
              fill
              sizes="(min-width: 768px) 640px, 100vw"
              draggable={false}
              className="pointer-events-none select-none object-cover"
              style={{
                objectPosition: coverObjectPosition(position) ?? "50% 50%",
              }}
            />
            {HERO_CROPS.map((crop) => {
              const frame = heroCropWindow(HERO_CROP_ASPECTS[crop.key], position);
              return (
                <div
                  key={crop.key}
                  aria-hidden
                  className={cn(
                    "pointer-events-none absolute rounded-md border-2 border-white/90 shadow-[0_0_0_1px_rgba(0,0,0,0.55)]",
                    crop.key === "phone" && "border-dashed",
                  )}
                  style={{
                    left: `${frame.left * 100}%`,
                    top: `${frame.top * 100}%`,
                    width: `${frame.width * 100}%`,
                    height: `${frame.height * 100}%`,
                  }}
                >
                  <span
                    className={cn(
                      "absolute left-1 rounded bg-black/65 px-1.5 py-0.5 text-[10px] font-medium text-white",
                      crop.key === "phone" ? "bottom-1" : "top-1",
                    )}
                  >
                    {crop.label}
                  </span>
                </div>
              );
            })}
          </div>
          <p className="text-[11px] leading-4 text-subtle">
            Drag to choose what the deck page shows: the solid frame on a wide screen, the dashed one on a phone.
            Deck tiles show the whole picture.
          </p>
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
        <div className="flex flex-col gap-2">
        {defaultCoverSrc ? (
          <div className="relative aspect-video w-full overflow-hidden rounded-lg border border-border/60 bg-elevated">
            <Image
              src={defaultCoverSrc}
              alt="The deck's default background"
              fill
              sizes="(min-width: 768px) 640px, 100vw"
              className="object-cover"
            />
            <span className="absolute bottom-2 left-2 rounded-full bg-background/75 px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted backdrop-blur">
              Default background · picked by the deck&apos;s colours
            </span>
          </div>
        ) : null}
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
            "flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed text-sm transition-colors",
            defaultCoverSrc ? "py-5" : "aspect-video",
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
            {uploading
              ? "Uploading…"
              : defaultCoverSrc
                ? "Use your own picture — drag it here, or click to choose"
                : "Drag a cover here, or click to choose"}
          </span>
          <span className="text-[11px] text-subtle">
            {`Shown at 16:9 and stored at ${DECK_COVER_WIDTH} × ${DECK_COVER_HEIGHT} px — a picture of another shape is cropped to fit`}
          </span>
        </button>
        </div>
      )}
      {error ? <span className="text-xs text-danger">{error}</span> : null}
    </div>
  );
}

