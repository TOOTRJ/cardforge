"use client";

import { useEffect, useId, useRef, useState, useTransition, type ReactNode } from "react";
import { Globe2, Link2, Loader2, Lock, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { createDeckAction, type DeckCreateSurface } from "@/lib/decks/actions";
import { ChipGroup, type ChipOption } from "@/components/ui/chip-group";
import { inputClass } from "@/components/ui/field-classes";
import {
  DECK_BOARD_LABELS,
  DECK_BOARD_VALUES,
  DECK_FORMAT_LABELS,
  DECK_FORMAT_VALUES,
  type DeckBoard,
  type DeckFormat,
} from "@/types/deck";
import { VISIBILITY_LABELS, type Visibility } from "@/types/card";
import { MAX_ENTRY_QUANTITY } from "@/lib/decks/parse-decklist";
import type { DeckMembershipEntry, DeckRowState, PickerDeck } from "@/lib/decks/membership-state";
import { typedForMatching } from "@/lib/validation/print-typography";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// The deck picker (TODO DK9.1), extracted from the creator's Publish-step
// "Add to deck" select — every surface that puts a saved card into the
// owner's decks shares these pieces:
//
//   DeckMembershipPicker  one checkbox per deck (tick adds, untick removes;
//                         a deck holding some of several cards is "mixed"),
//                         a search once the list is long, and the board and
//                         quantity of a row that is ONE card's one entry.
//                         Controlled: the caller owns the memberships and
//                         does the writes (useDeckMembership — My Cards, the
//                         gallery, the creator's box on an edit).
//   DeckChoice            ONE deck or none — the creator's NEW card, whose
//                         save carries one `deck_id` (main board, ×1).
//   DeckQuickCreate       "＋ New deck": a name, a format and the deck's
//                         visibility ON SHOW (the TODO DK0.8 remainder; owner
//                         2026-10-29: "default to public, the user chooses
//                         private — the same as create card"): the card
//                         creator's Publish control in the same order and
//                         words — a "Keep it private" box over Unlisted /
//                         Public, Public picked. Decks are unlimited on every
//                         plan, so nothing is checked first. Both pickers
//                         take it through their `newDeck` slot, so the
//                         create-deck dialog (feat/new-deck-dialog) can take
//                         its place later.
// ---------------------------------------------------------------------------

/** The list offers a search from this many decks. */
export const DECK_SEARCH_FROM = 6;

// The card creator's two chips (components/creator/panels/publish-panel.tsx
// VISIBILITY_OPTIONS — its own words, said of a deck): private is the box
// above them, as the card's "Save as a draft" is.
const LISTING_OPTIONS: ChipOption<"unlisted" | "public">[] = [
  {
    value: "unlisted",
    label: "Unlisted",
    description: "Anyone with the link can view, hidden from the deck listings.",
    icon: Link2,
  },
  {
    value: "public",
    label: "Public",
    description: "Listed in the community decks and your profile. The default.",
    icon: Globe2,
  },
];

/** "Commander · Public" — a deck's line under its name. */
function deckMeta(deck: PickerDeck): string {
  const format = DECK_FORMAT_LABELS[deck.format as DeckFormat] ?? deck.format;
  return deck.visibility ? `${format} · ${VISIBILITY_LABELS[deck.visibility]}` : format;
}

// ---------------------------------------------------------------------------
// DeckMembershipPicker
// ---------------------------------------------------------------------------

export type DeckEntryPatch = { board?: DeckBoard; quantity?: number };

export function DeckMembershipPicker({
  decks,
  rows,
  cardCount,
  onToggle,
  onEntryChange,
  pending,
  newDeck,
  label = "Your decks",
  emptyText = "You have no decks yet.",
  className,
}: {
  /** The owner's decks, most recently changed first. */
  decks: readonly PickerDeck[];
  /** Each deck's row for the cards (deckRowStates). */
  rows: Readonly<Record<string, DeckRowState>>;
  /** How many cards the picker is for (a mixed row says "2 of 3"). */
  cardCount: number;
  onToggle: (deckId: string, next: boolean) => void;
  /** Board / quantity of a row's ONE entry; omit to hide those controls. */
  onEntryChange?: (deckId: string, entry: DeckMembershipEntry, patch: DeckEntryPatch) => void;
  /** Decks with a change in flight: their row is busy, its tick ignored. */
  pending?: ReadonlySet<string>;
  /** "＋ New deck" — DeckQuickCreate today. */
  newDeck?: ReactNode;
  /** Names the list. */
  label?: string;
  emptyText?: string;
  className?: string;
}) {
  const [query, setQuery] = useState("");
  const needle = typedForMatching(query.trim().toLowerCase());
  const shown = needle
    ? decks.filter((deck) => typedForMatching(deck.title.toLowerCase()).includes(needle))
    : decks;
  const searchable = decks.length >= DECK_SEARCH_FROM;

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {searchable ? (
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle"
            aria-hidden
          />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find a deck"
            aria-label="Find a deck"
            className={cn(inputClass(false), "h-9 pl-9")}
            autoComplete="off"
          />
        </div>
      ) : null}
      {decks.length === 0 ? (
        <p className="text-xs leading-5 text-muted">{emptyText}</p>
      ) : shown.length === 0 ? (
        <p className="text-xs leading-5 text-muted" role="status">
          No deck matches &ldquo;{query.trim()}&rdquo;.
        </p>
      ) : (
        <ul
          aria-label={label}
          className="flex max-h-72 flex-col divide-y divide-border/50 overflow-y-auto rounded-lg border border-border/60 bg-background/30"
        >
          {shown.map((deck) => (
            <DeckRow
              key={deck.id}
              deck={deck}
              state={rows[deck.id] ?? { tick: "none", holders: 0, entry: null }}
              cardCount={cardCount}
              busy={pending?.has(deck.id) ?? false}
              onToggle={onToggle}
              onEntryChange={onEntryChange}
            />
          ))}
        </ul>
      )}
      {newDeck}
    </div>
  );
}

