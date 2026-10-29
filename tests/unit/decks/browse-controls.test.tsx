// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

// ---------------------------------------------------------------------------
// TODO DK8.5 — /decks/browse's controls (the static /decks landing hosts
// none): the sort (recent / most liked / most viewed), the format chips as
// the shared ChipGroup (one radio group, arrows move, Space / Enter pick),
// and one creator's decks (?owner=, a profile's "See all decks"). Every
// change starts on page 1 and keeps the other params; ?owner= is a browse
// param, so proxy.ts 308s an old /decks?owner= link to the browse route.
// ---------------------------------------------------------------------------

const nav = vi.hoisted(() => ({ replace: vi.fn(), params: new URLSearchParams() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace, push: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/decks/browse",
  useSearchParams: () => nav.params,
}));

import { DecksSearch } from "@/components/decks/decks-search";
import { decksBrowseHref, parseDecksParams } from "@/app/(marketing)/decks/decks-view";
import { DECKS_FILTER_PARAMS, hasAnyParam } from "@/lib/routing/browse-params";

afterEach(() => {
  cleanup();
  nav.replace.mockReset();
  nav.params = new URLSearchParams();
});

describe("DecksSearch", () => {
  it("the formats are ONE radio group; a pick sets ?format= and starts on page 1, keeping ?owner=", () => {
    nav.params = new URLSearchParams("owner=dev_artist&page=3&sort=viewed");
    render(<DecksSearch />);
    const group = screen.getByRole("radiogroup", { name: "Filter by format" });
    expect(group).toBeTruthy();
    expect(screen.getByRole("radio", { name: "All formats" }).getAttribute("aria-checked")).toBe("true");
    act(() => {
      fireEvent.click(screen.getByRole("radio", { name: "Commander" }));
    });
    expect(nav.replace).toHaveBeenCalledWith("/decks/browse?owner=dev_artist&sort=viewed&format=commander", { scroll: false });
  });

  it("'All formats' clears the filter", () => {
    nav.params = new URLSearchParams("format=modern");
    render(<DecksSearch />);
    expect(screen.getByRole("radio", { name: "Modern" }).getAttribute("aria-checked")).toBe("true");
    act(() => {
      fireEvent.click(screen.getByRole("radio", { name: "All formats" }));
    });
    expect(nav.replace).toHaveBeenCalledWith("/decks/browse", { scroll: false });
  });

  it("the sort: most liked / most viewed set ?sort=, recently updated is the bare default", () => {
    nav.params = new URLSearchParams("q=dragons");
    render(<DecksSearch />);
    const sort = screen.getByRole("combobox", { name: "Sort decks" }) as HTMLSelectElement;
    expect(sort.value).toBe("recent");
    act(() => {
      fireEvent.change(sort, { target: { value: "popular" } });
    });
    expect(nav.replace).toHaveBeenLastCalledWith("/decks/browse?q=dragons&sort=popular", { scroll: false });
    cleanup();
    nav.params = new URLSearchParams("sort=popular");
    render(<DecksSearch />);
    act(() => {
      fireEvent.change(screen.getByRole("combobox", { name: "Sort decks" }), { target: { value: "recent" } });
    });
    expect(nav.replace).toHaveBeenLastCalledWith("/decks/browse", { scroll: false });
  });
});

describe("parseDecksParams / decksBrowseHref — one creator's decks", () => {
  it("takes a handle as profiles store it (an @ and capitals forgiven), anything else is no filter", () => {
    expect(parseDecksParams({ owner: "dev_artist" }).owner).toBe("dev_artist");
    expect(parseDecksParams({ owner: "@Dev_Artist" }).owner).toBe("dev_artist");
    expect(parseDecksParams({ owner: "x" }).owner).toBeUndefined();
    expect(parseDecksParams({ owner: "a b; drop" }).owner).toBeUndefined();
    expect(parseDecksParams({}).owner).toBeUndefined();
  });

  it("builds browse links with the defaults left out", () => {
    expect(decksBrowseHref({})).toBe("/decks/browse");
    expect(decksBrowseHref({ sort: "recent", page: 1 })).toBe("/decks/browse");
    expect(decksBrowseHref({ search: "elves", format: "modern", sort: "viewed", owner: "dev_artist", page: 2 })).toBe(
      "/decks/browse?q=elves&format=modern&sort=viewed&owner=dev_artist&page=2",
    );
  });

  it("?owner= is a browse param (a landing link carrying it is 308'd to /decks/browse)", () => {
    expect(DECKS_FILTER_PARAMS).toContain("owner");
    expect(hasAnyParam(new URLSearchParams("owner=dev_artist"), DECKS_FILTER_PARAMS)).toBe(true);
  });
});
