"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type TransitionStartFunction,
} from "react";
import { Loader2, Search, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ManaCostGlyphs } from "@/components/cards/mana-cost-glyphs";
import {
  ImportDetail,
  type NamedResponse,
} from "@/components/creator/import/import-detail";
import { usePrintings } from "@/components/creator/import/use-printings";
import {
  importFramePlan,
  type ImportFrameChoice,
} from "@/lib/creator/import-frame-choice";
import type { ScryfallImportPatch } from "@/lib/scryfall/import-mapper";
import {
  DEFAULT_PRINTING_VIEW,
  type PrintingSummary,
  type PrintingView,
} from "@/lib/scryfall/printing-views";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// ScryfallImportDialog — typeahead modal that lets the user pick a real
// card to seed the form. Authorized by the project owner to display and
// import official artwork (CLAUDE.md guardrails explicitly overridden for
// this feature; see 10_REMIX_AND_INSPIRATION.md).
//
// Built on the shared Radix Dialog primitive (chunk 01). Radix mounts the
// content only while open, so every dialog open gets a fresh state slot
// in the inner ScryfallImportContent component — no need for manual
// "remount on open" plumbing.
//
// TODO 1.5: the detail pane lists every printing (filterable, paged) with
// whether PipGlyph has its exact frame, and asks for a frame before commit
// when it doesn't (lib/creator/import-frame-choice.ts). TODO 1.9: a stale
// search never reports "Search failed", a printing click keeps the result
// list's selection, and the dialog can't close mid-commit.
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
  /** Scryfall scan quality: "missing" | "placeholder" | "lowres" | "highres_scan". */
  image_status: string | null;
};

type ImportArtResponse =
  | {
      ok: true;
      publicUrl: string;
      artist: string | null;
      /** Non-blocking quality note (e.g. "low-resolution scan"). */
      warning?: string | null;
      source: { scryfallId: string; cardName: string; scryfallUri: string | null };
    }
  | { ok: false; error: string };

export type ScryfallImportPayload = {
  patch: ScryfallImportPatch;
  /** When set, the form should write this URL into `art_url` (the user
   *  opted to also import the artwork). */
  importedArtUrl?: string | null;
  /** The frame the user picked in the dialog's chooser (TODO 1.5), when the
   *  printing's match wasn't exact. The form applies it after the kind
   *  change, re-checked; a stale choice falls back to the usual resolution.
   *  Absent = exact (or no chooser): the usual resolution. */
  frameChoice?: ImportFrameChoice;
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
  onImport: (payload: ScryfallImportPayload) => unknown;
  /** The published (template/colour) combos — the chooser offers only these,
   *  in the imported colour. */
  verifiedFrameKeys?: readonly string[];
  /** The frame the card is on now — the chooser's "Keep my current frame". */
  currentFrameTemplate?: string | null;
  /** Label override for the trigger button. */
  triggerLabel?: string;
  triggerVariant?: "primary" | "secondary" | "outline" | "ghost";
  /** When provided, the dialog open state is controlled externally. The
   *  built-in trigger button is suppressed in that mode so the parent
   *  decides where the open affordance lives (e.g. the start-with hero
   *  on /create, or a programmatic open from the start-with hero on /create (a custom DOM event)). */
  open?: boolean;
  onOpenChange?: (next: boolean) => void;
  /** Hide the built-in trigger button even in uncontrolled mode. Useful
   *  when only a custom-event listener should open the dialog. */
  hideTrigger?: boolean;
};

export function ScryfallImportDialog({
  signedIn,
  onImport,
  verifiedFrameKeys,
  currentFrameTemplate,
  triggerLabel = "Search a real card",
  triggerVariant = "outline",
  open: controlledOpen,
  onOpenChange,
  hideTrigger,
}: ScryfallImportDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = (next: boolean) => {
    if (!isControlled) setInternalOpen(next);
    onOpenChange?.(next);
  };
  const renderTrigger = !hideTrigger && !isControlled;
  // The commit (art download + form patch) runs here so the dialog can
  // refuse to close under it: Cancel, Escape, an outside click and the X
  // are all ignored while it runs (TODO 1.9). The content closes the
  // dialog itself once the import has landed.
  const [committing, startCommit] = useTransition();

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && committing) return;
        setOpen(next);
      }}
    >
      {renderTrigger ? (
        <DialogTrigger asChild>
          <Button
            type="button"
            variant={triggerVariant}
            disabled={!signedIn}
            title={
              signedIn ? undefined : "Sign in to search and import real cards."
            }
          >
            <Search className="h-4 w-4" aria-hidden />
            {triggerLabel}
          </Button>
        </DialogTrigger>
      ) : null}
      <DialogContent
        size="lg"
        className="min-h-0"
        closeDisabled={committing}
        onEscapeKeyDown={(event) => {
          if (committing) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (committing) event.preventDefault();
        }}
      >
        <ScryfallImportContent
          onClose={() => setOpen(false)}
          onImport={onImport}
          verifiedFrameKeys={verifiedFrameKeys}
          currentFrameTemplate={currentFrameTemplate}
          committing={committing}
          startCommit={startCommit}
        />
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Inner content — mounted only while the dialog is open. Each open is a
// fresh state slot, so previous-session search results never leak.
// ---------------------------------------------------------------------------

