"use client";

// Publish step — visibility, set membership, finish, and the advanced slug
// override. Extracted verbatim from card-creator-form.tsx.

import Link from "next/link";
import { Controller, useFormContext } from "react-hook-form";
import { Globe2, Link2, Lock } from "lucide-react";
import {
  ChipGroup,
  type ChipOption,
} from "@/components/ui/chip-group";
import {
  FieldGroup,
  inputClass,
} from "@/components/creator/field-group";
import { slugify } from "@/lib/validation/card";
import type { CardFinish, Visibility } from "@/types/card";
import type { FormValues } from "@/lib/creator/form-types";

const VISIBILITY_OPTIONS: ChipOption<Visibility>[] = [
  {
    value: "private",
    label: "Private",
    description: "Only you can see it.",
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
    description: "Listed in the public gallery and your profile. The default.",
    icon: Globe2,
  },
];

// Finish presets — premium treatments layered on top of the base frame.
// Descriptions are surfaced via ChipGroup's `md` size which shows the
// description under the label.
const FINISH_OPTIONS: ChipOption<CardFinish>[] = [
  {
    value: "regular",
    label: "Regular",
    description: "Baseline frame. The default look.",
  },
  {
    value: "foil",
    label: "Foil",
    description: "Animated holographic sheen for showpieces.",
    activeClass: "border-accent bg-accent/15 text-accent",
  },
  {
    value: "etched",
    label: "Etched",
    description: "Gold-leaf inner border with a subtle texture.",
    activeClass: "border-amber-300 bg-amber-300/15 text-amber-200",
  },
  {
    value: "showcase",
    label: "Showcase",
    description: "Italic display title with an ornate hairline.",
    activeClass: "border-primary bg-primary/15 text-primary-bright",
  },
];

export type CardSetOption = {
  id: string;
  title: string;
  icon_url: string | null;
  icon_code: string | null;
};

type PublishStepProps = {
  /** Current user's username, if any — previews the canonical card URL. */
  ownerUsername?: string | null;
  /** The current user's sets — populates the "Add to set" picker. */
  mySets: CardSetOption[];
  /** Live slug/title values from the form, for the URL helper text. */
  watchedSlug: string;
  watchedTitle: string;
};

export function PublishStep({
  ownerUsername,
  mySets,
  watchedSlug,
  watchedTitle,
}: PublishStepProps) {
  const {
    register,
    control,
    formState: { errors },
  } = useFormContext<FormValues>();

  return (
    <>
      <FieldGroup label="Visibility">
        <Controller
          control={control}
          name="visibility"
          render={({ field }) => (
            <ChipGroup
              ariaLabel="Visibility"
              layout="grid-3"
              size="md"
              value={field.value}
              onChange={(next) => field.onChange(next)}
              options={VISIBILITY_OPTIONS}
            />
          )}
        />
      </FieldGroup>

      <FieldGroup
        label="Add to set"
        helper="Group this card into one of your sets. If that set has an icon, the card uses it as its set symbol."
      >
        <Controller
          control={control}
          name="primary_set_id"
          render={({ field }) => (
            <div className="flex flex-col gap-2">
              <select
                value={field.value}
                onChange={(event) => field.onChange(event.target.value)}
                disabled={mySets.length === 0}
                className={inputClass(false)}
              >
                <option value="">No set</option>
                {mySets.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title}
                  </option>
                ))}
              </select>
              <span className="text-[11px] text-muted">
                {mySets.length === 0 ? (
                  <>
                    You don&apos;t have any sets yet.{" "}
                    <Link
                      href="/dashboard/sets/new"
                      className="text-primary-bright underline-offset-2 hover:underline"
                    >
                      Create one
                    </Link>
                    .
                  </>
                ) : (
                  <Link
                    href="/dashboard/sets/new"
                    className="text-primary-bright underline-offset-2 hover:underline"
                  >
                    Create a new set
                  </Link>
                )}
              </span>
            </div>
          )}
        />
      </FieldGroup>

      <FieldGroup
        label="Finish"
        helper="Premium treatment layered on top of the frame."
      >
        <Controller
          control={control}
          name="frame_style.finish"
          render={({ field }) => (
            <ChipGroup
              ariaLabel="Finish"
              layout="grid-2"
              size="md"
              value={field.value ?? "regular"}
              onChange={(next) => field.onChange(next)}
              options={FINISH_OPTIONS}
            />
          )}
        />
      </FieldGroup>

      {/* Slug auto-derives from the title; tuck it under Advanced for
          anyone who wants a custom URL. */}
      <details className="rounded-lg border border-border/60 bg-elevated/30">
        <summary className="cursor-pointer list-none px-4 py-2 text-xs font-semibold uppercase tracking-wider text-subtle [&::-webkit-details-marker]:hidden">
          Advanced
        </summary>
        <div className="px-4 pb-4">
          <FieldGroup
            label="Slug"
            helper={`URL: ${
              ownerUsername
                ? `/card/${ownerUsername}/${watchedSlug || slugify(watchedTitle || "untitled-card")}`
                : `/card/${watchedSlug || slugify(watchedTitle || "untitled-card")}`
            }`}
            error={errors.slug?.message}
          >
            <input
              {...register("slug")}
              placeholder="emberbound-wyrm"
              className={inputClass(Boolean(errors.slug))}
              autoComplete="off"
            />
          </FieldGroup>
        </div>
      </details>
    </>
  );
}
