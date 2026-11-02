// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Suspense } from "react";
import { AnnounceProfileCards, ProfileCardsLiveRegion } from "@/components/profile/profile-cards-live-region";

// The profile's card results sit in a Suspense keyed on the filters, so a
// live region inside it would be a new element on every search (never
// announced). The region lives outside it, mounted once; each results view
// hands it its line.

afterEach(cleanup);

function View({ filterKey, text }: { filterKey: string; text: string }) {
  return (
    <ProfileCardsLiveRegion>
      <Suspense key={filterKey} fallback={null}>
        <p>results</p>
        <AnnounceProfileCards filterKey={filterKey} text={text} />
      </Suspense>
    </ProfileCardsLiveRegion>
  );
}

describe("ProfileCardsLiveRegion", () => {
  it("is one persistent status region outside the keyed boundary, announcing each new view", () => {
    const { rerender } = render(<View filterKey="||||1" text="Showing 1–24 of 50" />);
    const region = screen.getByRole("status");
    expect(region.getAttribute("aria-live")).toBe("polite");
    // The page as it loaded is not announced.
    expect(region.textContent).toBe("");

    rerender(<View filterKey="bolt||||1" text="3 cards match" />);
    expect(screen.getByRole("status")).toBe(region);
    expect(region.textContent?.trim()).toBe("3 cards match");

    // The same words for NEW filters are still new text to a screen reader.
    const before = region.textContent;
    rerender(<View filterKey="bolt|red|||1" text="3 cards match" />);
    expect(screen.getByRole("status")).toBe(region);
    expect(region.textContent?.trim()).toBe("3 cards match");
    expect(region.textContent).not.toBe(before);

    rerender(<View filterKey="zzz||||1" text="No cards match these filters." />);
    expect(region.textContent?.trim()).toBe("No cards match these filters.");
  });
});
