import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// What the Collection Deck Builder records for the admin's analytics (the
// 2026-11-10 tools audit): every action's OUTCOME — the success under the
// action's name, a refusal under `<name>_failed` with a `reason` code — after
// the response (recordToolEventLater), with counts and codes only. Here: the
// import's chunks, one card at a time, the "Decks you can build" view, and
// "Build with AI" (its credit charged, or back).
//
// The draft, the save and the finish are in collection-actions.test.ts; the
// suggestions in collection-suggest-route.test.ts; the browser's own events
// in collection-client-events.test.tsx.
// ---------------------------------------------------------------------------

const m = vi.hoisted(() => {
  class ScryfallUnavailableError extends Error {}
  return {
    ScryfallUnavailableError,
    access: vi.fn(),
    open: vi.fn(),
    event: vi.fn(),
    createClient: vi.fn(),
    scryfallRate: vi.fn(),
    getCard: vi.fn(),
    resolve: vi.fn(),
    write: vi.fn(),
    oneRow: vi.fn(),
    pool: vi.fn(),
    stats: vi.fn(),
    buildable: vi.fn(),
    candidates: vi.fn(),
    aiBuild: vi.fn(),
    aiRate: vi.fn(),
    spend: vi.fn(),
    settle: vi.fn(),
    refund: vi.fn(),
    keep: vi.fn(),
    start: vi.fn(),
    end: vi.fn(),
    calls: [] as Array<Record<string, unknown>>,
  };
});

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/tools/queries", () => ({ checkToolAccess: m.access, openTool: m.open, getViewerTool: vi.fn(async () => null) }));
vi.mock("@/lib/tools/events", () => ({ recordToolEvent: m.event, recordToolEventLater: m.event, recordToolEventOncePerVisit: m.event }));
vi.mock("@/lib/api/after-response", () => ({ afterResponse: (task: () => unknown) => void task() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: m.createClient, getCurrentUser: vi.fn() }));
vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/scryfall/client", () => ({ getCardById: m.getCard }));
vi.mock("@/lib/scryfall/rate-limit", () => ({ checkScryfallRateLimit: m.scryfallRate, logScryfallCall: vi.fn() }));
vi.mock("@/lib/decks/actions", () => ({ createDeckAction: vi.fn() }));
vi.mock("@/lib/decks/import-commit", () => ({ commitImportLines: vi.fn() }));
vi.mock("@/lib/tools/collection/server", () => ({
  resolveImportLines: m.resolve,
  writeCollectionRows: m.write,
  ScryfallUnavailableError: m.ScryfallUnavailableError,
  COLLECTION_FULL_MESSAGE: "Your collection is full.",
}));
vi.mock("@/lib/tools/collection/card-row", () => ({ collectionRowFor: () => ({ scryfall_id: "sf-1" }) }));
vi.mock("@/lib/tools/collection/resolve", () => ({ finishFor: (_card: unknown, finish: string) => finish }));
vi.mock("@/lib/tools/collection/queries", () => ({
  COLLECTION_COLOURS: ["W", "U", "B", "R", "G", "C"],
  COLLECTION_SORTS: ["name"],
  COLLECTION_TYPES: ["creature"],
  getCollectionCard: m.oneRow,
  listBuilderPool: m.pool,
  listCollectionCardsById: vi.fn(async () => []),
  getCollectionStats: m.stats,
  listBuildableDecks: m.buildable,
  listCollectionPage: vi.fn(),
  listOwnedCommanders: vi.fn(async () => []),
}));
vi.mock("@/lib/tools/collection/bracket-cards", () => ({ getBracketCards: vi.fn(async () => null) }));
vi.mock("@/lib/tools/collection/ai-candidates", () => ({ AI_MIN_POOL: 30, aiCandidates: m.candidates }));
vi.mock("@/lib/tools/collection/ai-build", () => ({ aiBuildCommanderDeck: m.aiBuild }));
vi.mock("@/lib/tools/collection/ai-results", () => ({
  keepCollectionAiResult: m.keep,
  startCollectionAiResult: m.start,
  endCollectionAiResult: m.end,
  // The real wrapper's contract (held in collection-ai-recovery.test.ts);
  // here it hands each call's bookkeeping to the test.
  withCollectionAiRecord: async (_kind: string, handle: (call: Record<string, unknown>) => Promise<Response>) => {
    const call = { userId: null, requestId: null, charged: false, ended: false };
    m.calls.push(call);
    return handle(call);
  },
}));
vi.mock("@/lib/ai/provider", () => ({ isDesignAiConfigured: () => true, designModel: vi.fn() }));
vi.mock("@/lib/billing/flags", () => ({ isBillingEnabled: () => false }));
vi.mock("@/lib/ai/rate-limit", () => ({
  checkAiRateLimit: m.aiRate,
  getFreshCreditBalance: vi.fn(async () => 4),
  logAiCall: vi.fn(),
  refundCredits: m.refund,
  settleSpend: m.settle,
  spendCredits: m.spend,
}));
// The page's pieces: only what it records is under test.
vi.mock("@/components/tools/tool-shell", () => ({ ToolShell: () => null }));
vi.mock("@/components/tools/collection/collection-nav", () => ({ CollectionNav: () => null }));
vi.mock("@/components/tools/collection/collection-meter", () => ({ CollectionMeter: () => null }));
vi.mock("@/components/tools/collection/collection-browser", () => ({ CollectionBrowser: () => null }));
vi.mock("@/components/tools/collection/collection-add", () => ({ CollectionAdd: () => null }));
vi.mock("@/components/tools/collection/collection-build", () => ({ CollectionBuild: () => null }));
vi.mock("@/components/tools/collection/buildable-decks", () => ({ BuildableDecks: () => null }));

