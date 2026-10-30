"use client";

import { useId } from "react";
import { ArrowDown, ArrowUp, Ban, HelpCircle, Lock } from "lucide-react";
import { ManaCostGlyphs } from "@/components/cards/mana-cost-glyphs";
import { TwoFacesMark } from "@/components/cards/two-faces-mark";
import { DeckEntryStatusBadge } from "@/components/decks/deck-entry-status-badge";
import { DeckEntryTile } from "@/components/decks/deck-entry-tile";
import { SurfaceCard } from "@/components/ui/surface-card";
import { entryRowPictures } from "@/lib/decks/entry-image";
import {
  deckRowLabel,
  stackColumnsOf,
  type DeckGroup,
  type DeckRow,
  type DeckSort,
  type DeckView,
} from "@/lib/decks/deck-view";
import type { DeckItem, DeckPageCard } from "@/lib/decks/queries";
import { formatUtcDate } from "@/lib/format/dates";
import { cn } from "@/lib/utils";
import { COLOR_IDENTITY_LABELS, COLOR_LETTER_IDENTITY } from "@/types/card";
import { DECK_BOARD_LABELS } from "@/types/deck";

// ---------------------------------------------------------------------------
// The deck's groups drawn in one of the four views (TODO DK5.3, WD5):
//
//   Stacks  each group a pile per column — every card's title bar on show,
//           the last card whole — piles of at most 12, side by side across
//           the page's width (a 36-land group is three piles, not one).
//   Grid    every card whole, like a spoiler, with its quantity and status
//           under it.
//   List    dense rows (picture, quantity, name, cost, status) in group
//           cards flowing in columns as wide as the page allows.
//   Table   one row per entry with every field; the five sortable columns'
//           headers sort (the toolbar's Sort, the same choice).
//
// Every opener carries `data-deck-entry` (the pop-up's focus hand-back) and
// the row's full name — its quantity and status included (TODO DK5.12) —
// and keeps clear of the sticky summary bar when focused (scroll-margin).
//
// Every group is in the document, however big the deck: no windowing and
// no `content-visibility` (the independent check of #671 found it took
// off-screen groups and their headings out of the accessibility tree, and
// the page jumped as the guessed sizes reflowed) — 160+ entries draw fine.
// ---------------------------------------------------------------------------

type ViewRow = DeckRow<DeckItem<DeckPageCard>>;
type ViewGroup = DeckGroup<ViewRow>;

/** Openers keep clear of the sticky summary bar when the focus scrolls them
 *  into view (WCAG 2.4.11). */
const CLEAR_OF_BAR = "scroll-mb-28";

const makerOf = (row: ViewRow) => row.item.cardOwner?.username ?? null;
const labelOf = (row: ViewRow) => deckRowLabel(row, makerOf(row));

export function DeckGroupViews({
  view,
  groups,
  sort,
  onSort,
  showProxies,
  onOpen,
}: {
  view: DeckView;
  groups: ViewGroup[];
  sort: DeckSort;
  onSort: (sort: DeckSort) => void;
  showProxies: boolean;
  onOpen: (entryId: string) => void;
}) {
  if (view === "table") return <TableView groups={groups} sort={sort} onSort={onSort} showProxies={showProxies} onOpen={onOpen} />;
  if (view === "list") return <ListView groups={groups} showProxies={showProxies} onOpen={onOpen} />;
  if (view === "grid") return <GridView groups={groups} showProxies={showProxies} onOpen={onOpen} />;
  return <StacksView groups={groups} showProxies={showProxies} onOpen={onOpen} />;
}

function GroupHeading({ id, group, className }: { id: string; group: ViewGroup; className?: string }) {
  return (
    <h3 id={id} className={cn("flex items-baseline gap-2 font-display text-base font-semibold text-foreground", className)}>
      {group.label}
      <span className="font-sans text-xs font-normal tabular-nums text-subtle">
        <span className="sr-only">, </span>
        {group.count} card{group.count === 1 ? "" : "s"}
      </span>
    </h3>
  );
}

// ---------------------------------------------------------------------------
// Stacks
// ---------------------------------------------------------------------------

