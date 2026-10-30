import { manaValueSlot, TYPE_BUCKET_PLURALS, TYPE_BUCKETS, typeBucketFor, type TypeBucket } from "@/lib/decks/analytics";
import {
  effectiveEntryFields,
  effectiveEntryRarity,
  type EffectiveEntryCard,
  type EffectiveEntryFields,
} from "@/lib/decks/effective-entry";
import { deckEntryStatus, deckEntryUnavailable } from "@/lib/decks/entry-status";
import {
  GONE_CARD_NAME,
  hiddenEntryName,
  isGoneForViewer,
  isPrivateForViewer,
  PRIVATE_CARD_NAME,
} from "@/lib/decks/private-card-name";
import { COLOR_IDENTITY_LABELS, RARITY_LABELS } from "@/types/card";
import {
  DECK_BOARD_LABELS,
  DECK_ENTRY_STATUS_COUNT_LABELS,
  DECK_ENTRY_STATUS_LABELS,
  type DeckBoard,
  type DeckEntrySource,
  type DeckEntryStatus,
} from "@/types/deck";

// ---------------------------------------------------------------------------
// The deck page's card area (TODO DK5.3 / DK5.6) — how the cards are drawn
// (the VIEW), how they are grouped and sorted, and which statuses show.
// Pure + dependency-free so the server page (reads the cookie), the client
// list (writes it) and the unit tests share one source — the pattern of
// lib/cards/my-cards-view.ts. Every parser falls back to the default on
// anything unrecognised: the cookie is user-editable.
//
// Every group, sort and filter reads the entry's EFFECTIVE fields
// (lib/decks/effective-entry.ts: an edited import counts as the card it now
// is, an unchanged one as its printing) and its ONE status
// (lib/decks/entry-status.ts deckEntryStatus, or "No longer available").
// A visitor's view of a card they can't read is a "Private card" row
// (lib/decks/private-card-name.ts, D11): it sorts by the real card's name
// where the entry has one, never by the private card's title.
//
// Boards: the commander and companion zones are pinned first as groups of
// their own, then the mainboard in the chosen groups, then the sideboard
// and the maybeboard as one group each — whatever the grouping, a card in
// the sideboard never reads as part of the deck. "Board" draws one group per
// board; "None" the deck itself as ONE group (its commander and companion
// rows first), then the sideboard and the maybeboard — never mixed in.
// ---------------------------------------------------------------------------

/** How the cards are drawn. */
export const DECK_VIEWS = ["stacks", "grid", "list", "table"] as const;
export type DeckView = (typeof DECK_VIEWS)[number];
export const DECK_VIEW_LABELS: Record<DeckView, string> = {
  stacks: "Stacks",
  grid: "Grid",
  list: "List",
  table: "Table",
};

export const DECK_GROUPS = ["type", "mana", "color", "status", "board", "rarity", "none"] as const;
export type DeckGroupBy = (typeof DECK_GROUPS)[number];
export const DECK_GROUP_LABELS: Record<DeckGroupBy, string> = {
  type: "Type",
  mana: "Mana value",
  color: "Color",
  status: "Status",
  board: "Board only",
  rarity: "Rarity",
  none: "None",
};

export const DECK_SORTS = ["mana", "name", "color", "quantity", "added"] as const;
export type DeckSort = (typeof DECK_SORTS)[number];
export const DECK_SORT_LABELS: Record<DeckSort, string> = {
  mana: "Mana value",
  name: "Name",
  color: "Color",
  quantity: "Quantity",
  added: "Recently added",
};

export type DeckViewPrefs = { view: DeckView; group: DeckGroupBy; sort: DeckSort };

/** Stacks on a desktop (art first, whole groups at once — the research's
 *  pick); the page asks for the List on a phone (`defaultDeckViewPrefs`). */
export const DEFAULT_DECK_VIEW_PREFS: DeckViewPrefs = { view: "stacks", group: "type", sort: "mana" };

/** Cookie (not localStorage) so the server renders the viewer's choice on
 *  the first paint — no flash of the default before hydration. One cookie
 *  for every deck: a viewer who likes the table sees decks as a table. */
export const DECK_VIEW_COOKIE = "pg_deck_view";
export const DECK_VIEW_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
/** The cookie's path: the deck pages, nothing else. */
export const DECK_VIEW_COOKIE_PATH = "/deck";

/** The deck page's "Cards" heading — where an owner's dialog hands the focus
 *  back when the control that opened it is gone. */
export const DECK_CARDS_HEADING_ID = "deck-cards-title";

