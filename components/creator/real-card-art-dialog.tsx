"use client";

import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type TransitionStartFunction,
} from "react";
import { useFormContext, useWatch } from "react-hook-form";
import { ImageDown, Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ChipGroup } from "@/components/ui/chip-group";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  PrintingFilterChips,
  PrintingsGrid,
} from "@/components/creator/import/printings-grid";
import { usePrintings } from "@/components/creator/import/use-printings";
import {
  ImportedArtNote,
  type ImportedArtOrigin,
} from "@/components/creator/import/imported-art-note";
import type { FormValues } from "@/lib/creator/form-types";
import {
  applyRealCardArt,
  defaultRealCardArtMode,
  realCardArtModes,
  realCardArtOrigin,
  realCardFaceNames,
  type RealCardArt,
  type RealCardArtMode,
  type RealCardArtTarget,
} from "@/lib/creator/real-card-art";
import {
  DEFAULT_PRINTING_VIEW,
  printingTreatmentBadge,
  type PrintingSummary,
  type PrintingView,
} from "@/lib/scryfall/printing-views";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// "Use art from a real card" (TODO 1.15) — the Art block's lookup for a real
// printing's art WITHOUT the full Scryfall import (which also overwrites the
// name, text, type, frame and colour; Card Conjurer keeps the same split).
//
//   1. a name typeahead (GET /api/scryfall/search — debounced and aborted
//      like the import dialog, with its 1.9 stale-search guard);
//   2. the chosen card's printings (the import dialog's PrintingsGrid +
//      usePrintings; no frame-status badges — only the art matters here);
//   3. "Use this art" → POST /api/scryfall/import-art {scryfallId, mode}
//      ("art-back" only for a printing whose back face has its own image).
//
// The result writes ONLY the target face's art_url, a re-centred
// art_position and its artist_credit (lib/creator/real-card-art.ts). Same
// Scryfall quotas as the import: search (typeahead + printings) and
// import_art. Guests get the button disabled with the sign-in hint.
// ---------------------------------------------------------------------------

const SEARCH_DEBOUNCE_MS = 250;
const SIGN_IN_HINT = "Sign in to use art from real cards.";

/** One /api/scryfall/search result, as far as this dialog reads it. */
type ArtSearchResult = {
  id: string;
  name: string;
  /** Null on Scryfall's reversible cards: no printings list. */
  oracle_id?: string | null;
  set: string | null;
  set_name: string | null;
  thumb_url: string | null;
};

type ImportArtResponse =
  | {
      ok: true;
      publicUrl: string;
      artist: string | null;
      warning?: string | null;
      source?: { scryfallId: string; cardName: string; scryfallUri: string | null };
    }
  | { ok: false; error?: string };

/** What the form learns when the art lands. */
export type RealCardArtApplied = {
  target: RealCardArtTarget;
  art: RealCardArt;
  printing: PrintingSummary;
  mode: RealCardArtMode;
};

// ---------------------------------------------------------------------------
// RealCardArtButton — the trigger + dialog, wired to the creator form. The
// Art panel mounts it for the front art; the second face's art block (a
// split / aftermath / flip half) for the back.
// ---------------------------------------------------------------------------

export function RealCardArtButton({
  target,
  signedIn,
  onApplied,
}: {
  target: RealCardArtTarget;
  signedIn: boolean;
  /** After the form fields are written — the creator remembers front art's
   *  origin for the Art step's note (TODO 1.18). */
  onApplied?: (applied: RealCardArtApplied) => void;
}) {
  const { control, setValue } = useFormContext<FormValues>();
  const template = useWatch({ control, name: "frame_style.template" });
  const [open, setOpen] = useState(false);
  const label = "Use art from a real card";
  return (
    <>
      {/* A disabled button takes no pointer events: the wrapper carries the
          sign-in hint's tooltip. */}
      <span title={signedIn ? undefined : SIGN_IN_HINT} className="inline-flex">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setOpen(true)}
          disabled={!signedIn}
          title={signedIn ? undefined : SIGN_IN_HINT}
          aria-label={target === "back" ? `${label} for the second face` : undefined}
          data-testid={`real-card-art-${target}`}
        >
          <ImageDown className="h-4 w-4" aria-hidden />
          {label}
        </Button>
      </span>
      {signedIn ? (
        <RealCardArtDialog
          open={open}
          onOpenChange={setOpen}
          target={target}
          template={template}
          onUseArt={(art, printing, mode) => {
            applyRealCardArt(setValue, target, art);
            onApplied?.({ target, art, printing, mode });
          }}
        />
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// RealCardArtDialog — Radix mounts the content only while open, so every
// open starts from a fresh search.
// ---------------------------------------------------------------------------

export function RealCardArtDialog({
  open,
  onOpenChange,
  target,
  template,
  onUseArt,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  target: RealCardArtTarget;
  /** The card's frame, for the art note (an edge-to-edge frame stretches
   *  Scryfall's window crop). */
  template: string | null | undefined;
  /** The import landed: write it into the form. */
  onUseArt: (art: RealCardArt, printing: PrintingSummary, mode: RealCardArtMode) => void;
}) {
  // The download runs here so the dialog refuses to close under it (Cancel,
  // Escape, an outside click and the X are all ignored — the 1.9 rule).
  const [committing, startCommit] = useTransition();
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && committing) return;
        onOpenChange(next);
      }}
    >
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
        <RealCardArtContent
          target={target}
          template={template}
          onClose={() => onOpenChange(false)}
          onUseArt={onUseArt}
          committing={committing}
          startCommit={startCommit}
        />
      </DialogContent>
    </Dialog>
  );
}