function DeckRow({
  deck,
  state,
  cardCount,
  busy,
  onToggle,
  onEntryChange,
}: {
  deck: PickerDeck;
  state: DeckRowState;
  cardCount: number;
  busy: boolean;
  onToggle: (deckId: string, next: boolean) => void;
  onEntryChange?: (deckId: string, entry: DeckMembershipEntry, patch: DeckEntryPatch) => void;
}) {
  const id = useId();
  const nameId = `${id}-name`;
  const metaId = `${id}-meta`;
  const box = useRef<HTMLInputElement | null>(null);
  // "Some of the cards are in it" is the checkbox's third state — set on
  // the element (there is no attribute for it), after EVERY render: a click
  // clears it natively, and a write that leaves the row mixed (a full deck)
  // doesn't change `tick` to bring it back.
  useEffect(() => {
    if (box.current) box.current.indeterminate = state.tick === "some";
  });
  const mixed = state.tick === "some";
  return (
    <li className="flex flex-col gap-2 px-3 py-2.5" data-deck-row={deck.id}>
      <div className="flex items-center gap-3">
        <input
          ref={box}
          id={id}
          type="checkbox"
          checked={state.tick === "all"}
          // Busy: still reachable and named, its change ignored (a disabled
          // box would drop the focus the moment it was pressed).
          aria-disabled={busy || undefined}
          // Named by the deck alone and DESCRIBED by the line under it (the
          // <label> alone made both lines its name — TODO 3b.36's rule); the
          // label still makes the whole row a click target.
          aria-labelledby={nameId}
          aria-describedby={metaId}
          onChange={(event) => {
            if (busy) return;
            onToggle(deck.id, event.target.checked);
          }}
          className="h-4 w-4 shrink-0 accent-[var(--color-primary)]"
        />
        <label htmlFor={id} className="flex min-w-0 flex-1 cursor-pointer flex-col">
          <span id={nameId} className="truncate text-sm font-medium text-foreground">
            {deck.title}
          </span>
          <span id={metaId} className="truncate text-xs text-muted">
            {deckMeta(deck)}
            {mixed ? ` · ${state.holders} of ${cardCount} in it` : ""}
          </span>
        </label>
        {busy ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted" aria-hidden /> : null}
      </div>
      {state.tick === "all" && state.entry && onEntryChange ? (
        <EntryControls
          deck={deck}
          entry={state.entry}
          busy={busy}
          onChange={(patch) => onEntryChange(deck.id, state.entry!, patch)}
        />
      ) : null}
    </li>
  );
}

/** A row's one entry: its board and copies. The count is written when it
 *  is left (blur or Enter), never per keystroke. */
function EntryControls({
  deck,
  entry,
  busy,
  onChange,
}: {
  deck: PickerDeck;
  entry: DeckMembershipEntry;
  busy: boolean;
  onChange: (patch: DeckEntryPatch) => void;
}) {
  const [draft, setDraft] = useState(String(entry.quantity));
  const [shownFor, setShownFor] = useState(entry.quantity);
  // The entry's count changed under the field (a write landed): show it.
  if (shownFor !== entry.quantity) {
    setShownFor(entry.quantity);
    setDraft(String(entry.quantity));
  }
  const commit = () => {
    const next = Number(draft);
    if (!Number.isInteger(next) || next < 1 || next > MAX_ENTRY_QUANTITY) {
      setDraft(String(entry.quantity));
      return;
    }
    if (next !== entry.quantity) onChange({ quantity: next });
  };
  return (
    <div className="flex flex-wrap items-center gap-2 pl-7">
      <select
        value={entry.board}
        onChange={(event) => onChange({ board: event.target.value as DeckBoard })}
        aria-label={`Board in ${deck.title}`}
        aria-disabled={busy || undefined}
        className={cn(inputClass(false), "h-8 w-auto py-0 text-xs")}
      >
        {DECK_BOARD_VALUES.map((board) => (
          <option key={board} value={board}>
            {DECK_BOARD_LABELS[board]}
          </option>
        ))}
      </select>
      <label className="flex items-center gap-1.5 text-xs text-muted">
        <span aria-hidden>×</span>
        <input
          type="number"
          inputMode="numeric"
          min={1}
          max={MAX_ENTRY_QUANTITY}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit();
            }
          }}
          aria-label={`Copies in ${deck.title}`}
          aria-disabled={busy || undefined}
          className={cn(inputClass(false), "h-8 w-16 py-0 text-xs")}
        />
      </label>
    </div>
  );
}

