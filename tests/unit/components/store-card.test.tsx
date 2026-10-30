// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { StoreCard } from "@/components/profile/store-card";
import type { ProfileStore } from "@/lib/profile/store-platforms";

// A profile's store card (migration 0153): one link out to the store, its
// platform named as text (no brand logo), the maker's title or the
// platform's blurb, a "Visit store" call to action, user-generated rel and a
// new tab said in its name.

afterEach(cleanup);

const store = (patch: Partial<ProfileStore> = {}): ProfileStore => ({
  id: "s1",
  platform: "ebay",
  url: "https://www.ebay.com/str/forgecards",
  title: "Graded foils & sealed",
  position: 0,
  ...patch,
});

describe("StoreCard", () => {
  it("is one link to the store, nofollow / ugc, in a new tab", () => {
    render(<StoreCard store={store()} />);
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe("https://www.ebay.com/str/forgecards");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")?.split(" ").sort()).toEqual(["nofollow", "noopener", "ugc"]);
    expect(link.textContent).toContain("Graded foils & sealed");
    expect(link.textContent).toContain("Visit store");
    expect(link.textContent).toContain("eBay");
    expect(link.textContent).toContain("opens in a new tab");
    expect(link.textContent).toContain("www.ebay.com/str/forgecards");
    // No brand artwork: the only images are decorative icons.
    expect(link.querySelector("img")).toBeNull();
  });

  it("uses the platform's blurb when the maker left no title", () => {
    render(<StoreCard store={store({ platform: "whatnot", url: "https://www.whatnot.com/user/forge", title: null })} />);
    expect(screen.getByRole("link").textContent).toContain("Live breaks and auctions on Whatnot");
  });

  it("draws nothing for a platform it doesn't know", () => {
    const { container } = render(<StoreCard store={store({ platform: "gone" as ProfileStore["platform"] })} />);
    expect(container.innerHTML).toBe("");
  });
});
