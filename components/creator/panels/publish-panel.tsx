"use client";

// Publish panel — the "Save as a draft" checkbox + visibility lead, then
// discovery tags, with finish and watermark tucked into Advanced. The
// challenge entry toggle leads when a challenge is running. The slug is
// derived from the title automatically — not user-editable. The
// "Double-faced cards — coming soon" veil that sat under Advanced is gone
// (TODO 5.2): a double-faced card is a KIND of the Card step, its back a
// panel of the Identity step.

import { useId } from "react";
import { Controller, useFormContext, useWatch } from "react-hook-form";
import { FileEdit, Globe2, Link2, Trophy } from "lucide-react";
import {
  ChipGroup,
  type ChipOption,
} from "@/components/ui/chip-group";
import {
  FieldGroup,
  inputClass,
} from "@/components/creator/field-group";
import { mergeTag, parseTags, removeTag } from "@/lib/creator/card-fields";
import { ChallengeBriefDialog } from "@/components/creator/challenge-brief-dialog";
import { EffectsPanel } from "@/components/creator/panels/effects-panel";
import { WatermarkPicker } from "@/components/creator/panels/watermark-picker";
import { daysLeft, type Challenge } from "@/lib/challenges/shared";
import { cn } from "@/lib/utils";
import type { Visibility } from "@/types/card";
import type { FormValues } from "@/lib/creator/form-types";
import type { StrongLanguageChoices } from "@/lib/creator/strong-language";
import { STRONG_LANGUAGE_CHOICE_REASON, strongLanguageNote } from "@/lib/moderation/profanity";
import Link from "next/link";
import {
  MODERATION_CONTACT_HREF,
  MODERATION_LOCK_CHOICE_REASON,
  MODERATION_LOCK_NOTE,
} from "@/lib/moderation/lock";

