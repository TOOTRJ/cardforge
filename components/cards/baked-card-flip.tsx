"use client";

import { useEffect, useRef, useState } from "react";
import { RotateCw } from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// A gallery-style tile of a double-faced card (TODO 5.15, owner decisions of
// 2026-10-12 — they REPLACE 5.3's Q6 "nothing moves on hover or by itself").
//
// 1. A labelled "2 faces" button in the tile's bottom-LEFT corner (over the
//    collector line; the power / toughness box stays clear), 44 px tall —
//    a thumb's target. Activating it turns the tile over in place; pressed,
//    it says which face is showing ("Showing back"; where there is no
//    hovering pointer, "Back · tap for front"; on a tile too narrow for
//    either, "Back"). Its accessible name carries the card's title.
// 2. With a real hovering pointer — `(hover: hover) and (pointer: fine)`,
//    a mouse, and never under `prefers-reduced-motion: reduce` — the tile
//    ALSO turns once the pointer has RESTED on it for HOVER_REST_MS, and
//    turns back when the pointer leaves. A sweep across the grid turns
//    nothing. A click still opens the card (the tile's link is untouched).
//    The rest starts with a real pointer MOVE on the tile, never with the
//    tile arriving under a pointer that is standing still: a browser fires
//    pointerenter (and no pointermove) on whatever a wheel scroll, a page
//    load or a client navigation slides under the cursor, and a grid that
//    turns its cards while the reader merely scrolls is the classic
//    annoyance of hover effects (measured before this rule: 4 turns in 6
//    wheel notches under a mouse nobody touched).
//
// The back's thumbnail (cards.rendered_back_thumb_url, the bake's second
// 600 px WebP) is mounted only on INTENT — the pointer moving on a tile that
// can hover-turn, the button taking focus, or a press — so a gallery of
// thirty tiles loads thirty images, not sixty, for anyone who touches none.
// A hover never turns to a picture that has not arrived (the turn waits for
// it), and a back that cannot be loaded at all — the object was removed by
// an edit after this list was built (#504 clears the pointers; an ISR page
// may be older than the bake) — leaves the tile what a one-faced tile is:
// the front, no button, until the page is loaded again.
//
// The turn swaps the picture inside the same absolutely-placed box: the tile
// never changes size (no layout shift). Under reduced motion the two faces
// cross-fade instead of spinning (`.tile-flip-*` in app/globals.css).
//
// The button is never INSIDE the tile's link or role="button" (TODO 5.17 —
// a control nested in a control is invalid HTML and read unreliably by
// assistive tech). components/cards/card-tile.tsx puts the tile's link UNDER
// the picture instead: an empty element filling the tile's box
// (`.card-hover-effect`), before the tilting content in the document, and
// the content takes no pointer events — the pointer falls through the
// picture to the link — except this button (`pointer-events-auto`). So the
// button's click, middle click and keys reach nothing else, and the keyboard
// goes link, then button. The pointer that rests on the card is therefore
// on the LINK, not in here: the rest is heard on the tile's box, the one
// ancestor the link and this picture share.
// ---------------------------------------------------------------------------

/** How long the pointer must rest on a tile before it turns (about a third
 *  of a second, owner 2026-10-12). */
export const HOVER_REST_MS = 333;

const HOVER_QUERY = "(hover: hover) and (pointer: fine)";
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

// Where the mouse last really moved over a two-faced tile (client px). A
// pointermove at the very same place is not a move: some engines dispatch
// one for content that scrolled under a still cursor.
let lastMouseAt: { x: number; y: number } | null = null;

