"use client";

// Publish panel — the "Save as a draft" checkbox + visibility lead, then
// discovery tags, with finish and watermark tucked into Advanced. The
// challenge entry toggle leads when a challenge is running. The slug is
// derived from the title automatically — not user-editable. The
// "Double-faced cards — coming soon" veil that sat under Advanced is gone
// (TODO 5.2): a double-faced card is a KIND of the Card step, its back a
// panel of the Identity step.

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { Controller, useFormContext, useWatch } from "react-hook-form";
import { FileEdit, Globe2, Link2, Loader2, Plus, Trophy } from "lucide-react";
import { toast } from "sonner";
import { createDeckAction } from "@/lib/decks/actions";
import {
  DECK_FORMAT_LABELS,
  DECK_FORMAT_VALUES,
  type DeckFormat,
} from "@/types/deck";
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
  /** The current user's decks — the "Add to deck" picker. `null` hides the
   *  picker entirely (edit mode: deck membership is managed from the deck
   *  dashboard, not the card editor). */
  myDecks?: DeckOption[] | null;
  /** Edit / remix: deck and finish are locked structure
   *  (owner decision 2026-09-16) and are not offered. */
  revise?: boolean;
  /** False for creature/instant/sorcery/artifact/enchantment — their
   *  watermark is a subscriber perk on the Subscriber step (free accounts
   *  always carry the PipGlyph Rose there). */
  showWatermark?: boolean;
  /** The choices the card's text rules out (owner policy 2026-10-28: strong
   *  language saves private — lib/creator/strong-language.ts) and the
   *  fields that do it. Absent / empty = both open. */
  strongLanguage?: StrongLanguageChoices;
};

