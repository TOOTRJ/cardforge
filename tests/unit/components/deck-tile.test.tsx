// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

// ---------------------------------------------------------------------------
// TODO DK8.1 — the ONE deck tile, and DK8.4's "In N decks" on a gallery tile:
//   * the title is the tile's one link, stretched over it; the author and
//     the heart are its siblings — no control inside a link;
//   * the picture (cover + fan) is decorative; a fan card is its thumb;
//   * format and bracket, the colours as pips (with words for a screen
//     reader), the stored counts' "N of M made on PipGlyph", likes, views;
//   * My decks' variant names the visibility and shows the counts as text;
//   * every list surface draws DeckTile — none keeps a tile of its own;
//   * the gallery tile's "In N decks" is text OUTSIDE the CardTile link.
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
  default: ({ src, alt }: { src: string; alt: string }) => <img data-next-image src={src} alt={alt} />,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/gallery",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/components/cards/quick-like-button", () => ({
  QuickLikeButton: ({ initialCount, className }: { initialCount: number; className?: string }) => (
    <button type="button" className={className}>
      Like ({initialCount})
    </button>
  ),
}));
vi.mock("@/components/cards/card-preview", () => ({ CardPreview: () => <div data-testid="live-preview" /> }));
vi.mock("@/components/gallery/trending-share-button", () => ({
  TrendingShareButton: () => <button type="button">Share</button>,
}));
vi.mock("@/lib/cards/preview-data", () => ({
  cardToPreviewData: (row: { title: string; frame_style: unknown }) => ({ title: row.title, frameStyle: row.frame_style }),
}));

import { DeckTile, deckTileCardLine, deckTileFormatLine, deckTilePips, type DeckTileDeck } from "@/components/decks/deck-tile";
import { GalleryCardTile } from "@/components/cards/gallery-card-tile";
import { TrendingCardsSection } from "@/components/gallery/trending-cards-section";
import type { DeckTileArt } from "@/lib/decks/tile-art";
import type { CardWithStats } from "@/lib/cards/queries";
import type { Card } from "@/types/card";

const HOST = "https://auth.pipglyph.com";
const OWNER = "11111111-1111-4111-8111-111111111111";
const CARD = "33333333-3333-4333-8333-333333333333";
const RENDERS = `${HOST}/storage/v1/object/public/card-renders/${OWNER}/${CARD}`;

const deck = (over: Partial<DeckTileDeck> = {}): DeckTileDeck => ({
  id: "44444444-4444-4444-8444-444444444444",
  slug: "ness",
  title: "Ness",
  format: "commander",
  bracket: 2,
  visibility: "public",
  owner_id: OWNER,
  cover_url: null,
  cover_position: null,
  likes_count: 12,
  view_count: 1340,
  cards_count: 100,
  linked_count: 16,
  owner: { username: "storm_griffin", display_name: "Storm" },
  liked_by_viewer: false,
  ...over,
});

const art: DeckTileArt = {
  colors: ["G", "W", "B"],
  fan: [
    {
      kind: "custom",
      key: `card:${CARD}`,
      title: "Vipara",
      card: {
        id: CARD,
        owner_id: OWNER,
        title: "Vipara",
        visibility: "public",
        rendered_image_url: `${RENDERS}.png?v=1`,
        rendered_thumb_url: `${RENDERS}.thumb.webp?v=1`,
        frame_style: { template: "m15" },
        art_position: {},
        color_identity: ["black"],
        subtypes: [],
      } as unknown as Card,
    },
    { kind: "printing", key: "print:sol", title: "Sol Ring", imageUrl: "https://cards.scryfall.io/normal/front/a/b/sol.jpg" },
  ],
};

