import { describe, expect, it } from "vitest";
import {
  USER_LIST_PAGE_SIZE,
  parseUserListParams,
  totalPages,
  userListHref,
} from "@/lib/admin/users-params";

describe("parseUserListParams", () => {
  it("applies defaults and rejects unknown filter values", () => {
    expect(parseUserListParams({})).toEqual({
      q: "",
      tier: "",
      status: "",
      flag: "",
      sort: "newest",
      page: 1,
    });
    expect(parseUserListParams({ tier: "gold", sort: "loudest", flag: "x", page: "-3" })).toMatchObject({
      tier: "",
      sort: "newest",
      flag: "",
      page: 1,
    });
  });

  it("accepts valid values, trims and caps the query, clamps the page", () => {
    expect(
      parseUserListParams({ q: "  red ", tier: "pro", status: "active", flag: "mismatch", sort: "cards", page: "3" }),
    ).toEqual({ q: "red", tier: "pro", status: "active", flag: "mismatch", sort: "cards", page: 3 });
    expect(parseUserListParams({ q: "x".repeat(500) }).q).toHaveLength(120);
    expect(parseUserListParams({ page: "999999" }).page).toBe(10_000);
    expect(parseUserListParams({ page: ["2", "5"] }).page).toBe(2);
  });
});

describe("userListHref", () => {
  const base = parseUserListParams({ q: "red", tier: "pro", sort: "cards", page: "3" });
  it("omits defaults and resets the page when a filter changes", () => {
    expect(userListHref(base, { page: 3 })).toBe("/admin/users?q=red&tier=pro&sort=cards&page=3");
    expect(userListHref(base, { tier: "plus" })).toBe("/admin/users?q=red&tier=plus&sort=cards");
    expect(userListHref(parseUserListParams({}))).toBe("/admin/users");
  });
  it("carries extra params such as the selected user", () => {
    expect(userListHref(base, { page: 3 }, { u: "abc" })).toContain("&u=abc");
  });
});

describe("totalPages", () => {
  it("is at least one and rounds up", () => {
    expect(totalPages(0)).toBe(1);
    expect(totalPages(USER_LIST_PAGE_SIZE)).toBe(1);
    expect(totalPages(USER_LIST_PAGE_SIZE + 1)).toBe(2);
  });
});