function RealCardArtContent({
  target,
  template,
  onClose,
  onUseArt,
  committing,
  startCommit,
}: {
  target: RealCardArtTarget;
  template: string | null | undefined;
  onClose: () => void;
  onUseArt: (art: RealCardArt, printing: PrintingSummary, mode: RealCardArtMode) => void;
  committing: boolean;
  startCommit: TransitionStartFunction;
}) {
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ArtSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [selected, setSelected] = useState<ArtSearchResult | null>(null);
  const [view, setView] = useState<PrintingView>(DEFAULT_PRINTING_VIEW);
  const printings = usePrintings(selected?.oracle_id ?? null, view);
  // The printing the user clicked. Kept as the whole summary so it stays
  // chosen when a filter chip hides it.
  const [picked, setPicked] = useState<PrintingSummary | null>(null);
  // The front/back art pick, for the printing it was made on.
  const [modeState, setModeState] = useState<{ forId: string; mode: RealCardArtMode } | null>(
    null,
  );

  const active: PrintingSummary | null =
    picked ??
    printings.printings.find((p) => p.id === selected?.id) ??
    printings.printings[0] ??
    null;
  const modes = active ? realCardArtModes(active) : [];
  const chosenMode =
    active && modeState?.forId === active.id ? modeState.mode : null;
  const mode: RealCardArtMode | null = active
    ? chosenMode && modes.includes(chosenMode)
      ? chosenMode
      : defaultRealCardArtMode(target, active)
    : null;
  const faceNames = realCardFaceNames(selected?.name ?? "");
  const unusable =
    active?.image_status === "placeholder" || active?.image_status === "missing";

  useEffect(() => {
    searchInputRef.current?.focus();
  }, []);

  // The import dialog's debounced search (TODO 1.9): every setState lives in
  // the timer and checks the controller first, so a search aborted by the
  // next keystroke — even while its body was being read — never reports
  // "Search failed" nor stops the newer search's spinner.
  useEffect(() => {
    const q = query.trim();
    const controller = new AbortController();
    const stale = () => controller.signal.aborted;
    const timer = setTimeout(async () => {
      if (!q) {
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
          setSearchError(typeof body?.error === "string" ? body.error : "Search failed.");
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

  const handleSelectResult = (result: ArtSearchResult) => {
    setSelected(result);
    setView(DEFAULT_PRINTING_VIEW);
    setPicked(null);
    setModeState(null);
  };

  const handleUse = () => {
    if (!active || !mode || committing || unusable) return;
    const printing = active;
    const useMode = mode;
    const faceName =
      useMode === "art-back" ? faceNames.back ?? faceNames.front : faceNames.front;
    startCommit(async () => {
      let body: ImportArtResponse | null = null;
      try {
        const response = await fetch("/api/scryfall/import-art", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // The route re-derives the image from a fresh Scryfall lookup: it
          // takes an id, never a URL.
          body: JSON.stringify({ scryfallId: printing.id, mode: useMode }),
        });
        body = (await response.json().catch(() => null)) as ImportArtResponse | null;
      } catch {
        body = null;
      }
      if (!body || body.ok !== true || typeof body.publicUrl !== "string") {
        // Nothing was written: the form keeps its art.
        toast.error(
          body && body.ok === false && typeof body.error === "string" && body.error
            ? body.error
            : "Couldn't import the artwork — try again.",
        );
        return;
      }
      const artist = typeof body.artist === "string" && body.artist.trim() ? body.artist : null;
      onUseArt({ publicUrl: body.publicUrl, artist }, printing, useMode);
      if (body.warning) {
        toast.message("Artwork imported", { description: body.warning });
      }
      toast.success(
        `Used the art from ${faceName}${artist ? ` by ${artist}` : ""}.`,
      );
      onClose();
    });
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Use art from a real card</DialogTitle>
        <DialogDescription>
          {target === "back"
            ? "Pick a printing — only the second face's artwork and artist credit change."
            : "Pick a printing — only the artwork and artist credit change. The name, text, type, frame and colours stay yours."}{" "}
          Images come from{" "}
          <a
            href="https://scryfall.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary-bright underline-offset-2 hover:underline"
          >
            Scryfall
          </a>
          .
        </DialogDescription>
      </DialogHeader>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,280px)_minmax(0,1fr)]">
        {/* Left: the name typeahead */}
        <div className="flex min-h-0 flex-col border-b border-border/60 lg:border-b-0 lg:border-r">
          <div className="flex items-center gap-2 border-b border-border/60 px-4 py-3">
            <Search className="h-4 w-4 text-subtle" aria-hidden />
            <input
              ref={searchInputRef}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Card name, e.g. Llanowar Elves"
              className="h-8 flex-1 bg-transparent text-sm text-foreground placeholder:text-subtle focus:outline-none"
              aria-label="Search a card by name"
              disabled={committing}
            />
            {searching ? (
              <Loader2
                className="h-4 w-4 animate-spin text-subtle"
                aria-hidden
                data-testid="real-art-search-spinner"
              />
            ) : null}
          </div>
          <div className="max-h-48 min-h-0 flex-1 overflow-y-auto lg:max-h-none">
            {searchError ? (
              <p role="alert" className="px-4 py-3 text-xs text-danger">
                {searchError}
              </p>
            ) : null}
            {!query.trim() ? (
              <p className="px-4 py-5 text-xs leading-5 text-subtle">
                Type a card name, then pick the printing whose art you want.
              </p>
            ) : results.length === 0 && !searching && !searchError ? (
              <p className="px-4 py-6 text-center text-xs text-subtle">No matches.</p>
            ) : (
              <ul role="listbox" aria-label="Cards">
                {results.map((result) => (
                  <li key={result.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={selected?.id === result.id}
                      onClick={() => handleSelectResult(result)}
                      disabled={committing}
                      className={cn(
                        "flex w-full items-center gap-3 border-b border-border/40 px-3 py-2 text-left transition-colors hover:bg-elevated/60",
                        selected?.id === result.id ? "bg-elevated/80" : "",
                      )}
                    >
                      {result.thumb_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={result.thumb_url}
                          alt=""
                          loading="lazy"
                          className="h-10 w-14 shrink-0 rounded-sm object-cover"
                        />
                      ) : (
                        <span className="h-10 w-14 shrink-0 rounded-sm bg-elevated" />
                      )}
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-sm font-medium text-foreground">
                          {result.name}
                        </span>
                        <span className="truncate text-[11px] uppercase tracking-wider text-subtle">
                          {result.set_name ?? result.set ?? "—"}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Right: the printings and the chosen art */}
        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto p-5">
          {!selected ? (
            <div className="flex h-full min-h-40 flex-col items-center justify-center gap-2 text-center">
              <ImageDown className="h-6 w-6 text-subtle" aria-hidden />
              <p className="text-sm text-muted">Pick a card to see its printings.</p>
            </div>
          ) : !selected.oracle_id ? (
            <p className="text-xs text-subtle" role="status">
              Scryfall has no printings list for {selected.name} — pick another card.
            </p>
          ) : (
            <>
              <div className="flex flex-col gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-subtle">
                  {selected.name} · printings
                </span>
                <PrintingFilterChips value={view} onChange={setView} disabled={committing} />
                <PrintingsGrid
                  printings={printings.printings}
                  activeId={active?.id ?? null}
                  onSelect={(printing) => {
                    if (!committing) setPicked(printing);
                  }}
                  loading={printings.loading}
                  loadingMore={printings.loadingMore}
                  hasMore={printings.hasMore}
                  onLoadMore={printings.loadMore}
                  total={printings.total}
                  error={printings.error}
                  showStatus={false}
                />
              </div>
              {active ? (
                <ChosenPrinting
                  printing={active}
                  faceNames={faceNames}
                  modes={modes}
                  mode={mode}
                  onModeChange={(next) => setModeState({ forId: active.id, mode: next })}
                  template={template}
                  unusable={unusable}
                  disabled={committing}
                />
              ) : null}
            </>
          )}
        </div>
      </div>

      <DialogFooter className="flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[11px] leading-5 text-subtle">
          Imported artwork remains its artist&apos;s and its publisher&apos;s — swap in your own
          before publishing to keep the card original.
        </p>
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={committing}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={handleUse}
            disabled={!active || !mode || committing || unusable}
            title={unusable ? "Scryfall has no real image for this printing." : undefined}
          >
            {committing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Importing…
              </>
            ) : (
              <>
                <ImageDown className="h-4 w-4" aria-hidden />
                Use this art
              </>
            )}
          </Button>
        </div>
      </DialogFooter>
    </>
  );
}

/** The printing whose art "Use this art" imports: its crop, where it's from,
 *  who drew it, the front/back choice, and the art note. */
function ChosenPrinting({
  printing,
  faceNames,
  modes,
  mode,
  onModeChange,
  template,
  unusable,
  disabled,
}: {
  printing: PrintingSummary;
  faceNames: { front: string; back: string | null };
  modes: RealCardArtMode[];
  mode: RealCardArtMode | null;
  onModeChange: (next: RealCardArtMode) => void;
  template: string | null | undefined;
  unusable: boolean;
  disabled: boolean;
}) {
  const where = [
    (printing.set ?? "?").toUpperCase(),
    printing.released_at?.slice(0, 4) ?? null,
    printing.collector_number ? `#${printing.collector_number}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const treatment = printingTreatmentBadge(printing);
  // The Art step's note (TODO 1.18) for this printing, before the import:
  // the same text the Art block shows once the art is in place.
  const previewOrigin: ImportedArtOrigin = realCardArtOrigin(printing, "chosen-printing");
  // Show the image "Use this art" will import: the back face's own crop
  // (and its artist) once "Back art" is picked. Each face's credit is the
  // one import-art writes (TODO 1.8) — Fire // Ice's front art is David
  // Martin's alone, not the card-level "David Martin & Franz Vohwinkel".
  const showBack = mode === "art-back";
  const thumb = showBack ? printing.back_thumb_url ?? null : printing.thumb_url;
  const faceName = showBack ? faceNames.back ?? faceNames.front : faceNames.front;
  const artist = showBack
    ? printing.back_artist ?? printing.artist
    : printing.front_artist ?? printing.artist;
  return (
    <div
      className="flex flex-col gap-3 rounded-md border border-border/60 bg-elevated/30 p-3"
      data-testid="real-art-chosen"
    >
      <div className="grid gap-3 sm:grid-cols-[160px_minmax(0,1fr)]">
        {thumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumb}
            alt={`Art of ${faceName}, ${where}`}
            className="aspect-[4/3] w-full rounded-sm border border-border/50 object-cover"
          />
        ) : (
          <span className="block aspect-[4/3] w-full rounded-sm bg-elevated" />
        )}
        <div className="flex min-w-0 flex-col gap-1 text-xs leading-5">
          <span className="font-semibold uppercase tracking-wide text-foreground">{where}</span>
          <span className="text-muted">{printing.set_name ?? "Unknown set"}</span>
          <span className="text-muted">
            Artist: <span className="text-foreground">{artist ?? "not credited"}</span>
          </span>
          {treatment ? (
            <span className="self-start rounded-full border border-border/70 px-1.5 text-[10px] leading-4 text-muted">
              {treatment}
            </span>
          ) : null}
        </div>
      </div>

      {modes.length > 1 ? (
        <ChipGroup
          ariaLabel="Which art"
          size="md"
          layout="grid-2"
          value={mode}
          onChange={onModeChange}
          options={[
            { value: "art", label: "Front art", description: faceNames.front, disabled },
            {
              value: "art-back",
              label: "Back art",
              description: faceNames.back ?? "The printing's back face",
              disabled,
            },
          ]}
        />
      ) : null}

      {unusable ? (
        <p role="alert" className="text-[11px] leading-4 text-danger">
          Scryfall only has a placeholder image for this printing — pick another.
        </p>
      ) : printing.image_status === "lowres" ? (
        <p className="text-[11px] leading-4 text-subtle">
          Low-resolution scan — another printing may have sharper art.
        </p>
      ) : null}

      <ImportedArtNote origin={previewOrigin} artUrl="chosen-printing" template={template} />
    </div>
  );
}
