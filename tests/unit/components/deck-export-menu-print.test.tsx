// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";

// ---------------------------------------------------------------------------
// TODO 6.15 — the Pro deck export's Print PDF takes the print options of My
// Cards' selection export: the layout (one per page / sheets on Letter or
// A4), spacing, cut guides, card size and the 1/8″ bleed. They start from
// the settings this browser used last (the same stored settings as the
// selection export and the download modal) and are saved when a build
// starts; the exporter gets them all. The ZIP never asks for the bleed.
// ---------------------------------------------------------------------------

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }));
vi.mock("@/components/billing/upgrade-modal-provider", () => ({ useUpgradeModal: () => ({ open: vi.fn() }) }));
const exporter = vi.hoisted(() => ({ busy: false, start: vi.fn(), cancel: vi.fn(), openDetails: vi.fn(), active: null }));
vi.mock("@/components/decks/deck-export-provider", () => ({ useDeckExport: () => exporter }));

import { DeckExportMenu } from "@/components/decks/deck-export-menu";
import { PRINT_SELECTION_SETTINGS_KEY } from "@/lib/cards/print-selection";

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
  exporter.start.mockReset();
});

async function click(el: HTMLElement) {
  await act(async () => {
    fireEvent.click(el);
  });
}

async function openMenu() {
  render(
    <DeckExportMenu
      deckId="d1"
      deckSlug="gorgon-gaze"
      arenaText=""
      plainText=""
      allowBatchExport
      customCardCount={12}
      realCardCount={0}
      hasCover={false}
    />,
  );
  await click(screen.getByRole("button", { name: /export/i }));
}

const chip = (group: string, label: string) =>
  within(screen.getByRole("radiogroup", { name: group })).getByRole("radio", { name: label });
const layoutTile = (label: string) => screen.getByRole("radio", { name: new RegExp(`^${label}`) });

describe("DeckExportMenu — the print options (TODO 6.15)", () => {
  it("sheets show the options; a build sends the layout, the options and the bleed, and remembers them", async () => {
    await openMenu();
    await click(layoutTile("One per page"));
    expect(screen.queryByTestId("sheet-options")).toBeNull();
    await click(layoutTile("Sheets · A4"));
    expect(screen.getByTestId("sheet-options")).toBeTruthy();
    await click(chip("Spacing", "1/16″ gap"));
    await click(chip("Cut guides", "Full-length lines"));
    await click(chip("Card size", "63 × 88 mm"));
    await click(screen.getByTestId("deck-export-bleed"));
    // The tile says what fits: A4 with a bleed turns landscape.
    expect(layoutTile("Sheets · A4").closest("label")?.textContent).toMatch(/per sheet \(landscape page\) with full-length lines/);

    await click(screen.getByRole("button", { name: /build pdf/i }));
    expect(exporter.start).toHaveBeenCalledWith({
      deckId: "d1",
      kind: "pdf",
      quality: "hd",
      layout: "sheet-a4",
      sheet: { gap: "sixteenth", marks: "lines", cardSize: "mm" },
      bleed: true,
    });
    expect(JSON.parse(storage.get(PRINT_SELECTION_SETTINGS_KEY)!)).toMatchObject({
      kind: "pdf",
      layout: "sheet-a4",
      gap: "sixteenth",
      marks: "lines",
      cardSize: "mm",
      bleed: true,
    });
  });

  it("opens on the settings this browser used last (the selection export's)", async () => {
    storage.set(
      PRINT_SELECTION_SETTINGS_KEY,
      JSON.stringify({ kind: "zip", layout: "sheet-letter", gap: "none", marks: "lines", cardSize: "in", bleed: true, quality: "default" }),
    );
    await openMenu();
    expect((layoutTile("Sheets · Letter") as HTMLInputElement).checked).toBe(true);
    expect(chip("Cut guides", "Full-length lines").getAttribute("aria-checked")).toBe("true");
    expect((screen.getByTestId("deck-export-bleed") as HTMLInputElement).checked).toBe(true);
    // Letter with a bleed: 3 × 2, landscape.
    expect(layoutTile("Sheets · Letter").closest("label")?.textContent).toMatch(/6 per sheet \(landscape page\)/);
  });

  it("the ZIP's images can be MakePlayingCards' files (TODO 6.1) — shared with the selection export", async () => {
    storage.set(PRINT_SELECTION_SETTINGS_KEY, JSON.stringify({ kind: "zip", quality: "mpc", bleed: true }));
    await openMenu();
    const mpc = screen.getByRole("radio", { name: /^MakePlayingCards/ }) as HTMLInputElement;
    expect(mpc.checked).toBe(true);
    expect(mpc.closest("label")?.textContent).toMatch(/1644 × 2244/);
    await click(screen.getByRole("radio", { name: /^HD/ }));
    expect(mpc.checked).toBe(false);
    await click(mpc);
    await click(screen.getByRole("button", { name: /build zip/i }));
    expect(exporter.start).toHaveBeenCalledWith(expect.objectContaining({ kind: "zip", quality: "mpc", bleed: false }));
    expect(JSON.parse(storage.get(PRINT_SELECTION_SETTINGS_KEY)!)).toMatchObject({ kind: "zip", quality: "mpc" });
  });

  it("the ZIP never carries the bleed (a PDF option), and keeps its image size", async () => {
    storage.set(PRINT_SELECTION_SETTINGS_KEY, JSON.stringify({ layout: "pages", bleed: true, quality: "default" }));
    await openMenu();
    await click(screen.getByRole("button", { name: /build zip/i }));
    expect(exporter.start).toHaveBeenCalledWith(expect.objectContaining({ kind: "zip", quality: "default", bleed: false }));
  });
});
