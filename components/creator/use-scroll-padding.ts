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
//
// Hosted (the deck's edit drawer, TODO DK5.18) the HOST's box scrolls, not
// the page: the padding goes on that box, and the switch sticks at its top
// (no site header above it — `--creator-sticky-switch: 0`).

import { useEffect } from "react";

/** Where the Face switch sticks: just under the 4 rem site header. */
const STICKY_TOP_REM = 4.25;
/** Room between a focused field and the bar beside it. */
const AIR_PX = 12;

/** The page's scroll padding for bars of these heights (px). `stickyTopRem`:
 *  where the switch sticks (the site header's height on the page; 0 in a
 *  host's own scroll box). */
export function creatorScrollPadding(input: { faceSwitchPx: number; saveBarPx: number; stickyTopRem?: number }): { top: string; bottom: string } {
  return {
    top: `calc(${input.stickyTopRem ?? STICKY_TOP_REM}rem + ${Math.ceil(input.faceSwitchPx) + AIR_PX}px)`,
    bottom: `${Math.ceil(input.saveBarPx) + AIR_PX}px`,
  };
}

/** Sets a scroll box's padding (the page's root, or a host's own box). */
function writeScrollPadding(box: HTMLElement, padding: { top: string; bottom: string }) {
  box.style.scrollPaddingTop = padding.top;
  box.style.scrollPaddingBottom = padding.bottom;
}

export function useCreatorScrollPadding(
  saveBar: HTMLElement | null,
  faceSwitch: HTMLElement | null,
  scrollRoot: HTMLElement | null = null,
) {
  useEffect(() => {
    const html = scrollRoot ?? document.documentElement;
    const before = { top: html.style.scrollPaddingTop, bottom: html.style.scrollPaddingBottom };
    const apply = () => {
      const padding = creatorScrollPadding({
        faceSwitchPx: faceSwitch?.getBoundingClientRect().height ?? 0,
        saveBarPx: saveBar?.getBoundingClientRect().height ?? 0,
        ...(scrollRoot ? { stickyTopRem: 0 } : {}),
      });
      writeScrollPadding(html, padding);
    };
    apply();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(apply) : null;
    if (saveBar) observer?.observe(saveBar);
    if (faceSwitch) observer?.observe(faceSwitch);
    return () => {
      observer?.disconnect();
      writeScrollPadding(html, before);
    };
  }, [saveBar, faceSwitch, scrollRoot]);
}