function parseOneOf<T extends string>(allowed: readonly T[], fallback: T, raw: unknown): T {
  return typeof raw === "string" && (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
}

/** The defaults for a viewer with no cookie: the List on a phone (dense
 *  rows, the fastest to scan on a narrow screen), Stacks elsewhere. */
export function defaultDeckViewPrefs(phone: boolean): DeckViewPrefs {
  return phone ? { ...DEFAULT_DECK_VIEW_PREFS, view: "list" } : DEFAULT_DECK_VIEW_PREFS;
}

/** The cookie's value ("stacks.type.mana") as prefs; each part that isn't
 *  one we know falls back to `fallback`'s. */
export function parseDeckViewPrefs(raw: unknown, fallback: DeckViewPrefs = DEFAULT_DECK_VIEW_PREFS): DeckViewPrefs {
  const [view, group, sort] = typeof raw === "string" ? raw.split(".") : [];
  return {
    view: parseOneOf(DECK_VIEWS, fallback.view, view),
    group: parseOneOf(DECK_GROUPS, fallback.group, group),
    sort: parseOneOf(DECK_SORTS, fallback.sort, sort),
  };
}

export function serializeDeckViewPrefs(prefs: DeckViewPrefs): string {
  return `${prefs.view}.${prefs.group}.${prefs.sort}`;
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

/** What a row's badge says: its status, or "No longer available". */
export type EntryBadge = DeckEntryStatus | "unavailable";
/** The status filter: every row, or the rows wearing one badge. */
export type StatusFilter = "all" | EntryBadge;

export const NO_LONGER_AVAILABLE = GONE_CARD_NAME;

export const ENTRY_BADGE_ORDER: readonly EntryBadge[] = ["imported", "edited", "remix", "original", "not_found", "unavailable"];

export const ENTRY_BADGE_LABELS: Record<EntryBadge, string> = {
  ...DECK_ENTRY_STATUS_LABELS,
  unavailable: NO_LONGER_AVAILABLE,
};

/** The entry fields the views read (a DeckCardEntry has them all). */
export type ViewEntry = {
  id: string;
  board: DeckBoard;
  quantity: number;
  name: string;
  position?: number | null;
  created_at?: string | null;
  card_id: string | null;
  scryfall_id: string | null;
  source?: DeckEntrySource | string | null;
  type_line?: string | null;
  mana_cost?: string | null;
  mana_value?: number | null;
  color_identity?: readonly string[] | null;
  rarity?: string | null;
};

export type ViewCard = EffectiveEntryCard & { title: string };

export type ViewItem = { entry: ViewEntry; card: ViewCard | null };

export type DeckRow<I extends ViewItem = ViewItem> = {
  item: I;
  id: string;
  board: DeckBoard;
  quantity: number;
  /** The name the row shows: the card's title, the entry's name, or
   *  "Private card" in a visitor's view of a card they can't read. */
  name: string;
  /** A visitor's private card: the REAL card's name the entry stands for
   *  (its printing's), shown beside "Private card" — null when there is
   *  none (the entry has no printing, or its name was hidden). */
  privateName: string | null;
  isPrivate: boolean;
  /** A visitor's DELETED card (0153): drawn as "No longer available", not
   *  "Private card" (isPrivate is true too). */
  isGone: boolean;
  status: DeckEntryStatus;
  badge: EntryBadge;
  fields: EffectiveEntryFields;
  /** Lower case as stored (Scryfall's "special" / "bonus" included). */
  rarity: string | null;
  bucket: TypeBucket;
  addedAt: string;
  position: number;
};

export function deckRowOf<I extends ViewItem>(item: I, viewerIsOwner: boolean): DeckRow<I> {
  const { entry, card } = item;
  const status = deckEntryStatus(entry, card);
  const fields = effectiveEntryFields(entry, card, status);
  const isPrivate = isPrivateForViewer(entry, card, viewerIsOwner);
  return {
    item,
    id: entry.id,
    board: entry.board,
    quantity: entry.quantity,
    name: isPrivate ? hiddenEntryName(entry, viewerIsOwner) : (card?.title ?? entry.name),
    privateName: isPrivate && entry.scryfall_id && entry.name !== PRIVATE_CARD_NAME ? entry.name : null,
    isPrivate,
    isGone: isGoneForViewer(entry, viewerIsOwner),
    status,
    badge: deckEntryUnavailable(entry, card, viewerIsOwner) ? "unavailable" : status,
    fields,
    rarity: effectiveEntryRarity(entry, card, status),
    bucket: typeBucketFor(fields.typeLine),
    addedAt: entry.created_at ?? "",
    position: entry.position ?? 0,
  };
}

export function deckRowsOf<I extends ViewItem>(items: readonly I[], viewerIsOwner: boolean): DeckRow<I>[] {
  return items.map((item) => deckRowOf(item, viewerIsOwner));
}

/** A row's accessible name (TODO DK5.12): its name, its quantity and its
 *  badge — "Sol Ring, 1 copy, Imported" — plus the maker of another
 *  creator's card (D3). Every view's opener says the same. */
export function deckRowLabel(row: DeckRow, maker?: string | null): string {
  const name = row.privateName ? `${row.name} (${row.privateName})` : row.name;
  const copies = `${row.quantity} ${row.quantity === 1 ? "copy" : "copies"}`;
  return `${name}${maker ? ` by @${maker}` : ""}, ${copies}, ${ENTRY_BADGE_LABELS[row.badge]}`;
}

// ---------------------------------------------------------------------------
// The status filter (TODO DK5.6)
// ---------------------------------------------------------------------------

export function filterDeckRows<R extends Pick<DeckRow, "badge">>(rows: readonly R[], filter: StatusFilter): R[] {
  return filter === "all" ? [...rows] : rows.filter((row) => row.badge === filter);
}

/** The deck's cards per badge — THE status count the page says everywhere:
 *  the filter chips, the summary bar's composition and the breakdown's
 *  "Card status" all read it (the independent check of #671: they had
 *  disagreed). Quantities summed ("Imported 59" is 59 cards), over the deck
 *  itself — the maybeboard is a scratchpad and never counts, as everywhere
 *  else (computeDeckAnalytics) — and each card under the badge it WEARS, so
 *  "No longer available" is its own count wherever counts are shown. */
export function deckStatusCountsOf(
  rows: readonly Pick<DeckRow, "badge" | "quantity" | "board">[],
): Record<StatusFilter, number> {
  const counts = { all: 0, imported: 0, edited: 0, remix: 0, original: 0, not_found: 0, unavailable: 0 };
  for (const row of rows) {
    if (row.board === "maybe") continue;
    counts.all += row.quantity;
    counts[row.badge] += row.quantity;
  }
  return counts;
}

/** A badge as a COUNT of cards says it (the breakdown's "Card status"). */
export const ENTRY_BADGE_COUNT_LABELS: Record<EntryBadge, string> = {
  ...DECK_ENTRY_STATUS_COUNT_LABELS,
  unavailable: NO_LONGER_AVAILABLE,
};

/** The counts as a breakdown lists them (the summary bar, the breakdown):
 *  the four kinds of card always — a 0 is news too — then "Not found" and
 *  "No longer available" only when the deck has one. */
export function statusCountRows(counts: Record<StatusFilter, number>): Array<{ badge: EntryBadge; count: number }> {
  return ENTRY_BADGE_ORDER.filter(
    (badge) => (badge !== "not_found" && badge !== "unavailable") || counts[badge] > 0,
  ).map((badge) => ({ badge, count: counts[badge] }));
}

/** The filter chips, in order: All, then Imported and Edited always (a 0
 *  is news too, #654), then each other badge only where the deck has it —
 *  or where it is the chip picked (a removal can empty it). */
export function statusFilterOptions(
  counts: Record<StatusFilter, number>,
  active: StatusFilter,
): Array<{ value: StatusFilter; label: string; count: number }> {
  const always: readonly StatusFilter[] = ["all", "imported", "edited"];
  return (["all", ...ENTRY_BADGE_ORDER] as StatusFilter[])
    .filter((value) => always.includes(value) || counts[value] > 0 || value === active)
    .map((value) => ({ value, label: value === "all" ? "All" : ENTRY_BADGE_LABELS[value], count: counts[value] }));
}

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });

