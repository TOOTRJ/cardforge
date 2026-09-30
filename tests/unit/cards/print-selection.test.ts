import { afterEach, describe, expect, it, vi } from "vitest";
import {
  budgetCopies,
  DEFAULT_PRINT_SELECTION_SETTINGS,
  loadPrintSelectionSettings,
  MAX_SELECTION_CARDS,
  MAX_SELECTION_COPIES,
  parsePrintSelectionSettings,
  PRINT_SELECTION_SETTINGS_KEY,
  savePrintSelectionSettings,
  selectionExportFilename,
  selectionManifestRequestSchema,
} from "@/lib/cards/print-selection";

// ---------------------------------------------------------------------------
// TODO 6.15 — "Print / download selected": the copies budget the manifest
// route and the dialog share, the remembered settings, the file names.
// ---------------------------------------------------------------------------

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("budgetCopies", () => {
  it("keeps what fits, in order", () => {
    expect(budgetCopies([{ id: id(1), copies: 4 }, { id: id(2), copies: 1 }])).toEqual([
      { id: id(1), copies: 4 },
      { id: id(2), copies: 1 },
    ]);
  });

  it("never passes the physical cap, and never drops a card for the copies of one before it", () => {
    const out = budgetCopies([
      { id: id(1), copies: 99 },
      { id: id(2), copies: 99 },
      { id: id(3), copies: 1 },
    ]);
    expect(out.map((c) => c.copies)).toEqual([99, MAX_SELECTION_COPIES - 99 - 1, 1]);
    expect(out.reduce((n, c) => n + c.copies, 0)).toBe(MAX_SELECTION_COPIES);
  });

  it("folds a repeated id into its first entry and keeps the first 150 unique cards", () => {
    expect(budgetCopies([{ id: id(1), copies: 2 }, { id: id(1), copies: 3 }])).toEqual([{ id: id(1), copies: 5 }]);
    const many = Array.from({ length: MAX_SELECTION_CARDS + 5 }, (_, i) => ({ id: id(i), copies: 1 }));
    const out = budgetCopies(many);
    expect(out).toHaveLength(MAX_SELECTION_CARDS);
    expect(out.at(-1)?.id).toBe(id(MAX_SELECTION_CARDS - 1));
  });
});

describe("selectionManifestRequestSchema", () => {
  it("takes 1–150 uuid ids with 1–99 copies", () => {
    expect(selectionManifestRequestSchema.safeParse({ cards: [{ id: id(1), copies: 2 }] }).success).toBe(true);
    for (const bad of [
      { cards: [] },
      { cards: [{ id: "nope", copies: 1 }] },
      { cards: [{ id: id(1), copies: 0 }] },
      { cards: [{ id: id(1), copies: 100 }] },
      { cards: Array.from({ length: 151 }, (_, i) => ({ id: id(i), copies: 1 })) },
      null,
    ]) {
      expect(selectionManifestRequestSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe("the remembered settings", () => {
  it("parses field by field — a stale or foreign value falls back to its default, the rest is kept", () => {
    expect(parsePrintSelectionSettings(null)).toEqual(DEFAULT_PRINT_SELECTION_SETTINGS);
    expect(
      parsePrintSelectionSettings({ kind: "zip", layout: "sheet-a4", gap: "huge", marks: "lines", bleed: "yes", quality: "default" }),
    ).toEqual({
      ...DEFAULT_PRINT_SELECTION_SETTINGS,
      kind: "zip",
      layout: "sheet-a4",
      marks: "lines",
      quality: "default",
    });
  });

  it("keeps MakePlayingCards as a ZIP image size (TODO 6.1)", () => {
    expect(parsePrintSelectionSettings({ kind: "zip", quality: "mpc" })).toEqual({
      ...DEFAULT_PRINT_SELECTION_SETTINGS,
      kind: "zip",
      quality: "mpc",
    });
  });

  it("round-trips through localStorage", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    });
    const settings = { ...DEFAULT_PRINT_SELECTION_SETTINGS, layout: "sheet-a4" as const, gap: "sixteenth" as const, bleed: true };
    savePrintSelectionSettings(settings);
    expect(JSON.parse(store.get(PRINT_SELECTION_SETTINGS_KEY)!)).toEqual(settings);
    expect(loadPrintSelectionSettings()).toEqual(settings);
  });

  it("falls back to the defaults when storage throws or holds junk (private windows, previews)", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceeded");
      },
    });
    expect(loadPrintSelectionSettings()).toEqual(DEFAULT_PRINT_SELECTION_SETTINGS);
    expect(() => savePrintSelectionSettings(DEFAULT_PRINT_SELECTION_SETTINGS)).not.toThrow();

    vi.stubGlobal("localStorage", { getItem: () => "{not json", setItem: () => {} });
    expect(loadPrintSelectionSettings()).toEqual(DEFAULT_PRINT_SELECTION_SETTINGS);
  });
});

describe("selectionExportFilename", () => {
  const one = [{ slug: "stone-matriarch" }];
  const twelve = Array.from({ length: 12 }, (_, i) => ({ slug: `c${i}` }));
  it.each([
    [one, { kind: "pdf", layout: "sheet-letter", bleed: false }, "stone-matriarch-sheets.pdf"],
    [twelve, { kind: "pdf", layout: "sheet-a4", bleed: true }, "pipglyph-12-cards-sheets-a4-bleed.pdf"],
    [twelve, { kind: "pdf", layout: "pages", bleed: false }, "pipglyph-12-cards.pdf"],
    [twelve, { kind: "zip", layout: "sheet-letter", bleed: true }, "pipglyph-12-cards-bleed.zip"],
    [one, { kind: "zip", layout: "pages", bleed: false }, "stone-matriarch.zip"],
    [twelve, { kind: "zip", layout: "pages", bleed: false, quality: "mpc" }, "pipglyph-12-cards-mpc.zip"],
    [one, { kind: "zip", layout: "pages", bleed: false, quality: "mpc" }, "stone-matriarch-mpc.zip"],
    // A PDF is never MPC's (MPC takes images).
    [one, { kind: "pdf", layout: "pages", bleed: false, quality: "mpc" }, "stone-matriarch.pdf"],
  ] as const)("%j %j → %s", (cards, opts, name) => {
    expect(selectionExportFilename(cards, opts)).toBe(name);
  });
});
