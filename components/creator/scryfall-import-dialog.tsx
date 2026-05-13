"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import {
  Loader2,
  Search,
  Sparkles,
  X,
  ExternalLink,
  ImageDown,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ManaCostGlyphs } from "@/components/cards/mana-cost-glyphs";
import type { ScryfallImportPatch } from "@/lib/scryfall/import-mapper";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// ScryfallImportDialog — typeahead modal that lets the user pick a real
// card to seed the form. Authorized by the project owner to display and
// import official artwork (CLAUDE.md guardrails explicitly overridden for
// this feature; see 10_REMIX_AND_INSPIRATION.md).
//
// Two-pane layout:
//   - left: search input + scrollable result list
//   - right: detail preview of the selected card + "Use as starting point"
// On smaller screens the right pane stacks under the left.
// ---------------------------------------------------------------------------

const SEARCH_DEBOUNCE_MS = 250;

type TrimmedCard = {
  id: string;
  name: string;
  set: string | null;
  set_name: string | null;
  type_line: string | null;
  mana_cost: string | null;
  rarity: string | null;
  artist: string | null;
  thumb_url: string | null;
  print_url: string | null;
  oracle_text: string | null;
};

type NamedResponse = {
  ok: true;
  card: {
    id: string;
    name: string;
    set: string | null;
    set_name: string | null;
    print_url: string | null;
    thumb_url: string | null;
    scryfall_uri: string | null;
  };
  patch: ScryfallImportPatch;
};

type ImportArtResponse =
  | {
      ok: true;
      publicUrl: string;
      artist: string | null;
      source: { scryfallId: string; cardName: string; scryfallUri: string | null };
    }
  | { ok: false; error: string };

export type ScryfallImportPayload = {
  patch: ScryfallImportPatch;
  /** When set, the form should write this URL into `art_url` (the user
   *  opted to also import the artwork). */
  importedArtUrl?: string | null;
  /** Display-only fields surfaced near the form save bar to remind the
   *  user this card is a remix. */
  source: {
    name: string;
    scryfallUri: string | null;
  };
};

type ScryfallImportDialogProps = {
  /** Whether the user is signed in. Disables the trigger if not. */
  signedIn: boolean;
  /** Called when the user commits to a starting-point. Parent merges the
   *  patch into the form state and optionally consumes `importedArtUrl`. */
  onImport: (payload: ScryfallImportPayload) => void;
  /** Label override for the trigger button. */
  triggerLabel?: string;
  triggerVariant?: "primary" | "secondary" | "outline" | "ghost";
};

