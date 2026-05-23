import { describe, expect, it } from "vitest";
import {
  TRENDING_WEIGHTS,
  sortTrending,
  trendingScore,
  type TrendingRanked,
} from "@/lib/cards/trending";

// ---------------------------------------------------------------------------
// Locks the trending formula and tiebreaker order so a weight change can't
// silently reshuffle the home/gallery rails. If you intentionally change the
// weights, update the constants and these expectations together.
// ---------------------------------------------------------------------------

describe("trendingScore", () => {
  it("sums each signal by its declared weight", () => {
    expect(
      trendingScore({
        likes_7d: 5,
        comments_7d: 3,
        remixes_7d: 2,
        is_fresh: false,
      }),
    ).toBe(
      TRENDING_WEIGHTS.like * 5 +
        TRENDING_WEIGHTS.comment * 3 +
        TRENDING_WEIGHTS.remix * 2,
    );
  });

  it("adds the freshness bonus exactly once when the card is fresh", () => {
    const cold = trendingScore({
      likes_7d: 0,
      comments_7d: 0,
      remixes_7d: 0,
      is_fresh: false,
    });
    const hot = trendingScore({
      likes_7d: 0,
      comments_7d: 0,
      remixes_7d: 0,
      is_fresh: true,
    });
    expect(hot - cold).toBe(TRENDING_WEIGHTS.freshness);
  });

  it("treats a card with no signals and no freshness as zero", () => {
    expect(
      trendingScore({
        likes_7d: 0,
        comments_7d: 0,
        remixes_7d: 0,
        is_fresh: false,
      }),
    ).toBe(0);
  });

  it("ranks remix engagement above bare like engagement of equal count", () => {
    const remixHeavy = trendingScore({
      likes_7d: 0,
      comments_7d: 0,
      remixes_7d: 1,
      is_fresh: false,
    });
    const likeHeavy = trendingScore({
      likes_7d: 1,
      comments_7d: 0,
      remixes_7d: 0,
      is_fresh: false,
    });
    expect(remixHeavy).toBeGreaterThan(likeHeavy);
  });
});

describe("sortTrending", () => {
  type Row = TrendingRanked<{ id: string }>;

  it("sorts higher score first", () => {
    const rows: Row[] = [
      {
        card: { id: "low" },
        score: 2,
        likesTotal: 99,
        createdAt: "2026-05-20T00:00:00Z",
      },
      {
        card: { id: "high" },
        score: 9,
        likesTotal: 1,
        createdAt: "2026-01-01T00:00:00Z",
      },
    ];
    expect(sortTrending(rows).map((r) => r.card.id)).toEqual(["high", "low"]);
  });

  it("breaks score ties by total likes desc", () => {
    const rows: Row[] = [
      {
        card: { id: "few-likes" },
        score: 5,
        likesTotal: 4,
        createdAt: "2026-05-22T00:00:00Z",
      },
      {
        card: { id: "many-likes" },
        score: 5,
        likesTotal: 40,
        createdAt: "2026-05-01T00:00:00Z",
      },
    ];
    expect(sortTrending(rows).map((r) => r.card.id)).toEqual([
      "many-likes",
      "few-likes",
    ]);
  });

  it("breaks score + likes ties by created_at desc", () => {
    const rows: Row[] = [
      {
        card: { id: "old" },
        score: 0,
        likesTotal: 0,
        createdAt: "2026-01-01T00:00:00Z",
      },
      {
        card: { id: "new" },
        score: 0,
        likesTotal: 0,
        createdAt: "2026-05-20T00:00:00Z",
      },
    ];
    expect(sortTrending(rows).map((r) => r.card.id)).toEqual(["new", "old"]);
  });

  it("does not mutate the input array", () => {
    const rows: Row[] = [
      {
        card: { id: "a" },
        score: 1,
        likesTotal: 0,
        createdAt: "2026-05-22T00:00:00Z",
      },
      {
        card: { id: "b" },
        score: 9,
        likesTotal: 0,
        createdAt: "2026-05-22T00:00:00Z",
      },
    ];
    const snapshot = rows.map((r) => r.card.id);
    sortTrending(rows);
    expect(rows.map((r) => r.card.id)).toEqual(snapshot);
  });
});
