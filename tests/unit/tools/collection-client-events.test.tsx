// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { CollectionCard } from "@/lib/tools/collection/card-row";
import type { CommanderDraft } from "@/lib/tools/collection/builder";
import { lastAiDraftKey } from "@/lib/tools/collection/last-ai-draft";

// ---------------------------------------------------------------------------
// The Collection Deck Builder's BROWSER events (the 2026-11-10 tools audit):
// the moments no server action of the tool sees, recorded through
// trackToolEvent — line and card counts only, never a card's name.
//   - an import that STOPPED part-way (`import_stopped`) and one taken up
//     again (`import_resumed`): the server sees chunks, not the stop;
//   - a kept AI draft taken back (`restore_draft`): it lives in this browser.
// Never in the user's way: the chunk is sent before the note of a resume,
// and a tracking call that fails changes nothing.
// ---------------------------------------------------------------------------

const m = vi.hoisted(() => ({
  track: vi.fn(),
  chunk: vi.fn(),
  finish: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("@/lib/tools/track-client", () => ({ trackToolEvent: m.track }));
vi.mock("@/lib/tools/collection/actions", () => ({
  importCollectionChunkAction: m.chunk,
  finishCollectionImportAction: m.finish,
  addToCollectionAction: vi.fn(),
  draftCollectionDeckAction: vi.fn(),
  saveCollectionDeckAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: m.refresh, push: vi.fn() }) }));
vi.mock("@/components/ai/use-leave-warning", () => ({ useLeaveWarning: () => {} }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { CollectionAdd } from "@/components/tools/collection/collection-add";
import { CollectionBuild } from "@/components/tools/collection/collection-build";

const tracked = () => m.track.mock.calls.map(([slug, event, props]) => [slug, event, props]);
/** What the page's status lines say (the import's, and the search's). */
const statusText = () =>
  screen
    .getAllByRole("status")
    .map((el) => el.textContent ?? "")
    .join(" ");

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

// Node's own (flag-less, broken) localStorage shadows happy-dom's: a plain
// in-memory one stands in.
function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  };
}

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset();
  m.track.mockReturnValue(undefined);
  Object.defineProperty(window, "localStorage", { value: memoryStorage(), configurable: true });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ json: async () => ({ ok: false }) })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("an import that stops and goes on", () => {
  const startImport = async () => {
    render(<CollectionAdd stats={{ cards: 0, copies: 0, commanders: 0, cap: 30000 }} />);
    fireEvent.change(screen.getByLabelText("Or paste your list"), { target: { value: "1 Sol Ring\n4 Llanowar Elves\n1 Counterspell" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Import" }));
    });
    await settle();
  };

  it("records the stop with where it stopped, then the resume — line counts, never a line", async () => {
    // A wait too long to sit out: the import stops where it is.
    m.chunk.mockResolvedValueOnce({ ok: false, error: "Scryfall is busy.", retryAfterSeconds: 60 });
    await startImport();
    expect(statusText()).toMatch(/Stopped after 0 of 3 lines/);
    expect(tracked()).toEqual([["collection-builder", "import_stopped", { chunk: 0, lines_done: 0, lines_total: 3 }]]);

    m.chunk.mockResolvedValueOnce({ ok: true, added: 3, updated: 0, matched: 3, unmatched: [], full: false });
    m.finish.mockResolvedValue({ ok: true, removed: 0 });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Continue the import" }));
    });
    await settle();
    expect(tracked()[1]).toEqual(["collection-builder", "import_resumed", { chunk: 0, lines_done: 0, lines_total: 3 }]);
    // The chunk is on its way before the note of the resume: the note
    // queues behind what the user asked for, never ahead of it.
    expect(m.chunk.mock.invocationCallOrder[1]).toBeLessThan(m.track.mock.invocationCallOrder[1]);
    expect(m.finish).toHaveBeenCalledWith(expect.objectContaining({ lines: 3, matched: 3, complete: true }));
    expect(statusText()).toMatch(/Done\. 3 new cards/);
    // The finish is the server's `import` event: nothing more from the browser.
    expect(m.track).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(m.track.mock.calls)).not.toMatch(/Sol Ring|Llanowar|Counterspell/);
  });

  it("an import that runs to the end records nothing from the browser", async () => {
    m.chunk.mockResolvedValue({ ok: true, added: 3, updated: 0, matched: 3, unmatched: [], full: false });
    m.finish.mockResolvedValue({ ok: true, removed: 0 });
    await startImport();
    expect(statusText()).toMatch(/Done\./);
    expect(m.track).not.toHaveBeenCalled();
  });

  it("an import that stops offers Continue", async () => {
    m.chunk.mockResolvedValueOnce({ ok: false, error: "Scryfall is busy.", retryAfterSeconds: 60 });
    await startImport();
    expect(screen.getByRole("button", { name: "Continue the import" })).toBeTruthy();
  });
});

