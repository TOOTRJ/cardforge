"use client";

import { Component, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { usePathname, useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { NewDeckCloseReason, NewDeckDialogRequest } from "@/components/decks/new-deck-dialog";
import { NEW_DECK_PATH, newDeckReturnPath } from "@/lib/decks/new-deck-paths";
import type { DeckFormat } from "@/types/deck";

// ---------------------------------------------------------------------------
// The ONE way to start a deck (TODO DK4.1 / DK4.2): the New deck dialog,
// opened from anywhere by `useNewDeck().openNewDeck({ format?, cardId? })`.
// Mounted once in the root layout (like the upgrade modal), so a static page
// (/decks, the format hubs) opens it as easily as My Decks does.
//
//   NewDeckButton     a button that opens it — My Decks, /decks, the hubs
//                     (format preselected). The header's "New deck" stays a
//                     LINK to /dashboard/decks/new, which opens it on arrival.
//   OpenNewDeckOnMount  /dashboard/decks/new's opener: once per visit; a
//                     dismissal goes back to /dashboard/decks, so the next
//                     "New deck" link is a real navigation again.
//
// The dialog's code loads on first use (it pulls in the decklist parser and
// the import actions), never with every page; a button warms it on hover or
// focus. It closes itself when the page changes under it — a link inside it
// (Get more slots) must not leave it open over the next page. It sits in the
// ROOT layout, outside every app/error.tsx: a render that throws — above all
// a chunk that won't load (a tab older than the last deploy, a phone that
// lost the network) — is caught here and never takes the page with it.
// Closed, the focus goes back to what opened it.
// ---------------------------------------------------------------------------

const loadDialog = () => import("@/components/decks/new-deck-dialog");

const NewDeckDialog = dynamic(() => loadDialog().then((mod) => mod.NewDeckDialog), { ssr: false });

/** Fetch the dialog's code before the click needs it. */
export function preloadNewDeckDialog(): void {
  void loadDialog().catch(() => {});
}

export type OpenNewDeckOptions = {
  /** Preselected (a format hub's "Build a … deck"). Default: Commander. */
  format?: DeckFormat;
  /** A saved card the deck starts with — "Build a deck around this card"
   *  (TODO DK8.3) and the creator's deck box (DK9.3). createDeckAction adds
   *  it once the deck exists: a legendary creature into a Commander-style
   *  deck's commander zone, else the main board (lib/decks/first-card.ts). */
  cardId?: string;
};

type OpenRequest = OpenNewDeckOptions & {
  /** A dismissal (Cancel, Escape, the X, a click outside) — not a create, a
   *  trip to sign in, or a page change. */
  onDismiss?: () => void;
  /** What the focus goes back to when the dialog closes. Default: whatever
   *  held it when openNewDeck was called (not <body>) — Safari doesn't
   *  focus a clicked button, so a button passes itself. */
  opener?: HTMLElement | null;
};

/** The element that holds the focus, unless that is nobody (<body>). */
function focusedElement(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  const active = document.activeElement;
  return active instanceof HTMLElement && active !== document.body ? active : null;
}

// /dashboard/decks/new's dismissal swaps the page for /dashboard/decks, so
// what opened the dialog is gone: the new page's first NewDeckButton takes
// the focus instead — a one-shot hand-off, dropped if nothing claims it soon.
let focusHandOffAt = 0;
const HAND_OFF_MS = 5000;

function claimFocusHandOff(): boolean {
  const pending = focusHandOffAt > 0 && Date.now() - focusHandOffAt < HAND_OFF_MS;
  focusHandOffAt = 0;
  return pending;
}

type NewDeckContextValue = {
  openNewDeck: (options?: OpenRequest) => void;
};

const NewDeckContext = createContext<NewDeckContextValue | null>(null);

export function useNewDeck(): NewDeckContextValue {
  // A no-op outside the provider, so a component used without it never
  // crashes (the upgrade modal's posture).
  return useContext(NewDeckContext) ?? { openNewDeck: () => {} };
}

export function NewDeckProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [request, setRequest] = useState<(NewDeckDialogRequest & { onDismiss?: () => void }) | null>(null);
  const [open, setOpen] = useState(false);
  const serial = useRef(0);

  const openNewDeck = useCallback(
    (options: OpenRequest = {}) => {
      serial.current += 1;
      setRequest({
        key: serial.current,
        format: options.format,
        cardId: options.cardId,
        onDismiss: options.onDismiss,
        returnFocusTo: options.opener ?? focusedElement(),
      });
      setOpen(true);
    },
    [],
  );

  // The page changed under the dialog: close it (nothing to dismiss — the
  // visitor went somewhere). Adjusted while rendering, not in an effect, so
  // the dialog is never drawn over the next page.
  const [shownOn, setShownOn] = useState(pathname);
  if (shownOn !== pathname) {
    setShownOn(pathname);
    if (open) setOpen(false);
  }

  const onClosed = useCallback(
    (reason: NewDeckCloseReason) => {
      setOpen(false);
      if (reason === "dismiss") request?.onDismiss?.();
    },
    [request],
  );

  // The dialog failed to draw (a chunk that won't load): close it, and try
  // the route that opens it with a fresh page — unless this IS that route,
  // where the same failure would only come back: then say so.
  const onDialogError = useCallback(() => {
    const format = request?.format;
    setOpen(false);
    setRequest(null);
    if (window.location.pathname !== NEW_DECK_PATH) {
      window.location.assign(newDeckReturnPath(format));
      return;
    }
    toast.error("The New deck dialog didn't load. Reload the page and try again.");
  }, [request]);

  const value = useMemo(() => ({ openNewDeck }), [openNewDeck]);
  return (
    <NewDeckContext.Provider value={value}>
      {children}
      {request ? (
        <NewDeckDialogBoundary key={request.key} onError={onDialogError}>
          <NewDeckDialog open={open} request={request} onClosed={onClosed} />
        </NewDeckDialogBoundary>
      ) : null}
    </NewDeckContext.Provider>
  );
}

/** Catches what the dialog throws while it draws — its lazy chunk failing
 *  above all — so the root layout's page stays (there is no error boundary
 *  above the root layout but Next's own whole-page one). */
class NewDeckDialogBoundary extends Component<{ onError: () => void; children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(): void {
    this.props.onError();
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** Opens the dialog. A button, not a link: it opens a dialog in place. */
export function NewDeckButton({
  format,
  cardId,
  children,
  variant,
  size,
  className,
  icon = true,
}: OpenNewDeckOptions & {
  children: React.ReactNode;
  variant?: React.ComponentProps<typeof Button>["variant"];
  size?: React.ComponentProps<typeof Button>["size"];
  className?: string;
  /** The ＋ before the words (off where the caller draws its own icon). */
  icon?: boolean;
}) {
  const { openNewDeck } = useNewDeck();
  const self = useRef<HTMLButtonElement>(null);
  // Back from /dashboard/decks/new's dialog: this page's first button takes
  // the focus the dismissal left nowhere.
  useEffect(() => {
    if (claimFocusHandOff()) self.current?.focus();
  }, []);
  return (
    <Button
      ref={self}
      type="button"
      variant={variant}
      size={size}
      className={className}
      aria-haspopup="dialog"
      onPointerEnter={preloadNewDeckDialog}
      onFocus={preloadNewDeckDialog}
      onClick={(event) => openNewDeck({ format, cardId, opener: event.currentTarget })}
    >
      {icon ? <Plus aria-hidden /> : null}
      {children}
    </Button>
  );
}

/** /dashboard/decks/new: the dialog over My Decks, once per visit. */
export function OpenNewDeckOnMount({ format }: { format?: DeckFormat }) {
  const { openNewDeck } = useNewDeck();
  const router = useRouter();
  const opened = useRef(false);
  useEffect(() => {
    // Once — StrictMode runs this effect twice.
    if (opened.current) return;
    opened.current = true;
    openNewDeck({
      format,
      onDismiss: () => {
        focusHandOffAt = Date.now();
        router.replace("/dashboard/decks", { scroll: false });
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on arrival
  }, []);
  return null;
}
