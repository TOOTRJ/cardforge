"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
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
//
// The back's thumbnail (cards.rendered_back_thumb_url, the bake's second
// 600 px WebP) is mounted only on INTENT — the pointer entering a tile that
// can hover-turn, the button taking focus, or a press — so a gallery of
// thirty tiles loads thirty images, not sixty, for anyone who touches none.
//
// The turn swaps the picture inside the same absolutely-placed box: the tile
// never changes size (no layout shift). Under reduced motion the two faces
// cross-fade instead of spinning (`.tile-flip-*` in app/globals.css).
//
// The button stops its own click so the tile's link never follows it. A tile
// always sits inside a Link, like the live preview's own button when it is
// the fallback — the same markup, the same behaviour.
// ---------------------------------------------------------------------------

/** How long the pointer must rest on a tile before it turns (about a third
 *  of a second, owner 2026-10-12). */
export const HOVER_REST_MS = 333;

const HOVER_QUERY = "(hover: hover) and (pointer: fine)";
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

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
  const restTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  const face: "front" | "back" = pinned === "back" || hoverBack ? "back" : "front";

  const startRest = () => {
    clearRest();
    if (hoverMuted.current || !hoverTurnAllowed()) return;
    // The rest has started: fetch the back now so it is there for the turn.
    setBackMounted(true);
    restTimer.current = setTimeout(() => {
      restTimer.current = null;
      setHoverBack(true);
    }, HOVER_REST_MS);
  };

  const onTileEnter = (event: PointerEvent) => {
    if (event.pointerType !== "mouse") return;
    startRest();
  };
  const onTileLeave = (event: PointerEvent) => {
    if (event.pointerType !== "mouse") return;
    clearRest();
    hoverMuted.current = false;
    setHoverBack(false);
  };

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
    <div
      className="tile-flip absolute inset-0"
      data-testid="baked-card-flip"
      data-face={face}
      onPointerEnter={onTileEnter}
      onPointerLeave={onTileLeave}
    >
      <div className="absolute inset-0" style={{ perspective: "1400px" }}>
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
            {backMounted ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={backSrc}
                alt={`${label} (back face)`}
                decoding="async"
                className="absolute inset-0 h-full w-full bg-[#101015] object-cover"
              />
            ) : null}
          </div>
        </div>
      </div>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          event.preventDefault();
          press();
        }}
        onKeyDown={(event) => {
          // Enter / Space activate the button (the browser follows with a
          // click, handled above). A tile whose body handles keys itself —
          // the dashboard tile's role="button" wrapper opens the card on
          // Enter — must not see them, or the keyboard would navigate where
          // the pointer flips.
          if (event.key === "Enter" || event.key === " ") event.stopPropagation();
        }}
        // Focus is intent: have the back ready for the press.
        onFocus={() => setBackMounted(true)}
        // A pointer on its way to the button is not resting on the card.
        onPointerEnter={(event) => {
          if (event.pointerType === "mouse") clearRest();
        }}
        onPointerLeave={(event) => {
          if (event.pointerType === "mouse" && !hoverBack) startRest();
        }}
        aria-label={showingBack ? `Show front face of ${title}` : `Show back face of ${title}`}
        aria-pressed={showingBack}
        data-testid="two-faces-button"
        className={cn(
          "tile-flip-button absolute bottom-2 left-2 z-40 inline-flex h-11 min-w-11 max-w-[calc(100%-1rem)] items-center gap-2 rounded-full border px-3 text-sm font-semibold shadow-lg transition-colors",
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
    </div>
  );
}
