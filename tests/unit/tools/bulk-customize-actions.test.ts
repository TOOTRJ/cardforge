import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Bulk Customize's server actions (lib/tools/bulk-customize/actions.ts): the
// tool's gate first; a batch that changes nothing is refused as EXACT_COPY
// before any read or Scryfall call; the saved-card limit and the credits are
// judged BEFORE the job row exists; the job is a `bulk_customize` row whose
// steps carry each card's price.
// ---------------------------------------------------------------------------

const m = vi.hoisted(() => ({
  access: vi.fn(),
  event: vi.fn(),
  insert: vi.fn(),
  resolve: vi.fn(),
  fetchPrintings: vi.fn(),
  importPatch: vi.fn(),
  plan: vi.fn(),
  scryfallRate: vi.fn(),
  capacity: vi.fn(),
  balance: vi.fn(),
  billing: vi.fn(),
  daily: vi.fn(),
  gateway: vi.fn(),
}));

vi.mock("@/lib/tools/queries", () => ({ checkToolAccess: m.access }));
// The actions record after the response (recordToolEventLater); the same spy
// stands in for both writers.
vi.mock("@/lib/tools/events", () => ({ recordToolEvent: m.event, recordToolEventLater: m.event }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({
      insert: (row: unknown) => {
        m.insert(row);
        return {
          select: () => ({ single: async () => ({ data: { id: "job-1", kind: "bulk_customize", steps: (row as { steps: unknown }).steps }, error: null }) }),
        };
      },
    }),
  }),
}));
vi.mock("@/lib/scryfall/rate-limit", () => ({ checkScryfallRateLimit: m.scryfallRate, logScryfallCall: vi.fn() }));
vi.mock("@/lib/cards/frame-reviews", () => ({ getVerifiedFrameKeys: async () => [] }));
vi.mock("@/lib/billing/entitlements", () => ({ getEntitlements: async () => ({ removeWatermark: true }) }));
vi.mock("@/lib/cards/capacity", () => ({ getCardCapacity: m.capacity }));
vi.mock("@/lib/billing/flags", () => ({ isBillingEnabled: m.billing }));
vi.mock("@/lib/ai/rate-limit", () => ({
  DECK_CARDS_DAILY_LIMIT: 50,
  checkDailyActionLimit: m.daily,
  getFreshCreditBalance: m.balance,
}));
vi.mock("@/lib/ai/provider", () => ({ isGatewayConfigured: m.gateway }));
vi.mock("@/lib/tools/bulk-customize/server", () => ({
  resolveBulkSources: m.resolve,
  fetchBulkPrintings: m.fetchPrintings,
  importPatchOf: m.importPatch,
  printingThumbOf: () => null,
}));
vi.mock("@/lib/tools/bulk-customize/planner", () => ({ planCustomizedCard: m.plan }));
vi.mock("@/lib/tools/bulk-customize/step", () => ({ bulkStepKey: (i: number) => `bulk:${i}` }));

import { prepareBulkCustomizeAction, startBulkCustomizeAction } from "@/lib/tools/bulk-customize/actions";
import { BULK_EXACT_COPY_CODE, DEFAULT_BULK_CHOICES } from "@/lib/tools/bulk-customize/model";

const ACCESS = { userId: "u1", via: "grant" };
const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const SOURCES = [
  { kind: "deck_entry", id: ID(1) },
  { kind: "deck_entry", id: ID(2) },
];
const RETRO = { ...DEFAULT_BULK_CHOICES, look: "retro" as const };

/** The tool event an action recorded (after the response): its name and
 *  props, under the viewer and the access path the gate handed it. */
const recorded = (event: string, props: Record<string, unknown> = {}) =>
  expect.objectContaining({
    slug: "bulk-customize",
    userId: "u1",
    access: "grant",
    event,
    props: expect.objectContaining(props),
  });
const eventsOf = () => m.event.mock.calls.map(([input]) => [input.event, input.props]);

