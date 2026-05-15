"use client";

import { useEffect, useState } from "react";
import { Search } from "lucide-react";

// ---------------------------------------------------------------------------
// CommandPaletteTrigger — small "Search ⌘K" chip rendered in the site
// header. Dispatches a custom event the global CommandPalette listens
// for. Keeps the trigger decoupled from the palette's open state so the
// header itself can stay a server component.
//
// The modifier label swaps between ⌘ and Ctrl after hydration based on
// the user's platform. The initial server-rendered value is ⌘ — React
// is fine with a post-hydration text-content update.
// ---------------------------------------------------------------------------

const OPEN_EVENT = "cardforge:open-palette";

export function CommandPaletteTrigger() {
  const [mod, setMod] = useState<"⌘" | "Ctrl">("⌘");

  useEffect(() => {
    // Defer the platform-check setState out of the synchronous effect
    // body to satisfy the react-hooks/set-state-in-effect rule. The
    // platform doesn't change at runtime so a single microtask tick is
    // plenty.
    const timer = setTimeout(() => {
      const platform =
        (navigator as Navigator & { userAgentData?: { platform?: string } })
          .userAgentData?.platform || navigator.userAgent || "";
      if (!/mac/i.test(platform)) setMod("Ctrl");
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  return (
    <button
      type="button"
      onClick={() => {
        if (typeof window === "undefined") return;
        window.dispatchEvent(new CustomEvent(OPEN_EVENT));
      }}
      className="hidden h-9 items-center gap-2 rounded-full border border-border/70 bg-elevated px-3 text-xs text-muted transition-colors hover:border-border-strong hover:text-foreground md:inline-flex"
      aria-label="Open command palette"
    >
      <Search className="h-3.5 w-3.5" aria-hidden />
      <span>Search</span>
      <kbd
        className="ml-2 inline-flex items-center gap-0.5 rounded-sm border border-border bg-background/60 px-1.5 py-0.5 font-mono text-[10px] text-subtle"
        aria-hidden
      >
        {mod}K
      </kbd>
    </button>
  );
}
