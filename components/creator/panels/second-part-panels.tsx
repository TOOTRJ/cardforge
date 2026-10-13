"use client";

// The second part of a one-picture two-part card, per step (TODO 5.14, Face
// tabs part 2): a split card's right half, an aftermath card's sideways
// half, an adventure's spell, a flip card's other side.
//
// Until part 2 the whole second part was ONE panel (`LayoutPanel`) inside
// the Identity step's "More options — artist credit & right half" fold.
// With the switch ("Left half | Right half") each of its fields sits on the
// step its first-part twin sits on, in the same order, shown while the
// second tab is selected:
//
//   Identity step   SecondPartIdentityFields — name, card type, Types,
//                   Subtypes, artwork + positioner, artist credit, Clear
//   Text & stats    SecondPartCostField, SecondPartRulesField,
//                   SecondPartFlavorField, SecondPartStatsFields
//
// Every field writes the SAME form path as before (`back_face.*`) with the
// same control — nothing about what is stored, sent or drawn changes; the
// fields only moved (tests/unit/components/creator-face-tabs-payload.test.tsx
// replays saves recorded on `origin/main`). EVERY field the old panel showed
// is still here, the ones a part never prints included (a split half's
// loyalty and defense, a flip side's own art box): a stored card may hold a
// value, and hiding one is the owner's decision per field (TODO 5.14,
// item 7). An adventure's spell shows no flavour, stats, artist or art, as
// before — the frame draws none of them.
//
// A second part's card type picks no frame and no colour (the card's are
// shared by both parts), so — unlike a double-faced back's — it is not
// structure: it stays editable on an edit, and its chips stand on the
// Identity step above the type line they feed.

import { TypesField } from "@/components/creator/types-field";
import { Controller, useController, useFormContext } from "react-hook-form";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SurfaceCard } from "@/components/ui/surface-card";
import { ChipGroup } from "@/components/ui/chip-group";
import { ManaCostPicker } from "@/components/cards/mana-cost-picker";
import { RulesSymbolToolbar } from "@/components/creator/rules-symbol-toolbar";
import {
  PipTextEditor,
  type PipTextEditorHandle,
} from "@/components/creator/pip-text-editor";
import { ArtUploader } from "@/components/creator/art-uploader";
import { RealCardArtButton } from "@/components/creator/real-card-art-dialog";
import {
  CARD_TYPE_OPTIONS,
  FieldGroup,
  MoreOptions,
  inputClass,
  textareaClass,
} from "@/components/creator/field-group";
import {
  EMPTY_BACK_FACE,
  type BackFaceFormValues,
  type FormValues,
} from "@/lib/creator/form-types";
import { SECOND_FACE_NAME_HINT } from "@/lib/cards/second-face-name";
import type { ArtWindow } from "@/lib/cards/art-positioner-window";
import { secondPartFieldName, type SecondPartWords } from "@/lib/creator/second-part";
import { PtNotDrawnNote } from "@/components/creator/pt-not-drawn-note";

/** Under a second part's art box on a frame that gives the part no picture
 *  of its own (a flip card: one picture, between the two sides). */
export const secondPartArtNotDrawnNote = (partWords: SecondPartWords) =>
  `This card has one picture, shared by ${partWords.both} — artwork set here is saved with the card but not drawn on it.`;

/** The second part is switched off (`has_back_face` false — the form turns
 *  it on by itself for these frames; this is what shows until it has). The
 *  same card the old panel showed, with the same button. */
export function SecondPartEmpty({
  isAdventureFrame,
  partWords,
  onAdded,
}: {
  isAdventureFrame: boolean;
  partWords: SecondPartWords;
  onAdded?: () => void;
}) {
  const { setValue } = useFormContext<FormValues>();
  return (
    <SurfaceCard className="flex flex-col items-center gap-3 border-dashed bg-elevated/40 p-8 text-center">
      <p className="text-sm leading-6 text-muted">
        {isAdventureFrame ? (
          <>
            The Adventure frame splits the lower card into a storybook: this
            content becomes the <strong>adventure spell</strong> on the left
            page, shown alongside the creature&apos;s rules — no flip. Add it
            to fill the adventure.
          </>
        ) : (
          <>
            This frame paints {partWords.phrase} on the same card. Add it to
            give it a name, a cost and rules of its own — it shares the
            card&apos;s rarity and frame.
          </>
        )}
      </p>
      <Button
        type="button"
        variant="primary"
        size="sm"
        onClick={() => {
          setValue("has_back_face", true, { shouldDirty: true });
          onAdded?.();
        }}
      >
        <Sparkles className="h-4 w-4" aria-hidden />
        {`Add ${partWords.phrase}`}
      </Button>
    </SurfaceCard>
  );
}