beforeEach(() => vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", HOST));
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("DeckTile", () => {
  it("one link (the title) to the deck; the author and the heart are siblings of it, never inside", () => {
    render(<DeckTile deck={deck()} art={art} />);
    const tile = screen.getByRole("article");
    const title = within(tile).getByRole("link", { name: "Ness" });
    expect(title.getAttribute("href")).toBe("/deck/ness");
    // Stretched over the tile by its ::after, so the whole tile opens it.
    expect(title.className).toContain("after:absolute");
    expect(title.className).toContain("after:inset-0");
    const author = within(tile).getByRole("link", { name: "@storm_griffin" });
    expect(author.getAttribute("href")).toBe("/profile/storm_griffin");
    for (const link of within(tile).getAllByRole("link")) {
      expect(link.querySelector("a, button")).toBeNull();
    }
    expect(within(tile).getByRole("button", { name: /like/i }).closest("a")).toBeNull();
    expect(within(tile).getAllByRole("link")).toHaveLength(2);
  });

  it("the footer strip lets a click through to the stretched link; only the author and the heart take their own", () => {
    render(<DeckTile deck={deck()} art={art} />);
    const tile = screen.getByRole("article");
    const author = within(tile).getByRole("link", { name: "@storm_griffin" });
    const strip = author.parentElement!;
    expect(strip.className).toContain("pointer-events-none");
    expect(strip.className).toContain("z-10");
    expect(author.className).toContain("pointer-events-auto");
    expect(within(tile).getByRole("button", { name: /like/i }).className).toContain("pointer-events-auto");
  });

  it("the picture is decorative; a PipGlyph card in its fan is the 600 px thumb, never the HD PNG", () => {
    const { container } = render(<DeckTile deck={deck()} art={art} />);
    const picture = container.querySelector("[aria-hidden]")!;
    expect(picture.querySelector("img[data-next-image]")?.getAttribute("alt")).toBe("");
    const srcs = [...picture.querySelectorAll("img")].map((img) => img.getAttribute("src") ?? "");
    expect(srcs.some((src) => src.includes(".thumb.webp"))).toBe(true);
    expect(srcs.some((src) => src.includes(`${CARD}.png`))).toBe(false);
    // The fan is sized by the tile (its picture is the query container).
    expect(picture.className).toContain("@container");
  });

  it("names the format and bracket, the colours (WUBRG order, in words for a screen reader), the counts, likes and views", () => {
    render(<DeckTile deck={deck()} art={art} />);
    const tile = screen.getByRole("article");
    expect(within(tile).getByText("Commander · Bracket 2")).toBeTruthy();
    expect(within(tile).getByText("Colors: White, Black, Green")).toBeTruthy();
    expect(within(tile).getByText("16 of 100 made on PipGlyph")).toBeTruthy();
    expect(within(tile).getByRole("button", { name: "Like (12)" })).toBeTruthy();
    expect(tile.textContent).toContain("1,340");
    expect(within(tile).getByText("views")).toBeTruthy();
  });

  it("My decks: the visibility on the picture, the counts as text (no heart), no author", () => {
    render(
      <DeckTile
        deck={deck({ visibility: "private", updated_at: new Date().toISOString(), cards_count: 0, linked_count: 0 })}
        variant="owner"
      />,
    );
    const tile = screen.getByRole("article");
    expect(within(tile).getByText("Private")).toBeTruthy();
    expect(within(tile).queryByRole("button")).toBeNull();
    expect(within(tile).queryByRole("link", { name: /@/ })).toBeNull();
    expect(within(tile).getByText("No cards yet")).toBeTruthy();
    expect(within(tile).getAllByRole("link")).toHaveLength(1);
  });
});

describe("DeckTile's lines", () => {
  it("formats, brackets only for Commander", () => {
    expect(deckTileFormatLine({ format: "commander", bracket: 3 })).toBe("Commander · Bracket 3");
    expect(deckTileFormatLine({ format: "commander", bracket: null })).toBe("Commander");
    expect(deckTileFormatLine({ format: "modern", bracket: 3 })).toBe("Modern");
  });

  it("pips: unknown is none, known-colourless is C, a gold card M", () => {
    expect(deckTilePips(null)).toBeNull();
    expect(deckTilePips([])).toEqual({ symbols: ["C"], label: "Colorless" });
    expect(deckTilePips(["M", "R"])).toEqual({ symbols: ["R", "M"], label: "Red, Multicolor" });
  });

  it("the card line is the stored counts' (an empty deck says so)", () => {
    expect(deckTileCardLine({ cards_count: 60, linked_count: 12 })).toBe("12 of 60 made on PipGlyph");
    expect(deckTileCardLine({ cards_count: 0, linked_count: 0 })).toBe("No cards yet");
  });
});

describe("every deck list draws DeckTile (no tile of its own)", () => {
  const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");
  it.each([
    "app/(marketing)/decks/decks-view.tsx",
    "app/(marketing)/decks/format/[format]/page.tsx",
    "app/(app)/dashboard/decks/page.tsx",
    "app/(marketing)/profile/[username]/page.tsx",
    "components/decks/deck-row.tsx",
    "components/cards/card-detail-content.tsx",
  ])("%s", (file) => {
    const source = read(file);
    expect(source).toMatch(/<DeckTile\b/);
    expect(source).not.toMatch(/\bPublicDeckTile\b|\blistDeckCoverColors\b|\bmadeOnPipGlyph\(/);
  });
});

describe("GalleryCardTile — In N decks (TODO DK8.4)", () => {
  const card = (count: number | undefined) =>
    ({
      id: CARD,
      owner_id: OWNER,
      slug: "vipara",
      title: "Vipara",
      card_type: "creature",
      rarity: "rare",
      frame_style: { template: "m15" },
      rendered_image_url: `${RENDERS}.png?v=1`,
      rendered_thumb_url: `${RENDERS}.thumb.webp?v=1`,
      rendered_back_thumb_url: null,
      parent_card_id: null,
      source_scryfall_id: null,
      owner: { username: "storm_griffin", display_name: null, avatar_url: null },
      likes_count: 4,
      liked_by_viewer: false,
      ...(count === undefined ? {} : { public_deck_count: count }),
    }) as unknown as CardWithStats;

  it("is text in the footer, outside the tile's link", () => {
    render(<GalleryCardTile card={card(3)} isAuthed={false} />);
    const text = screen.getByText("In 3 decks");
    expect(text.closest("a")).toBeNull();
    expect(screen.getByText("In 3 decks").closest("a, button")).toBeNull();
  });

  it("the trending tile draws the same count, outside its link", () => {
    render(<TrendingCardsSection cards={[card(2)]} isAuthed={false} />);
    const text = screen.getByText("In 2 decks");
    expect(text.closest("a, button")).toBeNull();
  });

  it("one deck is singular; none, or not read, says nothing", () => {
    render(<GalleryCardTile card={card(1)} isAuthed={false} />);
    expect(screen.getByText("In 1 deck")).toBeTruthy();
    cleanup();
    render(<GalleryCardTile card={card(0)} isAuthed={false} />);
    expect(screen.queryByText(/^In \d+ decks?$/)).toBeNull();
    cleanup();
    render(<GalleryCardTile card={card(undefined)} isAuthed={false} />);
    expect(screen.queryByText(/^In \d+ decks?$/)).toBeNull();
  });
});
