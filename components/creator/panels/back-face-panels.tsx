"use client";

// The back face of a double-faced card, per step (TODO 5.2 → 5.14 Face
// tabs, owner round 46). Until 5.14 the whole back was ONE panel at the
// bottom of the Identity step (`DfcFacePanel`); with the Front face | Back
// face switch each of its fields sits on the step its front twin sits on,
// in the same order, shown while the Back tab is selected:
//
//   Card step       BackFaceTypeSection, BackFaceColorSection (a new card)
//   Identity step   BackFaceLockedRows (an edit / remix: the Card step is
//                   absent), BackFaceIdentityFields — name, Types,
//                   Subtypes, artwork + positioner, artist credit
//   Text & stats    BackFaceCostField (a modal back; a transform back has
//                   none), BackFaceRulesField, BackFaceFlavorField,
//                   BackFaceStatsFields
//
// Every field writes the SAME form path as before (`back_face.*`) with the
// same controls — nothing about what is stored, sent or drawn changes; the
// fields only moved. The back's rules are unchanged: its TYPE decides the
// body (a land back wears the land back), its COLOUR is its own body's
// verified keys (colourless only with "Artifact" on its type line, design
// D2) and follows the front until picked; a transform back has no cost; in
// REVISE mode the type and colour are locked (owner 2026-10-05: the gate
// refuses a changed colour, lib/cards/dfc-gate.ts DFC_BACK_COLOR_SET).
// "Clear back face" empties the content and never removes the face.

import { TypesField } from "@/components/creator/types-field";
import { Controller, useController, useFormContext, useWatch } from "react-hook-form";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChipGroup, type ChipOption } from "@/components/ui/chip-group";
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
import { ColorSection, colorSummaryOf } from "@/components/creator/panels/color-section";
import { SetupSection } from "@/components/creator/panels/setup-section";
import { parseSubtypes } from "@/lib/creator/card-fields";
import { statVisibility } from "@/lib/creator/steps";
import { PtNotDrawnNote } from "@/components/creator/pt-not-drawn-note";
import { SECOND_FACE_NAME_HINT } from "@/lib/cards/second-face-name";
import type { ArtWindow } from "@/lib/cards/art-positioner-window";
import { DFC_FACE_TYPES, colorlessFaceAllowed, type DfcLayout } from "@/lib/cards/dfc";
import { DFC_COLORLESS_NEEDS_ARTIFACT } from "@/lib/cards/dfc-gate";
import {
  EMPTY_BACK_FACE,
  type BackFaceFormValues,
  type FormValues,
} from "@/lib/creator/form-types";
import { SECOND_PART_WORDS } from "@/lib/creator/second-part";
import { FRAME_TEMPLATE_LABELS, type CardType, type ColorIdentity, type FrameTemplate } from "@/types/card";

/** Under the Cost field of a modal card's LAND back (TODO 5.14). */
export const MODAL_LAND_BACK_COST_HINT =
  "A land has no mana cost — leave this empty. The front's strip then shows the land's mana ability (“{T}: Add {G}.”) instead.";

/** Where the Cost field would be on a transform card's Back tab. */
export const TRANSFORM_BACK_NO_COST_NOTE =
  "A transform card's back face has no mana cost — the card is cast as its front.";

const BACK_TYPE_OPTIONS: ChipOption<CardType>[] = CARD_TYPE_OPTIONS.filter((option) =>
  (DFC_FACE_TYPES as readonly string[]).includes(option.value),
);

const partWordsFor = (layout: DfcLayout) => SECOND_PART_WORDS[layout === "transform" ? "transform" : "mdfc"]!;

/** A server error on a key the form has no field for (back_face.frame_style)
 *  — RHF stores it under the path all the same. */
function backFaceErrorMessage(errors: unknown, key: string): string | undefined {
  const back = (errors as { back_face?: Record<string, { message?: string } | undefined> } | undefined)?.back_face;
  return back?.[key]?.message;
}

/** The server's refusal of the back's body, type or colour — shown at the
 *  top of the Back tab on the step that holds the type and colour. */
