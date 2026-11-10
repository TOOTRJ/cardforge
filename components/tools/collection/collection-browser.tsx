"use client";

import Link from "next/link";
import { useId, useState, useTransition, type FormEvent } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Check, ChevronLeft, ChevronRight, LibraryBig, ListChecks, Search, Trash2 } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { ChipGroup } from "@/components/ui/chip-group";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { inputClass } from "@/components/ui/field-classes";
import { useSearchParamPatch } from "@/lib/routing/use-search-param-patch";
import { cn } from "@/lib/utils";
import type { CollectionCard } from "@/lib/tools/collection/card-row";
import {
  clearCollectionAction,
  removeCollectionCardAction,
  updateCollectionQuantityAction,
} from "@/lib/tools/collection/actions";
import { MAX_COLLECTION_QUANTITY } from "@/lib/tools/collection/limits";
import { FINISH_LABELS } from "@/lib/tools/collection/parse-import";
import type { CollectionColour, CollectionPage, CollectionSort, CollectionType } from "@/lib/tools/collection/queries";
import { collectionViewHref } from "@/lib/tools/collection/views";
import { PrintingPicture } from "./printing-tile";
import { COLOUR_OPTIONS } from "./colour-options";
import { BulkCustomizeButton } from "@/components/tools/bulk-customize/bulk-customize-button";
import { printingCustomizeHref, type BulkSource } from "@/lib/tools/bulk-customize/model";

const TYPE_LABELS: Record<CollectionType, string> = {
  creature: "Creatures",
  instant: "Instants",
  sorcery: "Sorceries",
  artifact: "Artifacts",
  enchantment: "Enchantments",
  planeswalker: "Planeswalkers",
  land: "Lands",
  battle: "Battles",
};

const SORT_LABELS: Record<CollectionSort, string> = {
  name: "Name",
  recent: "Recently added",
  mana: "Mana value",
  copies: "Most copies",
};

const n = (value: number) => value.toLocaleString("en-US");

export type CollectionQueryState = {
  q: string;
  colours: CollectionColour[];
  type: CollectionType | null;
  sort: CollectionSort;
  commandersOnly: boolean;
  page: number;
};

