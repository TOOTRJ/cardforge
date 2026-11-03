// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

// ---------------------------------------------------------------------------
// The admin Funnel panel's "Screen widths (last 30 days)" table (TODO WD9):
// bucket, sessions, share — every bucket in width order; an empty window
// says so; a failed read shows the admin load error, never zeros.
// ---------------------------------------------------------------------------

import { FunnelPanel } from "@/components/admin/funnel-panel";
import { buildFunnel, buildScreenWidths, type FunnelSummary } from "@/lib/admin/funnel-queries";

function summary(screenWidths: FunnelSummary["screenWidths"]): FunnelSummary {
  return { windows: [buildFunnel({}, 7), buildFunnel({}, 30)], signupSources: [], trials: [], screenWidths };
}

function widthsBlock(): HTMLElement {
  return screen.getByRole("heading", { name: "Screen widths (last 30 days)" }).parentElement!;
}

afterEach(cleanup);

describe("FunnelPanel — screen widths", () => {
  it("lists bucket, sessions and share for every bucket in width order", () => {
    render(<FunnelPanel summary={summary(buildScreenWidths({ "0-639": 12, "1366-1535": 24, "1920-2559": 4 }))} />);
    const table = within(widthsBlock()).getByRole("table");
    expect(within(table).getAllByRole("columnheader").map((th) => th.textContent)).toEqual([
      "Width (CSS px)",
      "Sessions",
      "Share",
    ]);
    const rows = within(table)
      .getAllByRole("row")
      .slice(1)
      .map((tr) => within(tr).getAllByRole("cell").map((td) => td.textContent));
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

  it("an empty window says nothing was recorded", () => {
    render(<FunnelPanel summary={summary(buildScreenWidths({}))} />);
    expect(within(widthsBlock()).queryByRole("table")).toBeNull();
    expect(within(widthsBlock()).getByText("No screen widths recorded yet.")).toBeTruthy();
  });

  it("a failed read shows the load error — never a table of zeros", () => {
    render(<FunnelPanel summary={summary(null)} />);
    expect(within(widthsBlock()).queryByRole("table")).toBeNull();
    expect(within(widthsBlock()).getByRole("alert").textContent).toContain("Couldn’t load the screen widths.");
  });
});
