"use client";

import { useSyncExternalStore } from "react";

/**
 * Whether a CSS media query matches, kept in step with the window (TODO
 * 3b.9: the creator mounts ONE live preview — the phone's inline one or the
 * desktop aside — instead of both with one hidden by CSS).
 *
 * `null` on the server and through hydration: the server cannot know the
 * window, so it renders what the CSS alone decides (both places, one of
 * them `hidden`), and the first client render must match it. The real
 * answer arrives in the render after hydration — the same frame, so nothing
 * on screen moves.
 */
export function useMediaQuery(query: string): boolean | null {
  return useSyncExternalStore(
    (onChange) => {
      const list = typeof window !== "undefined" ? window.matchMedia?.(query) : undefined;
      list?.addEventListener?.("change", onChange);
      return () => list?.removeEventListener?.("change", onChange);
    },
    () => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(query).matches : null),
    () => null,
  );
}

/** Tailwind's `lg` breakpoint (64rem): where the creator's aside preview
 *  shows and the inline one hides (card-creator-form.tsx). */
export const CREATOR_ASIDE_QUERY = "(min-width: 64rem)";
