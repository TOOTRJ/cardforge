"use client";

import type { LucideIcon } from "lucide-react";
import { ClipboardPaste, Crown, LibraryBig, Search } from "lucide-react";
import { openDeckTool, type DeckTool } from "@/components/decks/deck-owner-tools";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// An empty deck's first screen (TODO DK4.4) — three doors for the owner, and
// for a deck played with a commander a "Choose your commander" slot (also
// shown, compact, over the cards of a commander deck that has none yet).
//
// Each door opens a flow the page already has (DeckOwnerTools, through
// openDeckTool): the decklist import — typed card names, or a pasted list —
// and "Add from my cards". The full add box, one search over my cards,
// PipGlyph cards and real cards (TODO DK5.2), comes later; until then the
// first door says what it really does — you type the names, Scryfall
// matches them, and you check every match — never "search". The commander
// slot opens the same two flows with the commander zone chosen: the import
// starts its text under "Commander", and a card of yours is added straight
// to the zone.
// ---------------------------------------------------------------------------

const DOORS: Array<{ tool: DeckTool; icon: LucideIcon; title: string; body: string }> = [
  {
    tool: "names",
    icon: Search,
    title: "Add cards by name",
    body: "Type the cards you want, one a line. Each is matched on Scryfall, and you check every match before it's added.",
  },
  {
    tool: "paste",
    icon: ClipboardPaste,
    title: "Paste a decklist",
    body: "From Moxfield, Archidekt, MTG Arena, ManaBox or plain text — sideboard and commander sections included.",
  },
  {
    tool: "my-cards",
    icon: LibraryBig,
    title: "Add from my cards",
    body: "The cards you've made on PipGlyph, a copy at a time.",
  },
];

const DOOR_CLASS =
  "group flex h-full w-full flex-col items-start gap-2 rounded-card border border-border/70 bg-surface/80 p-5 text-left transition-colors hover:border-primary/60 hover:bg-elevated/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/** The owner's empty deck: the commander slot (if the format has one) and
 *  the three doors. */
export function DeckStartDoors({ commander }: { commander: boolean }) {
  return (
    <div className="flex flex-col gap-5 rounded-frame border border-dashed border-border bg-surface/40 p-4 sm:p-6">
      <div className="flex flex-col gap-1">
        <h3 className="font-display text-lg font-semibold text-foreground">Start your deck</h3>
        <p className="text-sm leading-6 text-muted">
          {commander ? "Choose a commander, then add the rest of the deck — any way you like." : "Add cards any way you like; you can mix all three."}
        </p>
      </div>
      {commander ? <CommanderSlot /> : null}
      <ul className="grid gap-3 md:grid-cols-3">
        {DOORS.map(({ tool, icon: Icon, title, body }) => (
          <li key={tool}>
            <button type="button" onClick={(event) => openDeckTool(tool, event.currentTarget)} className={DOOR_CLASS}>
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-elevated text-gold transition-colors group-hover:text-primary-bright">
                <Icon className="h-4 w-4" aria-hidden />
              </span>
              <span className="text-sm font-semibold text-foreground">{title}</span>
              <span className="text-sm leading-6 text-muted">{body}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** "Choose your commander": the commander zone's empty place. `compact` is
 *  the one-line version over the cards of a deck that has cards but no
 *  commander yet. */
export function CommanderSlot({ compact = false }: { compact?: boolean }) {
  return (
    <section
      aria-labelledby={compact ? "commander-slot-title-compact" : "commander-slot-title"}
      className={cn(
        "flex gap-4 rounded-card border border-dashed border-gold/50 bg-gold/5",
        compact ? "flex-col p-3 sm:flex-row sm:items-center sm:justify-between" : "flex-col items-start p-4 sm:flex-row sm:items-center",
      )}
    >
      <div className="flex items-center gap-3">
        {compact ? (
          <Crown className="h-4 w-4 shrink-0 text-gold" aria-hidden />
        ) : (
          // The zone's empty place: a card-shaped outline with the crown.
          <span aria-hidden className="flex aspect-[5/7] w-16 shrink-0 items-center justify-center card-corners border-2 border-dashed border-gold/50 text-gold">
            <Crown className="h-5 w-5" />
          </span>
        )}
        <div className="flex flex-col gap-0.5">
          <h3
            id={compact ? "commander-slot-title-compact" : "commander-slot-title"}
            className={cn("font-semibold text-foreground", compact ? "text-sm" : "text-base")}
          >
            {compact ? "No commander yet" : "Choose your commander"}
          </h3>
          <p className="text-xs leading-5 text-muted">
            {compact ? "Commander decks are led by one (or two partners)." : "The legend that leads the deck — a real card or one you made."}
          </p>
        </div>
      </div>
      <div className={cn("flex flex-wrap gap-2", !compact && "sm:ml-auto")}>
        <button
          type="button"
          onClick={(event) => openDeckTool("commander", event.currentTarget)}
          className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-sm font-medium text-foreground transition-colors hover:border-border-strong hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/50"
        >
          <Search className="h-3.5 w-3.5" aria-hidden />
          Type the commander’s name
        </button>
        <button
          type="button"
          onClick={(event) => openDeckTool("my-cards-commander", event.currentTarget)}
          className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-sm font-medium text-foreground transition-colors hover:border-border-strong hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/50"
        >
          <LibraryBig className="h-3.5 w-3.5" aria-hidden />
          Pick a commander from my cards
        </button>
      </div>
    </section>
  );
}
