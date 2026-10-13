"use client";

// The Front face | Back face switch (TODO 5.14, owner round 46): ONE switch
// at the top of every step of a card with two parts. It says which part the
// step below edits and which the live preview shows large; it is the one
// source of that choice (the preview never changes face by itself).
//
// Driven by the kind's words (lib/creator/second-part.ts SECOND_PART_WORDS):
// Transform / Modal "Front face | Back face" today; part 2 mounts the same
// component for "Left half | Right half", "Creature | Adventure spell"… A
// kind whose second part has no editor yet (a battle's back, TODO 5.5:
// `available: false`) shows its second tab greyed out with the kind's
// `unavailableNote`.
//
// A tab list (WAI-ARIA Tabs, automatic activation): Left / Right / Home /
// End move between the tabs and select; the focus stays on the tab — the
// switch never moves it into the step. The status under each name is words
// with a dot, never colour alone.

import { useRef } from "react";
import type { CardFaceId, FaceStatus } from "@/lib/creator/face-tabs";
import type { SecondPartWords } from "@/lib/creator/second-part";
import { cn } from "@/lib/utils";

export type FaceSwitchPart = {
  /** The part's own name ("Dusk Ferryman"); empty = not named yet. */
  name: string;
  status: FaceStatus | null;
  /** A small picture of the part (its artwork in a card-shaped box). */
  thumb?: React.ReactNode;
};

type FaceSwitchProps = {
  words: SecondPartWords;
  value: CardFaceId;
  onChange: (next: CardFaceId) => void;
  front: FaceSwitchPart;
  back: FaceSwitchPart;
  /** The id of the region the tabs control (the step's panels). */
  panelId: string;
  /** The id of the line under the switch (FaceSwitchNote): what on this
   *  step follows the tab and what is shared — the tab list is described
   *  by it, and a greyed tab too. */
  noteId?: string;
  className?: string;
};

/** The id of a part's tab inside a switch whose base id is `baseId` — the
 *  step's panel names itself with it (aria-labelledby). */
export const faceTabId = (baseId: string, face: CardFaceId) => `${baseId}-${face}`;

