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

function setUrl(target: string | null, how: "push" | "replace") {
  const href = withDeckEditParam(`${window.location.pathname}${window.location.search}${window.location.hash}`, target);
  // Native history: Next.js syncs it (useSearchParams), no navigation.
  if (how === "push") window.history.pushState(null, "", href);
  else window.history.replaceState(null, "", href);
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

  const prefetch = useCallback(() => {
    void loadBody().catch(() => undefined);
  }, []);

  /** Ask (with changes) before `proceed`. */
  const askThen = (proceed: () => void, force = false) => {
    const ask = leaveRef.current;
    if (force || !ask) proceed();
    else ask(proceed);
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
      else ask(go);
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
      setUrl(null, "replace");
      setUrl(initial, "push");
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
        // Forward onto an edit.
        if (fromUrl) {
          pushed.current = false;
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
      asked = ask ? ask(proceed) : (proceed(), false);
      if (asked) {
        setUrl(current, "push");
        pushed.current = true;
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [enabled, deck, setTarget]);

  // The row being edited is marked on the deck behind the drawer.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    for (const marked of Array.from(list.querySelectorAll("[data-editing]"))) {
      if (marked.getAttribute("data-deck-entry") !== target) marked.removeAttribute("data-editing");
    }
    if (target && target !== DECK_EDIT_NEW) {
      list.querySelectorAll(`[data-deck-entry="${target}"]`).forEach((el) => el.setAttribute("data-editing", ""));
    }
  });

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
  const nextImport =
    target === null
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
  onRequestClose: () => void;
  onCloseNow: () => void;
  onWalk: (target: string, force?: boolean) => void;
  onRetarget: (entryId: string) => void;
};

const HEADER_BUTTON =
  "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border/70 text-muted transition-colors hover:border-border-strong hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60 disabled:pointer-events-none disabled:opacity-40";

function eyebrowOf(label: string, position: DrawerProps["position"], deckTitle: string, isNew: boolean): string {
  if (isNew) return `New card · into ${deckTitle}`;
  const doing = label === "Edit card" ? "Editing" : label === "Remix" ? "Your version of another creator's card" : "Your version of a real card";
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
  onRequestClose,
  onCloseNow,
  onWalk,
  onRetarget,
}: DrawerProps) {
  const [scrollRoot, setScrollRoot] = useState<HTMLDivElement | null>(null);
  const [wide, setWide] = useState<boolean | null>(null);
  const titleRef = useRef<HTMLHeadingElement | null>(null);

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
          data-deck-edit-drawer=""
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
                    <h2 ref={titleRef} tabIndex={-1} className="truncate font-display text-base font-semibold text-foreground focus:outline-none sm:text-lg">
                      {title}
                    </h2>
                  </DialogPrimitive.Title>
                  {row ? <DeckEntryStatusBadge status={row.status} unavailable={row.badge === "unavailable"} small /> : null}
                </div>
              </div>
              <Link
                href={fullPageHref}
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
