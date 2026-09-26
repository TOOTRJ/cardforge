"use client";

// The creator's side of a treatment switch (TODO 3.23): when the USER moves a
// card to another frame, keep what they framed in the art (the visible
// centre carries to the new window — lib/cards/art-framing.ts) and drop a
// finish the new frame can't show (Etched on an edge-to-edge frame, until
// 4.28). Draft restores, card loads and imports never re-frame anything:
// only a change made while the form is dirty, with the same art on both
// frames, counts.

import { useEffect, useRef, useState } from "react";
import type { UseFormReturn } from "react-hook-form";
import { toast } from "sonner";
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
