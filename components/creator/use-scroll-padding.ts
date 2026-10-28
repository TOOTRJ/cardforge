"use client";

// A focused field never sits under the creator's sticky bars (TODO 3b.28,
// WCAG 2.2 "Focus Not Obscured (Minimum)"). The PAGE scrolls (the creator
// has no scroll container of its own), so its root's scroll padding is set
// while the creator is mounted: the top keeps a field clear of the site
// header and of the Face switch stuck under it (`top-[4.25rem]`), the bottom
// clear of the sticky Save bar. Both follow the bars' measured heights — the
// Save bar grows with its "still needed" list, the switch with its note —
// and both are put back as they were when the creator unmounts.
//
// Browsers read the scroll padding for every scroll that brings an element
// into view: a Tab to a field, `scrollIntoView` (the "still needed" links,
// lib/creator/focus-field.ts) and a focus that scrolls.

import { useEffect } from "react";

/** Where the Face switch sticks: just under the 4 rem site header. */
const STICKY_TOP_REM = 4.25;
/** Room between a focused field and the bar beside it. */
const AIR_PX = 12;

/** The page's scroll padding for bars of these heights (px). */
export function creatorScrollPadding(input: { faceSwitchPx: number; saveBarPx: number }): { top: string; bottom: string } {
  return {
    top: `calc(${STICKY_TOP_REM}rem + ${Math.ceil(input.faceSwitchPx) + AIR_PX}px)`,
    bottom: `${Math.ceil(input.saveBarPx) + AIR_PX}px`,
  };
}

export function useCreatorScrollPadding(saveBar: HTMLElement | null, faceSwitch: HTMLElement | null) {
  useEffect(() => {
    const html = document.documentElement;
    const before = { top: html.style.scrollPaddingTop, bottom: html.style.scrollPaddingBottom };
    const apply = () => {
      const padding = creatorScrollPadding({
        faceSwitchPx: faceSwitch?.getBoundingClientRect().height ?? 0,
        saveBarPx: saveBar?.getBoundingClientRect().height ?? 0,
      });
      html.style.scrollPaddingTop = padding.top;
      html.style.scrollPaddingBottom = padding.bottom;
    };
    apply();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(apply) : null;
    if (saveBar) observer?.observe(saveBar);
    if (faceSwitch) observer?.observe(faceSwitch);
    return () => {
      observer?.disconnect();
      html.style.scrollPaddingTop = before.top;
      html.style.scrollPaddingBottom = before.bottom;
    };
  }, [saveBar, faceSwitch]);
}
