"use client";

import { useEffect } from "react";

// Escape hatch for URLs the card-detail interception matches but shouldn't
// own (e.g. /card/[slug]/edit, where the trailing segment lands in the
// [slug] position). A hard navigation to the same URL bypasses the
// interceptor entirely and loads the real route. Renders nothing — the
// underlying page stays visible for the beat before the reload.
export function HardNavigate() {
  useEffect(() => {
    window.location.reload();
  }, []);
  return null;
}
