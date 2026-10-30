import { describe, expect, it } from "vitest";
import {
  isFilteredProfileView,
  parseProfileCardParams,
  profileCardsHref,
} from "@/lib/profile/card-params";

// The profile page's card section reads its state from the query string:
// unknown values read as unset (never reach the database), any set value is
// a filtered view (noindex), and the pager keeps every filter.

describe("parseProfileCardParams", () => {
  it("reads known values and drops the rest", () => {
    expect(parseProfileCardParams({ q: "  Urza’s ", color: "red", type: "instant", sort: "popular", page: "3" })).toEqual({
      q: "Urza’s",
      color: "red",
      type: "instant",
      sort: "popular",
      page: 3,
    });
    expect(parseProfileCardParams({ color: "purple", type: "plane", sort: "random", page: "-2" })).toEqual({
      q: "",
      color: null,
      type: null,
      sort: "recent",
      page: 1,
    });
    expect(parseProfileCardParams({ q: ["a", "b"], page: "abc" })).toMatchObject({ q: "a", page: 1 });
    expect(parseProfileCardParams({ q: "x".repeat(400) }).q).toHaveLength(150);
  });

  it("calls any set value a filtered view", () => {
    expect(isFilteredProfileView(parseProfileCardParams({}))).toBe(false);
    for (const raw of [{ q: "bolt" }, { color: "blue" }, { type: "land" }, { sort: "name" }, { page: "2" }]) {
      expect(isFilteredProfileView(parseProfileCardParams(raw)), JSON.stringify(raw)).toBe(true);
    }
  });
});

describe("profileCardsHref", () => {
  it("keeps the filters, sets the page, and lands on the cards", () => {
    const params = parseProfileCardParams({ q: "fire & ice", color: "red", sort: "name" });
    expect(profileCardsHref("forge", params, 2)).toBe("/profile/forge?q=fire+%26+ice&color=red&sort=name&page=2#cards");
    expect(profileCardsHref("forge", params, 1)).toBe("/profile/forge?q=fire+%26+ice&color=red&sort=name#cards");
    expect(profileCardsHref("forge", parseProfileCardParams({}), 1)).toBe("/profile/forge#cards");
  });
});
