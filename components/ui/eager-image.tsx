"use client";

import type { ComponentProps } from "react";

// ---------------------------------------------------------------------------
// An EAGER <img> that a Server Component wants to draw — the first row of a
// page, its largest picture.
//
// React (19.2) writes a preload hint into a page's RSC payload for every
// image a SERVER component renders that is not `loading="lazy"`. That
// payload is what a <Link> prefetch fetches — so every page that links to
// the home page (the logo: all of them) preloaded the home page's six
// trending thumbnails at HIGH priority the moment it loaded: 431 KB on
// /pricing that the page never showed, and Chrome's "was preloaded using
// link preload but not used" for each (measured on production, 2026-11-11).
//
// Drawn from this client leaf, the image is not part of the server
// component render: no hint travels with a prefetch. On its OWN page the
// HTML still carries the <img> — and React's HTML renderer still preloads it
// there — so the page's largest picture loads as early as it did.
//
// Use it only for an image that must not be lazy. Everything else a server
// component draws is `loading="lazy"`.
// ---------------------------------------------------------------------------

export function EagerImage({ alt, ...rest }: ComponentProps<"img"> & { alt: string }) {
  // eslint-disable-next-line @next/next/no-img-element -- our own CDN paths and thumbnails; no optimizer hop
  return <img alt={alt} {...rest} />;
}
