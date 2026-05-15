"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Controller,
  useForm,
  useWatch,
  type SubmitHandler,
} from "react-hook-form";
import {
  ArrowLeft,
  Globe2,
  Link2,
  Lock,
  LogIn,
  Save,
  Sparkles,
  Wand2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SurfaceCard } from "@/components/ui/surface-card";
import { CardPreview } from "@/components/cards/card-preview";
import { ArtUploader } from "@/components/creator/art-uploader";
import { DeleteCardDialog } from "@/components/creator/delete-card-dialog";
import { ManaCostBuilder } from "@/components/creator/mana-cost-builder";
import { FrameStylePicker } from "@/components/creator/frame-style-picker";
import {
  AIAssistantPanel,
  type CardFieldPatch,
} from "@/components/creator/ai-assistant-panel";
import type { CardContext } from "@/lib/ai/schemas";
import {
  createCardAction,
  updateCardAction,
} from "@/lib/cards/actions";
import { slugify } from "@/lib/validation/card";
import {
  CARD_TYPE_LABELS,
  CARD_TYPE_VALUES,
  COLOR_IDENTITY_VALUES,
  RARITY_VALUES,
  type ArtPosition,
  type Card,
  type CardTemplate,
  type CardType,
  type ColorIdentity,
  type FrameStyle,
  type GameSystem,
  type Rarity,
  type Visibility,
} from "@/types/card";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Form values — mirror createCardSchema but typed at the component boundary.
// We intentionally keep "string" for inputs that the form serializes from
// text fields and convert to the schema's optional/empty-as-undefined shape
// at submission time.
// ---------------------------------------------------------------------------

type FormValues = {
  title: string;
  slug: string;
  game_system_id: string;
  template_id: string;
  cost: string;
  color_identity: ColorIdentity[];
  supertype: string;
  card_type: CardType | "";
  subtypes_text: string;
  rarity: Rarity | "";
  rules_text: string;
  flavor_text: string;
  power: string;
  toughness: string;
  loyalty: string;
  defense: string;
  artist_credit: string;
  art_url: string;
  art_position: ArtPosition;
  frame_style: FrameStyle;
  visibility: Visibility;
};

type CardCreatorFormProps = {
  mode: "create" | "edit";
  userId: string | null;
  gameSystems: GameSystem[];
  templates: CardTemplate[];
  card?: Card | null;
  /** Whether ANTHROPIC_API_KEY is set on the server — gates the AI panel. */
  aiConfigured: boolean;
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
    description: "Only you can see it. Drafts default here.",
    icon: Lock,
  },
  {
    value: "unlisted",
    label: "Unlisted",
    description: "Anyone with the link can view, hidden from the gallery.",
    icon: Link2,
  },
  {
    value: "public",
    label: "Public",
    description: "Listed in the public gallery and your profile.",
    icon: Globe2,
  },
];

function defaultValuesFor(
  card: Card | null | undefined,
  gameSystems: GameSystem[],
  templates: CardTemplate[],
): FormValues {
  const fallbackGameSystem = gameSystems[0]?.id ?? "";
  const fallbackTemplate = templates[0]?.id ?? "";

  if (!card) {
    return {
      title: "",
      slug: "",
      game_system_id: fallbackGameSystem,
      template_id: fallbackTemplate,
      cost: "",
      color_identity: [],
      supertype: "",
      card_type: "creature",
      subtypes_text: "",
      rarity: "common",
      rules_text: "",
      flavor_text: "",
      power: "",
      toughness: "",
      loyalty: "",
      defense: "",
      artist_credit: "",
      art_url: "",
      art_position: { focalX: 0.5, focalY: 0.5, scale: 1 },
      frame_style: { border: "thin", accent: "neutral" },
      visibility: "private",
    };
  }

  return {
    title: card.title,
    slug: card.slug,
    game_system_id: card.game_system_id,
    template_id: card.template_id ?? fallbackTemplate,
    cost: card.cost ?? "",
    color_identity: card.color_identity,
    supertype: card.supertype ?? "",
    card_type: card.card_type ?? "",
    subtypes_text: card.subtypes.join(", "),
    rarity: card.rarity ?? "",
    rules_text: card.rules_text ?? "",
    flavor_text: card.flavor_text ?? "",
    power: card.power ?? "",
    toughness: card.toughness ?? "",
    loyalty: card.loyalty ?? "",
    defense: card.defense ?? "",
    artist_credit: card.artist_credit ?? "",
    art_url: card.art_url ?? "",
    art_position: (card.art_position as ArtPosition) ?? {
      focalX: 0.5,
      focalY: 0.5,
      scale: 1,
    },
    frame_style: (card.frame_style as FrameStyle) ?? {
      border: "thin",
      accent: "neutral",
    },
    visibility: card.visibility,
  };
}

