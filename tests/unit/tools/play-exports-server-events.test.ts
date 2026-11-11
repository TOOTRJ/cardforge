import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// What the play-surface exports' server action records (tool_events): the
// export MODEL handed to the browser as `export`, and every refusal past the
// tool's gate as `export_failed` with a `reason` — after the response
// (recordToolEventLater), never awaited: the recorder here answers a promise
// that never settles, so an action that waited for it would never answer.
// Whether a file was then SAVED is the browser's event
// (play-exports-events.test.tsx). Counts and choices only.
// ---------------------------------------------------------------------------

const USER = "11111111-1111-4111-8111-111111111111";
const DECK = "22222222-2222-4222-8222-222222222222";
const CARD = "33333333-3333-4333-8333-333333333333";

type Recorded = { slug: string; userId: string | null; event: string; access: string | null; props?: unknown };

const m = vi.hoisted(() => ({
  access: null as null | { userId: string; via: string },
  deck: vi.fn(),
  cards: vi.fn(),
  events: [] as Recorded[],
  plainWrites: 0,
}));

vi.mock("@/lib/tools/queries", () => ({ checkToolAccess: async () => m.access }));
vi.mock("@/lib/tools/events", () => ({
  recordToolEvent: async () => {
    m.plainWrites += 1;
  },
  recordToolEventLater: (input: Recorded) => {
    m.events.push(input);
    return new Promise(() => undefined);
  },
}));
vi.mock("@/lib/tools/play-exports/collect", () => ({
  MAX_SELECTION_CARDS: 150,
  collectDeckExport: m.deck,
  collectCardsExport: m.cards,
}));

import { buildPlayExportAction, type PlayExportInput } from "@/lib/tools/play-exports/actions";

const model = (cards: number, lines: number, hidden = 0) => ({
  title: "Wolf Pack",
  fileStem: "wolf-pack",
  cards: Array.from({ length: cards }, (_, i) => ({ id: `c${i}`, name: `Wolf ${i}` })),
  lines: Array.from({ length: lines }, (_, i) => ({ kind: "real", name: `Forest ${i}` })),
  leftOut: { hidden, maybeboard: 2 },
});

const recorded = () => m.events.map((e) => [e.event, e.props]);
const deckInput: PlayExportInput = { target: "cockatrice", source: { kind: "deck", deckId: DECK } };
const cardsInput: PlayExportInput = { target: "tts", source: { kind: "cards", cardIds: [CARD] } };

beforeEach(() => {
  m.access = { userId: USER, via: "admin" };
  m.deck.mockReset();
  m.cards.mockReset();
  m.deck.mockResolvedValue(model(3, 40, 1));
  m.cards.mockResolvedValue({ export: model(1, 1), skipped: 2 });
  m.events = [];
  m.plainWrites = 0;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const event of m.events) {
    expect([event.slug, event.userId, event.access]).toEqual(["play-exports", USER, "admin"]);
    // Never a deck's or a card's name, a file stem or an id.
    expect(JSON.stringify(event.props ?? {})).not.toMatch(/wolf|forest|2222|3333/i);
  }
  expect(m.plainWrites).toBe(0);
});

describe("buildPlayExportAction's events", () => {
  it("records the export handed over: the app, the source and what is in it", async () => {
    expect(await buildPlayExportAction(deckInput)).toMatchObject({ ok: true, skipped: 0 });
    expect(await buildPlayExportAction(cardsInput)).toMatchObject({ ok: true, skipped: 2 });
    expect(recorded()).toEqual([
      ["export", { target: "cockatrice", source: "deck", custom_cards: 3, lines: 40, hidden: 1 }],
      ["export", { target: "tts", source: "cards", custom_cards: 1, lines: 1, hidden: 0 }],
    ]);
  });

  it("a closed tool records nothing", async () => {
    m.access = null;
    expect(await buildPlayExportAction(deckInput)).toMatchObject({ ok: false });
    expect(m.events).toEqual([]);
    expect(m.deck).not.toHaveBeenCalled();
  });

  it("a request that isn't valid: export_failed, invalid", async () => {
    expect(await buildPlayExportAction({ target: "arena", source: { kind: "deck", deckId: DECK } } as never)).toMatchObject({ ok: false });
    expect(await buildPlayExportAction({ target: "tts", source: { kind: "cards", cardIds: [] } })).toMatchObject({ ok: false });
    expect(recorded()).toEqual([
      ["export_failed", { reason: "invalid" }],
      ["export_failed", { reason: "invalid" }],
    ]);
  });

  it("cards that couldn't be read: export_failed, read_failed", async () => {
    m.deck.mockRejectedValue(new Error("timeout"));
    expect(await buildPlayExportAction(deckInput)).toMatchObject({ ok: false, error: expect.stringContaining("couldn't read") });
    expect(recorded()).toEqual([["export_failed", { reason: "read_failed", target: "cockatrice", source: "deck" }]]);
  });

  it("a deck the viewer can't open: export_failed, deck_unavailable", async () => {
    m.deck.mockResolvedValue(null);
    expect(await buildPlayExportAction({ ...deckInput, target: "draftmancer" })).toMatchObject({ ok: false });
    expect(recorded()).toEqual([["export_failed", { reason: "deck_unavailable", target: "draftmancer", source: "deck" }]]);
  });

  it("nothing to export: export_failed, empty — with what was hidden or skipped", async () => {
    m.deck.mockResolvedValue(model(0, 0, 4));
    expect(await buildPlayExportAction(deckInput)).toMatchObject({ ok: false, error: expect.stringContaining("no cards") });
    m.cards.mockResolvedValue({ export: model(0, 0), skipped: 1 });
    expect(await buildPlayExportAction(cardsInput)).toMatchObject({ ok: false });
    expect(recorded()).toEqual([
      ["export_failed", { reason: "empty", target: "cockatrice", source: "deck", hidden: 4, skipped: 0 }],
      ["export_failed", { reason: "empty", target: "tts", source: "cards", hidden: 0, skipped: 1 }],
    ]);
  });
});