function resolvedTwo() {
  m.resolve.mockResolvedValue({
    resolved: SOURCES.map((source, i) => ({
      key: `deck_entry:${source.id}`,
      source,
      scryfallId: `sf-${i}`,
      name: `Card ${i}`,
      deckEntryId: source.id,
    })),
    skipped: [],
  });
  m.fetchPrintings.mockResolvedValue(
    new Map([
      ["sf-0", { id: "sf-0", name: "Card 0", set: "dom" }],
      ["sf-1", { id: "sf-1", name: "Card 1", set: "dom" }],
    ]),
  );
  m.importPatch.mockResolvedValue({});
}

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset();
  m.access.mockResolvedValue(ACCESS);
  m.scryfallRate.mockResolvedValue({ ok: true });
  m.capacity.mockResolvedValue({ used: 0, cap: 50, tier: "free" });
  m.balance.mockResolvedValue(10);
  m.billing.mockReturnValue(true);
  m.gateway.mockReturnValue(true);
  m.daily.mockResolvedValue({ ok: true });
  m.plan.mockImplementation(({ fallbackTitle }: { fallbackTitle: string }) => ({
    ok: true,
    title: fallbackTitle,
    payload: {},
    changes: ["frame"],
    notes: [],
    doubleFaced: false,
    credits: 0,
  }));
});

describe("the gate", () => {
  it("a closed tool refuses both actions before any read", async () => {
    m.access.mockResolvedValue(null);
    expect((await prepareBulkCustomizeAction(SOURCES)).ok).toBe(false);
    expect((await startBulkCustomizeAction({ sources: SOURCES, choices: RETRO })).ok).toBe(false);
    expect(m.resolve).not.toHaveBeenCalled();
    expect(m.insert).not.toHaveBeenCalled();
    // Nobody the tool let in: nothing to record.
    expect(m.event).not.toHaveBeenCalled();
  });

  it("refuses a selection over the batch limit", async () => {
    const many = Array.from({ length: 101 }, (_, i) => ({ kind: "deck_entry", id: ID(i + 1) }));
    expect((await prepareBulkCustomizeAction(many)).ok).toBe(false);
    expect(m.resolve).not.toHaveBeenCalled();
    expect(eventsOf()).toEqual([["prepare_failed", { reason: "invalid" }]]);
  });
});

describe("what a read of the selection records", () => {
  const MIXED = [
    { kind: "deck_entry", id: ID(1) },
    { kind: "deck_entry", id: ID(2) },
    { kind: "collection", id: ID(3) },
    { kind: "scryfall", id: "0000579f-7b35-4ed3-b44c-db2a538066fe" },
  ];

  it("the cards read and skipped, and how many came from each door — never a name", async () => {
    resolvedTwo();
    const result = await prepareBulkCustomizeAction(MIXED);
    expect(result.ok).toBe(true);
    expect(m.event).toHaveBeenCalledTimes(1);
    expect(m.event).toHaveBeenCalledWith(recorded("prepare"));
    expect(eventsOf()).toEqual([["prepare", { cards: 2, skipped: 0, from_deck: 2, from_collection: 1, from_search: 1 }]]);
    expect(JSON.stringify(m.event.mock.calls)).not.toMatch(/Card \d/);
  });

  it("a spent Scryfall quota and a Scryfall that didn't answer are refusals with a reason", async () => {
    resolvedTwo();
    m.scryfallRate.mockResolvedValueOnce({ ok: false, message: "Slow down.", retryAfterSeconds: 20 });
    expect(await prepareBulkCustomizeAction(SOURCES)).toMatchObject({ ok: false, code: "RATE_LIMITED" });
    m.fetchPrintings.mockResolvedValueOnce(null);
    expect((await prepareBulkCustomizeAction(SOURCES)).ok).toBe(false);
    expect(eventsOf()).toEqual([
      ["prepare_failed", { reason: "rate_limited", cards: 2, from_deck: 2, from_collection: 0, from_search: 0 }],
      ["prepare_failed", { reason: "scryfall_unavailable", cards: 2, from_deck: 2, from_collection: 0, from_search: 0 }],
    ]);
  });
});

