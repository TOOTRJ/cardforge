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
// truth for the site's card-provenance vocabulary:
//
//   Remix        — any card altered from another card on the site, whether
//                  that source was pulled from Scryfall or made by another
//                  PipGlyph creator.
//   Proxy        — an exact stand-in for a real MTG card (imported from
//                  Scryfall and left unchanged). Tagged `proxy` automatically.
//   Custom proxy — a real card you altered in any way: your art, your
//                  wording, your frame — your version of the real thing.
// ---------------------------------------------------------------------------

export const GLOSSARY_TERMS = [
  {
    term: "Remix",
    definition:
      "Any card altered from another card on the site — a Scryfall import you changed, or your take on another creator's custom card.",
  },
  {
    term: "Proxy",
    definition:
      "An exact stand-in for a real MTG card, imported from Scryfall and left as-is. These are tagged “proxy” automatically.",
  },
  {
    term: "Custom proxy",
    definition:
      "A real card you altered in any way — new art, new wording, new frame. Your version of the real thing, and what deck printing uses.",
  },
] as const;

type CardGlossaryProps = {
  /** Trigger label; defaults to a compact help chip. */
  triggerLabel?: string;
};

export function CardGlossary({
  triggerLabel = "Remix vs. proxy?",
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
          <DialogTitle>Remix, proxy, custom proxy</DialogTitle>
          <DialogDescription>
            How PipGlyph talks about cards that start from other cards.
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