// ---------------------------------------------------------------------------
// Identity step.
// ---------------------------------------------------------------------------

type SecondPartIdentityFieldsProps = {
  userId: string | null;
  /** The second part's own art window (split's other half, aftermath's
   *  sideways window — TODO 3b.13), else the front's: the positioner's
   *  surface. */
  artWindow: ArtWindow;
  /** The Adventure frame: the spell shares the creature's art — no art box
   *  and no artist credit, as before. */
  isAdventureFrame: boolean;
  /** False where the frame gives the part no picture of its own and still
   *  offers the box (a flip card): one line says the picture is not drawn. */
  ownArt: boolean;
  partWords: SecondPartWords;
  /** What "Clear" leaves behind: a blank part typed for the card's kind
   *  (a split half is an instant, not a creature — TODO 3b.8). */
  blankSecondFace?: BackFaceFormValues;
  /** Shown between the type line and the artwork, where the first part's
   *  tab shows the card's printed-pieces switches (the crown is the
   *  card's). */
  afterTypeLine?: React.ReactNode;
};

/** The second part's name, card type, type line, artwork and artist — the
 *  Identity step's fields, in the first part's order. */
export function SecondPartIdentityFields({
  userId,
  artWindow,
  isAdventureFrame,
  ownArt,
  partWords,
  blankSecondFace = EMPTY_BACK_FACE,
  afterTypeLine,
}: SecondPartIdentityFieldsProps) {
  const {
    register,
    control,
    setValue,
    formState: { errors },
  } = useFormContext<FormValues>();

  return (
    <>
      <FieldGroup
        label="Title"
        showFace
        helper={
          isAdventureFrame
            ? `The adventure spell's name (shown on the left page). ${SECOND_FACE_NAME_HINT}`
            : `The name printed on ${partWords.phrase}. ${SECOND_FACE_NAME_HINT}`
        }
        error={errors.back_face?.title?.message}
      >
        {/* Required-ness is enforced by the form resolver
            (lib/creator/form-schema.ts, gated on has_back_face and the
            draft policy in lib/cards/second-face-name.ts) — register-level
            rules are ignored once a resolver is set. */}
        <input
          {...register("back_face.title")}
          placeholder={partWords.namePlaceholder}
          className={inputClass(Boolean(errors.back_face?.title))}
          autoComplete="off"
        />
      </FieldGroup>

      {/* The part's card type: the nine chips, full width (beside another
          field their labels ran into each other — TODO 5.14). */}
      <FieldGroup kind="group" label="Card type" error={errors.back_face?.card_type?.message}>
        <Controller
          control={control}
          name="back_face.card_type"
          render={({ field }) => (
            <ChipGroup
              ariaLabel={secondPartFieldName(partWords, "card type")}
              layout="grid-3"
              value={field.value}
              onChange={(next) => field.onChange(next)}
              options={CARD_TYPE_OPTIONS}
            />
          )}
        />
      </FieldGroup>

      <div className="grid gap-4 sm:grid-cols-2" data-testid="second-part-type-line-fields">
        <TypesField face="back" />
        <FieldGroup
          label="Subtypes"
          helper="Comma-separated."
          error={errors.back_face?.subtypes_text?.message}
        >
          <input
            {...register("back_face.subtypes_text")}
            placeholder="Human, Wizard"
            className={inputClass(Boolean(errors.back_face?.subtypes_text))}
            autoComplete="off"
          />
        </FieldGroup>
      </div>

      {afterTypeLine}

      {/* Art and its artist are the first part's on an adventure — the
          spell shares the creature's picture (the renderer draws none). */}
      {!isAdventureFrame ? (
        <>
          {/* The uploader's own heading names the part (no second label). */}
          <div className="flex flex-col gap-1.5" data-testid="second-part-artwork">
            <Controller
              control={control}
              name="back_face.art_url"
              render={({ field: artUrlField }) => (
                <Controller
                  control={control}
                  name="back_face.art_position"
                  render={({ field: artPosField }) => (
                    <ArtUploader
                      userId={userId}
                      artUrl={artUrlField.value}
                      artPosition={artPosField.value}
                      artWindow={artWindow}
                      fieldAnchor="back_face.art_url"
                      heading={`${partWords.second} — Artwork`}
                      primaryPasteTarget={false}
                      actionSlot={
                        // TODO 1.15: a real printing's art on this part
                        // only (its art, position and artist credit).
                        <RealCardArtButton target="back" signedIn={Boolean(userId)} />
                      }
                      onArtChange={({ artUrl, artPosition }) => {
                        // Controller onChange is the single write path —
                        // it updates the value AND dirties the field.
                        artUrlField.onChange(artUrl ?? "");
                        artPosField.onChange(artPosition);
                      }}
                    />
                  )}
                />
              )}
            />
            {errors.back_face?.art_url?.message ? (
              <p role="alert" className="text-xs text-danger">
                {errors.back_face.art_url.message}
              </p>
            ) : null}
            {!ownArt ? (
              <p className="text-xs leading-5 text-muted" data-testid="second-part-art-not-drawn">
                {secondPartArtNotDrawnNote(partWords)}
              </p>
            ) : null}
          </div>

          <MoreOptions
            summary="More options — artist credit"
            openWhen={Boolean(errors.back_face?.artist_credit)}
          >
            <FieldGroup
              label="Artist credit"
              helper={`Who made ${partWords.phrase}'s artwork?`}
              error={errors.back_face?.artist_credit?.message}
            >
              <input
                {...register("back_face.artist_credit")}
                placeholder="Anya Vale"
                className={inputClass(false)}
                autoComplete="off"
              />
            </FieldGroup>
          </MoreOptions>
        </>
      ) : null}

      <div className="flex justify-end">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            // The frame paints this part no matter what: the action is
            // "clear the content", never "remove the part" (the form keeps
            // has_back_face on for these frames).
            setValue("back_face", blankSecondFace, { shouldDirty: true });
          }}
        >
          {`Clear ${partWords.phrase}`}
        </Button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Text & stats step.
