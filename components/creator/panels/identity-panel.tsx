"use client";

// Identity panel — quick-start actions (Scryfall import / AI random card),
// title, card type, rarity, plus the "more options" collapsible (supertype /
// subtypes). Regrouped from the old frame + details steps; orchestrator-owned
// state (Scryfall dialog, random-card flight) arrives via props.

import { Controller, useFormContext } from "react-hook-form";
import { Search, Sparkles, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ChipGroup,
  type ChipOption,
} from "@/components/ui/chip-group";
import {
  CARD_TYPE_OPTIONS,
  FieldGroup,
  MoreOptions,
  inputClass,
} from "@/components/creator/field-group";
import { RARITY_VALUES, type Rarity } from "@/types/card";
import type { FormValues } from "@/lib/creator/form-types";

const RARITY_COLOR_HEX: Record<Rarity, string> = {
  common: "#cfcfd4",
  uncommon: "#c6e2f5",
  rare: "#f3d57c",
  mythic: "#f08a4a",
};

function SmallGem({ color }: { color: string }) {
  // Tiny diamond gem, matches the larger RarityGem in the card preview but
  // sized for the chip's leading slot.
  return (
    <svg viewBox="0 0 12 12" className="h-3 w-3" aria-hidden>
      <polygon
        points="6,1 11,6 6,11 1,6"
        fill={color}
        stroke="rgba(0,0,0,0.4)"
        strokeWidth="0.6"
      />
    </svg>
  );
}

const RARITY_OPTIONS: ChipOption<Rarity>[] = RARITY_VALUES.map((rarity) => ({
  value: rarity,
  label: rarity,
  leading: <SmallGem color={RARITY_COLOR_HEX[rarity]} />,
  activeClass: "border-foreground/50 bg-elevated text-foreground",
}));

type IdentityPanelProps = {
  userId: string | null;
  /** Random-card request in flight (orchestrator-owned). */
  generatingRandom: boolean;
  onRandomCard: () => void;
  onOpenScryfall: () => void;
};

export function IdentityPanel({
  userId,
  generatingRandom,
  onRandomCard,
  onOpenScryfall,
}: IdentityPanelProps) {
  const {
    register,
    control,
    formState: { errors },
  } = useFormContext<FormValues>();

  return (
    <>
      {/* Quick-start: import a real card or let the AI draft one. */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 bg-elevated/40 px-4 py-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-xs font-semibold uppercase tracking-wider text-subtle">
            Start from a real card
          </span>
          <span className="text-[11px] text-muted">
            Search Scryfall and seed every field, including the artwork.
          </span>
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={!userId}
          title={
            userId
              ? undefined
              : "Sign in to search and import real cards."
          }
          onClick={onOpenScryfall}
        >
          <Search className="h-4 w-4" aria-hidden />
          Search a real card
        </Button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3">
        <div className="flex flex-col gap-0.5">
          <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-primary-bright">
            <Sparkles className="h-3 w-3" aria-hidden />
            Generate with AI
          </span>
          <span className="text-[11px] text-muted">
            AI drafts the card and an image model paints original art.
            Capped at 10 random cards per day.
          </span>
        </div>
        <Button
          type="button"
          variant="primary"
          disabled={!userId || generatingRandom}
          title={
            userId
              ? generatingRandom
                ? "Generating…"
                : undefined
              : "Sign in to use the AI generator."
          }
          onClick={onRandomCard}
        >
          {generatingRandom ? (
            <>
              <Wand2 className="h-4 w-4 animate-pulse" aria-hidden />
              Forging…
            </>
          ) : (
            <>
              <Wand2 className="h-4 w-4" aria-hidden />
              Random card
            </>
          )}
        </Button>
      </div>

      <FieldGroup
        label="Title"
        helper="The card's name. Defaults the slug if you leave that blank."
        error={errors.title?.message}
      >
        <input
          {...register("title", { required: "A title is required." })}
          placeholder="Emberbound Wyrm"
          className={inputClass(Boolean(errors.title))}
          autoComplete="off"
        />
      </FieldGroup>

      {/* What are you making — the card type drives the frame's type-variant
          (the Frame panel derives from it). */}
      <FieldGroup label="Card type" error={errors.card_type?.message}>
        <Controller
          control={control}
          name="card_type"
          render={({ field }) => (
            <ChipGroup
              ariaLabel="Card type"
              layout="grid-3"
              value={field.value}
              onChange={(next) => field.onChange(next)}
              options={CARD_TYPE_OPTIONS}
            />
          )}
        />
      </FieldGroup>

      {/* Rarity. (The old "Template" select was removed: template_id is
          a vestigial DB field — no renderer reads it; the visual layout is
          driven entirely by the Frame picker, and stat visibility by card
          type. template_id is still defaulted + persisted in form state for
          schema compatibility, just no longer user-editable.) */}
      <FieldGroup label="Rarity">
        <Controller
          control={control}
          name="rarity"
          render={({ field }) => (
            <ChipGroup
              ariaLabel="Rarity"
              layout="grid-4"
              value={field.value}
              onChange={(next) => field.onChange(next)}
              options={RARITY_OPTIONS}
            />
          )}
        />
      </FieldGroup>

      {/* Quick path stops here: title + type + rarity make a real card.
          Everything below is detail control. */}
      <MoreOptions summary="More options — supertype, subtypes">
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
            helper="Comma-separated. Up to 10."
          >
            <input
              {...register("subtypes_text")}
              placeholder="Dragon, Elder"
              className={inputClass(Boolean(errors.subtypes_text))}
              autoComplete="off"
            />
          </FieldGroup>
        </div>
      </MoreOptions>
    </>
  );
}