describe("a kept AI draft taken back", () => {
  function commander(i: number): CollectionCard {
    return {
      id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      scryfallId: `10000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      name: `Secret Commander ${i}`,
      typeLine: "Legendary Creature — Goblin",
      manaCost: "{2}{R}",
      manaValue: 3,
      colorIdentity: ["R"],
      oracleText: null,
      rarity: "rare",
      setCode: "tst",
      setName: "Test",
      collectorNumber: String(i),
      imageUrl: null,
      quantity: 1,
      finish: "nonfoil",
      lang: "en",
      commanderLegal: true,
      canBeCommander: true,
    };
  }
  const COMMANDERS = [commander(1), commander(2), commander(3)];
  const draft = (card: CollectionCard): CommanderDraft => ({
    commander: { cardId: card.id, scryfallId: card.scryfallId, name: card.name, role: "core", manaValue: 3, typeLine: card.typeLine, manaCost: card.manaCost, imageUrl: null },
    picks: [],
    basics: [],
    total: 100,
    short: 0,
    counts: { land: 0, ramp: 0, draw: 0, removal: 0, wipe: 0, core: 0 },
    curve: [0, 0, 0, 0, 0, 0, 0, 0],
    poolSize: 0,
    warnings: [],
    strategy: null,
  });
  const keep = (over: Record<string, unknown> = {}) =>
    window.localStorage.setItem(
      lastAiDraftKey("viewer-1"),
      JSON.stringify({
        savedAt: new Date(Date.now() - 3 * 86_400_000 - 60_000).toISOString(),
        commanderId: COMMANDERS[1].id,
        collectionSize: 71,
        truncated: false,
        draft: draft(COMMANDERS[1]),
        ...over,
      }),
    );
  const open = async () => {
    render(<CollectionBuild commanders={COMMANDERS} initialCommanderId={null} credits={5} aiAvailable collectionSize={71} viewerId="viewer-1" />);
    await settle();
  };

  it("records `restore_draft` with its size and age — once, when it is shown, never a card's name", async () => {
    keep();
    await open();
    // Offered, not shown: nothing recorded yet.
    expect(m.track).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Show it" }));
    });
    expect(screen.getByRole("heading", { name: "Your draft" })).toBeTruthy();
    expect(tracked()).toEqual([["collection-builder", "restore_draft", { cards: 100, age_days: 3 }]]);
    expect(JSON.stringify(m.track.mock.calls)).not.toMatch(/Secret/);
  });

  it("carries the deck type and bracket it was built with, cleaned as the pickers are", async () => {
    keep({ choice: { deckType: "tokens", tribe: "goblin", bracket: 2 } });
    await open();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Show it" }));
    });
    expect(tracked()).toEqual([["collection-builder", "restore_draft", { cards: 100, age_days: 3, deck_type: "tokens", bracket: 2 }]]);

    cleanup();
    m.track.mockClear();
    keep({ choice: { deckType: "storm", bracket: 9 } });
    await open();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Show it" }));
    });
    expect(tracked()).toEqual([["collection-builder", "restore_draft", { cards: 100, age_days: 3 }]]);
  });

  it("a dismissed draft records nothing, and Show it shows the draft", async () => {
    keep();
    await open();
    fireEvent.click(screen.getByRole("button", { name: /^Dismiss\s*the kept AI build$/ }));
    expect(m.track).not.toHaveBeenCalled();

    cleanup();
    keep();
    await open();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Show it" }));
    });
    expect(screen.getByRole("heading", { name: "Your draft" })).toBeTruthy();
  });
});
