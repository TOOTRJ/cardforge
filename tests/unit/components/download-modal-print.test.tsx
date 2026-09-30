// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";

// ---------------------------------------------------------------------------
// The download modal's PRINT options (TODO 6.1a bleed, 6.1b 800 ppi): a paid
// viewer picks the resolution (600 ppi = 1500 × 2100, 800 ppi = 2000 × 2800)
// and a 1/8″ bleed on the Image tab, and the bleed on the single-card PDF.
// Either print option is a square PNG: the link asks the png route for
// `ppi=…&corners=square(&bleed=1)`, names <slug>-800ppi(-bleed).png, and
// Rounded and JPEG are disabled while one is on (the print options while
// JPEG is). 800 ppi says the frame is upscaled — every template's is today
// (lib/cards/print-export.ts PRINT_NATIVE_800_TEMPLATES). A free viewer
// sees none of it (800 ppi is paid-only while PRINT_800_PPI_PAID_ONLY).
// ---------------------------------------------------------------------------

vi.mock("@/components/billing/upgrade-modal-provider", () => ({ useUpgradeModal: () => ({ open: vi.fn() }) }));
vi.mock("@/lib/analytics/funnel-client", () => ({ trackFunnelEvent: vi.fn() }));

import { DownloadModal } from "@/components/cards/download-modal";

afterEach(cleanup);

async function open(isPaid: boolean, defaultTab: "png" | "single" = "png") {
  render(
    <DownloadModal cardId="c1" cardSlug="grizzly" isPaid={isPaid} canBatch={isPaid} defaultTab={defaultTab} frameTemplate="m15" />,
  );
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /download/i }));
  });
}

function link(fragment: string): HTMLAnchorElement {
  const links = screen
    .getAllByRole("link")
    .filter((a) => (a.getAttribute("href") ?? "").includes(fragment)) as HTMLAnchorElement[];
  expect(links).toHaveLength(1);
  return links[0];
}

function radio(testId: string, group: string, label: string): HTMLElement {
  const radios = within(screen.getByTestId(testId)).getByRole("radiogroup", { name: group });
  return within(radios).getByRole("radio", { name: label });
}

const resolution = (label: RegExp) =>
  within(within(screen.getByTestId("download-print")).getByRole("radiogroup", { name: "Resolution" })).getByRole("radio", {
    name: label,
  });

async function click(el: HTMLElement) {
  await act(async () => {
    fireEvent.click(el);
  });
}

describe("DownloadModal print options (paid)", () => {
  it("600 ppi and no bleed by default — the plain HD link, as before", async () => {
    await open(true);
    expect(resolution(/600 ppi/).getAttribute("aria-checked")).toBe("true");
    expect((screen.getByTestId("download-bleed") as HTMLInputElement).checked).toBe(false);
    expect(link("/png?").getAttribute("href")).toBe("/api/cards/c1/png?preset=hd&corners=round");
  });

  it("800 ppi: a square print PNG, <slug>-800ppi.png, and the frame is said to be upscaled", async () => {
    await open(true);
    await click(resolution(/800 ppi/));
    const a = link("/png?");
    expect(a.getAttribute("href")).toBe("/api/cards/c1/png?ppi=800&corners=square");
    expect(a.getAttribute("download")).toBe("grizzly-800ppi.png");
    expect(screen.getByText(/2000 × 2800 render/)).toBeTruthy();
    expect(screen.getByText(/this frame is upscaled from its 600 ppi master/)).toBeTruthy();
    // Print is square and PNG only.
    expect(radio("download-corners", "Corners", "Square").getAttribute("aria-checked")).toBe("true");
    expect((radio("download-corners", "Corners", "Rounded") as HTMLButtonElement).disabled).toBe(true);
    expect((radio("download-format", "File type", "JPEG") as HTMLButtonElement).disabled).toBe(true);
  });

  it("the bleed checkbox adds &bleed=1 at either resolution", async () => {
    await open(true);
    await click(screen.getByTestId("download-bleed"));
    expect(link("/png?").getAttribute("href")).toBe("/api/cards/c1/png?ppi=600&corners=square&bleed=1");
    expect(link("/png?").getAttribute("download")).toBe("grizzly-bleed.png");
    expect(screen.getByText(/1650 × 2250 render/)).toBeTruthy();
    await click(resolution(/800 ppi/));
    expect(link("/png?").getAttribute("href")).toBe("/api/cards/c1/png?ppi=800&corners=square&bleed=1");
    expect(link("/png?").getAttribute("download")).toBe("grizzly-800ppi-bleed.png");
    // Unticked, and back at 600: the plain link again, with the corner the
    // viewer had.
    await click(screen.getByTestId("download-bleed"));
    await click(resolution(/600 ppi/));
    expect(link("/png?").getAttribute("href")).toBe("/api/cards/c1/png?preset=hd&corners=round");
  });

  it("JPEG turns the print options off (PNG only)", async () => {
    await open(true);
    await click(radio("download-format", "File type", "JPEG"));
    expect((screen.getByTestId("download-bleed") as HTMLInputElement).disabled).toBe(true);
    expect((resolution(/800 ppi/) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("800 ppi and bleed are PNG only.")).toBeTruthy();
    expect(link("/png?").getAttribute("href")).toBe("/api/cards/c1/png?preset=hd&format=jpeg");
  });

  it("the single-card PDF takes the bleed too", async () => {
    await open(true, "single");
    expect(link("/pdf?").getAttribute("href")).toBe("/api/cards/c1/pdf?layout=card");
    await click(screen.getByTestId("download-pdf-bleed"));
    const a = link("/pdf?");
    expect(a.getAttribute("href")).toBe("/api/cards/c1/pdf?layout=card&bleed=1");
    expect(a.getAttribute("download")).toBe("grizzly-bleed.pdf");
  });
});

describe("DownloadModal print options (free)", () => {
  it("shows no resolution or bleed choice — the free image stays the one low-resolution download", async () => {
    await open(false);
    expect(screen.queryByTestId("download-print")).toBeNull();
    expect(screen.queryByTestId("download-bleed")).toBeNull();
    expect(screen.queryByTestId("download-pdf-bleed")).toBeNull();
    expect(link("/png?").getAttribute("href")).toBe("/api/cards/c1/png?preset=default&corners=round");
  });
});
