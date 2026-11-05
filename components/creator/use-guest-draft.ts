"use client";

// The creator's half of a guest's card (TODO HM3; the storage and the rules
// are lib/creator/guest-draft.ts):
//
//   * "guest" — the signed-out creator: pictures are KEPT in the browser
//     (`pictures.keep`, never uploaded), the card is written to the draft as
//     it changes (debounced, and at once when the page is hidden or the save
//     gate opens), and a draft already there is put back on load.
//   * "restore" — the signed-in creator at /create (a plain new card): a
//     draft there is put back once, its pictures uploaded through the normal
//     upload paths (art: start → PUT → finish; a land icon / watermark: the
//     watermark action — prepareUploadBytes, the rate limit, the user's own
//     folder), and the card keeps being written to the draft until it saves;
//     the save is the form's own (createCardAction) and clears it.
//   * null — nothing (an edit, a remix, a deck proxy, a frame walk-through).
//
// A draft is put back only onto an untouched form: a maker who started
// typing before the read came back keeps what they typed.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FieldPath, UseFormReturn } from "react-hook-form";
import { toast } from "sonner";
import type { FormValues } from "@/lib/creator/form-types";
import {
  blobUrlPaths,
  createGuestDraftStore,
  draftPictures,
  guestPictureKindOf,
  restoredDraftValues,
  type GuestDraft,
  type GuestDraftTags,
  type GuestPictureKind,
} from "@/lib/creator/guest-draft";
import { cardArtFileProblem } from "@/lib/cards/art-upload-limits";
import { watermarkFileProblem } from "@/lib/cards/watermark-upload-limits";
import { uploadCardArtFile } from "@/lib/cards/art-upload-client";
import { uploadWatermarkServerAction } from "@/lib/cards/upload-watermark-server";
import type { GuestPictures } from "@/components/creator/guest-pictures";

export type GuestDraftRole = "guest" | "restore";

/** How long the form rests before its card is written to the draft. */
const WRITE_DELAY_MS = 500;

export type GuestPictureUploads = "idle" | "uploading" | "failed";

export type GuestDraftControls = {
  /** The guest creator's picture keeper (null when signed in). */
  pictures: GuestPictures | null;
  /** `blob:` URLs this page holds — the live preview draws them. */
  localPictureUrls: string[];
  /** True once a kept card has been put back in the form. */
  restored: boolean;
  retryUploads: () => void;
  /** Write the card now (the save gate, leaving the page). */
  flush: () => Promise<void>;
  /** Forget the kept card (a save went through). */
  clear: () => Promise<void>;
};

