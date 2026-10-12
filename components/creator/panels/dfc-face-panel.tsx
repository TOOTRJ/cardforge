"use client";

// The back face of a double-faced card (TODO 5.2; design 2026-10-02 §4) —
// its own SurfaceCard on the Identity step, under the front's art block,
// modelled on panels/layout-panel.tsx (the inline second face's editor)
// with what a whole face of its own adds: its TYPE (the body follows it —
// the land back for a land), its COLOUR (the back's own body's verified
// keys; colourless only with "Artifact" on its type line, design D2), and
// no cost on a transform back (the print has none; a modal back keeps its
// own). Title, supertype / subtypes, rules (PipTextEditor + the shared
// symbol toolbar), flavour, P/T (gated on the back's type), artist and the
// art uploader — the same staged upload every art goes through
// (prepareUploadBytes, checkUploadRateLimit, the 0127 rule) — with "Use art
// from a real card" on this face (TODO 1.15).
//
// The face is intrinsic to the kind: "Clear" empties the content and never
// removes the face (the orchestrator forces has_back_face on). Focusing
// anything in here flips the live preview to the back (onFocus). In REVISE
// mode the back's type AND colour are locked (the type decides the body,
// the colour its master — structure like the front's; owner 2026-10-05:
// the gate refuses a changed colour, lib/cards/dfc-gate.ts
// DFC_BACK_COLOR_SET) and the transform family chips move here from the
// absent Card step: a family change is an edit's `frame_anatomy.dfcIcon` —
// the ONE look change an edit may make — which the server re-derives the
// back body from.

import { Controller, useController, useFormContext, useWatch } from "react-hook-form";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SurfaceCard } from "@/components/ui/surface-card";
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
  inputClass,
  textareaClass,
} from "@/components/creator/field-group";
import { ColorSection, colorSummaryOf } from "@/components/creator/panels/color-section";
import { DfcIconFamilySection } from "@/components/creator/panels/dfc-setup-sections";
import { parseSubtypes } from "@/lib/creator/card-fields";
import { statVisibility } from "@/lib/creator/steps";
import { PtNotDrawnNote } from "@/components/creator/pt-not-drawn-note";
import { SECOND_FACE_NAME_HINT } from "@/lib/cards/second-face-name";
import { DFC_FACE_TYPES, colorlessFaceAllowed, type DfcIconFamily, type DfcLayout } from "@/lib/cards/dfc";
import { DFC_COLORLESS_NEEDS_ARTIFACT } from "@/lib/cards/dfc-gate";
import {
  EMPTY_BACK_FACE,
  type BackFaceFormValues,
  type FormValues,
} from "@/lib/creator/form-types";
import { FRAME_TEMPLATE_LABELS, type CardType, type ColorIdentity, type FrameTemplate } from "@/types/card";

const BACK_TYPE_OPTIONS: ChipOption<CardType>[] = CARD_TYPE_OPTIONS.filter((option) =>
  (DFC_FACE_TYPES as readonly string[]).includes(option.value),
);

type DfcFacePanelProps = {
  userId: string | null;
  layout: DfcLayout;
  /** The back BODY the form's back type and the card's family derive
   *  (lib/cards/dfc.ts bodyFor) — what the colour chips dress; null while
   *  the kind has no bodies (none since 5.1b's modal pair). */
  backBody: FrameTemplate | null;
  /** The front's colour: the back's default until it picks its own. */
  frontColorIdentity: ColorIdentity[];
  verifiedFrameKeys: ReadonlySet<string>;
  /** Edit / remix: the back's type and colour are locked (read-only rows);
   *  the family chips show here. */
  revise?: boolean;
  /** The card's transform family (frame_style.dfcIcon) and its setter, for
   *  the revise-mode chips. */
  family?: DfcIconFamily | string | null;
  onFamilyChange?: (next: DfcIconFamily) => void;
  /** Hoisted register("back_face.rules_text") — merged with the caret ref. */
  backRulesTextRef: React.MutableRefObject<PipTextEditorHandle | null>;
  /** Caret-preserving symbol insertion into back_face.rules_text. */
  onInsertSymbol: (token: string) => void;
  /** Anything in the panel took focus — the live preview flips to the back. */
  onFocus?: () => void;
  /** What "Clear" leaves behind: a blank face typed for the kind. */
  blankBackFace?: BackFaceFormValues;
};

/** A server error on a key the form has no field for (back_face.frame_style)
 *  — RHF stores it under the path all the same. */
function backFaceErrorMessage(errors: unknown, key: string): string | undefined {
  const back = (errors as { back_face?: Record<string, { message?: string } | undefined> } | undefined)?.back_face;
  return back?.[key]?.message;
}

