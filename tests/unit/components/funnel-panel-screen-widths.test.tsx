// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

// ---------------------------------------------------------------------------
// The Funnel tab's "Screen widths" table (TODO WD9): bucket, sessions,
// share — every bucket in width order, for the page's period; an empty
// period says so; a failed read shows the admin load error, never zeros.
// ---------------------------------------------------------------------------

vi.mock("next/link", () => ({
  default: (props: { href: string; children: React.ReactNode; scroll?: boolean }) => {
    const rest: Record<string, unknown> = { ...props };
    delete rest.scroll;
    return <a {...rest} />;
  },
}));

import { FunnelPanel } from "@/components/admin/funnel-panel";
import { buildCohort, buildScreenWidths, buildSignupsDaily, type FunnelSummary } from "@/lib/admin/funnel-queries";

function summary(screenWidths: FunnelSummary["screenWidths"]): FunnelSummary {
  return {
    counts: { current: {}, previous: {} },
    cohort: buildCohort([]),
    signups: buildSignupsDaily(["2026-11-09", "2026-11-10"], []),
    signupSources: [],
    signupSurfaces: [],
    cancelReasons: [],
    guestCard: { signups: 0, firstCardsSaved: 0 },
    failed: { signups: false, cancellations: false },
    trials: [],
    screenWidths,
  };
}

function widthsBlock(): HTMLElement {
  return screen.getByRole("heading", { name: "Screen widths" }).closest("section")!;
}

afterEach(cleanup);

describe("FunnelPanel — screen widths", () => {
  it("lists bucket, sessions and share for every bucket in width order", () => {
    render(<FunnelPanel summary={summary(buildScreenWidths({ "0-639": 12, "1366-1535": 24, "1920-2559": 4 }))} days={30} />);
    const table = within(widthsBlock()).getByRole("table");
    expect(within(table).getAllByRole("columnheader").map((th) => th.textContent)).toEqual([
      "Width (CSS px)",
      "Sessions",
      "Share",
    ]);
    const rows = within(table)
      .getAllByRole("row")
      .slice(1)
      .map((tr) => [within(tr).getByRole("rowheader").textContent, ...within(tr).getAllByRole("cell").map((td) => td.textContent)]);
    expect(rows).toEqual([
      ["<640", "12", "30%"],
      ["640–1023", "0", "0%"],
      ["1024–1365", "0", "0%"],
      ["1366–1535", "24", "60%"],
      ["1536–1919", "0", "0%"],
      ["1920–2559", "4", "10%"],
      ["2560+", "0", "0%"],
    ]);
    expect(within(widthsBlock()).getByText(/anonymous count per browser tab session/)).toBeTruthy();
  });

  it("says which period it covers — the page's, not a fixed 30 days", () => {
    render(<FunnelPanel summary={summary(buildScreenWidths({ "0-639": 1 }))} days={90} />);
    expect(within(widthsBlock()).getByText(/in the last 90 days/)).toBeTruthy();
  });

  it("an empty period says nothing was recorded", () => {
    render(<FunnelPanel summary={summary(buildScreenWidths({}))} days={30} />);
    expect(within(widthsBlock()).queryByRole("table")).toBeNull();
    expect(within(widthsBlock()).getByText("No screen widths recorded in this period.")).toBeTruthy();
  });

  it("a failed read shows the load error — never a table of zeros", () => {
    render(<FunnelPanel summary={summary(null)} days={30} />);
    expect(within(widthsBlock()).queryByRole("table")).toBeNull();
    expect(within(widthsBlock()).getByRole("alert").textContent).toContain("Couldn’t load the screen widths.");
  });
});