export function BackFaceFrameError() {
  const {
    formState: { errors },
  } = useFormContext<FormValues>();
  // A refusal the server keys on the whole face ("back_face": its schema
  // errors name the top-level key only — lib/auth/schemas.ts
  // fieldErrorsFromZod) has no field to stand under: said here, or it would
  // be said nowhere.
  const wholeFace = (errors as { back_face?: { message?: unknown } } | undefined)?.back_face?.message;
  const frameError =
    backFaceErrorMessage(errors, "frame_style") ??
    backFaceErrorMessage(errors, "card_type") ??
    backFaceErrorMessage(errors, "color_identity") ??
    (typeof wholeFace === "string" ? wholeFace : undefined);
  return frameError ? (
    <p
      role="alert"
      className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-foreground"
      data-testid="dfc-back-error"
    >
      {frameError}
    </p>
  ) : null;
}

// ---------------------------------------------------------------------------
// Card step (a new card): the back's type and colour — where the front's
// "Front face" row and the card's Color section are.
// ---------------------------------------------------------------------------

/** The back's TYPE: the body follows it (a land back wears the land back). */
export function BackFaceTypeSection({ layout, backBody }: { layout: DfcLayout; backBody: FrameTemplate | null }) {
  const { control, setValue, clearErrors } = useFormContext<FormValues>();
  const backType = useWatch({ control, name: "back_face.card_type" });
  const typeLabel = BACK_TYPE_OPTIONS.find((option) => option.value === backType)?.label ?? "Creature";
  return (
    <SetupSection title="Back face" value={typeLabel} testId="dfc-back-type">
      <Controller
        control={control}
        name="back_face.card_type"
        render={({ field }) => (
          <ChipGroup
            ariaLabel="Back face type"
            layout="grid-3"
            size="md"
            value={field.value}
            onChange={(next) => {
              clearErrors("back_face");
              // A TRANSFORM land back is colourless: that land back body
              // has one master under every key and is verified on `c`
              // alone (the Q3 move gives it the same), so a back
              // following a green front could never save. Leaving the
              // land type goes back to following the front. A MODAL
              // land back (5.1b) is one land tint per colour, verified
              // per colour, so it keeps following the front (or the
              // colour picked) — colourless there is the grey stand-in
              // no tick ever offers.
              if (layout === "transform" && next === "land" && field.value !== "land") {
                setValue("back_face.color_identity", ["colorless"], { shouldDirty: true });
              } else if (layout === "transform" && next !== "land" && field.value === "land") {
                setValue("back_face.color_identity", [], { shouldDirty: true });
              }
              field.onChange(next);
            }}
            options={BACK_TYPE_OPTIONS}
          />
        )}
      />
      <p className="text-[11px] leading-4 text-subtle">
        The back&apos;s type. A land back wears the land frame.
        {backBody ? ` Frame: ${FRAME_TEMPLATE_LABELS[backBody]}.` : ""}
      </p>
    </SetupSection>
  );
}

/** The back's COLOUR: its own body's verified keys; it follows the front
 *  until one is picked. */
export function BackFaceColorSection({
  backBody,
  frontColorIdentity,
  verifiedFrameKeys,
}: {
  backBody: FrameTemplate | null;
  frontColorIdentity: ColorIdentity[];
  verifiedFrameKeys: ReadonlySet<string>;
}) {
  const { control, clearErrors } = useFormContext<FormValues>();
  const [backType, backSupertype, backColour] = useWatch({
    control,
    name: ["back_face.card_type", "back_face.supertype", "back_face.color_identity"],
  });
  if (!backBody) return null;
  const ownColour = (backColour ?? []).length > 0;
  const colour = ownColour ? (backColour as ColorIdentity[]) : frontColorIdentity;
  const colourlessRefused = !colorlessFaceAllowed(backBody, { cardType: backType, supertype: backSupertype });
  return (
    <Controller
      control={control}
      name="back_face.color_identity"
      render={({ field }) => (
        <ColorSection
          title="Back face color"
          ariaLabel="Back face color"
          summary={ownColour ? colorSummaryOf(colour) : `${colorSummaryOf(colour)} · follows the front`}
          template={backBody}
          selection={colour}
          onChange={(next) => {
            clearErrors("back_face");
            field.onChange(next);
          }}
          verifiedKeys={verifiedFrameKeys}
          frameType={{ cardType: backType, supertype: backSupertype }}
          colorlessDisabledReason={colourlessRefused ? DFC_COLORLESS_NEEDS_ARTIFACT : null}
          testId="dfc-back-color"
        />
      )}
    />
  );
}

