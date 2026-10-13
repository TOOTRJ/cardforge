"use client";

// Layout (Adventure / Back face) panel — the empty-state toggle card plus the
// full back-face (or adventure-spell) field set. Renamed wholesale from the
// old extra step; the back-face rules box is a PipTextEditor (pips drawn in
// place of brace codes) whose handle ref + symbol insertion the orchestrator
// owns, shared with the Text panel's toolbar.

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

type LayoutPanelProps = {
  userId: string | null;
  /** The second face's own art window (split's other half, aftermath's
   *  sideways window — TODO 3b.13): the positioner's surface. */
  artWindow: ArtWindow;
  /** Live has_back_face flag from the form. */
  hasBackFace: boolean;
  /** True when the Adventure frame repurposes this content as the inline
   *  adventure spell (which fields show flips accordingly). */
  isAdventureFrame: boolean;
  /** The kind's own words for this second part — "Right half", "Aftermath
   *  half", "Adventure spell", "Flipped side" (lib/creator/second-part.ts):
   *  every label, placeholder and accessible name here reads them, so a
   *  split half is never announced as a "back face" (TODO 5.14). */
  partWords: SecondPartWords;
  /** Hoisted register("back_face.rules_text") — merged with the caret ref. */
  backRulesTextRef: React.MutableRefObject<PipTextEditorHandle | null>;
  /** Caret-preserving symbol insertion into back_face.rules_text. */
  onInsertSymbol: (token: string) => void;
  /** Called after the user enables a back face — lets the preview flip to it. */
  onBackFaceAdded?: () => void;
  /** What "Clear" leaves behind: a blank face typed for the card's kind
   *  (a split half is an instant, not a creature — TODO 3b.8). */
  blankSecondFace?: BackFaceFormValues;
};

export function LayoutPanel({
  userId,
  artWindow,
  hasBackFace,
  isAdventureFrame,
  partWords,
  backRulesTextRef,
  onInsertSymbol,
  onBackFaceAdded,
  blankSecondFace = EMPTY_BACK_FACE,
}: LayoutPanelProps) {
  const {
    register,
    control,
    setValue,
    formState: { errors },
  } = useFormContext<FormValues>();
  const { field: backRulesField } = useController({
    control,
    name: "back_face.rules_text",
  });

  return (
    <>
      {!hasBackFace ? (
        <SurfaceCard className="flex flex-col items-center gap-3 border-dashed bg-elevated/40 p-8 text-center">
          <p className="text-sm leading-6 text-muted">
            {isAdventureFrame ? (
              <>
                The Adventure frame splits the lower card into a storybook:
                this content becomes the <strong>adventure spell</strong> on
                the left page, shown alongside the creature&apos;s rules — no
                flip. Add it to fill the adventure.
              </>
            ) : (
              <>
                This frame paints {partWords.phrase} on the same card. Add
                it to give it a name, a cost and rules of its own — it
                shares the card&apos;s rarity and frame.
              </>
            )}
          </p>
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={() => {
              setValue("has_back_face", true, { shouldDirty: true });
              onBackFaceAdded?.();
            }}
          >
            <Sparkles className="h-4 w-4" aria-hidden />
            {`Add ${partWords.phrase}`}
          </Button>
        </SurfaceCard>
      ) : (
        <>
          <FieldGroup
            label={secondPartFieldName(partWords, "name")}
            helper={
              isAdventureFrame
                ? `The adventure spell's name (shown on the left page). ${SECOND_FACE_NAME_HINT}`
                : `The name printed on ${partWords.phrase}. ${SECOND_FACE_NAME_HINT}`
            }
            error={errors.back_face?.title?.message}
          >
            {/* Required-ness is enforced by the form resolver
                (lib/creator/form-schema.ts, gated on has_back_face and the
                draft policy in lib/cards/second-face-name.ts) —
                register-level rules are ignored once a resolver is set. */}
            <input
              {...register("back_face.title")}
              placeholder={partWords.namePlaceholder}
              className={inputClass(Boolean(errors.back_face?.title))}
              autoComplete="off"
            />
          </FieldGroup>

          <FieldGroup kind="group" label="Cost">
            <Controller
              control={control}
              name="back_face.cost"
              render={({ field }) => (
                <ManaCostPicker
                  value={field.value ?? ""}
                  onChange={field.onChange}
                />
              )}
            />
          </FieldGroup>

          {/* The type chips take the panel's full width: beside the cost,
              in half of it, the nine labels ran into each other
              ("PlaneswalkerBattle", TODO 5.14). */}
          <FieldGroup kind="group" label="Card type">
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

          <div className="grid gap-4 sm:grid-cols-2">
            <TypesField face="back" />
            <FieldGroup label="Subtypes" helper="Comma-separated.">
              <input
                {...register("back_face.subtypes_text")}
                placeholder="Human, Wizard"
                className={inputClass(false)}
                autoComplete="off"
              />
            </FieldGroup>
          </div>

          <FieldGroup kind="group" label="Rules text">
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

          {/* Flavor, P/T, and art are front/DFC-only — an adventure spell
              is an instant/sorcery that shares the creature's art, so the
              Adventure tab hides them (the renderer ignores them anyway). */}
          {!isAdventureFrame ? (
            <>
              <FieldGroup label="Flavor text">
                <textarea
                  {...register("back_face.flavor_text")}
                  placeholder="Optional."
                  rows={2}
                  className={textareaClass(false)}
                />
              </FieldGroup>

              <div className="grid gap-4 sm:grid-cols-4">
                <FieldGroup label="Power">
                  <input
                    {...register("back_face.power")}
                    placeholder="3"
                    className={inputClass(false)}
                    autoComplete="off"
                  />
                </FieldGroup>
                <FieldGroup label="Toughness">
                  <input
                    {...register("back_face.toughness")}
                    placeholder="2"
                    className={inputClass(false)}
                    autoComplete="off"
                  />
                </FieldGroup>
                <FieldGroup label="Loyalty">
                  <input
                    {...register("back_face.loyalty")}
                    placeholder="—"
                    className={inputClass(false)}
                    autoComplete="off"
                  />
                </FieldGroup>
                <FieldGroup label="Defense">
                  <input
                    {...register("back_face.defense")}
                    placeholder="—"
                    className={inputClass(false)}
                    autoComplete="off"
                  />
                </FieldGroup>
                {/* A split or aftermath half has no P/T slot: say so once
                    a number is typed (this row isn't gated on the type). */}
                <PtNotDrawnNote face="second" onlyWithValue className="sm:col-span-4" />
              </div>

              <FieldGroup label="Artist credit">
                <input
                  {...register("back_face.artist_credit")}
                  placeholder="Anya Vale"
                  className={inputClass(false)}
                  autoComplete="off"
                />
              </FieldGroup>

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
                        primaryPasteTarget={false}
                        actionSlot={
                          // TODO 1.15: a real printing's art on this face
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
            </>
          ) : null}

          <div className="flex justify-end">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                // This panel only mounts for frames whose second face is
                // intrinsic (Adventure page, flip/split/aftermath half) —
                // the frame paints that face no matter what, so the action
                // is "clear the content", not "remove the face". Disabling
                // has_back_face here just produced cards with a blank
                // painted half (the orchestrator now force-enables it).
                setValue("back_face", blankSecondFace, {
                  shouldDirty: true,
                });
              }}
            >
              {`Clear ${partWords.phrase}`}
            </Button>
          </div>
        </>
      )}
    </>
  );
}