/** The name a row sorts by: the real card's for a private one. */
const sortName = (row: Pick<DeckRow, "name" | "privateName">) => row.privateName ?? row.name;

const COLOR_ORDER = ["W", "U", "B", "R", "G"] as const;

/** W U B R G, then gold (by how many colours, then WUBRG), then colourless. */
function colorRank(row: Pick<DeckRow, "fields">): [number, number, string] {
  const { colors, multicolorOnly } = row.fields;
  if (colors.length === 0) return multicolorOnly ? [5, 0, ""] : [6, 0, ""];
  const ordered = [...colors].sort((a, b) => COLOR_ORDER.indexOf(a) - COLOR_ORDER.indexOf(b));
  if (ordered.length === 1) return [COLOR_ORDER.indexOf(ordered[0]), 0, ""];
  return [5, ordered.length, ordered.map((c) => COLOR_ORDER.indexOf(c)).join("")];
}

/** Lands after spells, then by mana value (none last), then by name. */
function manaRank(row: Pick<DeckRow, "fields" | "bucket">): [number, number] {
  return [row.bucket === "Land" ? 1 : 0, row.fields.manaValue ?? Number.POSITIVE_INFINITY];
}

function compareTuples(a: readonly (number | string)[], b: readonly (number | string)[]): number {
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i];
    const y = b[i];
    if (x === y) continue;
    if (typeof x === "number" && typeof y === "number") return x - y;
    return String(x) < String(y) ? -1 : 1;
  }
  return 0;
}