export function FaceSwitch({ words, value, onChange, front, back, panelId, noteId, className }: FaceSwitchProps) {
  const refs = useRef<Record<CardFaceId, HTMLButtonElement | null>>({ front: null, back: null });
  const backAvailable = words.available;
  const selected: CardFaceId = backAvailable ? value : "front";

  const select = (face: CardFaceId) => {
    if (face === "back" && !backAvailable) return;
    if (face !== selected) onChange(face);
  };
  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, face: CardFaceId) => {
    const next: CardFaceId | null =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? face === "front"
          ? "back"
          : "front"
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? face === "back"
            ? "front"
            : "back"
          : event.key === "Home"
            ? "front"
            : event.key === "End"
              ? "back"
              : null;
    if (!next) return;
    event.preventDefault();
    // The focus goes to the tab the key names — a greyed one too, so its
    // "coming" line is heard — and a tab that can be selected is.
    refs.current[next]?.focus();
    select(next);
  };

  const tab = (face: CardFaceId, part: FaceSwitchPart) => {
    const isSelected = selected === face;
    const disabled = face === "back" && !backAvailable;
    const label = face === "front" ? words.first : words.second;
    return (
      <button
        key={face}
        ref={(el) => {
          refs.current[face] = el;
        }}
        type="button"
        role="tab"
        id={faceTabId(panelId, face)}
        data-face={face}
        aria-selected={isSelected}
        aria-controls={panelId}
        aria-disabled={disabled || undefined}
        aria-describedby={disabled ? noteId : undefined}
        tabIndex={isSelected ? 0 : -1}
        onClick={() => select(face)}
        onKeyDown={(event) => onKeyDown(event, face)}
        className={cn(
          "flex min-h-11 min-w-0 items-center gap-2 rounded-lg px-2.5 py-2 text-left sm:gap-2.5 sm:px-3 transition-colors motion-reduce:transition-none",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/70 focus-visible:ring-offset-1 focus-visible:ring-offset-background",
          isSelected
            ? "bg-primary text-primary-foreground shadow-sm"
            : disabled
              ? "cursor-not-allowed text-subtle opacity-60"
              : "text-muted hover:bg-elevated/60 hover:text-foreground",
        )}
      >
        {part.thumb ? <span className="shrink-0">{part.thumb}</span> : null}
        <span className="flex min-w-0 flex-col">
          <span className={cn("truncate text-sm font-semibold", isSelected ? "" : disabled ? "" : "text-foreground")}>
            {label}
          </span>
          {disabled ? (
            <span className="truncate text-[11px] leading-4">{words.unavailableNote}</span>
          ) : part.status ? (
            <span className="flex min-w-0 items-start gap-1.5 text-[11px] leading-4" data-face-status={part.status.complete ? "complete" : "needs"}>
              <span
                aria-hidden
                className={cn(
                  "mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full",
                  part.status.complete ? "bg-emerald-400" : "bg-gold",
                )}
              />
              {/* As the approved mock-up: a finished face shows its name
                  (cut short where the tab is narrow — never the status); a
                  face that still needs something says only what. */}
              {part.status.complete && part.name.trim() ? (
                // The name may be cut short; "complete" drops to a line of
                // its own before it is.
                <span className="flex min-w-0 flex-wrap gap-x-1">
                  <span className="max-w-full truncate">{part.name.trim()}</span>
                  <span className="shrink-0">· {part.status.text}</span>
                </span>
              ) : (
                <span className="line-clamp-2 break-words">{part.status.text}</span>
              )}
            </span>
          ) : null}
        </span>
      </button>
    );
  };

  return (
    <div className={className} data-testid="face-switch" data-face={selected}>
      <div
        role="tablist"
        aria-label="Which part of the card you are editing"
        aria-describedby={noteId}
        className="grid grid-cols-2 gap-1 rounded-xl border border-border/70 bg-background/95 p-1 shadow-sm backdrop-blur-sm"
      >
        {tab("front", front)}
        {tab("back", back)}
      </div>
    </div>
  );
}

/** The line under the switch — outside it, so the switch alone can stay
 *  in view (sticky) while the step scrolls. */
export function FaceSwitchNote({
  id,
  ref,
  children,
}: {
  id: string;
  ref?: React.Ref<HTMLParagraphElement>;
  children: React.ReactNode;
}) {
  return (
    <p id={id} ref={ref} className="-mt-4 text-xs leading-5 text-muted" data-testid="face-switch-note">
      {children}
    </p>
  );
}

/** A part's tiny picture for its tab: its artwork in a card-shaped box (a
 *  dark blank while it has none). Decorative — the tab's words name it. */
export function FaceThumb({
  artUrl,
  glyph,
}: {
  artUrl?: string | null;
  /** For a part that has NO picture of its own (an adventure's spell, a
   *  flip card's other side — part 2): a plain line glyph in the box
   *  instead of an art window that would never fill. */
  glyph?: React.ReactNode;
}) {
  if (glyph) {
    return (
      <span
        aria-hidden
        data-testid="face-thumb"
        data-face-thumb="glyph"
        className="card-corners relative flex aspect-[5/7] w-7 items-center justify-center overflow-hidden border border-black/40 bg-[#101015] text-white/70"
      >
        {glyph}
      </span>
    );
  }
  return (
    <span
      aria-hidden
      data-testid="face-thumb"
      className="card-corners relative block aspect-[5/7] w-7 overflow-hidden border border-black/40 bg-[#101015]"
    >
      {artUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={artUrl} alt="" className="absolute inset-x-[8%] top-[12%] h-[46%] w-[84%] object-cover" />
      ) : (
        <span className="absolute inset-x-[8%] top-[12%] block h-[46%] rounded-[1px] bg-white/10" />
      )}
      <span className="absolute inset-x-[8%] bottom-[10%] block h-[26%] rounded-[1px] bg-white/15" />
    </span>
  );
}
