"use client";

import { useState } from "react";
import { ClipboardList, History, Layers, Loader2, Search, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SurfaceCard } from "@/components/ui/surface-card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { textareaClass, inputClass } from "@/components/ui/field-classes";
import { formatShortDate } from "@/lib/format/dates";
import type { KitSource } from "@/lib/tools/token-kit/actions";
import type { RecentTokenKit } from "@/lib/tools/token-kit/queries";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Where a kit comes from: one of your decks, a pasted list, or a kit you
// built before (its choices and pictures come back with it).
// ---------------------------------------------------------------------------

export type KitDeckOption = {
  id: string;
  title: string;
  format: string | null;
  cards: number;
  visibility: string;
};

const SAMPLE_PLACEHOLDER = "1 Goldspan Dragon\n1 Smothering Tithe\n1 Parallel Lives\n1 Raise the Alarm";

export function KitSourcePicker({
  decks,
  recent,
  pending,
  pendingLabel,
  error,
  onBuild,
}: {
  decks: KitDeckOption[];
  recent: RecentTokenKit[];
  pending: boolean;
  pendingLabel: string | null;
  error: string | null;
  onBuild: (source: KitSource, label: string) => void;
}) {
  const [tab, setTab] = useState(decks.length > 0 ? "deck" : "list");
  const [deckId, setDeckId] = useState<string | null>(decks[0]?.id ?? null);
  const [query, setQuery] = useState("");
  const [text, setText] = useState("");
  const shown = query.trim()
    ? decks.filter((deck) => deck.title.toLowerCase().includes(query.trim().toLowerCase()))
    : decks;
  const pickedDeck = decks.find((deck) => deck.id === deckId) ?? null;

  return (
    <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <SurfaceCard className="flex min-w-0 flex-col gap-5 p-4 sm:p-6">
        <div className="flex flex-col gap-1">
          <h2 className="font-display text-lg font-semibold text-foreground">Build a kit</h2>
          <p className="text-sm leading-6 text-muted">
            Every token, emblem and helper card your cards make — the Monarch, the Initiative, Day and Night — read
            from Scryfall and drawn in one design you choose. Kit tokens aren&apos;t saved cards: they never count
            toward your card limit.
          </p>
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList ariaLabel="Kit source">
            <TabsTrigger value="deck">
              <Layers className="h-4 w-4" aria-hidden /> Your decks
            </TabsTrigger>
            <TabsTrigger value="list">
              <ClipboardList className="h-4 w-4" aria-hidden /> Paste a list
            </TabsTrigger>
          </TabsList>

          <TabsContent value="deck" className="mt-4 flex flex-col gap-3">
            {decks.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted">
                You have no decks yet — paste a list instead.
              </p>
            ) : (
              <>
                {decks.length > 6 ? (
                  <label className="relative block">
                    <span className="sr-only">Find a deck</span>
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" aria-hidden />
                    <input
                      type="search"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Find a deck"
                      className={cn(inputClass(false), "pl-9")}
                    />
                  </label>
                ) : null}
                <ul className="flex max-h-80 flex-col gap-1.5 overflow-y-auto pr-1" aria-label="Your decks">
                  {shown.map((deck) => {
                    const active = deck.id === deckId;
                    return (
                      <li key={deck.id}>
                        <button
                          type="button"
                          aria-pressed={active}
                          onClick={() => setDeckId(deck.id)}
                          onDoubleClick={() => onBuild({ kind: "deck", deckId: deck.id }, deck.title)}
                          className={cn(
                            "flex w-full min-w-0 items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60",
                            active ? "border-primary/60 bg-primary/10" : "border-border/60 hover:border-border-strong hover:bg-elevated/50",
                          )}
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium text-foreground">{deck.title}</span>
                            <span className="block text-xs text-subtle">
                              {[deck.format ? capitalise(deck.format) : null, `${deck.cards} card${deck.cards === 1 ? "" : "s"}`, deck.visibility === "private" ? "Private" : null]
                                .filter(Boolean)
                                .join(" · ")}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                  {shown.length === 0 ? <li className="px-3 py-4 text-sm text-muted">No deck matches “{query}”.</li> : null}
                </ul>
                <Button
                  type="button"
                  className="self-start"
                  disabled={pending || !pickedDeck}
                  onClick={() => pickedDeck && onBuild({ kind: "deck", deckId: pickedDeck.id }, pickedDeck.title)}
                >
                  {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Wand2 aria-hidden />}
                  Build the kit
                </Button>
              </>
            )}
          </TabsContent>

          <TabsContent value="list" className="mt-4 flex flex-col gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold uppercase tracking-wider text-subtle">Decklist</span>
              <textarea
                value={text}
                onChange={(event) => setText(event.target.value)}
                rows={10}
                placeholder={SAMPLE_PLACEHOLDER}
                className={cn(textareaClass(false), "font-mono text-[13px] leading-6")}
                spellCheck={false}
              />
              <span className="text-xs leading-5 text-muted">
                One card a line — Moxfield, Archidekt, MTG Arena and plain lists all work. The maybeboard is left out.
              </span>
            </label>
            <Button
              type="button"
              className="self-start"
              disabled={pending || !text.trim()}
              onClick={() => onBuild({ kind: "list", text }, "Pasted list")}
            >
              {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Wand2 aria-hidden />}
              Build the kit
            </Button>
          </TabsContent>
        </Tabs>

        {pending && pendingLabel ? (
          <p role="status" className="flex items-center gap-2 text-sm text-muted">
            <Loader2 className="h-4 w-4 animate-spin text-gold" aria-hidden /> Reading {pendingLabel}’s cards from Scryfall…
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-foreground">
            {error}
          </p>
        ) : null}
      </SurfaceCard>

      <SurfaceCard className="flex min-w-0 flex-col gap-3 self-start p-4 sm:p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <History className="h-4 w-4 text-gold" aria-hidden /> Recent kits
        </h2>
        {recent.length === 0 ? (
          <p className="text-sm leading-6 text-muted">Kits you build keep their look, copies and pictures — they come back here.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {recent.map((kit) => (
              <li key={kit.id}>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    onBuild(kit.deckId ? { kind: "deck", deckId: kit.deckId } : { kind: "list", text: kit.sourceText ?? "" }, kit.title)
                  }
                  className="flex w-full min-w-0 flex-col rounded-lg border border-border/60 px-3 py-2 text-left hover:border-border-strong hover:bg-elevated/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60 disabled:opacity-60"
                >
                  <span className="truncate text-sm font-medium text-foreground">{kit.title}</span>
                  <span className="text-xs text-subtle">
                    {kit.deckId ? "Deck" : "Pasted list"} · {formatShortDate(kit.updatedAt)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </SurfaceCard>
    </div>
  );
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
