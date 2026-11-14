"use client";

import { useId, useRef, useState } from "react";
import { Check, ImagePlus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/creator/field-group";
import { inputClass } from "@/components/ui/field-classes";
import { uploadCoverImage } from "@/lib/media/upload-cover";
import { REART_IP_NAME_MAX, cleanReartIpName, reartIpStatement, type NormalReartStyle } from "@/lib/tools/re-art/model";

/**
 * The two optional parts of a deck's style that say more than a look
 * (migration 0214):
 *
 *   * a LICENSED PROPERTY the deck's pictures are of — named only after the
 *     maker ticks the sentence about their rights, which the server keeps
 *     word for word (shown while the deck doesn't name that property yet);
 *   * a REFERENCE PICTURE — the maker's own upload (moderated like every
 *     other; the server takes only their own stored picture), handed to the
 *     image model with every prompt of the deck.
 *
 * Both are part of the deck's look: changing either starts a new one.
 */
export function ReartLicenceFields({
  style,
  onChange,
  savedIpName,
  attested,
  onAttested,
}: {
  style: NormalReartStyle;
  onChange: (next: NormalReartStyle) => void;
  /** The property the deck's SAVED style names ('' for none): that one
   *  needs no confirmation again. */
  savedIpName: string;
  /** The maker ticked the sentence for the name the form shows. */
  attested: boolean;
  onAttested: (next: boolean) => void;
}) {
  const nameId = useId();
  const pictureId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<HTMLButtonElement>(null);
  const removeRef = useRef<HTMLButtonElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const name = cleanReartIpName(style.ipName);
  const needsConfirmation = name !== "" && name !== savedIpName;

  const setName = (raw: string) => {
    const { ipName: _dropped, ...rest } = style;
    void _dropped;
    const next = raw.slice(0, REART_IP_NAME_MAX);
    // Another name is another sentence: the tick never carries over.
    if (cleanReartIpName(next) !== name && attested) onAttested(false);
    onChange(next ? { ...rest, ipName: next } : rest);
  };

  const upload = async (file: File) => {
    setUploadError(null);
    setUploading(true);
    try {
      const result = await uploadCoverImage("", file, { purpose: "reart-reference" });
      if (!result.ok) {
        setUploadError(result.error);
        return;
      }
      onChange({ ...style, referenceUrl: result.publicUrl });
      // The upload button is replaced by the picture: the focus goes to Remove.
      requestAnimationFrame(() => removeRef.current?.focus());
    } catch {
      setUploadError("We couldn't reach PipGlyph — try again.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const removePicture = () => {
    const { referenceUrl: _dropped, ...rest } = style;
    void _dropped;
    onChange(rest);
    // Remove takes itself away: the focus goes to the upload button.
    requestAnimationFrame(() => uploadRef.current?.focus());
  };

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border/50 bg-elevated/30 p-3">
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-medium text-foreground">A licensed property, or a reference picture</h3>
        <p className="text-xs leading-5 text-muted">
          Optional. For a film, a game or a world you hold the rights to — or have its rights holder&apos;s
          permission for.
        </p>
      </div>

      <FieldGroup
        label="Licensed property"
        helper={`Its name, as you would write it on the box (up to ${REART_IP_NAME_MAX} characters). Every picture's prompt then says it is licensed artwork for it. Leave it empty for none.`}
      >
        <input
          id={nameId}
          type="text"
          value={style.ipName ?? ""}
          maxLength={REART_IP_NAME_MAX}
          autoComplete="off"
          onChange={(event) => setName(event.target.value)}
          className={inputClass(false)}
        />
      </FieldGroup>

      {needsConfirmation ? (
        <label className="flex items-start gap-2.5 rounded-lg border border-warning/40 bg-warning/5 p-3 text-xs leading-5 text-foreground">
          <input
            type="checkbox"
            checked={attested}
            onChange={(event) => onAttested(event.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
          />
          <span>
            {reartIpStatement(name)}
            <span className="mt-1 block text-muted">
              Your confirmation is kept with the date. Image services still decline some names and characters, whatever
              licence you hold.
            </span>
          </span>
        </label>
      ) : name ? (
        <p className="inline-flex items-center gap-1 text-xs text-success">
          <Check className="h-3.5 w-3.5" aria-hidden /> You confirmed your rights to {name} for this deck.
        </p>
      ) : null}

      <div className="flex flex-col gap-2">
        <p id={pictureId} className="text-sm font-medium text-foreground">
          Reference picture
        </p>
        <p id={`${pictureId}-help`} className="text-xs leading-5 text-muted">
          Every picture is painted with it: its look — and its characters, where your words name them — never its
          composition. PNG, JPEG or WebP, up to 5 MB. Upload only a picture you have the right to use.
        </p>
        {style.referenceUrl ? (
          <div className="flex items-start gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element -- the maker's own upload, shown small */}
            <img
              src={style.referenceUrl}
              alt="The deck's reference picture"
              className="h-28 w-28 shrink-0 rounded-md border border-border/60 object-cover"
            />
            <div className="flex min-w-0 flex-col gap-2">
              <p className="text-xs leading-5 text-subtle">
                With a reference picture each card is painted by a model that can look at one, and can&apos;t start from
                the card&apos;s own art.
              </p>
              <Button ref={removeRef} variant="outline" size="sm" className="w-fit" onClick={removePicture}>
                Remove<span className="sr-only"> the reference picture</span>
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              tabIndex={-1}
              aria-hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void upload(file);
              }}
            />
            <Button
              ref={uploadRef}
              variant="outline"
              size="sm"
              aria-describedby={`${pictureId}-help`}
              onClick={() => {
                if (!uploading) fileRef.current?.click();
              }}
              aria-disabled={uploading ? true : undefined}
              className={uploading ? "cursor-not-allowed opacity-60" : undefined}
            >
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <ImagePlus className="h-4 w-4" aria-hidden />}
              {uploading ? "Uploading…" : "Upload a reference picture"}
            </Button>
          </div>
        )}
        {uploadError ? (
          <p role="alert" className="text-xs text-danger">
            {uploadError}
          </p>
        ) : null}
      </div>
    </div>
  );
}
