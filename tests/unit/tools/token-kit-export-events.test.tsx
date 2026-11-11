// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

// ---------------------------------------------------------------------------
// How a kit's print / download ENDED, as the tool's analytics see it (the
// 2026-11-10 tools audit). The browser builds the file (DeckExportProvider →
// runKitExport), so no server action sees it finish: the Token Kit's page
// reads the provider's state and records the end ONCE per export through
// trackToolEvent — `kit_export_done` or `kit_export_failed`
// (kitExportOutcome's props: token-kit-events.test.ts). The provider sits at
// the root layout, so a finished export is seen again on every render and
// every return to the page: it is still one event.
// ---------------------------------------------------------------------------

const m = vi.hoisted(() => ({
  track: vi.fn(),
  active: null as null | Record<string, unknown>,
}));

vi.mock("@/lib/tools/track-client", () => ({ trackToolEvent: m.track }));
vi.mock("@/components/decks/deck-export-provider", () => ({
  useDeckExport: () => ({ active: m.active, busy: false, start: vi.fn(), cancel: vi.fn(), openDetails: vi.fn() }),
}));
vi.mock("@/components/billing/upgrade-modal-provider", () => ({ useUpgradeModal: () => ({ open: vi.fn() }) }));
vi.mock("@/components/tools/token-kit/use-kit-art", () => ({ useKitArt: () => ({ busy: {}, upload: vi.fn(), paint: vi.fn() }) }));
vi.mock("@/components/tools/token-kit/kit-source-picker", () => ({ KitSourcePicker: () => null }));
vi.mock("@/components/tools/token-kit/kit-print-dialog", () => ({ KitPrintDialog: () => null }));
vi.mock("@/components/tools/token-kit/kit-settings-panel", () => ({ KitSettingsPanel: () => null }));
vi.mock("@/components/tools/token-kit/kit-token-tile", () => ({ KitTokenTile: () => null }));
vi.mock("@/lib/tools/token-kit/actions", () => ({
  buildTokenKitAction: vi.fn(),
  saveKitTokenToCardsAction: vi.fn(),
  saveTokenKitAction: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { TokenKitWorkspace } from "@/components/tools/token-kit/token-kit-workspace";

let nextId = 1;
/** One export's state as the provider holds it (a new object per tick). */
const exportState = (id: number, over: Record<string, unknown>) => ({
  id,
  kind: "pdf",
  subject: "kit",
  deckTitle: "My secret kit",
  status: "rendering",
  total: 9,
  done: 0,
  failed: [],
  startedAt: 1_000,
  completions: [],
  finishedAt: null,
  error: null,
  file: null,
  ...over,
});
const page = () => <TokenKitWorkspace decks={[]} recent={[]} verifiedKeys={[]} cleanDownloads />;
const tracked = () => m.track.mock.calls.map(([slug, event, props]) => [slug, event, props]);

beforeEach(() => {
  m.track.mockReset();
  m.track.mockReturnValue(undefined);
  m.active = null;
});

afterEach(() => cleanup());

describe("a kit export's end", () => {
  it("is recorded once — not while it runs, not again on a later render or a return to the page", async () => {
    const id = nextId++;
    const view = render(page());
    expect(m.track).not.toHaveBeenCalled();

    m.active = exportState(id, { status: "rendering", done: 4 });
    view.rerender(page());
    m.active = exportState(id, { status: "packaging", done: 9 });
    view.rerender(page());
    expect(m.track).not.toHaveBeenCalled();

    const finished = { status: "done", done: 9, failed: ["Secret Goblin"], finishedAt: 31_000, file: { url: "blob:x", name: "my-secret-kit.pdf", bytes: 2_097_152, cards: 8 } };
    m.active = exportState(id, finished);
    view.rerender(page());
    expect(tracked()).toEqual([["token-kit", "kit_export_done", { kind: "pdf", tokens: 9, rendered: 8, failed: 1, kb: 2048, ms: 30_000 }]]);

    // The same finished export, seen again: a re-render, then a new visit.
    m.active = exportState(id, finished);
    view.rerender(page());
    view.unmount();
    render(page());
    expect(m.track).toHaveBeenCalledTimes(1);
    // Counts and a file kind: never the kit's, a token's or the file's name.
    expect(JSON.stringify(m.track.mock.calls)).not.toMatch(/secret/i);
  });

  it("a cancelled and a broken export are `kit_export_failed` with why; the next export is its own event", async () => {
    const first = nextId++;
    m.active = exportState(first, { kind: "zip", status: "cancelled", done: 3, finishedAt: 5_000 });
    const view = render(page());
    expect(tracked()).toEqual([["token-kit", "kit_export_failed", { reason: "cancelled", kind: "zip", tokens: 9, rendered: 3, failed: 0, ms: 4_000 }]]);

    const second = nextId++;
    m.active = exportState(second, { status: "failed", done: 9, failed: Array.from({ length: 9 }, () => "Secret Goblin"), finishedAt: 2_500, error: "None of the tokens could be rendered." });
    view.rerender(page());
    expect(tracked()[1]).toEqual(["token-kit", "kit_export_failed", { reason: "error", kind: "pdf", tokens: 9, rendered: 0, failed: 9, ms: 1_500 }]);
    expect(m.track).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(m.track.mock.calls)).not.toMatch(/Secret|None of the tokens/);
  });

  it("another page's export (a deck, a card selection) is not the Token Kit's to record", async () => {
    m.active = exportState(nextId++, { subject: "deck", status: "done", finishedAt: 9_000, file: { url: "blob:x", name: "deck.zip", bytes: 10, cards: 60 } });
    const view = render(page());
    m.active = exportState(nextId++, { subject: "cards", status: "failed", finishedAt: 9_000 });
    view.rerender(page());
    expect(m.track).not.toHaveBeenCalled();
  });
});
