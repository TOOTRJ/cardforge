"use client";

import { useState } from "react";
import { RotateCw } from "lucide-react";

// ---------------------------------------------------------------------------
// A gallery-style tile of a double-faced card (TODO 5.3, owner decision
// 2026-10-02 Q6): the tile shows the FRONT's stored thumbnail with a small
// corner flip button that turns it over in place — the control the card
// page's live preview already uses (components/cards/card-preview.tsx) —
// and nothing else: nothing moves on hover or by itself. The back's
// thumbnail (cards.rendered_back_thumb_url, the bake's second WebP) is
// mounted only once the viewer first flips, so a gallery of thirty tiles
// loads thirty images, not sixty.
//
// The rotor is the preview's (a 3D turn about Y, both faces back-face
// hidden); the button stops the click so the tile's link never follows it.
// A tile always sits inside a Link, like the live preview's own button when
// it is the fallback — the same markup, the same behaviour.
// ---------------------------------------------------------------------------

export function BakedCardFlip({
  frontSrc,
  backSrc,
  label,
  priority = false,
}: {
  frontSrc: string;
  backSrc: string;
  /** The front's accessible label; the back is "<label> (back face)". */
  label: string;
  priority?: boolean;
}) {
  const [face, setFace] = useState<"front" | "back">("front");
  const [backMounted, setBackMounted] = useState(false);
  const flip = () => {
    setBackMounted(true);
    setFace((current) => (current === "front" ? "back" : "front"));
  };
  return (
    <>
      <div className="absolute inset-0" style={{ perspective: "1400px" }} data-testid="baked-card-flip" data-face={face}>
        <div
          className="relative h-full w-full transition-transform duration-700 ease-[cubic-bezier(0.16,1,0.3,1)]"
          style={{
            transformStyle: "preserve-3d",
            transform: face === "back" ? "rotateY(180deg)" : "rotateY(0deg)",
            willChange: "transform",
          }}
        >
          <div className="absolute inset-0" style={{ backfaceVisibility: "hidden" }} aria-hidden={face === "back"}>
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
          <div
            className="absolute inset-0"
            style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}
            aria-hidden={face === "front"}
          >
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
          flip();
        }}
        onKeyDown={(event) => {
          // Enter / Space activate the button (the browser follows with a
          // click, handled above). A tile whose body handles keys itself —
          // the dashboard tile's role="button" wrapper opens the card on
          // Enter — must not see them, or the keyboard would navigate where
          // the pointer flips.
          if (event.key === "Enter" || event.key === " ") event.stopPropagation();
        }}
        aria-label={face === "front" ? "Flip to back face" : "Flip to front face"}
        aria-pressed={face === "back"}
        className="absolute bottom-3 right-3 z-40 flex h-8 w-8 items-center justify-center rounded-full border border-border/80 bg-background/85 text-muted shadow-lg transition-colors hover:border-border-strong hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60"
      >
        <RotateCw className="h-4 w-4" aria-hidden />
      </button>
    </>
  );
}
