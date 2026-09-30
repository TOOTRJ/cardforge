// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";

// ---------------------------------------------------------------------------
// TODO 6.15 — the single-card download modal's PDF tab takes the sheet
// options of My Cards' selection export: Layout One card / Sheet of copies
// (Pro), the paper (US Letter / A4), spacing, cut guides, card size and the
// 1/8″ bleed — the link asks /api/cards/[id]/pdf for exactly that (a bleed
// sheet included, which the route used to refuse). The options start from
// the settings this browser printed with last (shared with the selection
// export and the deck export) and are saved on download; the layout always
// opens on One card. The old "3×3 Letter" / "3×3 A4" tabs are gone.
// ---------------------------------------------------------------------------

const upgrade = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock("@/components/billing/upgrade-modal-provider", () => ({ useUpgradeModal: () => upgrade }));
vi.mock("@/lib/analytics/funnel-client", () => ({ trackFunnelEvent: vi.fn() }));

import { DownloadModal } from "@/components/cards/download-modal";
import { PRINT_SELECTION_SETTINGS_KEY } from "@/lib/cards/print-selection";

// An in-memory localStorage (Node's own global one needs a backing file).
const storage = new Map<string, string>();
beforeEach(() => {
  storage.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, value),
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
  upgrade.open.mockReset();
});

async function click(el: HTMLElement) {
  await act(async () => {
    fireEvent.click(el);
  });
}

async function open({ isPaid = true, canBatch = true } = {}) {
  render(<DownloadModal cardId="c1" cardSlug="grizzly" isPaid={isPaid} canBatch={canBatch} defaultTab="single" />);
  await click(screen.getByRole("button", { name: /download/i }));
}

function pdfLink(): HTMLAnchorElement {
  const links = screen
    .getAllByRole("link")
    .filter((a) => (a.getAttribute("href") ?? "").includes("/pdf?")) as HTMLAnchorElement[];
  expect(links).toHaveLength(1);
  return links[0];
}

function chip(group: string, label: string | RegExp): HTMLButtonElement {
  return within(screen.getByRole("radiogroup", { name: group })).getByRole("radio", { name: label }) as HTMLButtonElement;
}

describe("DownloadModal PDF tab — the print sheet options (Pro)", () => {
  it("has one PDF tab (no 3×3 tabs) that opens on One card", async () => {
    await open();
    expect(screen.queryByRole("tab", { name: /3×3/ })).toBeNull();
    expect(chip("PDF layout", "One card").getAttribute("aria-checked")).toBe("true");
    expect(pdfLink().getAttribute("href")).toBe("/api/cards/c1/pdf?layout=card");
    expect(screen.queryByTestId("sheet-options")).toBeNull();
  });

  it("a Sheet of copies with no options is the old 3 × 3 Letter link", async () => {
    await open();
    await click(chip("PDF layout", "Sheet of copies"));
    const a = pdfLink();
    expect(a.getAttribute("href")).toBe("/api/cards/c1/pdf?layout=sheet&paper=letter");
    expect(a.getAttribute("download")).toBe("grizzly-sheet.pdf");
    expect(screen.getByText(/^9 copies of this card on a US Letter/)).toBeTruthy();
  });

  it("every option reaches the link — paper, spacing, guides, size and the bleed (a bleed sheet prints landscape)", async () => {
    await open();
    await click(chip("PDF layout", "Sheet of copies"));
    await click(chip("Paper", "A4"));
    await click(chip("Spacing", "1/16″ gap"));
    await click(chip("Cut guides", "Full-length lines"));
    await click(chip("Card size", "63 × 88 mm"));
    expect(pdfLink().getAttribute("href")).toBe(
      "/api/cards/c1/pdf?layout=sheet&paper=a4&gap=sixteenth&marks=lines&size=mm",
    );
    await click(screen.getByTestId("download-pdf-bleed"));
    const a = pdfLink();
    expect(a.getAttribute("href")).toBe(
      "/api/cards/c1/pdf?layout=sheet&paper=a4&gap=sixteenth&marks=lines&size=mm&bleed=1",
    );
    expect(a.getAttribute("download")).toBe("grizzly-sheet-a4-bleed.pdf");
    expect(screen.getByText(/copies of this card on an A4 \(210 × 297 mm\) page, printed landscape/)).toBeTruthy();
  });

  it("starts from the settings this browser printed with last, and saves them on download", async () => {
    storage.set(
      PRINT_SELECTION_SETTINGS_KEY,
      JSON.stringify({ kind: "pdf", layout: "sheet-a4", gap: "sixteenth", marks: "lines", cardSize: "in", bleed: true, quality: "hd" }),
    );
    await open();
    // The layout opens on One card, with the remembered bleed.
    expect(pdfLink().getAttribute("href")).toBe("/api/cards/c1/pdf?layout=card&bleed=1");
    await click(chip("PDF layout", "Sheet of copies"));
    expect(chip("Paper", "A4").getAttribute("aria-checked")).toBe("true");
    expect(pdfLink().getAttribute("href")).toBe("/api/cards/c1/pdf?layout=sheet&paper=a4&gap=sixteenth&marks=lines&bleed=1");

    await click(chip("Paper", "US Letter"));
    await click(chip("Cut guides", "Corner marks"));
    // The anchor's own navigation is the browser's; the click saves first.
    await click(pdfLink());
    expect(JSON.parse(storage.get(PRINT_SELECTION_SETTINGS_KEY)!)).toMatchObject({
      layout: "sheet-letter",
      gap: "sixteenth",
      marks: "corners",
      cardSize: "in",
      bleed: true,
    });
  });

  it("One card downloads remember the bleed but keep the remembered paper", async () => {
    storage.set(PRINT_SELECTION_SETTINGS_KEY, JSON.stringify({ layout: "sheet-a4", bleed: false }));
    await open();
    await click(screen.getByTestId("download-pdf-bleed"));
    await click(pdfLink());
    expect(JSON.parse(storage.get(PRINT_SELECTION_SETTINGS_KEY)!)).toMatchObject({ layout: "sheet-a4", bleed: true });
  });
});

describe("DownloadModal PDF tab — below Pro", () => {
  it("Plus: the Sheet choice is shown but disabled, with a way to Pro; the one-card PDF (and its bleed) stays", async () => {
    storage.set(PRINT_SELECTION_SETTINGS_KEY, JSON.stringify({ layout: "sheet-letter", bleed: false }));
    await open({ isPaid: true, canBatch: false });
    expect(chip("PDF layout", "Sheet of copies").disabled).toBe(true);
    expect(chip("PDF layout", "One card").getAttribute("aria-checked")).toBe("true");
    expect(pdfLink().getAttribute("href")).toBe("/api/cards/c1/pdf?layout=card");
    expect(screen.getByText("Print sheets are a Pro feature.")).toBeTruthy();
    await click(screen.getByRole("button", { name: "See Pro" }));
    expect(upgrade.open).toHaveBeenCalledWith("batch_export");
    await click(screen.getByTestId("download-pdf-bleed"));
    expect(pdfLink().getAttribute("href")).toBe("/api/cards/c1/pdf?layout=card&bleed=1");
  });

  it("free: the PDF tab stays locked and the modal opens on the Image tab", async () => {
    await open({ isPaid: false, canBatch: false });
    expect((screen.getByRole("tab", { name: /pdf/i }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByTestId("download-pdf-options")).toBeNull();
    expect(screen.getByText("PDF is a Plus feature; print sheets are Pro.")).toBeTruthy();
  });
});
