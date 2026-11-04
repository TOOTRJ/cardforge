// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

// ---------------------------------------------------------------------------
// The /decks landing's sections (owner request 2026-11-03, migration 0167):
//   * "Featured themed decks" at the top — a violet panel, one sub-section
//     per theme (its title an h3, the tiles' h4), every tile a DeckTile;
//     nothing at all when no theme has a deck;
//   * "Trending now" right under it, as the gallery's glowing hero block
//     with its Week / Month / Year / All time switch (owner 2026-11-04),
//     opening on the month — else the next range with decks, in the
//     gallery's order — a rank badge over each tile that leaves its one
//     link alone, and the range's likes under it;
//   * "Discover" in place of "Newest public decks" (which ordered by the
//     last EDIT, decks.updated_at);
//   * the landing and the home page stay static: no searchParams, no
//     cookie-bound client; the home page draws the featured themes too,
//     ABOVE its trending cards (owner 2026-11-04).
// ---------------------------------------------------------------------------

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children?: ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}));
vi.mock("@/components/cards/quick-like-button", () => ({
  QuickLikeButton: ({ initialCount }: { initialCount: number }) => <button type="button">Like ({initialCount})</button>,
}));
vi.mock("@/lib/decks/queries", () => ({
  DECK_ROW_MAX: 4,
  listFeaturedDeckThemes: vi.fn(),
  listTrendingDecks: vi.fn(),
  listTrendingDecksByRange: vi.fn(),
}));
vi.mock("@/lib/decks/tile-art", () => ({ listDeckTileArt: vi.fn() }));

import { FeaturedDeckThemesSection } from "@/components/decks/featured-deck-themes";
import { DeckRowSection, TrendingDecksRanges } from "@/components/decks/deck-row";
import { listTrendingDecksByRange } from "@/lib/decks/queries";
import { listDeckTileArt } from "@/lib/decks/tile-art";
import type { FeaturedDeckTheme, PublicDeckListing, TrendingDeckListing } from "@/lib/decks/queries";
import type { TrendingRange } from "@/lib/cards/trending";
import { Flame } from "lucide-react";

afterEach(cleanup);

const deck = (n: number): PublicDeckListing =>
  ({
    id: `44444444-4444-4444-8444-44444444444${n}`,
    slug: `deck-${n}`,
    title: `Deck ${n}`,
    format: "casual",
    bracket: null,
    visibility: "public",
    owner_id: "11111111-1111-4111-8111-111111111111",
    cover_url: null,
    cover_position: null,
    likes_count: n,
    view_count: 10 * n,
    cards_count: 12,
    linked_count: 2,
    owner: { username: "storm_griffin", display_name: null, avatar_url: null },
    liked_by_viewer: false,
  }) as unknown as PublicDeckListing;

const themes: FeaturedDeckTheme[] = [
  { id: "t1", title: "Dragons ascendant", blurb: "Fire-breathing tribal decks.", decks: [deck(1), deck(2)] },
  { id: "t2", title: "Artifacts & constructs", blurb: null, decks: [deck(3)] },
];

describe("Featured themed decks", () => {
  it("one labelled section, a sub-section per theme, every deck a DeckTile link", () => {
    render(<FeaturedDeckThemesSection themes={themes} art={new Map()} />);
    const section = screen.getByRole("region", { name: "Featured themed decks" });
    const dragons = within(section).getByRole("region", { name: "Dragons ascendant" });
    expect(within(dragons).getByText("Fire-breathing tribal decks.")).toBeTruthy();
    expect(within(dragons).getAllByRole("heading", { level: 4 }).map((h) => h.textContent)).toEqual(["Deck 1", "Deck 2"]);
    expect(within(dragons).getByRole("link", { name: "Deck 1" }).getAttribute("href")).toBe("/deck/deck-1");
    const artifacts = within(section).getByRole("region", { name: "Artifacts & constructs" });
    expect(within(artifacts).getAllByRole("heading", { level: 4 })).toHaveLength(1);
  });

  it("draws nothing when no theme has a deck", () => {
    const { container } = render(<FeaturedDeckThemesSection themes={[]} art={new Map()} />);
    expect(container.innerHTML).toBe("");
  });
});

const ranked = (range: TrendingRange, ...ns: number[]): TrendingDeckListing[] =>
  ns.map((n) => ({ ...deck(n), trending: { range, likes: n, score: n } }));

async function renderRanges(byRange: Record<TrendingRange, TrendingDeckListing[]>) {
  vi.mocked(listTrendingDecksByRange).mockResolvedValue(byRange);
  vi.mocked(listDeckTileArt).mockResolvedValue(new Map());
  const tree = await TrendingDecksRanges({ browseHref: "/decks/browse?sort=popular" });
  return tree ? render(tree) : null;
}