/** What the last write did — ONE polite status, always mounted (and never
 *  display:none, which some screen readers then skip) so each change is
 *  read once. Empty, it is a line of no height. */
export function DeckMembershipStatusLine({
  status,
  className,
}: {
  status: { tone: "success" | "error" | "info"; message: string } | null;
  className?: string;
}) {
  return (
    <p
      role="status"
      data-testid="deck-membership-status"
      className={cn(
        "text-xs leading-5",
        status?.tone === "error" ? "text-danger" : status?.tone === "info" ? "text-accent" : "text-muted",
        className,
      )}
    >
      {status?.message ?? null}
    </p>
  );
}

// ---------------------------------------------------------------------------
// DeckChoice — one deck or none (the creator's new card)
// ---------------------------------------------------------------------------

export function DeckChoice({
  decks,
  value,
  onChange,
  newDeck,
  describedBy,
  label = "Deck",
}: {
  decks: readonly PickerDeck[];
  /** The chosen deck's id, "" for none. */
  value: string;
  onChange: (deckId: string) => void;
  newDeck?: ReactNode;
  describedBy?: string;
  label?: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={decks.length === 0}
        aria-label={label}
        aria-describedby={describedBy}
        className={inputClass(false)}
      >
        <option value="">No deck</option>
        {decks.map((deck) => (
          <option key={deck.id} value={deck.id}>
            {deck.title}
            {DECK_FORMAT_LABELS[deck.format as DeckFormat]
              ? ` · ${DECK_FORMAT_LABELS[deck.format as DeckFormat]}`
              : ""}
          </option>
        ))}
      </select>
      {newDeck}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DeckQuickCreate — "＋ New deck", inline
// ---------------------------------------------------------------------------

export function DeckQuickCreate({
  onCreated,
  surface,
  disabled = false,
}: {
  /** The deck exists: the caller puts it in its list (and adds the card). */
  onCreated: (deck: PickerDeck) => void | Promise<void>;
  /** For the funnel (`deck_created`'s surface). */
  surface: DeckCreateSurface;
  disabled?: boolean;
}) {
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [format, setFormat] = useState<DeckFormat>("commander");
  // Public unless the maker picks otherwise (owner 2026-10-29): the box
  // makes it private, the chips choose how a shared deck is shared.
  const [keepPrivate, setKeepPrivate] = useState(false);
  const [listing, setListing] = useState<"unlisted" | "public">("public");
  const visibility: Visibility = keepPrivate ? "private" : listing;
  const [isPending, startTransition] = useTransition();
  const id = useId();
  const privateNameId = `${id}-private`;
  const privateNoteId = `${id}-private-note`;
  // Closing the row (Cancel, or the deck was made) removes the control that
  // held the focus: hand it back to "＋ New deck" instead of dropping it on
  // the page — only a focus that was lost with the row (or is still in this
  // control): someone who clicked on elsewhere meanwhile is left alone.
  const rootRef = useRef<HTMLDivElement | null>(null);
  const newDeckRef = useRef<HTMLButtonElement | null>(null);
  const [closes, setCloses] = useState(0);
  useEffect(() => {
    const button = newDeckRef.current;
    if (closes === 0 || !button) return;
    const active = document.activeElement;
    if (active && active !== document.body && !rootRef.current?.contains(active)) return;
    button.focus();
  }, [closes]);
  const close = () => {
    setCreating(false);
    setCloses((count) => count + 1);
  };

  const create = () => {
    const name = title.trim();
    if (!name) {
      toast.error("Give the deck a name first.");
      return;
    }
    startTransition(async () => {
      const result = await createDeckAction({ title: name, format, visibility }, { surface });
      if (!result.ok) {
        toast.error(
          result.formError ?? Object.values(result.fieldErrors ?? {})[0] ?? "Could not create the deck.",
        );
        return;
      }
      await onCreated({ id: result.deckId, title: name, format, visibility, slug: result.slug });
      close();
      setTitle("");
      setKeepPrivate(false);
      setListing("public");
    });
  };

  return (
    <div ref={rootRef} className="flex flex-col gap-2">
      {creating ? (
        <div className="flex flex-col gap-2 rounded-lg border border-border/60 bg-elevated/30 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Deck name"
              aria-label="New deck name"
              // "＋ New deck" was replaced by this row: the focus it held
              // comes here instead of being dropped.
              autoFocus
              disabled={isPending}
              maxLength={120}
              className={cn(inputClass(false), "h-9 min-w-40 flex-1")}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  create();
                }
              }}
            />
            <select
              value={format}
              onChange={(event) => setFormat(event.target.value as DeckFormat)}
              aria-label="New deck format"
              disabled={isPending}
              className={cn(inputClass(false), "h-9 w-auto")}
            >
              {DECK_FORMAT_VALUES.map((value) => (
                <option key={value} value={value}>
                  {DECK_FORMAT_LABELS[value]}
                </option>
              ))}
            </select>
          </div>
          {/* The deck's visibility, on show (TODO DK0.8): the card
              creator's Publish control in its order — the private box,
              then Unlisted / Public with Public picked. */}
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border/60 bg-background/40 px-3 py-2 text-sm text-foreground has-[:checked]:border-primary/50 has-[:checked]:bg-primary/5">
            {/* Named by its words alone and DESCRIBED by the line under them
                (TODO 3b.36, as the card's "Save as a draft"); the label
                still makes the whole box a click target. */}
            <input
              type="checkbox"
              checked={keepPrivate}
              onChange={(event) => setKeepPrivate(event.target.checked)}
              aria-labelledby={privateNameId}
              aria-describedby={privateNoteId}
              disabled={isPending}
              className="mt-0.5 h-4 w-4 accent-[var(--color-primary)]"
            />
            <span className="flex flex-col gap-0.5">
              <span id={privateNameId} className="inline-flex items-center gap-1.5 font-medium">
                <Lock className="h-4 w-4 text-muted" aria-hidden />
                Keep it private
              </span>
              <span id={privateNoteId} className="text-xs leading-5 text-muted">
                Private — only you can see it. Untick it whenever you&apos;re ready to share it.
              </span>
            </span>
          </label>
          {keepPrivate ? null : (
            <ChipGroup
              ariaLabel="New deck visibility"
              layout="grid-2"
              size="sm"
              value={listing}
              onChange={setListing}
              options={LISTING_OPTIONS}
            />
          )}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={create}
              disabled={isPending}
              className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
            >
              {isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <Plus className="h-3.5 w-3.5" aria-hidden />
              )}
              Create deck
            </button>
            <button
              type="button"
              onClick={(event) => {
                // Gone before its click ends (like "＋ New deck"): a click
                // WebKit would hand on to whatever sits under it.
                event.preventDefault();
                close();
              }}
              disabled={isPending}
              className="text-xs text-muted transition-colors hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          ref={newDeckRef}
          type="button"
          disabled={disabled}
          onClick={(event) => {
            // Gone before its click ends: a cancelled click is never handed
            // on (WebKit forwards one inside a <label> to its control).
            event.preventDefault();
            setCreating(true);
          }}
          className="self-start text-xs font-medium text-primary-bright underline-offset-2 hover:underline disabled:opacity-60"
        >
          ＋ New deck
        </button>
      )}
    </div>
  );
}
