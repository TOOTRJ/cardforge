"use client";

import { track } from "@vercel/analytics";
import { sendGAEvent } from "@next/third-parties/google";
import { sanitizeFunnelProps, type ClientFunnelEvent, type FunnelProps } from "./funnel-events";

// The browser side of funnel instrumentation: one call posts the step to
// /api/events (first-party, survives navigation via sendBeacon) and mirrors
// it to Vercel Analytics and GA4 when they're mounted. Fire-and-forget —
// nothing here can throw into the UI.
export function trackFunnelEvent(event: ClientFunnelEvent, props: FunnelProps = {}): void {
  const clean = sanitizeFunnelProps(props);
  try {
    const body = JSON.stringify({ event, props: clean });
    let sent = false;
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      sent = navigator.sendBeacon("/api/events", new Blob([body], { type: "text/plain" }));
    }
    if (!sent && typeof fetch === "function") {
      void fetch("/api/events", {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body,
        keepalive: true,
      }).catch(() => {});
    }
  } catch {
    // ignore
  }
  try {
    track(event, clean);
  } catch {
    // ignore
  }
  try {
    if (process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID) sendGAEvent("event", event, clean);
  } catch {
    // ignore
  }
}