function ScryfallImportContent({
  onClose,
  onImport,
  verifiedFrameKeys,
  currentFrameTemplate,
  committing,
  startCommit,
}: {
  onClose: () => void;
  onImport: (payload: ScryfallImportPayload) => unknown;
  verifiedFrameKeys?: readonly string[];
  currentFrameTemplate?: string | null;
  committing: boolean;
  startCommit: TransitionStartFunction;
}) {
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TrimmedCard[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // The search result the left list highlights — kept apart from the
  // printing the detail pane shows, so picking another printing of the
  // same card never clears the list's selection (TODO 1.9).
  const [selectedResultId, setSelectedResultId] = useState<string | null>(null);
  const [selectedCard, setSelectedCard] = useState<NamedResponse | null>(null);
  // A new search result is loading (the detail pane shows a spinner).
  const [loadingResult, setLoadingResult] = useState(false);
  // Another printing of the shown card is loading: the detail stays
  // mounted under an overlay, so the printings grid keeps its scroll.
  const [pendingPrintingId, setPendingPrintingId] = useState<string | null>(null);

  const [view, setView] = useState<PrintingView>(DEFAULT_PRINTING_VIEW);
  const printings = usePrintings(selectedCard?.card.oracle_id ?? null, view);

  // The chooser's pick, for the printing it was made on; any other printing
  // starts from its own preselection.
  const [choiceState, setChoiceState] = useState<{
    forId: string;
    choice: ImportFrameChoice;
  } | null>(null);

  const [importArt, setImportArt] = useState(true);

  const verifiedKeys = useMemo(() => new Set(verifiedFrameKeys ?? []), [verifiedFrameKeys]);
  const plan = useMemo(
    () =>
      selectedCard
        ? importFramePlan(selectedCard.patch, verifiedKeys, currentFrameTemplate)
        : ({ mode: "none" } as const),
    [selectedCard, verifiedKeys, currentFrameTemplate],
  );
  const frameChoice: ImportFrameChoice | null =
    plan.mode !== "choose"
      ? null
      : choiceState && choiceState.forId === selectedCard?.card.id
        ? choiceState.choice
        : plan.preselected;

  // Focus the search input on mount. Radix's Dialog manages the focus trap
  // and initial focus; we just want the cursor to land in the search box
  // rather than the dialog's first focusable element (which would be the
  // close button).
  useEffect(() => {
    searchInputRef.current?.focus();
  }, []);

  // Debounced search. Each keystroke schedules a fetch SEARCH_DEBOUNCE_MS
  // later; we cancel via an abort controller if the query changes mid-flight.
  // All setState calls live inside the setTimeout callback (i.e. outside the
  // synchronous effect body) so we satisfy the react-hooks/set-state-in-effect
  // rule. Every one of them checks the controller first (TODO 1.9): an
  // aborted search — even one aborted while its body was being read, whose
  // json() then fails — must never report "Search failed" or stop the newer
  // search's spinner.
  useEffect(() => {
    const q = query.trim();
    const controller = new AbortController();
    const stale = () => controller.signal.aborted;
    const timer = setTimeout(async () => {
      if (!q) {
        // The search this one replaced was aborted and left its spinner to
        // the newer one — which is this: clear it.
        setResults([]);
        setSearchError(null);
        setSearching(false);
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
        if (stale()) return;
        if (!response.ok || !body?.ok) {
          setResults([]);
          setSearchError(
            typeof body?.error === "string" ? body.error : "Search failed.",
          );
          return;
        }
        setResults(Array.isArray(body.results) ? body.results : []);
      } catch {
        if (stale()) return;
        setSearchError("Search failed.");
      } finally {
        if (!stale()) setSearching(false);
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query]);

  // Tracks the most recently requested card id so a slower earlier fetch can't
  // land after a faster later one and show a detail that doesn't match the
  // highlighted selection (clicking result A then B).
  const latestSelectRef = useRef<string | null>(null);

  // Fetch one Scryfall card (a search result, or another printing of the
  // shown card) for the detail preview and the canonical patch to import.
  const loadCard = useCallback(async (id: string, kind: "result" | "printing") => {
    latestSelectRef.current = id;
    if (kind === "result") {
      setSelectedCard(null);
      setLoadingResult(true);
      setPendingPrintingId(null);
    } else {
      setPendingPrintingId(id);
    }
    try {
      const response = await fetch(
        `/api/scryfall/named?${new URLSearchParams({ id })}`,
      );
      const body = (await response.json().catch(() => null)) as
        | NamedResponse
        | { ok: false; error: string }
        | null;
      // The user picked another card while this was in flight — drop the
      // stale response entirely so it can't overwrite the newer selection.
      if (latestSelectRef.current !== id) return;
      if (!body || body.ok !== true) {
        toast.error(
          (body && "error" in body && body.error) || "Could not load card.",
        );
        // A failed printing switch keeps the printing already shown.
        if (kind === "result") setSelectedCard(null);
        return;
      }
      setSelectedCard(body);
    } catch {
      if (latestSelectRef.current !== id) return;
      toast.error("Could not load card.");
    } finally {
      // Only clear the spinner for the request that's still current.
      if (latestSelectRef.current === id) {
        setLoadingResult(false);
        setPendingPrintingId(null);
      }
    }
  }, []);

  const handleSelectResult = (id: string) => {
    setSelectedResultId(id);
    setView(DEFAULT_PRINTING_VIEW);
    void loadCard(id, "result");
  };

  const handleSelectPrinting = (printing: PrintingSummary) => {
    void loadCard(printing.id, "printing");
  };

  const handleConfirm = () => {
    if (!selectedCard || plan.mode === "reject") return;
    const card = selectedCard.card;
    const patch = selectedCard.patch;
    const hasBackFace = Boolean(patch.back_face);
    const chosenFrame = frameChoice ?? undefined;
    // Only a second face with its own image has back-face art to import. A
    // split, adventure, flip or Room card's second face is text on the one
    // shared image: asking for its art spent a lookup on a 404 and toasted
    // "back-face art couldn't be fetched" (TODO 1.8).
    const hasBackImage = hasBackFace && card.has_back_image === true;

    startCommit(async () => {
      // Fetch one face's art crop into the user's bucket. Returns the public
      // URL, or null on any failure (the server re-derives the URL from a
      // fresh Scryfall lookup — we never send it one).
      const importArtFace = async (
        mode: "art" | "art-back",
      ): Promise<string | null> => {
        try {
          const response = await fetch("/api/scryfall/import-art", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ scryfallId: card.id, mode }),
          });
          const body = (await response
            .json()
            .catch(() => null)) as ImportArtResponse | null;
          if (body && body.ok === true) {
            // Surface the server's quality note once (front face only, to
            // avoid double toasts on DFCs — the status covers the printing).
            if (body.warning && mode === "art") {
              toast.message("Artwork imported", { description: body.warning });
            }
            return body.publicUrl;
          }
          return null;
        } catch {
          return null;
        }
      };

      let importedArtUrl: string | null = null;
      let importedBackArtUrl: string | null = null;

      if (importArt) {
        // Import both faces' art in parallel — the single "Also import
        // artwork" checkbox covers the whole card, so a DFC gets art on both
        // faces (Delver, werewolves, MDFCs) rather than a blank back.
        [importedArtUrl, importedBackArtUrl] = await Promise.all([
          importArtFace("art"),
          hasBackImage ? importArtFace("art-back") : Promise.resolve(null),
        ]);

        if (!importedArtUrl) {
          toast.error("Could not import the artwork.");
        } else if (hasBackImage && !importedBackArtUrl) {
          toast.message("Imported the front art", {
            description:
              "The back-face art couldn't be fetched — you can add it on the Layout step.",
          });
        }
      }

      // Thread the imported back-face URL into the patch so the form seeds
      // it into back_face.art_url (see handleScryfallImport in the form).
      const finalPatch: ScryfallImportPatch =
        hasBackFace && patch.back_face
          ? {
              ...patch,
              back_face: {
                ...patch.back_face,
                imported_art_url: importedBackArtUrl,
              },
            }
          : patch;

      onImport({
        patch: finalPatch,
        importedArtUrl,
        ...(chosenFrame ? { frameChoice: chosenFrame } : {}),
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
    if (loadingResult) return "loading" as const;
    if (selectedCard) return "ready" as const;
    if (selectedResultId) return "loading" as const;
    return "empty" as const;
  }, [selectedCard, selectedResultId, loadingResult]);

  const confirmBlockedReason =
    plan.mode === "reject" ? `Not available — ${plan.reason}.` : undefined;

  return (
    <>
      <DialogHeader>
        <DialogTitle>Search a card to remix</DialogTitle>
        <DialogDescription>
          Pick a real card to seed your draft. Source data and images come
          from{" "}
          <a
            href="https://scryfall.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary-bright underline-offset-2 hover:underline"
          >
            Scryfall
          </a>
          . You can edit every field afterward.
        </DialogDescription>
      </DialogHeader>

      {/* Body: search + detail. min-h-0 lets the children shrink so the
          dialog stays within max-h-[85vh] from the Dialog primitive. */}
      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
        {/* Left: search + result list */}
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
              disabled={committing}
            />
            {searching ? (
              <Loader2
                className="h-4 w-4 animate-spin text-subtle"
                aria-hidden
                data-testid="search-spinner"
              />
            ) : null}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {searchError ? (
              <p className="px-4 py-3 text-xs text-danger">{searchError}</p>
            ) : null}
            {!query.trim() ? (
              <SearchTips />
            ) : searching && results.length === 0 ? (
              // First-paint while waiting on the initial Scryfall response
              // for a new query. Once results land we render them
              // immediately even if a follow-up keystroke is in flight, so
              // the user always has a populated list to scan.
              <ScryfallResultsSkeleton />
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
                      aria-selected={selectedResultId === card.id}
                      onClick={() => handleSelectResult(card.id)}
                      disabled={committing}
                      className={cn(
                        "flex w-full items-start gap-3 border-b border-border/40 px-3 py-2 text-left transition-colors hover:bg-elevated/60",
                        selectedResultId === card.id ? "bg-elevated/80" : "",
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
                        {card.image_status === "lowres" ? (
                          <Badge variant="outline" className="self-start text-[10px]">
                            Low-res scan
                          </Badge>
                        ) : card.image_status === "placeholder" ||
                          card.image_status === "missing" ? (
                          <Badge variant="outline" className="self-start text-[10px]">
                            No real image yet
                          </Badge>
                        ) : null}
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

        {/* Right: detail preview */}
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
            <ImportDetail
              data={selectedCard}
              busy={pendingPrintingId !== null}
              importArt={importArt}
              onImportArtChange={setImportArt}
              // A card with no top-level oracle_id (Scryfall's
              // reversible_card layout) has no printings list.
              printings={selectedCard.card.oracle_id ? printings : null}
              view={view}
              onViewChange={setView}
              onSelectPrinting={handleSelectPrinting}
              pendingPrintingId={pendingPrintingId}
              plan={plan}
              frameChoice={frameChoice}
              onFrameChoiceChange={(choice) =>
                setChoiceState({ forId: selectedCard.card.id, choice })
              }
              locked={committing}
            />
          ) : null}
        </div>
      </div>

      <DialogFooter className="flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[11px] leading-5 text-subtle">
          Imported text and artwork remain subject to their original
          copyright. Use the disclaimer page for the full notice.
        </p>
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={committing}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={handleConfirm}
            title={confirmBlockedReason}
            disabled={
              !selectedCard ||
              committing ||
              pendingPrintingId !== null ||
              plan.mode === "reject"
            }
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
      </DialogFooter>
    </>
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

function ScryfallResultsSkeleton() {
  // Shape-matches a real result row (thumbnail + name + set/rarity + mana
  // glyphs row) so the list doesn't reflow when actual results land.
  return (
    <ul aria-label="Loading search results">
      {Array.from({ length: 6 }).map((_, i) => (
        <li
          key={i}
          className="flex items-start gap-3 border-b border-border/40 px-3 py-2"
        >
          <Skeleton className="h-12 w-16 shrink-0 rounded-sm" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Skeleton className="h-3 w-2/3" />
            <Skeleton className="h-2.5 w-1/3" />
            <Skeleton className="h-3 w-16" />
          </div>
        </li>
      ))}
    </ul>
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