// ---------------------------------------------------------------------------
// Identity step.
// ---------------------------------------------------------------------------

/** Edit / remix: the back's type and colour, locked — the type decides the
 *  body, the colour its master (structure, like the front's). */
export function BackFaceLockedRows({ frontColorIdentity }: { frontColorIdentity: ColorIdentity[] }) {
  const { control } = useFormContext<FormValues>();
  const [backType, backColour] = useWatch({
    control,
    name: ["back_face.card_type", "back_face.color_identity"],
  });
  const colour = (backColour ?? []).length > 0 ? (backColour as ColorIdentity[]) : frontColorIdentity;
  const typeLabel = BACK_TYPE_OPTIONS.find((option) => option.value === backType)?.label ?? "Creature";
  return (
    <div className="flex flex-col gap-1.5 text-xs text-muted" data-testid="dfc-back-locked">
      <div className="flex items-center gap-2" data-testid="dfc-back-type-locked">
        <Lock className="h-3.5 w-3.5" aria-hidden />
        Back face type: <span className="font-medium text-foreground">{typeLabel}</span>
      </div>
      <div className="flex items-center gap-2" data-testid="dfc-back-color-locked">
        <Lock className="h-3.5 w-3.5" aria-hidden />
        Back face color: <span className="font-medium text-foreground">{colorSummaryOf(colour)}</span>
      </div>
      <p className="text-[11px] leading-5">
        The back&apos;s type and colour are set when the card is created, like the
        front&apos;s — to change them, forge a new card.
      </p>
    </div>
  );
}

type BackFaceIdentityFieldsProps = {
  userId: string | null;
  layout: DfcLayout;
  /** The back face's art window on its own body and colour (TODO 3b.13):
   *  the positioner's surface. */
  artWindow: ArtWindow;
  /** What "Clear" leaves behind: a blank face typed for the kind. */
  blankBackFace?: BackFaceFormValues;
  /** Shown between the type line and the artwork, where the Front face tab
   *  shows the card's printed-pieces switches: the ONE legendary crown
   *  serves both faces (a legendary back wears it too). */
  afterTypeLine?: React.ReactNode;
};

/** The back's name, type line, artwork and artist — the Identity step's
 *  fields, in the front's order. */
