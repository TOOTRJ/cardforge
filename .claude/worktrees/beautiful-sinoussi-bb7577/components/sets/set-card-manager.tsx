"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SurfaceCard } from "@/components/ui/surface-card";
import { SetCardSortable } from "@/components/sets/set-card-sortable";
import {
  addCardToSetAction,
  removeCardFromSetAction,
  reorderSetCardsAction,
} from "@/lib/sets/actions";
import type { Card } from "@/types/card";
import type { SetItem } from "@/lib/sets/queries";
import { cn } from "@/lib/utils";

type SetCardManagerProps = {
  setId: string;
  setSlug: string;
  items: SetItem[];
  candidates: Card[];
};

export function SetCardManager({
  setId,
  setSlug,
  items,
  candidates,
}: SetCardManagerProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pendingId, setPendingId] = useState<string | null>(null);

  // Local copy of items so drag-end can update the visual order
  // immediately (optimistic UI) without waiting for the server round-trip
  // + router refresh. We re-sync with the prop using React's render-phase
  // setState idiom — when the parent's `items` reference changes (after
  // a refresh / add / remove), we replace `orderedItems` in the same
  // render so the effect-less reset never lags by a frame.
  const [orderedItems, setOrderedItems] = useState<SetItem[]>(items);
  const [itemsSnapshot, setItemsSnapshot] = useState(items);
  if (items !== itemsSnapshot) {
    setItemsSnapshot(items);
    setOrderedItems(items);
  }

  const [isReordering, setIsReordering] = useState(false);

  // Sensors: pointer for mouse/touch, keyboard for accessibility.
  // PointerSensor's activationConstraint (a tiny drag distance) avoids
  // accidentally engaging drag when the user just clicks the grip handle.
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 4 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleAdd = (cardId: string) => {
    setPendingId(cardId);
    startTransition(async () => {
      const result = await addCardToSetAction(setId, cardId);
      if (!result.ok) {
        toast.error(result.formError ?? "Could not add the card.");
      } else {
        toast.success("Added to set.");
        router.refresh();
      }
      setPendingId(null);
    });
  };

  const handleRemove = (cardId: string, title: string) => {
    setPendingId(cardId);
    startTransition(async () => {
      const result = await removeCardFromSetAction(setId, cardId);
      if (!result.ok) {
        toast.error(result.formError ?? "Could not remove the card.");
      } else {
        toast.success(`Removed “${title}” from set.`);
        router.refresh();
      }
      setPendingId(null);
    });
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const fromIndex = orderedItems.findIndex((i) => i.item_id === active.id);
    const toIndex = orderedItems.findIndex((i) => i.item_id === over.id);
    if (fromIndex < 0 || toIndex < 0) return;

    // Optimistic local update — drop-target snaps immediately so the user
    // sees the result before the server confirms.
    const previous = orderedItems;
    const next = arrayMove(orderedItems, fromIndex, toIndex);
    setOrderedItems(next);
    setIsReordering(true);

    startTransition(async () => {
      const orderedIds = next.map((item) => item.item_id);
      const result = await reorderSetCardsAction(setId, orderedIds);
      setIsReordering(false);
      if (!result.ok) {
        // Roll back to the pre-drag order; the server didn't accept the
        // new order so the visual state has to revert to match the DB.
        setOrderedItems(previous);
        toast.error(result.error);
        return;
      }
      // Refresh server data so the next render reconciles with the DB.
      // No toast on success — drag-reorder is a quiet operation; toast
      // would feel chatty for every drag.
      router.refresh();
    });
  };

  // The SortableContext needs a stable id list in the same order as the
  // rendered tiles. Recompute every render to track local reorders.
  const sortableIds = orderedItems.map((i) => i.item_id);

  return (
    <div className="flex flex-col gap-10">
      <section className="flex flex-col gap-4">
        <header className="flex flex-col gap-1">
          <h2 className="font-display text-xl font-semibold tracking-tight text-foreground">
            Cards in this set
          </h2>
          <p className="text-sm text-muted">
            {orderedItems.length === 0
              ? "No cards yet — pick some from your library below."
              : `${orderedItems.length} card${orderedItems.length === 1 ? "" : "s"} included. Drag the grip handle to reorder.`}
          </p>
          {isReordering ? (
            <span className="inline-flex items-center gap-1.5 self-start text-[11px] uppercase tracking-wider text-subtle">
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
              Saving order…
            </span>
          ) : null}
        </header>

        {orderedItems.length === 0 ? (
          <SurfaceCard className="flex items-center justify-center border-dashed p-8 text-center text-sm text-muted">
            Empty for now. Use the picker below to add your first card.
          </SurfaceCard>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={sortableIds} strategy={rectSortingStrategy}>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {orderedItems.map((item) => (
                  <SetCardSortable
                    key={item.item_id}
                    item={item}
                    onRemove={handleRemove}
                    isRemoving={isPending && pendingId === item.card.id}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </section>

      <section className="flex flex-col gap-4">
        <header className="flex flex-col gap-1">
          <h2 className="font-display text-xl font-semibold tracking-tight text-foreground">
            Add cards
          </h2>
          <p className="text-sm text-muted">
            Pick from cards you own that aren&apos;t already in this set.
          </p>
        </header>

        {candidates.length === 0 ? (
          <SurfaceCard className="flex flex-col items-center gap-3 border-dashed p-8 text-center text-sm text-muted">
            <p>
              No cards available — every card you own is already in this set, or
              you haven&apos;t forged any yet.
            </p>
          </SurfaceCard>
        ) : (
          <ul className="grid gap-2">
            {candidates.map((card) => (
              <li
                key={card.id}
                className={cn(
                  "flex items-center gap-3 rounded-lg border border-border/70 bg-surface/60 px-3 py-2",
                  pendingId === card.id ? "opacity-70" : null,
                )}
              >
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <div className="h-12 w-9 shrink-0 overflow-hidden rounded-sm border border-border/40 bg-background">
                    {card.art_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={card.art_url}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-[8px] uppercase tracking-wider text-subtle">
                        Art
                      </div>
                    )}
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-medium text-foreground">
                      {card.title}
                    </span>
                    <span className="truncate text-xs text-muted">
                      {[card.card_type, card.rarity].filter(Boolean).join(" · ") ||
                        "Untyped"}
                    </span>
                  </div>
                  <Badge variant="outline" className="hidden sm:inline-flex">
                    {visibilityLabel(card.visibility)}
                  </Badge>
                </div>
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  onClick={() => handleAdd(card.id)}
                  disabled={isPending && pendingId === card.id}
                >
                  {isPending && pendingId === card.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  ) : (
                    <Plus className="h-3.5 w-3.5" aria-hidden />
                  )}
                  Add
                </Button>
              </li>
            ))}
          </ul>
        )}
        <p className="text-[11px] text-subtle">
          Set slug: <span className="font-mono">{setSlug}</span>
        </p>
      </section>
    </div>
  );
}

function visibilityLabel(visibility: string): string {
  switch (visibility) {
    case "public":
      return "Public";
    case "unlisted":
      return "Unlisted";
    default:
      return "Private";
  }
}
