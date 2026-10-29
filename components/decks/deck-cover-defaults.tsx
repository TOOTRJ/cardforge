"use client";

import { useId, useState } from "react";
import Image from "next/image";
import { Shuffle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DEFAULT_DECK_COVERS, defaultCoverParts, shuffleDeckCover } from "@/lib/decks/default-covers";
import { COLOR_IDENTITY_LABELS } from "@/types/card";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// The sixteen built-in backgrounds in the cover editor (owner decision D12;
// stored since migration 0150): "Shuffle" picks another at random, the grid
// picks one by hand. Both only set the form's cover (saved with the form,
// like an upload). The grid is ONE radio group with ChipGroup's keyboard
// (components/ui/chip-group.tsx, TODO 3b.10): one tab stop, the arrows move
// the focus and never pick, Space or Enter picks.
// ---------------------------------------------------------------------------

/** "Red 2", "Neutral 1" — a background's name. */
export function defaultCoverLabel(path: string): string {
  const parts = defaultCoverParts(path);
  if (!parts) return "Background";
  const word = parts.identity === "neutral" ? "Neutral" : COLOR_IDENTITY_LABELS[parts.identity];
  return `${word} ${parts.index}`;
}

export function DeckCoverDefaults({
  value,
  shown,
  onPick,
  disabled = false,
  shuffleRef,
}: {
  /** The stored built-in, or "" while the deck has none (automatic). */
  value: string;
  /** The background the deck shows now — what "Shuffle" moves away from. */
  shown: string | null;
  onPick: (path: string) => void;
  disabled?: boolean;
  /** The Shuffle button — where the cover field hands the focus when the
   *  control that was pressed leaves the page ("Back to the colours' pick"). */
  shuffleRef?: React.Ref<HTMLButtonElement>;
}) {
  const labelId = useId();
  const [focused, setFocused] = useState<string | null>(null);
  const tabStop = focused ?? (DEFAULT_DECK_COVERS.includes(value) ? value : DEFAULT_DECK_COVERS[0]);

  const moveFocus = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (step === 0 && event.key !== "Home" && event.key !== "End") return;
    const radios = [...event.currentTarget.querySelectorAll<HTMLElement>(":scope > [role='radio']")];
    const from = radios.indexOf(event.target as HTMLElement);
    if (from < 0) return;
    const to = event.key === "Home" ? 0 : event.key === "End" ? radios.length - 1 : (from + step + radios.length) % radios.length;
    event.preventDefault();
    radios[to]?.focus();
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span id={labelId} className="text-xs font-medium text-muted">
          Built-in backgrounds
        </span>
        <Button
          ref={shuffleRef}
          type="button"
          variant="outline"
          size="sm"
          aria-disabled={disabled || undefined}
          onClick={disabled ? undefined : () => onPick(shuffleDeckCover(shown))}
          className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
        >
          <Shuffle className="h-3.5 w-3.5" aria-hidden /> Shuffle
        </Button>
      </div>
      <div
        role="radiogroup"
        aria-labelledby={labelId}
        onKeyDown={moveFocus}
        onFocus={(event) => {
          const path = (event.target as HTMLElement).getAttribute("data-cover");
          if (path) setFocused(path);
        }}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(null);
        }}
        className="grid grid-cols-4 gap-1.5 sm:grid-cols-8"
      >
        {DEFAULT_DECK_COVERS.map((path) => {
          const picked = path === value;
          return (
            <button
              key={path}
              type="button"
              role="radio"
              aria-checked={picked}
              aria-label={defaultCoverLabel(path)}
              aria-disabled={disabled || undefined}
              data-cover={path}
              tabIndex={path === tabStop ? undefined : -1}
              onClick={disabled ? undefined : () => onPick(path)}
              className={cn(
                "relative aspect-video overflow-hidden rounded-md border bg-elevated transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                picked ? "border-primary ring-2 ring-primary" : "border-border/60 hover:border-border-strong",
                disabled && "cursor-not-allowed opacity-55",
              )}
            >
              <Image src={path} alt="" fill sizes="96px" className="object-cover" />
            </button>
          );
        })}
      </div>
    </div>
  );
}