export function BackFaceIdentityFields({
  userId,
  layout,
  artWindow,
  blankBackFace = EMPTY_BACK_FACE,
  afterTypeLine,
}: BackFaceIdentityFieldsProps) {
  const {
    register,
    control,
    setValue,
    getValues,
    formState: { errors },
  } = useFormContext<FormValues>();
  const partWords = partWordsFor(layout);

  return (
    <>
      <FieldGroup
        label="Title"
        showFace
        helper={`The back face's name. ${SECOND_FACE_NAME_HINT}`}
        error={errors.back_face?.title?.message}
      >
        <input
          {...register("back_face.title")}
          placeholder={partWords.namePlaceholder}
          className={inputClass(Boolean(errors.back_face?.title))}
          autoComplete="off"
        />
      </FieldGroup>

      <div className="grid gap-4 sm:grid-cols-2" data-testid="back-type-line-fields">
        <TypesField face="back" />
        <FieldGroup
          label="Subtypes"
          helper="Comma-separated."
          error={errors.back_face?.subtypes_text?.message}
        >
          <input
            {...register("back_face.subtypes_text")}
            placeholder="Human, Werewolf"
            className={inputClass(Boolean(errors.back_face?.subtypes_text))}
            autoComplete="off"
          />
        </FieldGroup>
      </div>

      {afterTypeLine}

      {/* The uploader's own heading names the face (no second label). */}
      <div className="flex flex-col gap-1.5" data-testid="back-face-artwork">
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
                  heading="Back face — Artwork"
                  primaryPasteTarget={false}
                  actionSlot={
                    // A real printing's art on this face only (TODO 1.15).
                    <RealCardArtButton target="back" signedIn={Boolean(userId)} />
                  }
                  onArtChange={({ artUrl, artPosition }) => {
                    // Controller onChange is the single write path — it
                    // updates the value AND dirties the field.
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
      </div>

      <MoreOptions
        summary="More options — artist credit"
        openWhen={Boolean(errors.back_face?.artist_credit)}
      >
        <FieldGroup
          label="Artist credit"
          helper="Who made the back face's artwork?"
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

      <div className="flex justify-end">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            // The face is intrinsic to the kind: "clear the content", never
            // "remove the face" — the type and the colour (structure) stay.
            setValue(
              "back_face",
              {
                ...blankBackFace,
                card_type: getValues("back_face.card_type") || blankBackFace.card_type,
                color_identity: [...(getValues("back_face.color_identity") ?? [])],
              },
              { shouldDirty: true },
            );
          }}
        >
          Clear back face
        </Button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Text & stats step.
// ---------------------------------------------------------------------------

/** A modal back's own cost; a transform back prints none (the save strips
 *  one) and says so where the field would be. */
export function BackFaceCostField({ layout }: { layout: DfcLayout }) {
  const {
    control,
    formState: { errors },
  } = useFormContext<FormValues>();
  const backType = useWatch({ control, name: "back_face.card_type" });
  if (layout !== "modal") {
    return (
      <p className="text-xs leading-5 text-muted" data-testid="back-no-cost-note">
        {TRANSFORM_BACK_NO_COST_NOTE}
      </p>
    );
  }
  return (
    <FieldGroup
      // A set of controls (the cost picker): a named group, never a <label>.
      kind="group"
      label="Cost"
      // A land prints no mana cost. The field stays (a stored card may
      // hold one, and the front's strip draws it), but says so: left
      // empty, the strip shows the land's own mana ability instead.
      helper={backType === "land" ? MODAL_LAND_BACK_COST_HINT : undefined}
      error={errors.back_face?.cost?.message}
    >
      <Controller
        control={control}
        name="back_face.cost"
        render={({ field }) => <ManaCostPicker value={field.value ?? ""} onChange={field.onChange} />}
      />
    </FieldGroup>
  );
}

export function BackFaceRulesField({
  layout,
  backRulesTextRef,
  onInsertSymbol,
}: {
  layout: DfcLayout;
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
  const partWords = partWordsFor(layout);
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
          aria-label="Back face rules text"
          placeholder={partWords.rulesPlaceholder}
          rows={4}
          className={textareaClass(false)}
        />
      </div>
    </FieldGroup>
  );
}

export function BackFaceFlavorField() {
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

/** The back's power / toughness, while its type prints one. */
export function BackFaceStatsFields({ backBody }: { backBody: FrameTemplate | null }) {
  const {
    register,
    control,
    formState: { errors },
  } = useFormContext<FormValues>();
  const [backType, backSupertype, backSubtypes] = useWatch({
    control,
    name: ["back_face.card_type", "back_face.supertype", "back_face.subtypes_text"],
  });
  const statVis = statVisibility(backType, parseSubtypes(backSubtypes ?? ""), backSupertype);
  if (!statVis.pt) return null;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <FieldGroup label="Power" error={errors.back_face?.power?.message}>
        <input
          {...register("back_face.power")}
          placeholder="3"
          className={inputClass(false)}
          autoComplete="off"
        />
      </FieldGroup>
      <FieldGroup label="Toughness" error={errors.back_face?.toughness?.message}>
        <input
          {...register("back_face.toughness")}
          placeholder="2"
          className={inputClass(false)}
          autoComplete="off"
        />
      </FieldGroup>
      {/* A land back body has no P/T slot: say so. */}
      <PtNotDrawnNote face="second" backBody={backBody} className="sm:col-span-2" />
    </div>
  );
}
