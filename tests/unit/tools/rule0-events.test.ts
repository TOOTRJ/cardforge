import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chainClient } from "@/tests/stubs/supabase-chain";

// ---------------------------------------------------------------------------
// What the Rule 0 table sheet records (tool_events — the admin's "started,
// worked, failed, cost" for the tool): a success under the action's name, a
// refusal under `<name>_failed` with a `reason` code, the AI draft's
// `credits` and whether a taken credit went back (`refunded`). Always after
// the response (recordToolEventLater), never awaited — here the recorder
// answers a promise that never settles, so an action that waited for its own
// bookkeeping would never answer. Never the deck's title, the owner's words
// or an id.
// ---------------------------------------------------------------------------

const USER = "11111111-1111-4111-8111-111111111111";
const DECK = "22222222-2222-4222-8222-222222222222";
const PLAN = "Ramp into dragons and burn the table.";

type Recorded = { slug: string; userId: string | null; event: string; access: string | null; props?: unknown };

const m = vi.hoisted(() => ({
  access: null as null | { userId: string; via: string },
  aiConfigured: true,
  deck: null as null | Record<string, unknown>,
  sheetError: null as null | { message: string },
  items: [] as Array<{ entry: Record<string, unknown>; card: null }>,
  rate: { ok: true } as { ok: true } | { ok: false; reason: "per_minute" | "per_day"; retryAfterSeconds: number; message: string },
  spend: { ok: true, balance: 4, charged: true } as
    | { ok: true; balance: number; charged: boolean }
    | { ok: false; reason: "insufficient_credits" | "error"; balance: number; message: string },
  refundLands: true,
  refunds: 0,
  settled: [] as string[],
  draft: null as null | { gamePlan: string; winConditions: string[] } | Error,
  events: [] as Recorded[],
  plainWrites: 0,
}));

vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/supabase/admin", () => ({ isAdminConfigured: () => false, createAdminClient: () => ({}) }));
vi.mock("@/lib/supabase/server", () => {
  const db = chainClient((table) => {
    if (table === "decks") return { data: m.deck, error: null };
    if (table === "deck_table_sheets") {
      if (m.sheetError) return { data: null, error: m.sheetError };
      return {
        data: {
          deck_id: "22222222-2222-4222-8222-222222222222",
          game_plan: "Ramp into dragons and burn the table.",
          win_conditions: "Dragons\nBurn",
          table_notes: null,
          shared: true,
          ai_drafted_at: null,
          updated_at: "2026-11-10T00:00:00Z",
        },
        error: null,
      };
    }
    return { data: null, error: null };
  });
  return { createClient: async () => ({ from: db.client.from }) };
});
vi.mock("@/lib/tools/queries", () => ({ checkToolAccess: async () => m.access }));
vi.mock("@/lib/tools/events", () => ({
  recordToolEvent: async () => {
    m.plainWrites += 1;
  },
  recordToolEventLater: (input: Recorded) => {
    m.events.push(input);
    // Never settles: an action that awaited it would hang its test.
    return new Promise(() => undefined);
  },
}));
vi.mock("@/lib/ai/provider", () => ({ isDesignAiConfigured: () => m.aiConfigured }));
vi.mock("@/lib/ai/rate-limit", () => ({
  checkAiRateLimit: async () => m.rate,
  getFreshCreditBalance: async () => 3,
  logAiCall: async () => undefined,
  refundCredits: async () => {
    m.refunds += 1;
    return m.refundLands;
  },
  settleSpend: async (ref: string) => {
    m.settled.push(ref);
  },
  spendCredits: async () => m.spend,
}));
vi.mock("@/lib/ai/structured-output", () => ({
  withAiTimeBudget: (_startedAt: number, _maxDuration: number, work: () => Promise<unknown>) => work(),
}));
vi.mock("@/lib/billing/flags", () => ({ isBillingEnabled: () => false }));
vi.mock("@/lib/billing/credit-reconcile", () => ({ reconcileUserSpends: async () => undefined }));
vi.mock("@/lib/decks/queries", () => ({ listDeckCards: async () => m.items }));
vi.mock("@/lib/decks/analytics", () => ({
  countsTowardDeckStats: (board: string) => board === "main" || board === "commander",
}));
vi.mock("@/lib/tools/rule0/ai-draft", () => ({
  draftTableSheet: async () => {
    if (m.draft instanceof Error) throw m.draft;
    return m.draft;
  },
}));

import { saveTableSheetAction, setTableSheetSharedAction } from "@/lib/tools/rule0/actions";
import { POST } from "@/app/api/tools/rule0-sheet/draft/route";

