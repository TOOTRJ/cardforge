"use client";

import { useEffect } from "react";

// ---------------------------------------------------------------------------
// RenderImageRetry — a card picture that failed to load is asked for again
// (mounted ONCE in the root layout; it renders nothing).
//
// Every baked card picture on the site — gallery and deck tiles, fans,
// rows — is an <img> of `/render-cdn/…` (lib/cards/render-cdn.ts). On a CDN
// miss that route reads the bake from storage, and when storage is busy it
// answers 503 `no-store` (app/render-cdn/[...path]/route.ts). A browser
// never retries an <img>: on 2026-11-10 a page of deck tiles showed alt
// text in black boxes until its reader reloaded it, although the same
// address answered a second later.
//
// ONE listener for the whole document rather than an `onError` per tile: the
// tiles are server components (no hydration cost today), and a page holds
// dozens of them. `error` does not bubble, so it is heard in the capture
// phase. An image that failed BEFORE this ran (the HTML's images start
// loading before React hydrates) is found by a single look at mount.
//
// A picture gets RETRY_AFTER_MS.length more tries, each after its wait plus
// a random part — a wide one, so a page of failed tiles does not ask again
// in one burst: storage was busy, and every try is one more request to it
// (two, when the route makes its own second try). The first wait is the
// route's `Retry-After`: the route has already tried a passing glitch again
// by itself, so a picture that still failed is waiting on storage.
// Setting `src` to the value it already has is what restarts the load: the
// HTML standard's "update the image data" runs whenever the attribute is
// SET, and a failed picture is not in the browser's list of available
// images. After the last try the alt text stays, as before. Never the HD
// PNG, never another address — the same URL. The count belongs to ONE
// address: a picture that loads, or an <img> given another `src` (the deck
// pop-up reuses one element for every card), starts again from none.
// ---------------------------------------------------------------------------

/** The wait before each further try, in ms (a random part is added). */
export const RETRY_AFTER_MS = [5_000, 15_000];
/** The most the random part adds to each wait. */
export const RETRY_JITTER_MS = [5_000, 15_000];

const BAKE_PATH = "/render-cdn/";

function isBakeImage(target: EventTarget | null): target is HTMLImageElement {
  return target instanceof HTMLImageElement && (target.getAttribute("src") ?? "").includes(BAKE_PATH);
}

export function RenderImageRetry() {
  useEffect(() => {
    /** The tries already made for the address an <img> shows. */
    const tries = new WeakMap<HTMLImageElement, { src: string; done: number }>();
    const timers = new Set<ReturnType<typeof setTimeout>>();

    const retry = (img: HTMLImageElement) => {
      const src = img.getAttribute("src") ?? "";
      const before = tries.get(img);
      const done = before && before.src === src ? before.done : 0;
      if (done >= RETRY_AFTER_MS.length) return;
      tries.set(img, { src, done: done + 1 });
      const timer = setTimeout(
        () => {
          timers.delete(timer);
          // Gone from the page (a tile that dropped its back face, a
          // navigation), or pointed somewhere else meanwhile: leave it.
          if (!img.isConnected || img.getAttribute("src") !== src) return;
          img.setAttribute("src", src);
        },
        RETRY_AFTER_MS[done] + Math.random() * RETRY_JITTER_MS[done],
      );
      timers.add(timer);
    };

    const onError = (event: Event) => {
      if (isBakeImage(event.target)) retry(event.target);
    };
    // A picture that loaded owes nothing: its next failure starts from none.
    const onLoad = (event: Event) => {
      if (event.target instanceof HTMLImageElement) tries.delete(event.target);
    };
    document.addEventListener("error", onError, true);
    document.addEventListener("load", onLoad, true);
    for (const img of document.querySelectorAll<HTMLImageElement>(`img[src*="${BAKE_PATH}"]`)) {
      // `complete` with no pixels = the load ended in an error. A lazy
      // picture that has not started is not `complete`.
      if (img.complete && img.naturalWidth === 0) retry(img);
    }
    return () => {
      document.removeEventListener("error", onError, true);
      document.removeEventListener("load", onLoad, true);
      for (const timer of timers) clearTimeout(timer);
    };
  }, []);

  return null;
}