import * as actions from "@/lib/tools/collection/actions";
import { POST as aiBuild } from "@/app/api/tools/collection-builder/ai-build/route";
import CollectionBuilderPage from "@/app/(app)/dashboard/tools/collection-builder/page";

const UUID = "11111111-1111-4111-8111-111111111111";
const ACCESS = { userId: "u1", via: "release" };

/** The tool event recorded: its name and props, under the viewer and the
 *  access path the gate handed the action. */
const recorded = (event: string, props: Record<string, unknown> = {}) =>
  expect.objectContaining({
    slug: "collection-builder",
    userId: "u1",
    access: "release",
    event,
    props: expect.objectContaining(props),
  });
const eventsOf = () => m.event.mock.calls.map(([input]) => [input.event, input.props]);

/** A table whose every chain answers `result` (select / update / delete …). */
function tableAnswering(result: unknown) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "update", "delete", "eq", "or"]) chain[method] = () => chain;
  chain.then = (resolve: (value: unknown) => void) => resolve(result);
  m.createClient.mockResolvedValue({ from: () => chain });
}

const line = (n: number) => ({
  line: n,
  raw: `1 Card ${n}`,
  name: `Card ${n}`,
  setCode: null,
  collectorNumber: null,
  scryfallId: null,
  quantity: 1,
  finish: "nonfoil",
  lang: "en",
});

beforeEach(() => {
  for (const value of Object.values(m)) if (typeof value === "function" && "mockReset" in value) value.mockReset();
  m.access.mockResolvedValue(ACCESS);
  m.scryfallRate.mockResolvedValue({ ok: true });
  m.aiRate.mockResolvedValue({ ok: true });
  m.spend.mockResolvedValue({ ok: true, charged: true });
  m.refund.mockResolvedValue(true);
  m.start.mockResolvedValue("started");
  m.keep.mockResolvedValue("kept");
  m.calls.length = 0;
});

