"use client";

import { useEffect } from "react";

// ---------------------------------------------------------------------------
// HelpHashForward — sends an anchor that arrived on the hub to the section
// page holding it (TODO NV6). /faq is a 308 to /help and a browser keeps the
// fragment across a redirect, so an old /faq#exports link lands here as
// /help#exports; so does a short /help#what-is-a-bleed. A fragment never
// reaches the server, hence this island. The map is built on the server
// (lib/content/help.ts helpForwardTargets) and handed in, so the help data
// itself never ships to the browser for it.
//
// Without JavaScript the hub still carries the old topic anchors as ids on
// the section cards, so the browser scrolls to the right topic.
// ---------------------------------------------------------------------------

export function HelpHashForward({ targets }: { targets: Readonly<Record<string, string>> }) {
  useEffect(() => {
    const forward = () => {
      let key = window.location.hash.slice(1);
      try {
        key = decodeURIComponent(key);
      } catch {
        return;
      }
      const target = Object.hasOwn(targets, key) ? targets[key] : null;
      // replace(): the hub with a stale fragment never joins the history.
      if (target) window.location.replace(target);
    };
    forward();
    window.addEventListener("hashchange", forward);
    return () => window.removeEventListener("hashchange", forward);
  }, [targets]);
  return null;
}
