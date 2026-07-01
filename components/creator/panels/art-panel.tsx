"use client";

// Art panel — the uploader/positioner plus the artist-credit "more options"
// collapsible. Moved unchanged from the old art step.

import { Controller, useFormContext } from "react-hook-form";
import { ArtUploader } from "@/components/creator/art-uploader";
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
};

export function ArtPanel({ userId, backFaceSlot }: ArtPanelProps) {
  const {
    register,
    control,
    setValue,
    formState: { errors },
  } = useFormContext<FormValues>();

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
                  artUrlField.onChange(artUrl ?? "");
                  artPosField.onChange(artPosition);
                  setValue("art_url", artUrl ?? "", { shouldDirty: true });
                  setValue("art_position", artPosition, {
                    shouldDirty: true,
                  });
                }}
              />
            )}
          />
        )}
      />

      <MoreOptions
        summary={
          backFaceSlot
            ? "More options — artist credit & second face"
            : "More options — artist credit"
        }
      >
        <FieldGroup
          label="Artist credit"
          helper="Who made the artwork? Yourself, a public-domain artist, or a licensed source."
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
