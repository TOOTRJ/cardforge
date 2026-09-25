"use client";

import { useEffect, useRef } from "react";
import {
  ATTRIBUTION_FIELDS,
  ATTRIBUTION_STORAGE_KEY,
  sanitizeAttribution,
  type Attribution,
} from "@/lib/analytics/attribution";

const KEYS = Object.keys(ATTRIBUTION_FIELDS) as Array<keyof Attribution>;

// Hidden inputs on the signup form carrying the tab's first-touch
// attribution (see AttributionCapture). Uncontrolled on purpose: the effect
// fills them from sessionStorage after mount, so the server-rendered form
// and the hydrated one agree and no state changes are needed.
export function AttributionFields() {
  const refs = useRef<Partial<Record<keyof Attribution, HTMLInputElement | null>>>({});
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(ATTRIBUTION_STORAGE_KEY);
      if (!raw) return;
      const attribution = sanitizeAttribution(JSON.parse(raw) as Record<string, unknown>);
      for (const key of KEYS) {
        const input = refs.current[key];
        if (input) input.value = attribution[key] ?? "";
      }
    } catch {
      // Storage unavailable or unreadable — attribution is optional.
    }
  }, []);
  return (
    <>
      {KEYS.map((key) => (
        <input
          key={key}
          ref={(el) => {
            refs.current[key] = el;
          }}
          type="hidden"
          name={ATTRIBUTION_FIELDS[key]}
          defaultValue=""
        />
      ))}
    </>
  );
}
