"use client";

// The creator's half of a guest's card (TODO HM3; the storage and the rules
// are lib/creator/guest-draft.ts):
//
//   * "guest" — the signed-out creator: pictures are KEPT in the browser
//     (`pictures.keep`, never uploaded), the card is written to the draft as
//     it changes (debounced, and at once when the page is hidden or the save
//     gate opens), and a draft already there is put back on load. Only this
//     role ever WRITES the draft.
//   * "restore" — the signed-in creator at /create (a plain new card): a
//     draft there is CLAIMED for this account and put back, its pictures
//     uploaded through the normal upload paths (art: start → PUT → finish;
//     a land icon / watermark: the watermark action — prepareUploadBytes,
//     the rate limit, the user's own folder). It is never written again:
//     the stored draft keeps its `blob:` pictures and none of the account's
//     URLs, and goes when the card saves (the form's own createCardAction),
//     on Start over, or at sign-out.
//   * null — nothing (an edit, a remix, a deck proxy, a frame walk-through).
//
// A draft is put back only onto an untouched form: a maker who started
// typing before the read came back keeps what they typed. Its values are
// laid over the form's own defaults (mergeDraftValues): a field added since,
// or one the guest never set, takes this viewer's default.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FieldPath, UseFormReturn } from "react-hook-form";
import { toast } from "sonner";
import type { FormValues } from "@/lib/creator/form-types";
import { parseTags } from "@/lib/creator/card-fields";
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
  /** True from the moment a kept card is put back until it saves (or is
   *  started over): the notice, and the save's `guestDraft` funnel prop. */
  restored: boolean;
  retryUploads: () => void;
  /** Write the card now (the save gate, leaving the page). */
  flush: () => Promise<void>;
  /** Forget the kept card (a save went through). */
  clear: () => Promise<void>;
};

