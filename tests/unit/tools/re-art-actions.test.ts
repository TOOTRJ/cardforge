import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Re-art deck's start (lib/tools/re-art/actions.ts): the tool's gate first;
// the saved-card limit (only the real cards it makes take a slot) and the
// credits are judged BEFORE the job row exists; one run of a deck at a time
// (a run still painting is waited for, an older stopped run is closed); the
// style the run paints in is saved first and the plan carries its version.
//
// And what each action tells the tool's log (lib/tools/events.ts, after the
// response): its own name when it worked — a run's start by what it is
// (`start`, `start_sample`, `paint_one`, `reroll`) — `<name>_failed` with a
// `reason` code when it didn't. Counts and codes, never a name.
// ---------------------------------------------------------------------------

const m = vi.hoisted(() => ({
  access: vi.fn(),
  event: vi.fn(),
  insert: vi.fn(),
  plan: vi.fn(),
  saveStyle: vi.fn(),
  capacity: vi.fn(),
  balance: vi.fn(),
  billing: vi.fn(),
  daily: vi.fn(),
  gateway: vi.fn(),
  open: vi.fn(),
  cancel: vi.fn(),
  deck: vi.fn(),
  painted: vi.fn(),
  update: vi.fn(),
  writePainted: vi.fn(),
  discard: vi.fn(),
  discardUnused: vi.fn(),
  card: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/tools/queries", () => ({ checkToolAccess: m.access }));
vi.mock("@/lib/tools/events", () => ({ recordToolEvent: m.event, recordToolEventLater: m.event }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: m.card(), error: null }),
        filter: async () => ({ data: m.open(), error: null }),
        insert: (row: unknown) => {
          m.insert(row);
          return {
            select: () => ({ single: async () => ({ data: { id: "job-1", kind: "deck_reart", steps: (row as { steps: unknown }).steps }, error: null }) }),
          };
        },
      };
      return chain;
    },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  isAdminConfigured: () => true,
  createAdminClient: () => ({
    from: () => ({
      update: (patch: unknown) => ({ in: (_c: string, ids: string[]) => ({ eq: async () => m.cancel(patch, ids) }) }),
    }),
  }),
}));
vi.mock("@/lib/cards/capacity", () => ({ getCardCapacity: m.capacity }));
vi.mock("@/lib/billing/flags", () => ({ isBillingEnabled: m.billing }));
vi.mock("@/lib/ai/rate-limit", () => ({
  DECK_CARDS_DAILY_LIMIT: 50,
  checkDailyActionLimit: m.daily,
  getFreshCreditBalance: m.balance,
}));
vi.mock("@/lib/ai/provider", () => ({ isGatewayConfigured: m.gateway }));
vi.mock("@/lib/ai/random-art", () => ({ discardGeneratedArt: m.discard }));
vi.mock("@/lib/cards/actions", () => ({ updateCardAction: m.update }));
vi.mock("@/lib/tools/re-art/server", () => ({
  planReartRun: m.plan,
  saveDeckStyle: m.saveStyle,
  getOwnedDeck: m.deck,
  readPaintedCards: m.painted,
  writePaintedCard: m.writePainted,
  discardReartArtIfUnused: m.discardUnused,
  planLines: (plan: { entries: unknown[] }) => plan.entries,
}));

import {
  planReartAction,
  restoreReartArtAction,
  saveReartStyleAction,
  startReartAction,
} from "@/lib/tools/re-art/actions";

const DECK = "00000000-0000-4000-8000-0000000000d1";
const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const STYLE = { preset: "storybook", theme: "a goblin warren" };

/** The lines the action wrote to the tool's log, as `[event, props]`. */
function logged(): Array<[string, Record<string, unknown> | undefined]> {
  return m.event.mock.calls.map(([input]) => {
    expect(input).toMatchObject({ slug: "re-art-deck", userId: "u1", access: "grant" });
    // Never a deck's or a card's name, the style's words or an id.
    expect(JSON.stringify(input.props ?? {})).not.toMatch(/Sampler|Card \d|goblin|0000-4000|Cinderwing/i);
    expect(Object.keys(input.props ?? {}).length).toBeLessThanOrEqual(12);
    return [input.event, input.props];
  });
}

