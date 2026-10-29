"use client";

import { useId, useState } from "react";
import { ClipboardCopy, FileText, ScrollText } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

// ---------------------------------------------------------------------------
// DeckCopyDecklist — "Copy decklist" in the deck header, beside Share (deck
// audit 2026-10-28, M2 / TODO DK0.7). FREE: the owner on every plan and
// every visitor of a public or unlisted deck. Only the FILE exports (the
// ZIP, the print PDF) are Pro — components/decks/deck-export-menu.tsx.
//
// Both texts are built on the server from the rows the viewer read
// (lib/decks/export-text.ts): a real card keeps its real name and printing
// (the list pastes back into Arena or an import), a custom card with no
// real card takes the title the viewer's list shows, and a private card
// they can't read keeps its entry name.
// ---------------------------------------------------------------------------

type DeckCopyDecklistProps = {
  /** `qty Name` lines, the sideboard after a blank line. */
  plainText: string;
  /** MTG Arena's sections, with set and collector number. */
  arenaText: string;
};

const OPTION_CLASS =
  "flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/50";

export function DeckCopyDecklist({ plainText, arenaText }: DeckCopyDecklistProps) {
  const [open, setOpen] = useState(false);
  const id = useId();

  const copy = async (label: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copied to your clipboard.`);
      setOpen(false);
    } catch {
      toast.error("Couldn't access the clipboard.");
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost">
          <ClipboardCopy className="h-4 w-4" aria-hidden />
          Copy decklist
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-1.5" aria-label="Copy decklist">
        <div role="group" aria-label="Copy the decklist as" className="flex flex-col gap-0.5">
          {/* Each option is named by its format alone; the line under it
              describes it. */}
          <button
            type="button"
            className={OPTION_CLASS}
            aria-label="Plain text"
            aria-describedby={`${id}-plain`}
            onClick={() => copy("Decklist", plainText)}
          >
            <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden />
            <span className="flex flex-col gap-0.5">
              <span className="text-sm font-medium text-foreground">Plain text</span>
              <span id={`${id}-plain`} className="text-xs leading-4 text-subtle">
                One card per line, the sideboard after a blank line
              </span>
            </span>
          </button>
          <button
            type="button"
            className={OPTION_CLASS}
            aria-label="Arena format"
            aria-describedby={`${id}-arena`}
            onClick={() => copy("Arena decklist", arenaText)}
          >
            <ScrollText className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden />
            <span className="flex flex-col gap-0.5">
              <span className="text-sm font-medium text-foreground">Arena format</span>
              <span id={`${id}-arena`} className="text-xs leading-4 text-subtle">
                MTG Arena&apos;s sections, with set and collector number
              </span>
            </span>
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