export function useGuestDraft({
  role,
  userId,
  form,
  defaults,
  isDirty,
  tags,
  setUploads,
  finishValues,
  onRestored,
}: {
  role: GuestDraftRole | null;
  /** The signed-in account a restored draft is claimed for. */
  userId: string | null;
  form: Pick<UseFormReturn<FormValues>, "getValues" | "setValue" | "reset" | "watch">;
  /** The form's own starting values: the guest's are kept with the draft;
   *  the viewer's are what a restored draft is laid over. */
  defaults: FormValues;
  isDirty: boolean;
  tags: { snapshot: () => GuestDraftTags; adopt: (kept: GuestDraftTags, tagsText: string) => void };
  /** Sets the signed-in creator's upload state of a restored card's
   *  pictures — the form's state (its Save reason reads it before this hook
   *  runs). */
  setUploads: (next: GuestPictureUploads) => void;
  /** The restored values, finished by the form (a challenge's tag). */
  finishValues?: (values: FormValues) => FormValues;
  /** After the form holds the restored values: the follows settle on them
   *  as on an import (the card arrived whole; its picks stand). */
  onRestored: () => void;
}): GuestDraftControls {
  const { getValues, setValue, reset, watch } = form;
  const store = useMemo(() => createGuestDraftStore(), []);
  const files = useRef(new Map<string, { blob: Blob; name: string }>());
  const [localPictureUrls, setLocalPictureUrls] = useState<string[]>([]);
  const [restored, setRestored] = useState(false);
  const restoredRef = useRef(false);
  // Writing starts only once the read on load is done: an untouched form
  // must not clear a draft it hasn't looked at yet. Only the guest writes.
  const ready = useRef(false);
  const writes = role === "guest";
  const dirty = useRef(isDirty);
  const latest = useRef({ tags, onRestored, finishValues, defaults });
  useEffect(() => {
    dirty.current = isDirty;
    latest.current = { tags, onRestored, finishValues, defaults };
  });

  const holdFile = useCallback((url: string, blob: Blob, name: string) => {
    files.current.set(url, { blob, name });
    setLocalPictureUrls((prev) => (prev.includes(url) ? prev : [...prev, url]));
  }, []);
  const releaseFile = useCallback((url: string) => {
    files.current.delete(url);
    setLocalPictureUrls((prev) => prev.filter((u) => u !== url));
    try {
      URL.revokeObjectURL(url);
    } catch {
      // nothing to free
    }
  }, []);
  // Every picture this page still holds is freed with it.
  useEffect(
    () => () => {
      for (const url of files.current.keys()) {
        try {
          URL.revokeObjectURL(url);
        } catch {
          // nothing to free
        }
      }
      files.current.clear();
    },
    [],
  );

  const write = useCallback(async () => {
    if (!writes || !ready.current) return;
    if (!dirty.current) {
      // An untouched form (a fresh guest page, Start over) holds no card.
      await store.clear();
      return;
    }
    const { values, pictures } = draftPictures(getValues(), files.current);
    const draft: GuestDraft = {
      values,
      pictures,
      tags: latest.current.tags.snapshot(),
      base: latest.current.defaults,
      claimedBy: null,
    };
    await store.write(draft);
  }, [writes, getValues, store]);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flush = useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    await write();
  }, [write]);

  useEffect(() => {
    if (!writes) return;
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
  }, [writes, watch, write, flush]);

  const clear = useCallback(async () => {
    restoredRef.current = false;
    setRestored(false);
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    await store.clear();
  }, [store]);

  // Start over (dirty → clean): the guest's draft goes at once, not after
  // the delay; a restored card is forgotten.
  useEffect(() => {
    if (!role || isDirty) return;
    if (writes) void write();
    else if (restoredRef.current) void clear();
  }, [role, writes, isDirty, write, clear]);

  // ---- The restored card's pictures, uploaded once signed in ----
  // One run at a time: a Retry while one is in flight would upload the same
  // picture twice and orphan the first object.
  const uploading = useRef(false);
  const uploadKept = useCallback(async () => {
    if (uploading.current) return;
    const waiting = blobUrlPaths(getValues());
    if (waiting.length === 0) return;
    uploading.current = true;
    setUploads("uploading");
    let failed = false;
    try {
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
          releaseFile(url);
        }
      }
    } finally {
      uploading.current = false;
    }
    setUploads(failed ? "failed" : "idle");
  }, [getValues, setValue, setUploads, releaseFile]);

  // ---- Put a kept card back, once ----
  const tried = useRef(false);
  useEffect(() => {
    if (!role || tried.current) return;
    if (role === "restore" && !userId) return;
    tried.current = true;
    let cancelled = false;
    void (async () => {
      const viewer = role === "restore" ? userId : null;
      let draft: GuestDraft | null = null;
      try {
        draft = await store.read(viewer);
      } catch {
        draft = null;
      }
      if (cancelled) return;
      if (draft && !dirty.current) {
        try {
          // Claimed first: from here it is this account's, and no guest or
          // other account on this browser is ever offered it.
          if (viewer) await store.claim(viewer);
          if (cancelled) return;
          const { values: merged, urls } = restoredDraftValues(
            draft,
            (blob) => URL.createObjectURL(blob),
            latest.current.defaults,
          );
          const values = latest.current.finishValues ? latest.current.finishValues(merged) : merged;
          for (const [url, picture] of urls) holdFile(url, picture.blob, picture.name);
          // A tag the form added (a challenge's) stays when the tags follow
          // the card's text: it joins the follow's base.
          const before = parseTags(merged.tags_text ?? "");
          const added = parseTags(values.tags_text ?? "").filter((tag) => !before.includes(tag));
          latest.current.tags.adopt({ ...draft.tags, base: [...draft.tags.base, ...added] }, values.tags_text ?? "");
          reset(values, { keepDefaultValues: true });
          latest.current.onRestored();
          restoredRef.current = true;
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
  }, [role, userId, store, reset, holdFile, uploadKept]);

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

  return {
    pictures,
    localPictureUrls,
    restored,
    retryUploads: () => void uploadKept(),
    flush,
    clear,
  };
}
