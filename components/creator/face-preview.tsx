"use client";

// The live preview of a card with Face tabs (TODO 5.14, owner round 46):
// the face being edited LARGE and labelled ("Showing: Back face"), the
// other face small beside it ("Front face · click to edit"). Clicking the
// small one selects its tab — the same state the switch at the top of the
// step holds; the preview never changes face by itself and has no turn
// control of its own (CardPreview `hideFlipControl`).
//
// Both pictures are the ONE live renderer (components/cards/card-preview)
// with the creator's own props — the card's pixels are what they were; only
// which face is in front is chosen here. The small one is drawn from a
// deferred copy of the props so typing never waits for it.

import { useDeferredValue, useSyncExternalStore, type ComponentProps, type ReactNode } from "react";
import { CardPreview } from "@/components/cards/card-preview";
import type { CardFaceId } from "@/lib/creator/face-tabs";
import type { SecondPartWords } from "@/lib/creator/second-part";
import { cn } from "@/lib/utils";

type PreviewProps = ComponentProps<typeof CardPreview>;

type FacePreviewProps = {
  /** The creator's live preview props (the form's `previewProps`). */
  previewProps: PreviewProps;
  face: CardFaceId;
  onFaceChange: (next: CardFaceId) => void;
  words: SecondPartWords;
  /** "aside": the desktop column (the other face beside the large one from
   *  xl up, under it below). "inline": the phone's block above the step —
   *  the large face left, the caption and the other face right. */
  layout: "aside" | "inline";
  /** Overlays that cover the large card exactly (the AI spinner). */
  children?: ReactNode;
};

const NO_HOVER = "(hover: none)";
function subscribeNoHover(onChange: () => void) {
  const query = typeof window !== "undefined" ? window.matchMedia?.(NO_HOVER) : undefined;
  query?.addEventListener?.("change", onChange);
  return () => query?.removeEventListener?.("change", onChange);
}
/** True where nothing can hover (a phone): the caption says "tap". The
 *  server and the first paint say "click". */
function useNoHover(): boolean {
  return useSyncExternalStore(
    subscribeNoHover,
    () => (typeof window !== "undefined" ? window.matchMedia?.(NO_HOVER)?.matches === true : false),
    () => false,
  );
}

export function FacePreview({ previewProps, face, onFaceChange, words, layout, children }: FacePreviewProps) {
  const other: CardFaceId = face === "front" ? "back" : "front";
  const label = (id: CardFaceId) => (id === "front" ? words.first : words.second);
  const deferredProps = useDeferredValue(previewProps);
  const noHover = useNoHover();

  const showing = (
    <p
      data-testid="face-preview-showing"
      className={cn(
        "inline-flex max-w-full items-center self-start bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground",
        layout === "inline" ? "rounded-lg leading-4" : "rounded-full",
      )}
    >
      Showing: {label(face)}
    </p>
  );
  const large = (
    <div className="relative" data-testid="face-preview-large" data-face={face}>
      <CardPreview {...previewProps} face={face} onFaceChange={undefined} flipOnClick={false} hideFlipControl />
      {children}
    </div>
  );
  const small = (
    <div
      className={cn("relative flex", layout === "inline" ? "flex-col gap-1" : "items-center gap-2 xl:flex-col xl:items-stretch xl:gap-1.5")}
      data-testid="face-preview-other"
      data-face={other}
    >
      <div
        aria-hidden
        className={cn("pointer-events-none shrink-0", layout === "inline" ? "w-16" : "w-10 xl:w-[4.5rem]")}
      >
        <CardPreview {...deferredProps} face={other} onFaceChange={undefined} flipOnClick={false} hideFlipControl />
      </div>
      {/* The caption IS the button; its hit area covers the small card. */}
      <button
        type="button"
        onClick={() => onFaceChange(other)}
        className="rounded-md px-1.5 py-1 text-left text-[11px] font-medium leading-4 text-muted after:absolute after:inset-0 after:content-[''] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/70"
      >
        {/* ONE string, so the button's accessible name IS what it shows
            ("Front face · click to edit"; "tap" where nothing hovers) —
            two CSS-switched words read as "clicktap", and a separate
            aria-label named it something a voice user could not say. */}
        {`${label(other)} · ${noHover ? "tap" : "click"} to edit`}
      </button>
    </div>
  );

  // Reduced motion: the faces swap without the turn (CardPreview's rotor
  // carries a transition of its own; app/globals.css `.face-preview-still`).
  const still = "face-preview-still";

  if (layout === "inline") {
    return (
      <div className={cn("flex items-start gap-3", still)} data-testid="face-preview" data-face={face}>
        <div className="min-w-0 max-w-[220px] flex-1">{large}</div>
        <div className="flex w-[6.5rem] shrink-0 flex-col gap-2">
          {showing}
          <p className="text-[11px] leading-4 text-muted">The preview shows the face you are editing.</p>
          {small}
        </div>
      </div>
    );
  }
  // The column is sticky, so what it holds must fit the window: its foot
  // can never be scrolled to. From xl up the other face stands BESIDE the
  // large one. Below that (1024–1279 px: one column) it stands in the row
  // of the "Showing" label, above the large card — under the card it fell
  // off the foot of a 768 px-high window, out of reach — and the large card
  // gives up a little width in a short window (700–760 px high) so its own
  // foot, the collector line, stays in view under that row.
  return (
    <div className={cn("relative flex flex-col gap-3", still)} data-testid="face-preview" data-face={face}>
      <div className="flex min-h-14 items-center xl:min-h-0">{showing}</div>
      <div className="flex flex-col items-center gap-3 xl:flex-row xl:items-end xl:justify-center">
        <div className="w-full min-w-0 max-w-[min(24rem,calc((100svh_-_14.5rem)*5/7))] xl:max-w-sm xl:flex-1">
          {large}
        </div>
        <div className="absolute right-0 top-0 shrink-0 xl:static xl:w-[4.5rem]">{small}</div>
      </div>
    </div>
  );
}