type SortableRow = Pick<DeckRow, "name" | "privateName" | "fields" | "bucket" | "quantity" | "addedAt" | "position" | "id">;

/** Returns a NEW sorted array. Every sort ends on the name, then the deck's
 *  own order, so two renders always agree. */
export function sortDeckRows<R extends SortableRow>(rows: readonly R[], sort: DeckSort): R[] {
  const tieBreak = (a: R, b: R) => byName(sortName(a), sortName(b)) || a.position - b.position || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const compare: Record<DeckSort, (a: R, b: R) => number> = {
    mana: (a, b) => compareTuples(manaRank(a), manaRank(b)),
    name: () => 0,
    color: (a, b) => compareTuples(colorRank(a), colorRank(b)) || compareTuples(manaRank(a), manaRank(b)),
    quantity: (a, b) => b.quantity - a.quantity,
    // Newest first; entries written in one import share a timestamp, and
    // the later position was added later.
    added: (a, b) => (a.addedAt === b.addedAt ? b.position - a.position : a.addedAt < b.addedAt ? 1 : -1),
  };
  return [...rows].sort((a, b) => compare[sort](a, b) || tieBreak(a, b));
}

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

export type DeckGroup<R> = {
  /** Unique on the page (a DOM id is built from it). */
  key: string;
  label: string;
  rows: R[];
  /** Cards in the group (quantities summed). */
  count: number;
};

type GroupSpec = {
  keyOf: (row: DeckRow) => string;
  order: readonly string[];
  labelOf: (key: string) => string;
};

const MANA_KEYS = ["0", "1", "2", "3", "4", "5", "6", "7", "land", "unknown"] as const;
const COLOR_KEYS = ["W", "U", "B", "R", "G", "M", "C"] as const;
const COLOR_GROUP_LABELS: Record<(typeof COLOR_KEYS)[number], string> = {
  W: COLOR_IDENTITY_LABELS.white,
  U: COLOR_IDENTITY_LABELS.blue,
  B: COLOR_IDENTITY_LABELS.black,
  R: COLOR_IDENTITY_LABELS.red,
  G: COLOR_IDENTITY_LABELS.green,
  M: COLOR_IDENTITY_LABELS.multicolor,
  C: COLOR_IDENTITY_LABELS.colorless,
};
/** The rarities a deck groups and counts by (the list's "Group by rarity",
 *  the breakdown's Rarity chart, TODO DK7.1), rarest first. */
export const DECK_RARITY_KEYS = ["mythic", "rare", "uncommon", "common", "special", "none"] as const;
export type DeckRarityKey = (typeof DECK_RARITY_KEYS)[number];

/** A row's rarity (effectiveEntryRarity, lower case) as one of the keys. */
export function deckRarityKey(rarity: string | null): DeckRarityKey {
  if (rarity === "mythic" || rarity === "rare" || rarity === "uncommon" || rarity === "common") return rarity;
  // Scryfall's "special" (timeshifted…) and "bonus" (Power Nine reprints).
  if (rarity === "special" || rarity === "bonus") return "special";
  return "none";
}

export function deckRarityLabel(key: DeckRarityKey): string {
  return key === "special" ? "Special" : key === "none" ? "No rarity" : RARITY_LABELS[key];
}