/** True where the hover-turn may run: a hovering fine pointer, motion allowed. */
function hoverTurnAllowed(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia(HOVER_QUERY).matches && !window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

export function BakedCardFlip({
  frontSrc,
  backSrc,
  label,
  title,
  priority = false,
}: {
  frontSrc: string;
  backSrc: string;
  /** The front image's alt text; the back is "<label> (back face)". */
  label: string;
  /** The card's title, for the button's name ("Show back face of <title>"). */
  title: string;
  priority?: boolean;
}) {
  // What the BUTTON chose, and what a resting pointer is showing on top of it.
  const [pinned, setPinned] = useState<"front" | "back">("front");
  const [hoverBack, setHoverBack] = useState(false);
  const [backMounted, setBackMounted] = useState(false);
  const [backLoaded, setBackLoaded] = useState(false);
  const [backFailed, setBackFailed] = useState(false);
  const restTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // This visit of the pointer has started its rest (one rest per visit).
  const restArmed = useRef(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  // After a press, the pointer that is still on the tile must not turn it
  // again: the hover-turn is off until that pointer has left.
  const hoverMuted = useRef(false);

  const clearRest = () => {
    if (restTimer.current !== null) {
      clearTimeout(restTimer.current);
      restTimer.current = null;
    }
  };
  useEffect(() => clearRest, []);

  // A hover shows the back only once its picture is there; a press turns at
  // once (the viewer asked). A back that failed to load shows nothing.
  const face: "front" | "back" =
    !backFailed && (pinned === "back" || (hoverBack && backLoaded)) ? "back" : "front";

  // The rest is armed by a real MOVE of the mouse on the card (see the
  // header) — once per visit, and not while the pointer is on the button.
  // Heard on the tile's box (the header says why), with native listeners:
  // that box is an ancestor this component does not render.
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const host = root.closest<HTMLElement>(".card-hover-effect") ?? root;
    const stopRest = () => {
      if (restTimer.current !== null) {
        clearTimeout(restTimer.current);
        restTimer.current = null;
      }
    };
    const startRest = () => {
      stopRest();
      restArmed.current = true;
      if (hoverMuted.current || !hoverTurnAllowed()) return;
      // The rest has started: fetch the back now so it is there for the turn.
      setBackMounted(true);
      restTimer.current = setTimeout(() => {
        restTimer.current = null;
        setHoverBack(true);
      }, HOVER_REST_MS);
    };
    const onTileMove = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      const moved = !lastMouseAt || lastMouseAt.x !== event.clientX || lastMouseAt.y !== event.clientY;
      lastMouseAt = { x: event.clientX, y: event.clientY };
      if (!moved || restArmed.current) return;
      if (buttonRef.current?.contains(event.target as Node)) return;
      startRest();
    };
    const onTileLeave = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      stopRest();
      restArmed.current = false;
      hoverMuted.current = false;
      setHoverBack(false);
    };
    host.addEventListener("pointermove", onTileMove);
    host.addEventListener("pointerleave", onTileLeave);
    return () => {
      host.removeEventListener("pointermove", onTileMove);
      host.removeEventListener("pointerleave", onTileLeave);
    };
  }, []);

  const press = () => {
    clearRest();
    hoverMuted.current = true;
    setBackMounted(true);
    setHoverBack(false);
    // The press turns away from the face the viewer SEES (a hover-turned
    // tile reads "Showing back": pressing it shows the front).
    setPinned(face === "back" ? "front" : "back");
  };

  const showingBack = face === "back";
  return (
    <div ref={rootRef} className="tile-flip absolute inset-0" data-testid="baked-card-flip" data-face={face}>
      {/* The stage takes no pointer (.tile-flip-stage, app/globals.css): its
          3D layers would be hit-tested in front of the button. */}
      <div className="tile-flip-stage absolute inset-0" style={{ perspective: "1400px" }}>
        <div className="tile-flip-rotor relative h-full w-full">
          <div className="tile-flip-face tile-flip-front absolute inset-0" aria-hidden={showingBack}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={frontSrc}
              alt={label}
              loading={priority ? "eager" : "lazy"}
              fetchPriority={priority ? "high" : "auto"}
              decoding="async"
              className="absolute inset-0 h-full w-full bg-[#101015] object-cover"
            />
          </div>
          <div className="tile-flip-face tile-flip-back absolute inset-0" aria-hidden={!showingBack}>
            {backMounted && !backFailed ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={backSrc}
                alt={`${label} (back face)`}
                decoding="async"
                onLoad={() => setBackLoaded(true)}
                onError={() => {
                  clearRest();
                  setBackFailed(true);
                }}
                className="absolute inset-0 h-full w-full bg-[#101015] object-cover"
              />
            ) : null}
          </div>
        </div>
      </div>
      {backFailed ? null : (
        <button
          ref={buttonRef}
          type="button"
          // Nothing to stop: the button is outside the tile's link (the
          // header says how), so its click, middle click, drag and keys are
          // its own.
          onClick={press}
          // Focus is intent: have the back ready for the press.
          onFocus={() => setBackMounted(true)}
          // A pointer on its way to the button is not resting on the card:
          // the rest is dropped, and its next move on the card starts one.
          onPointerEnter={(event) => {
            if (event.pointerType !== "mouse") return;
            clearRest();
            if (!hoverBack) restArmed.current = false;
          }}
          aria-label={showingBack ? `Show front face of ${title}` : `Show back face of ${title}`}
          aria-pressed={showingBack}
          data-testid="two-faces-button"
          className={cn(
            // pointer-events-auto: the one thing in the tile's picture a
            // pointer can hit (the rest lets it through to the link).
            "tile-flip-button pointer-events-auto absolute bottom-2 left-2 z-40 inline-flex h-11 min-w-11 max-w-[calc(100%-1rem)] items-center gap-2 rounded-full border px-3 text-sm font-semibold shadow-lg transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-primary",
            // The button sits ON the card, not on the page: its colours are
            // the same in both themes.
            showingBack
              ? "border-white/45 bg-[oklch(0.5_0.13_300)] text-white hover:bg-[oklch(0.55_0.13_300)]"
              : "border-white/25 bg-[oklch(0.2_0.03_262/0.92)] text-white hover:border-white/50",
          )}
        >
          <RotateCw className="h-4 w-4 shrink-0" aria-hidden />
          {showingBack ? (
            <>
              {/* A tile too narrow for a sentence (My Cards' compact grid). */}
              <span className="tile-flip-label-short truncate">Back</span>
              <span className="tile-flip-label-hover truncate">Showing back</span>
              <span className="tile-flip-label-touch truncate">Back · tap for front</span>
            </>
          ) : (
            <span className="truncate">2 faces</span>
          )}
        </button>
      )}
    </div>
  );
}
