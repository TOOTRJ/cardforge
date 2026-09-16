import { describe, expect, it } from "vitest";
import {
  DISCOVER_SEED_MINUTES,
  discoverSeedNow,
  discoverWeight,
  normalizeDiscoverSeed,
} from "@/lib/cards/discover";

describe("discoverWeight", () => {
  it("gives every card a floor weight of 1 so nothing is unreachable", () => {
    expect(discoverWeight({ views: 0, likes: 0, shares: 0, remixes: 0 })).toBe(1);
  });
  it("ranks engagement remixes > shares > likes > views and log-dampens it", () => {
    const one = (k: "views" | "likes" | "shares" | "remixes") =>
      discoverWeight({ views: 0, likes: 0, shares: 0, remixes: 0, [k]: 1 });
    expect(one("remixes")).toBeGreaterThan(one("shares"));
    expect(one("shares")).toBeGreaterThan(one("likes"));
    expect(one("likes")).toBeGreaterThan(one("views"));
    // 1,000 likes is ~8× the weight of 1 like, not 1,000× — a viral card
    // leads without owning the page.
    const viral = discoverWeight({ views: 0, likes: 1000, shares: 0, remixes: 0 });
    expect(viral / one("likes")).toBeLessThan(10);
    expect(viral).toBeGreaterThan(one("likes"));
  });
});

describe("discover seed", () => {
  it("changes every few minutes and is stable within the bucket", () => {
    const t = 1_789_000_000_000;
    expect(discoverSeedNow(t)).toBe(discoverSeedNow(t + 1000));
    expect(discoverSeedNow(t)).not.toBe(discoverSeedNow(t + DISCOVER_SEED_MINUTES * 60_000));
  });
  it("only accepts short, plain seeds from the URL", () => {
    expect(normalizeDiscoverSeed("596300")).toBe("596300");
    expect(normalizeDiscoverSeed("abc-DEF_1")).toBe("abc-DEF_1");
    expect(normalizeDiscoverSeed("x'; drop")).toBeNull();
    expect(normalizeDiscoverSeed("")).toBeNull();
    expect(normalizeDiscoverSeed(null)).toBeNull();
  });
});
