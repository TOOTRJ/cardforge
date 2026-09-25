"use client";

import { useEffect } from "react";
import { ATTRIBUTION_STORAGE_KEY, attributionFromLanding } from "@/lib/analytics/attribution";

// Runs once per tab: remembers the landing referrer host + UTM parameters in
// sessionStorage (first touch wins; the tab closing forgets it). Not a
// cookie, never sent anywhere by itself — the signup form reads it.
export function AttributionCapture() {
  useEffect(() => {
    try {
      if (sessionStorage.getItem(ATTRIBUTION_STORAGE_KEY) != null) return;
      const attribution = attributionFromLanding({
        referrer: document.referrer,
        search: window.location.search,
        ownHost: window.location.hostname,
      });
      sessionStorage.setItem(ATTRIBUTION_STORAGE_KEY, JSON.stringify(attribution));
    } catch {
      // Storage unavailable (private mode, blocked) — attribution is optional.
    }
  }, []);
  return null;
}
