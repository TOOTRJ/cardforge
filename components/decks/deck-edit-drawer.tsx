"use client";

import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
} from "react";
import Link from "next/link";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ChevronLeft, ChevronRight, ExternalLink, Loader2, X } from "lucide-react";
import type { CreatorHost, CreatorLeaveCheck } from "@/components/creator/creator-host";
import { DeckEntryStatusBadge } from "@/components/decks/deck-entry-status-badge";
import type { ViewRow } from "@/components/decks/deck-row-ui";
import { nextUnchangedImport, type DeckGroup } from "@/lib/decks/deck-view";
import {
  DECK_EDIT_NEW,
  DECK_EDIT_PARAM,
  parseDeckEditParam,
  withDeckEditParam,
  type DeckEditShared,
} from "@/lib/decks/inline-editor-shared";
import { entryEditTarget } from "@/lib/decks/return-to";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// The deck's edit drawer (TODO DK5.18, owner decisions 2026-11-02): a card's
// Edit / Customize / Remix on the OWNER's deck page opens the card creator
// in a MODAL drawer over the deck — the deck dimmed behind it, the edited
// row marked — instead of leaving for /create or /card/…/edit and coming
// back (DK5.5). Behind the admin switch (lib/decks/inline-editor-shared.ts):
// while the viewer isn't allowed, `useDeckEditDrawer` is inert and the
// deck page's Edit links navigate exactly as on main.
//
//  - The URL: open pushes `?edit=<entry>` (or `?edit=new`) with the native
//    history (Next syncs it; never router.push — no navigation, no action
//    queue), so Back closes the drawer and a reload reopens it. The walk
//    (‹ ›, "Save & next") REPLACES it. A visitor's page never reads it.
//  - Leaving with changes (✕, Esc, the scrim, Back, the walk) asks through
//    the creator's own leave dialog (`bindLeave`, the hosted guard).
//  - Closed, the focus goes back to the row that opened it (else "＋ Create
//    new card", else the list's first control) — never <body>.
//  - The body (the creator: a large chunk) is lazy — loaded on the first
//    open, fetched ahead on an Edit's hover / focus (`prefetch`).
//  - About 880 px at 1366 (min(64rem, 100vw − 480px)) docked right from
//    1024 px; full screen under it with a "‹ Deck" way back. The creator
//    inside reads the drawer's width (its `creator-lg` container variant).
// ---------------------------------------------------------------------------

const loadBody = () => import("@/components/decks/deck-edit-drawer-body");
const DeckEditDrawerBody = lazy(loadBody);

/** "＋ Create new card"'s id (the focus comes back to it). */
export const DECK_CREATE_NEW_ID = "deck-create-new-card";

/** The drawer's body is two columns from this content width (the
 *  `creator-lg` container variant's 48rem, app/globals.css). */
const WIDE_PX = 768;

/** A plain left click (no modifier): the drawer takes it; anything else —
 *  a new tab, a new window — follows the link's own href. */
