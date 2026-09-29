// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

// ---------------------------------------------------------------------------
// The /admin/frame-requests panel (TODO 1.6): two groups — "Missing frames"
// and "Not yet verified" (D1) — each most distinct users first (D4), the
// window chips, the art flags (1.18), a Scryfall sample link, a flag on a
// signature the registry doesn't know (D6), and the families PipGlyph will
// never build collapsed below.
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
    cause: "missing",
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
    inRegistry: true,
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
    row({
      signature: "showcase/thb/constellation",
      label: "Theros Beyond Death constellation showcase",
      setCode: "thb",
      cause: "unverified",
      count: 1,
      users: 1,
      artFlags: [],
      sampleCollector: "259",
      sampleUrl: "https://scryfall.com/card/thb/259",
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
  it("lists the missing frames with users, count, landed frame, art flags and a Scryfall sample", () => {
    render(<FrameRequestsPanel summary={summary()} now={NOW} />);
    const table = screen.getByRole("table", { name: "Missing frames" });
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(3); // header + two missing rows

    // Users is the sort key (D4): it comes before Requests and says so.
    const headers = within(rows[0]).getAllByRole("columnheader").map((th) => th.textContent);
    expect(headers.indexOf("Users")).toBe(headers.indexOf("Requests") - 1);
    expect(within(rows[0]).getByRole("columnheader", { name: "Users" }).getAttribute("aria-sort")).toBe(
      "descending",
    );
    // …and each cell sits under its own header (2 users, 3 requests).
    const cells = within(rows[1]).getAllByRole("cell").map((td) => td.textContent);
    expect(cells[headers.indexOf("Users")]).toBe("2");
    expect(cells[headers.indexOf("Requests")]).toBe("3");

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
    // The missing rows only: a family PipGlyph won't build isn't a missing
    // frame, and an unverified one isn't missing.
    expect(screen.getByText("4 requests for 2 missing frames")).toBeTruthy();
    expect(screen.queryByText("not in registry")).toBeNull();
  });

  it("splits the exact frames waiting for verification into their own group (D1)", () => {
    render(<FrameRequestsPanel summary={summary()} now={NOW} />);
    const missing = screen.getByRole("region", { name: "Missing frames" });
    const unverified = screen.getByRole("region", { name: "Not yet verified" });
    expect(within(missing).queryByText(/Theros Beyond Death/)).toBeNull();

    const table = within(unverified).getByRole("table", { name: "Not yet verified" });
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(2);
    expect(rows[1].getAttribute("data-cause")).toBe("unverified");
    expect(rows[1].textContent).toContain("Theros Beyond Death constellation showcase");
    expect(within(unverified).getByText("1 request for 1 unverified frame")).toBeTruthy();
    expect(within(unverified).getByRole("link", { name: "Frame compare" }).getAttribute("href")).toBe(
      "/admin/frame-compare",
    );
  });

  it("keeps each group's order as given — users first, from the summary (D4)", () => {
    const rows = [
      row({ signature: "japan-showcase", label: "Japan showcase", setCode: "dsk", users: 2, count: 2 }),
      row({ users: 0, count: 5 }),
    ];
    render(<FrameRequestsPanel summary={summary({ rows })} now={NOW} />);
    const table = screen.getByRole("table", { name: "Missing frames" });
    const labels = within(table)
      .getAllByRole("row")
      .slice(1)
      .map((tr) => tr.getAttribute("data-signature"));
    expect(labels).toEqual(["japan-showcase", "borderless/standard+crown"]);
  });

  it("says when a group is empty in this window", () => {
    render(<FrameRequestsPanel summary={summary({ rows: [row({})] })} now={NOW} />);
    const unverified = screen.getByRole("region", { name: "Not yet verified" });
    expect(within(unverified).getByText("None in this window.")).toBeTruthy();
    expect(within(unverified).queryByRole("table")).toBeNull();
    expect(within(unverified).getByText("0 requests for 0 unverified frames")).toBeTruthy();
  });

  it("flags a signature the registry doesn't know (D6)", () => {
    const rows = [
      row({}),
      row({
        signature: "retired/seed-example",
        label: "Retired rule (seeded example)",
        setCode: null,
        inRegistry: false,
        blockedBy: null,
        sampleUrl: null,
      }),
    ];
    render(<FrameRequestsPanel summary={summary({ rows })} now={NOW} />);
    const table = screen.getByRole("table", { name: "Missing frames" });
    const retired = within(table)
      .getAllByRole("row")
      .find((tr) => tr.getAttribute("data-signature") === "retired/seed-example")!;
    const flag = within(retired).getByText("not in registry");
    expect(flag.getAttribute("title")).toMatch(/No rule in lib\/scryfall\/frame-signatures\.ts has this key/);
    expect(screen.getAllByText("not in registry")).toHaveLength(1);
    expect(
      screen.getByText("1 row carries a signature the registry doesn’t know — flagged “not in registry” below."),
    ).toBeTruthy();
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
    expect(screen.queryByRole("region")).toBeNull();
  });
});
