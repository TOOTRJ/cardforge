"use client";

// Art panel — the uploader/positioner plus the artist-credit "more options"
// collapsible. Moved unchanged from the old art step. "Use art from a real
// card" (TODO 1.15) sits beside Choose file: a real printing's art without
// the full import.

import { Controller, useFormContext, useWatch } from "react-hook-form";
import { ArtUploader } from "@/components/creator/art-uploader";
import { RealCardArtButton } from "@/components/creator/real-card-art-dialog";
import {
  ImportedArtNote,
  type ImportedArtOrigin,
} from "@/components/creator/import/imported-art-note";
import {
  FieldGroup,
  MoreOptions,
  inputClass,
} from "@/components/creator/field-group";
import type { ArtWindow } from "@/lib/cards/art-positioner-window";
import type { FormValues } from "@/lib/creator/form-types";
import { realCardArtOrigin } from "@/lib/creator/real-card-art";
import { templateHasBackFace } from "@/lib/cards/dfc";

type ArtPanelProps = {
  userId: string | null;
  /** The front face's art window on the current frame and colour (TODO
   *  3b.13): the positioner's surface. */
  artWindow: ArtWindow;
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
  /** Front art taken from a real card (TODO 1.15): the creator remembers
   *  its origin so the note above reads the same as after a full import. */
  onImportedArtOrigin?: (origin: ImportedArtOrigin) => void;
  /** Real-card art landed on the back face of a two-faced card (an
   *  imported transform / modal DFC): the preview turns to that face. */
  onBackFaceArt?: () => void;
  /** The one-click move onto the real double-faced frames (TODO 5.2, owner
   *  Q3), rendered under the legacy back's art strip on a stored card whose
   *  back qualifies. */
  backFaceHint?: React.ReactNode;
};

export function ArtPanel({
  userId,
  artWindow,
  backFaceSlot,
  aiSlot,
  secondFaceNameMissing = false,
  importedArtOrigin = null,
  onImportedArtOrigin,
  onBackFaceArt,
  backFaceHint,
}: ArtPanelProps) {
  const {
    register,
    control,
    formState: { errors },
  } = useFormContext<FormValues>();
  const [artUrl, template, hasBackFace, backFace] = useWatch({
    control,
    name: ["art_url", "frame_style.template", "has_back_face", "back_face"],
  });
  // A LEGACY second face with its own art but no editor: an imported
  // transform / modal DFC (Delver of Secrets) from before Phase 5 keeps its
  // back in `back_face`, drawn on the front's frame. Its art can still come
  // from a real card (TODO 1.15), and its owner is offered the move onto the
  // real double-faced frames (backFaceHint, TODO 5.2). The inline second
  // faces (adventure, split, aftermath, flip) edit theirs in backFaceSlot;
  // a card on a double-faced FRONT body edits its back in the back-face
  // panel under this one (DfcFacePanel).
  const showBackFaceArt = Boolean(hasBackFace) && !backFaceSlot && !templateHasBackFace(template);

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
                artWindow={artWindow}
                onArtChange={({ artUrl, artPosition }) => {
                  // Controller onChange is the single write path — it updates
                  // the value AND dirties the field. A second setValue on the
                  // same fields raced it under React batching.
                  artUrlField.onChange(artUrl ?? "");
                  artPosField.onChange(artPosition);
                }}
                actionSlot={
                  <>
                    {aiSlot}
                    <RealCardArtButton
                      target="front"
                      signedIn={Boolean(userId)}
                      onApplied={({ art, printing }) =>
                        onImportedArtOrigin?.(realCardArtOrigin(printing, art.publicUrl))
                      }
                    />
                  </>
                }
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

      {showBackFaceArt ? (
        <div
          className="flex flex-wrap items-center gap-3 rounded-md border border-border/60 bg-elevated/30 p-3"
          data-testid="back-face-art"
        >
          {backFace?.art_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={backFace.art_url}
              alt="Back face artwork"
              className="h-12 w-16 shrink-0 rounded-sm border border-border/50 object-cover"
            />
          ) : (
            <span className="h-12 w-16 shrink-0 rounded-sm bg-elevated" aria-hidden />
          )}
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-xs font-semibold uppercase tracking-wider text-subtle">
              Back face art
            </span>
            <span className="truncate text-[11px] text-muted">
              {[backFace?.title || "The card's second face", backFace?.artist_credit]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </span>
          <RealCardArtButton
            target="back"
            signedIn={Boolean(userId)}
            onApplied={() => onBackFaceArt?.()}
          />
        </div>
      ) : null}
      {showBackFaceArt ? backFaceHint : null}

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