function parseSubtypes(text: string): string[] {
  return text
    .split(/[,\n]/)
    .map((piece) => piece.trim())
    .filter((piece) => piece.length > 0)
    .slice(0, 10);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CardCreatorForm({
  mode,
  userId,
  gameSystems,
  templates,
  card,
  aiConfigured,
}: CardCreatorFormProps) {
  const router = useRouter();
  const [isSubmitting, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);

  const defaults = useMemo(
    () => defaultValuesFor(card, gameSystems, templates),
    [card, gameSystems, templates],
  );

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

  // Reset when defaults change (e.g. navigating between drafts).
  useEffect(() => {
    reset(defaults);
  }, [defaults, reset]);

  // useWatch is the React Compiler-friendly subscription variant of watch().
  // We feed it the same defaults useForm has, so RHF always populates every
  // field; the cast just lifts useWatch's DeepPartial<> back to FormValues.
  const watched = useWatch({ control, defaultValue: defaults }) as FormValues;

  // Slice of the live form state the AI panel sends as context. Stripping
  // empty strings keeps the prompt tight.
  const cardContext: CardContext = {
    title: watched.title.trim() || undefined,
    cost: watched.cost.trim() || undefined,
    card_type:
      watched.card_type && (CARD_TYPE_VALUES as readonly string[]).includes(watched.card_type)
        ? (watched.card_type as CardType)
        : undefined,
    supertype: watched.supertype.trim() || undefined,
    subtypes:
      parseSubtypes(watched.subtypes_text).length > 0
        ? parseSubtypes(watched.subtypes_text)
        : undefined,
    rarity:
      watched.rarity && (RARITY_VALUES as readonly string[]).includes(watched.rarity)
        ? (watched.rarity as Rarity)
        : undefined,
    color_identity:
      watched.color_identity.length > 0 ? watched.color_identity : undefined,
    rules_text: watched.rules_text.trim() || undefined,
    flavor_text: watched.flavor_text.trim() || undefined,
    power: watched.power.trim() || undefined,
    toughness: watched.toughness.trim() || undefined,
    loyalty: watched.loyalty.trim() || undefined,
    defense: watched.defense.trim() || undefined,
  };

  // Apply an AI patch through setValue so RHF marks every touched field
  // dirty. Strings are passed through as-is; the color_identity readonly
  // tuple from the schema is widened to a mutable array.
  const handleAIPatch = (patch: CardFieldPatch) => {
    const setIfPresent = (
      key: keyof FormValues,
      value: string | undefined,
    ) => {
      if (value === undefined) return;
      setValue(key, value as never, { shouldDirty: true });
    };

    setIfPresent("title", patch.title);
    setIfPresent("cost", patch.cost);
    setIfPresent("card_type", patch.card_type);
    setIfPresent("supertype", patch.supertype);
    setIfPresent("subtypes_text", patch.subtypes_text);
    setIfPresent("rarity", patch.rarity);
    setIfPresent("rules_text", patch.rules_text);
    setIfPresent("flavor_text", patch.flavor_text);
    setIfPresent("power", patch.power);
    setIfPresent("toughness", patch.toughness);

    if (patch.color_identity) {
      setValue(
        "color_identity",
        Array.from(patch.color_identity) as ColorIdentity[],
        { shouldDirty: true },
      );
    }
  };

  // ---- Submit ----
  const onSubmit: SubmitHandler<FormValues> = (values) => {
    setServerError(null);

    const payload = {
      title: values.title.trim(),
      slug: values.slug.trim() ? slugify(values.slug.trim()) : undefined,
      game_system_id: values.game_system_id,
      template_id: values.template_id || undefined,
      cost: values.cost.trim() || undefined,
      color_identity: values.color_identity,
      supertype: values.supertype.trim() || undefined,
      card_type: values.card_type || undefined,
      subtypes: parseSubtypes(values.subtypes_text),
      rarity: values.rarity || undefined,
      rules_text: values.rules_text.trim() || undefined,
      flavor_text: values.flavor_text.trim() || undefined,
      power: values.power.trim() || undefined,
      toughness: values.toughness.trim() || undefined,
      loyalty: values.loyalty.trim() || undefined,
      defense: values.defense.trim() || undefined,
      artist_credit: values.artist_credit.trim() || undefined,
      art_url: values.art_url.trim() || undefined,
      art_position: values.art_position,
      frame_style: values.frame_style,
      visibility: values.visibility,
    };

    startTransition(async () => {
      if (mode === "create") {
        const result = await createCardAction(payload);
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
        toast.success(`Saved “${payload.title}”`);
        router.replace(`/card/${result.slug}/edit`);
        router.refresh();
        return;
      }

      // edit
      if (!card?.id) {
        setServerError("Cannot find this card to update.");
        return;
      }
      const result = await updateCardAction(card.id, payload);
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
      // If the slug changed, follow it.
      if (result.slug !== card.slug) {
        router.replace(`/card/${result.slug}/edit`);
      }
      router.refresh();
    });
  };

  const cardTypeForPreview =
    watched.card_type === "" ? null : (watched.card_type as CardType);
  const rarityForPreview = watched.rarity === "" ? null : (watched.rarity as Rarity);

  return (
    <form
      noValidate
      onSubmit={handleSubmit(onSubmit)}
      className="grid gap-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]"
    >
      {/* ----- Left: form ----- */}
      <SurfaceCard className="flex flex-col gap-6 p-6">
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
          helper="The card's name. Defaults the slug if you leave that blank."
          error={errors.title?.message}
        >
          <input
            {...register("title")}
            placeholder="Emberbound Wyrm"
            className={inputClass(Boolean(errors.title))}
            autoComplete="off"
          />
        </FieldGroup>

        <FieldGroup
          label="Slug"
          helper={`URL: /card/${watched.slug || slugify(watched.title || "untitled-card")}`}
          error={errors.slug?.message}
        >
          <input
            {...register("slug")}
            placeholder="emberbound-wyrm"
            className={inputClass(Boolean(errors.slug))}
            autoComplete="off"
          />
        </FieldGroup>

        <FieldGroup label="Mana Cost" helper="Click pips to build the cost, or type it directly below.">
          <Controller
            control={control}
            name="cost"
            render={({ field }) => (
              <ManaCostBuilder
                value={field.value}
                onChange={field.onChange}
              />
            )}
          />
        </FieldGroup>

        <FieldGroup label="Type Line" error={errors.card_type?.message}>
          <Controller
            control={control}
            name="card_type"
            render={({ field }) => (
              <select
                value={field.value}
                onChange={(event) => field.onChange(event.target.value)}
                className={selectClass(false)}
              >
                <option value="">— pick one —</option>
                {CARD_TYPE_VALUES.map((type) => (
                  <option key={type} value={type}>
                    {CARD_TYPE_LABELS[type]}
                  </option>
                ))}
              </select>
            )}
          />
        </FieldGroup>

        <div className="grid gap-4 sm:grid-cols-2">
          <FieldGroup
            label="Supertype"
            helper="Optional — e.g. Legendary, Basic."
          >
            <input
              {...register("supertype")}
              placeholder="Legendary"
              className={inputClass(Boolean(errors.supertype))}
              autoComplete="off"
            />
          </FieldGroup>
          <FieldGroup
            label="Subtypes"
            helper="Space-separated creature types, e.g. Elf Warrior or Dragon Elder."
          >
            <input
              {...register("subtypes_text")}
              placeholder="Dragon Elder"
              className={inputClass(Boolean(errors.subtypes_text))}
              autoComplete="off"
            />
          </FieldGroup>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <FieldGroup label="Rarity">
            <Controller
              control={control}
              name="rarity"
              render={({ field }) => (
                <select
                  value={field.value}
                  onChange={(event) => field.onChange(event.target.value)}
                  className={selectClass(false)}
                >
                  <option value="">— pick one —</option>
                  {RARITY_VALUES.map((rarity) => (
                    <option key={rarity} value={rarity}>
                      {rarity[0].toUpperCase() + rarity.slice(1)}
                    </option>
                  ))}
                </select>
              )}
            />
          </FieldGroup>

          <FieldGroup
            label="Template"
            helper="Visual layout used when rendering."
          >
            <Controller
              control={control}
              name="template_id"
              render={({ field }) => (
                <select
                  value={field.value}
                  onChange={(event) => field.onChange(event.target.value)}
                  className={selectClass(false)}
                >
                  {templates.length === 0 ? (
                    <option value="">No templates available</option>
                  ) : null}
                  {templates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name}
                    </option>
                  ))}
                </select>
              )}
            />
          </FieldGroup>
        </div>

        <FieldGroup label="Color identity" helper="One or more.">
          <Controller
            control={control}
            name="color_identity"
            render={({ field }) => (
              <ColorIdentityPicker
                value={field.value}
                onChange={field.onChange}
              />
            )}
          />
        </FieldGroup>

        <FieldGroup
          label="Oracle Text"
          error={errors.rules_text?.message}
          helper="Card abilities and rules. Use (parentheses) for reminder text — it renders in italics."
        >
          <textarea
            {...register("rules_text")}
            placeholder="Flying&#10;When this creature enters, draw a card. (This ability triggers once.)"
            rows={4}
            className={textareaClass(Boolean(errors.rules_text))}
          />
        </FieldGroup>

        <FieldGroup
          label="Flavor Text"
          error={errors.flavor_text?.message}
          helper='Optional. Renders in italics at the bottom of the card. E.g. "A coil of fire, bound by oath."'
        >
          <textarea
            {...register("flavor_text")}
            placeholder="A coil of fire, bound by oath."
            rows={2}
            className={textareaClass(Boolean(errors.flavor_text))}
          />
        </FieldGroup>

        <div className="grid gap-4 sm:grid-cols-4">
          <FieldGroup label="Power">
            <input
              {...register("power")}
              placeholder="4"
              className={inputClass(Boolean(errors.power))}
              autoComplete="off"
            />
          </FieldGroup>
          <FieldGroup label="Toughness">
            <input
              {...register("toughness")}
              placeholder="4"
              className={inputClass(Boolean(errors.toughness))}
              autoComplete="off"
            />
          </FieldGroup>
          <FieldGroup label="Loyalty">
            <input
              {...register("loyalty")}
              placeholder="—"
              className={inputClass(Boolean(errors.loyalty))}
              autoComplete="off"
            />
          </FieldGroup>
          <FieldGroup label="Defense">
            <input
              {...register("defense")}
              placeholder="—"
              className={inputClass(Boolean(errors.defense))}
              autoComplete="off"
            />
          </FieldGroup>
        </div>

        <FieldGroup
          label="Illustrated by"
          helper="The artist's name. Yourself, a public-domain artist, or a licensed source."
        >
          <input
            {...register("artist_credit")}
            placeholder="Anya Vale"
            className={inputClass(Boolean(errors.artist_credit))}
            autoComplete="off"
          />
        </FieldGroup>

        <Controller
          control={control}
          name="art_url"
          render={({ field: artUrlField }) => (
            <Controller
              control={control}
              name="art_position"
              render={({ field: artPosField }) => (
                <ArtUploader
                  userId={userId}
                  artUrl={artUrlField.value}
                  artPosition={artPosField.value}
                  onArtChange={({ artUrl, artPosition }) => {
                    artUrlField.onChange(artUrl ?? "");
                    artPosField.onChange(artPosition);
                    setValue("art_url", artUrl ?? "", { shouldDirty: true });
                    setValue("art_position", artPosition, { shouldDirty: true });
                  }}
                />
              )}
            />
          )}
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

        <FieldGroup label="Frame style" helper="Pick a preset — or combine border and accent in the raw fields below.">
          <Controller
            control={control}
            name="frame_style"
            render={({ field }) => (
              <FrameStylePicker
                value={field.value}
                onChange={field.onChange}
              />
            )}
          />
        </FieldGroup>

        <AIAssistantPanel
          cardContext={cardContext}
          onApply={handleAIPatch}
          configured={aiConfigured}
        />

        {/* Action bar */}
        <div className="sticky bottom-0 -mx-6 -mb-6 flex flex-wrap items-center justify-between gap-3 border-t border-border/50 bg-surface/95 px-6 py-4 backdrop-blur-sm">
          <div className="flex items-center gap-2 text-xs text-muted">
            {!userId ? (
              <Badge variant="accent" className="gap-1.5">
                <Sparkles className="h-3 w-3" aria-hidden /> Preview mode
              </Badge>
            ) : isDirty ? (
              <Badge variant="accent" className="gap-1.5">
                <Sparkles className="h-3 w-3" aria-hidden /> Unsaved changes
              </Badge>
            ) : (
              <Badge variant="default">Up to date</Badge>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!userId ? (
              // Guest mode — prompt to sign in instead of showing a save button
              <>
                <Button asChild variant="ghost">
                  <Link href="/login?redirectTo=/create">
                    <ArrowLeft className="h-4 w-4" aria-hidden />
                    Back
                  </Link>
                </Button>
                <Button asChild size="lg">
                  <Link href="/signup">
                    <LogIn className="h-4 w-4" aria-hidden />
                    Sign in to save
                  </Link>
                </Button>
              </>
            ) : mode === "edit" && card ? (
              <DeleteCardDialog
                cardId={card.id}
                cardTitle={card.title}
                redirectTo="/dashboard"
              />
            ) : (
              <Button asChild variant="ghost">
                <Link href="/dashboard">
                  <ArrowLeft className="h-4 w-4" aria-hidden />
                  Cancel
                </Link>
              </Button>
            )}
            {userId ? (
              <Button type="submit" disabled={isSubmitting} size="lg">
                {isSubmitting ? (
                  <>
                    <Wand2 className="h-4 w-4 animate-pulse" aria-hidden />
                    Saving…
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4" aria-hidden />
                    {mode === "edit" ? "Save changes" : "Save card"}
                  </>
                )}
              </Button>
            ) : null}
          </div>
        </div>
      </SurfaceCard>

      {/* ----- Right: live preview ----- */}
      <aside className="lg:sticky lg:top-24 lg:self-start">
        <div className="flex flex-col gap-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-subtle">
            Live preview
          </p>
          <div className="mx-auto w-full max-w-sm">
            <CardPreview
              staticInEditor
              title={watched.title}
              cost={watched.cost}
              cardType={cardTypeForPreview}
              supertype={watched.supertype || null}
              subtypes={parseSubtypes(watched.subtypes_text)}
              rarity={rarityForPreview}
              colorIdentity={watched.color_identity}
              rulesText={watched.rules_text}
              flavorText={watched.flavor_text}
              power={watched.power}
              toughness={watched.toughness}
              loyalty={watched.loyalty}
              defense={watched.defense}
              artistCredit={watched.artist_credit}
              artUrl={watched.art_url || null}
              artPosition={watched.art_position}
              frameStyle={watched.frame_style}
            />
          </div>
          <p className="text-xs leading-5 text-muted">
            Saving doesn&apos;t publish — visibility above controls who can see
            this card.
          </p>
        </div>
      </aside>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

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
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    hasError ? "border-danger/60" : "border-border",
  );
}