export function isPlainClick(event: ReactMouseEvent): boolean {
  return !event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

/** The page-wide creator props, kept by the drawer for the page visit. */
export type DeckEditSharedCache = {
  get: () => DeckEditShared | null;
  set: (shared: DeckEditShared | null) => void;
};

export type DeckInlineEdit = {
  /** Open the drawer on an entry (or "new"). */
  open: (target: string) => void;
  /** Fetch the drawer's chunk ahead (an Edit's hover or focus). */
  prefetch: () => void;
};

type Options = {
  /** The switch allows this viewer, and they own the deck. */
  enabled: boolean;
  deck: { id: string; slug: string; title: string } | null;
  /** The groups on show (the walk: ‹ › in the list's order). */
  groups: readonly DeckGroup<ViewRow>[];
  /** Every group, filters aside ("Save & next": the next unchanged import). */
  allGroups: readonly DeckGroup<ViewRow>[];
  /** The card area: its first control is the focus's last resort. */
  listRef: RefObject<HTMLElement | null>;
};

function urlTarget(): string | null {
  return parseDeckEditParam(new URLSearchParams(window.location.search).get(DECK_EDIT_PARAM));
}

/** The history entry the drawer pushed carries this key (its target): an
 *  arrival on it — Back from "Open full page", a reload, Forward — finds
 *  the deck's own entry under it already, and never pushes a second copy. */
const ENTRY_MARK = "pipglyphDeckEdit";

function markOf(state: unknown): string | null {
  const mark = (state as Record<string, unknown> | null)?.[ENTRY_MARK];
  return typeof mark === "string" ? mark : null;
}

function setUrl(target: string | null, how: "push" | "replace") {
  const href = withDeckEditParam(`${window.location.pathname}${window.location.search}${window.location.hash}`, target);
  // Native history: Next.js syncs it (useSearchParams), no navigation. Its
  // patched pushState / replaceState copy the router's own state into ours
  // (never spread history.state here: with `__NA` in it Next skips the URL).
  const state = target ? { [ENTRY_MARK]: target } : null;
  if (how === "push") window.history.pushState(state, "", href);
  else window.history.replaceState(state, "", href);
}

/** Keep the mark on the current entry: a router update that does not keep
 *  custom history state (a server action's refresh) writes the entry again
 *  without it. No URL argument — Next then leaves its router alone. */
function keepMark(target: string) {
  if (urlTarget() !== target || markOf(window.history.state) === target) return;
  window.history.replaceState({ [ENTRY_MARK]: target }, "");
}

/** The drawer's heading (the focus's home inside it). */
function drawerHeading(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[data-deck-edit-drawer] [data-deck-edit-title]");
}

export function useDeckEditDrawer({ enabled, deck, groups, allGroups, listRef }: Options): {
  inline: DeckInlineEdit | null;
  drawer: ReactNode;
} {
  const [target, setTargetState] = useState<string | null>(null);
  const targetRef = useRef<string | null>(null);
  const setTarget = useCallback((next: string | null) => {
    targetRef.current = next;
    setTargetState(next);
  }, []);
  /** The `?edit=` entry is ours, on top of the deck's own: closing goes back. */
  const pushed = useRef(false);
  /** The entry whose row the focus returns to ("new": the create button). */
  const opener = useRef<string | null>(null);
  const leaveRef = useRef<CreatorLeaveCheck | null>(null);
  const bindLeave = useCallback((ask: CreatorLeaveCheck | null) => {
    leaveRef.current = ask;
  }, []);
  const [chunkWanted, setChunkWanted] = useState(false);
  /** The creator's page-wide props (decks, capacity, verified frames…),
   *  read with the first open and kept for the visit; a save that changes
   *  them (a new card: capacity, decks) drops them for the next read. */
  const sharedRef = useRef<DeckEditShared | null>(null);
  const sharedCache = useMemo<DeckEditSharedCache>(
    () => ({
      get: () => sharedRef.current,
      set: (shared) => {
        sharedRef.current = shared;
      },
    }),
    [],
  );

  const prefetch = useCallback(() => {
    void loadBody().catch(() => undefined);
  }, []);

  /** Where the focus was when the drawer asked to leave: "Keep editing"
   *  puts it back there (else the drawer's heading) — never <body>. */
  const returnFocus = useRef<HTMLElement | null>(null);
  const remember = () => {
    const active = document.activeElement;
    returnFocus.current = active instanceof HTMLElement && active !== document.body ? active : null;
  };
  const focusHome = useCallback(() => {
    if (targetRef.current === null) return; // closed: the row's hand-back
    const el = returnFocus.current;
    returnFocus.current = null;
    const home =
      el && el.isConnected && el.closest("[data-deck-edit-drawer]") && !(el as HTMLButtonElement).disabled ? el : drawerHeading();
    home?.focus({ preventScroll: true });
  }, []);

  /** Ask (with changes) before `proceed`. */
  const askThen = (proceed: () => void, force = false) => {
    const ask = leaveRef.current;
    if (force || !ask) proceed();
    else {
      remember();
      ask(proceed);
    }
  };

  const closeNow = useCallback(() => {
    if (targetRef.current === null) return;
    setTarget(null);
    if (pushed.current) {
      pushed.current = false;
      window.history.back();
    } else {
      setUrl(null, "replace");
    }
  }, [setTarget]);

  const walkTo = useCallback(
    (next: string, force = false) => {
      const go = () => {
        opener.current = next;
        setUrl(next, "replace");
        setTarget(next);
      };
      const ask = leaveRef.current;
      if (force || !ask) go();
      else {
        remember();
        ask(go);
      }
    },
    [setTarget],
  );

  const open = useCallback(
    (next: string) => {
      if (!enabled) return;
      setChunkWanted(true);
      const current = targetRef.current;
      if (current === next) return;
      if (current !== null) {
        walkTo(next);
        return;
      }
      opener.current = next;
      setUrl(next, "push");
      pushed.current = true;
      setTarget(next);
    },
    [enabled, setTarget, walkTo],
  );

  // Arriving on `?edit=` (a reload, a shared link): the deck under it, and
  // the drawer's own entry on top — so Back closes it, as after a click.
  // Opened once the page has loaded AND gone idle: a modal hides the rest of
  // the page from assistive tech (aria-hidden on its siblings), and a part
  // of the page still hydrating (a Suspense boundary React hydrates late)
  // would then not match its HTML.
  useEffect(() => {
    if (!enabled || !urlTarget()) return;
    let timer = 0;
    let idle = 0;
    let cancelled = false;
    const openFromUrl = () => {
      const initial = urlTarget();
      if (!initial || targetRef.current !== null) return;
      // An entry the drawer pushed (Back from "Open full page", a reload of
      // it): the deck's own entry is under it already. Anything else (a
      // shared link) becomes the deck's entry plus the drawer's on top.
      if (markOf(window.history.state) !== initial) {
        setUrl(null, "replace");
        setUrl(initial, "push");
      }
      pushed.current = true;
      opener.current = initial;
      setChunkWanted(true);
      setTarget(initial);
    };
    const soon = () => {
      // The creator's chunk first (the drawer needs it anyway), then idle.
      void loadBody()
        .catch(() => undefined)
        .then(() => {
          if (cancelled) return;
          if (typeof window.requestIdleCallback === "function") idle = window.requestIdleCallback(openFromUrl, { timeout: 1500 });
          else timer = window.setTimeout(openFromUrl, 200);
        });
    };
    if (document.readyState === "complete") soon();
    else window.addEventListener("load", soon, { once: true });
    return () => {
      cancelled = true;
      window.removeEventListener("load", soon);
      window.clearTimeout(timer);
      if (idle) window.cancelIdleCallback?.(idle);
    };
  }, [enabled, setTarget]);

  // Back (and Forward) while on the deck page.
  useEffect(() => {
    if (!enabled || !deck) return;
    const path = window.location.pathname;
    const onPop = () => {
      if (window.location.pathname !== path) return; // left the deck page
      const fromUrl = urlTarget();
      const current = targetRef.current;
      if (fromUrl === current) return;
      if (current === null) {
        // Forward onto an edit: the drawer's own entry (marked) sits on the
        // deck's, so closing goes back to it.
        if (fromUrl) {
          pushed.current = markOf(window.history.state) === fromUrl;
          opener.current = fromUrl;
          setChunkWanted(true);
          setTarget(fromUrl);
        }
        return;
      }
      // Back off the drawer's entry: closes it — with changes, put the
      // entry back first and ask (the creator's leave dialog).
      let asked = false;
      const proceed = () => {
        if (asked) {
          targetRef.current = null;
          pushed.current = false;
          setTarget(null);
          window.history.back();
          return;
        }
        pushed.current = false;
        if (fromUrl) opener.current = fromUrl;
        setTarget(fromUrl);
      };
      const ask = leaveRef.current;
      if (ask) remember();
      asked = ask ? ask(proceed) : (proceed(), false);
      if (asked) {
        setUrl(current, "push");
        pushed.current = true;
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [enabled, deck, setTarget]);

  // The drawer's history entry keeps its mark while it is open.
  useEffect(() => {
    if (enabled && target) keepMark(target);
  });

  // The row being edited is marked on the deck behind the drawer — only
  // where the drawer is on, and only when the target or the rows change.
  const marked = useRef<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const want = target && target !== DECK_EDIT_NEW ? target : null;
    const list = listRef.current;
    if (!list || (want === null && marked.current === null)) return;
    for (const el of Array.from(list.querySelectorAll("[data-editing]"))) {
      if (el.getAttribute("data-deck-entry") !== want) el.removeAttribute("data-editing");
    }
    if (want) list.querySelectorAll(`[data-deck-entry="${CSS.escape(want)}"]`).forEach((el) => el.setAttribute("data-editing", ""));
    marked.current = want;
  }, [enabled, target, groups, allGroups, listRef]);

  // Closed: the focus back to the row that opened it — never <body>.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (target !== null) {
      wasOpen.current = true;
      return;
    }
    if (!wasOpen.current) return;
    wasOpen.current = false;
    const handBack = () => {
      const id = opener.current;
      const list = listRef.current;
      const row =
        id && id !== DECK_EDIT_NEW ? list?.querySelector<HTMLElement>(`[data-deck-entry="${id}"]`) : null;
      const el =
        (row && !row.closest("[hidden]") ? row : null) ??
        document.getElementById(DECK_CREATE_NEW_ID) ??
        list?.querySelector<HTMLElement>("button, a[href], input");
      el?.focus({ preventScroll: true });
      el?.scrollIntoView?.({ block: "nearest" });
    };
    handBack();
    // A scrim click's mousedown lands after the close and blurs it again.
    const again = window.setTimeout(() => {
      if (!document.activeElement || document.activeElement === document.body) handBack();
    }, 0);
    return () => window.clearTimeout(again);
  }, [target, listRef]);

  // ---- the walk ------------------------------------------------------------
  const stops = useMemo(
    () =>
      groups.flatMap((group) => {
        const rows = group.rows.filter((row) => !row.item.pending);
        return rows.map((row, index) => ({ row, group: group.label, index, total: rows.length }));
      }),
    [groups],
  );
  const rowsById = useMemo(() => new Map(allGroups.flatMap((group) => group.rows).map((row) => [row.id, row])), [allGroups]);

  const inline = useMemo<DeckInlineEdit | null>(() => (enabled && deck ? { open, prefetch } : null), [enabled, deck, open, prefetch]);

  if (!enabled || !deck) return { inline: null, drawer: null };

  const at = target ? stops.findIndex((stop) => stop.row.id === target) : -1;
  const stop = at >= 0 ? stops[at] : null;
  const prev = at > 0 ? stops[at - 1].row : null;
  const next = at >= 0 && at < stops.length - 1 ? stops[at + 1].row : null;
  const row = target && target !== DECK_EDIT_NEW ? (rowsById.get(target) ?? null) : null;
  const edit = row ? entryEditTarget(row.item, deck.slug) : null;
  // "Save & next": the next unchanged import (DK5.5's "Edit next" walk).
  // Never on a new card ("＋ Create new card" makes one, then stops).
  const nextImport =
    target === null || target === DECK_EDIT_NEW
      ? null
      : nextUnchangedImport(allGroups.map((group) => ({ ...group, rows: group.rows.filter((r) => r.id !== target && !r.item.pending) })));

  const drawer = chunkWanted ? (
    <DeckEditDrawer
      open={target !== null}
      deck={deck}
      target={target}
      row={row}
      label={target === DECK_EDIT_NEW ? "New card" : (edit?.label ?? "Edit card")}
      fullPageHref={target === DECK_EDIT_NEW ? "/create" : (edit?.href ?? `/deck/${deck.slug}`)}
      position={stop ? { index: stop.index + 1, total: stop.total, group: stop.group } : null}
      prev={prev}
      next={next}
      nextImport={nextImport}
      bindLeave={bindLeave}
      focusHome={focusHome}
      sharedCache={sharedCache}
      onRequestClose={() => askThen(closeNow)}
      onCloseNow={closeNow}
      onWalk={walkTo}
      onRetarget={(entryId) => {
        opener.current = entryId;
        setUrl(entryId, "replace");
        setTarget(entryId);
      }}
    />
  ) : null;
  return { inline, drawer };
}