describe("an import's chunks", () => {
  const chunk = (index: number, lines = [line(1), line(2)]) =>
    actions.importCollectionChunkAction({ batchId: UUID, mode: "add", chunk: index, lines });

  it("the first chunk in is an import under way; the later ones record nothing", async () => {
    m.resolve.mockResolvedValue({ rows: [{}, {}], unmatched: [] });
    m.write.mockResolvedValue({ ok: true, added: 2, updated: 0, overCap: [] });
    expect((await chunk(0)).ok).toBe(true);
    expect(eventsOf()).toEqual([["import_started", { mode: "add", chunk_lines: 2 }]]);
    m.event.mockClear();
    expect((await chunk(1)).ok).toBe(true);
    expect(m.event).not.toHaveBeenCalled();
  });

  it("a spent Scryfall quota, a Scryfall that didn't answer and a write that failed are each a reason", async () => {
    m.scryfallRate.mockResolvedValueOnce({ ok: false, reason: "per_minute", retryAfterSeconds: 30, message: "Slow down." });
    expect(await chunk(3)).toMatchObject({ ok: false, retryAfterSeconds: 30 });
    expect(m.event).toHaveBeenLastCalledWith(recorded("import_failed", { reason: "rate_limited", mode: "add", chunk: 3, lines: 2 }));

    m.resolve.mockRejectedValueOnce(new m.ScryfallUnavailableError("down"));
    expect(await chunk(4)).toMatchObject({ ok: false, retryAfterSeconds: 5 });
    expect(m.event).toHaveBeenLastCalledWith(recorded("import_failed", { reason: "scryfall_unavailable", chunk: 4 }));

    m.resolve.mockResolvedValue({ rows: [{}], unmatched: [] });
    m.write.mockResolvedValueOnce({ ok: false, error: "The cards couldn't be saved." });
    expect((await chunk(5)).ok).toBe(false);
    expect(m.event).toHaveBeenLastCalledWith(recorded("import_failed", { reason: "write_failed", chunk: 5 }));
    // Three failures, three rows — and no line of the list in any of them.
    expect(m.event).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(m.event.mock.calls)).not.toMatch(/Card \d/);
  });

  it("a collection that filled up is where the import stops, with how many didn't fit", async () => {
    m.resolve.mockResolvedValue({ rows: [{}, {}], unmatched: [] });
    m.write.mockResolvedValue({ ok: true, added: 1, updated: 0, overCap: [{ line: line(2) }] });
    expect(await chunk(7)).toMatchObject({ ok: true, full: true });
    expect(eventsOf()).toEqual([["import_failed", { reason: "collection_full", mode: "add", chunk: 7, lines: 2, over_cap: 1 }]]);
  });

  it("lines that can't be read, and a finish that can't", async () => {
    expect((await actions.importCollectionChunkAction({ batchId: "nope" })).ok).toBe(false);
    expect((await actions.finishCollectionImportAction({ batchId: "nope" })).ok).toBe(false);
    expect(eventsOf()).toEqual([
      ["import_failed", { reason: "invalid" }],
      ["import_failed", { reason: "invalid_finish" }],
    ]);
  });
});