describe("exact copies", () => {
  it("refuses choices that change nothing before any read or Scryfall call", async () => {
    const result = await startBulkCustomizeAction({ sources: SOURCES, choices: DEFAULT_BULK_CHOICES });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(BULK_EXACT_COPY_CODE);
    expect(m.resolve).not.toHaveBeenCalled();
    expect(m.scryfallRate).not.toHaveBeenCalled();
    expect(m.insert).not.toHaveBeenCalled();
    expect(eventsOf()).toEqual([["start_failed", { reason: "exact_copy", selected: 2, look: "keep", art: "keep" }]]);
  });

  it("refuses a batch whose every card comes out unchanged", async () => {
    resolvedTwo();
    m.plan.mockReturnValue({ ok: false, title: "Card", reason: "unchanged", message: "Nothing would change." });
    const result = await startBulkCustomizeAction({ sources: SOURCES, choices: RETRO });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(BULK_EXACT_COPY_CODE);
    expect(m.insert).not.toHaveBeenCalled();
    expect(m.event).toHaveBeenCalledWith(recorded("start_failed", { reason: "nothing_changes", selected: 2, look: "retro", skipped: 2 }));
  });

  it("leaves an unchanged card out and makes the rest", async () => {
    resolvedTwo();
    m.plan
      .mockReturnValueOnce({ ok: false, title: "Card 0", reason: "unchanged", message: "Nothing would change." })
      .mockReturnValueOnce({ ok: true, title: "Card 1", payload: {}, changes: ["frame"], notes: [], doubleFaced: false, credits: 0 });
    const result = await startBulkCustomizeAction({ sources: SOURCES, choices: RETRO });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.skipped).toEqual([{ name: "Card 0", reason: "Nothing would change." }]);
    const row = m.insert.mock.calls[0][0] as { steps: Array<{ key: string; label: string }> };
    expect(row.steps.map((step) => step.label)).toEqual(["Card 1"]);
  });
});

