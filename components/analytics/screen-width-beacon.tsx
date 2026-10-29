"use client";

import { useEffect } from "react";
import { postFunnelEvent } from "@/lib/analytics/funnel-client";
import { reportScreenWidthOnce } from "@/lib/analytics/screen-width";

// TODO WD9: once per tab session, the viewport's width BUCKET goes to
// /api/events (first-party only — never GA4 or Vercel Analytics) as an
// anonymous `screen_width` row. The width is `window.innerWidth` in CSS px —
// the width the layout is drawn at (zoom and the device pixel ratio already
// applied), not the screen's resolution. Mounted once in the root layout, so
// client navigations never re-run it; a reload finds the sessionStorage flag.
// Crawlers are dropped by /api/events (isbot); automation (Playwright,
// headless Chrome with a real UA) by `navigator.webdriver`; a page the
// browser PRERENDERS (Speculation Rules) waits until it is really shown, so
// a prerender nobody opens counts nothing.
export function ScreenWidthBeacon() {
  useEffect(() => {
    if (navigator.webdriver) return;
    const report = () =>
      reportScreenWidthOnce({
        storage: () => window.sessionStorage,
        width: window.innerWidth,
        send: (bucket) => postFunnelEvent("screen_width", { bucket }),
      });
    const doc = document as Document & { prerendering?: boolean };
    if (doc.prerendering) {
      doc.addEventListener("prerenderingchange", report, { once: true });
      return () => doc.removeEventListener("prerenderingchange", report);
    }
    report();
  }, []);
  return null;
}
