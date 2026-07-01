"use client";

// Publish panel — visibility, set membership, and the advanced tags + the
// read-only card URL. Regrouped from the old publish step (the finish picker
// moved to the Effects panel; the Tags field moved here from the old details
// step). The slug is derived from the title automatically — not user-editable.

import Link from "next/link";
import { Controller, useFormContext, useWatch } from "react-hook-form";
import { Globe2, Link2, Lock, Trophy } from "lucide-react";
import {
  ChipGroup,
  type ChipOption,
} from "@/components/ui/chip-group";
import {
  FieldGroup,
  inputClass,
} from "@/components/creator/field-group";
import { slugify } from "@/lib/validation/card";
import { mergeTag, parseTags, removeTag } from "@/lib/creator/card-fields";
import { BackFacePicker } from "@/components/creator/back-face-picker";
import { daysLeft, type Challenge } from "@/lib/challenges/shared";
import type { Card, Visibility } from "@/types/card";
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

export type CardSetOption = {
  id: string;
  title: string;
  icon_url: string | null;
  icon_code: string | null;
};

type PublishPanelProps = {
  /** The currently running challenge, if any — renders the entry toggle. */
  activeChallenge?: Challenge | null;
  /** Current user's username, if any — previews the canonical card URL. */
  ownerUsername?: string | null;
  /** The current user's sets — populates the "Add to set" picker. */
  mySets: CardSetOption[];
  /** The current user's cards — the back-face picker. Excludes this card. */
  myCards: Card[];
  /** Save the current card + open a fresh creator to build/link a back face. */
  onCreateBackFace: () => void;
  /** Live slug/title values from the form, for the URL helper text. */
  watchedSlug: string;
  watchedTitle: string;
};

export function PublishPanel({
  activeChallenge,
  ownerUsername,
  mySets,
  myCards,
  onCreateBackFace,
  watchedSlug,
  watchedTitle,
}: PublishPanelProps) {
  const {
    register,
    control,
    setValue,
    formState: { errors },
  } = useFormContext<FormValues>();
  const tagsText = useWatch({ control, name: "tags_text" }) ?? "";
  const visibility = useWatch({ control, name: "visibility" });
  const backCardId = useWatch({ control, name: "back_card_id" }) ?? "";
  const entered = activeChallenge
    ? parseTags(tagsText).includes(activeChallenge.tag)
    : false;

  return (
    <>
      {activeChallenge ? (
        <div className="flex flex-col gap-2 rounded-xl border border-gold/40 bg-surface/80 p-4">
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              checked={entered}
              onChange={(e) =>
                setValue(
                  "tags_text",
                  e.target.checked
                    ? mergeTag(tagsText, activeChallenge.tag)
                    : removeTag(tagsText, activeChallenge.tag),
                  { shouldDirty: true },
                )
              }
              className="mt-1"
              aria-describedby="challenge-entry-help"
            />
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-foreground">
                <Trophy className="h-4 w-4 text-gold-strong" aria-hidden />
                Enter the &ldquo;{activeChallenge.title}&rdquo; challenge
              </span>
              <span id="challenge-entry-help" className="text-xs leading-5 text-muted">
                Adds the{" "}
                <code className="rounded bg-elevated/70 px-1 py-0.5 font-mono text-[11px] text-foreground">
                  {activeChallenge.tag}
                </code>{" "}
                tag · {daysLeft(activeChallenge)} day
                {daysLeft(activeChallenge) === 1 ? "" : "s"} left ·{" "}
                <Link
                  href={`/challenges/${activeChallenge.slug}`}
                  className="text-primary-bright underline-offset-2 hover:underline"
                >
                  view the brief
                </Link>
              </span>
            </span>
          </label>
          {entered && visibility !== "public" ? (
            <p className="text-xs leading-5 text-accent">
              Entries must be public to appear on the challenge page — this
              card is currently {visibility || "private"}. Switch Visibility
              to Public below.
            </p>
          ) : null}
        </div>
      ) : null}

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

      <BackFacePicker
        myCards={myCards}
        value={backCardId}
        onChange={(id) =>
          setValue("back_card_id", id, { shouldDirty: true })
        }
        onCreateNew={onCreateBackFace}
      />

      {/* Discovery tags + the read-only card URL (the slug derives from the
          title automatically and is not user-editable), under Advanced. */}
      <details className="rounded-lg border border-border/60 bg-elevated/30">
        <summary className="cursor-pointer list-none px-4 py-2 text-xs font-semibold uppercase tracking-wider text-subtle [&::-webkit-details-marker]:hidden">
          Advanced
        </summary>
        <div className="flex flex-col gap-4 px-4 pb-4">
          <FieldGroup
            label="Tags"
            helper="Comma-separated keywords for discovery (e.g. dragons, tokens). Up to 12."
          >
            <input
              {...register("tags_text")}
              placeholder="dragons, tokens, tribal"
              className={inputClass(Boolean(errors.tags_text))}
              autoComplete="off"
            />
          </FieldGroup>

          <FieldGroup
            label="Card URL"
            helper="Generated automatically from the title — not editable."
          >
            <p className="break-all rounded-md border border-border bg-background/40 px-3 py-2 text-sm text-muted">
              {ownerUsername
                ? `/card/${ownerUsername}/${watchedSlug || slugify(watchedTitle || "untitled-card")}`
                : `/card/${watchedSlug || slugify(watchedTitle || "untitled-card")}`}
            </p>
          </FieldGroup>
        </div>
      </details>
    </>
  );
}