describe("limits before the job exists", () => {
  it("refuses a batch bigger than the slots left (CARD_CAPACITY)", async () => {
    resolvedTwo();
    m.capacity.mockResolvedValue({ used: 49, cap: 50, tier: "free" });
    const result = await startBulkCustomizeAction({ sources: SOURCES, choices: RETRO });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("CARD_CAPACITY");
    expect(m.insert).not.toHaveBeenCalled();
    expect(m.event).toHaveBeenCalledTimes(1);
    expect(m.event).toHaveBeenCalledWith(recorded("start_failed", { reason: "capacity", cards: 2, slots_left: 1, art: "keep" }));
  });

  it("refuses AI art the balance can't pay for (INSUFFICIENT_CREDITS)", async () => {
    resolvedTwo();
    m.plan.mockImplementation(({ fallbackTitle }: { fallbackTitle: string }) => ({
      ok: true, title: fallbackTitle, payload: {}, changes: ["ai_art"], notes: [], doubleFaced: true, credits: 2,
    }));
    m.balance.mockResolvedValue(3);
    const result = await startBulkCustomizeAction({ sources: SOURCES, choices: { ...DEFAULT_BULK_CHOICES, art: "ai" } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INSUFFICIENT_CREDITS");
    expect(m.insert).not.toHaveBeenCalled();
    expect(m.event).toHaveBeenCalledWith(
      recorded("start_failed", { reason: "insufficient_credits", cards: 2, credits: 4, balance: 3, art: "ai" }),
    );
  });

  it("refuses AI art where the gateway isn't configured", async () => {
    m.gateway.mockReturnValue(false);
    const result = await startBulkCustomizeAction({ sources: SOURCES, choices: { ...DEFAULT_BULK_CHOICES, art: "ai" } });
    expect(result.ok).toBe(false);
    expect(m.resolve).not.toHaveBeenCalled();
    expect(eventsOf()).toEqual([["start_failed", { reason: "ai_unavailable", selected: 2, look: "keep", art: "ai" }]]);
  });

  it("each other refusal has its own reason: nothing to make, the quotas, Scryfall, a batch that can't be read", async () => {
    expect((await startBulkCustomizeAction({ sources: SOURCES, choices: { look: "nope" } })).ok).toBe(false);
    m.resolve.mockResolvedValueOnce({ resolved: [], skipped: [{ key: "k", name: "Gone", reason: "Not in your deck." }] });
    expect((await startBulkCustomizeAction({ sources: SOURCES, choices: RETRO })).ok).toBe(false);
    resolvedTwo();
    m.scryfallRate.mockResolvedValueOnce({ ok: false, message: "Slow down.", retryAfterSeconds: 20 });
    expect((await startBulkCustomizeAction({ sources: SOURCES, choices: RETRO })).ok).toBe(false);
    m.fetchPrintings.mockResolvedValueOnce(null);
    expect((await startBulkCustomizeAction({ sources: SOURCES, choices: RETRO })).ok).toBe(false);
    // Billing off: AI art is held to the daily limit instead of a balance.
    resolvedTwo();
    m.billing.mockReturnValue(false);
    m.daily.mockResolvedValueOnce({ ok: false, message: "That's today's AI pictures.", retryAfterSeconds: 3600 });
    m.plan.mockImplementation(({ fallbackTitle }: { fallbackTitle: string }) => ({
      ok: true, title: fallbackTitle, payload: {}, changes: ["ai_art"], notes: [], doubleFaced: false, credits: 1,
    }));
    expect((await startBulkCustomizeAction({ sources: SOURCES, choices: { ...DEFAULT_BULK_CHOICES, art: "ai" } })).ok).toBe(false);
    expect(eventsOf().map(([event, props]) => [event, props.reason])).toEqual([
      ["start_failed", "invalid"],
      ["start_failed", "no_cards"],
      ["start_failed", "rate_limited"],
      ["start_failed", "scryfall_unavailable"],
      ["start_failed", "daily_limit"],
    ]);
    expect(m.insert).not.toHaveBeenCalled();
    expect(JSON.stringify(m.event.mock.calls)).not.toMatch(/Gone|Card \d/);
  });
});

describe("the job", () => {
  it("inserts one bulk_customize job, a step a card, each priced", async () => {
    resolvedTwo();
    m.plan
      .mockReturnValueOnce({ ok: true, title: "Card 0", payload: {}, changes: ["ai_art"], notes: [], doubleFaced: false, credits: 1 })
      .mockReturnValueOnce({ ok: true, title: "Card 1", payload: {}, changes: ["ai_art"], notes: [], doubleFaced: true, credits: 2 });
    const result = await startBulkCustomizeAction({ sources: SOURCES, choices: { ...DEFAULT_BULK_CHOICES, art: "ai" } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.credits).toBe(3);
    const row = m.insert.mock.calls[0][0] as {
      kind: string;
      owner_id: string;
      deck_id: null;
      plan: { entries: Array<{ credits: number }> };
      steps: Array<{ key: string; credits?: number; status: string }>;
    };
    expect(row.kind).toBe("bulk_customize");
    expect(row.owner_id).toBe("u1");
    expect(row.deck_id).toBeNull();
    expect(row.plan.entries.map((entry) => entry.credits)).toEqual([1, 2]);
    expect(row.steps).toEqual([
      { key: "bulk:0", label: "Card 0", status: "pending" },
      { key: "bulk:1", label: "Card 1", status: "pending", credits: 2 },
    ]);
    // The start, once: the batch's size, its PRICE and its choices.
    expect(eventsOf()).toEqual([
      [
        "start",
        {
          cards: 2,
          skipped: 0,
          credits: 3,
          look: "keep",
          border: "keep",
          set_symbol: "none",
          watermark: "keep",
          art: "ai",
          style: DEFAULT_BULK_CHOICES.artStyle,
          visibility: "public",
        },
      ],
    ]);
    expect(m.event).toHaveBeenCalledWith(recorded("start"));
  });
});