type DrawerProps = {
  open: boolean;
  deck: { id: string; slug: string; title: string };
  target: string | null;
  row: ViewRow | null;
  /** The entry's Edit words (Edit card / Customize / Remix / …). */
  label: string;
  fullPageHref: string;
  position: { index: number; total: number; group: string } | null;
  prev: ViewRow | null;
  next: ViewRow | null;
  nextImport: ViewRow | null;
  bindLeave: CreatorHost["bindLeave"];
  focusHome: () => void;
  sharedCache: DeckEditSharedCache;
  onRequestClose: () => void;
  onCloseNow: () => void;
  onWalk: (target: string, force?: boolean) => void;
  onRetarget: (entryId: string) => void;
};

const HEADER_BUTTON =
  "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border/70 text-muted transition-colors hover:border-border-strong hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60 disabled:pointer-events-none disabled:opacity-40";

function eyebrowOf(label: string, position: DrawerProps["position"], deckTitle: string, isNew: boolean): string {
  if (isNew) return `New card · into ${deckTitle}`;
  const doing =
    label === "Edit card"
      ? "Editing"
      : label === "Remix"
        ? "Your version of another creator's card"
        : label === "Customize"
          ? "Your version of a real card"
          : "A card of your own in this entry's place";
  return position ? `${doing} · ${position.index} of ${position.total} in ${position.group}` : doing;
}