const entry = (name: string, board = "main") => ({
  entry: { name, quantity: 1, board, type_line: "Creature — Dragon" },
  card: null,
});
const post = (body: unknown = { deckId: DECK }) =>
  POST(new Request("http://x/api/tools/rule0-sheet/draft", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }));
const recorded = () => m.events.map((e) => [e.event, e.props]);
const TEXT = { gamePlan: PLAN, winConditions: "Dragons\nBurn", tableNotes: "" };

beforeEach(() => {
  m.access = { userId: USER, via: "grant" };
  m.aiConfigured = true;
  m.deck = { id: DECK, slug: "wolf-pack", title: "Wolf Pack", description: null, format: "commander", bracket: 3, visibility: "public", owner_id: USER };
  m.sheetError = null;
  m.items = [entry("Shivan Dragon"), entry("Lathliss, Dragon Queen", "commander"), entry("Maybe Card", "maybe")];
  m.rate = { ok: true };
  m.spend = { ok: true, balance: 4, charged: true };
  m.refundLands = true;
  m.refunds = 0;
  m.settled = [];
  m.draft = { gamePlan: PLAN, winConditions: ["Dragons", "Burn"] };
  m.events = [];
  m.plainWrites = 0;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  // Every event is the tool's, under the user and the path that let them in…
  for (const event of m.events) {
    expect([event.slug, event.userId, event.access]).toEqual(["rule0-sheet", USER, "grant"]);
    // …and carries no title, no words of the owner's, no id.
    expect(JSON.stringify(event.props ?? {})).not.toMatch(/wolf|dragon|burn|ramp|2222|1111/i);
  }
  // The awaited write is never used by an action.
  expect(m.plainWrites).toBe(0);
});

describe("saving the sheet", () => {
  it("records the save: which parts are written, never their words", async () => {
    expect(await saveTableSheetAction(DECK, TEXT)).toMatchObject({ ok: true });
    expect(recorded()).toEqual([["save", { plan: true, win_conditions: 2, notes: false }]]);
  });

  it("a deck that isn't the caller's: save_failed, not_owner", async () => {
    m.deck = null;
    expect(await saveTableSheetAction(DECK, TEXT)).toMatchObject({ ok: false, error: expect.stringContaining("owner") });
    expect(recorded()).toEqual([["save_failed", { reason: "not_owner" }]]);
  });

  it("a write the database refuses: save_failed, write_failed", async () => {
    m.sheetError = { message: "connection reset" };
    expect(await saveTableSheetAction(DECK, TEXT)).toMatchObject({ ok: false });
    expect(recorded()).toEqual([["save_failed", { reason: "write_failed" }]]);
  });

  it("records nothing where nobody is known yet: a field error, a bad deck id, a closed tool", async () => {
    expect(await saveTableSheetAction(DECK, { ...TEXT, gamePlan: "x".repeat(5000) })).toMatchObject({ ok: false, fieldErrors: expect.anything() });
    expect(await saveTableSheetAction("nope", TEXT)).toMatchObject({ ok: false });
    m.access = null;
    expect(await saveTableSheetAction(DECK, TEXT)).toMatchObject({ ok: false });
    expect(await setTableSheetSharedAction(DECK, true)).toMatchObject({ ok: false });
    expect(m.events).toEqual([]);
  });
});

describe("sharing the sheet", () => {
  it("records share_on / share_off with the deck's visibility", async () => {
    expect(await setTableSheetSharedAction(DECK, true)).toMatchObject({ ok: true });
    m.deck = { ...m.deck, visibility: "unlisted" };
    expect(await setTableSheetSharedAction(DECK, false)).toMatchObject({ ok: true });
    expect(recorded()).toEqual([
      ["share_on", { visibility: "public" }],
      ["share_off", { visibility: "unlisted" }],
    ]);
  });

  it("a private deck can't be shared: share_failed, private_deck", async () => {
    m.deck = { ...m.deck, visibility: "private" };
    expect(await setTableSheetSharedAction(DECK, true)).toMatchObject({ ok: false, error: expect.stringContaining("private") });
    expect(recorded()).toEqual([["share_failed", { reason: "private_deck", shared: true }]]);
  });

  it("not the owner's deck, and a write that fails", async () => {
    m.deck = null;
    await setTableSheetSharedAction(DECK, true);
    m.deck = { id: DECK, slug: "wolf-pack", visibility: "unlisted", owner_id: USER };
    m.sheetError = { message: "connection reset" };
    await setTableSheetSharedAction(DECK, false);
    expect(recorded()).toEqual([
      ["share_failed", { reason: "not_owner", shared: true }],
      ["share_failed", { reason: "write_failed", shared: false, visibility: "unlisted" }],
    ]);
  });
});