function StacksView({
  groups,
  showProxies,
  onOpen,
}: {
  groups: ViewGroup[];
  showProxies: boolean;
  onOpen: (entryId: string) => void;
}) {
  const baseId = useId();
  return (
    // A pile is the column's width (11 rem; on a phone two piles share the
    // screen); groups sit side by side and wrap, so the piles spread across
    // the page however wide it is.
    <div className="flex flex-wrap items-start gap-x-6 gap-y-8 [--stack-col:min(11rem,calc((100vw_-_3.5rem)/2))] xl:[--stack-col:12rem]">
      {groups.map((group, index) => {
        const headingId = `${baseId}-g${index}`;
        return (
          <section key={group.key} aria-labelledby={headingId} className="flex max-w-full flex-col gap-2.5">
            <GroupHeading id={headingId} group={group} />
            <div className="flex max-w-full flex-wrap items-start gap-x-3 gap-y-6">
              {stackColumnsOf(group.rows).map((column, c) => (
                <ul
                  key={c}
                  // A pile: every card after the first moves up over the one
                  // before, leaving its title bar and the chips under it on
                  // show (cqw: the pile's own width, so the overlap scales
                  // with the cards). A card holding the keyboard's focus
                  // comes to the front, whole.
                  className={cn(
                    "flex w-[var(--stack-col)] flex-col [container-type:inline-size]",
                    "[--stack-title:15.5cqw] [--stack-strip:calc(var(--stack-title)_+_1.45rem)]",
                    "[&>li+li]:mt-[calc(var(--stack-strip)_-_140cqw)]",
                    "[&>li]:relative [&>li]:isolate [&>li:has(:focus-visible)]:z-30",
                  )}
                >
                  {column.map((row) => (
                    <li key={row.id}>
                      <DeckEntryTile row={row} label={labelOf(row)} showProxies={showProxies} onOpen={onOpen} sizes="192px" />
                    </li>
                  ))}
                </ul>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Grid
// ---------------------------------------------------------------------------

function GridView({
  groups,
  showProxies,
  onOpen,
}: {
  groups: ViewGroup[];
  showProxies: boolean;
  onOpen: (entryId: string) => void;
}) {
  const baseId = useId();
  return (
    <div className="flex flex-col gap-8">
      {groups.map((group, index) => {
        const headingId = `${baseId}-g${index}`;
        return (
          <section key={group.key} aria-labelledby={headingId} className="flex flex-col gap-3">
            <GroupHeading id={headingId} group={group} />
            {/* Columns are added, never grown: two on a phone, as many
                10.5 rem cards as the width takes (the 600 px thumb stays
                sharp to ~300 px on a 2× screen). */}
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,calc(50%_-_0.5rem)),1fr))] gap-x-4 gap-y-5 sm:grid-cols-[repeat(auto-fill,minmax(10.5rem,1fr))]">
              {group.rows.map((row) => (
                <li key={row.id}>
                  <DeckEntryTile
                    row={row}
                    label={labelOf(row)}
                    showProxies={showProxies}
                    onOpen={onOpen}
                    sizes="(min-width: 640px) 220px, 50vw"
                    chips="caption"
                    maker={makerOf(row)}
                  />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

function ListView({
  groups,
  showProxies,
  onOpen,
}: {
  groups: ViewGroup[];
  showProxies: boolean;
  onOpen: (entryId: string) => void;
}) {
  const baseId = useId();
  return (
    // Group cards flow down columns (multi-column: no gaps under a short
    // group), as many 24 rem columns as the page is wide.
    <div className="columns-[24rem] gap-4">
      {groups.map((group, index) => {
        const headingId = `${baseId}-g${index}`;
        return (
          <section key={group.key} aria-labelledby={headingId} className="mb-4 break-inside-avoid">
            <SurfaceCard className="flex min-w-0 flex-col gap-1 p-4">
              <GroupHeading id={headingId} group={group} className="mb-1 font-sans text-xs uppercase tracking-wider text-subtle" />
              <ul className="flex flex-col">
                {group.rows.map((row) => (
                  <EntryRow key={row.id} row={row} showProxies={showProxies} onOpen={onOpen} />
                ))}
              </ul>
            </SurfaceCard>
          </section>
        );
      })}
    </div>
  );
}

function EntryRow({ row, showProxies, onOpen }: { row: ViewRow; showProxies: boolean; onOpen: (entryId: string) => void }) {
  const { entry, card } = row.item;
  const maker = makerOf(row);
  // A private card (a visitor's view, D11) is never drawn: neither its art
  // nor a stand-in.
  const pictures = row.isPrivate ? { proxy: null, printing: null, twoFaces: false } : entryRowPictures(entry, card);
  const thumb = (showProxies ? pictures.proxy : pictures.printing) ?? pictures.proxy ?? pictures.printing;

  return (
    <li>
      <button
        type="button"
        data-deck-entry={entry.id}
        aria-haspopup="dialog"
        onClick={() => onOpen(entry.id)}
        className={cn(
          "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-elevated/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/50",
          CLEAR_OF_BAR,
        )}
        aria-label={labelOf(row)}
      >
        {thumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumb}
            alt=""
            loading="lazy"
            decoding="async"
            className={cn(
              "h-11 w-8 shrink-0 rounded-sm object-cover",
              // A printing with no PipGlyph card yet.
              !entry.card_id && "opacity-70 saturate-50",
            )}
          />
        ) : (
          <span className="flex h-11 w-8 shrink-0 items-center justify-center rounded-sm bg-elevated">
            {row.isGone ? (
              <Ban className="h-3.5 w-3.5 text-subtle" aria-hidden />
            ) : row.isPrivate ? (
              <Lock className="h-3.5 w-3.5 text-subtle" aria-hidden />
            ) : (
              <HelpCircle className="h-3.5 w-3.5 text-subtle" aria-hidden />
            )}
          </span>
        )}
        <span className="w-7 shrink-0 text-right font-mono text-xs text-subtle">{row.quantity}×</span>
        <span className="min-w-0 flex-1 truncate text-sm text-foreground">
          {row.name}
          {row.privateName ? <span className="ml-1.5 text-xs text-muted">{row.privateName}</span> : null}
          {/* Another creator's card (D3): their credit. */}
          {maker ? <span className="ml-1.5 font-mono text-[11px] text-subtle">by @{maker}</span> : null}
        </span>
        {row.fields.cost ? <ManaCostGlyphs cost={row.fields.cost} size="sm" /> : null}
        {pictures.twoFaces && thumb === pictures.proxy ? <TwoFacesMark /> : null}
        <DeckEntryStatusBadge status={row.status} unavailable={row.badge === "unavailable"} small />
      </button>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

const SORTABLE: Partial<Record<string, DeckSort>> = {
  Qty: "quantity",
  Name: "name",
  MV: "mana",
  Color: "color",
  Added: "added",
};

const COLUMNS = ["Qty", "Name", "Cost", "MV", "Type", "Color", "Rarity", "Status", "Board", "Added"] as const;

function colorText(row: ViewRow): string {
  const { colors, multicolorOnly } = row.fields;
  if (colors.length === 0) return multicolorOnly ? COLOR_IDENTITY_LABELS.multicolor : COLOR_IDENTITY_LABELS.colorless;
  return colors.map((letter) => COLOR_IDENTITY_LABELS[COLOR_LETTER_IDENTITY[letter]]).join(", ");
}

function rarityText(rarity: string | null): string {
  if (!rarity) return "—";
  return rarity.charAt(0).toUpperCase() + rarity.slice(1);
}

function TableView({
  groups,
  sort,
  onSort,
  showProxies,
  onOpen,
}: {
  groups: ViewGroup[];
  sort: DeckSort;
  onSort: (sort: DeckSort) => void;
  showProxies: boolean;
  onOpen: (entryId: string) => void;
}) {
  const captionId = useId();
  return (
    // Scrolls sideways on a narrow screen — by keyboard too (a named,
    // focusable region).
    <div
      role="region"
      aria-labelledby={captionId}
      tabIndex={0}
      className="overflow-x-auto rounded-frame border border-border/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/50"
    >
      <table className="w-full min-w-[56rem] border-collapse text-left text-sm">
        <caption id={captionId} className="sr-only">
          The deck&apos;s cards
        </caption>
        <thead className="bg-surface text-xs uppercase tracking-wider text-subtle">
          <tr>
            {COLUMNS.map((column) => {
              const key = SORTABLE[column];
              const active = key === sort;
              return (
                <th
                  key={column}
                  scope="col"
                  aria-sort={active ? (key === "quantity" || key === "added" ? "descending" : "ascending") : undefined}
                  className={cn("px-3 py-2 font-semibold", column === "Qty" && "w-14 text-right")}
                >
                  {key ? (
                    <button
                      type="button"
                      onClick={() => onSort(key)}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-sm uppercase tracking-wider transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/50",
                        active && "text-foreground",
                      )}
                    >
                      {column === "MV" ? <abbr title="Mana value" className="no-underline">MV</abbr> : column}
                      {active ? (
                        key === "quantity" || key === "added" ? (
                          <ArrowDown className="h-3 w-3" aria-hidden />
                        ) : (
                          <ArrowUp className="h-3 w-3" aria-hidden />
                        )
                      ) : null}
                    </button>
                  ) : (
                    column
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        {groups.map((group) => (
          <tbody key={group.key} className="border-t border-border/60">
            <tr className="bg-elevated/40">
              <th scope="rowgroup" colSpan={COLUMNS.length} className="px-3 py-1.5 text-xs font-semibold text-muted">
                {group.label} <span className="font-normal tabular-nums text-subtle">· {group.count}</span>
              </th>
            </tr>
            {group.rows.map((row) => (
              <TableRow key={row.id} row={row} showProxies={showProxies} onOpen={onOpen} />
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}

function TableRow({ row, showProxies, onOpen }: { row: ViewRow; showProxies: boolean; onOpen: (entryId: string) => void }) {
  const { entry, card } = row.item;
  const maker = makerOf(row);
  const pictures = row.isPrivate ? { proxy: null, printing: null, twoFaces: false } : entryRowPictures(entry, card);
  const showsProxy = Boolean(pictures.proxy) && (showProxies || !pictures.printing);
  return (
    <tr className="border-t border-border/30 hover:bg-elevated/40">
      <td className="px-3 py-1.5 text-right font-mono text-xs tabular-nums text-muted">{row.quantity}</td>
      <td className="max-w-[22rem] px-3 py-1.5">
        <span className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            data-deck-entry={entry.id}
            aria-haspopup="dialog"
            aria-label={labelOf(row)}
            onClick={() => onOpen(entry.id)}
            className={cn(
              "min-w-0 truncate rounded-sm text-left text-foreground underline-offset-4 hover:text-primary-bright hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/50",
              CLEAR_OF_BAR,
            )}
          >
            {row.name}
            {row.privateName ? <span className="ml-1.5 text-xs text-muted">{row.privateName}</span> : null}
          </button>
          {maker ? <span className="shrink-0 font-mono text-[11px] text-subtle">by @{maker}</span> : null}
          {pictures.twoFaces && showsProxy ? <TwoFacesMark /> : null}
        </span>
      </td>
      <td className="px-3 py-1.5">{row.fields.cost ? <ManaCostGlyphs cost={row.fields.cost} size="sm" /> : <span className="text-subtle">—</span>}</td>
      <td className="px-3 py-1.5 font-mono text-xs tabular-nums text-muted">{row.fields.manaValue ?? "—"}</td>
      <td className="max-w-[16rem] truncate px-3 py-1.5 text-xs text-muted">{row.fields.typeLine ?? "—"}</td>
      <td className="px-3 py-1.5 text-xs text-muted">{colorText(row)}</td>
      <td className="px-3 py-1.5 text-xs text-muted">{rarityText(row.rarity)}</td>
      <td className="px-3 py-1.5">
        <DeckEntryStatusBadge status={row.status} unavailable={row.badge === "unavailable"} small />
      </td>
      <td className="px-3 py-1.5 text-xs text-muted">{DECK_BOARD_LABELS[row.board]}</td>
      <td className="whitespace-nowrap px-3 py-1.5 text-xs text-muted">{row.addedAt ? formatUtcDate(row.addedAt) : "—"}</td>
    </tr>
  );
}