export function DfcFacePanel({
  userId,
  layout,
  backBody,
  frontColorIdentity,
  verifiedFrameKeys,
  revise = false,
  family = null,
  onFamilyChange,
  backRulesTextRef,
  onInsertSymbol,
  onFocus,
  blankBackFace = EMPTY_BACK_FACE,
}: DfcFacePanelProps) {
  const {
    register,
    control,
    setValue,
    getValues,
    clearErrors,
    formState: { errors },
  } = useFormContext<FormValues>();
  const { field: backRulesField } = useController({
    control,
    name: "back_face.rules_text",
  });
  const [backType, backSupertype, backSubtypes, backColour] = useWatch({
    control,
    name: ["back_face.card_type", "back_face.supertype", "back_face.subtypes_text", "back_face.color_identity"],
  });
  const colour = (backColour ?? []).length > 0 ? (backColour as ColorIdentity[]) : frontColorIdentity;
  const ownColour = (backColour ?? []).length > 0;
  const statVis = statVisibility(backType, parseSubtypes(backSubtypes ?? ""), backSupertype);
  const typeLabel = BACK_TYPE_OPTIONS.find((option) => option.value === backType)?.label ?? "Creature";
  const frameError =
    backFaceErrorMessage(errors, "frame_style") ??
    backFaceErrorMessage(errors, "card_type") ??
    backFaceErrorMessage(errors, "color_identity");
  const colourlessRefused =
    backBody !== null &&
    !colorlessFaceAllowed(backBody, { cardType: backType, supertype: backSupertype });

  return (
    <SurfaceCard
      className="flex flex-col gap-4 p-5"
      data-testid="dfc-face-panel"
      onFocusCapture={() => onFocus?.()}
    >
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold text-foreground">Back face</h3>
        <p className="text-xs leading-5 text-muted">
          {layout === "transform"
            ? "The face the card transforms into. It has its own type, colour, text and art; the card's rarity, set symbol and collector line print on both faces."
            : "The card's other mode. It has its own type, colour, cost, text and art; the card's rarity, set symbol and collector line print on both faces."}
          {backBody ? ` Frame: ${FRAME_TEMPLATE_LABELS[backBody]}.` : ""}
        </p>
      </div>

      {frameError ? (
        <p
          role="alert"
          className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-foreground"
          data-testid="dfc-back-error"
        >
          {frameError}
        </p>
      ) : null}

      {/* The back's TYPE: the body follows it (a land back wears the land
          back). Locked in revise mode, like the front's type line — and
          the back's COLOUR with it (owner 2026-10-05: a colour change would
          move the back onto another master; the gate refuses one). */}
      {revise ? (
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
      ) : (
        <FieldGroup label="Back face type" error={backFaceErrorMessage(errors, "card_type")}>
          <Controller
            control={control}
            name="back_face.card_type"
            render={({ field }) => (
              <ChipGroup
                ariaLabel="Back face type"
                layout="grid-3"
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
        </FieldGroup>
      )}

      {/* The transform family, where the Card step isn't (revise). */}
      {revise && layout === "transform" && onFamilyChange ? (
        <DfcIconFamilySection family={family} onChange={onFamilyChange} testId="dfc-icon-family-revise" />
      ) : null}

      {/* The back's COLOUR: its own body's verified keys — on a new card;
          a saved card shows it read-only above. */}
      {!revise && backBody ? (
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
      ) : null}

      <FieldGroup
        label="Title"
        helper={`The back face's name. ${SECOND_FACE_NAME_HINT}`}
        error={errors.back_face?.title?.message}
      >
        <input
          {...register("back_face.title")}
          placeholder={layout === "transform" ? "Insectile Aberration" : "Emeria's Call"}
          className={inputClass(Boolean(errors.back_face?.title))}
          autoComplete="off"
        />
      </FieldGroup>

      <div className="grid gap-4 sm:grid-cols-2">
        {/* A transform back prints no mana cost — the save strips one; a
            modal back carries its own. */}
        {layout === "modal" ? (
          <FieldGroup label="Cost" error={errors.back_face?.cost?.message}>
            <Controller
              control={control}
              name="back_face.cost"
              render={({ field }) => (
                <ManaCostPicker value={field.value ?? ""} onChange={field.onChange} />
              )}
            />
          </FieldGroup>
        ) : null}
        <FieldGroup label="Supertype" error={errors.back_face?.supertype?.message}>
          <input
            {...register("back_face.supertype")}
            placeholder="Legendary"
            className={inputClass(Boolean(errors.back_face?.supertype))}
            autoComplete="off"
          />
        </FieldGroup>
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

      <FieldGroup label="Rules text" error={errors.back_face?.rules_text?.message}>
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
            placeholder={
              layout === "transform"
                ? "Flying. Whenever the back face deals damage…"
                : "{T}: Add {W}. (The other mode's rules.)"
            }
            rows={4}
            className={textareaClass(false)}
          />
        </div>
      </FieldGroup>

      <FieldGroup label="Flavor text" error={errors.back_face?.flavor_text?.message}>
        <textarea
          {...register("back_face.flavor_text")}
          placeholder="Optional."
          rows={2}
          className={textareaClass(false)}
        />
      </FieldGroup>

      {statVis.pt ? (
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
      ) : null}

      <FieldGroup label="Artist credit" error={errors.back_face?.artist_credit?.message}>
        <input
          {...register("back_face.artist_credit")}
          placeholder="Anya Vale"
          className={inputClass(false)}
          autoComplete="off"
        />
      </FieldGroup>

      <FieldGroup label="Back face artwork" error={errors.back_face?.art_url?.message}>
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
                  actionSlot={
                    // A real printing's art on this face only (TODO 1.15).
                    <RealCardArtButton
                      target="back"
                      signedIn={Boolean(userId)}
                      onApplied={() => onFocus?.()}
                    />
                  }
                  onArtChange={({ artUrl, artPosition }) => {
                    // Controller onChange is the single write path — it
                    // updates the value AND dirties the field.
                    artUrlField.onChange(artUrl ?? "");
                    artPosField.onChange(artPosition);
                    onFocus?.();
                  }}
                />
              )}
            />
          )}
        />
      </FieldGroup>

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
    </SurfaceCard>
  );
}
