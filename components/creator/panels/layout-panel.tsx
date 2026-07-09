"use client";

// Layout (Adventure / Back face) panel — the empty-state toggle card plus the
// full back-face (or adventure-spell) field set. Renamed wholesale from the
// old extra step; the back-face rules textarea's caret-preserving symbol
// insertion stays in the orchestrator (shared logic with the Text panel) and
// arrives as the hoisted registration + ref + insert callback.

import {
  Controller,
  useFormContext,
  type UseFormRegisterReturn,
} from "react-hook-form";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SurfaceCard } from "@/components/ui/surface-card";
import { ChipGroup } from "@/components/ui/chip-group";
import { ManaCostPicker } from "@/components/cards/mana-cost-picker";
import { RulesSymbolToolbar } from "@/components/creator/rules-symbol-toolbar";
import { ArtUploader } from "@/components/creator/art-uploader";
import {
  CARD_TYPE_OPTIONS,
  FieldGroup,
  inputClass,
  textareaClass,
} from "@/components/creator/field-group";
import {
  EMPTY_BACK_FACE,
  type FormValues,
} from "@/lib/creator/form-types";

type LayoutPanelProps = {
  userId: string | null;
  /** Live has_back_face flag from the form. */
  hasBackFace: boolean;
  /** True when the Adventure frame repurposes this content as the inline
   *  adventure spell (copy + which fields show flip accordingly). */
  isAdventureFrame: boolean;
  /** Hoisted register("back_face.rules_text") — merged with the caret ref. */
  backRulesTextField: UseFormRegisterReturn<"back_face.rules_text">;
  backRulesTextRef: React.MutableRefObject<HTMLTextAreaElement | null>;
  /** Caret-preserving symbol insertion into back_face.rules_text. */
  onInsertSymbol: (token: string) => void;
  /** Called after the user enables a back face — lets the preview flip to it. */
  onBackFaceAdded?: () => void;
};

export function LayoutPanel({
  userId,
  hasBackFace,
  isAdventureFrame,
  backRulesTextField,
  backRulesTextRef,
  onInsertSymbol,
  onBackFaceAdded,
}: LayoutPanelProps) {
  const {
    register,
    control,
    setValue,
    formState: { errors },
  } = useFormContext<FormValues>();

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
                This card only has a front face. Add a back face to make it
                a double-faced card (DFC). The back face shares the
                card&apos;s rarity, color identity, and frame style — only
                the text and art differ.
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
            {isAdventureFrame ? "Add the adventure" : "Add a back face"}
          </Button>
        </SurfaceCard>
      ) : (
        <>
          <FieldGroup
            label={isAdventureFrame ? "Adventure name" : "Title"}
            helper={
              isAdventureFrame
                ? "The adventure spell's name (shown on the left page)."
                : "The back-face title. Required when a back face is enabled."
            }
            error={errors.back_face?.title?.message}
          >
            {/* Required-ness is enforced by the form resolver
                (lib/creator/form-schema.ts, gated on has_back_face) —
                register-level rules are ignored once a resolver is set. */}
            <input
              {...register("back_face.title")}
              placeholder={isAdventureFrame ? "Stomp" : "Insectile Aberration"}
              className={inputClass(Boolean(errors.back_face?.title))}
              autoComplete="off"
            />
          </FieldGroup>

          <div className="grid gap-4 sm:grid-cols-2">
            <FieldGroup label="Cost">
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

            <FieldGroup label="Card type">
              <Controller
                control={control}
                name="back_face.card_type"
                render={({ field }) => (
                  <ChipGroup
                    ariaLabel="Back-face card type"
                    layout="grid-3"
                    value={field.value}
                    onChange={(next) => field.onChange(next)}
                    options={CARD_TYPE_OPTIONS}
                  />
                )}
              />
            </FieldGroup>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <FieldGroup label="Supertype">
              <input
                {...register("back_face.supertype")}
                placeholder="Legendary"
                className={inputClass(false)}
                autoComplete="off"
              />
            </FieldGroup>
            <FieldGroup label="Subtypes" helper="Comma-separated.">
              <input
                {...register("back_face.subtypes_text")}
                placeholder="Human, Wizard"
                className={inputClass(false)}
                autoComplete="off"
              />
            </FieldGroup>
          </div>

          <FieldGroup label="Rules text">
            <div className="flex flex-col gap-2">
              <RulesSymbolToolbar onInsert={onInsertSymbol} />
              <textarea
                {...backRulesTextField}
                ref={(el) => {
                  backRulesTextField.ref(el);
                  backRulesTextRef.current = el;
                }}
                placeholder={
                  isAdventureFrame
                    ? "Stomp deals 2 damage to any target. (The adventure's rules.)"
                    : "Flying. Whenever the back face deals damage…"
                }
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
                        primaryPasteTarget={false}
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
                setValue("back_face", EMPTY_BACK_FACE, {
                  shouldDirty: true,
                });
              }}
            >
              {isAdventureFrame ? "Clear adventure" : "Clear second face"}
            </Button>
          </div>
        </>
      )}
    </>
  );
}
