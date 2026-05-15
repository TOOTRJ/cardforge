"use client";

import { useCallback, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Loader2, Search, X } from "lucide-react";
import {
  CARD_TYPE_VALUES,
  RARITY_VALUES,
  type CardType,
  type Rarity,
} from "@/types/card";
import { cn } from "@/lib/utils";

type Sort = "recent" | "popular";

const SORT_LABELS: Record<Sort, string> = {
  recent: "Recent",
  popular: "Popular",
};

const CARD_TYPE_LABELS: Record<CardType, string> = {
  creature: "Creature",
  spell: "Spell",
  artifact: "Artifact",
  enchantment: "Enchantment",
  land: "Land",
  token: "Token",
};

const RARITY_LABELS: Record<Rarity, string> = {
  common: "Common",
  uncommon: "Uncommon",
  rare: "Rare",
  mythic: "Mythic",
};

function readSort(value: string | null): Sort {
  return value === "popular" ? "popular" : "recent";
}

export function GalleryFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const cardTypeParam = searchParams.get("type");
  const rarityParam = searchParams.get("rarity");
  const sortParam = readSort(searchParams.get("sort"));
  const searchParam = searchParams.get("q") ?? "";

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

  const filtersActive =
    cardType !== null ||
    rarity !== null ||
    sortParam !== "recent" ||
    searchInput.trim().length > 0;

  return (
    <div className="flex flex-col gap-3">
      <form
        onSubmit={onSubmitSearch}
        className="relative flex w-full max-w-md items-center"
      >
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle"
          aria-hidden
        />
        <input
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          type="search"
          placeholder="Search title, rules, or flavor"
          className="h-10 w-full rounded-md border border-border bg-surface pl-9 pr-9 text-sm text-foreground placeholder:text-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          aria-label="Search gallery"
        />
        {searchInput ? (
          <button
            type="button"
            onClick={clearSearch}
            aria-label="Clear search"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted hover:bg-elevated hover:text-foreground"
          >
            <X className="h-3 w-3" aria-hidden />
          </button>
        ) : null}
        <button type="submit" className="sr-only">
          Search
        </button>
      </form>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-subtle">
          Type
        </span>
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
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-subtle">
          Rarity
        </span>
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
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-subtle">
          Sort
        </span>
        {(Object.keys(SORT_LABELS) as Sort[]).map((value) => (
          <Chip
            key={value}
            active={sortParam === value}
            onClick={() =>
              updateParam({ sort: value === "recent" ? null : value })
            }
          >
            {SORT_LABELS[value]}
          </Chip>
        ))}

        {isPending ? (
          <span className="ml-2 inline-flex items-center gap-1 text-xs text-muted">
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
            Updating…
          </span>
        ) : null}

        {filtersActive ? (
          <button
            type="button"
            onClick={() => {
              setSearchInput("");
              updateParam({
                q: null,
                type: null,
                rarity: null,
                sort: null,
              });
            }}
            className="ml-auto rounded-md px-2 py-1 text-xs text-muted transition-colors hover:bg-elevated hover:text-foreground"
          >
            Clear filters
          </button>
        ) : null}
      </div>
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
          ? "border-primary bg-primary/15 text-primary"
          : "border-border bg-elevated text-muted hover:border-border-strong hover:text-foreground",
      )}
      aria-pressed={active}
    >
      {children}
    </button>
  );
}
