// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";

// ---------------------------------------------------------------------------
// The download modal's PRINT options (TODO 6.1a bleed, 6.1b 800 ppi, 6.1
// MakePlayingCards): a paid viewer picks the resolution (600 ppi = 1500 ×
// 2100, 800 ppi = 2000 × 2800) and the Bleed — None, 1/8″, or
// MakePlayingCards (MPC's poker-size file, 1644 × 2244 at 600 ppi) — on the
// Image tab, and the 1/8″ bleed on the single-card PDF. Any print option is
// a square PNG: the link asks the png route for
// `ppi=…&corners=square(&bleed=1|mpc)`, names <slug>-800ppi(-bleed|-mpc).png, and
// Rounded and JPEG are disabled while one is on (the print options while
// JPEG is). 800 ppi says the frame is upscaled — every template's is today
// (lib/cards/print-export.ts PRINT_NATIVE_800_TEMPLATES). A free viewer
// sees none of it (800 ppi is paid-only while PRINT_800_PPI_PAID_ONLY).
// ---------------------------------------------------------------------------

vi.mock("@/components/billing/upgrade-modal-provider", () => ({ useUpgradeModal: () => ({ open: vi.fn() }) }));
// The ONE 6.1b switch, flipped per test (the [decide]'s other answer).
const flags = vi.hoisted(() => ({ paidOnly: true }));
vi.mock("@/lib/cards/print-export", async (orig) => ({
  ...(await orig<typeof import("@/lib/cards/print-export")>()),
  get PRINT_800_PPI_PAID_ONLY() {
    return flags.paidOnly;
  },
}));
vi.mock("@/lib/analytics/funnel-client", () => ({ trackFunnelEvent: vi.fn() }));

import { DownloadModal } from "@/components/cards/download-modal";

afterEach(() => {
  cleanup();
  flags.paidOnly = true;
});

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

const bleedChip = (label: RegExp) =>
  within(within(screen.getByTestId("download-bleed")).getByRole("radiogroup", { name: "Bleed" })).getByRole("radio", {
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
    expect(bleedChip(/^None$/).getAttribute("aria-checked")).toBe("true");
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

  it("the 1/8″ bleed adds &bleed=1 at either resolution", async () => {
    await open(true);
    await click(bleedChip(/1\/8″/));
    expect(link("/png?").getAttribute("href")).toBe("/api/cards/c1/png?ppi=600&corners=square&bleed=1");
    expect(link("/png?").getAttribute("download")).toBe("grizzly-bleed.png");
    expect(screen.getByText(/1650 × 2250 render/)).toBeTruthy();
    await click(resolution(/800 ppi/));
    expect(link("/png?").getAttribute("href")).toBe("/api/cards/c1/png?ppi=800&corners=square&bleed=1");
    expect(link("/png?").getAttribute("download")).toBe("grizzly-800ppi-bleed.png");
    // No bleed, and back at 600: the plain link again, with the corner the
    // viewer had.
    await click(bleedChip(/^None$/));
    await click(resolution(/600 ppi/));
    expect(link("/png?").getAttribute("href")).toBe("/api/cards/c1/png?preset=hd&corners=round");
  });

  it("MakePlayingCards (TODO 6.1): MPC's poker-size file — &bleed=mpc, <slug>-mpc.png, 1644 × 2244 (2192 × 2992 at 800)", async () => {
    await open(true);
    await click(bleedChip(/makeplayingcards/i));
    const a = link("/png?");
    expect(a.getAttribute("href")).toBe("/api/cards/c1/png?ppi=600&corners=square&bleed=mpc");
    expect(a.getAttribute("download")).toBe("grizzly-mpc.png");
    expect(screen.getByText("PNG for MakePlayingCards")).toBeTruthy();
    expect(screen.getByText(/^Clean 1644 × 2244 render/)).toBeTruthy();
    expect(screen.getByText(/822 × 1122 at 300 dpi, here at 600\): the card \(1500 × 2100 at the trim\) plus MPC's bleed, 72 px on every side/)).toBeTruthy();
    expect(screen.getByText(/A Battle or Split is turned onto MPC's portrait card, its title up the left edge\./)).toBeTruthy();
    // Print: square, PNG only.
    expect(radio("download-corners", "Corners", "Square").getAttribute("aria-checked")).toBe("true");
    expect((radio("download-format", "File type", "JPEG") as HTMLButtonElement).disabled).toBe(true);
    await click(resolution(/800 ppi/));
    expect(link("/png?").getAttribute("href")).toBe("/api/cards/c1/png?ppi=800&corners=square&bleed=mpc");
    expect(link("/png?").getAttribute("download")).toBe("grizzly-800ppi-mpc.png");
    expect(screen.getByText(/^Clean 2192 × 2992 render/)).toBeTruthy();
    // The 1/8″ bleed is the other choice, not an addition.
    await click(bleedChip(/1\/8″/));
    expect(link("/png?").getAttribute("href")).toBe("/api/cards/c1/png?ppi=800&corners=square&bleed=1");
  });

  it("JPEG turns the print options off (PNG only)", async () => {
    await open(true);
    await click(radio("download-format", "File type", "JPEG"));
    expect((bleedChip(/makeplayingcards/i) as HTMLButtonElement).disabled).toBe(true);
    expect((bleedChip(/1\/8″/) as HTMLButtonElement).disabled).toBe(true);
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

describe("DownloadModal print options — PRINT_800_PPI_PAID_ONLY off (the 6.1b [decide]'s other answer)", () => {
  it("a free viewer gets the 800 ppi choice with the mark, never the bleed, and the copy says what the file is", async () => {
    flags.paidOnly = false;
    await open(false);
    expect(screen.getByTestId("download-print")).toBeTruthy();
    expect(screen.queryByTestId("download-bleed")).toBeNull();
    expect(screen.queryByTestId("download-pdf-bleed")).toBeNull();
    await click(resolution(/800 ppi/));
    const a = link("/png?");
    expect(a.getAttribute("href")).toBe("/api/cards/c1/png?ppi=800&corners=square");
    expect(a.getAttribute("download")).toBe("grizzly-800ppi.png");
    expect(screen.getByText(/^2000 × 2800 \(800 ppi\) with the PipGlyph mark/)).toBeTruthy();
    expect(screen.queryByText(/750 × 1050/)).toBeNull();
  });
});
