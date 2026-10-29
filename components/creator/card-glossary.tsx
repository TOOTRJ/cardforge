"use client";

import { HelpCircle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

// ---------------------------------------------------------------------------
// CardGlossary — the shared "what do these words mean?" key. One source of
// truth for the site's card-origin vocabulary (owner 2026-10-28, TODO DK2):
//
//   Proxy    — any card made on PipGlyph, including one started from a real
//              card. The umbrella word (and the one people print).
//   Import   — a card started from a real card through Scryfall.
//   Remix    — a new card started from another PipGlyph card, anyone's.
//   Original — a card made from scratch.
//
// "Custom proxy" is retired: every card made here is a proxy. Nothing tags a
// card by these words — they describe where it started.
// ---------------------------------------------------------------------------

export const GLOSSARY_TERMS = [
  {
    term: "Proxy",
    definition:
      "Any card made on PipGlyph. A card you start from a real Magic card is a proxy too, and any proxy can be printed for your table.",
  },
  {
    term: "Import",
    definition:
      "A card started from a real card, pulled in from Scryfall. Change its art, words or frame and it becomes your version.",
  },
  {
    term: "Remix",
    definition:
      "A new card started from another card made on PipGlyph, whether someone else's or one of yours. The card it came from keeps its credit.",
  },
  {
    term: "Original",
    definition: "A card made from scratch.",
  },
] as const;

type CardGlossaryProps = {
  /** Trigger label; defaults to a compact help chip. */
  triggerLabel?: string;
};

export function CardGlossary({
  triggerLabel = "Proxy, import or remix?",
}: CardGlossaryProps) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted transition-colors hover:border-border-strong hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/50"
        >
          <HelpCircle className="h-3 w-3" aria-hidden />
          {triggerLabel}
        </button>
      </DialogTrigger>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Proxy, import, remix, original</DialogTitle>
          <DialogDescription>
            The words PipGlyph uses for where a card starts.
          </DialogDescription>
        </DialogHeader>
        <dl className="flex flex-col gap-4">
          {GLOSSARY_TERMS.map(({ term, definition }) => (
            <div key={term} className="flex flex-col gap-1">
              <dt className="text-sm font-semibold text-foreground">{term}</dt>
              <dd className="text-sm leading-6 text-muted">{definition}</dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}