describe("Trending decks — the gallery's hero and range switch", () => {
  it("opens on the month in the gallery's glow, ranked tiles with the month's likes", async () => {
    await renderRanges({ week: ranked("week", 1), month: ranked("month", 2, 3), year: [], all: ranked("all", 4) });
    const section = screen.getByRole("region", { name: "Hot this month" });
    expect(section.className).toContain("border-gold/35");
    expect(within(section).getByRole("tab", { name: "Month" }).getAttribute("aria-selected")).toBe("true");
    expect(within(section).getAllByRole("tab").map((t) => t.textContent)).toEqual(["Week", "Month", "Year", "All time"]);
    expect(within(section).getAllByRole("link", { name: /^Deck/ }).map((a) => a.textContent)).toEqual(["Deck 2", "Deck 3"]);
    expect(within(section).getByText("#1").textContent).toBe("Trending rank #1");
    // The badge is no control: the tile's title stays its one link.
    expect(within(section).getByText("#1").closest("a")).toBeNull();
    expect(within(section).getAllByTitle(/likes? this month$/).map((el) => el.getAttribute("title"))).toEqual([
      "2 likes this month",
      "3 likes this month",
    ]);
    expect(listTrendingDecksByRange).toHaveBeenCalledWith({ limit: 4 });
  });

  it("a month with nothing opens on the year, then all time — the gallery's order", async () => {
    await renderRanges({ week: ranked("week", 1), month: [], year: [], all: ranked("all", 4) });
    const section = screen.getByRole("region", { name: "Hottest of all time" });
    expect(within(section).getByRole("tab", { name: "All time" }).getAttribute("aria-selected")).toBe("true");
  });

  it("an empty range says so and points at the decks", async () => {
    await renderRanges({ week: [], month: ranked("month", 2), year: [], all: [] });
    const section = screen.getByRole("region", { name: "Hot this month" });
    fireEvent.click(within(section).getByRole("tab", { name: "Week" }));
    expect(within(section).getByRole("heading", { level: 2 }).textContent).toBe("Hot this week");
    expect(await within(section).findByText(/No deck has been liked this week yet\./)).toBeTruthy();
    expect(within(section).getByRole("link", { name: "browse every deck" }).getAttribute("href")).toBe(
      "/decks/browse?sort=popular",
    );
  });

  it("no range with a liked deck: no block at all", async () => {
    expect(await renderRanges({ week: [], month: [], year: [], all: [] })).toBeNull();
  });

  it("the plain row (the gallery's decks row) stays unranked and unglowing", () => {
    render(
      <DeckRowSection id="x" icon={Flame} eyebrow="Community decks" heading="Trending decks" decks={[deck(1)]} art={new Map()} />,
    );
    const section = screen.getByRole("region", { name: "Trending decks" });
    expect(section.className).not.toContain("border-gold/35");
    expect(within(section).queryByText(/Trending rank/)).toBeNull();
  });
});

describe("the landing's structure", () => {
  const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");
  const code = (file: string) =>
    read(file)
      .split("\n")
      .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*") && !line.trim().startsWith("{/*"))
      .join("\n");
  const landing = () => {
    const source = code("app/(marketing)/decks/decks-view.tsx");
    return source.slice(source.indexOf("export function DecksLanding"), source.indexOf("export function DecksBrowse"));
  };

  it("Featured → Trending (hero) → Cards to build around → Discover, in that order", () => {
    const source = landing();
    const order = ["<FeaturedDeckThemes", "<TrendingDecksRanges", "<DecksCommanderCards", "<DiscoverDecks"].map(
      (needle) => source.indexOf(needle),
    );
    expect(order.every((at) => at > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("Newest public decks is gone (it ordered by the last edit)", () => {
    const source = code("app/(marketing)/decks/decks-view.tsx");
    expect(source).not.toContain("Newest public decks");
    expect(landing()).not.toMatch(/PublicDecksResults|sort="recent"/);
    expect(source).toMatch(/listDiscoverDecks\(discoverSeedNow\(\), DISCOVER_DECKS_MAX\)/);
  });

  it("the landing and the home page stay static: no searchParams, no cookie-bound reads", () => {
    for (const file of ["app/(marketing)/decks/page.tsx", "app/(marketing)/page.tsx"]) {
      const source = code(file);
      expect(source).not.toMatch(/searchParams|cookies\(|createClient\(/);
    }
    const queries = read("lib/decks/queries.ts");
    for (const fn of ["listDiscoverDecks", "listFeaturedDeckThemes"]) {
      const body = queries.slice(queries.indexOf(`export async function ${fn}`));
      const end = body.indexOf("\n}\n");
      expect(body.slice(0, end)).toContain("createPublicClient()");
      expect(body.slice(0, end)).not.toContain("await createClient()");
    }
  });

  it("the home page draws the featured themed decks above its trending cards", () => {
    const home = code("app/(marketing)/page.tsx");
    const featured = home.indexOf("<FeaturedDeckThemes");
    const trending = home.indexOf("<HomeTrending />");
    expect(featured).toBeGreaterThan(0);
    expect(trending).toBeGreaterThan(featured);
  });
});
