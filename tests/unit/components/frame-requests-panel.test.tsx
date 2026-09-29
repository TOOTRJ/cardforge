// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

// ---------------------------------------------------------------------------
// The /admin/frame-requests panel (TODO 1.6): the most-requested missing
// frames first, the window chips, the art flags (1.18), a Scryfall sample
// link, and the families PipGlyph will never build collapsed below.
// ---------------------------------------------------------------------------

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { FrameRequestsPanel } from "@/components/admin/frame-requests-panel";
import type { FrameRequestRow, FrameRequestSummary } from "@/lib/frames/frame-request-queries";

const NOW = Date.parse("2026-09-28T12:00:00.000Z");

function row(overrides: Partial<FrameRequestRow>): FrameRequestRow {
  return {
    signature: "borderless/standard+crown",
    label: "Borderless frame",
    setCode: "dmu",
    status: "nearest",
    count: 3,
    users: 2,
    lastSeen: "2026-09-28T09:00:00.000Z",
    template: "m15",
    templateLabel: "M15 (2015) Standard",
    artFlags: ["window-cropped"],
    sampleCollector: "435",
    sampleScryfallId: "8df6603a-38c1-4d18-8b84-6211e9a7cc09",
    sampleUrl: "https://scryfall.com/card/dmu/435",
    blockedBy: "4.6",
    forGood: false,
    ...overrides,
  };
}

function summary(overrides: Partial<FrameRequestSummary> = {}): FrameRequestSummary {
  const rows = overrides.rows ?? [
    row({}),
    row({
      signature: "future",
      label: "Future Sight frame",
      setCode: "fut",
      status: "unsupported",
      count: 1,
      users: 1,
      artFlags: [],
      sampleCollector: "18",
      sampleUrl: "https://scryfall.com/card/fut/18",
      blockedBy: "4.15",
    }),
    row({
      signature: "borderless/poster",
      label: "Artist-lettered borderless poster",
      setCode: "spg",
      status: "unsupported",
      count: 2,
      artFlags: ["frame-in-crop"],
      forGood: true,
      blockedBy: null,
    }),
  ];
  return {
    window: "30",
    rows,
    totalRequests: rows.reduce((sum, r) => sum + r.count, 0),
    error: null,
    ...overrides,
  };
}

afterEach(cleanup);

describe("FrameRequestsPanel", () => {
  it("lists the missing frames with count, users, landed frame, art flags and a Scryfall sample", () => {
    render(<FrameRequestsPanel summary={summary()} now={NOW} />);
    const table = screen.getByRole("table", { name: "Most-requested missing frames" });
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(3); // header + two open rows

    const sheoldred = rows[1];
    expect(sheoldred.textContent).toContain("Borderless frame");
    expect(sheoldred.textContent).toContain("borderless/standard+crown");
    expect(sheoldred.textContent).toContain("TODO 4.6");
    expect(sheoldred.textContent).toContain("dmu");
    expect(sheoldred.textContent).toContain("nearest");
    expect(sheoldred.textContent).toContain("3h ago");
    expect(sheoldred.textContent).toContain("M15 (2015) Standard");
    expect(sheoldred.textContent).toContain("window-cropped");
    const sample = within(sheoldred).getByRole("link", { name: /DMU #435/ });
    expect(sample.getAttribute("href")).toBe("https://scryfall.com/card/dmu/435");
    expect(sample.getAttribute("target")).toBe("_blank");
    expect(sample.getAttribute("rel")).toBe("noopener noreferrer");

    expect(rows[2].textContent).toContain("Future Sight frame");
    expect(rows[2].textContent).toContain("unsupported");
    // The open rows only: a family PipGlyph won't build isn't a missing frame.
    expect(screen.getByText(/4 requests for 2 missing frames/)).toBeTruthy();
  });

  it("collapses the families PipGlyph will never build", () => {
    const { container } = render(<FrameRequestsPanel summary={summary()} now={NOW} />);
    const details = container.querySelector("details");
    expect(details).not.toBeNull();
    expect(details!.open).toBe(false);
    expect(details!.querySelector("summary")?.textContent).toMatch(/Unsupported for good \(2 requests, 1 row\)/);
    expect(within(details as HTMLElement).getByText("Artist-lettered borderless poster")).toBeTruthy();
    expect(within(details as HTMLElement).getByText("frame in crop")).toBeTruthy();
  });

  it("marks the current window and links the others", () => {
    render(<FrameRequestsPanel summary={summary({ window: "90" })} now={NOW} />);
    const nav = screen.getByRole("navigation", { name: "Window" });
    expect(within(nav).getByRole("link", { name: "90 days" }).getAttribute("aria-current")).toBe("page");
    expect(within(nav).getByRole("link", { name: "30 days" }).getAttribute("href")).toBe("/admin/frame-requests");
    expect(within(nav).getByRole("link", { name: "All time" }).getAttribute("href")).toBe("/admin/frame-requests?window=all");
  });

  it("shows an empty state, and the reason when the log couldn't be read", () => {
    render(
      <FrameRequestsPanel
        summary={summary({ rows: [], error: "Couldn't read the request log (is migration 0123 applied here?)." })}
        now={NOW}
      />,
    );
    expect(screen.getByText("No requests in this window")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toMatch(/migration 0123/);
    expect(screen.queryByRole("table")).toBeNull();
  });
});
