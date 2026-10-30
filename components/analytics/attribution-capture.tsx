"use client";

import { useEffect } from "react";
import {
  ATTRIBUTION_STORAGE_KEY,
  attributionFromLanding,
  mergeLandingAttribution,
  sanitizeAttribution,
} from "@/lib/analytics/attribution";

// Runs once per tab: remembers the landing referrer host + UTM parameters in
// sessionStorage (first touch wins; the tab closing forgets it). Not a
// cookie, never sent anywhere by itself — the signup form reads it. A
// referral code (`?ref=`) a later landing brings is added once, if the tab
// holds none yet (mergeLandingAttribution).
export function AttributionCapture() {
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(ATTRIBUTION_STORAGE_KEY);
      const stored = raw != null ? sanitizeAttribution(JSON.parse(raw) as Record<string, unknown>) : null;
      const landing = attributionFromLanding({
        referrer: document.referrer,
        search: window.location.search,
        ownHost: window.location.hostname,
      });
      const next = mergeLandingAttribution(stored, landing);
      if (next === stored) return;
      sessionStorage.setItem(ATTRIBUTION_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Storage unavailable (private mode, blocked) — attribution is optional.
    }
  }, []);
  return null;
}
