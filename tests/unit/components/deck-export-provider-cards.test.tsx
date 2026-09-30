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
    expect(toast.message).toHaveBeenCalledWith("Building your card ZIP in the background", expect.anything());
    expect(screen.getByRole("status").textContent).toContain("Card ZIP ready");
    expect(toast.success).toHaveBeenCalledWith("Stone Matriarch — card ZIP ready", expect.anything());
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
