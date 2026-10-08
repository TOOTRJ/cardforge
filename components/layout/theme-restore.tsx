"use client";

import { useLayoutEffect } from "react";
import { resolveSavedTheme } from "@/lib/theme-shared";

// ---------------------------------------------------------------------------
// ThemeRestore — the saved theme on a document the BROWSER rendered (mounted
// once in the root layout, beside the no-flash script it stands in for).
//
// That script only runs in HTML the server sent. When React renders the
// document itself, the script is an element it creates and never executes,
// and <html> takes its attributes from the root layout's props:
// data-theme="dark". That is every notFound() thrown above the Suspense
// boundaries — what the SEO contract asks for: a real 404 is Next's empty
// <html id="__next_error__"> shell, rendered by the client — an error thrown
// there, and a hydration React gives up on. A light-theme visitor got a dark
// page, and dark pages after it until a full reload.
//
// A LAYOUT effect on purpose. React writes <html>'s attributes in the commit
// that draws the page, before the layout effects of everything inside it, and
// the browser has not painted yet: the first frame is already the right
// palette. (An insertion effect runs before that write and loses to it; a
// passive one can run after the frame is painted.) It runs again whenever
// React takes <html> over again, because this component is inside it. On a
// server-rendered page the script was there first and this writes nothing.
// ---------------------------------------------------------------------------

export function ThemeRestore() {
  useLayoutEffect(() => {
    const root = document.documentElement;
    const theme = resolveSavedTheme();
    if (root.dataset.theme !== theme) root.dataset.theme = theme;
  }, []);

  return null;
}
