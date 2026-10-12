"use client";

// The creator's side of a treatment switch (TODO 3.23): when the USER moves a
// card to another frame, keep what they framed in the art (the visible
// centre carries to the new window — lib/cards/art-framing.ts) and drop a
// finish the new frame can't show (Etched on an edge-to-edge frame, until
// 4.28). Draft restores, card loads and imports never re-frame anything:
// only a change made while the form is dirty, with the same art on both
// frames, counts.
//
// That carry is for a picture the maker placed BY HAND. An untouched one is
// on its automatic fit (TODO 3b.18, lib/cards/art-fit.ts) and takes the new
// window's fit instead — here for a frame change, and in useArtAutoFit for
// every face whenever its own window changes (a colour that picks a
// see-through master, a second half, a double-faced back's body).

import { useEffect, useRef, useState } from "react";
import type { UseFormReturn } from "react-hook-form";
import { toast } from "sonner";
import { refitArtForWindow, type FitWindow } from "@/lib/cards/art-fit";
import { planTreatmentSwitch, type Size } from "@/lib/cards/art-framing";
import { normalizeFrameTemplate } from "@/lib/cards/card-display";
import {
  resolveFrameProfile,
  type FrameProfileOverridesMap,
} from "@/lib/cards/profile-override";
import type { FormValues } from "@/lib/creator/form-types";

/** Toast when a frame switch drops the Etched finish. */
export const ETCHED_DROPPED_NOTICE =
  "Etched isn't available on borderless frames yet — the finish is back to Regular.";

/** The natural size of an image URL once it has loaded (null before, and
 *  for no URL). The URL is the one the preview already shows, so this is a
 *  cache hit. A stale size is never returned for a new URL. */
export function useImageNaturalSize(src: string | null | undefined): (Size & { src: string }) | null {
  const [loaded, setLoaded] = useState<(Size & { src: string }) | null>(null);
  useEffect(() => {
    if (!src) return;
    let live = true;
    const img = new Image();
    img.onload = () => {
      if (live && img.naturalWidth > 0 && img.naturalHeight > 0) {
        setLoaded({ src, width: img.naturalWidth, height: img.naturalHeight });
      }
    };
    img.src = src;
    return () => {
      live = false;
    };
  }, [src]);
  return src && loaded?.src === src ? loaded : null;
}

export function useTreatmentSwitch({
  template,
  artUrl,
  natural,
  isDirty,
  getValues,
  setValue,
  profileOverrides,
}: {
  template: string | null | undefined;
  artUrl: string | null | undefined;
  /** useImageNaturalSize(artUrl). */
  natural: (Size & { src: string }) | null;
  isDirty: boolean;
  getValues: UseFormReturn<FormValues>["getValues"];
  setValue: UseFormReturn<FormValues>["setValue"];
  profileOverrides?: FrameProfileOverridesMap | null;
}) {
  const last = useRef({ template, artUrl });
  useEffect(() => {
    const prev = last.current;
    last.current = { template, artUrl };
    if (prev.template === template || !isDirty) return;
    const from = resolveFrameProfile(normalizeFrameTemplate(prev.template ?? undefined), profileOverrides);
    const to = resolveFrameProfile(normalizeFrameTemplate(template ?? undefined), profileOverrides);
    const plan = planTreatmentSwitch({
      from,
      to,
      finish: getValues("frame_style.finish"),
      // Only the same picture on both frames is re-framed.
      natural: artUrl && artUrl === prev.artUrl && natural?.src === artUrl ? natural : null,
      position: getValues("art_position"),
    });
    if (plan.position) setValue("art_position", plan.position, { shouldDirty: true });
    if (plan.finish) {
      setValue("frame_style.finish", plan.finish, { shouldDirty: true });
      toast.info(ETCHED_DROPPED_NOTICE);
    }
  }, [template, artUrl, natural, isDirty, getValues, setValue, profileOverrides]);
}

/**
 * Keep an UNTOUCHED picture on its automatic fit when its face's art window
 * changes (TODO 3b.18): the front's, an inline second half's or a
 * double-faced back's — each to ITS window, the one its positioner shows
 * (artPositionerWindows). A picture placed by hand is never re-fitted here:
 * the front's is carried by useTreatmentSwitch on a frame change (3.23) and
 * otherwise every hand-set position stays as it is.
 *
 * Like the carry, only a change the USER makes counts (a dirty form, the
 * same picture before and after): a load, a draft restore or an import
 * never rewrites a position.
 */
export function useArtAutoFit({
  field,
  artWindow,
  artUrl,
  natural,
  isDirty,
  getValues,
  setValue,
}: {
  field: "art_position" | "back_face.art_position";
  /** This face's window (null while the card has no such face). */
  artWindow: FitWindow | null | undefined;
  artUrl: string | null | undefined;
  /** useImageNaturalSize(artUrl). */
  natural: (Size & { src: string }) | null;
  isDirty: boolean;
  getValues: UseFormReturn<FormValues>["getValues"];
  setValue: UseFormReturn<FormValues>["setValue"];
}) {
  const width = artWindow?.width ?? 0;
  const height = artWindow?.height ?? 0;
  const last = useRef({ width, height, artUrl });
  useEffect(() => {
    const prev = last.current;
    last.current = { width, height, artUrl };
    if ((prev.width === width && prev.height === height) || !isDirty) return;
    // A face that appears or goes has no window to move between; a new
    // picture already landed on its own fit.
    if (!(width > 0 && height > 0 && prev.width > 0 && prev.height > 0)) return;
    if (!artUrl || artUrl !== prev.artUrl) return;
    const position = getValues(field);
    if (!position) return;
    const next = refitArtForWindow({
      from: prev,
      to: { width, height },
      natural: natural?.src === artUrl ? natural : null,
      position,
    });
    if (next !== position) setValue(field, next, { shouldDirty: true });
  }, [field, width, height, artUrl, natural, isDirty, getValues, setValue]);
}
