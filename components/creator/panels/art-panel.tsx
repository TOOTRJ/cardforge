"use client";

// Art panel — the uploader/positioner plus the artist-credit "more options"
// collapsible. Moved unchanged from the old art step.

import { Controller, useFormContext, useWatch } from "react-hook-form";
import { ArtUploader } from "@/components/creator/art-uploader";
import {
  ImportedArtNote,
  type ImportedArtOrigin,
} from "@/components/creator/import/imported-art-note";
import {
  FieldGroup,
  MoreOptions,
  inputClass,
} from "@/components/creator/field-group";
import type { FormValues } from "@/lib/creator/form-types";

type ArtPanelProps = {
  userId: string | null;
  /** The back-face editor, rendered inside this panel's "More options" (the
   *  back face used to be its own step). Supplied by the orchestrator so its
   *  caret refs / symbol insertion stay there. */
  backFaceSlot?: React.ReactNode;
  /** The "Generate AI artwork and title" button, beside Choose file. */
  aiSlot?: React.ReactNode;
  /** True while the save needs the second face's name and it is empty (the
   *  Save hint asks for it): "More options" opens so the field is visible
   *  (TODO 3b.5). */
  secondFaceNameMissing?: boolean;
  /** Art a Scryfall import brought in (TODO 1.18): while it is still the
   *  card's art, a note says Scryfall's crop stops at the printed frame. */
  importedArtOrigin?: ImportedArtOrigin | null;
};

export function ArtPanel({
  userId,
  backFaceSlot,
  aiSlot,
  secondFaceNameMissing = false,
  importedArtOrigin = null,
}: ArtPanelProps) {
  const {
    register,
    control,
    formState: { errors },
  } = useFormContext<FormValues>();
  const [artUrl, template] = useWatch({
    control,
    name: ["art_url", "frame_style.template"],
  });

  return (
    <>
      <Controller
        control={control}
        name="art_url"
        render={({ field: artUrlField }) => (
          <Controller
            control={control}
            name="art_position"
            render={({ field: artPosField }) => (
              <ArtUploader
                userId={userId}
                artUrl={artUrlField.value}
                artPosition={artPosField.value}
                onArtChange={({ artUrl, artPosition }) => {
                  // Controller onChange is the single write path — it updates
                  // the value AND dirties the field. A second setValue on the
                  // same fields raced it under React batching.
                  artUrlField.onChange(artUrl ?? "");
                  artPosField.onChange(artPosition);
                }}
                actionSlot={aiSlot}
              />
            )}
          />
        )}
      />
      {errors.art_url?.message ? (
        <p role="alert" className="text-xs text-danger">
          {errors.art_url.message}
        </p>
      ) : null}
      <ImportedArtNote origin={importedArtOrigin} artUrl={artUrl} template={template} />

      <MoreOptions
        summary={
          backFaceSlot
            ? "More options — artist credit & second face"
            : "More options — artist credit"
        }
        openWhen={Boolean(errors.artist_credit || (backFaceSlot && errors.back_face))}
        expandWhen={Boolean(backFaceSlot && secondFaceNameMissing)}
      >
        <FieldGroup
          label="Artist credit"
          helper="Who made the artwork? Yourself, a public-domain artist, or a licensed source."
          error={errors.artist_credit?.message}
        >
          <input
            {...register("artist_credit")}
            placeholder="Anya Vale"
            className={inputClass(Boolean(errors.artist_credit))}
            autoComplete="off"
          />
        </FieldGroup>
        {backFaceSlot}
      </MoreOptions>
    </>
  );
}