describe("the AI draft", () => {
  it("a draft delivered: ai_draft with the credit charged, what it wrote and how long it took", async () => {
    const response = await post();
    expect(response.status).toBe(200);
    expect(m.settled).toHaveLength(1);
    // The deck's own cards (the maybeboard is not the deck).
    expect(recorded()).toEqual([
      ["ai_draft", { cards: 2, win_conditions: 2, saved: true, plan: true, credits: 1, ms: expect.any(Number) }],
    ]);
  });

  it("a draft the sheet couldn't keep is still a draft: saved false", async () => {
    m.sheetError = { message: "connection reset" };
    expect((await post()).status).toBe(200);
    expect(recorded()).toEqual([
      ["ai_draft", { cards: 2, win_conditions: 2, saved: false, plan: true, credits: 1, ms: expect.any(Number) }],
    ]);
  });

  it("a caller who isn't charged (an admin, billing off): credits 0", async () => {
    m.spend = { ok: true, balance: Number.POSITIVE_INFINITY, charged: false };
    m.draft = { gamePlan: "", winConditions: ["Dragons"] };
    expect((await post()).status).toBe(200);
    expect(m.settled).toEqual([]);
    expect(recorded()).toEqual([
      ["ai_draft", { cards: 2, win_conditions: 1, saved: true, plan: false, credits: 0, ms: expect.any(Number) }],
    ]);
  });

  it("a closed tool answers 404 and records nothing", async () => {
    m.access = null;
    expect((await post()).status).toBe(404);
    expect(m.events).toEqual([]);
  });

  it("every refusal before the charge is ai_draft_failed with its reason", async () => {
    m.aiConfigured = false;
    expect((await post()).status).toBe(503);
    m.aiConfigured = true;
    expect((await post("not json")).status).toBe(400);
    expect((await post({ deckId: "nope" })).status).toBe(400);
    m.deck = null;
    expect((await post()).status).toBe(404);
    m.deck = { id: DECK, slug: "wolf-pack", title: "Wolf Pack", description: null, format: "commander", bracket: 3 };
    m.items = [entry("Maybe Card", "maybe")];
    expect((await post()).status).toBe(400);
    m.items = [entry("Shivan Dragon")];
    m.rate = { ok: false, reason: "per_day", retryAfterSeconds: 60, message: "Slow down." };
    expect((await post()).status).toBe(429);
    m.rate = { ok: true };
    m.spend = { ok: false, reason: "insufficient_credits", balance: 0, message: "Out of credits." };
    expect((await post()).status).toBe(402);
    m.spend = { ok: false, reason: "error", balance: Number.NaN, message: "Try again." };
    expect((await post()).status).toBe(503);
    expect(recorded()).toEqual([
      ["ai_draft_failed", { reason: "ai_unavailable" }],
      ["ai_draft_failed", { reason: "invalid" }],
      ["ai_draft_failed", { reason: "invalid" }],
      ["ai_draft_failed", { reason: "not_owner" }],
      ["ai_draft_failed", { reason: "empty_deck" }],
      ["ai_draft_failed", { reason: "rate_limited", window: "per_day", cards: 1 }],
      ["ai_draft_failed", { reason: "insufficient_credits", cards: 1 }],
      ["ai_draft_failed", { reason: "credit_check_failed", cards: 1 }],
    ]);
    expect(m.refunds).toBe(0);
  });

  it("the AI failing after the charge: the failure's kind and that the credit went back — never a `credits` spent", async () => {
    m.draft = new Error("429 rate limit exceeded");
    expect((await post()).status).toBe(502);
    const unreadable = new Error("no object");
    unreadable.name = "AiOutputError";
    m.draft = unreadable;
    expect((await post()).status).toBe(502);
    expect(m.refunds).toBe(2);
    expect(m.settled).toEqual([]);
    expect(recorded()).toEqual([
      ["ai_draft_failed", { reason: "design_busy", refunded: true, refund_pending: false, cards: 2, ms: expect.any(Number) }],
      ["ai_draft_failed", { reason: "design_unreadable", refunded: true, refund_pending: false, cards: 2, ms: expect.any(Number) }],
    ]);
  });

  it("a refund that didn't land is pending, not refunded; an uncharged caller has none to give back", async () => {
    m.draft = new Error("something broke");
    m.refundLands = false;
    expect((await post()).status).toBe(502);
    m.spend = { ok: true, balance: Number.POSITIVE_INFINITY, charged: false };
    expect((await post()).status).toBe(502);
    expect(m.refunds).toBe(1);
    expect(recorded()).toEqual([
      ["ai_draft_failed", { reason: "design_failed", refunded: false, refund_pending: true, cards: 2, ms: expect.any(Number) }],
      ["ai_draft_failed", { reason: "design_failed", refunded: false, refund_pending: false, cards: 2, ms: expect.any(Number) }],
    ]);
  });
});
