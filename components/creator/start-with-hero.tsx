"use client";

import { Search, Sparkles, FileSymlink } from "lucide-react";

// ---------------------------------------------------------------------------
// StartWithHero — the 3-up "Start with…" callout above the card creator
// form on /create. Kills the empty-page stall for first-time users.
//
// Each option fires a custom DOM event the CardCreatorForm listens for:
//   - "cardforge:scroll-to-form"   → smooth-scroll the form into view
//   - "cardforge:open-scryfall"    → open the Scryfall import dialog
//   - "cardforge:open-ai-concept"  → switch to the Publishing tab and
//                                    scroll the AI assistant into view
//
// Event-based wiring keeps the hero decoupled from the form — they're
// siblings in the page tree but the page itself is a server component, so
// we can't share state via React props. Custom events are the simplest
// way for two client components to coordinate across a server-rendered
// parent.
// ---------------------------------------------------------------------------

export const CARDFORGE_EVENTS = {
  scrollToForm: "cardforge:scroll-to-form",
  openScryfall: "cardforge:open-scryfall",
  openAiConcept: "cardforge:open-ai-concept",
} as const;

type Option = {
  key: keyof typeof CARDFORGE_EVENTS;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  accentClass: string;
};

const OPTIONS: Option[] = [
  {
    key: "scrollToForm",
    label: "Blank canvas",
    description: "Start from an empty card and fill in every field yourself.",
    icon: FileSymlink,
    accentClass: "from-elevated/60 to-elevated/30 hover:border-border-strong",
  },
  {
    key: "openScryfall",
    label: "Search a real card",
    description: "Pull text, type, and artwork from a real card to remix.",
    icon: Search,
    accentClass:
      "from-primary/15 to-primary/5 hover:border-primary/60 border-primary/30",
  },
  {
    key: "openAiConcept",
    label: "Generate from concept",
    description: "Describe an idea in a sentence; AI drafts the full card.",
    icon: Sparkles,
    accentClass:
      "from-accent/15 to-accent/5 hover:border-accent/60 border-accent/30",
  },
];

export function StartWithHero() {
  const handleClick = (key: Option["key"]) => {
    const eventName = CARDFORGE_EVENTS[key];
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent(eventName));
  };

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {OPTIONS.map((option) => {
        const Icon = option.icon;
        return (
          <button
            key={option.key}
            type="button"
            onClick={() => handleClick(option.key)}
            className={`group flex flex-col gap-3 rounded-xl border bg-linear-to-br ${option.accentClass} p-5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background`}
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-md border border-white/10 bg-background/40 text-foreground">
              <Icon className="h-4 w-4" aria-hidden />
            </span>
            <div className="flex flex-col gap-1">
              <p className="font-display text-sm font-semibold tracking-wide text-foreground">
                {option.label}
              </p>
              <p className="text-xs leading-5 text-muted">{option.description}</p>
            </div>
            <span className="mt-auto text-[11px] uppercase tracking-wider text-subtle group-hover:text-foreground">
              {option.key === "scrollToForm"
                ? "Open the form ↓"
                : option.key === "openScryfall"
                  ? "Search Scryfall →"
                  : "Open AI assistant →"}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// Also export a hidden-anchor helper so the form can declare a known
// scroll-target id. Lets the hero's "Blank canvas" option scroll to the
// form section without coupling either side to a magic string.
export const FORM_SCROLL_TARGET_ID = "cardforge-form";