function planned(entries: Array<{ kind: "own" | "printing"; credits?: number; paintedBefore?: boolean }>) {
  return {
    ok: true,
    deck: { id: DECK, slug: "s", title: "Sampler", visibility: "private" },
    style: STYLE,
    version: 2,
    styleChanged: true,
    skipped: [{ name: "Cinderwing Matriarch", reason: "Another creator's card keeps its own art." }],
    inStyle: 0,
    entries: entries.map((entry, i) => ({
      entryId: ID(i + 1),
      name: `Card ${i}`,
      kind: entry.kind,
      credits: entry.credits ?? 1,
      cardId: entry.kind === "own" ? `card-${i}` : null,
      repaint: false,
      paintedBefore: entry.paintedBefore ?? false,
      notes: [],
    })),
  };
}

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset();
  m.access.mockResolvedValue({ userId: "u1", via: "grant" });
  m.gateway.mockReturnValue(true);
  m.billing.mockReturnValue(true);
  m.balance.mockResolvedValue(100);
  m.capacity.mockResolvedValue({ used: 10, cap: 50, tier: "pro" });
  m.saveStyle.mockResolvedValue({ ...STYLE, version: 2 });
  m.open.mockReturnValue([]);
  m.plan.mockResolvedValue(planned([{ kind: "printing" }, { kind: "own", credits: 2 }]));
});

