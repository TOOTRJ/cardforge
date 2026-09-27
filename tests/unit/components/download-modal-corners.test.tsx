// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";

// ---------------------------------------------------------------------------
// The download modal's Rounded / Square switch (TODO 3.26, owner decision
// 2026-09-27): EVERY viewer — free included — picks the PNG's corner.
// Rounded is the default (the card as the gallery shows it); the link always
// names the corner, because the png route's own default is square (older
// callers). The hint is tier-aware: only a paid viewer has the PDF.
// ---------------------------------------------------------------------------

vi.mock("@/components/billing/upgrade-modal-provider", () => ({ useUpgradeModal: () => ({ open: vi.fn() }) }));
vi.mock("@/lib/analytics/funnel-client", () => ({ trackFunnelEvent: vi.fn() }));

import { DownloadModal } from "@/components/cards/download-modal";

afterEach(cleanup);

async function open(isPaid: boolean) {
  render(<DownloadModal cardId="c1" cardSlug="grizzly" isPaid={isPaid} canBatch={isPaid} defaultTab="png" />);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /download/i }));
  });
}

/** The PNG tab's download link (free: "Download free PNG"; paid: "Download"). */
function pngLink(): HTMLAnchorElement {
  const links = screen
    .getAllByRole("link")
    .filter((a) => (a.getAttribute("href") ?? "").includes("/png?")) as HTMLAnchorElement[];
  expect(links).toHaveLength(1);
  return links[0];
}

async function choose(label: "Rounded" | "Square") {
  const group = within(screen.getByTestId("download-corners")).getByRole("radiogroup", { name: "Corners" });
  await act(async () => {
    fireEvent.click(within(group).getByRole("radio", { name: label }));
  });
}

describe("DownloadModal corners switch", () => {
  it.each([false, true])("isPaid=%s: Rounded by default, named in the link", async (isPaid) => {
    await open(isPaid);
    const group = within(screen.getByTestId("download-corners")).getByRole("radiogroup", { name: "Corners" });
    expect(within(group).getByRole("radio", { name: "Rounded" }).getAttribute("aria-checked")).toBe("true");
    expect(within(group).getByRole("radio", { name: "Square" }).getAttribute("aria-checked")).toBe("false");
    const link = pngLink();
    expect(link.getAttribute("href")).toBe(
      `/api/cards/c1/png?preset=${isPaid ? "hd" : "default"}&corners=round`,
    );
    expect(link.getAttribute("download")).toBe("grizzly.png");
  });

  it.each([false, true])("isPaid=%s: Square switches the link and the file name", async (isPaid) => {
    await open(isPaid);
    await choose("Square");
    const link = pngLink();
    expect(link.getAttribute("href")).toBe(
      `/api/cards/c1/png?preset=${isPaid ? "hd" : "default"}&corners=square`,
    );
    expect(link.getAttribute("download")).toBe("grizzly-square.png");
    await choose("Rounded");
    expect(pngLink().getAttribute("href")).toContain("corners=round");
  });

  it("tier-aware hint: free viewers are pointed at Square, paid viewers also at the PDF", async () => {
    await open(false);
    const free = screen.getByTestId("download-corners").textContent ?? "";
    expect(free).toContain("Rounded for sharing; choose Square to print.");
    expect(free).not.toMatch(/PDF/);
    cleanup();
    await open(true);
    expect(screen.getByTestId("download-corners").textContent).toMatch(/Square \(or the PDF\) to print/);
  });
});