export function ScryfallImportDialog({
  signedIn,
  onImport,
  triggerLabel = "Search a real card",
  triggerVariant = "outline",
}: ScryfallImportDialogProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant={triggerVariant}
        onClick={() => setOpen(true)}
        disabled={!signedIn}
        title={
          signedIn ? undefined : "Sign in to search and import real cards."
        }
      >
        <Search className="h-4 w-4" aria-hidden />
        {triggerLabel}
      </Button>
      {open ? (
        <DialogBody onClose={() => setOpen(false)} onImport={onImport} />
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Dialog body — only mounted while open. Splitting it out means each open
// gets a fresh state slot (no stale results from a previous session).
// ---------------------------------------------------------------------------

function DialogBody({
  onClose,
  onImport,
}: {
  onClose: () => void;
  onImport: (payload: ScryfallImportPayload) => void;
}) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TrimmedCard[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedCard, setSelectedCard] = useState<NamedResponse | null>(null);
  const [loadingSelected, setLoadingSelected] = useState(false);

  const [importArt, setImportArt] = useState(true);
  const [committing, startCommit] = useTransition();

  // Esc + click-outside close, focus the search box on open.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    searchInputRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Debounced search. Each keystroke schedules a fetch SEARCH_DEBOUNCE_MS
  // later; we cancel via an abort controller if the query changes mid-flight.
  //
  // Note: all setState calls live inside the setTimeout callback (i.e.
  // outside the synchronous effect body) so we satisfy the
  // react-hooks/set-state-in-effect rule. The empty-query branch also
  // happens inside the timer for the same reason.
  useEffect(() => {
    const q = query.trim();
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      if (!q) {
        setResults([]);
        setSearchError(null);
        return;
      }
      setSearching(true);
      setSearchError(null);
      try {
        const response = await fetch(
          `/api/scryfall/search?${new URLSearchParams({ q, limit: "12" })}`,
          { signal: controller.signal },
        );
        const body = await response.json().catch(() => ({}));
        if (!response.ok || !body?.ok) {
          setResults([]);
          setSearchError(
            typeof body?.error === "string" ? body.error : "Search failed.",
          );
          return;
        }
        setResults(Array.isArray(body.results) ? body.results : []);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setSearchError("Search failed.");
      } finally {
        setSearching(false);
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query]);

  // When the user picks a result, fetch the full card so we can show the
  // detail preview and have a canonical patch to import.
  const handleSelect = useCallback(async (id: string) => {
    setSelectedId(id);
    setSelectedCard(null);
    setLoadingSelected(true);
    try {
      const response = await fetch(
        `/api/scryfall/named?${new URLSearchParams({ id })}`,
      );
      const body = (await response.json().catch(() => null)) as
        | NamedResponse
        | { ok: false; error: string }
        | null;
      if (!body || body.ok !== true) {
        toast.error(
          (body && "error" in body && body.error) || "Could not load card.",
        );
        setSelectedCard(null);
        return;
      }
      setSelectedCard(body);
    } catch {
      toast.error("Could not load card.");
    } finally {
      setLoadingSelected(false);
    }
  }, []);

  const handleConfirm = () => {
    if (!selectedCard) return;
    const card = selectedCard.card;
    const patch = selectedCard.patch;

    startCommit(async () => {
      let importedArtUrl: string | null = null;

      if (importArt) {
        try {
          const response = await fetch("/api/scryfall/import-art", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ scryfallId: card.id, mode: "art" }),
          });
          const body = (await response
            .json()
            .catch(() => null)) as ImportArtResponse | null;
          if (!body || body.ok !== true) {
            toast.error(
              (body && "error" in body && body.error) ||
                "Could not import artwork.",
            );
          } else {
            importedArtUrl = body.publicUrl;
          }
        } catch {
          toast.error("Could not import artwork.");
        }
      }

      onImport({
        patch,
        importedArtUrl,
        source: {
          name: card.name,
          scryfallUri: card.scryfall_uri,
        },
      });

      toast.success(
        importedArtUrl
          ? `Imported ${card.name} with artwork.`
          : `Seeded form with ${card.name}.`,
      );
      onClose();
    });
  };

  const selectionPreview = useMemo(() => {
    if (loadingSelected) return "loading" as const;
    if (selectedCard) return "ready" as const;
    if (selectedId) return "loading" as const;
    return "empty" as const;
  }, [selectedCard, selectedId, loadingSelected]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center px-4 py-10 sm:items-center"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="absolute inset-0 bg-background/70 backdrop-blur-sm"
        aria-hidden
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="scryfall-import-title"
        tabIndex={-1}
        className={cn(
          "relative z-10 flex max-h-[85vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-2xl",
          "focus-visible:outline-none",
        )}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-border/60 px-5 py-4">
          <div className="flex flex-col gap-1">
            <h2
              id="scryfall-import-title"
              className="font-display text-lg font-semibold tracking-tight text-foreground"
            >
              Search a card to remix
            </h2>
            <p className="text-xs leading-5 text-muted">
              Pick a real card to seed your draft. Source data and images
              come from{" "}
              <a
                href="https://scryfall.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline-offset-2 hover:underline"
              >
                Scryfall
              </a>
              . You can edit every field afterward.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="rounded-md p-1 text-muted transition-colors hover:bg-elevated hover:text-foreground"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        {/* Body */}
        <div className="grid flex-1 min-h-0 grid-cols-1 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
          {/* Left: search + list */}
          <div className="flex min-h-0 flex-col border-b border-border/60 lg:border-b-0 lg:border-r">
            <div className="flex items-center gap-2 border-b border-border/60 px-4 py-3">
              <Search className="h-4 w-4 text-subtle" aria-hidden />
              <input
                ref={searchInputRef}
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="e.g. Lightning Bolt, t:dragon r:rare"
                className="h-8 flex-1 bg-transparent text-sm text-foreground placeholder:text-subtle focus:outline-none"
                aria-label="Search Scryfall"
              />
              {searching ? (
                <Loader2
                  className="h-4 w-4 animate-spin text-subtle"
                  aria-hidden
                />
              ) : null}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {searchError ? (
                <p className="px-4 py-3 text-xs text-danger">{searchError}</p>
              ) : null}
              {!query.trim() ? (
                <SearchTips />
              ) : results.length === 0 && !searching ? (
                <p className="px-4 py-6 text-center text-xs text-subtle">
                  No matches.
                </p>
              ) : (
                <ul role="listbox" aria-label="Search results">
                  {results.map((card) => (
                    <li key={card.id}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={selectedId === card.id}
                        onClick={() => handleSelect(card.id)}
                        className={cn(
                          "flex w-full items-start gap-3 border-b border-border/40 px-3 py-2 text-left transition-colors hover:bg-elevated/60",
                          selectedId === card.id ? "bg-elevated/80" : "",
                        )}
                      >
                        {card.thumb_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={card.thumb_url}
                            alt=""
                            className="h-12 w-16 shrink-0 rounded-sm object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <div className="h-12 w-16 shrink-0 rounded-sm bg-elevated" />
                        )}
                        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span className="truncate text-sm font-medium text-foreground">
                            {card.name}
                          </span>
                          <span className="truncate text-[11px] uppercase tracking-wider text-subtle">
                            {card.set ? card.set.toUpperCase() : "—"}
                            {card.rarity ? ` · ${card.rarity}` : ""}
                          </span>
                          {card.mana_cost ? (
                            <ManaCostGlyphs cost={card.mana_cost} size="sm" />
                          ) : null}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* Right: preview */}
          <div className="flex min-h-0 flex-col overflow-y-auto">
            {selectionPreview === "empty" ? (
              <DetailEmpty />
            ) : selectionPreview === "loading" ? (
              <div className="flex h-full items-center justify-center p-8">
                <Loader2
                  className="h-6 w-6 animate-spin text-subtle"
                  aria-hidden
                />
              </div>
            ) : selectedCard ? (
              <Detail
                data={selectedCard}
                importArt={importArt}
                onImportArtChange={setImportArt}
              />
            ) : null}
          </div>
        </div>

        {/* Footer */}
        <div className="flex flex-col gap-2 border-t border-border/60 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[11px] leading-5 text-subtle">
            Imported text and artwork remain subject to their original
            copyright. Use the disclaimer page for the full notice.
          </p>
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={handleConfirm}
              disabled={!selectedCard || committing}
            >
              {committing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  Working…
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" aria-hidden />
                  Use as starting point
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SearchTips() {
  return (
    <div className="flex flex-col gap-3 px-4 py-5 text-xs leading-5 text-subtle">
      <p>
        Type a card name to search, or use Scryfall&apos;s syntax for richer
        queries:
      </p>
      <ul className="flex flex-col gap-1 text-foreground/85">
        <li>
          <code className="font-mono text-[11px] text-foreground">
            t:dragon r:mythic
          </code>{" "}
          — mythic dragons
        </li>
        <li>
          <code className="font-mono text-[11px] text-foreground">
            c:gw cmc&lt;=3
          </code>{" "}
          — green/white, 3 mana or less
        </li>
        <li>
          <code className="font-mono text-[11px] text-foreground">
            o:&quot;draw a card&quot;
          </code>{" "}
          — oracle text contains
        </li>
      </ul>
    </div>
  );
}

function DetailEmpty() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
      <Sparkles className="h-6 w-6 text-subtle" aria-hidden />
      <p className="text-sm text-muted">Pick a card to preview.</p>
      <p className="text-xs text-subtle">
        Imported fields will appear here before you commit.
      </p>
    </div>
  );
}

function Detail({
  data,
  importArt,
  onImportArtChange,
}: {
  data: NamedResponse;
  importArt: boolean;
  onImportArtChange: (next: boolean) => void;
}) {
  const { card, patch } = data;
  return (
    <div className="flex flex-col gap-4 p-5">
      <div className="grid gap-4 sm:grid-cols-[180px_minmax(0,1fr)]">
        <div className="flex flex-col gap-2">
          {card.print_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={card.print_url}
              alt={`Print of ${card.name}`}
              className="w-full rounded-lg border border-border/60 shadow-md"
            />
          ) : (
            <div className="aspect-[5/7] w-full rounded-lg bg-elevated" />
          )}
          {card.scryfall_uri ? (
            <a
              href={card.scryfall_uri}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 self-start text-[11px] uppercase tracking-wider text-primary underline-offset-2 hover:underline"
            >
              <ExternalLink className="h-3 w-3" aria-hidden /> View on Scryfall
            </a>
          ) : null}
        </div>

        <div className="flex flex-col gap-3">
          <div>
            <h3 className="font-display text-lg font-semibold tracking-tight text-foreground">
              {card.name}
            </h3>
            <p className="text-xs uppercase tracking-wider text-subtle">
              {card.set_name ?? card.set ?? "Unknown set"}
            </p>
          </div>

          <PatchPreview patch={patch} />

          <label className="mt-2 inline-flex cursor-pointer items-start gap-2 rounded-md border border-border/60 bg-elevated/40 p-3 text-xs leading-5 text-muted">
            <input
              type="checkbox"
              checked={importArt}
              onChange={(event) => onImportArtChange(event.target.checked)}
              className="mt-0.5 accent-primary"
            />
            <span className="flex flex-col gap-0.5">
              <span className="inline-flex items-center gap-1.5 text-foreground">
                <ImageDown className="h-3.5 w-3.5" aria-hidden /> Also import
                artwork
              </span>
              <span>
                Server downloads the art crop into your card-art bucket. You
                can replace it later.
              </span>
            </span>
          </label>
        </div>
      </div>

      <Disclaimer />
    </div>
  );
}

function PatchPreview({ patch }: { patch: ScryfallImportPatch }) {
  const rows: Array<{ label: string; value: React.ReactNode }> = [];
  if (patch.cost) {
    rows.push({
      label: "Cost",
      value: <ManaCostGlyphs cost={patch.cost} size="sm" />,
    });
  }
  if (patch.card_type) {
    rows.push({
      label: "Type",
      value: (
        <span className="capitalize">
          {[patch.supertype, patch.card_type, patch.subtypes_text ? `— ${patch.subtypes_text}` : null]
            .filter(Boolean)
            .join(" ")}
        </span>
      ),
    });
  }
  if (patch.rarity) {
    rows.push({ label: "Rarity", value: <span className="capitalize">{patch.rarity}</span> });
  }
  if (patch.color_identity && patch.color_identity.length > 0) {
    rows.push({
      label: "Colors",
      value: (
        <span className="capitalize">{patch.color_identity.join(" · ")}</span>
      ),
    });
  }
  if (patch.rules_text) {
    rows.push({
      label: "Rules",
      value: (
        <span className="block whitespace-pre-line text-foreground/85">
          {patch.rules_text}
        </span>
      ),
    });
  }
  if (patch.flavor_text) {
    rows.push({
      label: "Flavor",
      value: (
        <span className="italic text-subtle">{patch.flavor_text}</span>
      ),
    });
  }
  if (patch.power || patch.toughness) {
    rows.push({
      label: "P/T",
      value: `${patch.power ?? "—"} / ${patch.toughness ?? "—"}`,
    });
  }
  if (patch.artist_credit) {
    rows.push({ label: "Artist", value: patch.artist_credit });
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] uppercase tracking-wider text-subtle">
        Will populate
      </span>
      <dl className="flex flex-col gap-1.5 rounded-md border border-border/40 bg-background/30 p-3 text-xs leading-5">
        {rows.length === 0 ? (
          <span className="text-subtle">No fields to populate.</span>
        ) : (
          rows.map((row) => (
            <div key={row.label} className="grid grid-cols-[64px_minmax(0,1fr)] gap-3">
              <dt className="text-[11px] uppercase tracking-wider text-subtle">
                {row.label}
              </dt>
              <dd className="text-foreground/90">{row.value}</dd>
            </div>
          ))
        )}
      </dl>
    </div>
  );
}

function Disclaimer() {
  return (
    <div className="flex items-start gap-2 rounded-md border border-accent/30 bg-accent/5 px-3 py-2 text-[11px] leading-5 text-muted">
      <Badge variant="accent" className="shrink-0">
        Heads up
      </Badge>
      <p>
        Imported text and artwork are the property of their respective
        rights holders. CardForge surfaces them so you can riff on real
        designs — rewrite the rules text and swap the art before
        publishing publicly to keep your card original.
      </p>
    </div>
  );
}