export function useGuestDraft({
  role,
  form,
  isDirty,
  tags,
  setUploads,
  onRestored,
}: {
  role: GuestDraftRole | null;
  form: Pick<UseFormReturn<FormValues>, "getValues" | "setValue" | "reset" | "watch">;
  isDirty: boolean;
  tags: { snapshot: () => GuestDraftTags; adopt: (kept: GuestDraftTags, tagsText: string) => void };
  /** Sets the signed-in creator's upload state of a restored card's
   *  pictures — the form's state (its Save reason reads it before this hook
   *  runs). */
  setUploads: (next: GuestPictureUploads) => void;
  /** After the form holds the restored values: the follows settle on them
   *  as on an import (the card arrived whole; its picks stand). */
  onRestored: () => void;
}): GuestDraftControls {
  const { getValues, setValue, reset, watch } = form;
  const store = useMemo(() => createGuestDraftStore(), []);
  const files = useRef(new Map<string, { blob: Blob; name: string }>());
  const [localPictureUrls, setLocalPictureUrls] = useState<string[]>([]);
  const [restored, setRestored] = useState(false);
  // Writing starts only once the read on load is done: an untouched form
  // must not clear a draft it hasn't looked at yet.
  const ready = useRef(false);
  // The signed-in creator writes only a card that came from a draft.
  const writing = useRef(role === "guest");
  const dirty = useRef(isDirty);
  const latest = useRef({ tags, onRestored });
  useEffect(() => {
    dirty.current = isDirty;
    latest.current = { tags, onRestored };
  });

  const holdFile = useCallback((url: string, blob: Blob, name: string) => {
    files.current.set(url, { blob, name });
    setLocalPictureUrls((prev) => (prev.includes(url) ? prev : [...prev, url]));
  }, []);

  const write = useCallback(async () => {
    if (!ready.current || !writing.current) return;
    if (!dirty.current) {
      // An untouched form (a fresh guest page, Start over) holds no card.
      await store.clear();
      return;
    }
    const { values, pictures } = draftPictures(getValues(), files.current);
    const draft: GuestDraft = { values, pictures, tags: latest.current.tags.snapshot() };
    await store.write(draft);
  }, [getValues, store]);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flush = useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    await write();
  }, [write]);

  useEffect(() => {
    if (!role) return;
    const schedule = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        void write();
      }, WRITE_DELAY_MS);
    };
    const subscription = watch(schedule);
    const onHide = () => {
      if (document.visibilityState === "hidden") void flush();
    };
    const onPageHide = () => void flush();
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      subscription.unsubscribe();
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onPageHide);
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
        void write();
      }
    };
  }, [role, watch, write, flush]);
  // Start over (dirty → clean) clears at once, not after the delay.
  useEffect(() => {
    if (role && !isDirty) void write();
  }, [role, isDirty, write]);

  // ---- The restored card's pictures, uploaded once signed in ----
  const uploadKept = useCallback(async () => {
    const waiting = blobUrlPaths(getValues());
    if (waiting.length === 0) return;
    setUploads("uploading");
    let failed = false;
    for (const { path, url } of waiting) {
      const kept = files.current.get(url);
      if (!kept) {
        setValue(path as FieldPath<FormValues>, "" as never, { shouldDirty: true });
        continue;
      }
      const file = new File([kept.blob], kept.name, { type: kept.blob.type });
      let result: { ok: true; publicUrl: string } | { ok: false; error: string };
      try {
        if (guestPictureKindOf(path) === "watermark") {
          const formData = new FormData();
          formData.append("file", file);
          result = await uploadWatermarkServerAction(formData);
        } else {
          result = await uploadCardArtFile(file);
        }
      } catch {
        result = { ok: false, error: "The upload didn't go through — check your connection and try again." };
      }
      if (!result.ok) {
        failed = true;
        toast.error(result.error);
        continue;
      }
      // Only where the field still holds this picture (the maker may have
      // replaced or removed it meanwhile).
      if (getValues(path as FieldPath<FormValues>) === url) {
        setValue(path as FieldPath<FormValues>, result.publicUrl as never, { shouldDirty: true });
      }
    }
    setUploads(failed ? "failed" : "idle");
  }, [getValues, setValue, setUploads]);

  // ---- Put a kept card back, once ----
  const tried = useRef(false);
  useEffect(() => {
    if (!role || tried.current) return;
    tried.current = true;
    let cancelled = false;
    void (async () => {
      let draft: GuestDraft | null = null;
      try {
        draft = await store.read();
      } catch {
        draft = null;
      }
      if (cancelled) return;
      if (draft && !dirty.current) {
        try {
          const { values, urls } = restoredDraftValues(draft, (blob) => URL.createObjectURL(blob));
          for (const [url, picture] of urls) holdFile(url, picture.blob, picture.name);
          latest.current.tags.adopt(draft.tags, values.tags_text ?? "");
          reset(values, { keepDefaultValues: true });
          latest.current.onRestored();
          writing.current = true;
          setRestored(true);
          if (role === "restore") void uploadKept();
        } catch (error) {
          // A draft this version can't read: never a broken creator.
          console.warn("[creator] guest draft could not be restored", error);
          await store.clear();
        }
      }
      ready.current = true;
    })();
    return () => {
      cancelled = true;
      // StrictMode's second run must try again (the first was cancelled).
      tried.current = false;
    };
  }, [role, store, reset, holdFile, uploadKept]);

  const pictures = useMemo<GuestPictures | null>(
    () =>
      role === "guest"
        ? {
            keep(file: File, kind: GuestPictureKind) {
              const problem = kind === "art" ? cardArtFileProblem(file) : watermarkFileProblem(file);
              if (problem) {
                toast.error(problem);
                return null;
              }
              let url: string;
              try {
                url = URL.createObjectURL(file);
              } catch {
                toast.error("This browser couldn't hold that picture — sign in to upload it.");
                return null;
              }
              holdFile(url, file, file.name);
              return url;
            },
          }
        : null,
    [role, holdFile],
  );

  const clear = useCallback(async () => {
    writing.current = false;
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    await store.clear();
  }, [store]);

  return {
    pictures,
    localPictureUrls,
    restored,
    retryUploads: () => void uploadKept(),
    flush,
    clear,
  };
}
