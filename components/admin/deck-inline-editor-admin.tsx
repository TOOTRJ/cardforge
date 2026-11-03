"use client";

import { useState, useTransition } from "react";
import { Loader2, PanelRightOpen } from "lucide-react";
import { toast } from "sonner";
import { adminErrorToast } from "@/lib/admin/admin-toast";
import { SurfaceCard } from "@/components/ui/surface-card";
import { setDeckInlineEditorModeAction } from "@/lib/decks/inline-editor-actions";
import {
  DECK_INLINE_EDITOR_MODES,
  DECK_INLINE_EDITOR_MODE_LABELS,
  type DeckInlineEditorMode,
} from "@/lib/decks/inline-editor-shared";
import { cn } from "@/lib/utils";

export function DeckInlineEditorAdmin({ mode: initial }: { mode: DeckInlineEditorMode }) {
  const [mode, setMode] = useState<DeckInlineEditorMode>(initial);
  const [pending, startTransition] = useTransition();

  const choose = (next: DeckInlineEditorMode) => {
    if (next === mode) return;
    const previous = mode;
    setMode(next);
    startTransition(async () => {
      const result = await setDeckInlineEditorModeAction(next);
      if (!result.ok) {
        setMode(previous);
        adminErrorToast("deck editor", result.error);
        return;
      }
      toast.success(`Deck editor: ${DECK_INLINE_EDITOR_MODE_LABELS[next]}.`);
    });
  };

  return (
    <SurfaceCard className="flex flex-col gap-5 p-6">
      <div className="flex flex-col gap-1">
        <span className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
          <PanelRightOpen className="h-4 w-4 text-accent" aria-hidden />
          Edit cards inside the deck (drawer)
        </span>
        <p className="text-sm leading-6 text-muted">
          On a deck page, a card&apos;s Edit, Customize and Remix open the card creator in a
          drawer over the deck — the deck stays visible behind it, a save stays in the drawer,
          ‹ › and &ldquo;Save &amp; next&rdquo; walk the cards, and &ldquo;＋ Create new card&rdquo;
          makes a card straight into the deck. The creator, its steps and its save rules are the
          same as on its own page, and &ldquo;Open full page ↗&rdquo; still leaves for it. While
          this is off for a viewer, their deck page works exactly as before: Edit leaves for the
          creator and comes back.
        </p>
      </div>
      <div role="radiogroup" aria-label="Who edits cards in the drawer" className="flex flex-col gap-2">
        {DECK_INLINE_EDITOR_MODES.map((option) => (
          <label
            key={option}
            className={cn(
              "flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 text-sm transition-colors",
              mode === option
                ? "border-primary/60 bg-primary/10 text-foreground"
                : "border-border bg-elevated/30 text-muted hover:border-border-strong hover:text-foreground",
            )}
          >
            <input
              type="radio"
              name="deck-inline-editor-mode"
              value={option}
              checked={mode === option}
              onChange={() => choose(option)}
              disabled={pending}
              className="accent-[var(--color-primary)]"
            />
            {DECK_INLINE_EDITOR_MODE_LABELS[option]}
          </label>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {pending ? <Loader2 className="h-4 w-4 animate-spin text-muted" aria-hidden /> : null}
        <span className="text-xs text-subtle">
          With &ldquo;Admins only&rdquo;, admin accounts get the drawer on their own decks; nobody
          else sees a thing. &ldquo;Everyone&rdquo; is the release.
        </span>
      </div>
    </SurfaceCard>
  );
}
