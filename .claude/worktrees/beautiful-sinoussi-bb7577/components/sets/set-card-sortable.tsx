"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Loader2, X } from "lucide-react";
import { CardPreview } from "@/components/cards/card-preview";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ArtPosition, FrameStyle } from "@/types/card";
import type { SetItem } from "@/lib/sets/queries";

// ---------------------------------------------------------------------------
// SetCardSortable — one sortable tile inside the set editor's grid.
//
// Uses `useSortable` from @dnd-kit which gives us:
//   - `attributes` + `listeners`  → spread on the drag handle so drag is
//     initiated only by the grip icon (not the whole card body — clicking
//     a card-shaped target shouldn't drag).
//   - `setNodeRef` + `transform`  → applied to the tile so it follows the
//     pointer mid-drag.
//   - `transition`                → CSS transition for the snap-back when
//     the tile lands.
//   - `isDragging`                → visual cue while held.
//
// Accessibility:
//   - The grip is a `<button>`, so it's in the tab order.
//   - @dnd-kit's KeyboardSensor (mounted on the parent DndContext) handles
//     Space to lift, ↑/↓ to move, Space to drop, Esc to cancel.
// ---------------------------------------------------------------------------

type SetCardSortableProps = {
  item: SetItem;
  onRemove: (cardId: string, title: string) => void;
  isRemoving: boolean;
};

export function SetCardSortable({
  item,
  onRemove,
  isRemoving,
}: SetCardSortableProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.item_id });

  const { card } = item;

  return (
    <div
      ref={setNodeRef}
      style={{
        // @dnd-kit's `transform` is a JSON `{x,y,scaleX,scaleY}`; the
        // helper serializes it into a CSS `translate3d(...)` string.
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      className={cn(
        "flex flex-col gap-2 rounded-frame transition-shadow",
        // Lift effect mid-drag. Higher z-index keeps the dragged tile
        // above its siblings.
        isDragging
          ? "z-10 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.7)] ring-2 ring-primary/60"
          : "",
      )}
    >
      <div className="relative">
        <CardPreview
          staticInEditor
          title={card.title}
          cost={card.cost}
          cardType={card.card_type}
          supertype={card.supertype}
          subtypes={card.subtypes}
          rarity={card.rarity}
          colorIdentity={card.color_identity}
          rulesText={card.rules_text}
          flavorText={card.flavor_text}
          power={card.power}
          toughness={card.toughness}
          loyalty={card.loyalty}
          defense={card.defense}
          artistCredit={card.artist_credit}
          artUrl={card.art_url}
          artPosition={card.art_position as ArtPosition}
          frameStyle={card.frame_style as FrameStyle}
        />
        {/* Drag handle. Always visible (rather than hover-only) so touch
            and keyboard users have an unambiguous affordance. The button
            itself spreads the @dnd-kit attributes + listeners — only this
            element initiates a drag, leaving the rest of the card free
            for future interactions. */}
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label={`Drag ${card.title}`}
          className={cn(
            "absolute left-2 top-2 z-30 flex h-7 w-7 cursor-grab items-center justify-center rounded-md border border-border/80 bg-background/80 text-muted shadow-md transition-colors",
            "hover:border-border-strong hover:text-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
            "active:cursor-grabbing",
            isDragging && "border-primary bg-primary/15 text-primary",
          )}
        >
          <GripVertical className="h-4 w-4" aria-hidden />
        </button>
      </div>
      <div className="flex items-center justify-between gap-2 text-xs text-muted">
        <span className="truncate">/{card.slug}</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onRemove(card.id, card.title)}
          disabled={isRemoving}
        >
          {isRemoving ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <X className="h-3.5 w-3.5" aria-hidden />
          )}
          Remove
        </Button>
      </div>
    </div>
  );
}
