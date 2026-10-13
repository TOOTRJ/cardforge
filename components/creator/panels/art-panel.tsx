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
  useFaceLabel,
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
  /** True on a frame that paints its second part on the same picture
   *  (split, aftermath, adventure, flip): that part is edited on its own
   *  tab (Face tabs part 2, TODO 5.14 — panels/second-part-panels.tsx), so
   *  the legacy back's art strip below is not for it. Until part 2 its
   *  whole editor was folded into this panel's "More options". */
  secondPartOnTab?: boolean;
  /** The "Generate AI artwork and title" button, beside Choose file. */
  aiSlot?: React.ReactNode;
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
  secondPartOnTab = false,
  aiSlot,
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
  // parts (adventure, split, aftermath, flip) edit theirs on their own tab
  // (secondPartOnTab); a card on a double-faced FRONT body edits its back
  // on the Back face tab (Face tabs, TODO 5.14 — panels/back-face-panels.tsx).
  // "Front face" on a card with Face tabs (TODO 5.14); null elsewhere.
  const faceLabel = useFaceLabel();
  const showBackFaceArt = Boolean(hasBackFace) && !secondPartOnTab && !templateHasBackFace(template);

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
                fieldAnchor="art_url"
                heading={faceLabel ? `${faceLabel} — Artwork` : undefined}
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
        summary="More options — artist credit"
        openWhen={Boolean(errors.artist_credit)}
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
      </MoreOptions>
    </>
  );
}