describe("startReartAction", () => {
  it("a closed tool starts nothing", async () => {
    m.access.mockResolvedValue(null);
    expect((await startReartAction({ deckId: DECK, style: STYLE })).ok).toBe(false);
    expect(m.plan).not.toHaveBeenCalled();
    expect(m.insert).not.toHaveBeenCalled();
    expect(m.event).not.toHaveBeenCalled();
  });

  it("plans on the commit quota and inserts one deck_reart job, a step a card, each priced", async () => {
    const result = await startReartAction({ deckId: DECK, style: STYLE });
    expect(result).toMatchObject({ ok: true, credits: 3, version: 2 });
    expect(m.plan.mock.calls[0][2]).toBe("deck_import_commit");
    const row = m.insert.mock.calls[0][0];
    expect(row.kind).toBe("deck_reart");
    expect(row.deck_id).toBeNull();
    expect(row.request).toMatchObject({ deck_id: DECK, cards: 2, makes: 1, credits: 3 });
    expect(row.plan.style).toEqual({ ...STYLE, version: 2 });
    expect(row.plan.entries.map((e: { kind: string }) => e.kind)).toEqual(["printing", "own"]);
    expect(row.steps).toEqual([
      { key: "reart:0", label: "Card 0", status: "pending" },
      { key: "reart:1", label: "Card 1", status: "pending", credits: 2 },
    ]);
    expect(m.saveStyle).toHaveBeenCalledWith("u1", DECK, STYLE);
    expect(logged()).toEqual([
      [
        "start",
        {
          cards: 2,
          makes: 1,
          credits: 3,
          skipped: 1,
          in_style: 0,
          scope: "all",
          preset: "storybook",
          style_changed: true,
          visibility: "private",
        },
      ],
    ]);
  });

  it("logs a run by what it is: a sample, a first paint of one card, a re-roll", async () => {
    await startReartAction({ deckId: DECK, style: STYLE, entryIds: [ID(1), ID(2)], sample: true });
    // One named card Re-art never painted on this deck: `paint_one`.
    m.plan.mockResolvedValue(planned([{ kind: "own" }]));
    await startReartAction({ deckId: DECK, entryIds: [ID(1)] });
    m.plan.mockResolvedValue(planned([{ kind: "printing" }]));
    await startReartAction({ deckId: DECK, entryIds: [ID(1)] });
    // …and one it has: a `reroll`.
    m.plan.mockResolvedValue(planned([{ kind: "own", paintedBefore: true }]));
    await startReartAction({ deckId: DECK, entryIds: [ID(1)] });
    expect(logged().map(([event]) => event)).toEqual(["start_sample", "paint_one", "paint_one", "reroll"]);
    // The job's own request is as it was: named cards that aren't a sample.
    expect(m.insert.mock.calls.map(([row]) => [row.request.sample, row.request.reroll])).toEqual([
      [true, false],
      [false, true],
      [false, true],
      [false, true],
    ]);
  });

  it("the job makes its cards private unless the run names a visibility (owner 2026-11-10)", async () => {
    await startReartAction({ deckId: DECK, style: STYLE });
    expect(m.insert.mock.calls[0][0].plan.visibility).toBe("private");
    await startReartAction({ deckId: DECK, style: STYLE, visibility: "public" });
    expect(m.insert.mock.calls[1][0].plan.visibility).toBe("public");
    await startReartAction({ deckId: DECK, style: STYLE, visibility: "unlisted" });
    expect(m.insert.mock.calls[2][0].plan.visibility).toBe("unlisted");
  });

  it("only the real cards it makes count against the card limit", async () => {
    m.capacity.mockResolvedValue({ used: 49, cap: 50, tier: "free" });
    expect((await startReartAction({ deckId: DECK, style: STYLE })).ok).toBe(true);
    m.plan.mockResolvedValue(planned([{ kind: "printing" }, { kind: "printing" }]));
    const result = await startReartAction({ deckId: DECK, style: STYLE });
    expect(result).toMatchObject({ ok: false, code: "CARD_CAPACITY" });
    expect(logged()[1]).toEqual(["start_failed", { reason: "capacity", mode: "deck", cards: 2, makes: 2 }]);
  });

  it("short of credits → INSUFFICIENT_CREDITS before any job", async () => {
    m.balance.mockResolvedValue(2);
    const result = await startReartAction({ deckId: DECK, style: STYLE });
    expect(result).toMatchObject({ ok: false, code: "INSUFFICIENT_CREDITS" });
    expect(m.insert).not.toHaveBeenCalled();
    expect(m.saveStyle).not.toHaveBeenCalled();
    expect(logged()).toEqual([
      ["start_failed", { reason: "insufficient_credits", mode: "deck", cards: 2, makes: 1, credits: 3 }],
    ]);
  });

  it("billing off: the daily picture limit decides", async () => {
    m.billing.mockReturnValue(false);
    m.daily.mockResolvedValue({ ok: false, message: "Daily limit.", retryAfterSeconds: 60 });
    expect(await startReartAction({ deckId: DECK, style: STYLE })).toMatchObject({ ok: false, code: "RATE_LIMITED" });
    expect(m.daily.mock.calls[0][1]).toBe("deck_reart_art");
    expect(logged()).toEqual([["start_failed", { reason: "daily_limit", mode: "deck", cards: 2, makes: 1 }]]);
  });

  it("waits for a run of the deck still painting; closes an older stopped one", async () => {
    m.open.mockReturnValue([{ id: "old-1", steps: [{ status: "running", claimed_at: new Date().toISOString() }] }]);
    expect(await startReartAction({ deckId: DECK, style: STYLE })).toMatchObject({ ok: false, code: "BUSY" });
    expect(m.insert).not.toHaveBeenCalled();
    expect(logged()).toEqual([["start_failed", { reason: "busy", mode: "deck" }]]);

    m.open.mockReturnValue([{ id: "old-2", steps: [{ status: "pending" }] }]);
    expect((await startReartAction({ deckId: DECK, style: STYLE })).ok).toBe(true);
    expect(m.cancel).toHaveBeenCalledWith({ status: "cancelled" }, ["old-2"]);
  });

  it("nothing left to paint is said, and no job is made", async () => {
    m.plan.mockResolvedValue({ ...planned([]), inStyle: 4 });
    const result = await startReartAction({ deckId: DECK, style: STYLE });
    expect(result).toMatchObject({ ok: false });
    expect(m.insert).not.toHaveBeenCalled();
    expect(logged()).toEqual([["start_failed", { reason: "all_in_style", mode: "deck" }]]);
  });

  it("no AI → nothing starts", async () => {
    m.gateway.mockReturnValue(false);
    expect((await startReartAction({ deckId: DECK, style: STYLE })).ok).toBe(false);
    expect(m.plan).not.toHaveBeenCalled();
    expect(logged()).toEqual([["start_failed", { reason: "ai_unavailable", mode: "deck" }]]);
  });

  it("a plan that was refused is logged with its own code, a style that couldn't be saved too", async () => {
    m.plan.mockResolvedValue({ ok: false, error: "Slow down.", code: "RATE_LIMITED", retryAfterSeconds: 30 });
    expect((await startReartAction({ deckId: DECK, style: STYLE, entryIds: [ID(1)], sample: true })).ok).toBe(false);
    m.plan.mockResolvedValue({ ok: false, error: "That deck isn't one of yours." });
    expect((await startReartAction({ deckId: DECK, entryIds: [ID(1)] })).ok).toBe(false);
    m.plan.mockResolvedValue(planned([{ kind: "own" }]));
    m.saveStyle.mockResolvedValue(null);
    expect((await startReartAction({ deckId: DECK, style: STYLE })).ok).toBe(false);
    expect(logged()).toEqual([
      ["start_failed", { reason: "rate_limited", mode: "sample" }],
      ["start_failed", { reason: "plan_refused", mode: "cards" }],
      ["start_failed", { reason: "style_not_saved", mode: "deck" }],
    ]);
    expect(m.insert).not.toHaveBeenCalled();
  });
});

