"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Search, X } from "lucide-react";
import { toast } from "sonner";
import { setFrameReferenceAction } from "@/lib/cards/frame-review-actions";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// FrameReferencePicker — lets the admin search Scryfall and pin the exact
// printing a (template, color) combo recreates in the compare tool. Reuses
// the existing /api/scryfall/search proxy (session auth + per-user quotas)
// with the import dialog's debounce pattern. Null pin = registry default.
// ---------------------------------------------------------------------------

const DEBOUNCE_MS = 300;

type SearchResult = {
  id: string;
  name: string;
  set: string | null;
  thumb_url: string | null;
  image_status: string | null;
};

export function FrameReferencePicker({
  template,
  colorKey,
  isCustom,
}: {
  template: string;
  colorKey: string;
  /** True when the active reference is admin-pinned (shows Revert). */
  isCustom: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      if (!q) {
        setResults([]);
        return;
      }
      setSearching(true);
      try {
        const response = await fetch(
          `/api/scryfall/search?${new URLSearchParams({ q, limit: "8" })}`,
          { signal: controller.signal },
        );
        const body = await response.json().catch(() => ({}));
        setResults(Array.isArray(body?.results) ? body.results : []);
      } catch {
        // aborted or failed — keep prior results
      } finally {
        setSearching(false);
      }
    }, DEBOUNCE_MS);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query, open]);

  const pin = (scryfallId: string | null) => {
    startTransition(async () => {
      const result = await setFrameReferenceAction({
        template,
        colorKey,
        scryfallId,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      if (result.warning) {
        toast.message(
          scryfallId ? `Reference set to ${result.name}` : "Reference reverted",
          { description: result.warning },
        );
      } else {
        toast.success(
          scryfallId
            ? `Reference set to ${result.name}.`
            : "Reverted to the default reference.",
        );
      }
      setOpen(false);
      setQuery("");
      setResults([]);
      router.refresh();
    });
  };

  return (
    <div className="relative">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-1 rounded-md border border-border/50 px-2.5 py-1.5 text-xs font-medium text-muted transition-colors hover:text-foreground"
        >
          <Search className="h-3.5 w-3.5" aria-hidden /> Change reference card
        </button>
        {isCustom ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => pin(null)}
            className="inline-flex items-center gap-1 rounded-md border border-border/50 px-2.5 py-1.5 text-xs font-medium text-muted transition-colors hover:text-foreground disabled:opacity-40"
          >
            <X className="h-3.5 w-3.5" aria-hidden /> Revert to default
          </button>
        ) : null}
      </div>

      {open ? (
        <div className="absolute right-0 top-full z-40 mt-2 w-80 rounded-lg border border-border/60 bg-surface p-2 shadow-xl">
          <div className="flex items-center gap-2 border-b border-border/50 px-2 pb-2">
            <Search className="h-3.5 w-3.5 text-subtle" aria-hidden />
            <input
              autoFocus
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search a printing… (e.g. Serra Angel e:m15)"
              className="h-8 flex-1 bg-transparent text-sm text-foreground placeholder:text-subtle focus:outline-none"
              aria-label="Search Scryfall for a reference card"
            />
            {searching || pending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-subtle" aria-hidden />
            ) : null}
          </div>
          <ul className="max-h-72 overflow-y-auto">
            {results.map((card) => (
              <li key={card.id}>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => pin(card.id)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-elevated",
                  )}
                >
                  {card.thumb_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={card.thumb_url}
                      alt=""
                      loading="lazy"
                      className="h-10 w-14 shrink-0 rounded-sm object-cover"
                    />
                  ) : (
                    <span className="h-10 w-14 shrink-0 rounded-sm bg-elevated" />
                  )}
                  <span className="flex min-w-0 flex-col leading-tight">
                    <span className="truncate text-xs text-foreground">
                      {card.name}
                    </span>
                    <span className="text-[10px] uppercase tracking-wider text-subtle">
                      {card.set ?? "—"}
                      {card.image_status === "lowres" ? " · low-res scan" : ""}
                    </span>
                  </span>
                </button>
              </li>
            ))}
            {!searching && query.trim() && results.length === 0 ? (
              <li className="px-2 py-3 text-center text-xs text-subtle">
                No matches.
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