describe("one card at a time", () => {
  it("add: the surface and the copies; each refusal its own reason", async () => {
    m.getCard.mockResolvedValue({ id: "sf-1", name: "Sol Ring", lang: "en" });
    m.write.mockResolvedValue({ ok: true, added: 1, updated: 0, overCap: [] });
    tableAnswering({ data: [{ quantity: 3 }], error: null });
    expect(await actions.addToCollectionAction({ scryfallId: UUID, quantity: 3, surface: "creator" })).toEqual({ ok: true, name: "Sol Ring", owned: 3 });
    expect(eventsOf()).toEqual([["add_card", { surface: "creator", quantity: 3 }]]);

    m.event.mockClear();
    expect((await actions.addToCollectionAction({ scryfallId: "nope" })).ok).toBe(false);
    m.scryfallRate.mockResolvedValueOnce({ ok: false, reason: "per_minute", retryAfterSeconds: 9, message: "Slow down." });
    expect((await actions.addToCollectionAction({ scryfallId: UUID })).ok).toBe(false);
    m.getCard.mockResolvedValueOnce(null);
    expect((await actions.addToCollectionAction({ scryfallId: UUID })).ok).toBe(false);
    m.write.mockResolvedValueOnce({ ok: false, error: "Not saved." });
    expect((await actions.addToCollectionAction({ scryfallId: UUID })).ok).toBe(false);
    m.write.mockResolvedValueOnce({ ok: true, added: 0, updated: 0, overCap: [{ line: null }] });
    expect((await actions.addToCollectionAction({ scryfallId: UUID })).ok).toBe(false);
    expect(eventsOf()).toEqual([
      ["add_card_failed", { reason: "invalid" }],
      ["add_card_failed", { reason: "rate_limited", surface: "tool", quantity: 1 }],
      ["add_card_failed", { reason: "printing_not_found", surface: "tool", quantity: 1 }],
      ["add_card_failed", { reason: "write_failed", surface: "tool", quantity: 1 }],
      ["add_card_failed", { reason: "collection_full", surface: "tool", quantity: 1 }],
    ]);
    expect(JSON.stringify(m.event.mock.calls)).not.toMatch(/Sol Ring/);
  });

  it("a quantity edit and a removal are counted; a change that didn't save says why", async () => {
    tableAnswering({ data: [{ id: UUID }], error: null });
    expect(await actions.updateCollectionQuantityAction({ id: UUID, quantity: 4 })).toEqual({ ok: true });
    expect(await actions.removeCollectionCardAction({ id: UUID })).toEqual({ ok: true });
    expect(eventsOf()).toEqual([
      ["edit_quantity", { quantity: 4 }],
      ["remove_card", { cards: 1 }],
    ]);

    m.event.mockClear();
    expect((await actions.updateCollectionQuantityAction({ id: UUID, quantity: 0 })).ok).toBe(false);
    tableAnswering({ data: [], error: null });
    expect((await actions.updateCollectionQuantityAction({ id: UUID, quantity: 2 })).ok).toBe(false);
    tableAnswering({ data: null, error: { message: "boom" } });
    expect((await actions.updateCollectionQuantityAction({ id: UUID, quantity: 2 })).ok).toBe(false);
    expect((await actions.removeCollectionCardAction({ id: UUID })).ok).toBe(false);
    expect((await actions.removeCollectionCardAction({ id: "nope" })).ok).toBe(false);
    expect(eventsOf()).toEqual([
      ["edit_quantity_failed", { reason: "invalid" }],
      ["edit_quantity_failed", { reason: "row_not_found" }],
      ["edit_quantity_failed", { reason: "write_failed" }],
      ["remove_card_failed", { reason: "write_failed" }],
      ["remove_card_failed", { reason: "invalid" }],
    ]);
  });

  it("clearing the collection records how many went, or that it didn't", async () => {
    tableAnswering({ error: null, count: 412 });
    expect(await actions.clearCollectionAction({ confirm: "clear" })).toEqual({ ok: true, removed: 412 });
    tableAnswering({ error: { message: "boom" }, count: null });
    expect((await actions.clearCollectionAction({ confirm: "clear" })).ok).toBe(false);
    expect(eventsOf()).toEqual([
      ["clear", { removed: 412 }],
      ["clear_failed", { reason: "write_failed" }],
    ]);
  });
});

describe("\"Decks you can build\"", () => {
  const page = (view: string) => CollectionBuilderPage({ searchParams: Promise.resolve({ view }) });
  const deck = (missing: number, percent: number) => ({ deckId: `d${percent}`, title: "Secret deck name", missing, percent });

  beforeEach(() => {
    m.open.mockResolvedValue({ userId: "u1", via: "release" });
  });

  it("records the view once it is computed (once a visit, after the response): how many decks, how close — never a deck's name", async () => {
    m.stats.mockResolvedValue({ cards: 840, copies: 1200, commanders: 12, cap: 30000 });
    m.buildable.mockResolvedValue([deck(0, 100), deck(4, 96), deck(40, 60)]);
    await page("decks");
    expect(eventsOf()).toEqual([["buildable_decks", { collection: 840, decks: 3, complete: 1, over_90: 2, best_percent: 100 }]]);
    expect(m.event).toHaveBeenCalledWith(recorded("buildable_decks"));
    expect(JSON.stringify(m.event.mock.calls)).not.toMatch(/Secret/);
  });

  it("an empty collection computes nothing, and another view records nothing", async () => {
    m.stats.mockResolvedValue({ cards: 0, copies: 0, commanders: 0, cap: 30000 });
    await page("decks");
    expect(m.buildable).not.toHaveBeenCalled();
    m.stats.mockResolvedValue({ cards: 840, copies: 1200, commanders: 12, cap: 30000 });
    await page("add");
    expect(m.event).not.toHaveBeenCalled();
  });
});

