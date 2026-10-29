import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/site-url", () => ({ getSiteBaseUrl: () => "https://www.pipglyph.com" }));

import { collectionPageJsonLd } from "@/components/seo/json-ld";
import {
  CREATORS_PAGE_SIZE,
  creatorListEntries,
  creatorPageCount,
  creatorStats,
  creatorsHref,
  mapCreatorRows,
  parseCreatorsParams,
  type PublicCreatorRow,
} from "@/lib/creators/directory";
import { CREATORS_FILTER_PARAMS } from "@/lib/routing/browse-params";

// ---------------------------------------------------------------------------
// /creators (TODO NV11) — the pure half. WHO is listed is migration 0147's
// rule (tests/unit/db/creators-requested-frames-migration.test.ts); this holds
// the app to it: a row with no handle or no public card is never drawn, the
// numbers are never negative, the links stay on the two routes, and the
// landing's structured data is a CollectionPage whose ItemList names each
// creator's canonical profile.
// ---------------------------------------------------------------------------

const row = (overrides: Partial<PublicCreatorRow> = {}): PublicCreatorRow => ({
  id: "d0000000-0000-4000-a000-000000000004",
  username: "dev_artist",
  display_name: "Ari the Artificer",
  avatar_url: null,
  public_cards: "14",
  public_decks: 0,
  likes: "7",
  last_card_at: "2026-09-21T00:10:32Z",
  recent_card_ids: ["a", "b", "c", "d"],
  total: "3",
  ...overrides,
});

describe("parseCreatorsParams / creatorsHref", () => {
  it("reads a known sort and a positive page; anything else is the default", () => {
    expect(parseCreatorsParams({})).toEqual({ sort: "cards", page: 1 });
    expect(parseCreatorsParams({ sort: "liked", page: "3" })).toEqual({ sort: "liked", page: 3 });
    expect(parseCreatorsParams({ sort: ["recent", "liked"], page: ["2"] })).toEqual({ sort: "recent", page: 2 });
    expect(parseCreatorsParams({ sort: "drop table", page: "-4" })).toEqual({ sort: "cards", page: 1 });
    expect(parseCreatorsParams({ page: "abc" })).toEqual({ sort: "cards", page: 1 });
  });

  it("links the default view to the landing and every other view inside /creators/browse", () => {
    expect(creatorsHref({ sort: "cards", page: 1 })).toBe("/creators");
    expect(creatorsHref({ sort: "cards", page: 2 })).toBe("/creators/browse?page=2");
    expect(creatorsHref({ sort: "recent", page: 1 })).toBe("/creators/browse?sort=recent");
    expect(creatorsHref({ sort: "liked", page: 3 })).toBe("/creators/browse?sort=liked&page=3");
  });

  it("parses exactly the params proxy.ts 308s from the landing", () => {
    expect([...CREATORS_FILTER_PARAMS].sort()).toEqual(["page", "sort"]);
  });
});

describe("mapCreatorRows", () => {
  it("turns the database's numbers into counts and keeps three strip ids", () => {
    const { creators, total } = mapCreatorRows([row()]);
    expect(total).toBe(3);
    expect(creators).toEqual([
      {
        id: "d0000000-0000-4000-a000-000000000004",
        username: "dev_artist",
        name: "Ari the Artificer",
        avatarUrl: null,
        publicCards: 14,
        publicDecks: 0,
        likes: 7,
        lastCardAt: "2026-09-21T00:10:32Z",
        recentCardIds: ["a", "b", "c"],
      },
    ]);
  });

  it("never draws a row with no handle or no public card, nor a negative number", () => {
    const { creators } = mapCreatorRows([
      row({ username: "" }),
      row({ username: "nobody", public_cards: 0 }),
      row({ username: "weird", public_cards: "2", likes: -5, public_decks: "x" }),
    ]);
    expect(creators.map((c) => c.username)).toEqual(["weird"]);
    expect(creators[0]).toMatchObject({ likes: 0, publicDecks: 0 });
  });

  it("falls back to the handle when there is no display name", () => {
    const { creators } = mapCreatorRows([row({ display_name: "   " }), row({ display_name: null, username: "kesh" })]);
    expect(creators.map((c) => c.name)).toEqual(["@dev_artist", "@kesh"]);
    expect(mapCreatorRows([]).total).toBe(0);
  });
});

describe("the row's words", () => {
  it("names cards and likes, and decks only when there are some", () => {
    expect(creatorStats({ publicCards: 14, publicDecks: 0, likes: 7 })).toEqual(["14 cards", "7 likes"]);
    expect(creatorStats({ publicCards: 1, publicDecks: 1, likes: 1 })).toEqual(["1 card", "1 deck", "1 like"]);
    expect(creatorStats({ publicCards: 1200, publicDecks: 3, likes: 0 })).toEqual(["1,200 cards", "3 decks", "0 likes"]);
  });

  it("pages by the page size", () => {
    expect(creatorPageCount(0)).toBe(1);
    expect(creatorPageCount(CREATORS_PAGE_SIZE)).toBe(1);
    expect(creatorPageCount(CREATORS_PAGE_SIZE + 1)).toBe(2);
  });
});

describe("the landing's structured data", () => {
  it("is a CollectionPage whose ItemList names each creator's canonical profile", () => {
    const { creators } = mapCreatorRows([row(), row({ username: "kesh", display_name: null })]);
    const data = collectionPageJsonLd({
      name: "PipGlyph creators",
      description: "The makers.",
      path: "/creators",
      items: creatorListEntries(creators),
    });
    expect(data).toMatchObject({
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      url: "https://www.pipglyph.com/creators",
      mainEntity: {
        "@type": "ItemList",
        numberOfItems: 2,
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: "Ari the Artificer (@dev_artist)",
            url: "https://www.pipglyph.com/profile/dev_artist",
          },
          { "@type": "ListItem", position: 2, name: "@kesh", url: "https://www.pipglyph.com/profile/kesh" },
        ],
      },
    });
    // Nothing but names and profile URLs: no counts, avatars or ids.
    expect(JSON.stringify(data)).not.toMatch(/d0000000|avatar|likes/);
  });
});
