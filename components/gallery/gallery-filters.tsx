"use client";

import { useCallback, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ChevronDown,
  Loader2,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import {
  CARD_TYPE_LABELS,
  CARD_TYPE_VALUES,
  COLOR_IDENTITY_VALUES,
  RARITY_VALUES,
  type CardType,
  type ColorIdentity,
  type Rarity,
} from "@/types/card";
import { ManaPip } from "@/components/cards/mana-pip";
import { cn } from "@/lib/utils";

type Sort = "recent" | "popular" | "viewed";

const SORT_LABELS: Record<Sort, string> = {
  recent: "Recent",
  popular: "Most liked",
  viewed: "Most viewed",
};


const RARITY_LABELS: Record<Rarity, string> = {
  common: "Common",
  uncommon: "Uncommon",
  rare: "Rare",
  mythic: "Mythic",
};

function readSort(value: string | null): Sort {
  if (value === "popular") return "popular";
  if (value === "viewed") return "viewed";
  return "recent";
}

export function GalleryFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const cardTypeParam = searchParams.get("type");
  const rarityParam = searchParams.get("rarity");
  const colorParam = searchParams.get("color");
  const sortParam = readSort(searchParams.get("sort"));
  const searchParam = searchParams.get("q") ?? "";
  const tagParam = searchParams.get("tag");
  const remixesOnly = searchParams.get("remixes") === "1";

  const cardType = (CARD_TYPE_VALUES as readonly string[]).includes(
    cardTypeParam ?? "",
  )
    ? (cardTypeParam as CardType)
    : null;
  const rarity = (RARITY_VALUES as readonly string[]).includes(
    rarityParam ?? "",
  )
    ? (rarityParam as Rarity)
    : null;
  const colorIdentity = (COLOR_IDENTITY_VALUES as readonly string[]).includes(
    colorParam ?? "",
  )
    ? (colorParam as ColorIdentity)
    : null;

  // Search has its own local state so typing doesn't refetch on every
  // keystroke. We re-sync to the URL param if it changes externally (back/
  // forward navigation) using the "derived state from props" pattern —
  // setState during render is fine when guarded by a comparator that only
  // fires when the value actually changes (https://react.dev/reference/react/useState#storing-information-from-previous-renders).
  const [searchInput, setSearchInput] = useState(searchParam);
  const [lastSyncedParam, setLastSyncedParam] = useState(searchParam);
  if (searchParam !== lastSyncedParam) {
    setSearchInput(searchParam);
    setLastSyncedParam(searchParam);
  }

  const updateParam = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === "") {
          next.delete(key);
        } else {
          next.set(key, value);
        }
      }
      const queryString = next.toString();
      const href = queryString ? `${pathname}?${queryString}` : pathname;
      startTransition(() => {
        router.replace(href, { scroll: false });
      });
    },
    [router, pathname, searchParams],
  );

  const onSubmitSearch = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = searchInput.trim();
    updateParam({ q: trimmed || null });
  };

  const clearSearch = () => {
    setSearchInput("");
    updateParam({ q: null });
  };

  const [advancedOpen, setAdvancedOpen] = useState(false);

  const clearAll = () => {
    setSearchInput("");
    updateParam({
      q: null,
      type: null,
      rarity: null,
      color: null,
      sort: null,
      tag: null,
      remixes: null,
    });
  };

  // Count of active *advanced* filters (drives the badge on the Filters
  // button). Search + sort live in the always-visible top bar.
  const activeCount =
    (cardType ? 1 : 0) +
    (rarity ? 1 : 0) +
    (colorIdentity ? 1 : 0) +
    (tagParam ? 1 : 0) +
    (remixesOnly ? 1 : 0);

  const anyActive =
    activeCount > 0 || searchInput.trim().length > 0 || sortParam !== "recent";

  // Removable summary pills shown when the advanced panel is collapsed, so the
  // active filters stay visible + one-click clearable without opening it.
  const activePills: { key: string; label: string; onRemove: () => void }[] =
    [];
  if (cardType)
    activePills.push({
      key: "type",
      label: CARD_TYPE_LABELS[cardType],
      onRemove: () => updateParam({ type: null }),
    });
  if (rarity)
    activePills.push({
      key: "rarity",
      label: RARITY_LABELS[rarity],
      onRemove: () => updateParam({ rarity: null }),
    });
  if (colorIdentity)
    activePills.push({
      key: "color",
      label: COLOR_LABEL[colorIdentity],
      onRemove: () => updateParam({ color: null }),
    });
  if (tagParam)
    activePills.push({
      key: "tag",
      label: `#${tagParam}`,
      onRemove: () => updateParam({ tag: null }),
    });
  if (remixesOnly)
    activePills.push({
      key: "remixes",
      label: "Remixes only",
      onRemove: () => updateParam({ remixes: null }),
    });

  return (
    <div className="flex flex-col gap-3">
      {/* Always-visible bar: search + sort + the advanced-filters toggle. */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <form onSubmit={onSubmitSearch} className="relative flex-1">
          <Search
            className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle"
            aria-hidden
          />
          <input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            type="search"
            placeholder="Search cards by name, rules, or flavor"
            className="h-11 w-full rounded-lg border border-border bg-surface pl-10 pr-10 text-sm text-foreground shadow-sm placeholder:text-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            aria-label="Search gallery"
          />
          {searchInput ? (
            <button
              type="button"
              onClick={clearSearch}
              aria-label="Clear search"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-muted hover:bg-elevated hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          ) : null}
          <button type="submit" className="sr-only">
            Search
          </button>
        </form>

        <div className="flex items-center gap-2">
          <label className="sr-only" htmlFor="gallery-sort">
            Sort
          </label>
          <div className="relative">
            <select
              id="gallery-sort"
              value={sortParam}
              onChange={(event) =>
                updateParam({
                  sort:
                    event.target.value === "recent"
                      ? null
                      : event.target.value,
                })
              }
              className="h-11 appearance-none rounded-lg border border-border bg-surface pl-3 pr-9 text-sm font-medium text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              {(Object.keys(SORT_LABELS) as Sort[]).map((value) => (
                <option key={value} value={value}>
                  {SORT_LABELS[value]}
                </option>
              ))}
            </select>
            <ChevronDown
              className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle"
              aria-hidden
            />
          </div>

          <button
            type="button"
            onClick={() => setAdvancedOpen((prev) => !prev)}
            aria-expanded={advancedOpen}
            className={cn(
              "inline-flex h-11 items-center gap-2 rounded-lg border px-3.5 text-sm font-medium shadow-sm transition-colors",
              advancedOpen || activeCount > 0
                ? "border-primary/50 bg-primary/10 text-foreground"
                : "border-border bg-surface text-muted hover:text-foreground",
            )}
          >
            <SlidersHorizontal className="h-4 w-4" aria-hidden />
            <span className="hidden sm:inline">Filters</span>
            {activeCount > 0 ? (
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-white">
                {activeCount}
              </span>
            ) : null}
            <ChevronDown
              className={cn(
                "h-4 w-4 transition-transform",
                advancedOpen && "rotate-180",
              )}
              aria-hidden
            />
          </button>
        </div>
      </div>

      {/* Collapsed summary — active filters stay visible + removable. */}
      {!advancedOpen && activePills.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          {activePills.map((pill) => (
            <button
              key={pill.key}
              type="button"
              onClick={pill.onRemove}
              aria-label={`Remove filter ${pill.label}`}
              className="inline-flex items-center gap-1 rounded-full border border-primary bg-primary/15 px-3 py-1 text-xs font-medium text-primary-bright transition-colors hover:bg-primary/25"
            >
              {pill.label}
              <X className="h-3 w-3" aria-hidden />
            </button>
          ))}
          <button
            type="button"
            onClick={clearAll}
            className="rounded-md px-2 py-1 text-xs text-muted transition-colors hover:bg-elevated hover:text-foreground"
          >
            Clear all
          </button>
        </div>
      ) : null}

      {/* Advanced panel — the full filter set, revealed on demand. */}
      {advancedOpen ? (
        <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface/60 p-4">
          <FilterRow label="Type">
            <Chip
              active={cardType === null}
              onClick={() => updateParam({ type: null })}
            >
              All
            </Chip>
            {CARD_TYPE_VALUES.map((type) => (
              <Chip
                key={type}
                active={cardType === type}
                onClick={() =>
                  updateParam({ type: cardType === type ? null : type })
                }
              >
                {CARD_TYPE_LABELS[type]}
              </Chip>
            ))}
          </FilterRow>

          <FilterRow label="Rarity">
            <Chip
              active={rarity === null}
              onClick={() => updateParam({ rarity: null })}
            >
              All
            </Chip>
            {RARITY_VALUES.map((value) => (
              <Chip
                key={value}
                active={rarity === value}
                onClick={() =>
                  updateParam({ rarity: rarity === value ? null : value })
                }
              >
                {RARITY_LABELS[value]}
              </Chip>
            ))}
          </FilterRow>

          <FilterRow label="Color">
            <Chip
              active={colorIdentity === null}
              onClick={() => updateParam({ color: null })}
            >
              All
            </Chip>
            {COLOR_IDENTITY_VALUES.map((color) => (
              <ColorChip
                key={color}
                color={color}
                active={colorIdentity === color}
                onClick={() =>
                  updateParam({ color: colorIdentity === color ? null : color })
                }
              />
            ))}
          </FilterRow>

          <FilterRow label="Show">
            <Chip
              active={remixesOnly}
              onClick={() =>
                updateParam({ remixes: remixesOnly ? null : "1" })
              }
            >
              Remixes only
            </Chip>
            {tagParam ? (
              <button
                type="button"
                onClick={() => updateParam({ tag: null })}
                aria-label={`Clear tag filter #${tagParam}`}
                className="inline-flex items-center gap-1 rounded-full border border-primary bg-primary/15 px-3 py-1 text-xs font-medium text-primary-bright"
              >
                #{tagParam}
                <X className="h-3 w-3" aria-hidden />
              </button>
            ) : null}
          </FilterRow>

          <div className="flex items-center justify-between gap-2 border-t border-border/50 pt-3">
            <span className="inline-flex items-center gap-1 text-xs text-muted">
              {isPending ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                  Updating…
                </>
              ) : null}
            </span>
            {anyActive ? (
              <button
                type="button"
                onClick={clearAll}
                className="rounded-md px-2 py-1 text-xs text-muted transition-colors hover:bg-elevated hover:text-foreground"
              >
                Clear all filters
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function FilterRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
      <span className="w-16 shrink-0 text-xs font-semibold uppercase tracking-wider text-muted">
        {label}
      </span>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

function Chip({
  children,
  active,
  onClick,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
        active
          ? "border-primary bg-primary/15 text-primary-bright"
          : "border-border bg-elevated text-muted hover:border-border-strong hover:text-foreground",
      )}
      aria-pressed={active}
    >
      {children}
    </button>
  );
}

// Maps a ColorIdentity value to the mana pip symbol used for rendering.
const COLOR_TO_PIP: Record<ColorIdentity, string> = {
  white: "W",
  blue: "U",
  black: "B",
  red: "R",
  green: "G",
  colorless: "C",
  multicolor: "M",
};

// Human-readable label for aria purposes.
const COLOR_LABEL: Record<ColorIdentity, string> = {
  white: "White",
  blue: "Blue",
  black: "Black",
  red: "Red",
  green: "Green",
  colorless: "Colorless",
  multicolor: "Multicolor",
};

function ColorChip({
  color,
  active,
  onClick,
}: {
  color: ColorIdentity;
  active: boolean;
  onClick: () => void;
}) {
  const pipSymbol = COLOR_TO_PIP[color];

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Filter by ${COLOR_LABEL[color]}`}
      aria-pressed={active}
      className={cn(
        "rounded-full transition-all",
        active
          ? "ring-2 ring-primary-bright ring-offset-2 ring-offset-background"
          : "opacity-60 hover:opacity-100",
      )}
    >
      <ManaPip symbol={pipSymbol} size="md" />
    </button>
  );
}
