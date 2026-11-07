"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, Layers, LibraryBig, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DeckQuickCreate } from "@/components/decks/deck-membership-picker";
import { getDeckPickerDataAction } from "@/lib/decks/membership-actions";
import { addToDeckAction } from "@/lib/decks/add-actions";
import { DECK_FORMAT_LABELS, type DeckFormat } from "@/types/deck";
import type { PickerDeck } from "@/lib/decks/membership-state";
import { EXACT_COPY_SAVE_REASON } from "@/lib/cards/exact-copy";
import {
  addToCollectionAction,
  getCollectionPrintingStateAction,
  type PrintingState,
} from "@/lib/tools/collection/actions";

// ---------------------------------------------------------------------------
// The creator's word while an import is untouched (lib/cards/exact-copy.ts):
// an exact copy of a real card is never saved as a PipGlyph card, so in
// place of Save's plain reason it says so and offers what the maker can do
// with the real card — put it in one of their decks, as the printing itself
// (a deck's printing entry uses no card slot), or, where the Collection Deck
// Builder beta tool is open to them, add the printing to their collection
// (migration 0185; a collection never uses card slots either). The tool's
// button shows only once the server says the tool is open: a closed tool is
// no button at all, never a refused click.
// ---------------------------------------------------------------------------

export function ExactCopyNotice({ realCardName, scryfallId }: { realCardName: string; scryfallId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className="flex flex-col gap-2 rounded-lg border border-gold/30 bg-gold/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
      data-testid="exact-copy-notice"
    >
      <p role="status" className="text-xs leading-5 text-gold">
        {EXACT_COPY_SAVE_REASON}
      </p>
      <div className="flex shrink-0 flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" className="shrink-0" onClick={() => setOpen(true)}>
          <Layers className="h-4 w-4" aria-hidden />
          Add the real card to a deck
        </Button>
        <AddToCollectionButton realCardName={realCardName} scryfallId={scryfallId} />
      </div>
      <AddPrintingToDeckDialog
        open={open}
        onOpenChange={setOpen}
        realCardName={realCardName}
        scryfallId={scryfallId}
      />
    </div>
  );
}

/** "Add to my collection" — one copy of this printing per press, the owned
 *  count beside it. Nothing at all unless the tool is open to the viewer. */
function AddToCollectionButton({ realCardName, scryfallId }: { realCardName: string; scryfallId: string }) {
  // The answer is kept with the printing it is for: another printing shows
  // nothing until its own answer lands.
  const [answer, setAnswer] = useState<{ id: string; state: PrintingState } | null>(null);
  const [adding, setAdding] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    const run = ++seq.current;
    getCollectionPrintingStateAction(scryfallId)
      .then((next) => {
        if (run === seq.current) setAnswer({ id: scryfallId, state: next });
      })
      .catch(() => {
        // The tool's door stays shut: the deck button is still there.
      });
  }, [scryfallId]);

  const state = answer?.id === scryfallId ? answer.state : null;
  if (!state?.open) return null;

  async function add() {
    setAdding(true);
    try {
      const result = await addToCollectionAction({ scryfallId, quantity: 1, finish: "nonfoil", surface: "creator" });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setAnswer({ id: scryfallId, state: { open: true, owned: result.owned } });
      toast.success(`Added ${realCardName} to your collection — you own ${result.owned.toLocaleString("en-US")}.`);
    } catch {
      toast.error("That card couldn't be added. Try again.");
    } finally {
      setAdding(false);
    }
  }

  return (
    <Button type="button" size="sm" variant="outline" className="shrink-0" onClick={() => void add()} disabled={adding}>
      {adding ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <LibraryBig className="h-4 w-4" aria-hidden />}
      Add to my collection
      {state.owned > 0 ? <span className="text-muted">(you own {state.owned.toLocaleString("en-US")})</span> : null}
    </Button>
  );
}

type LoadState = { state: "loading" } | { state: "error"; message: string } | { state: "ready"; decks: PickerDeck[] };

function AddPrintingToDeckDialog({
  open,
  onOpenChange,
  realCardName,
  scryfallId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  realCardName: string;
  scryfallId: string;
}) {
  const [load, setLoad] = useState<LoadState>({ state: "loading" });
  const [adding, setAdding] = useState<string | null>(null);
  const [added, setAdded] = useState<ReadonlySet<string>>(new Set());
  const seq = useRef(0);

  useEffect(() => {
    if (!open) return;
    const run = ++seq.current;
    // Read again on every open: a deck made elsewhere shows up.
    void getDeckPickerDataAction([]).then((result) => {
      if (run !== seq.current) return;
      setLoad(result.ok ? { state: "ready", decks: result.decks } : { state: "error", message: result.error });
    });
  }, [open]);

  async function add(deck: PickerDeck) {
    setAdding(deck.id);
    const result = await addToDeckAction({
      deckId: deck.id,
      board: "main",
      pick: { kind: "printing", scryfallId, name: realCardName },
    });
    setAdding(null);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setAdded((prev) => new Set(prev).add(deck.id));
    toast.success(`Added ${realCardName} to ${deck.title}.`);
  }

  const decks = load.state === "ready" ? load.decks : [];

  // Closed, it forgets the list: the next open shows "Loading…" until its
  // own read lands, never the last open's decks.
  function setOpen(next: boolean) {
    if (!next) setLoad({ state: "loading" });
    onOpenChange(next);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add {realCardName} to a deck</DialogTitle>
          <DialogDescription>
            The real card goes in as itself — it uses none of your card slots. Customise it later from the deck
            whenever you like.
          </DialogDescription>
        </DialogHeader>

        {load.state === "loading" ? (
          <p className="flex items-center gap-2 text-sm text-muted" role="status">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Loading your decks…
          </p>
        ) : load.state === "error" ? (
          <p className="text-sm text-danger" role="status">
            {load.message}
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {decks.length === 0 ? (
              <p className="text-sm text-muted">You have no decks yet — make one below.</p>
            ) : (
              <ul aria-label="Your decks" className="flex max-h-72 flex-col overflow-auto rounded-lg border border-border/60">
                {decks.map((deck) => {
                  const done = added.has(deck.id);
                  const format = DECK_FORMAT_LABELS[deck.format as DeckFormat];
                  return (
                    <li
                      key={deck.id}
                      className="flex items-center justify-between gap-3 border-b border-border/40 px-3 py-2 last:border-b-0"
                    >
                      <span className="flex min-w-0 flex-col">
                        {deck.slug ? (
                          <Link
                            href={`/deck/${deck.slug}`}
                            className="truncate rounded-sm text-sm font-medium text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60"
                          >
                            {deck.title}
                          </Link>
                        ) : (
                          <span className="truncate text-sm font-medium text-foreground">{deck.title}</span>
                        )}
                        {format ? <span className="text-xs text-subtle">{format}</span> : null}
                      </span>
                      <Button
                        type="button"
                        size="sm"
                        variant={done ? "secondary" : "outline"}
                        disabled={adding !== null}
                        onClick={() => void add(deck)}
                      >
                        {adding === deck.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                        ) : done ? (
                          <Check className="h-4 w-4" aria-hidden />
                        ) : (
                          <Plus className="h-4 w-4" aria-hidden />
                        )}
                        {done ? "Add another" : "Add"}
                        <span className="sr-only"> to {deck.title}</span>
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
            <DeckQuickCreate
              surface="creator"
              onCreated={async (deck) => {
                setLoad((prev) => (prev.state === "ready" ? { state: "ready", decks: [deck, ...prev.decks] } : prev));
                await add(deck);
              }}
            />
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