describe("planReartAction — the confirm, as the log reads it", () => {
  it("logs what the run would paint and cost, and a plan limit in its way", async () => {
    const result = await planReartAction({ deckId: DECK, style: STYLE });
    expect(result).toMatchObject({ ok: true, cost: { cards: 2, makes: 1, credits: 3, slotsLeftAfter: 39 } });
    expect(m.plan.mock.calls[0][2]).toBe("deck_import");

    m.balance.mockResolvedValue(1);
    m.capacity.mockResolvedValue({ used: 50, cap: 50, tier: "free" });
    await planReartAction({ deckId: DECK, entryIds: [ID(1)] });
    const base = { cards: 2, makes: 1, credits: 3, skipped: 1, in_style: 0, style_changed: true };
    expect(logged()).toEqual([
      ["plan", { mode: "deck", ...base, over_capacity: false, short_of_credits: false }],
      ["plan", { mode: "cards", ...base, over_capacity: true, short_of_credits: true }],
    ]);
  });

  it("a plan that can't be made is `plan_failed`; a closed tool logs nothing", async () => {
    m.plan.mockResolvedValue({ ok: false, error: "Pick the deck's style first." });
    expect((await planReartAction({ deckId: DECK })).ok).toBe(false);
    expect(logged()).toEqual([["plan_failed", { reason: "plan_refused", mode: "deck" }]]);
    m.event.mockClear();
    m.access.mockResolvedValue(null);
    expect((await planReartAction({ deckId: DECK })).ok).toBe(false);
    expect(m.event).not.toHaveBeenCalled();
  });
});

describe("saveReartStyleAction", () => {
  it("logs the preset and the size of the words, never the words", async () => {
    m.deck.mockResolvedValue({ id: DECK, slug: "s", title: "Sampler", visibility: "private" });
    expect(await saveReartStyleAction(DECK, STYLE)).toMatchObject({ ok: true, version: 2 });
    expect(logged()).toEqual([["save_style", { preset: "storybook", theme_chars: STYLE.theme.length, version: 2 }]]);
    m.event.mockClear();
    m.saveStyle.mockResolvedValue(null);
    expect((await saveReartStyleAction(DECK, STYLE)).ok).toBe(false);
    expect(logged()).toEqual([["save_style_failed", { reason: "not_saved" }]]);
  });
});