function textareaClass(hasError: boolean): string {
  return cn(
    "w-full rounded-md border bg-background/60 px-3 py-2 text-sm text-foreground placeholder:text-subtle",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    hasError ? "border-danger/60" : "border-border",
  );
}

function selectClass(hasError: boolean): string {
  return cn(
    "h-10 w-full rounded-md border bg-background/60 px-3 text-sm text-foreground",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    hasError ? "border-danger/60" : "border-border",
  );
}

function ColorIdentityPicker({
  value,
  onChange,
}: {
  value: ColorIdentity[];
  onChange: (next: ColorIdentity[]) => void;
}) {
  const toggle = (color: ColorIdentity) => {
    if (value.includes(color)) {
      onChange(value.filter((c) => c !== color));
    } else {
      onChange([...value, color]);
    }
  };
  return (
    <div className="flex flex-wrap gap-2">
      {COLOR_IDENTITY_VALUES.map((color) => {
        const active = value.includes(color);
        return (
          <button
            key={color}
            type="button"
            onClick={() => toggle(color)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium capitalize transition-colors",
              active
                ? "border-primary bg-primary/15 text-primary"
                : "border-border bg-elevated text-muted hover:border-border-strong hover:text-foreground",
            )}
            aria-pressed={active}
          >
            {color}
          </button>
        );
      })}
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

