"use client";

// The creator's half of a guest's card (TODO HM3; the storage and the rules
// are lib/creator/guest-draft.ts):
//
//   * "guest" — the signed-out creator: pictures are KEPT in the browser
//     (`pictures.keep`, never uploaded), the card is written to the draft as
//     it changes (debounced, and at once when the page is hidden or the save
//     gate opens), and a draft already there is put back on load. Only this
//     role ever WRITES the draft — and only what changed since this tab's
//     last write, over the record this tab last wrote or put back: a tab
//     left open while the card was claimed, saved or rewritten in another
//     tab writes nothing more (the store's `guard`).
//   * "restore" — the signed-in creator at /create (a plain new card): a
//     draft there is CLAIMED for this account and put back, its pictures
//     uploaded through the normal upload paths (art: start → PUT → finish;
//     a land icon / watermark: the watermark action — prepareUploadBytes,
//     the rate limit, the user's own folder; once per picture in this tab's
//     session — a second visit reuses the address). It is never written again:
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
  type ReadGuestDraft,
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
import { randomId } from "@/lib/ids";
import type { GuestPictures } from "@/components/creator/guest-pictures";

export type GuestDraftRole = "guest" | "restore";

/** How long the form rests before its card is written to the draft. */
const WRITE_DELAY_MS = 500;

// A restored picture's upload, remembered for this tab's session: the same
// kept picture is uploaded once, not on every visit to /create before Save.
// Keyed by the account, the draft's revision and the picture's field.
const UPLOADED_KEY = "pipglyph:guest-card-uploads";
const uploadedKey = (userId: string, rev: string, path: string) => `${userId}|${rev}|${path}`;
function readUploaded(): Record<string, string> {
  try {
    const raw = window.sessionStorage.getItem(UPLOADED_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}
function rememberUploaded(key: string, url: string) {
  try {
    window.sessionStorage.setItem(UPLOADED_KEY, JSON.stringify({ ...readUploaded(), [key]: url }));
  } catch {
    // not remembered: the next visit uploads it again
  }
}

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
    if (!files.current.has(url)) return;
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

  // The record this tab last wrote or put back (null: none), and what it
  // held: a write goes over that record only, and only with something new.
  const expected = useRef<string | null>(null);
  const lastWritten = useRef<string | null>(null);
  // The record was claimed, cleared or rewritten elsewhere: this tab's card
  // is no longer the kept one, and it writes nothing more.
  const stale = useRef(false);
  const snapshotKey = useCallback(
    () => JSON.stringify({ values: getValues(), tags: latest.current.tags.snapshot() }),
    [getValues],
  );

  // A picture the guest replaced or removed is let go at once.
  const releaseUnused = useCallback(() => {
    const inUse = new Set(blobUrlPaths(getValues()).map(({ url }) => url));
    for (const url of [...files.current.keys()]) if (!inUse.has(url)) releaseFile(url);
  }, [getValues, releaseFile]);

  const write = useCallback(async () => {
    if (!writes || !ready.current || stale.current) return;
    releaseUnused();
    if (!dirty.current) {
      // An untouched form (a fresh guest page, Start over) holds no card:
      // this tab's own record goes; another tab's stays.
      if (expected.current === null && lastWritten.current === null) return;
      const cleared = await store.clear({ expected: expected.current });
      if (!cleared) stale.current = true;
      expected.current = null;
      lastWritten.current = null;
      return;
    }
    const key = snapshotKey();
    if (key === lastWritten.current) return;
    const { values, pictures } = draftPictures(getValues(), files.current);
    const draft: GuestDraft = {
      values,
      pictures,
      tags: latest.current.tags.snapshot(),
      base: latest.current.defaults,
      claimedBy: null,
    };
    const rev = randomId();
    const result = await store.write(draft, { guard: { expected: expected.current }, rev });
    if (result === "stale") stale.current = true;
    else if (result) {
      expected.current = rev;
      lastWritten.current = key;
    }
  }, [writes, getValues, store, releaseUnused, snapshotKey]);

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
    expected.current = null;
    lastWritten.current = null;
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
  const restoredRev = useRef<string | null>(null);
  const uploadKept = useCallback(async () => {
    if (uploading.current) return;
    const waiting = blobUrlPaths(getValues());
    if (waiting.length === 0) return;
    uploading.current = true;
    setUploads("uploading");
    let failed = false;
    try {
      for (const { path, url } of waiting) {
        const rev = restoredRev.current;
        const memoKey = userId && rev ? uploadedKey(userId, rev, path) : null;
        const earlier = memoKey ? readUploaded()[memoKey] : undefined;
        if (earlier) {
          if (getValues(path as FieldPath<FormValues>) === url) {
            setValue(path as FieldPath<FormValues>, earlier as never, { shouldDirty: true });
            releaseFile(url);
          }
          continue;
        }
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
        if (memoKey) rememberUploaded(memoKey, result.publicUrl);
        if (getValues(path as FieldPath<FormValues>) === url) {
          setValue(path as FieldPath<FormValues>, result.publicUrl as never, { shouldDirty: true });
          releaseFile(url);
        }
      }
    } finally {
      uploading.current = false;
    }
    setUploads(failed ? "failed" : "idle");
  }, [userId, getValues, setValue, setUploads, releaseFile]);

  // ---- Put a kept card back, once ----
  const tried = useRef(false);
  useEffect(() => {
    if (!role || tried.current) return;
    if (role === "restore" && !userId) return;
    tried.current = true;
    let cancelled = false;
    void (async () => {
      const viewer = role === "restore" ? userId : null;
      let draft: ReadGuestDraft | null = null;
      try {
        draft = await store.read(viewer);
      } catch {
        draft = null;
      }
      if (cancelled) return;
      // The maker typed before the read came back: their card replaces the
      // kept one, as this tab's own.
      if (draft && dirty.current && role === "guest") expected.current = draft.rev;
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
          restoredRev.current = draft.rev;
          // The guest's tab carries on over the record it put back.
          expected.current = draft.rev;
          lastWritten.current = snapshotKey();
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
  }, [role, userId, store, reset, holdFile, uploadKept, snapshotKey]);

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