// Private is not a chip any more — it is the "Save as a draft" checkbox
// above the chips (owner decision 2026-09-16: drafts simply force private).
const VISIBILITY_OPTIONS: ChipOption<Visibility>[] = [
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

export type DeckOption = {
  id: string;
  title: string;
  format: string;
  /** Deck page slug — the AI dialog's "Open deck" toast link. */
  slug?: string;
  /** Public / unlisted: a private card saved into it shows as "Private
   *  card" to its visitors — the deck box says so (TODO DK0.13). */
  visibility?: Visibility;
  /** Theme/style the deck was last generated with (lib/ai/generation-jobs
   *  getDeckAiSeeds) — the AI dialog imports them when the deck is picked. */
  theme?: string | null;
  style?: string | null;
};

type PublishPanelProps = {
  /** Signed-in user id — gates the custom-watermark upload. */
  userId: string | null;
  /** The currently running challenge, if any — renders the entry toggle. */
  activeChallenge?: Challenge | null;
  /** Edit / remix: the finish is locked structure (owner decision
   *  2026-09-16) and is not offered. */
  revise?: boolean;
  /** True while a new card's Tags field still follows its words
   *  (components/creator/use-auto-tags.ts): the helper says so. Once the
   *  maker changes the field — or on an edit, a remix, a deck-card proxy —
   *  the helper is the plain one. */
  tagsAutoFilled?: boolean;
  /** False for creature/instant/sorcery/artifact/enchantment — their
   *  watermark is a subscriber perk on the Subscriber step (free accounts
   *  always carry the PipGlyph Rose there). */
  showWatermark?: boolean;
  /** The choices the card's text rules out (owner policy 2026-10-28: strong
   *  language saves private — lib/creator/strong-language.ts) and the
   *  fields that do it. Absent / empty = both open. */
  strongLanguage?: StrongLanguageChoices;
  /** An edit of a card moderation hid (migration 0156,
   *  lib/moderation/lock.ts): neither choice is offered, one note says why
   *  and how to reach the team — the save sends private. */
  moderationLocked?: boolean;
};

export function PublishPanel({
  userId,
  activeChallenge,
  revise = false,
  tagsAutoFilled = false,
  showWatermark = true,
  strongLanguage,
  moderationLocked = false,
}: PublishPanelProps) {
  const {
    register,
    control,
    setValue,
    formState: { errors },
  } = useFormContext<FormValues>();
  const tagsText = useWatch({ control, name: "tags_text" }) ?? "";
  const visibility = useWatch({ control, name: "visibility" });
  const saveAsDraft = useWatch({ control, name: "save_as_draft" }) ?? false;
  const draftId = useId();
  const draftNameId = `${draftId}-name`;
  const draftNoteId = `${draftId}-note`;
  const languageNoteId = `${draftId}-language`;
  // Strong language in the text: the choices it rules out are unavailable
  // (aria-disabled, the reason in their name). While the CURRENT choice is
  // one of them it shows as unpicked and ONE polite note under the chips
  // says the card will save private and names the fields — the save sends
  // private (card-creator-form.tsx runSubmit). A choice still open (an
  // unlisted card kept from Public) says nothing more than its chips do.
  const blockedPublic = strongLanguage?.public ?? [];
  const blockedUnlisted = strongLanguage?.unlisted ?? [];
  const visibilityOptions = VISIBILITY_OPTIONS.map((option) =>
    moderationLocked
      ? { ...option, disabled: true, description: MODERATION_LOCK_CHOICE_REASON }
      : (option.value === "public" ? blockedPublic : blockedUnlisted).length > 0
        ? { ...option, disabled: true, description: STRONG_LANGUAGE_CHOICE_REASON }
        : option,
  );
  const languageFields = saveAsDraft || moderationLocked
    ? []
    : visibility === "public"
      ? blockedPublic
      : visibility === "unlisted"
        ? blockedUnlisted
        : [];
  const blockedNow = languageFields.length > 0 || moderationLocked;
  const lockNoteId = `${draftId}-moderation`;
  // The checkbox and the visibility field move together: ticking it forces
  // private; unticking a private card offers public (the default) again.
  const setSaveAsDraft = (next: boolean) => {
    setValue("save_as_draft", next, { shouldDirty: true });
    if (next) {
      setValue("visibility", "private", { shouldDirty: true });
    } else if (visibility === "private") {
      setValue("visibility", "public", { shouldDirty: true });
    }
  };
  const entered = activeChallenge
    ? parseTags(tagsText).includes(activeChallenge.tag)
    : false;

  return (
    <>
      {activeChallenge ? (
        <div className="flex flex-col gap-2 rounded-xl border border-gold/40 bg-surface/80 p-4">
          <div className="flex items-center justify-between gap-3">
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
                <ChallengeBriefDialog challenge={activeChallenge} />
              </span>
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={entered}
              aria-label={`Enter the ${activeChallenge.title} challenge`}
              aria-describedby="challenge-entry-help"
              onClick={() =>
                setValue(
                  "tags_text",
                  entered
                    ? removeTag(tagsText, activeChallenge.tag)
                    : mergeTag(tagsText, activeChallenge.tag),
                  { shouldDirty: true },
                )
              }
              className={cn(
                "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-strong/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                entered ? "bg-gold-strong" : "bg-elevated border border-border",
              )}
            >
              <span
                className={cn(
                  "inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform",
                  entered ? "translate-x-[22px]" : "translate-x-0.5",
                )}
              />
            </button>
          </div>
          {entered && visibility !== "public" ? (
            <p className="text-xs leading-5 text-accent">
              Entries must be public to appear on the challenge page — this
              card is currently {visibility || "private"}.
              {saveAsDraft
                ? " Untick “Save as a draft” and choose Public below."
                : " Choose Public below."}
            </p>
          ) : null}
        </div>
      ) : null}

      {/* Draft vs. publish — the one decision this step is for. */}
      <FieldGroup kind="group" label="Publishing">
        <div className="flex flex-col gap-3">
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border/60 bg-elevated/30 px-4 py-3 text-sm text-foreground has-[:checked]:border-primary/50 has-[:checked]:bg-primary/5">
            {/* Named by its words alone and DESCRIBED by the line under
                them — the wrapping <label> alone made the whole label, helper
                included, its name (TODO 3b.36). The label still makes the
                whole box a click target. */}
            <input
              type="checkbox"
              checked={saveAsDraft}
              onChange={(event) => setSaveAsDraft(event.target.checked)}
              aria-labelledby={draftNameId}
              aria-describedby={draftNoteId}
              className="mt-0.5 h-4 w-4 accent-[var(--color-primary)]"
              data-testid="save-as-draft"
            />
            <span className="flex flex-col gap-0.5">
              <span id={draftNameId} className="inline-flex items-center gap-1.5 font-medium">
                <FileEdit className="h-4 w-4 text-muted" aria-hidden />
                Save as a draft
              </span>
              <span id={draftNoteId} className="text-xs leading-5 text-muted">
                Private — only you can see it, and it needs just a title.
                Untick it whenever you&apos;re ready to publish.
              </span>
            </span>
          </label>
          {saveAsDraft ? null : (
            <Controller
              control={control}
              name="visibility"
              render={({ field }) => (
                <ChipGroup
                  ariaLabel="Visibility"
                  ariaDescribedBy={
                    moderationLocked ? lockNoteId : languageFields.length > 0 ? languageNoteId : undefined
                  }
                  layout="grid-2"
                  size="md"
                  // A choice the text rules out is never shown as picked;
                  // the form keeps it, so removing the words brings it back.
                  value={blockedNow ? "" : field.value}
                  onChange={(next) => field.onChange(next)}
                  options={visibilityOptions}
                />
              )}
            />
          )}
          {/* Always mounted (and never display:none, which some screen
              readers then skip), so a change is announced once, politely —
              never an alert. Empty while the text is clean or the card is a
              draft (a draft is private anyway); an empty note takes no
              room (`empty:` cancels the row's gap). */}
          <p
            id={languageNoteId}
            role="status"
            data-testid="strong-language-note"
            className="text-xs leading-5 text-accent empty:-mt-3"
          >
            {languageFields.length > 0 ? strongLanguageNote(languageFields) : null}
          </p>
          {/* The moderation lock (0156): a fact of the card, not of what is
              typed — static text, shown whether or not it is a draft. */}
          {moderationLocked ? (
            <p id={lockNoteId} data-testid="moderation-lock-note" className="text-xs leading-5 text-accent">
              {MODERATION_LOCK_NOTE}{" "}
              <Link href={MODERATION_CONTACT_HREF} className="font-medium text-primary-bright underline-offset-4 hover:underline">
                Contact us
              </Link>{" "}
              if you have questions.
            </p>
          ) : null}
        </div>
      </FieldGroup>


      {/* "Add to deck" left this step for its own box under the live
          preview (components/creator/creator-deck-box.tsx, TODO DK9.3). */}

      <FieldGroup
        label="Tags"
        helper={
          tagsAutoFilled
            ? "Filled in from the card's rules text and subtypes until you change them. Comma-separated, up to 12."
            : "Comma-separated keywords for discovery (e.g. dragons, tokens). Up to 12."
        }
        error={errors.tags_text?.message}
      >
        <input
          {...register("tags_text")}
          placeholder="dragons, tokens, tribal"
          className={inputClass(Boolean(errors.tags_text))}
          autoComplete="off"
        />
      </FieldGroup>

      {/* Finish + watermark, under Advanced. */}
      <details className="rounded-lg border border-border/60 bg-elevated/30">
        <summary className="cursor-pointer list-none px-4 py-2 text-xs font-semibold uppercase tracking-wider text-subtle [&::-webkit-details-marker]:hidden">
          Advanced
        </summary>
        <div className="flex flex-col gap-4 px-4 pb-4">
          {revise ? null : <EffectsPanel />}
          {showWatermark ? <WatermarkPicker userId={userId} /> : null}
        </div>
      </details>
    </>
  );
}
