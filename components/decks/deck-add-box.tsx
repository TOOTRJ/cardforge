"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Loader2, Plus, Search } from "lucide-react";
import { ManaCostGlyphs } from "@/components/cards/mana-cost-glyphs";
import { useDeckEditor, type EditorItem } from "@/components/decks/use-deck-editor";
import type { AddCandidate } from "@/lib/decks/add-search-queries";
import {
  ADD_SEARCH_MIN_CHARS,
  inDeckCountForCard,
  inDeckCountForName,
  inDeckLabel,
  normalizeAddQuery,
  rankRealCards,
  scryfallPictureAt,
  type AddPick,
} from "@/lib/decks/add-search";
import { boardPhrase, moveTargets } from "@/lib/decks/entry-ops";
import { isAddBoxShortcut } from "@/lib/decks/entry-shortcuts";
import { entryPrintingImage } from "@/lib/decks/entry-image";
import { formatHasCommander } from "@/lib/decks/format-rules";
import { isStoredRenderUrl, toRenderCdnUrl } from "@/lib/cards/render-cdn";
import { cn } from "@/lib/utils";
import { useMediaQuery } from "@/components/creator/use-media-query";
import { DECK_BOARD_LABELS, type DeckBoard, type DeckCardEntry } from "@/types/deck";

// ---------------------------------------------------------------------------
// The deck page's add box (TODO DK5.2) — ONE search over three places, in
// sections: My cards (the owner's own, any visibility), PipGlyph cards
// (other creators' public cards, owner decision D3) and Real cards
// (Scryfall, through the app's own route and its quota). Enter adds the
// highlighted result to the board the box names; every result says how many
// copies the deck already holds ("In deck ×2"). It replaces #671's "Add from
// my cards" picker (the 200 most recent cards, filtered in the browser).
//
// An ARIA 1.2 combobox: the input is the combobox (aria-expanded,
// aria-controls, aria-activedescendant) and the results ONE listbox, a
// group a section (named by its heading). The focus never leaves the input:
// ↓ / ↑ move the highlight through every section (wrapping), Enter adds it,
// Escape closes the list (a second Escape empties the box), Tab leaves. The
// first result is highlighted as results arrive. A section still searching,
// empty or refused says so under the list, and one status line tells a
// screen reader how many results each section has. "/" anywhere on the
// owner's page — outside a field — focuses the box; the empty deck's doors,
// the commander slot and the phone bar's Add open it (`pipglyph:deck-tool`
// "add" / "add-commander").
//
// An add goes through the page's editor (components/decks/use-deck-editor):
// the card is drawn at once — a new row, or one copy more on the row it
// lands on — and the server's add (lib/decks/add-actions.ts) writes it
// through the membership writer or a one-line decklist import, never a
// client-side insert. The list stays open for the next card.
// ---------------------------------------------------------------------------

/** The box's input id: the page's controls that focus it find it by this. */
export const DECK_ADD_INPUT_ID = "deck-add-input";
const DECK_TOOL_EVENT = "pipglyph:deck-tool";
const SEARCH_DELAY_MS = 220;
/** Real cards asked for — ranked in the browser, the first six shown. */
const REAL_RESULTS_ASKED = 20;

type RealCard = {
  id: string;
  name: string;
  type_line: string | null;
  mana_cost: string | null;
  rarity: string | null;
  set: string | null;
  print_url: string | null;
};

type SectionKey = "mine" | "community" | "real";
type SectionState = { status: "idle" | "loading" | "done" | "error"; error?: string };

const SECTION_LABELS: Record<SectionKey, string> = {
  mine: "My cards",
  community: "PipGlyph cards",
  real: "Real cards",
};

type AddOption = {
  key: string;
  section: SectionKey;
  name: string;
  meta: string | null;
  cost: string | null;
  picture: string | null;
  inDeck: string | null;
  pick: AddPick;
  /** The row drawn while the server writes a NEW line. */
  preview: (board: DeckBoard) => EditorItem;
};

