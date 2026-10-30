// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

// The profile's card filter bar is URL state: a search, a colour, a type or
// an order is ONE router.replace of the profile with that query (page
// dropped), and the server page queries list_profile_cards from it.

const replace = vi.fn();
let search = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  usePathname: () => "/profile/forge",
  useSearchParams: () => new URLSearchParams(search),
}));

import { ProfileCardFilters } from "@/components/profile/profile-card-filters";

beforeEach(() => {
  replace.mockReset();
  search = "";
});
afterEach(cleanup);

describe("ProfileCardFilters", () => {
  it("searches on submit, dropping the page", () => {
    search = "page=3&color=red";
    render(<ProfileCardFilters />);
    const box = screen.getByRole("searchbox", { name: "Search this creator's cards" });
    fireEvent.change(box, { target: { value: " Urza’s Tower " } });
    fireEvent.submit(box.closest("form")!);
    expect(replace).toHaveBeenCalledWith("/profile/forge?color=red&q=Urza%E2%80%99s+Tower", { scroll: false });
  });

  it("filters by type and colour, and orders", () => {
    render(<ProfileCardFilters />);
    fireEvent.change(screen.getByRole("combobox", { name: "Card type" }), { target: { value: "instant" } });
    expect(replace).toHaveBeenLastCalledWith("/profile/forge?type=instant", { scroll: false });
    fireEvent.change(screen.getByRole("combobox", { name: "Order" }), { target: { value: "name" } });
    expect(replace).toHaveBeenLastCalledWith("/profile/forge?sort=name", { scroll: false });
    fireEvent.click(screen.getByRole("radio", { name: /Blue/ }));
    expect(replace).toHaveBeenLastCalledWith("/profile/forge?color=blue", { scroll: false });
  });

  it("clears every filter at once", () => {
    search = "q=bolt&color=red&type=instant&sort=name";
    render(<ProfileCardFilters />);
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(replace).toHaveBeenLastCalledWith("/profile/forge", { scroll: false });
  });
});