const GROUP_SPECS: Record<Exclude<DeckGroupBy, "board" | "none">, GroupSpec> = {
  type: {
    keyOf: (row) => row.bucket,
    order: TYPE_BUCKETS,
    labelOf: (key) => TYPE_BUCKET_PLURALS[key as TypeBucket],
  },
  mana: {
    keyOf: (row) => {
      if (row.bucket === "Land") return "land";
      const mv = row.fields.manaValue;
      // The curve's own column (manaValueSlot): a group is a bar's cards.
      return mv === null ? "unknown" : String(manaValueSlot(mv));
    },
    order: MANA_KEYS,
    labelOf: (key) => (key === "land" ? "Lands" : key === "unknown" ? "No mana value" : key === "7" ? "Mana value 7+" : `Mana value ${key}`),
  },
  color: {
    keyOf: (row) => {
      const { colors, multicolorOnly } = row.fields;
      if (colors.length === 0) return multicolorOnly ? "M" : "C";
      return new Set(colors).size > 1 ? "M" : colors[0];
    },
    order: COLOR_KEYS,
    labelOf: (key) => COLOR_GROUP_LABELS[key as (typeof COLOR_KEYS)[number]],
  },
  status: {
    keyOf: (row) => row.badge,
    order: ENTRY_BADGE_ORDER,
    labelOf: (key) => ENTRY_BADGE_LABELS[key as EntryBadge],
  },
  rarity: {
    keyOf: (row) => deckRarityKey(row.rarity),
    order: DECK_RARITY_KEYS,
    labelOf: (key) => deckRarityLabel(key as DeckRarityKey),
  },
};

/** The boards in the order a deck reads: the zones pinned first. */
export const BOARD_ORDER: readonly DeckBoard[] = ["commander", "companion", "main", "side", "maybe"];

const quantityOf = (rows: readonly Pick<DeckRow, "quantity">[]) => rows.reduce((sum, row) => sum + row.quantity, 0);

function groupOf<R>(key: string, label: string, rows: R[]): DeckGroup<R> {
  return { key, label, rows, count: quantityOf(rows as unknown as Pick<DeckRow, "quantity">[]) };
}

/** The rows in their groups, each group sorted, empty groups left out. */
export function groupDeckRows<R extends DeckRow>(rows: readonly R[], group: DeckGroupBy, sort: DeckSort): DeckGroup<R>[] {
  const sorted = sortDeckRows(rows, sort);
  const byBoard = new Map<DeckBoard, R[]>();
  for (const row of sorted) {
    const list = byBoard.get(row.board) ?? [];
    list.push(row);
    byBoard.set(row.board, list);
  }

  const groups: DeckGroup<R>[] = [];
  if (group === "none") {
    // The deck as one group, its zones' cards first; the sideboard and the
    // maybeboard after it, never mixed in.
    const deck = (["commander", "companion", "main"] as const).flatMap((board) => byBoard.get(board) ?? []);
    if (deck.length > 0) groups.push(groupOf("deck", "Deck", deck));
    for (const board of ["side", "maybe"] as const) {
      const boardRows = byBoard.get(board);
      if (boardRows && boardRows.length > 0) groups.push(groupOf(board, DECK_BOARD_LABELS[board], boardRows));
    }
    return groups;
  }
  for (const board of BOARD_ORDER) {
    const boardRows = byBoard.get(board);
    if (!boardRows || boardRows.length === 0) continue;
    if (group === "board" || board !== "main") {
      groups.push(groupOf(board, DECK_BOARD_LABELS[board], boardRows));
      continue;
    }
    const spec = GROUP_SPECS[group];
    const byKey = new Map<string, R[]>();
    for (const row of boardRows) {
      const key = spec.keyOf(row);
      const list = byKey.get(key) ?? [];
      list.push(row);
      byKey.set(key, list);
    }
    for (const key of spec.order) {
      const list = byKey.get(key);
      if (list && list.length > 0) groups.push(groupOf(`main-${key}`, spec.labelOf(key), list));
    }
  }
  return groups;
}

/** A group's cards as Stacks columns (TODO DK5.3 / WD5): at most `max` a
 *  column, the columns as even as they can be (13 → 7 + 6, never 12 + 1),
 *  so a 36-land group spreads across the width instead of one tall pile. */
export function stackColumnsOf<R>(rows: readonly R[], max = 12): R[][] {
  if (rows.length === 0) return [];
  const columns = Math.ceil(rows.length / max);
  const per = Math.ceil(rows.length / columns);
  const out: R[][] = [];
  for (let i = 0; i < rows.length; i += per) out.push(rows.slice(i, i + per));
  return out;
}

/** "Edit next" (TODO DK5.9): the first unchanged import, in the order the
 *  viewer reads the groups, that the Customize flow takes — a printing
 *  with no PipGlyph card yet (`/create?deckCard=`). The maybeboard is a
 *  scratchpad: never next. */
export function nextUnchangedImport<R extends DeckRow>(groups: readonly DeckGroup<R>[]): R | null {
  for (const group of groups) {
    for (const row of group.rows) {
      if (row.board === "maybe") continue;
      if (row.status === "imported" && !row.item.card && !row.item.entry.card_id && row.item.entry.scryfall_id) return row;
    }
  }
  return null;
}