let pendingSerial = 0;
/** A row nobody has written yet (an id that is no uuid: never sent). */
function pendingEntry(deckId: string, board: DeckBoard, fields: Partial<DeckCardEntry> & { name: string }): DeckCardEntry {
  pendingSerial += 1;
  const now = new Date().toISOString();
  return {
    id: `pending-${pendingSerial}`,
    deck_id: deckId,
    board,
    quantity: 1,
    position: Number.MAX_SAFE_INTEGER,
    card_id: null,
    scryfall_id: null,
    set_code: null,
    collector_number: null,
    type_line: null,
    mana_cost: null,
    mana_value: null,
    color_identity: [],
    rarity: null,
    image_url: null,
    created_at: now,
    updated_at: now,
    source: null,
    ...fields,
  };
}

function cardThumb(candidate: AddCandidate): string | null {
  const { card } = candidate;
  if (!isStoredRenderUrl(card.rendered_image_url) || !isStoredRenderUrl(card.rendered_thumb_url)) return null;
  return toRenderCdnUrl(card.rendered_thumb_url) ?? card.rendered_thumb_url;
}

export function DeckAddBox({ className }: { className?: string }) {
  const editor = useDeckEditor();
  const baseId = useId();
  const listId = `${baseId}-list`;
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [board, setBoard] = useState<DeckBoard>("main");
  const [active, setActive] = useState<string | null>(null);
  const [mine, setMine] = useState<AddCandidate[]>([]);
  const [community, setCommunity] = useState<AddCandidate[]>([]);
  const [real, setReal] = useState<RealCard[]>([]);
  const [sections, setSections] = useState<Record<SectionKey, SectionState>>({
    mine: { status: "idle" },
    community: { status: "idle" },
    real: { status: "idle" },
  });
  const [adding, setAdding] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);
  const searched = useRef<string | null>(null);
  // The full invitation where it fits; a phone gets the short one.
  const roomy = useMediaQuery("(min-width: 40rem)") === true;

  const deck = editor?.deck ?? null;
  const entries = useMemo(() => (editor?.items ?? []).filter((item) => !item.pending).map((item) => item.entry), [editor?.items]);
  const boards = useMemo(() => (deck ? moveTargets(formatHasCommander(deck.format)) : (["main"] as DeckBoard[])), [deck]);

  // ---- searching ---------------------------------------------------------
  const runSearch = useCallback((raw: string) => {
    const q = normalizeAddQuery(raw);
    if (searched.current === q) return;
    searched.current = q;
    const controller = new AbortController();
    const long = q.length >= ADD_SEARCH_MIN_CHARS;
    setSections({
      mine: { status: "loading" },
      community: long ? { status: "loading" } : { status: "idle" },
      real: long ? { status: "loading" } : { status: "idle" },
    });
    if (!long) {
      setCommunity([]);
      setReal([]);
    }
    const settle = (key: SectionKey, state: SectionState) => {
      if (searched.current !== q) return;
      setSections((prev) => ({ ...prev, [key]: state }));
    };
    void fetch(`/api/decks/add-search?q=${encodeURIComponent(q)}`, { signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json()) as { ok: boolean; mine?: AddCandidate[]; community?: AddCandidate[]; error?: string };
        if (searched.current !== q) return;
        if (!response.ok || !body.ok) {
          settle("mine", { status: "error", error: body.error ?? "Couldn't search your cards." });
          if (long) settle("community", { status: "error", error: body.error ?? "Couldn't search PipGlyph cards." });
          return;
        }
        setMine(body.mine ?? []);
        setCommunity(body.community ?? []);
        settle("mine", { status: "done" });
        if (long) settle("community", { status: "done" });
      })
      .catch((error: unknown) => {
        if ((error as { name?: string })?.name === "AbortError") return;
        settle("mine", { status: "error", error: "Couldn't search your cards." });
        if (long) settle("community", { status: "error", error: "Couldn't search PipGlyph cards." });
      });
    if (long) {
      void fetch(`/api/scryfall/search?q=${encodeURIComponent(q)}&limit=${REAL_RESULTS_ASKED}&order=edhrec`, { signal: controller.signal })
        .then(async (response) => {
          const body = (await response.json()) as { ok: boolean; results?: RealCard[]; error?: string };
          if (searched.current !== q) return;
          if (!response.ok || !body.ok) {
            settle("real", {
              status: "error",
              error: response.status === 429 ? (body.error ?? "Real-card search is busy — try again in a minute.") : (body.error ?? "Couldn't reach Scryfall."),
            });
            return;
          }
          setReal(rankRealCards(body.results ?? [], q));
          settle("real", { status: "done" });
        })
        .catch((error: unknown) => {
          if ((error as { name?: string })?.name === "AbortError") return;
          settle("real", { status: "error", error: "Couldn't reach Scryfall." });
        });
    }
    return controller;
  }, []);

  const controllerRef = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      const next = normalizeAddQuery(query);
      if (searched.current === next) return;
      controllerRef.current?.abort();
      controllerRef.current = runSearch(query) ?? null;
    }, searched.current === null ? 0 : SEARCH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [open, query, runSearch]);
  useEffect(() => () => controllerRef.current?.abort(), []);

  // ---- the options, in section order --------------------------------------
  const options = useMemo<AddOption[]>(() => {
    if (!deck) return [];
    const fromCard = (section: SectionKey) => (candidate: AddCandidate): AddOption => {
      const { card, maker } = candidate;
      return {
        key: `${section}:${card.id}`,
        section,
        name: card.title,
        meta: maker ? `by @${maker}` : card.visibility === "public" ? null : card.visibility === "private" ? "Private" : "Unlisted",
        cost: card.cost ?? null,
        picture: cardThumb(candidate),
        inDeck: inDeckLabel(inDeckCountForCard(entries, card.id)),
        pick: { kind: "card", cardId: card.id, title: card.title },
        preview: (to) => ({
          entry: pendingEntry(deck.id, to, { name: card.title, card_id: card.id, source: "link" }),
          card,
          cardOwner: maker ? { username: maker } : null,
        }),
      };
    };
    const fromReal = (card: RealCard): AddOption => ({
      key: `real:${card.id}`,
      section: "real",
      name: card.name,
      meta: [card.type_line, card.set?.toUpperCase()].filter(Boolean).join(" · ") || null,
      cost: card.mana_cost,
      picture: entryPrintingImage(scryfallPictureAt(card.print_url, "small"), "small"),
      inDeck: inDeckLabel(inDeckCountForName(entries, card.name)),
      pick: { kind: "printing", scryfallId: card.id, name: card.name },
      preview: (to) => ({
        entry: pendingEntry(deck.id, to, {
          name: card.name,
          scryfall_id: card.id,
          type_line: card.type_line,
          mana_cost: card.mana_cost,
          rarity: card.rarity,
          image_url: scryfallPictureAt(card.print_url, "normal"),
          source: "import",
        }),
        card: null,
        cardOwner: null,
      }),
    });
    return [...mine.map(fromCard("mine")), ...community.map(fromCard("community")), ...real.map(fromReal)];
  }, [community, deck, entries, mine, real]);

  // The highlighted result: the one the arrows (or the pointer) chose while
  // it is still there, else the first — so results that arrive are
  // highlighted from their first, and Enter always has one to add.
  const activeOption = open ? (options.find((option) => option.key === active) ?? options[0] ?? null) : null;
  const activeKey = activeOption?.key ?? null;
  useEffect(() => {
    if (!activeKey) return;
    document.getElementById(`${baseId}-${activeKey}`)?.scrollIntoView({ block: "nearest" });
  }, [activeKey, baseId]);

  // ---- adding ------------------------------------------------------------
  const addOption = useCallback(
    async (option: AddOption) => {
      if (!editor || adding.has(option.key)) return;
      setAdding((prev) => new Set(prev).add(option.key));
      setNotice(null);
      const result = await editor.add(option.pick, board, option.preview(board));
      setAdding((prev) => {
        const next = new Set(prev);
        next.delete(option.key);
        return next;
      });
      if (result.ok) {
        editor.announce(
          result.merged
            ? `${option.name}: one more on ${boardPhrase(result.board)} — ${result.quantity} now.`
            : `Added ${option.name} to ${boardPhrase(result.board)}.`,
        );
      } else {
        // Said by the editor's toast too; kept here, next to the box.
        setNotice(result.error);
      }
    },
    [adding, board, editor],
  );

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const index = activeOption ? options.indexOf(activeOption) : -1;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      if (options.length === 0) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      const next = index < 0 ? (step > 0 ? 0 : options.length - 1) : (index + step + options.length) % options.length;
      setActive(options[next]!.key);
      return;
    }
    if (event.key === "Enter") {
      if (!open || !activeOption) return;
      event.preventDefault();
      void addOption(activeOption);
      return;
    }
    if (event.key === "Escape") {
      if (open) {
        event.preventDefault();
        setOpen(false);
      } else if (query) {
        event.preventDefault();
        setQuery("");
      }
    }
  };

  // ---- "/" and the page's doors -----------------------------------------
  const focusBox = useCallback((to?: DeckBoard) => {
    if (to) setBoard(to);
    const input = inputRef.current;
    if (!input) return;
    input.scrollIntoView({ block: "center", behavior: "smooth" });
    input.focus({ preventScroll: true });
    setOpen(true);
  }, []);
  useEffect(() => {
    if (!editor) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (!isAddBoxShortcut(event)) return;
      if (document.querySelector("[role=dialog][data-state=open], [role=alertdialog][data-state=open], [role=menu]")) return;
      event.preventDefault();
      focusBox();
    };
    const onTool = (event: Event) => {
      const tool = (event as CustomEvent<{ tool?: string }>).detail?.tool;
      if (tool === "add") focusBox();
      else if (tool === "add-commander") focusBox("commander");
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener(DECK_TOOL_EVENT, onTool);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(DECK_TOOL_EVENT, onTool);
    };
  }, [editor, focusBox]);

  if (!editor || !deck) return null;

  const grouped = (["mine", "community", "real"] as const).map((key) => ({
    key,
    options: options.filter((option) => option.section === key),
  }));
  const notes = grouped.flatMap(({ key, options: list }) => {
    const state = sections[key];
    if (list.length > 0) return [];
    if (state.status === "loading") return [{ key, text: `${SECTION_LABELS[key]}: searching…` }];
    if (state.status === "error") return [{ key, text: `${SECTION_LABELS[key]}: ${state.error}` }];
    if (state.status === "done") return [{ key, text: `${SECTION_LABELS[key]}: no matches.` }];
    if (key !== "mine" && normalizeAddQuery(query).length < ADD_SEARCH_MIN_CHARS) {
      return [{ key, text: `${SECTION_LABELS[key]}: type ${ADD_SEARCH_MIN_CHARS} letters or more.` }];
    }
    return [];
  });
  const summary = open
    ? grouped
        .map(({ key, options: list }) => (list.length > 0 ? `${list.length} in ${SECTION_LABELS[key]}` : null))
        .filter(Boolean)
        .join(", ")
    : "";
  const expanded = open;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" aria-hidden />
          <input
            ref={inputRef}
            id={DECK_ADD_INPUT_ID}
            type="text"
            role="combobox"
            aria-label="Add cards"
            aria-describedby={`${baseId}-hint`}
            aria-expanded={expanded}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={expanded && activeOption ? `${baseId}-${activeOption.key}` : undefined}
            autoComplete="off"
            spellCheck={false}
            value={query}
            placeholder={roomy ? "Add cards — search your cards, PipGlyph cards and real cards" : "Search cards to add"}
            onChange={(event) => {
              setQuery(event.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onClick={() => setOpen(true)}
            // A click on a result keeps the focus here (the list's
            // mousedown is cancelled); any other blur closes the list.
            onBlur={() => setOpen(false)}
            onKeyDown={onKeyDown}
            className="h-11 w-full rounded-md border border-border bg-background/60 pl-9 pr-12 text-sm text-foreground placeholder:text-subtle focus-visible:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/50"
          />
          <kbd aria-hidden className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded border border-border px-1.5 font-mono text-[11px] text-subtle sm:block">
            /
          </kbd>
          <div
            hidden={!expanded}
            className="absolute inset-x-0 top-full z-40 mt-1 max-h-[min(60vh,28rem)] overflow-y-auto rounded-md border border-border bg-surface p-1 shadow-2xl"
            // A click on a result must not take the focus off the input.
            onMouseDown={(event) => event.preventDefault()}
          >
            <div id={listId} role="listbox" aria-label="Cards to add">
              {grouped.map(({ key, options: list }) =>
                list.length === 0 ? null : (
                  <div key={key} role="group" aria-labelledby={`${baseId}-section-${key}`} className="py-1">
                    <div
                      id={`${baseId}-section-${key}`}
                      role="presentation"
                      className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wider text-subtle"
                    >
                      {SECTION_LABELS[key]}
                    </div>
                    {list.map((option) => {
                      const selected = option.key === activeOption?.key;
                      const busy = adding.has(option.key);
                      return (
                        <div
                          key={option.key}
                          id={`${baseId}-${option.key}`}
                          role="option"
                          aria-selected={selected}
                          aria-label={[option.name, option.meta, option.inDeck].filter(Boolean).join(", ")}
                          onClick={() => void addOption(option)}
                          onMouseMove={() => {
                            if (!selected) setActive(option.key);
                          }}
                          className={cn(
                            "flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm",
                            selected ? "bg-primary/15 text-foreground" : "text-foreground hover:bg-elevated",
                          )}
                        >
                          {option.picture ? (
                            // eslint-disable-next-line @next/next/no-img-element -- a 600 px thumb or Scryfall's small picture
                            <img src={option.picture} alt="" loading="lazy" decoding="async" className="h-10 w-7 shrink-0 rounded-sm bg-[#101015] object-cover" />
                          ) : (
                            <span aria-hidden className="h-10 w-7 shrink-0 rounded-sm bg-elevated" />
                          )}
                          <span className="flex min-w-0 flex-1 flex-col">
                            <span className="truncate font-medium">{option.name}</span>
                            {option.meta ? <span className="truncate text-xs text-muted">{option.meta}</span> : null}
                          </span>
                          {option.cost ? <ManaCostGlyphs cost={option.cost} size="sm" /> : null}
                          {option.inDeck ? (
                            <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted">{option.inDeck}</span>
                          ) : null}
                          <span aria-hidden className="flex h-6 w-6 shrink-0 items-center justify-center text-primary-bright">
                            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : selected ? <Plus className="h-4 w-4" /> : null}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ),
              )}
            </div>
            {notes.length > 0 ? (
              <ul className="flex flex-col gap-0.5 border-t border-border/60 px-2.5 py-2 text-xs text-muted first:border-t-0">
                {notes.map((note) => (
                  <li key={note.key} className="flex items-center gap-1.5">
                    {sections[note.key].status === "loading" ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : null}
                    {note.text}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
        <label className="flex shrink-0 items-center gap-2 text-xs font-medium text-muted">
          Add to
          <select
            value={board}
            onChange={(event) => setBoard(event.target.value as DeckBoard)}
            className="h-11 rounded-md border border-border bg-background/60 px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/50 sm:h-9"
          >
            {boards.map((value) => (
              <option key={value} value={value}>
                {DECK_BOARD_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p id={`${baseId}-hint`} className="sr-only">
        Type to search. Up and down arrows move through the results; Enter adds the highlighted card to the {DECK_BOARD_LABELS[board]}.
      </p>
      {notice ? (
        <p className="text-xs text-danger" data-testid="deck-add-notice">
          {notice}
        </p>
      ) : null}

      <p role="status" className="sr-only">
        {summary ? `Results: ${summary}.` : ""}
      </p>
    </div>
  );
}
