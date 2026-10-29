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
import { CARD_ORIGIN_TERMS } from "@/lib/content/glossary";

// ---------------------------------------------------------------------------
// CardGlossary — the shared "what do these words mean?" key: the site's
// card-origin vocabulary (owner 2026-10-28, TODO DK2) — Proxy, Import, Remix,
// Original. The words live in lib/content/glossary.ts (`CARD_ORIGIN_TERMS`),
// the one list /glossary reads too (TODO NV9).
// ---------------------------------------------------------------------------

export const GLOSSARY_TERMS = CARD_ORIGIN_TERMS;

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
        {/* The body's padding matches the header's px-5 (the list sat flush
            against the dialog's edge). */}
        <dl className="flex min-h-0 flex-col gap-4 overflow-y-auto px-5 py-4">
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
