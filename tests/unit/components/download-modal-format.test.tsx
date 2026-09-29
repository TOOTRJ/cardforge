// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";

// ---------------------------------------------------------------------------
// The download modal's PNG / JPEG choice (TODO 6.18), for EVERY viewer. PNG
// is the default and keeps its Rounded / Square switch; a JPEG has no
// transparency, so choosing it shows Square with Rounded disabled, links to
// `format=jpeg` (no corner — the route always squares it) and saves
// <slug>.jpg. Switching back to PNG restores the corner the viewer had
// picked. The same tier rules: free = 750 px ("Download free JPEG"), paid =
// the clean HD panel.
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

/** The Image tab's one download link. */
function imageLink(): HTMLAnchorElement {
  const links = screen
    .getAllByRole("link")
    .filter((a) => (a.getAttribute("href") ?? "").includes("/png?")) as HTMLAnchorElement[];
  expect(links).toHaveLength(1);
  return links[0];
}

function radio(group: "File type" | "Corners", label: string): HTMLElement {
  const testId = group === "File type" ? "download-format" : "download-corners";
  const radios = within(screen.getByTestId(testId)).getByRole("radiogroup", { name: group });
  return within(radios).getByRole("radio", { name: label });
}

async function click(el: HTMLElement) {
  await act(async () => {
    fireEvent.click(el);
  });
}

describe("DownloadModal file type", () => {
  it.each([false, true])("isPaid=%s: PNG by default, JPEG switches the link, the file name and the corner", async (isPaid) => {
    await open(isPaid);
    const preset = isPaid ? "hd" : "default";
    expect(radio("File type", "PNG").getAttribute("aria-checked")).toBe("true");
    expect(radio("File type", "JPEG").getAttribute("aria-checked")).toBe("false");
    expect(imageLink().getAttribute("href")).toBe(`/api/cards/c1/png?preset=${preset}&corners=round`);

    await click(radio("File type", "JPEG"));
    const link = imageLink();
    expect(link.getAttribute("href")).toBe(`/api/cards/c1/png?preset=${preset}&format=jpeg`);
    expect(link.getAttribute("download")).toBe("grizzly.jpg");
    // Always square: Square shown checked, Rounded not selectable.
    expect(radio("Corners", "Square").getAttribute("aria-checked")).toBe("true");
    expect(radio("Corners", "Rounded").getAttribute("aria-checked")).toBe("false");
    expect((radio("Corners", "Rounded") as HTMLButtonElement).disabled).toBe(true);
    await click(radio("Corners", "Rounded"));
    expect(imageLink().getAttribute("href")).toBe(`/api/cards/c1/png?preset=${preset}&format=jpeg`);
    expect(screen.getByTestId("download-corners").textContent).toContain("JPEG has no transparency");
  });

  it("switching back to PNG restores the corner the viewer picked", async () => {
    await open(false);
    await click(radio("File type", "JPEG"));
    await click(radio("File type", "PNG"));
    expect(imageLink().getAttribute("href")).toBe("/api/cards/c1/png?preset=default&corners=round");
    expect(imageLink().getAttribute("download")).toBe("grizzly.png");
    await click(radio("Corners", "Square"));
    await click(radio("File type", "JPEG"));
    await click(radio("File type", "PNG"));
    expect(imageLink().getAttribute("href")).toBe("/api/cards/c1/png?preset=default&corners=square");
    expect(imageLink().getAttribute("download")).toBe("grizzly-square.png");
  });

  it("names the format on the free button and the paid panel", async () => {
    await open(false);
    expect(imageLink().textContent).toMatch(/Download free PNG/);
    expect(screen.getByRole("heading", { name: "Low-resolution PNG" })).toBeTruthy();
    await click(radio("File type", "JPEG"));
    expect(imageLink().textContent).toMatch(/Download free JPEG/);
    expect(screen.getByRole("heading", { name: "Low-resolution JPEG" })).toBeTruthy();
    cleanup();
    await open(true);
    expect(screen.getByRole("heading", { name: "High-resolution PNG" })).toBeTruthy();
    await click(radio("File type", "JPEG"));
    expect(screen.getByRole("heading", { name: "High-resolution JPEG" })).toBeTruthy();
  });
});
