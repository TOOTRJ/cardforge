import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DISCOVER_BIG_DECK_BOOST,
  DISCOVER_BIG_DECK_CARDS,
  deckDiscoverWeight,
} from "@/lib/decks/discover";

// ---------------------------------------------------------------------------
// /decks "Discover" (migration 0167, list_discover_decks): the owner's rule —
// a deck of 10 or more cards comes up more often than a smaller one — and
// the gallery's engagement boost, in the gallery's weighted draw. The SQL
// is the ranking; `deckDiscoverWeight` mirrors it, and this holds the two
// together and shows the draw does what the rule says.
// ---------------------------------------------------------------------------

const dir = join(process.cwd(), "supabase/migrations");
const file = readdirSync(dir).find((f) => /^\d{4}_featured_deck_themes\.sql$/.test(f));
const sql = file ? readFileSync(join(dir, file), "utf8") : "";
const body = sql
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");
const discover = body.slice(body.indexOf("function public.list_discover_decks"));

describe("deckDiscoverWeight mirrors list_discover_decks", () => {
  it("the SQL's size step and engagement weights are the module's", () => {
    expect(discover).toContain(
      `(case when d.card_count >= ${DISCOVER_BIG_DECK_CARDS} then ${DISCOVER_BIG_DECK_BOOST.toFixed(1)} else 1.0 end)`,
    );
    expect(discover).toContain("* (1.0 + 2.0 * ln(1.0 + 0.05 * d.view_count + 1.0 * d.likes_count))");
  });

  it("10 cards is big, 9 is not; the boost is ×3 at equal engagement", () => {
    const small = deckDiscoverWeight({ cards: 9, views: 0, likes: 0 });
    const big = deckDiscoverWeight({ cards: 10, views: 0, likes: 0 });
    expect(small).toBe(1);
    expect(big).toBe(3);
    expect(deckDiscoverWeight({ cards: 60, views: 40, likes: 3 }) / deckDiscoverWeight({ cards: 5, views: 40, likes: 3 })).toBe(3);
  });

  it("likes and views raise the weight, damped; every deck stays at least 1", () => {
    const quiet = deckDiscoverWeight({ cards: 12, views: 0, likes: 0 });
    const liked = deckDiscoverWeight({ cards: 12, views: 0, likes: 10 });
    const viral = deckDiscoverWeight({ cards: 12, views: 0, likes: 1000 });
    expect(liked).toBeGreaterThan(quiet);
    expect(viral).toBeGreaterThan(liked);
    expect(viral / quiet).toBeLessThan(20);
    expect(deckDiscoverWeight({ cards: 1, views: -5, likes: 0 })).toBe(1);
  });

  it("in the draw, big decks take the first slots far more often than their share", () => {
    // Efraimidis–Spirakis with a seeded PRNG: 100 decks, 10 of them big.
    let state = 42;
    const random = () => {
      state = (state * 1664525 + 1013904223) % 2 ** 32;
      return (state + 0.5) / 2 ** 32;
    };
    const decks = Array.from({ length: 100 }, (_, i) => ({ big: i < 10, weight: deckDiscoverWeight({ cards: i < 10 ? 20 : 4, views: 0, likes: 0 }) }));
    let bigInTop8 = 0;
    const rounds = 2000;
    for (let round = 0; round < rounds; round++) {
      const top = decks
        .map((deck) => ({ deck, key: -Math.log(random()) / deck.weight }))
        .sort((a, b) => a.key - b.key)
        .slice(0, 8);
      bigInTop8 += top.filter((entry) => entry.deck.big).length;
    }
    const share = bigInTop8 / (rounds * 8);
    // A plain shuffle gives 10 %; ×3 gives about a quarter.
    expect(share).toBeGreaterThan(0.2);
    expect(share).toBeLessThan(0.3);
  });
});
