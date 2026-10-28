// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";

// ---------------------------------------------------------------------------
// TODO 6.15 — the background exporter (DeckExportProvider) also runs My
// Cards' selection exports: a request with `cards` goes to runCardsExport
// (a deck request still to runDeckExport), the progress card says "Card
// ZIP", not "Deck ZIP", and an UPGRADE_REQUIRED answer opens the
// batch-export upgrade modal rather than the deck one.
// ---------------------------------------------------------------------------

const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), message: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
const upgrade = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock("@/components/billing/upgrade-modal-provider", () => ({ useUpgradeModal: () => upgrade }));
vi.mock("@/components/ai/generation-provider", () => ({ useGenerationContext: () => ({ phase: "idle" }) }));

const client = vi.hoisted(() => ({ runCardsExport: vi.fn(), runDeckExport: vi.fn() }));
vi.mock("@/lib/decks/export-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/decks/export-client")>();
  return { ...actual, runCardsExport: client.runCardsExport, runDeckExport: client.runDeckExport };
});

import { DeckExportProvider, useDeckExport, type StartExportRequest } from "@/components/decks/deck-export-provider";
import { DeckExportError } from "@/lib/decks/export-client";

function Starter({ request }: { request: StartExportRequest }) {
  const exporter = useDeckExport();
  return (
    <button type="button" onClick={() => exporter.start(request)}>
      go
    </button>
  );
}

async function run(request: StartExportRequest) {
  render(
    <DeckExportProvider>
      <Starter request={request} />
    </DeckExportProvider>,
  );
  await act(async () => {
    screen.getByRole("button", { name: "go" }).click();
  });
}

const selection: StartExportRequest = {
  cards: [{ id: "c1", copies: 2 }],
  kind: "zip",
  quality: "hd",
  layout: "pages",
  titles: { c1: "Stone Matriarch" },
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("DeckExportProvider — a selection export", () => {
  it("runs runCardsExport (not the deck export) and names the file a Card ZIP", async () => {
    client.runCardsExport.mockResolvedValue({
      blob: new Blob(["zip"]),
      filename: "stone-matriarch.zip",
      cardsIncluded: 1,
      failed: [],
      title: "Stone Matriarch",
    });
    await run(selection);
    expect(client.runCardsExport).toHaveBeenCalledWith(selection, expect.objectContaining({ onProgress: expect.any(Function) }));
    expect(client.runDeckExport).not.toHaveBeenCalled();
    // The progress card shows it; the ready toast says it.
    expect(screen.getByText("Card ZIP ready")).toBeTruthy();
    expect(toast.success).toHaveBeenCalledWith("Stone Matriarch — card ZIP ready", expect.anything());
    // No start toast: the live region says the start (TODO 6.30).
    expect(toast.message).not.toHaveBeenCalled();
  });

  it("an upgrade answer opens the batch-export modal", async () => {
    client.runCardsExport.mockRejectedValue(new DeckExportError("Pro only", "UPGRADE_REQUIRED"));
    await run(selection);
    expect(upgrade.open).toHaveBeenCalledWith("batch_export");
  });

  it("a deck request still goes to the deck export, as a Deck ZIP", async () => {
    client.runDeckExport.mockReturnValue(new Promise(() => {}));
    await run({ deckId: "d1", kind: "zip", quality: "hd", layout: "pages" });
    expect(client.runDeckExport).toHaveBeenCalled();
    expect(client.runCardsExport).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toContain("Building deck ZIP");
  });
});

// TODO 6.30 (+ #628's check): an export that takes long says so, and each
// phase is announced EXACTLY ONCE. The start by one persistent polite live
// region — mounted empty before anything runs, so its first message is
// heard, and never changing on each card's tick — with no start toast; the
// finish (ready with the skipped count, failed, cancelled) by its toast
// alone (Sonner's toaster is a live region of its own), the region silent.
describe("DeckExportProvider — each phase announced once (TODO 6.30)", () => {
  it("is there, empty, before an export — and is the only one", () => {
    render(
      <DeckExportProvider>
        <Starter request={selection} />
      </DeckExportProvider>,
    );
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByRole("status").textContent).toBe("");
    expect(screen.getByRole("status").getAttribute("aria-live")).toBe("polite");
  });

  it("says a running export can take a few minutes, and does not change on each card", async () => {
    let progress: ((p: { phase: string; total: number; done: number; failed: string[]; deckTitle: string }) => void) | null = null;
    client.runDeckExport.mockImplementation((_request, options) => {
      progress = options.onProgress;
      return new Promise(() => {});
    });
    await run({ deckId: "d1", kind: "pdf", quality: "hd", layout: "pages" });
    const said = screen.getByRole("status").textContent;
    expect(said).toBe("Building print PDF. Every card is drawn live at full resolution, so a big export can take a few minutes.");
    await act(async () => {
      progress!({ phase: "rendering", total: 10, done: 3, failed: [], deckTitle: "Mono Red" });
    });
    expect(screen.getByRole("status").textContent).toBe(said);
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });

  it("the start is the region's alone: no start toast", async () => {
    client.runDeckExport.mockReturnValue(new Promise(() => {}));
    await run({ deckId: "d1", kind: "zip", quality: "hd", layout: "pages" });
    expect(screen.getByRole("status").textContent).toMatch(/^Building deck ZIP\. /);
    expect(toast.message).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("ready: ONE toast with the skipped count and the Save file hint; the region falls silent", async () => {
    client.runCardsExport.mockResolvedValue({
      blob: new Blob(["pdf"]),
      filename: "pipglyph-3-cards.pdf",
      cardsIncluded: 1,
      failed: ["Old Draft", "Broken One"],
      title: "3 cards",
    });
    await run({ ...selection, kind: "pdf" });
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith("3 cards — print PDF ready", {
      description: "2 cards were skipped. Check your downloads. If nothing appeared, use Save file on the progress card.",
      duration: 10000,
    });
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("ready with nothing skipped: the hint alone", async () => {
    client.runCardsExport.mockResolvedValue({
      blob: new Blob(["zip"]),
      filename: "stone-matriarch.zip",
      cardsIncluded: 1,
      failed: [],
      title: "Stone Matriarch",
    });
    await run(selection);
    expect(toast.success).toHaveBeenCalledWith("Stone Matriarch — card ZIP ready", {
      description: "Check your downloads. If nothing appeared, use Save file on the progress card.",
      duration: 10000,
    });
  });

  it("failed: ONE error toast in the export's words; the region falls silent", async () => {
    client.runCardsExport.mockRejectedValue(new DeckExportError("None of the cards could be rendered — try again in a moment."));
    await run(selection);
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith("None of the cards could be rendered — try again in a moment.");
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("cancelled: ONE toast; the region falls silent", async () => {
    client.runCardsExport.mockRejectedValue(new DeckExportError("Export cancelled.", "CANCELLED"));
    await run(selection);
    expect(toast.message).toHaveBeenCalledTimes(1);
    expect(toast.message).toHaveBeenCalledWith("Export cancelled.");
    expect(toast.error).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toBe("");
  });
});
