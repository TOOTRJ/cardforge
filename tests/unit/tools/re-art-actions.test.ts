import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Re-art deck's start (lib/tools/re-art/actions.ts): the tool's gate first;
// the saved-card limit (only the real cards it makes take a slot) and the
// credits are judged BEFORE the job row exists; one run of a deck at a time
// (a run still painting is waited for, an older stopped run is closed); the
// style the run paints in is saved first and the plan carries its version.
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
  card: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/tools/queries", () => ({ checkToolAccess: m.access }));
vi.mock("@/lib/tools/events", () => ({ recordToolEvent: m.event }));
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
  planLines: (plan: { entries: unknown[] }) => plan.entries,
}));

import { restoreReartArtAction, startReartAction } from "@/lib/tools/re-art/actions";

const DECK = "00000000-0000-4000-8000-0000000000d1";
const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const STYLE = { preset: "storybook", theme: "a goblin warren" };

function planned(entries: Array<{ kind: "own" | "printing"; credits?: number }>) {
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
  });

  it("short of credits → INSUFFICIENT_CREDITS before any job", async () => {
    m.balance.mockResolvedValue(2);
    const result = await startReartAction({ deckId: DECK, style: STYLE });
    expect(result).toMatchObject({ ok: false, code: "INSUFFICIENT_CREDITS" });
    expect(m.insert).not.toHaveBeenCalled();
    expect(m.saveStyle).not.toHaveBeenCalled();
  });

  it("billing off: the daily picture limit decides", async () => {
    m.billing.mockReturnValue(false);
    m.daily.mockResolvedValue({ ok: false, message: "Daily limit.", retryAfterSeconds: 60 });
    expect(await startReartAction({ deckId: DECK, style: STYLE })).toMatchObject({ ok: false, code: "RATE_LIMITED" });
    expect(m.daily.mock.calls[0][1]).toBe("deck_reart_art");
  });

  it("waits for a run of the deck still painting; closes an older stopped one", async () => {
    m.open.mockReturnValue([{ id: "old-1", steps: [{ status: "running", claimed_at: new Date().toISOString() }] }]);
    expect(await startReartAction({ deckId: DECK, style: STYLE })).toMatchObject({ ok: false, code: "BUSY" });
    expect(m.insert).not.toHaveBeenCalled();

    m.open.mockReturnValue([{ id: "old-2", steps: [{ status: "pending" }] }]);
    expect((await startReartAction({ deckId: DECK, style: STYLE })).ok).toBe(true);
    expect(m.cancel).toHaveBeenCalledWith({ status: "cancelled" }, ["old-2"]);
  });

  it("nothing left to paint is said, and no job is made", async () => {
    m.plan.mockResolvedValue({ ...planned([]), inStyle: 4 });
    const result = await startReartAction({ deckId: DECK, style: STYLE });
    expect(result).toMatchObject({ ok: false });
    expect(m.insert).not.toHaveBeenCalled();
  });

  it("no AI → nothing starts", async () => {
    m.gateway.mockReturnValue(false);
    expect((await startReartAction({ deckId: DECK, style: STYLE })).ok).toBe(false);
    expect(m.plan).not.toHaveBeenCalled();
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
    expect(m.discard).toHaveBeenCalledWith("u1", ART("ai-front.jpg"));
    expect(m.writePainted.mock.calls[0][3]).toMatchObject({ artUrl: null, previousArtUrl: null, styleVersion: 2 });
  });

  it("refuses a card whose art changed since, and a card Re-art made", async () => {
    m.card.mockReturnValue({ id: CARD, owner_id: "u1", art_url: ART("hand.png"), back_face: null });
    expect((await restoreReartArtAction(DECK, CARD)).ok).toBe(false);
    m.painted.mockResolvedValue(new Map([[CARD, { ...row, made: true }]]));
    expect((await restoreReartArtAction(DECK, CARD)).ok).toBe(false);
    expect(m.update).not.toHaveBeenCalled();
  });
});
