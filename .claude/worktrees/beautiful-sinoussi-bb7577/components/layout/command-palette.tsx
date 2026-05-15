"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter, usePathname } from "next/navigation";
import {
  Compass,
  ExternalLink,
  FilePlus2,
  FolderPlus,
  Globe2,
  LayoutDashboard,
  Layers,
  Loader2,
  Search,
  Settings,
  Sparkles,
  UserCircle,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { CARDFORGE_EVENTS } from "@/components/creator/start-with-hero";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// CommandPalette — global ⌘K palette mounted once in the (app) layout.
//
// Three tabs share a single search input:
//   1. Navigate  — hardcoded routes filtered by typed text
//   2. My cards  — server route /api/cards/search?q=...
//   3. Scryfall  — server route /api/scryfall/search?q=...
//
// Open paths:
//   - Keyboard: ⌘K (mac) or Ctrl+K (else). Skipped when focus is in an
//     input / textarea / contentEditable element so it doesn't hijack the
//     usual editor shortcuts.
//   - Programmatic: `window.dispatchEvent(new CustomEvent("cardforge:open-palette"))`
//     used by the header trigger chip and any future call site.
// ---------------------------------------------------------------------------

const SEARCH_DEBOUNCE_MS = 200;
const OPEN_EVENT = "cardforge:open-palette";

type NavItem = {
  title: string;
  href: string;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  hint: string;
};

const NAV_ITEMS: NavItem[] = [
  {
    title: "Dashboard",
    href: "/dashboard",
    icon: LayoutDashboard,
    hint: "Your cards, drafts, and stats",
  },
  {
    title: "New card",
    href: "/create",
    icon: FilePlus2,
    hint: "Open the card creator",
  },
  {
    title: "Community gallery",
    href: "/gallery",
    icon: Globe2,
    hint: "Browse public cards",
  },
  {
    title: "My sets",
    href: "/sets",
    icon: Layers,
    hint: "Manage your card sets",
  },
  {
    title: "New set",
    href: "/sets/new",
    icon: FolderPlus,
    hint: "Create a new card set",
  },
  {
    title: "Settings",
    href: "/settings",
    icon: Settings,
    hint: "Profile and account",
  },
];

type CommandPaletteProps = {
  /** When set, a "Your profile" item appears in the Navigate tab. */
  username?: string | null;
};

export function CommandPalette({ username }: CommandPaletteProps) {
  const [open, setOpen] = useState(false);

  // Global keyboard listener for ⌘K / Ctrl+K.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onKey = (event: KeyboardEvent) => {
      const isShortcut =
        (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k";
      if (!isShortcut) return;
      // Don't hijack ⌘K when the user is editing text — they might have
      // their own muscle memory for editor shortcuts.
      const target = document.activeElement;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }
      event.preventDefault();
      setOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Custom-event listener so the header chip + future call sites can open
  // the palette without a direct ref.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onOpen = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent size="md" className="min-h-0">
        {open ? (
          <PaletteBody
            onClose={() => setOpen(false)}
            username={username ?? null}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// PaletteBody — only mounted while the dialog is open, so each open gets
// a fresh state slot (query / results / tab).
// ---------------------------------------------------------------------------

type TabKey = "navigate" | "cards" | "scryfall";

type CardHit = {
  id: string;
  slug: string;
  title: string;
  visibility: string;
  card_type: string | null;
  rarity: string | null;
};

type ScryfallHit = {
  id: string;
  name: string;
  set: string | null;
  set_name: string | null;
  type_line: string | null;
  mana_cost: string | null;
  rarity: string | null;
  thumb_url: string | null;
};

function PaletteBody({
  onClose,
  username,
}: {
  onClose: () => void;
  username: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState("");
  const [activeTab, setActiveTab] = useState<TabKey>("navigate");

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Compose the navigate list with an optional "Your profile" entry.
  const navItems = useMemo<NavItem[]>(() => {
    if (!username) return NAV_ITEMS;
    return [
      ...NAV_ITEMS,
      {
        title: "Your profile",
        href: `/profile/${username}`,
        icon: UserCircle,
        hint: `@${username}`,
      },
    ];
  }, [username]);

  const filteredNav = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return navItems;
    return navItems.filter(
      (item) =>
        item.title.toLowerCase().includes(q) ||
        item.hint.toLowerCase().includes(q),
    );
  }, [navItems, query]);

  const handlePick = useCallback(
    (action: () => void) => {
      action();
      onClose();
    },
    [onClose],
  );

  const navigateTo = useCallback(
    (href: string) => {
      handlePick(() => router.push(href));
    },
    [handlePick, router],
  );

  // Selecting a Scryfall hit either opens the import dialog (if we're on
  // /create) or navigates to /create. In a future chunk we could pass the
  // chosen card id along via the URL so the dialog auto-preselects.
  const pickScryfall = useCallback(() => {
    if (pathname === "/create" || pathname.endsWith("/edit")) {
      window.dispatchEvent(new CustomEvent(CARDFORGE_EVENTS.openScryfall));
      onClose();
    } else {
      handlePick(() => router.push("/create"));
    }
  }, [handlePick, onClose, pathname, router]);

  return (
    <>
      {/* Search row */}
      <div className="flex items-center gap-3 border-b border-border/60 px-4 py-3">
        <Search className="h-4 w-4 shrink-0 text-subtle" aria-hidden />
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Type to search nav, your cards, or Scryfall"
          className="h-8 flex-1 bg-transparent text-sm text-foreground placeholder:text-subtle focus:outline-none"
          aria-label="Command palette search"
        />
        <kbd className="rounded-sm border border-border bg-elevated px-1.5 py-0.5 font-mono text-[10px] text-subtle">
          Esc
        </kbd>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(next) => setActiveTab(next as TabKey)}
      >
        <div className="border-b border-border/60 px-4 py-2">
          <TabsList>
            <TabsTrigger value="navigate">Navigate</TabsTrigger>
            <TabsTrigger value="cards">My cards</TabsTrigger>
            <TabsTrigger value="scryfall">Scryfall</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="navigate" className="max-h-[50vh] overflow-y-auto">
          {filteredNav.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs text-subtle">
              No matching routes.
            </p>
          ) : (
            <ul role="listbox" aria-label="Navigation">
              {filteredNav.map((item) => {
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={false}
                      onClick={() => navigateTo(item.href)}
                      className="flex w-full items-center gap-3 border-b border-border/40 px-4 py-2.5 text-left transition-colors hover:bg-elevated/60"
                    >
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-elevated text-muted">
                        <Icon className="h-3.5 w-3.5" aria-hidden />
                      </span>
                      <span className="flex flex-1 flex-col gap-0.5">
                        <span className="text-sm font-medium text-foreground">
                          {item.title}
                        </span>
                        <span className="text-[11px] text-subtle">
                          {item.hint}
                        </span>
                      </span>
                      <Compass
                        className="h-3.5 w-3.5 text-subtle"
                        aria-hidden
                      />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="cards" className="max-h-[50vh] overflow-y-auto">
          <MyCardsList
            query={query}
            onPick={(card) =>
              navigateTo(`/card/${card.slug}/edit`)
            }
          />
        </TabsContent>

        <TabsContent value="scryfall" className="max-h-[50vh] overflow-y-auto">
          <ScryfallList query={query} onPick={pickScryfall} />
        </TabsContent>
      </Tabs>
    </>
  );
}

// ---------------------------------------------------------------------------
// My-cards tab — debounced fetch against /api/cards/search.
// ---------------------------------------------------------------------------

function MyCardsList({
  query,
  onPick,
}: {
  query: string;
  onPick: (card: CardHit) => void;
}) {
  const [results, setResults] = useState<CardHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(
          `/api/cards/search?${new URLSearchParams({
            q: query.trim(),
            limit: "15",
          })}`,
          { signal: controller.signal },
        );
        const body = (await response.json().catch(() => ({}))) as {
          ok?: boolean;
          results?: CardHit[];
          error?: string;
        };
        if (!response.ok || !body.ok) {
          setResults([]);
          setError(body.error ?? "Could not load cards.");
          return;
        }
        setResults(body.results ?? []);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError("Could not load cards.");
      } finally {
        setLoading(false);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query]);

  if (error) {
    return <p className="px-4 py-3 text-xs text-danger">{error}</p>;
  }
  if (loading && results.length === 0) {
    return (
      <div className="flex items-center justify-center px-4 py-6">
        <Loader2 className="h-4 w-4 animate-spin text-subtle" aria-hidden />
      </div>
    );
  }
  if (results.length === 0) {
    return (
      <p className="px-4 py-6 text-center text-xs text-subtle">
        {query.trim() ? "No matches in your cards." : "Type to search your cards."}
      </p>
    );
  }
  return (
    <ul role="listbox" aria-label="Your cards">
      {results.map((card) => (
        <li key={card.id}>
          <button
            type="button"
            role="option"
            aria-selected={false}
            onClick={() => onPick(card)}
            className="flex w-full items-center gap-3 border-b border-border/40 px-4 py-2.5 text-left transition-colors hover:bg-elevated/60"
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-elevated text-muted">
              <Sparkles className="h-3.5 w-3.5" aria-hidden />
            </span>
            <span className="flex flex-1 flex-col gap-0.5">
              <span className="truncate text-sm font-medium text-foreground">
                {card.title}
              </span>
              <span className="text-[11px] uppercase tracking-wider text-subtle">
                {card.visibility}
                {card.rarity ? ` · ${card.rarity}` : ""}
                {card.card_type ? ` · ${card.card_type}` : ""}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Scryfall tab — debounced fetch against /api/scryfall/search.
// ---------------------------------------------------------------------------

function ScryfallList({
  query,
  onPick,
}: {
  query: string;
  onPick: (card: ScryfallHit) => void;
}) {
  const [results, setResults] = useState<ScryfallHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = query.trim();
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      if (!q) {
        setResults([]);
        setError(null);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(
          `/api/scryfall/search?${new URLSearchParams({ q, limit: "12" })}`,
          { signal: controller.signal },
        );
        const body = (await response.json().catch(() => ({}))) as {
          ok?: boolean;
          results?: ScryfallHit[];
          error?: string;
        };
        if (!response.ok || !body.ok) {
          setResults([]);
          setError(body.error ?? "Search failed.");
          return;
        }
        setResults(body.results ?? []);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError("Search failed.");
      } finally {
        setLoading(false);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query]);

  if (error) {
    return <p className="px-4 py-3 text-xs text-danger">{error}</p>;
  }
  if (!query.trim()) {
    return (
      <p className="px-4 py-6 text-center text-xs text-subtle">
        Type a card name (or Scryfall syntax like{" "}
        <code className="font-mono text-foreground">t:dragon</code>) to search.
      </p>
    );
  }
  if (loading && results.length === 0) {
    return (
      <div className="flex items-center justify-center px-4 py-6">
        <Loader2 className="h-4 w-4 animate-spin text-subtle" aria-hidden />
      </div>
    );
  }
  if (results.length === 0) {
    return (
      <p className="px-4 py-6 text-center text-xs text-subtle">No matches.</p>
    );
  }
  return (
    <ul role="listbox" aria-label="Scryfall results">
      {results.map((card) => (
        <li key={card.id}>
          <button
            type="button"
            role="option"
            aria-selected={false}
            onClick={() => onPick(card)}
            className={cn(
              "flex w-full items-center gap-3 border-b border-border/40 px-4 py-2.5 text-left transition-colors hover:bg-elevated/60",
            )}
          >
            {card.thumb_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={card.thumb_url}
                alt=""
                className="h-10 w-14 shrink-0 rounded-sm object-cover"
                loading="lazy"
              />
            ) : (
              <div className="h-10 w-14 shrink-0 rounded-sm bg-elevated" />
            )}
            <span className="flex flex-1 flex-col gap-0.5">
              <span className="truncate text-sm font-medium text-foreground">
                {card.name}
              </span>
              <span className="truncate text-[11px] uppercase tracking-wider text-subtle">
                {card.set?.toUpperCase() ?? "—"}
                {card.rarity ? ` · ${card.rarity}` : ""}
              </span>
            </span>
            <ExternalLink className="h-3.5 w-3.5 text-subtle" aria-hidden />
          </button>
        </li>
      ))}
    </ul>
  );
}