export function PublishPanel({
  userId,
  activeChallenge,
  myDecks = null,
  revise = false,
  showWatermark = true,
  strongLanguage,
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
    (option.value === "public" ? blockedPublic : blockedUnlisted).length > 0
      ? { ...option, disabled: true, description: STRONG_LANGUAGE_CHOICE_REASON }
      : option,
  );
  const languageFields = saveAsDraft
    ? []
    : visibility === "public"
      ? blockedPublic
      : visibility === "unlisted"
        ? blockedUnlisted
        : [];
  const blockedNow = languageFields.length > 0;
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
                  ariaDescribedBy={languageFields.length > 0 ? languageNoteId : undefined}
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
            {blockedNow ? strongLanguageNote(languageFields) : null}
          </p>
        </div>
      </FieldGroup>


      {myDecks !== null && !revise ? <DeckPicker myDecks={myDecks} /> : null}

      <FieldGroup
        label="Tags"
        helper="Comma-separated keywords for discovery (e.g. dragons, tokens). Up to 12."
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

// ---------------------------------------------------------------------------
// DeckPicker — "Add to deck" select + inline quick-create. Create mode only
// (the parent passes myDecks: null on edit). Saving the card writes a
// custom-only mainboard entry into the chosen deck.
// ---------------------------------------------------------------------------

function DeckPicker({ myDecks }: { myDecks: DeckOption[] }) {
  const { control, setValue } = useFormContext<FormValues>();
  // Quick-created decks merge into the options without a page reload.
  const [extraDecks, setExtraDecks] = useState<DeckOption[]>([]);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newFormat, setNewFormat] = useState<DeckFormat>("commander");
  const [isPending, startTransition] = useTransition();
  // Closing the quick-create row (Cancel, or the deck was created) removes
  // the control that held the focus: hand it back to "＋ New deck" instead
  // of dropping it on the page.
  const newDeckRef = useRef<HTMLButtonElement | null>(null);
  const [closes, setCloses] = useState(0);
  useEffect(() => {
    const button = newDeckRef.current;
    if (closes === 0 || !button) return;
    // Only a focus that was lost with the row (or is still in this field):
    // someone who clicked on elsewhere while the deck was created is left
    // alone.
    const active = document.activeElement;
    if (active && active !== document.body && !button.closest("label")?.contains(active)) return;
    button.focus();
  }, [closes]);
  const closeQuickCreate = () => {
    setCreating(false);
    setCloses((count) => count + 1);
  };

  const options = [...extraDecks, ...myDecks];

  const handleQuickCreate = () => {
    const title = newTitle.trim();
    if (!title) {
      toast.error("Give the deck a name first.");
      return;
    }
    startTransition(async () => {
      // No visibility is sent, so createDeckSchema's "public" default
      // applies (lib/validation/deck.ts — not the column's 'private'). A
      // visibility choice here is DK0.8's remaining part, which moves to
      // DK9.3's creator deck box.
      const result = await createDeckAction({ title, format: newFormat }, { surface: "creator" });
      if (!result.ok) {
        toast.error(
          result.formError ??
            Object.values(result.fieldErrors ?? {})[0] ??
            "Could not create the deck.",
        );
        return;
      }
      setExtraDecks((prev) => [
        { id: result.deckId, title, format: newFormat },
        ...prev,
      ]);
      setValue("deck_id", result.deckId, { shouldDirty: true });
      closeQuickCreate();
      setNewTitle("");
      toast.success(`Created “${title}” — this card will be added to it.`);
    });
  };

  return (
    <FieldGroup
      label="Add to deck"
      helper="Drop this card straight into one of your decks (mainboard, ×1)."
    >
      {(aria) => (
      <Controller
        control={control}
        name="deck_id"
        render={({ field }) => (
          <div className="flex flex-col gap-2">
            <select
              {...aria}
              value={field.value}
              onChange={(event) => field.onChange(event.target.value)}
              disabled={options.length === 0}
              className={inputClass(false)}
            >
              <option value="">No deck</option>
              {options.map((deck) => (
                <option key={deck.id} value={deck.id}>
                  {deck.title}
                  {DECK_FORMAT_LABELS[deck.format as DeckFormat]
                    ? ` · ${DECK_FORMAT_LABELS[deck.format as DeckFormat]}`
                    : ""}
                </option>
              ))}
            </select>

            {creating ? (
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={newTitle}
                  onChange={(event) => setNewTitle(event.target.value)}
                  placeholder="Deck name"
                  aria-label="New deck name"
                  // "＋ New deck" was replaced by this row: the focus it
                  // held comes here instead of being dropped.
                  autoFocus
                  disabled={isPending}
                  className={cn(inputClass(false), "h-9 flex-1 min-w-40")}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      handleQuickCreate();
                    }
                  }}
                />
                <select
                  value={newFormat}
                  onChange={(event) =>
                    setNewFormat(event.target.value as DeckFormat)
                  }
                  aria-label="New deck format"
                  disabled={isPending}
                  className={cn(inputClass(false), "h-9 w-auto")}
                >
                  {DECK_FORMAT_VALUES.map((format) => (
                    <option key={format} value={format}>
                      {DECK_FORMAT_LABELS[format]}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={handleQuickCreate}
                  disabled={isPending}
                  className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
                >
                  {isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  ) : (
                    <Plus className="h-3.5 w-3.5" aria-hidden />
                  )}
                  Create
                </button>
                <button
                  type="button"
                  onClick={(event) => {
                    // Gone before its click ends, like "＋ New deck" below.
                    event.preventDefault();
                    closeQuickCreate();
                  }}
                  disabled={isPending}
                  className="text-xs text-muted transition-colors hover:text-foreground"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                ref={newDeckRef}
                type="button"
                onClick={(event) => {
                  // The button sits in the field's <label> and is gone before
                  // its click ends: WebKit then hands the click to the
                  // label's control (the deck select), which takes the focus
                  // from the name input. A cancelled click is not forwarded.
                  event.preventDefault();
                  setCreating(true);
                }}
                className="self-start text-[11px] text-primary-bright underline-offset-2 hover:underline"
              >
                ＋ New deck
              </button>
            )}
          </div>
        )}
      />
      )}
    </FieldGroup>
  );
}
