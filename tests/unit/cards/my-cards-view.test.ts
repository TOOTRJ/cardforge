import { describe, expect, it } from "vitest";
import {
  filterMyCards,
  parseMyCardsFilter,
  parseMyCardsSort,
  parseMyCardsView,
  sortMyCards,
} from "@/lib/cards/my-cards-view";

type TestCard = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  likes_count: number;
  visibility: "private" | "unlisted" | "public";
  parent_card_id: string | null;
};

const card = (id: string, over: Partial<TestCard> = {}): TestCard => ({
  id,
  title: id,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  likes_count: 0,
  visibility: "private",
  parent_card_id: null,
  ...over,
});

const ids = (cards: TestCard[]) => cards.map((c) => c.id);

describe("My Cards parsers", () => {
  it("accept known values", () => {
    expect(parseMyCardsView("list")).toBe("list");
    expect(parseMyCardsSort("title-desc")).toBe("title-desc");
    expect(parseMyCardsFilter("drafts")).toBe("drafts");
  });

  it("fall back to the defaults on anything else (cookie + URL are user-editable)", () => {
    for (const bad of [undefined, null, "", "LIST", "nope", 3, ["list"], {}]) {
      expect(parseMyCardsView(bad), String(bad)).toBe("grid");
      expect(parseMyCardsSort(bad), String(bad)).toBe("updated");
      expect(parseMyCardsFilter(bad), String(bad)).toBe("all");
    }
  });
});

describe("sortMyCards", () => {
  const a = card("a", {
    title: "Zephyr 2",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-03-01T00:00:00Z",
    likes_count: 1,
  });
  const b = card("b", {
    title: "alpha",
    created_at: "2026-02-01T00:00:00Z",
    updated_at: "2026-02-01T00:00:00Z",
    likes_count: 9,
  });
  const c = card("c", {
    title: "Zephyr 10",
    created_at: "2026-03-01T00:00:00Z",
    updated_at: "2026-03-05T00:00:00Z",
    likes_count: 1,
  });
  const all = [a, b, c];

  it("defaults to most recently edited — a fresh card and a fresh edit both surface", () => {
    expect(ids(sortMyCards(all, "updated"))).toEqual(["c", "a", "b"]);
  });

  it("orders by created date both ways", () => {
    expect(ids(sortMyCards(all, "newest"))).toEqual(["c", "b", "a"]);
    expect(ids(sortMyCards(all, "oldest"))).toEqual(["a", "b", "c"]);
  });

  it("sorts titles case-insensitively with natural numbers", () => {
    expect(ids(sortMyCards(all, "title"))).toEqual(["b", "a", "c"]);
    expect(ids(sortMyCards(all, "title-desc"))).toEqual(["c", "a", "b"]);
  });

  it("breaks like ties by most recently edited", () => {
    expect(ids(sortMyCards(all, "liked"))).toEqual(["b", "c", "a"]);
  });

  it("never mutates the input", () => {
    const input = [a, b, c];
    sortMyCards(input, "title");
    expect(ids(input)).toEqual(["a", "b", "c"]);
  });
});

describe("filterMyCards", () => {
  const cards = [
    card("draft"),
    card("pub", { visibility: "public" }),
    card("link", { visibility: "unlisted" }),
    card("remix", { visibility: "public", parent_card_id: "parent-1" }),
  ];

  it("splits by visibility; drafts are the private cards", () => {
    expect(ids(filterMyCards(cards, "all"))).toEqual(["draft", "pub", "link", "remix"]);
    expect(ids(filterMyCards(cards, "public"))).toEqual(["pub", "remix"]);
    expect(ids(filterMyCards(cards, "unlisted"))).toEqual(["link"]);
    expect(ids(filterMyCards(cards, "drafts"))).toEqual(["draft"]);
  });

  it("remixes are cards with a parent, whatever their visibility", () => {
    expect(ids(filterMyCards(cards, "remixes"))).toEqual(["remix"]);
  });
});
