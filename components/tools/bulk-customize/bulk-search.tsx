"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { Check, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/ui/field-classes";
import { PrintingPicture } from "@/components/tools/collection/printing-tile";
import { cn } from "@/lib/utils";
import { BULK_CUSTOMIZE_MAX_CARDS, printingCustomizeHref, type BulkSource } from "@/lib/tools/bulk-customize/model";
import { BulkCustomizeButton } from "./bulk-customize-button";

// ---------------------------------------------------------------------------
// The tool page's own door: search Scryfall (the shared /api/scryfall/search
// and its quota), tick results — the ticks survive a new search, so a batch
// can gather cards from several — and Customize them. One ticked card opens
// the creator on its printing; several the Bulk Customize dialog.
// ---------------------------------------------------------------------------

type Result = {
  id: string;
  name: string;
  set_name: string | null;
  type_line: string | null;
  thumb_url: string | null;
};

export function BulkSearch() {
  const inputId = useId();
  const statusId = useId();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [status, setStatus] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [ticked, setTicked] = useState<Map<string, Result>>(new Map());
  const abortRef = useRef<AbortController | null>(null);

  const search = async (event: FormEvent) => {
    event.preventDefault();
    const q = query.trim();
    if (!q) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setStatus("Searching…");
    try {
      const response = await fetch(`/api/scryfall/search?${new URLSearchParams({ q, limit: "30", order: "edhrec" })}`, {
        signal: controller.signal,
      });
      const body = (await response.json().catch(() => null)) as { ok?: boolean; results?: Result[]; error?: string } | null;
      if (!response.ok || !body?.ok) {
        setResults([]);
        setStatus(body?.error ?? "Search didn't work — try again.");
        return;
      }
      setResults(body.results ?? []);
      setStatus(body.results?.length ? `${body.results.length} cards found.` : "No cards match.");
    } catch (error) {
      if ((error as Error).name !== "AbortError") setStatus("Search didn't work — try again.");
    } finally {
      if (abortRef.current === controller) setLoading(false);
    }
  };

  const toggle = (card: Result) => {
    setTicked((prev) => {
      const next = new Map(prev);
      if (next.has(card.id)) next.delete(card.id);
      else if (next.size < BULK_CUSTOMIZE_MAX_CARDS) next.set(card.id, card);
      return next;
    });
  };

  const sources: BulkSource[] = [...ticked.keys()].map((id) => ({ kind: "scryfall", id }));
  const only = ticked.size === 1 ? [...ticked.values()][0] : null;

  return (
    <section aria-labelledby={`${inputId}-heading`} className="flex flex-col gap-4">
      <h2 id={`${inputId}-heading`} className="font-display text-lg text-foreground">
        Find real cards
      </h2>
      <form onSubmit={search} role="search" className="flex flex-wrap gap-2">
        <label htmlFor={inputId} className="sr-only">
          Search real cards
        </label>
        <input
          id={inputId}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="A card name, or Scryfall search like t:goblin c:r"
          aria-describedby={statusId}
          className={cn(inputClass(false), "min-w-0 flex-1")}
        />
        <Button type="submit" aria-disabled={loading ? true : undefined}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Search className="h-4 w-4" aria-hidden />}
          Search
        </Button>
      </form>
      <p id={statusId} role="status" className="text-sm text-muted">
        {status}
      </p>

      <div className="sticky top-2 z-10 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 bg-surface/95 p-3 backdrop-blur">
        <span className="text-sm text-foreground" aria-live="polite">
          {ticked.size === 0 ? "Tick the cards to customize." : `${ticked.size} ticked`}
        </span>
        <div className="flex items-center gap-2">
          {ticked.size > 0 ? (
            <Button variant="ghost" size="sm" onClick={() => setTicked(new Map())}>
              Clear
            </Button>
          ) : null}
          <BulkCustomizeButton
            sources={sources}
            oneCardHref={only ? printingCustomizeHref(only.id) : null}
            surface="search"
            onFinished={() => setTicked(new Map())}
          />
        </div>
      </div>

      {results.length > 0 ? (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {results.map((card) => {
            const on = ticked.has(card.id);
            return (
              <li key={card.id}>
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(card)}
                  className={cn(
                    "group relative flex w-full flex-col gap-1 rounded-lg p-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60",
                    on ? "bg-primary/15 ring-2 ring-primary" : "hover:bg-elevated",
                  )}
                >
                  <PrintingPicture imageUrl={card.thumb_url} name={card.name} size="normal" />
                  <span
                    aria-hidden
                    className={cn(
                      "absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full border",
                      on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background/80 text-transparent",
                    )}
                  >
                    <Check className="h-4 w-4" />
                  </span>
                  <span className="truncate text-sm font-medium text-foreground">{card.name}</span>
                  <span className="truncate text-xs text-subtle">{card.set_name ?? card.type_line}</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