function DeckEditDrawer({
  open,
  deck,
  target,
  row,
  label,
  fullPageHref,
  position,
  prev,
  next,
  nextImport,
  bindLeave,
  focusHome,
  sharedCache,
  onRequestClose,
  onCloseNow,
  onWalk,
  onRetarget,
}: DrawerProps) {
  const [scrollRoot, setScrollRoot] = useState<HTMLDivElement | null>(null);
  const [wide, setWide] = useState<boolean | null>(null);
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);

  /** The focus never rests on <body>, on the drawer's box itself (where
   *  Radix puts it when the focused element is removed — a form remounted
   *  after a save) or on a control that just turned itself off (‹ at the
   *  first card): it goes to the heading. */
  const settleFocus = useCallback(() => {
    window.setTimeout(() => {
      const active = document.activeElement;
      if (!titleRef.current?.isConnected) return;
      if (!active || active === document.body || active === contentRef.current || (active as HTMLButtonElement).disabled) {
        titleRef.current.focus({ preventScroll: true });
      }
    }, 0);
  }, []);
  // Each card of the walk, and each retarget (a new card on its entry).
  useEffect(() => {
    if (open) settleFocus();
  }, [open, target, settleFocus]);

  useEffect(() => {
    if (!scrollRoot || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWide(entry.contentRect.width >= WIDE_PX);
    });
    observer.observe(scrollRoot);
    return () => observer.disconnect();
  }, [scrollRoot]);

  // A new card's place in the walk: back to the top of the drawer.
  useEffect(() => {
    scrollRoot?.scrollTo?.({ top: 0 });
  }, [target, scrollRoot]);

  const isNew = target === DECK_EDIT_NEW;
  // The row's name: live — a saved title comes back with the deck's rows.
  const title = row?.name ?? (isNew ? "New card" : "Card");
  const nextAfterSave = nextImport;
  const saveAndNext = useMemo<CreatorHost["saveAndNext"]>(
    () =>
      nextAfterSave
        ? { label: "Save & next", onNext: () => onWalk(nextAfterSave.id, true) }
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- by the next card's id
    [nextAfterSave?.id],
  );

  return (
    <DialogPrimitive.Root open={open}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          data-deck-edit-scrim=""
          className="fixed inset-0 z-50 bg-black/40 transition-opacity duration-150 data-[state=closed]:opacity-0"
        />
        <DialogPrimitive.Content
          ref={contentRef}
          data-deck-edit-drawer=""
          onFocus={(event) => {
            // The box itself took the focus (Radix, after the focused
            // element was removed): the heading has it instead.
            if (event.target === event.currentTarget) titleRef.current?.focus({ preventScroll: true });
          }}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            titleRef.current?.focus();
          }}
          // The row's hand-back is the hook's (the drawer never had a trigger).
          onCloseAutoFocus={(event) => event.preventDefault()}
          onEscapeKeyDown={(event) => {
            event.preventDefault();
            onRequestClose();
          }}
          onPointerDownOutside={(event) => {
            event.preventDefault();
            // A toast is outside the drawer too, and never closes it.
            const at = event.target as Element | null;
            if (at?.closest?.("[data-sonner-toaster]")) return;
            onRequestClose();
          }}
          onFocusOutside={(event) => event.preventDefault()}
          className="fixed inset-0 z-50 flex flex-col bg-background shadow-2xl outline-none lg:left-auto lg:w-[min(64rem,calc(100vw-480px))] lg:rounded-l-2xl lg:border-l lg:border-border"
        >
          <header className="flex flex-col border-b border-border/60 bg-surface/60">
            {/* Full screen (under 1024 px): the way back is the deck's name. */}
            <div className="flex items-center px-2 pt-2 lg:hidden">
              <button
                type="button"
                onClick={onRequestClose}
                className="inline-flex min-h-9 min-w-0 items-center gap-1 rounded-md px-2 text-sm font-medium text-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60"
              >
                <ChevronLeft className="h-4 w-4 shrink-0" aria-hidden />
                <span className="truncate">
                  <span className="sr-only">Back to </span>
                  {deck.title}
                </span>
              </button>
            </div>
            <div className="flex items-center gap-2 px-3 py-2.5 sm:px-4">
              {isNew ? null : (
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    className={HEADER_BUTTON}
                    disabled={!prev}
                    onClick={() => prev && onWalk(prev.id)}
                    aria-label={prev ? `Previous card: ${prev.name}` : "Previous card"}
                  >
                    <ChevronLeft className="h-4 w-4" aria-hidden />
                  </button>
                  <button
                    type="button"
                    className={HEADER_BUTTON}
                    disabled={!next}
                    onClick={() => next && onWalk(next.id)}
                    aria-label={next ? `Next card: ${next.name}` : "Next card"}
                  >
                    <ChevronRight className="h-4 w-4" aria-hidden />
                  </button>
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs text-muted">{eyebrowOf(label, position, deck.title, isNew)}</p>
                <div className="flex min-w-0 items-center gap-2">
                  <DialogPrimitive.Title asChild>
                    <h2 ref={titleRef} tabIndex={-1} data-deck-edit-title="" className="truncate font-display text-base font-semibold text-foreground focus:outline-none sm:text-lg">
                      {title}
                    </h2>
                  </DialogPrimitive.Title>
                  {row ? <DeckEntryStatusBadge status={row.status} unavailable={row.badge === "unavailable"} small /> : null}
                </div>
              </div>
              <Link
                href={fullPageHref}
                // Back from the full page lands on this marked entry, and
                // the drawer reopens on it without another history entry.
                onClick={() => {
                  if (target) keepMark(target);
                }}
                className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60 sm:text-sm"
              >
                <span className="hidden sm:inline">Open full page</span>
                <span className="sm:hidden">Full page</span>
                <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              </Link>
              <button type="button" onClick={onRequestClose} className={cn(HEADER_BUTTON, "hidden lg:inline-flex")} aria-label="Close the editor">
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
            <DialogPrimitive.Description className="sr-only">
              Editing a card of {deck.title} without leaving the deck. Saving keeps you here; closing returns to the deck.
            </DialogPrimitive.Description>
          </header>
          <div
            ref={setScrollRoot}
            data-creator-host=""
            className="@container/creator min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-6 pt-4 sm:px-6"
            style={{ "--creator-sticky-top": "1rem", "--creator-sticky-switch": "0rem" } as CSSProperties}
          >
            {target ? (
              <Suspense fallback={<DeckEditDrawerLoading />}>
                <DeckEditDrawerBody
                  deckId={deck.id}
                  target={target}
                  bindLeave={bindLeave}
                  focusHome={focusHome}
                  onSettled={settleFocus}
                  sharedCache={sharedCache}
                  scrollRoot={scrollRoot}
                  wide={wide}
                  saveAndNext={saveAndNext}
                  fullPageHref={fullPageHref}
                  onRequestClose={onRequestClose}
                  onCloseNow={onCloseNow}
                  onRetarget={onRetarget}
                />
              </Suspense>
            ) : null}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** While the chunk or the card is on its way. */
export function DeckEditDrawerLoading() {
  return (
    <div role="status" className="flex items-center justify-center gap-2 py-24 text-sm text-muted">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      Opening the editor…
    </div>
  );
}