// ---------------------------------------------------------------------------

export function SecondPartCostField() {
  const {
    control,
    formState: { errors },
  } = useFormContext<FormValues>();
  return (
    // A set of controls (the cost picker): a named group, never a <label>.
    <FieldGroup kind="group" label="Cost" error={errors.back_face?.cost?.message}>
      <Controller
        control={control}
        name="back_face.cost"
        render={({ field }) => <ManaCostPicker value={field.value ?? ""} onChange={field.onChange} />}
      />
    </FieldGroup>
  );
}

export function SecondPartRulesField({
  partWords,
  backRulesTextRef,
  onInsertSymbol,
}: {
  partWords: SecondPartWords;
  /** Hoisted register("back_face.rules_text") — merged with the caret ref. */
  backRulesTextRef: React.MutableRefObject<PipTextEditorHandle | null>;
  /** Caret-preserving symbol insertion into back_face.rules_text. */
  onInsertSymbol: (token: string) => void;
}) {
  const {
    control,
    formState: { errors },
  } = useFormContext<FormValues>();
  const { field: backRulesField } = useController({ control, name: "back_face.rules_text" });
  return (
    <FieldGroup kind="group" label="Rules text" error={errors.back_face?.rules_text?.message}>
      <div className="flex flex-col gap-2">
        <RulesSymbolToolbar onInsert={onInsertSymbol} />
        <PipTextEditor
          ref={(handle) => {
            backRulesTextRef.current = handle;
            backRulesField.ref(handle);
          }}
          name={backRulesField.name}
          value={backRulesField.value ?? ""}
          onChange={backRulesField.onChange}
          onBlur={backRulesField.onBlur}
          aria-label={secondPartFieldName(partWords, "rules text")}
          placeholder={partWords.rulesPlaceholder}
          rows={4}
          className={textareaClass(false)}
        />
      </div>
    </FieldGroup>
  );
}

export function SecondPartFlavorField() {
  const {
    register,
    formState: { errors },
  } = useFormContext<FormValues>();
  return (
    <FieldGroup label="Flavor text" error={errors.back_face?.flavor_text?.message}>
      <textarea
        {...register("back_face.flavor_text")}
        placeholder="Optional."
        rows={2}
        className={textareaClass(false)}
      />
    </FieldGroup>
  );
}

/** The second part's four stat inputs — all of them, whatever its type, as
 *  before (a stored card may hold any of them; which to hide is the owner's
 *  decision per field, TODO 5.14 item 7). */
export function SecondPartStatsFields() {
  const { register } = useFormContext<FormValues>();
  return (
    <div className="grid gap-4 sm:grid-cols-4">
      <FieldGroup label="Power">
        <input {...register("back_face.power")} placeholder="3" className={inputClass(false)} autoComplete="off" />
      </FieldGroup>
      <FieldGroup label="Toughness">
        <input {...register("back_face.toughness")} placeholder="2" className={inputClass(false)} autoComplete="off" />
      </FieldGroup>
      <FieldGroup label="Loyalty">
        <input {...register("back_face.loyalty")} placeholder="—" className={inputClass(false)} autoComplete="off" />
      </FieldGroup>
      <FieldGroup label="Defense">
        <input {...register("back_face.defense")} placeholder="—" className={inputClass(false)} autoComplete="off" />
      </FieldGroup>
      {/* A split or aftermath half has no P/T slot: say so once a number
          is typed (this row isn't gated on the type). */}
      <PtNotDrawnNote face="second" onlyWithValue className="sm:col-span-4" />
    </div>
  );
}