describe("restoreReartArtAction", () => {
  const CARD = "00000000-0000-4000-8000-0000000000c1";
  const ART = (n: string) => `https://x.supabase.co/storage/v1/object/public/card-art/u1/${n}`;
  const row = {
    cardId: CARD,
    entryId: null,
    styleVersion: 2,
    artUrl: ART("ai-front.jpg"),
    backArtUrl: ART("ai-back.jpg"),
    made: false,
    previousArtUrl: ART("mine.png"),
    previousArtPosition: { x: 0.5, y: 0.5, zoom: 1 },
    previousBackArtUrl: null,
    previousBackArtPosition: null,
    previousArtistCredit: "Jane Painter",
    previousBackArtistCredit: null,
    paintedAt: "",
  };

  beforeEach(() => {
    m.deck.mockResolvedValue({ id: DECK, slug: "s", title: "S", visibility: "private" });
    m.painted.mockResolvedValue(new Map([[CARD, row]]));
    m.card.mockReturnValue({
      id: CARD,
      owner_id: "u1",
      art_url: ART("ai-front.jpg"),
      back_face: { title: "Back", card_type: "creature", subtypes: [], art_url: ART("ai-back.jpg"), artist_credit: "AI" },
    });
    m.update.mockResolvedValue({ ok: true, cardId: CARD, slug: "c" });
    m.writePainted.mockResolvedValue(true);
  });

  it("puts back the art, its fit and its credit; a back that had no art gets none (no null in the back)", async () => {
    expect(await restoreReartArtAction(DECK, CARD)).toEqual({ ok: true });
    const payload = m.update.mock.calls[0][1];
    expect(payload).toMatchObject({ art_url: ART("mine.png"), artist_credit: "Jane Painter" });
    expect(payload.back_face).toEqual({ title: "Back", card_type: "creature", subtypes: [] });
    // The pictures taken off go to the guarded discard (never removed
    // outright: a remix of the card can still show them), both faces, after
    // the card's edit landed.
    expect(m.discardUnused.mock.calls).toEqual([
      ["u1", ART("ai-front.jpg")],
      ["u1", ART("ai-back.jpg")],
    ]);
    expect(m.discard).not.toHaveBeenCalled();
    expect(m.update.mock.invocationCallOrder[0]).toBeLessThan(m.discardUnused.mock.invocationCallOrder[0]);
    expect(m.writePainted.mock.calls[0][3]).toMatchObject({ artUrl: null, previousArtUrl: null, styleVersion: 2 });
    expect(logged()).toEqual([["restore", { faces: 2 }]]);
  });

  it("refuses a card whose art changed since, and a card Re-art made", async () => {
    m.card.mockReturnValue({ id: CARD, owner_id: "u1", art_url: ART("hand.png"), back_face: null });
    expect((await restoreReartArtAction(DECK, CARD)).ok).toBe(false);
    m.painted.mockResolvedValue(new Map([[CARD, { ...row, made: true }]]));
    expect((await restoreReartArtAction(DECK, CARD)).ok).toBe(false);
    expect(m.update).not.toHaveBeenCalled();
    expect(logged()).toEqual([
      ["restore_failed", { reason: "art_changed" }],
      ["restore_failed", { reason: "no_earlier_art" }],
    ]);
  });

  it("an edit the card action refused is `restore_failed`", async () => {
    m.update.mockResolvedValue({ ok: false, formError: "No." });
    expect((await restoreReartArtAction(DECK, CARD)).ok).toBe(false);
    expect(logged()).toEqual([["restore_failed", { reason: "save_failed" }]]);
  });
});
