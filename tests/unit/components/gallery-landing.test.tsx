// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TrendingRangeSwitch } from "@/components/gallery/trending-range-switch";
import { TRENDING_RANGES, type TrendingRange } from "@/lib/cards/trending";

// ---------------------------------------------------------------------------
// The gallery landing's top (owner 2026-11-03): "Hot this month" by default
// with a Week / Month / Year / All time switch, the title and the search on
// one row, card types and tags on one compact bar, no "Forge your own".
//   * the switch: a tablist named for the period, Month picked, its heading
//     "Hot this month"; a tab (click or arrow key) shows its own row and
//     heading; only the picked panel is mounted;
//   * the landing stays ISR: it reads no searchParams, every range's row
//     comes from ONE cached read set, and the switch is a client island over
//     server-rendered rows.
// ---------------------------------------------------------------------------

afterEach(cleanup);

const panels = Object.fromEntries(
  TRENDING_RANGES.map((range) => [range, <p key={range}>{`${range} row`}</p>]),
) as Record<TrendingRange, React.ReactNode>;

function renderSwitch() {
  return render(
    <section aria-labelledby="trending-heading">
      <TrendingRangeSwitch
        headingId="trending-heading"
        eyebrow={<span>Trending now</span>}
        panels={panels}
        defaultRange="month"
      />
    </section>,
  );
}

describe("TrendingRangeSwitch", () => {
  it("opens on the month: its tab picked, its heading, its row alone", () => {
    renderSwitch();
    expect(screen.getByRole("tablist", { name: "Trending period" })).toBeTruthy();
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Week", "Month", "Year", "All time"]);
    expect(screen.getByRole("tab", { name: "Month" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Hot this month");
    expect(screen.getByRole("region", { name: "Hot this month" })).toBeTruthy();
    expect(screen.getByText("month row")).toBeTruthy();
    expect(screen.queryByText("week row")).toBeNull();
  });

  it("a click on a tab shows that range's row and heading", () => {
    renderSwitch();
    fireEvent.click(screen.getByRole("tab", { name: "Week" }));
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Hot this week");
    expect(screen.getByText("week row")).toBeTruthy();
    expect(screen.queryByText("month row")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "All time" }));
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Hottest of all time");
  });

  it("the line under the heading follows the tab: decay only where there is one", () => {
    renderSwitch();
    expect(screen.getByText(/the most recent count most/)).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "All time" }));
    expect(screen.queryByText(/the most recent count most/)).toBeNull();
    expect(screen.getByText(/old and new count the same/)).toBeTruthy();
  });

  it("is one tab stop; the arrow keys move along the tabs", () => {
    renderSwitch();
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.getAttribute("tabindex"))).toEqual(["-1", "0", "-1", "-1"]);
    fireEvent.keyDown(screen.getByRole("tab", { name: "Month" }), { key: "ArrowRight" });
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Year" }));
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Hot this year");
    fireEvent.keyDown(screen.getByRole("tab", { name: "Year" }), { key: "Home" });
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Hot this week");
  });
});

describe("the /gallery landing's source", () => {
  const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");
  const view = read("app/(marketing)/gallery/gallery-view.tsx");
  const landing = view.slice(view.indexOf("export function GalleryLanding"), view.indexOf("export function GalleryBrowse"));
  const trending = view.slice(view.indexOf("async function GalleryTrending"), view.indexOf("async function GalleryNewest"));

  it("stays ISR: the page reads no searchParams and revalidates", () => {
    const page = read("app/(marketing)/gallery/page.tsx");
    expect(page).toMatch(/export const revalidate = \d+/);
    expect(page).toContain("export default function GalleryPage() {");
    expect(landing).not.toMatch(/cookies\(|headers\(/);
    expect(landing).toContain("parseGalleryFilters({})");
  });

  it("puts the title and the search on one header row, with no Forge your own", () => {
    expect(landing).not.toMatch(/Forge your own|PageHeader/);
    // The row is the shared BrowseLandingHeader (/decks wears it too, DK8.9).
    expect(landing).toMatch(/<BrowseLandingHeader[\s\S]*title="Community gallery"[\s\S]*browsePath=\{GALLERY_BROWSE_PATH\}/);
    const header = read("components/browse/browse-landing-header.tsx");
    expect(header).toMatch(/md:flex-row[\s\S]*<h1[\s\S]*<BrowseSearchBox[\s\S]*compact/);
    expect(header).not.toMatch(/eyebrow/i);
  });

  it("draws the hubs as the compact bar", () => {
    expect(landing).toContain('<HubLinks placement="top" />');
    const hubs = read("components/cards/hub-links.tsx");
    expect(hubs).toMatch(/lg:grid-cols-2/);
    // The bar's group is the shared CompactChipGroup (/decks' formats wear it).
    expect(hubs).toContain("<CompactChipGroup");
    const group = read("components/browse/compact-chip-group.tsx");
    expect(group).toMatch(/overflow-x-auto[\s\S]*lg:flex-wrap/);
    // Each chip list is named for its group ("Card types", "Popular tags").
    expect(group).toMatch(/<ul\s+aria-label=\{label\}/);
  });

  it("reads every range in ONE call and opens on the month (the next range with cards when it has none)", () => {
    expect(trending).toMatch(/listTrendingCardsByRange\(\{ limit: ROW_MAX, anonymous: true \}\)/);
    expect(trending).toContain("trendingOpeningOrder(DEFAULT_TRENDING_RANGE).find(");
    expect(trending).toMatch(/defaultRange=\{opening\}/);
    expect(trending).toMatch(/priority=\{range === opening\}/);
    expect(trending).toMatch(/aria-labelledby="trending-heading"[\s\S]*headingId="trending-heading"/);
  });

  it("the trending decks row is compact and opens on the year, not the cards' month (DK8.9)", () => {
    expect(landing).toContain('<DeckRowSkeleton variant="compact" />');
    expect(landing).toMatch(/<TrendingDecksRow[\s\S]*description=\{\(period\) =>/);
    // Cards stay on the month.
    expect(trending).not.toContain("DEFAULT_DECK_TRENDING_RANGE");
  });
});