/** What a tile says under its picture: set, number, finish, language. */
export function printingLine(card: Pick<CollectionCard, "setCode" | "collectorNumber" | "finish" | "lang">): string {
  return [
    card.setCode ? `${card.setCode.toUpperCase()}${card.collectorNumber ? ` #${card.collectorNumber}` : ""}` : null,
    card.finish !== "nonfoil" ? FINISH_LABELS[card.finish] : null,
    card.lang !== "en" ? card.lang.toUpperCase() : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function CollectionBrowser({
  page,
  query,
  collectionSize,
  canCustomize = false,
}: {
  page: CollectionPage;
  query: CollectionQueryState;
  collectionSize: number;
  /** The viewer has the Bulk Customize tool: the grid can tick cards. */
  canCustomize?: boolean;
}) {
  const { patch, isPending } = useSearchParamPatch();
  const [editing, setEditing] = useState<CollectionCard | null>(null);
  // Ticked rows survive a page turn or a filter (the browser stays mounted).
  const [selecting, setSelecting] = useState(false);
  const [ticked, setTicked] = useState<Map<string, CollectionCard>>(new Map());
  const toggleTick = (card: CollectionCard) =>
    setTicked((prev) => {
      const next = new Map(prev);
      if (next.has(card.id)) next.delete(card.id);
      else next.set(card.id, card);
      return next;
    });
  const stopSelecting = () => {
    setSelecting(false);
    setTicked(new Map());
  };
  const tickedSources: BulkSource[] = [...ticked.keys()].map((id) => ({ kind: "collection", id }));
  const onlyTicked = ticked.size === 1 ? [...ticked.values()][0] : null;
  const ids = { q: useId(), type: useId(), sort: useId(), commanders: useId(), results: useId() };

  if (collectionSize === 0) {
    return (
      <EmptyState
        icon={LibraryBig}
        headingLevel={2}
        title="Your collection is empty"
        description="Import a list from Moxfield, ManaBox, Archidekt, Deckbox, TCGplayer or Dragon Shield — or a plain text list — and the cards you own show up here."
        action={
          <Link href={collectionViewHref("add")} className={buttonVariants({ variant: "primary" })}>
            Add cards
          </Link>
        }
      />
    );
  }

  const onSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = new FormData(event.currentTarget).get("q");
    patch({ q: typeof value === "string" ? value.trim() : "" });
  };

  const filtered = Boolean(query.q || query.colours.length || query.type || query.commandersOnly);

  return (
    <section aria-labelledby="collection-title" className="flex min-w-0 flex-col gap-5">
      <h2 id="collection-title" className="sr-only">
        My collection
      </h2>
      <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface/40 p-4">
        <form role="search" onSubmit={onSearch} className="flex min-w-0 gap-2">
          <label htmlFor={ids.q} className="sr-only">
            Search your collection by name
          </label>
          <input
            id={ids.q}
            name="q"
            type="search"
            defaultValue={query.q}
            key={query.q}
            placeholder="Search by name"
            maxLength={80}
            className={cn(inputClass(false), "min-w-0 flex-1")}
          />
          <Button type="submit" variant="secondary">
            <Search aria-hidden />
            <span className="sr-only sm:not-sr-only">Search</span>
          </Button>
        </form>
        <div className="flex flex-col gap-1.5">
          <span aria-hidden className="text-xs font-medium text-muted">
            Colours
          </span>
          <ChipGroup
            multiSelect
            options={COLOUR_OPTIONS}
            value={query.colours}
            keepCase
            ariaLabel="Colours"
            onChange={(next) => patch({ colours: next.join(",") || null })}
          />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
          <div className="flex min-w-0 flex-col gap-1.5">
            <label htmlFor={ids.type} className="text-xs font-medium text-muted">
              Card type
            </label>
            <select
              id={ids.type}
              value={query.type ?? ""}
              onChange={(event) => patch({ type: event.target.value || null })}
              className={inputClass(false)}
            >
              <option value="">Every type</option>
              {(Object.keys(TYPE_LABELS) as CollectionType[]).map((type) => (
                <option key={type} value={type}>
                  {TYPE_LABELS[type]}
                </option>
              ))}
            </select>
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <label htmlFor={ids.sort} className="text-xs font-medium text-muted">
              Sort by
            </label>
            <select
              id={ids.sort}
              value={query.sort}
              onChange={(event) => patch({ sort: event.target.value === "name" ? null : event.target.value })}
              className={inputClass(false)}
            >
              {(Object.keys(SORT_LABELS) as CollectionSort[]).map((sort) => (
                <option key={sort} value={sort}>
                  {SORT_LABELS[sort]}
                </option>
              ))}
            </select>
          </div>
          <label htmlFor={ids.commanders} className="flex h-10 items-center gap-2 text-sm text-foreground">
            <input
              id={ids.commanders}
              type="checkbox"
              checked={query.commandersOnly}
              onChange={(event) => patch({ commanders: event.target.checked ? "1" : null })}
              className="h-4 w-4 accent-[var(--color-primary)]"
            />
            Commanders only
          </label>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p id={ids.results} role="status" className="text-sm text-muted">
          {isPending
            ? "Loading…"
            : page.total === 0
              ? "No cards match."
              : `${n(page.total)} card${page.total === 1 ? "" : "s"}${filtered ? " match" : ""}${page.pages > 1 ? ` · page ${page.page} of ${page.pages}` : ""}`}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {filtered ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => patch({ q: null, colours: null, type: null, commanders: null })}
            >
              Clear filters
            </Button>
          ) : null}
          {canCustomize ? (
            <Button
              variant={selecting ? "secondary" : "outline"}
              size="sm"
              aria-pressed={selecting}
              onClick={() => (selecting ? stopSelecting() : setSelecting(true))}
            >
              <ListChecks aria-hidden />
              {selecting ? "Done selecting" : "Select to customize"}
            </Button>
          ) : null}
        </div>
      </div>

      {selecting ? (
        <div className="sticky top-2 z-10 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 bg-surface/95 p-3 backdrop-blur">
          <span className="text-sm text-foreground" aria-live="polite">
            {ticked.size === 0
              ? "Tick the cards to make your own."
              : `${n(ticked.size)} card${ticked.size === 1 ? "" : "s"} ticked`}
          </span>
          <div className="flex items-center gap-2">
            {ticked.size > 0 ? (
              <Button variant="ghost" size="sm" onClick={() => setTicked(new Map())}>
                Clear
              </Button>
            ) : null}
            <BulkCustomizeButton
              sources={tickedSources}
              oneCardHref={onlyTicked ? printingCustomizeHref(onlyTicked.scryfallId, onlyTicked.id) : null}
              surface="collection"
              onFinished={stopSelecting}
            />
          </div>
        </div>
      ) : null}

      {page.cards.length > 0 ? (
        <div className="@container">
          <ul
            aria-describedby={ids.results}
            className={cn(
              "grid grid-cols-2 gap-4 @xl:grid-cols-3 @3xl:grid-cols-4 @5xl:grid-cols-5 @min-[84rem]:grid-cols-6",
              isPending && "opacity-60",
            )}
          >
            {page.cards.map((card) => (
              <li key={card.id} className="min-w-0">
                <button
                  type="button"
                  onClick={() => (selecting ? toggleTick(card) : setEditing(card))}
                  aria-pressed={selecting ? ticked.has(card.id) : undefined}
                  aria-label={
                    selecting
                      ? `${card.name}${printingLine(card) ? `, ${printingLine(card)}` : ""}. Tick to customize.`
                      : `${card.name}, ${card.quantity} ${card.quantity === 1 ? "copy" : "copies"}${printingLine(card) ? `, ${printingLine(card)}` : ""}. Change copies or remove.`
                  }
                  className={cn(
                    "group flex w-full flex-col gap-2 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                    selecting && ticked.has(card.id) && "ring-2 ring-primary ring-offset-2 ring-offset-background",
                  )}
                >
                  <span className="relative block">
                    <PrintingPicture imageUrl={card.imageUrl} name={card.name} className="transition-transform group-hover:-translate-y-0.5" />
                    {selecting ? (
                      <span
                        aria-hidden
                        className={cn(
                          "absolute left-2 top-2 flex h-6 w-6 items-center justify-center rounded-full border",
                          ticked.has(card.id)
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border bg-background/80 text-transparent",
                        )}
                      >
                        <Check className="h-4 w-4" />
                      </span>
                    ) : null}
                    <span
                      aria-hidden
                      className="absolute right-2 top-2 rounded-full border border-border/60 bg-background/85 px-2 py-0.5 text-xs font-semibold tabular-nums text-foreground backdrop-blur"
                    >
                      ×{n(card.quantity)}
                    </span>
                  </span>
                  <span aria-hidden className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-medium text-foreground">{card.name}</span>
                    <span className="truncate text-xs text-subtle">{printingLine(card) || card.setName || " "}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <Pager page={page.page} pages={page.pages} />

      <div className="flex justify-end border-t border-border/60 pt-4">
        <ClearCollectionButton count={collectionSize} />
      </div>

      <EditCardDialog card={editing} onClose={() => setEditing(null)} />
    </section>
  );
}

function Pager({ page, pages }: { page: number; pages: number }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  if (pages <= 1) return null;
  const href = (target: number) => {
    const next = new URLSearchParams(searchParams.toString());
    if (target <= 1) next.delete("page");
    else next.set("page", String(target));
    const query = next.toString();
    return query ? `${pathname}?${query}` : pathname;
  };
  const link = "inline-flex h-9 items-center gap-1 rounded-lg border border-border px-3 text-sm";
  return (
    <nav aria-label="Collection pages" className="flex items-center justify-center gap-3">
      {page > 1 ? (
        <Link href={href(page - 1)} scroll={false} className={cn(link, "hover:bg-elevated")}>
          <ChevronLeft className="h-4 w-4" aria-hidden />
          Previous
        </Link>
      ) : (
        <span aria-hidden className={cn(link, "opacity-40")}>
          <ChevronLeft className="h-4 w-4" />
          Previous
        </span>
      )}
      <span className="text-sm tabular-nums text-muted">
        {page} / {pages}
      </span>
      {page < pages ? (
        <Link href={href(page + 1)} scroll={false} className={cn(link, "hover:bg-elevated")}>
          Next
          <ChevronRight className="h-4 w-4" aria-hidden />
        </Link>
      ) : (
        <span aria-hidden className={cn(link, "opacity-40")}>
          Next
          <ChevronRight className="h-4 w-4" />
        </span>
      )}
    </nav>
  );
}

function EditCardDialog({ card, onClose }: { card: CollectionCard | null; onClose: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [quantity, setQuantity] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [shown, setShown] = useState<string | null>(null);
  const fieldId = useId();

  // A new card in the dialog starts from its own numbers (set during render,
  // React's "adjust state on a prop change" pattern — no effect).
  if (card && card.id !== shown) {
    setShown(card.id);
    setQuantity(String(card.quantity));
    setError(null);
    setConfirmRemove(false);
  }

  const save = () => {
    if (!card) return;
    const value = Number.parseInt(quantity, 10);
    if (!Number.isInteger(value) || value < 1 || value > MAX_COLLECTION_QUANTITY) {
      setError(`Enter a number from 1 to ${n(MAX_COLLECTION_QUANTITY)}.`);
      return;
    }
    startTransition(async () => {
      const result = await updateCollectionQuantityAction({ id: card.id, quantity: value });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success(`${card.name}: ${n(value)} ${value === 1 ? "copy" : "copies"}.`);
      onClose();
      router.refresh();
    });
  };

  const remove = () => {
    if (!card) return;
    startTransition(async () => {
      const result = await removeCollectionCardAction({ id: card.id });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success(`${card.name} removed from your collection.`);
      onClose();
      router.refresh();
    });
  };

  return (
    <Dialog open={card !== null} onOpenChange={(open) => (!open && !pending ? onClose() : undefined)}>
      <DialogContent size="sm" closeDisabled={pending}>
        {card ? (
          <>
            <DialogHeader>
              <DialogTitle>{card.name}</DialogTitle>
              <DialogDescription>
                {[card.setName, printingLine(card)].filter(Boolean).join(" — ") || "A card in your collection."}
              </DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-[6rem_minmax(0,1fr)] gap-4 px-5 py-4">
              <PrintingPicture imageUrl={card.imageUrl} name={card.name} size="small" />
              <div className="flex min-w-0 flex-col gap-1.5">
                <label htmlFor={fieldId} className="text-sm font-medium text-foreground">
                  Copies you own
                </label>
                <input
                  id={fieldId}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={MAX_COLLECTION_QUANTITY}
                  value={quantity}
                  onChange={(event) => {
                    setQuantity(event.target.value);
                    setError(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      save();
                    }
                  }}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? `${fieldId}-error` : undefined}
                  className={inputClass(Boolean(error))}
                />
                {error ? (
                  <p id={`${fieldId}-error`} className="text-xs text-danger">
                    {error}
                  </p>
                ) : null}
              </div>
            </div>
            <DialogFooter className="sm:justify-between">
              {confirmRemove ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-muted">Remove it?</span>
                  <Button variant="outline" size="sm" onClick={remove} disabled={pending} className="text-danger">
                    Yes, remove
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setConfirmRemove(false)} disabled={pending}>
                    Keep it
                  </Button>
                </div>
              ) : (
                <Button variant="ghost" size="sm" onClick={() => setConfirmRemove(true)} disabled={pending}>
                  <Trash2 aria-hidden />
                  Remove
                </Button>
              )}
              <Button onClick={save} disabled={pending}>
                {pending ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ClearCollectionButton({ count }: { count: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const clear = () =>
    startTransition(async () => {
      const result = await clearCollectionAction({ confirm: "clear" });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`Your collection is empty (${n(result.removed)} removed).`);
      setOpen(false);
      router.refresh();
    });
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <Trash2 aria-hidden />
        Clear collection
      </Button>
      <Dialog open={open} onOpenChange={(next) => (!pending ? setOpen(next) : undefined)}>
        <DialogContent size="sm" closeDisabled={pending}>
          <DialogHeader>
            <DialogTitle>Clear your whole collection?</DialogTitle>
            <DialogDescription>
              All {n(count)} different cards are removed. Your decks keep every card they hold — this only empties the
              collection. It can&apos;t be undone, but you can import your list again.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button variant="outline" onClick={clear} disabled={pending} className="text-danger">
              {pending ? "Clearing…" : `Clear ${n(count)} cards`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