describe("\"Build with AI\"", () => {
  const card = (i: number, over: Record<string, unknown> = {}) => ({
    id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    scryfallId: `20000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    name: `Filler ${i}`,
    typeLine: "Creature — Goblin",
    manaCost: "{R}",
    manaValue: 1,
    colorIdentity: ["R"],
    oracleText: "",
    rarity: "common",
    setCode: "tst",
    setName: "Test",
    collectorNumber: String(i),
    imageUrl: null,
    quantity: 1,
    finish: "nonfoil",
    lang: "en",
    commanderLegal: true,
    canBeCommander: false,
    ...over,
  });
  const commander = card(0, { id: UUID, name: "Krenko, Mob Boss", typeLine: "Legendary Creature — Goblin", canBeCommander: true });
  const post = (body: unknown = { commanderId: UUID, bracket: 3 }) =>
    aiBuild(new Request("http://x/api", { method: "POST", body: JSON.stringify(body) }));

  beforeEach(() => {
    m.oneRow.mockResolvedValue(commander);
    m.pool.mockResolvedValue({ cards: Array.from({ length: 80 }, (_, i) => card(i + 1)), truncated: false });
    m.candidates.mockReturnValue(Array.from({ length: 40 }));
  });

  it("a delivered draft records what it made and the credit it charged", async () => {
    m.aiBuild.mockResolvedValue({ poolSize: 80, total: 100, picks: [{ fromAi: true }, { fromAi: true }, { fromAi: false }] });
    expect((await post()).status).toBe(200);
    expect(m.settle).toHaveBeenCalledTimes(1);
    expect(m.event).toHaveBeenCalledTimes(1);
    expect(m.event).toHaveBeenCalledWith(
      recorded("ai_build", { pool: 80, total: 100, ai_picks: 2, colours: "R", bracket: 3, credits: 1, ms: expect.any(Number) }),
    );
    expect(JSON.stringify(m.event.mock.calls)).not.toMatch(/Krenko/);
  });

  it("the request is on record BEFORE the charge, and its draft is KEPT before the credit is settled — a lost response can't lose it", async () => {
    const REQUEST = "5b0c6c0e-7d0b-4a52-9f3e-0c1d2e3f4a5b";
    const order: string[] = [];
    const draft = { poolSize: 80, total: 100, picks: [] };
    m.aiBuild.mockImplementation(async () => {
      order.push("ai");
      return draft;
    });
    m.spend.mockImplementation(async () => {
      order.push("spend");
      return { ok: true, charged: true };
    });
    m.start.mockImplementation(async () => {
      order.push("start");
      return "started";
    });
    m.keep.mockImplementation(async () => {
      order.push("keep");
      return "kept";
    });
    m.settle.mockImplementation(async () => void order.push("settle"));
    const response = await post({ commanderId: UUID, bracket: 3, requestId: REQUEST });
    expect(response.status).toBe(200);
    expect(order).toEqual(["start", "spend", "ai", "keep", "settle"]);
    expect(m.start).toHaveBeenCalledWith("u1", "build", REQUEST);
    expect(m.keep).toHaveBeenCalledWith("u1", "build", REQUEST, { draft, truncated: false });
    expect(m.calls.at(-1)).toEqual({ userId: "u1", requestId: REQUEST, charged: true, ended: true });
    // The id is the page's bookkeeping: it never reaches the build.
    expect(m.aiBuild.mock.calls[0][0].choice).toEqual({ bracket: 3 });
  });

  it("a request that can't be put on record is REFUSED before any charge — one that may be charged always has a row", async () => {
    m.start.mockResolvedValue("failed");
    const response = await post({ commanderId: UUID, requestId: "5b0c6c0e-7d0b-4a52-9f3e-0c1d2e3f4a5b" });
    expect(response.status).toBe(503);
    expect((await response.json()).error).toMatch(/nothing was charged/);
    expect(m.spend).not.toHaveBeenCalled();
    expect(m.aiBuild).not.toHaveBeenCalled();
    expect(m.event).toHaveBeenCalledWith(recorded("ai_build_failed", { reason: "not_recorded" }));
  });

  it("a draft that could NOT be kept is still delivered, but its credit is left unsettled (the sweep returns it)", async () => {
    m.aiBuild.mockResolvedValue({ poolSize: 80, total: 100, picks: [] });
    m.keep.mockResolvedValue("failed");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await post({ commanderId: UUID, bracket: 3, requestId: "5b0c6c0e-7d0b-4a52-9f3e-0c1d2e3f4a5b" });
    expect(response.status).toBe(200);
    expect((await response.json()).draft.total).toBe(100);
    expect(m.settle).not.toHaveBeenCalled();
    expect(m.calls.at(-1)).toMatchObject({ charged: true, ended: false });
    expect(m.event).toHaveBeenCalledWith(recorded("ai_build", { credits: 0, unsettled: true }));
  });

  it("a failed build keeps nothing, is refunded and marks its request failed", async () => {
    m.aiBuild.mockRejectedValue(new Error("provider down"));
    expect((await post({ commanderId: UUID, bracket: 3, requestId: "5b0c6c0e-7d0b-4a52-9f3e-0c1d2e3f4a5b" })).status).toBe(502);
    expect(m.keep).not.toHaveBeenCalled();
    expect(m.settle).not.toHaveBeenCalled();
    expect(m.end).toHaveBeenCalledWith("u1", "build", "5b0c6c0e-7d0b-4a52-9f3e-0c1d2e3f4a5b", "failed");
    expect(m.calls.at(-1)).toMatchObject({ charged: true, ended: true });
  });

  it("a refusal before the charge leaves its row to be ended `refused` (charged: false, no ending written)", async () => {
    m.spend.mockResolvedValue({ ok: false, reason: "insufficient_credits", message: "Out of credits.", balance: 0 });
    expect((await post({ commanderId: UUID, requestId: "5b0c6c0e-7d0b-4a52-9f3e-0c1d2e3f4a5b" })).status).toBe(402);
    expect(m.calls.at(-1)).toEqual({ userId: "u1", requestId: "5b0c6c0e-7d0b-4a52-9f3e-0c1d2e3f4a5b", charged: false, ended: false });
    expect(m.end).not.toHaveBeenCalled();
  });

  it("nothing charged (an admin, billing off) is zero credits", async () => {
    m.spend.mockResolvedValue({ ok: true, charged: false });
    m.aiBuild.mockResolvedValue({ poolSize: 80, total: 100, picks: [] });
    expect((await post()).status).toBe(200);
    expect(m.event).toHaveBeenCalledWith(recorded("ai_build", { credits: 0 }));
  });

  it("a failed call records the AI's failure kind and the credit that came back", async () => {
    const error = new Error("unreadable");
    error.name = "AiOutputError";
    m.aiBuild.mockRejectedValue(error);
    expect((await post()).status).toBe(502);
    expect(m.event).toHaveBeenCalledTimes(1);
    expect(m.event).toHaveBeenCalledWith(
      recorded("ai_build_failed", { reason: "design_unreadable", refunded: true, refund_pending: false, pool: 80, bracket: 3, ms: expect.any(Number) }),
    );
    // A refunded credit is never counted as spent.
    expect(m.event.mock.calls[0][0].props).not.toHaveProperty("credits");

    m.event.mockClear();
    m.refund.mockResolvedValue(false);
    expect((await post()).status).toBe(502);
    expect(m.event).toHaveBeenCalledWith(recorded("ai_build_failed", { refunded: false, refund_pending: true }));
  });

  it("out of credits, a failed credit check and the AI rate limit never reach the AI", async () => {
    m.spend.mockResolvedValueOnce({ ok: false, reason: "insufficient_credits", message: "Out of credits.", balance: 0 });
    expect((await post()).status).toBe(402);
    m.spend.mockResolvedValueOnce({ ok: false, reason: "error", message: "Try again.", balance: Number.NaN });
    expect((await post()).status).toBe(503);
    m.aiRate.mockResolvedValueOnce({ ok: false, retryAfterSeconds: 30, message: "Slow down." });
    expect((await post()).status).toBe(429);
    expect(eventsOf()).toEqual([
      ["ai_build_failed", { reason: "insufficient_credits", bracket: 3 }],
      ["ai_build_failed", { reason: "credit_check_failed", bracket: 3 }],
      ["ai_build_failed", { reason: "rate_limited", bracket: 3 }],
    ]);
    expect(m.aiBuild).not.toHaveBeenCalled();
    expect(m.refund).not.toHaveBeenCalled();
  });
});
