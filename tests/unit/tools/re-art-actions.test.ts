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
  saveWords: vi.fn(),
  card: vi.fn(),
  storedStyle: vi.fn(),
  licence: vi.fn(),
  keep: vi.fn(),
  drop: vi.fn(),
  prune: vi.fn(),
  claim: vi.fn(),
  paintedAdmin: vi.fn(),
  paintedRows: vi.fn(),
  revert: vi.fn(),
  bakedBack: vi.fn(),
  credit: vi.fn(),
  isKept: vi.fn(),
  exists: vi.fn(),
  cardLocked: vi.fn(),
  locks: vi.fn(),
  setLocks: vi.fn(),
  rolls: vi.fn(),
  unlink: vi.fn(),
  job: vi.fn(),
  cards: vi.fn(),
  entries: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/tools/queries", () => ({ checkToolAccess: m.access }));
vi.mock("@/lib/tools/events", () => ({ recordToolEvent: m.event, recordToolEventLater: m.event }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        // One row: a run (an undo reads its own job) or a card.
        maybeSingle: async () => ({ data: table === "ai_generation_jobs" ? m.job() : m.card(), error: null }),
        filter: async () => ({ data: m.open(), error: null }),
        // A list, awaited as it stands (an undo's cards and deck entries).
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve(table === "cards" ? m.cards() : table === "deck_cards" ? m.entries() : { data: [], error: null }).then(resolve),
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
vi.mock("@/lib/cards/faces", () => ({ rowHasBakedBack: m.bakedBack }));
vi.mock("@/lib/ai/artist-credit", () => ({ aiArtistCredit: m.credit }));
vi.mock("@/lib/tools/re-art/rolls", () => ({
  keepRoll: m.keep,
  dropRoll: m.drop,
  pruneRolls: m.prune,
  claimRoll: m.claim,
  isKeptPicture: m.isKept,
  readRollsOrNull: m.rolls,
}));
vi.mock("@/lib/tools/re-art/locks", () => ({ isCardLocked: m.cardLocked, readLocks: m.locks, setLocks: m.setLocks }));
vi.mock("@/lib/decks/card-actions", () => ({ unlinkDeckCardAction: m.unlink }));
vi.mock("@/lib/tools/re-art/restyle-source", () => ({ storedArtExists: m.exists }));
vi.mock("@/lib/tools/re-art/server", () => ({
  planReartRun: m.plan,
  saveDeckStyle: m.saveStyle,
  getOwnedDeck: m.deck,
  readPaintedCards: m.painted,
  writePaintedCard: m.writePainted,
  discardReartArtIfUnused: m.discardUnused,
  saveCardWords: m.saveWords,
  readDeckStyleAdmin: m.storedStyle,
  styleLicenceCheck: m.licence,
  readPaintedCardAdmin: m.paintedAdmin,
  readPaintedRowsForCardAdmin: m.paintedRows,
  revertPaintedCard: m.revert,
  planLines: (plan: { entries: unknown[] }) => plan.entries,
}));

import {
  REART_IP_NEEDS_CONFIRMATION,
  REART_IP_TOO_MANY,
  REART_PICTURE_GONE,
  REART_REFERENCE_NOT_YOURS,
  REART_UNDO_BATCH,
  REART_UNDO_SKIP_COPY,
  REART_UNLOCK_FIRST,
} from "@/lib/tools/re-art/model";
import { fitArtToWindow } from "@/lib/cards/art-fit";
import {
  chooseReartPictureAction,
  planReartAction,
  planUndoReartRunAction,
  restoreReartArtAction,
  saveReartCardWordsAction,
  saveReartStyleAction,
  setReartLocksAction,
  startReartAction,
  undoReartRunAction,
} from "@/lib/tools/re-art/actions";

const DECK = "00000000-0000-4000-8000-0000000000d1";
const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const STYLE = { preset: "storybook", theme: "a goblin warren", mode: "preset" as const, prompt: "" };
/** The maker's own prompt (0209). */
const OWN = { ...STYLE, mode: "custom" as const, prompt: "{card}. A candle-lit oil painting of a goblin warren." };

/** The lines the action wrote to the tool's log, as `[event, props]`. */
function logged(): Array<[string, Record<string, unknown> | undefined]> {
  return m.event.mock.calls.map(([input]) => {
    expect(input).toMatchObject({ slug: "re-art-deck", userId: "u1", access: "grant" });
    // Never a deck's or a card's name, the style's or a card's words or an id.
    expect(JSON.stringify(input.props ?? {})).not.toMatch(/Sampler|Card \d|goblin|0000-4000|Cinderwing|candle|librarian/i);
    expect(Object.keys(input.props ?? {}).length).toBeLessThanOrEqual(12);
    return [input.event, input.props];
  });
}

function planned(entries: Array<{ kind: "own" | "printing"; credits?: number; paintedBefore?: boolean; ownWords?: boolean }>) {
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
      ownWords: entry.ownWords ?? false,
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
  m.storedStyle.mockResolvedValue(null);
  m.licence.mockResolvedValue(null);
  m.keep.mockResolvedValue({ id: "roll-kept", inserted: true });
  m.prune.mockResolvedValue(0);
  m.bakedBack.mockReturnValue(false);
  m.credit.mockResolvedValue("dev_pro");
  m.isKept.mockResolvedValue(false);
  m.exists.mockResolvedValue("yes");
  m.paintedRows.mockResolvedValue([]);
  m.cardLocked.mockResolvedValue(false);
  m.locks.mockResolvedValue(new Set());
  m.rolls.mockResolvedValue(new Map());
  m.job.mockReturnValue(null);
  m.cards.mockReturnValue({ data: [], error: null });
  m.entries.mockReturnValue({ data: [], error: null });
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
    // No confirmation came with the run: none is passed on.
    expect(m.saveStyle).toHaveBeenCalledWith("u1", DECK, STYLE, { attested: false });
    // A style with no property and no reference picture: the plan and the
    // request are what they were before 0214, key for key.
    expect(Object.keys(row.request)).not.toContain("licensed");
    expect(Object.keys(row.request)).not.toContain("reference");
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
          mode: "preset",
          own_words: 0,
          model: "auto",
          style_changed: true,
          visibility: "private",
        },
      ],
    ]);
    // A run that names no model is Automatic, in the plan and the request.
    expect(row.plan.model).toBe("auto");
    expect(row.request.model).toBe("auto");
  });

  it("a run that names a model carries it in the plan (what the step paints with), the request and the log", async () => {
    const result = await startReartAction({ deckId: DECK, style: STYLE, model: "bfl/flux-kontext-pro" });
    // The price is the same on any model: one credit a picture.
    expect(result).toMatchObject({ ok: true, credits: 3 });
    const row = m.insert.mock.calls[0][0];
    expect(row.plan.model).toBe("bfl/flux-kontext-pro");
    expect(row.request).toMatchObject({ model: "bfl/flux-kontext-pro", credits: 3 });
    expect(row.steps).toEqual([
      { key: "reart:0", label: "Card 0", status: "pending" },
      { key: "reart:1", label: "Card 1", status: "pending", credits: 2 },
    ]);
    const [[event, props]] = logged();
    expect(event).toBe("start");
    expect(props).toMatchObject({ model: "bfl/flux-kontext-pro", credits: 3 });
    // The log takes at most twelve props: a thirteenth would be dropped.
    expect(Object.keys(props ?? {})).toHaveLength(12);
  });

  it("naming a model is for admins and testers: a plan's audience is refused before the plan, and told why", async () => {
    m.access.mockResolvedValue({ userId: "u1", via: "release", grant: null });
    const refused = await startReartAction({ deckId: DECK, style: STYLE, model: "bfl/flux-kontext-pro" });
    expect(refused.ok).toBe(false);
    expect(!refused.ok && refused.error).toMatch(/testers/);
    expect(m.plan).not.toHaveBeenCalled();
    expect(m.saveStyle).not.toHaveBeenCalled();
    expect(m.insert).not.toHaveBeenCalled();
    expect(m.event.mock.calls.map(([input]) => [input.event, input.props?.reason, input.access])).toEqual([
      ["start_failed", "model_not_allowed", "release"],
    ]);
    // Automatic is theirs as it always was…
    expect((await startReartAction({ deckId: DECK, style: STYLE })).ok).toBe(true);
    expect(m.insert.mock.calls[0][0].plan.model).toBe("auto");
    // …and a tester of a released tool (still holding the grant) names one.
    m.access.mockResolvedValue({ userId: "u1", via: "release", grant: { grantedAt: "2026-11-01T00:00:00Z", expiresAt: null } });
    expect((await startReartAction({ deckId: DECK, style: STYLE, model: "bfl/flux-kontext-pro" })).ok).toBe(true);
    expect(m.insert.mock.calls[1][0].plan.model).toBe("bfl/flux-kontext-pro");
  });

  it("a run that starts from the cards' own art carries the method in the plan and the request — and is priced the same", async () => {
    const result = await startReartAction({ deckId: DECK, style: STYLE, method: "restyle" });
    expect(result).toMatchObject({ ok: true, credits: 3 });
    const row = m.insert.mock.calls[0][0];
    expect(row.plan).toMatchObject({ method: "restyle", model: "auto" });
    expect(row.request).toMatchObject({ method: "restyle", model: "auto", credits: 3 });
    // The planner is told, so it can leave the cards with no art to start from.
    expect(m.plan.mock.calls[0][1]).toMatchObject({ method: "restyle" });
    // The start's log stays at twelve props (a thirteenth would be dropped): the method is on the job's request.
    const [[, props]] = logged();
    expect(Object.keys(props ?? {})).toHaveLength(12);
    expect(props).not.toHaveProperty("method");
    // No method named: the prompt alone.
    await startReartAction({ deckId: DECK, style: STYLE });
    expect(m.insert.mock.calls[1][0].plan.method).toBe("paint");
    expect(m.insert.mock.calls[1][0].request.method).toBe("paint");
  });

  it("starting from the cards' own art is for admins and testers: a plan's audience is refused before the plan", async () => {
    m.access.mockResolvedValue({ userId: "u1", via: "release", grant: null });
    const refused = await startReartAction({ deckId: DECK, style: STYLE, method: "restyle" });
    expect(refused.ok).toBe(false);
    expect(!refused.ok && refused.error).toMatch(/testers/);
    expect(m.plan).not.toHaveBeenCalled();
    expect(m.insert).not.toHaveBeenCalled();
    expect(m.event.mock.calls.map(([input]) => [input.event, input.props?.reason])).toEqual([["start_failed", "model_not_allowed"]]);
    // A method the tool doesn't know starts nothing, for anyone.
    m.access.mockResolvedValue({ userId: "u1", via: "grant" });
    expect((await startReartAction({ deckId: DECK, style: STYLE, method: "sketch" })).ok).toBe(false);
    expect(m.plan).not.toHaveBeenCalled();
  });

  it("a model the tool doesn't list starts nothing: no plan, no job, nothing charged", async () => {
    for (const model of ["openai/gpt-image-1", "xai/grok-imagine-image", "bfl/flux-2-flex", ""]) {
      expect((await startReartAction({ deckId: DECK, style: STYLE, model })).ok).toBe(false);
    }
    expect(m.plan).not.toHaveBeenCalled();
    expect(m.saveStyle).not.toHaveBeenCalled();
    expect(m.insert).not.toHaveBeenCalled();
  });

  it("a run in the maker's own prompt carries it in the plan (never in the log), with how many cards have their own words", async () => {
    m.saveStyle.mockResolvedValue({ ...OWN, version: 3 });
    m.plan.mockResolvedValue({ ...planned([{ kind: "own", ownWords: true }, { kind: "own" }, { kind: "printing", ownWords: true }]), style: OWN });
    expect((await startReartAction({ deckId: DECK, style: OWN })).ok).toBe(true);
    const row = m.insert.mock.calls[0][0];
    // The server-only plan holds the style the run was priced in, whole.
    expect(row.plan.style).toEqual({ ...OWN, version: 3 });
    // The entries name no words: the step reads them.
    expect(JSON.stringify(row.plan.entries)).not.toMatch(/ownWords|librarian/);
    // Nothing of the prompt reaches the owner-readable request or the log.
    expect(JSON.stringify(row.request)).not.toMatch(/candle|goblin/);
    const [[event, props]] = logged();
    expect(event).toBe("start");
    expect(props).toMatchObject({ mode: "custom", own_words: 2 });
    expect(Object.keys(props ?? {}).length).toBeLessThanOrEqual(12);
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
    expect(logged()).toEqual([
      [
        "save_style",
        { preset: "storybook", theme_chars: STYLE.theme.length, mode: "preset", prompt_chars: 0, version: 2, licensed: false, reference: false },
      ],
    ]);
    m.event.mockClear();
    // The maker's own prompt: its length, never its words; the style comes
    // back whole (the form takes it).
    m.saveStyle.mockResolvedValue({ ...OWN, version: 3 });
    expect(await saveReartStyleAction(DECK, OWN)).toEqual({ ok: true, style: OWN, version: 3 });
    expect(logged()).toEqual([
      [
        "save_style",
        { preset: "storybook", theme_chars: OWN.theme.length, mode: "custom", prompt_chars: OWN.prompt.length, version: 3, licensed: false, reference: false },
      ],
    ]);
    m.event.mockClear();
    m.saveStyle.mockResolvedValue(null);
    expect((await saveReartStyleAction(DECK, STYLE)).ok).toBe(false);
    expect(logged()).toEqual([["save_style_failed", { reason: "not_saved" }]]);
  });
});

// A deck that names a LICENSED PROPERTY, or holds a REFERENCE PICTURE
// (migration 0214): the maker's confirmation travels with the request that
// first names the property; the server's rule (styleLicenceProblem — its own
// tests are re-art-server.test.ts) is asked before anything is written; and
// the log says THAT a deck is licensed or pictured, never the name or the
// address.
describe("a licensed property and a reference picture (0214)", () => {
  const REFERENCE = "https://x.supabase.co/storage/v1/object/public/set-covers/u1/reference.webp";
  const NAMED = { ...STYLE, ipName: "Emberfall Chronicles", referenceUrl: REFERENCE };
  const noName = (value: unknown) => expect(JSON.stringify(value)).not.toMatch(/Emberfall|reference\.webp|set-covers/);

  beforeEach(() => {
    m.deck.mockResolvedValue({ id: DECK, slug: "s", title: "Sampler", visibility: "private" });
  });

  it("saving a style asks the server's rule with the property the deck names now and the confirmation, then saves with it", async () => {
    m.storedStyle.mockResolvedValue({ ...STYLE, ipName: "Tidewrights", version: 2 });
    m.saveStyle.mockResolvedValue({ ...NAMED, version: 3 });
    expect(await saveReartStyleAction(DECK, NAMED, { attested: true })).toEqual({ ok: true, style: NAMED, version: 3 });
    expect(m.licence).toHaveBeenCalledWith("u1", "Tidewrights", NAMED, true);
    expect(m.saveStyle).toHaveBeenCalledWith("u1", DECK, NAMED, { attested: true });
    const [[event, props]] = logged();
    expect(event).toBe("save_style");
    expect(props).toMatchObject({ licensed: true, reference: true, version: 3 });
    noName(props);
  });

  it("the confirmation is a boolean TRUE or it is none", async () => {
    for (const attested of [undefined, false, "true", 1, null]) {
      m.licence.mockClear();
      m.saveStyle.mockClear();
      await saveReartStyleAction(DECK, NAMED, { attested });
      expect(m.licence.mock.calls[0][3]).toBe(false);
      expect(m.saveStyle.mock.calls[0][3]).toEqual({ attested: false });
    }
    // No options at all (a caller from before 0214).
    m.saveStyle.mockClear();
    await saveReartStyleAction(DECK, STYLE);
    expect(m.saveStyle.mock.calls[0][3]).toEqual({ attested: false });
  });

  it("a style the rule refuses is not saved: the maker is told why, and the log says which rule", async () => {
    m.licence.mockResolvedValue(REART_IP_NEEDS_CONFIRMATION);
    expect(await saveReartStyleAction(DECK, NAMED)).toEqual({ ok: false, error: REART_IP_NEEDS_CONFIRMATION });
    expect(m.saveStyle).not.toHaveBeenCalled();
    expect(logged()).toEqual([["save_style_failed", { reason: "not_confirmed" }]]);
    m.event.mockClear();
    m.licence.mockResolvedValue(REART_REFERENCE_NOT_YOURS);
    expect((await saveReartStyleAction(DECK, NAMED, { attested: true })).ok).toBe(false);
    expect(logged()).toEqual([["save_style_failed", { reason: "reference_not_own" }]]);
    m.event.mockClear();
    // The day's limit on new confirmations: the tools' one word for "too many".
    m.licence.mockResolvedValue(REART_IP_TOO_MANY);
    expect(await saveReartStyleAction(DECK, NAMED, { attested: true })).toEqual({ ok: false, error: REART_IP_TOO_MANY });
    expect(logged()).toEqual([["save_style_failed", { reason: "rate_limited" }]]);
    expect(m.saveStyle).not.toHaveBeenCalled();
  });

  it("a run carries the confirmation to the plan and to the save; its plan holds the property and the picture, its request and log only that there is one", async () => {
    m.plan.mockResolvedValue({ ...planned([{ kind: "own" }]), style: NAMED });
    m.saveStyle.mockResolvedValue({ ...NAMED, version: 3 });
    expect((await startReartAction({ deckId: DECK, style: NAMED, attested: true })).ok).toBe(true);
    expect(m.plan.mock.calls[0][1]).toMatchObject({ attested: true, style: NAMED });
    expect(m.saveStyle).toHaveBeenCalledWith("u1", DECK, NAMED, { attested: true });
    const row = m.insert.mock.calls[0][0];
    // The server-only plan: what the step compares with the deck's stored style.
    expect(row.plan.style).toEqual({ ...NAMED, version: 3 });
    // The owner-readable request: that it is licensed and pictured, nothing more.
    expect(row.request).toMatchObject({ licensed: true, reference: true });
    noName(row.request);
    const [[event, props]] = logged();
    expect(event).toBe("start");
    noName(props);
    expect(Object.keys(props ?? {})).toHaveLength(12);
  });

  it("a run the plan refuses for want of the confirmation starts nothing and saves nothing", async () => {
    m.plan.mockResolvedValue({ ok: false, error: REART_IP_NEEDS_CONFIRMATION });
    const refused = await startReartAction({ deckId: DECK, style: NAMED });
    expect(refused).toMatchObject({ ok: false, error: REART_IP_NEEDS_CONFIRMATION });
    expect(m.plan.mock.calls[0][1].attested).toBeUndefined();
    expect(m.saveStyle).not.toHaveBeenCalled();
    expect(m.insert).not.toHaveBeenCalled();
    // The confirm (the plan action) is told the same, before anything is charged.
    expect(await planReartAction({ deckId: DECK, style: NAMED })).toMatchObject({ ok: false });
  });

  it("a style the save refuses after the plan (the record couldn't be written) starts no run", async () => {
    m.plan.mockResolvedValue({ ...planned([{ kind: "own" }]), style: NAMED });
    m.saveStyle.mockResolvedValue(null);
    expect(await startReartAction({ deckId: DECK, style: NAMED, attested: true })).toMatchObject({ ok: false });
    expect(m.insert).not.toHaveBeenCalled();
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
    paintedAt: "2026-11-10T10:00:00Z",
    jobId: "job-0",
    imageModel: "bfl/flux-2-pro",
    method: "paint" as const,
  };

  beforeEach(() => {
    m.deck.mockResolvedValue({ id: DECK, slug: "s", title: "S", visibility: "private" });
    m.painted.mockResolvedValue(new Map([[CARD, row]]));
    m.card.mockReturnValue({
      id: CARD,
      owner_id: "u1",
      art_url: ART("ai-front.jpg"),
      art_position: { x: 0.4, y: 0.6, zoom: 1.5 },
      artist_credit: "dev_pro",
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
    // The pictures taken off are KEPT as an earlier picture (0215) — both
    // faces together, with the fit and credit the card had with them, who
    // painted them and when — BEFORE the card stops showing them. Nothing
    // is removed.
    expect(m.keep.mock.calls).toEqual([
      [
        "u1",
        DECK,
        {
          cardId: CARD,
          styleVersion: 2,
          jobId: "job-0",
          artUrl: ART("ai-front.jpg"),
          artPosition: { x: 0.4, y: 0.6, zoom: 1.5 },
          artistCredit: "dev_pro",
          backArtUrl: ART("ai-back.jpg"),
          backArtPosition: null,
          backArtistCredit: "AI",
          imageModel: "bfl/flux-2-pro",
          method: "paint",
          paintedAt: "2026-11-10T10:00:00Z",
        },
      ],
    ]);
    expect(m.discardUnused).not.toHaveBeenCalled();
    expect(m.discard).not.toHaveBeenCalled();
    expect(m.keep.mock.invocationCallOrder[0]).toBeLessThan(m.update.mock.invocationCallOrder[0]);
    // The oldest kept picture goes only after this one is kept and the row written.
    expect(m.writePainted.mock.invocationCallOrder[0]).toBeLessThan(m.prune.mock.invocationCallOrder[0]);
    expect(m.prune).toHaveBeenCalledWith("u1", DECK, CARD);
    // …and names no model: nothing Re-art painted is on the card now.
    expect(m.writePainted.mock.calls[0][3]).toMatchObject({ artUrl: null, previousArtUrl: null, styleVersion: 2, imageModel: null });
    expect(logged()).toEqual([["restore", { faces: 2, kept: true }]]);
  });

  it("waits for a run of the deck that is painting right now (the studio holds the button too)", async () => {
    m.open.mockReturnValue([{ id: "job-9", steps: [{ status: "running", claimed_at: new Date().toISOString() }] }]);
    expect(await restoreReartArtAction(DECK, CARD)).toMatchObject({ ok: false, code: "BUSY" });
    expect(m.keep).not.toHaveBeenCalled();
    expect(m.update).not.toHaveBeenCalled();
    expect(logged()).toEqual([["restore_failed", { reason: "busy" }]]);
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

  it("an edit the card action refused is `restore_failed` — and the picture is not an earlier one (the card still shows it)", async () => {
    m.update.mockResolvedValue({ ok: false, formError: "No." });
    expect((await restoreReartArtAction(DECK, CARD)).ok).toBe(false);
    expect(logged()).toEqual([["restore_failed", { reason: "save_failed" }]]);
    expect(m.drop).toHaveBeenCalledWith("u1", "roll-kept");
    expect(m.writePainted).not.toHaveBeenCalled();
    expect(m.prune).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// "Use this one": an earlier picture Re-art keeps for a card goes back on it
// (migration 0215). Nothing is painted or charged — it is an edit of the
// card's art. The picture is CLAIMED first (two tabs, or a prune, can't both
// hold it), the deck's row names it before anything else moves, the picture
// it replaces is kept in its place, and a refused edit puts all of it back.
// ---------------------------------------------------------------------------

describe("chooseReartPictureAction — an earlier picture goes back on the card (0215)", () => {
  const CARD = "00000000-0000-4000-8000-0000000000c1";
  const ROLL = "00000000-0000-4000-8000-0000000000f1";
  const ART = (n: string) => `https://x.supabase.co/storage/v1/object/public/card-art/u1/${n}`;
  /** The deck's row: its second roll is on the card. */
  const painted = {
    cardId: CARD,
    entryId: "entry-1",
    styleVersion: 3,
    artUrl: ART("ai-2.jpg"),
    backArtUrl: null,
    made: false,
    previousArtUrl: ART("mine.png"),
    previousArtPosition: { x: 0.5, y: 0.5, zoom: 1 },
    previousBackArtUrl: null,
    previousBackArtPosition: null,
    previousArtistCredit: "Jane Painter",
    previousBackArtistCredit: null,
    paintedAt: "2026-11-12T10:00:00Z",
    jobId: "job-2",
    imageModel: "spacexai/grok-imagine-image-2.0",
    method: "paint" as const,
  };
  /** The first roll, kept when the second replaced it. */
  const kept = {
    id: ROLL,
    cardId: CARD,
    styleVersion: 2,
    jobId: "job-1",
    artUrl: ART("ai-1.jpg"),
    artPosition: { x: 0.3, y: 0.7, zoom: 1.2 },
    artistCredit: "dev_pro (then)",
    backArtUrl: null,
    backArtPosition: null,
    backArtistCredit: null,
    imageModel: "bfl/flux-2-pro",
    method: "restyle" as const,
    paintedAt: "2026-11-11T10:00:00Z",
  };
  const card = {
    id: CARD,
    owner_id: "u1",
    art_url: ART("ai-2.jpg"),
    art_position: { x: 0.4, y: 0.6, zoom: 1.5 },
    artist_credit: "dev_pro",
    frame_style: { template: "m15" },
    back_face: null,
  };
  const order = (...fns: Array<{ mock: { invocationCallOrder: number[] } }>) => fns.map((fn) => fn.mock.invocationCallOrder[0]);
  const ascending = (list: number[]) => list.every((value, index) => index === 0 || list[index - 1] < value);

  beforeEach(() => {
    m.deck.mockResolvedValue({ id: DECK, slug: "s", title: "S", visibility: "private" });
    m.card.mockReturnValue(card);
    m.paintedAdmin.mockResolvedValue(painted);
    m.paintedRows.mockResolvedValue([painted]);
    m.claim.mockResolvedValue(kept);
    m.update.mockResolvedValue({ ok: true, cardId: CARD, slug: "c" });
    m.writePainted.mockResolvedValue(true);
  });

  it("a closed tool, ids that don't read, another's deck or card: nothing is claimed, written or logged as a use", async () => {
    m.access.mockResolvedValueOnce(null);
    expect((await chooseReartPictureAction(DECK, CARD, ROLL)).ok).toBe(false);
    for (const bad of [
      ["not-a-deck", CARD, ROLL],
      [DECK, "not-a-card", ROLL],
      [DECK, CARD, "not-a-picture"],
      [DECK, CARD, null],
      [DECK, CARD, ""],
    ] as const) {
      expect((await chooseReartPictureAction(bad[0], bad[1], bad[2])).ok).toBe(false);
    }
    m.deck.mockResolvedValueOnce(null);
    expect((await chooseReartPictureAction(DECK, CARD, ROLL)).ok).toBe(false);
    m.card.mockReturnValueOnce({ ...card, owner_id: "someone" });
    expect((await chooseReartPictureAction(DECK, CARD, ROLL)).ok).toBe(false);
    m.card.mockReturnValueOnce(null);
    expect((await chooseReartPictureAction(DECK, CARD, ROLL)).ok).toBe(false);
    expect(m.claim).not.toHaveBeenCalled();
    expect(m.writePainted).not.toHaveBeenCalled();
    expect(m.update).not.toHaveBeenCalled();
    expect(m.event).not.toHaveBeenCalled();
  });

  it("a run of the deck that is painting right now holds its cards: wait for it", async () => {
    m.open.mockReturnValue([{ id: "job-9", steps: [{ status: "running", claimed_at: new Date().toISOString() }] }]);
    const result = await chooseReartPictureAction(DECK, CARD, ROLL);
    expect(result).toMatchObject({ ok: false, code: "BUSY" });
    expect(m.claim).not.toHaveBeenCalled();
    expect(logged()).toEqual([["choose_picture_failed", { reason: "busy" }]]);
    // A run that stopped (a stale claim) holds nothing.
    m.event.mockClear();
    m.open.mockReturnValue([{ id: "job-9", steps: [{ status: "running", claimed_at: "2026-01-01T00:00:00Z" }] }]);
    expect(await chooseReartPictureAction(DECK, CARD, ROLL)).toEqual({ ok: true });
  });

  it("puts the kept picture on the card — its own fit and credit — names it in the deck's row, and keeps the picture it replaces", async () => {
    expect(await chooseReartPictureAction(DECK, CARD, ROLL)).toEqual({ ok: true });
    expect(m.claim).toHaveBeenCalledWith("u1", DECK, CARD, ROLL);
    // The row: the picked picture as the deck's, in the style it was painted
    // in, by whom and how; the art to put back is unchanged (the card showed
    // Re-art's picture: that row's own). It keeps the date the picture was
    // PAINTED: nothing is painted now — and the RUN that painted it (the
    // kept picture's own), so an undo of that run still finds the card.
    expect(m.writePainted.mock.calls[0].slice(0, 3)).toEqual(["u1", DECK, "job-1"]);
    expect(m.writePainted.mock.calls[0][4]).toEqual({ paintedAt: "2026-11-11T10:00:00Z" });
    // Its file was asked about before anything was written.
    expect(m.exists).toHaveBeenCalledWith(ART("ai-1.jpg"));
    expect(m.exists.mock.invocationCallOrder[0]).toBeLessThan(m.writePainted.mock.invocationCallOrder[0]);
    expect(m.writePainted.mock.calls[0][3]).toEqual({
      cardId: CARD,
      entryId: "entry-1",
      styleVersion: 2,
      artUrl: ART("ai-1.jpg"),
      backArtUrl: null,
      imageModel: "bfl/flux-2-pro",
      method: "restyle",
      made: false,
      previousArtUrl: ART("mine.png"),
      previousArtPosition: { x: 0.5, y: 0.5, zoom: 1 },
      previousBackArtUrl: null,
      previousBackArtPosition: null,
      previousArtistCredit: "Jane Painter",
      previousBackArtistCredit: null,
    });
    // The picture it replaces, kept with the fit and credit the card had with it.
    expect(m.keep.mock.calls).toEqual([
      [
        "u1",
        DECK,
        {
          cardId: CARD,
          styleVersion: 3,
          jobId: "job-2",
          artUrl: ART("ai-2.jpg"),
          artPosition: { x: 0.4, y: 0.6, zoom: 1.5 },
          artistCredit: "dev_pro",
          backArtUrl: null,
          backArtPosition: null,
          backArtistCredit: null,
          imageModel: "spacexai/grok-imagine-image-2.0",
          method: "paint",
          paintedAt: "2026-11-12T10:00:00Z",
        },
      ],
    ]);
    // The card's edit: the art, its fit and credit — nothing else.
    expect(m.update.mock.calls).toEqual([[CARD, { art_url: ART("ai-1.jpg"), art_position: { x: 0.3, y: 0.7, zoom: 1.2 }, artist_credit: "dev_pro (then)" }]]);
    // Claimed first; the replaced picture KEPT before the row stops naming
    // it; the row before the card's edit; pruned last.
    expect(ascending(order(m.claim, m.keep, m.writePainted, m.update, m.prune))).toBe(true);
    expect(m.revert).not.toHaveBeenCalled();
    expect(m.drop).not.toHaveBeenCalled();
    expect(m.discardUnused).not.toHaveBeenCalled();
    expect(m.discard).not.toHaveBeenCalled();
    expect(logged()).toEqual([["choose_picture", { from: "kept", faces: 1, replaced: true }]]);
  });

  it("a picture kept without a fit or credit (the card no longer showed it) is fitted afresh, with the maker's AI credit", async () => {
    m.claim.mockResolvedValue({ ...kept, artPosition: null, artistCredit: null });
    await chooseReartPictureAction(DECK, CARD, ROLL);
    const payload = m.update.mock.calls[0][1];
    expect(payload.artist_credit).toBe("dev_pro");
    expect(payload.art_position).toEqual(fitArtToWindow());
    m.credit.mockResolvedValue(undefined);
    await chooseReartPictureAction(DECK, CARD, ROLL);
    expect(m.update.mock.calls[1][1].artist_credit).toBeNull();
  });

  it("the deck's own last picture, while the card shows OTHER art: back on the card, and that art becomes the one to put back", async () => {
    // The maker gave the card other art in the editor since the paint.
    m.card.mockReturnValue({ ...card, art_url: ART("hand.png"), artist_credit: "Me", art_position: { x: 0.1, y: 0.2, zoom: 2 } });
    expect(await chooseReartPictureAction(DECK, CARD, "row")).toEqual({ ok: true });
    expect(m.claim).not.toHaveBeenCalled();
    expect(m.writePainted.mock.calls[0][3]).toMatchObject({
      artUrl: ART("ai-2.jpg"),
      styleVersion: 3,
      made: false,
      previousArtUrl: ART("hand.png"),
      previousArtPosition: { x: 0.1, y: 0.2, zoom: 2 },
      previousArtistCredit: "Me",
    });
    // Nothing of Re-art's leaves the row: nothing to keep.
    expect(m.keep).not.toHaveBeenCalled();
    expect(m.update.mock.calls[0][1]).toMatchObject({ art_url: ART("ai-2.jpg"), artist_credit: "dev_pro" });
    expect(logged()).toEqual([["choose_picture", { from: "row", faces: 1, replaced: false }]]);
  });

  it("a picture that is no longer kept — or the row's own while the card shows it, or with no row — is refused in words; nothing is written", async () => {
    m.claim.mockResolvedValue(null);
    expect(await chooseReartPictureAction(DECK, CARD, ROLL)).toEqual({ ok: false, error: "That picture is no longer kept — reload the page." });
    // "row": the card already shows the row's picture.
    expect((await chooseReartPictureAction(DECK, CARD, "row")).ok).toBe(false);
    m.paintedAdmin.mockResolvedValue(null);
    expect((await chooseReartPictureAction(DECK, CARD, "row")).ok).toBe(false);
    m.paintedAdmin.mockResolvedValue({ ...painted, artUrl: null });
    expect((await chooseReartPictureAction(DECK, CARD, "row")).ok).toBe(false);
    expect(m.writePainted).not.toHaveBeenCalled();
    expect(m.update).not.toHaveBeenCalled();
    expect(logged().map(([event, props]) => `${event}:${props?.reason}`)).toEqual(Array(4).fill("choose_picture_failed:not_kept"));
  });

  it("a card with no row on this deck (it was only ever kept): the row is made, and the card's own art is the one to put back", async () => {
    m.paintedAdmin.mockResolvedValue(null);
    m.paintedRows.mockResolvedValue([]);
    m.card.mockReturnValue({ ...card, art_url: ART("mine.png"), artist_credit: "Jane Painter" });
    expect(await chooseReartPictureAction(DECK, CARD, ROLL)).toEqual({ ok: true });
    expect(m.writePainted.mock.calls[0][3]).toMatchObject({
      entryId: null,
      artUrl: ART("ai-1.jpg"),
      made: false,
      previousArtUrl: ART("mine.png"),
      previousArtistCredit: "Jane Painter",
    });
    expect(m.keep).not.toHaveBeenCalled();
    expect(logged()).toEqual([["choose_picture", { from: "kept", faces: 1, replaced: false }]]);
  });

  it("a two-faced card gets both faces of the kept picture; a card that is one-faced now gets the front alone", async () => {
    const back = { title: "Back", card_type: "creature", subtypes: [], art_url: ART("ai-2-back.jpg"), artist_credit: "dev_pro" };
    m.bakedBack.mockReturnValue(true);
    m.card.mockReturnValue({ ...card, back_face: back });
    m.paintedAdmin.mockResolvedValue({ ...painted, backArtUrl: ART("ai-2-back.jpg") });
    m.claim.mockResolvedValue({ ...kept, backArtUrl: ART("ai-1-back.jpg"), backArtistCredit: "dev_pro (then)" });
    await chooseReartPictureAction(DECK, CARD, ROLL);
    expect(m.writePainted.mock.calls[0][3]).toMatchObject({ artUrl: ART("ai-1.jpg"), backArtUrl: ART("ai-1-back.jpg") });
    expect(m.update.mock.calls[0][1].back_face).toMatchObject({ title: "Back", art_url: ART("ai-1-back.jpg"), artist_credit: "dev_pro (then)" });
    expect(m.keep.mock.calls[0][2]).toMatchObject({ artUrl: ART("ai-2.jpg"), backArtUrl: ART("ai-2-back.jpg"), backArtistCredit: "dev_pro" });
    expect(logged()).toEqual([["choose_picture", { from: "kept", faces: 2, replaced: true }]]);
    // One-faced now: the kept back is left out, and no back face is sent.
    m.bakedBack.mockReturnValue(false);
    m.card.mockReturnValue(card);
    m.writePainted.mockClear();
    m.update.mockClear();
    await chooseReartPictureAction(DECK, CARD, ROLL);
    expect(m.writePainted.mock.calls[0][3]).toMatchObject({ backArtUrl: null });
    expect(Object.keys(m.update.mock.calls[0][1])).not.toContain("back_face");
  });

  it("an edit the card action refuses puts ALL of it back: the row as it was, the picked picture kept again, the copy it made taken out", async () => {
    m.update.mockResolvedValue({ ok: false, formError: "No." });
    expect(await chooseReartPictureAction(DECK, CARD, ROLL)).toEqual({ ok: false, error: "No." });
    expect(m.revert).toHaveBeenCalledWith("u1", DECK, CARD, painted);
    // The copy of the picture on the card goes back out — AFTER the row
    // names that picture again…
    expect(m.drop).toHaveBeenCalledWith("u1", "roll-kept");
    expect(m.revert.mock.invocationCallOrder[0]).toBeLessThan(m.drop.mock.invocationCallOrder[0]);
    // …and the picked picture is kept again, whole.
    expect(m.keep).toHaveBeenLastCalledWith("u1", DECK, kept);
    expect(m.prune).not.toHaveBeenCalled();
    expect(logged()).toEqual([["choose_picture_failed", { reason: "save_failed" }]]);
  });

  it("…and so does an edit that throws, and a row that couldn't be written (the card is never edited)", async () => {
    m.update.mockRejectedValue(new Error("boom"));
    await expect(chooseReartPictureAction(DECK, CARD, ROLL)).rejects.toThrow("boom");
    expect(m.revert).toHaveBeenCalledWith("u1", DECK, CARD, painted);
    expect(m.keep).toHaveBeenLastCalledWith("u1", DECK, kept);
    m.update.mockReset();
    m.keep.mockClear();
    m.revert.mockClear();
    m.drop.mockClear();
    m.writePainted.mockResolvedValue(false);
    expect((await chooseReartPictureAction(DECK, CARD, ROLL)).ok).toBe(false);
    expect(m.update).not.toHaveBeenCalled();
    // The row was never written: there is nothing to put back there. The
    // copy this pick kept comes out; the picked picture is kept again.
    expect(m.revert).not.toHaveBeenCalled();
    expect(m.drop).toHaveBeenCalledWith("u1", "roll-kept");
    expect(m.keep).toHaveBeenLastCalledWith("u1", DECK, kept);
    expect(logged().at(-1)).toEqual(["choose_picture_failed", { reason: "not_saved" }]);
  });

  // A row written before pictures were kept can name a file the tool removed
  // since (a re-roll from another deck did, on the old code). A card is
  // never given a dead picture: the picture comes off the list instead.
  describe("a picture whose file is no longer in storage", () => {
    it("a kept one: refused in words, nothing written, and its row stays out (it was claimed)", async () => {
      m.exists.mockResolvedValue("no");
      expect(await chooseReartPictureAction(DECK, CARD, ROLL)).toEqual({ ok: false, error: REART_PICTURE_GONE });
      expect(m.writePainted).not.toHaveBeenCalled();
      expect(m.update).not.toHaveBeenCalled();
      expect(m.keep).not.toHaveBeenCalled();
      expect(logged()).toEqual([["choose_picture_failed", { reason: "gone" }]]);
    });

    it("the deck's own last picture: refused, and the row stops naming it (every other field as it was)", async () => {
      m.card.mockReturnValue({ ...card, art_url: ART("hand.png") });
      m.exists.mockResolvedValue("no");
      expect(await chooseReartPictureAction(DECK, CARD, "row")).toEqual({ ok: false, error: REART_PICTURE_GONE });
      expect(m.update).not.toHaveBeenCalled();
      expect(m.writePainted).toHaveBeenCalledTimes(1);
      const [, , jobId, row, options] = m.writePainted.mock.calls[0];
      expect(jobId).toBe("job-2");
      expect(row).toMatchObject({
        cardId: CARD,
        entryId: "entry-1",
        styleVersion: 3,
        artUrl: null,
        backArtUrl: null,
        imageModel: null,
        method: null,
        made: false,
        previousArtUrl: ART("mine.png"),
        previousArtistCredit: "Jane Painter",
      });
      expect(options).toEqual({ paintedAt: "2026-11-12T10:00:00Z" });
    });

    it("storage that didn't answer is NOT “gone”: the claim goes back, nothing changes, and the maker is asked to try again", async () => {
      m.exists.mockResolvedValue("unknown");
      const result = await chooseReartPictureAction(DECK, CARD, ROLL);
      expect(result).toMatchObject({ ok: false });
      expect(!result.ok && result.error).toMatch(/couldn't check that picture/);
      expect(m.keep.mock.calls).toEqual([["u1", DECK, kept]]);
      expect(m.writePainted).not.toHaveBeenCalled();
      expect(m.update).not.toHaveBeenCalled();
      expect(logged()).toEqual([["choose_picture_failed", { reason: "storage_unread" }]]);
    });

    it("a kept BACK that is gone is left out; the front still goes on", async () => {
      const back = { title: "Back", card_type: "creature", subtypes: [], art_url: ART("ai-2-back.jpg"), artist_credit: "dev_pro" };
      m.bakedBack.mockReturnValue(true);
      m.card.mockReturnValue({ ...card, back_face: back });
      m.claim.mockResolvedValue({ ...kept, backArtUrl: ART("ai-1-back.jpg") });
      m.exists.mockImplementation(async (url: string) => (url === ART("ai-1-back.jpg") ? "no" : "yes"));
      expect(await chooseReartPictureAction(DECK, CARD, ROLL)).toEqual({ ok: true });
      expect(m.writePainted.mock.calls[0][3]).toMatchObject({ artUrl: ART("ai-1.jpg"), backArtUrl: null });
      expect(Object.keys(m.update.mock.calls[0][1])).not.toContain("back_face");
    });
  });

  // A write that stopped half-way (the picture was kept, the row moved on,
  // the card's edit never landed) leaves the card showing a picture this
  // deck KEEPS, which no row names. The maker's original must stay the art
  // to put back — never that AI picture.
  describe("a card left showing a kept picture by a write that stopped half-way", () => {
    beforeEach(() => {
      // The card shows ai-9 (kept); the row has moved on to ai-2.
      m.card.mockReturnValue({ ...card, art_url: ART("ai-9.jpg") });
      m.isKept.mockResolvedValue(true);
    });

    it("picking the deck's last picture keeps the row's own art to put back", async () => {
      expect(await chooseReartPictureAction(DECK, CARD, "row")).toEqual({ ok: true });
      expect(m.isKept).toHaveBeenCalledWith("u1", DECK, CARD, ART("ai-9.jpg"));
      expect(m.writePainted.mock.calls[0][3]).toMatchObject({
        artUrl: ART("ai-2.jpg"),
        made: false,
        previousArtUrl: ART("mine.png"),
        previousArtistCredit: "Jane Painter",
      });
    });

    it("so does picking the very picture the card shows (claimed: it is no longer “kept” when asked)", async () => {
      m.isKept.mockResolvedValue(false);
      m.claim.mockResolvedValue({ ...kept, artUrl: ART("ai-9.jpg") });
      expect(await chooseReartPictureAction(DECK, CARD, ROLL)).toEqual({ ok: true });
      expect(m.writePainted.mock.calls[0][3]).toMatchObject({ artUrl: ART("ai-9.jpg"), previousArtUrl: ART("mine.png") });
      // The row's picture is kept in its place, as in any pick.
      expect(m.keep.mock.calls[0][2]).toMatchObject({ artUrl: ART("ai-2.jpg") });
    });

    it("art the maker set by hand is their own: it becomes the art to put back (nothing is asked of a row that names the card's art either)", async () => {
      m.card.mockReturnValue({ ...card, art_url: ART("hand.png"), artist_credit: "Me" });
      m.isKept.mockResolvedValue(false);
      await chooseReartPictureAction(DECK, CARD, ROLL);
      expect(m.writePainted.mock.calls[0][3]).toMatchObject({ previousArtUrl: ART("hand.png"), previousArtistCredit: "Me" });
      m.isKept.mockClear();
      m.card.mockReturnValue(card);
      await chooseReartPictureAction(DECK, CARD, ROLL);
      expect(m.isKept).not.toHaveBeenCalled();
    });
  });
});

describe("saveReartCardWordsAction — one card's own words (0209)", () => {
  const ENTRY = ID(7);
  const WORDS = "an old goblin librarian asleep on a heap of overdue books";

  beforeEach(() => {
    m.deck.mockResolvedValue({ id: DECK, slug: "s", title: "Sampler", visibility: "private" });
    m.card.mockReturnValue({ id: ENTRY });
    m.saveWords.mockResolvedValue(true);
  });

  it("a closed tool, a body that can't be read, another's deck and an entry of another deck save nothing", async () => {
    m.access.mockResolvedValueOnce(null);
    expect((await saveReartCardWordsAction(DECK, ENTRY, { text: WORDS, only: false })).ok).toBe(false);
    for (const bad of [
      ["not-a-deck", ENTRY, { text: WORDS }],
      [DECK, "not-an-entry", { text: WORDS }],
      [DECK, ENTRY, { text: 7 }],
      [DECK, ENTRY, null],
      [DECK, ENTRY, { text: "x".repeat(1201) }],
    ] as const) {
      expect((await saveReartCardWordsAction(bad[0], bad[1], bad[2])).ok).toBe(false);
    }
    m.deck.mockResolvedValueOnce(null);
    expect((await saveReartCardWordsAction(DECK, ENTRY, { text: WORDS })).ok).toBe(false);
    m.card.mockReturnValueOnce(null);
    expect((await saveReartCardWordsAction(DECK, ENTRY, { text: WORDS })).ok).toBe(false);
    expect(m.saveWords).not.toHaveBeenCalled();
    expect(m.event).not.toHaveBeenCalled();
  });

  it("saves the words clean, on the caller's own deck and entry, and logs their length — never the words", async () => {
    const result = await saveReartCardWordsAction(DECK, ENTRY, { text: `  ${WORDS}\n\n  `, only: true });
    expect(result).toEqual({ ok: true, words: { text: WORDS, only: true } });
    expect(m.saveWords).toHaveBeenCalledWith("u1", DECK, ENTRY, { text: WORDS, only: true });
    expect(logged()).toEqual([["save_card_words", { chars: WORDS.length, only: true }]]);
  });

  it("`only` is true only when asked for; words past the limit are clipped", async () => {
    await saveReartCardWordsAction(DECK, ENTRY, { text: WORDS, only: "yes" });
    expect(m.saveWords.mock.calls[0][3]).toEqual({ text: WORDS, only: false });
    await saveReartCardWordsAction(DECK, ENTRY, { text: "w".repeat(900) });
    expect(m.saveWords.mock.calls[1][3]).toEqual({ text: "w".repeat(600), only: false });
  });

  it("words that say nothing are refused (a lone stop would be painted and paid for)", async () => {
    for (const text of [".", " - ", "!!", "42"]) {
      const result = await saveReartCardWordsAction(DECK, ENTRY, { text });
      expect(result).toMatchObject({ ok: false });
      expect(result.ok === false && result.error).toMatch(/Write what the picture shows/);
    }
    expect(m.saveWords).not.toHaveBeenCalled();
  });

  it("empty words remove them", async () => {
    expect(await saveReartCardWordsAction(DECK, ENTRY, { text: "   ", only: true })).toEqual({ ok: true, words: null });
    expect(m.saveWords).toHaveBeenCalledWith("u1", DECK, ENTRY, null);
    expect(logged()).toEqual([["remove_card_words", undefined]]);
  });

  it("a write that failed says so and is `save_card_words_failed`", async () => {
    m.saveWords.mockResolvedValue(false);
    expect((await saveReartCardWordsAction(DECK, ENTRY, { text: WORDS })).ok).toBe(false);
    expect(logged()).toEqual([["save_card_words_failed", { reason: "not_saved" }]]);
  });
});

// ---------------------------------------------------------------------------
// LOCKED cards (migration 0216): while a card is locked on the deck, nothing
// the tool does changes its picture. The one-card actions are refused — and
// a lock that couldn't be READ is never "not locked".
// ---------------------------------------------------------------------------

describe("a locked card is left as it is by every one-card action (0216)", () => {
  const CARD = "00000000-0000-4000-8000-0000000000c1";
  const ROLL = "00000000-0000-4000-8000-0000000000f1";

  beforeEach(() => {
    m.deck.mockResolvedValue({ id: DECK, slug: "s", title: "S", visibility: "private" });
  });

  it("“old art back” and “use this one” are refused in words; nothing is read, kept, claimed or written", async () => {
    m.cardLocked.mockResolvedValue(true);
    expect(await restoreReartArtAction(DECK, CARD)).toEqual({ ok: false, error: REART_UNLOCK_FIRST });
    expect(await chooseReartPictureAction(DECK, CARD, ROLL)).toEqual({ ok: false, error: REART_UNLOCK_FIRST });
    expect(m.cardLocked.mock.calls).toEqual([
      [DECK, CARD],
      [DECK, CARD],
    ]);
    for (const fn of [m.painted, m.paintedAdmin, m.keep, m.claim, m.update, m.writePainted, m.revert]) expect(fn).not.toHaveBeenCalled();
    expect(logged()).toEqual([
      ["restore_failed", { reason: "locked" }],
      ["choose_picture_failed", { reason: "locked" }],
    ]);
  });

  it("a lock that couldn't be read stops them too", async () => {
    m.cardLocked.mockResolvedValue(null);
    expect(await restoreReartArtAction(DECK, CARD)).toEqual({ ok: false, error: "We couldn't read whether this card is locked — try again." });
    expect((await chooseReartPictureAction(DECK, CARD, ROLL)).ok).toBe(false);
    expect(m.update).not.toHaveBeenCalled();
    expect(m.claim).not.toHaveBeenCalled();
    expect(logged()).toEqual([
      ["restore_failed", { reason: "lock_unread" }],
      ["choose_picture_failed", { reason: "lock_unread" }],
    ]);
  });
});

describe("setReartLocksAction — locking and unlocking cards (0216)", () => {
  beforeEach(() => {
    m.deck.mockResolvedValue({ id: DECK, slug: "s", title: "S", visibility: "private" });
    m.setLocks.mockResolvedValue(2);
  });

  it("a closed tool, a body that can't be read and another's deck lock nothing", async () => {
    m.access.mockResolvedValueOnce(null);
    expect((await setReartLocksAction(DECK, [ID(1)], true)).ok).toBe(false);
    for (const bad of [
      ["not-a-deck", [ID(1)], true],
      [DECK, [], true],
      [DECK, ["not-an-entry"], true],
      [DECK, [ID(1), 7], true],
      [DECK, ID(1), true],
      [DECK, [ID(1)], "yes"],
      [DECK, [ID(1)], undefined],
      [DECK, Array.from({ length: 501 }, (_, i) => ID(i + 1)), true],
    ] as const) {
      expect((await setReartLocksAction(bad[0], bad[1], bad[2])).ok).toBe(false);
    }
    m.deck.mockResolvedValueOnce(null);
    expect((await setReartLocksAction(DECK, [ID(1)], true)).ok).toBe(false);
    expect(m.setLocks).not.toHaveBeenCalled();
    expect(m.event).not.toHaveBeenCalled();
  });

  it("locks the entries named on the caller's own deck, and says how many it changed", async () => {
    expect(await setReartLocksAction(DECK, [ID(1), ID(2)], true)).toEqual({ ok: true, changed: 2 });
    expect(m.setLocks).toHaveBeenCalledWith("u1", DECK, [ID(1), ID(2)], true);
    expect(logged()).toEqual([["lock", { cards: 2 }]]);
  });

  it("unlocks them the same way", async () => {
    m.setLocks.mockResolvedValue(1);
    expect(await setReartLocksAction(DECK, [ID(1)], false)).toEqual({ ok: true, changed: 1 });
    expect(m.setLocks).toHaveBeenCalledWith("u1", DECK, [ID(1)], false);
    expect(logged()).toEqual([["unlock", { cards: 1 }]]);
  });

  it("a write that failed says so and is `lock_failed` / `unlock_failed`", async () => {
    m.setLocks.mockResolvedValue(null);
    expect(await setReartLocksAction(DECK, [ID(1)], true)).toEqual({ ok: false, error: "Couldn't lock that card — try again." });
    expect(await setReartLocksAction(DECK, [ID(1), ID(2)], false)).toEqual({ ok: false, error: "Couldn't unlock those cards — try again." });
    expect(logged()).toEqual([
      ["lock_failed", { reason: "not_saved" }],
      ["unlock_failed", { reason: "not_saved" }],
    ]);
  });
});

describe("a run and locks, as the plan and the log read them (0216)", () => {
  it("the confirm says how many locked cards the run leaves", async () => {
    m.plan.mockResolvedValue({ ...planned([{ kind: "own" }]), locked: 3 });
    expect(await planReartAction({ deckId: DECK, style: STYLE })).toMatchObject({ ok: true, locked: 3 });
    // A planner that names none (a run of named cards) is 0.
    m.plan.mockResolvedValue(planned([{ kind: "own" }]));
    expect(await planReartAction({ deckId: DECK, style: STYLE })).toMatchObject({ ok: true, locked: 0 });
  });

  it("a run whose every card is locked says so (it used to say none of them can be re-arted)", async () => {
    m.plan.mockResolvedValue({ ...planned([]), skipped: [], locked: 4 });
    expect(await startReartAction({ deckId: DECK, style: STYLE })).toMatchObject({ ok: false, error: "Every card of this run is locked — unlock one to paint it." });
    m.plan.mockResolvedValue({ ...planned([]), skipped: [], locked: 1, inStyle: 3 });
    expect(await startReartAction({ deckId: DECK, style: STYLE })).toMatchObject({ ok: false, error: "Every card of this run is locked or in the deck's style already." });
    expect(m.insert).not.toHaveBeenCalled();
  });

  it("several named cards at once (the studio's selection) are `paint_selected`; one stays a first paint or a re-roll", async () => {
    m.plan.mockResolvedValue(planned([{ kind: "own" }, { kind: "own", paintedBefore: true }]));
    await startReartAction({ deckId: DECK, style: STYLE, entryIds: [ID(1), ID(2)] });
    m.plan.mockResolvedValue(planned([{ kind: "own" }]));
    await startReartAction({ deckId: DECK, style: STYLE, entryIds: [ID(1)] });
    expect(logged().map(([event]) => event)).toEqual(["paint_selected", "paint_one"]);
  });
});

// ---------------------------------------------------------------------------
// UNDOING a run: every card the run painted goes back to what it showed
// before — while the run's record of it is still the latest and its picture
// is still on the card (model.ts reartUndoOf). Read afresh for the confirm
// and for every batch; nothing is painted and no credit is returned.
// ---------------------------------------------------------------------------

describe("undoing a run", () => {
  const JOB = "00000000-0000-4000-8000-00000000a001";
  const C = (n: number) => `00000000-0000-4000-8000-0000000000c${n}`;
  const R = (n: number) => `00000000-0000-4000-8000-0000000000f${n}`;
  const ART = (n: string) => `https://x.supabase.co/storage/v1/object/public/card-art/u1/${n}`;
  const rowOf = (n: number, over: Record<string, unknown> = {}) => ({
    cardId: C(n),
    entryId: null,
    styleVersion: 2,
    artUrl: ART(`ai-${n}.jpg`),
    backArtUrl: null,
    made: false,
    previousArtUrl: ART(`mine-${n}.png`),
    previousArtPosition: null,
    previousBackArtUrl: null,
    previousBackArtPosition: null,
    previousArtistCredit: "Jane Painter",
    previousBackArtistCredit: null,
    paintedAt: "2026-11-12T10:00:00Z",
    jobId: JOB,
    imageModel: "bfl/flux-2-pro",
    method: "paint" as const,
    ...over,
  });
  /** The maker's cards were there before the run started (a card the run MADE is newer: `created_at`). */
  const cardOf = (n: number, over: Record<string, unknown> = {}) => ({
    id: C(n),
    owner_id: "u1",
    title: `Card ${n}`,
    art_url: ART(`ai-${n}.jpg`),
    created_at: "2026-11-01T00:00:00Z",
    ...over,
  });
  const RUN_STARTED = "2026-11-12T09:00:00Z";
  /** The picture a re-roll of card n replaced, and the kept row that holds it. */
  const before = (n: number) => ART(`before-${n}.jpg`);
  const keptFor = (n: number, id = R(n)) => [C(n), [{ id, artUrl: before(n) }]] as const;
  /** A done step that PAINTED its card (the step says so since undo exists). */
  const step = (n: number, over: Record<string, unknown> = {}) => ({ status: "done", card_id: C(n), label: `Step ${n}`, painted: true, ...over });
  const run = (steps: unknown[]) =>
    m.job.mockReturnValue({ id: JOB, owner_id: "u1", kind: "deck_reart", status: "completed", request: { deck_id: DECK }, steps, created_at: RUN_STARTED });
  const deckHas = (rows: Array<ReturnType<typeof rowOf>>, cards: Array<ReturnType<typeof cardOf>>, entries: Array<{ id: string; card_id: string }> = []) => {
    m.painted.mockResolvedValue(new Map(rows.map((row) => [row.cardId, row])));
    m.cards.mockReturnValue({ data: cards, error: null });
    m.entries.mockReturnValue({ data: entries, error: null });
  };

  beforeEach(() => {
    m.deck.mockResolvedValue({ id: DECK, slug: "s", title: "S", visibility: "private" });
    m.painted.mockResolvedValue(new Map());
    m.update.mockResolvedValue({ ok: true, cardId: C(1), slug: "c" });
    m.writePainted.mockResolvedValue(true);
    m.unlink.mockResolvedValue({ ok: true, deckCardId: ID(1) });
  });

  describe("the confirm (planUndoReartRunAction)", () => {
    it("a closed tool, an id that doesn't read, a run that isn't the caller's own Re-art run, a deck that isn't theirs any more", async () => {
      m.access.mockResolvedValueOnce(null);
      expect((await planUndoReartRunAction(JOB)).ok).toBe(false);
      for (const bad of ["not-a-run", null, 7, undefined]) expect((await planUndoReartRunAction(bad)).ok).toBe(false);
      // No such run of theirs.
      expect(await planUndoReartRunAction(JOB)).toEqual({ ok: false, error: "That run isn't one of yours." });
      // A run whose request names no deck.
      m.job.mockReturnValue({ id: JOB, owner_id: "u1", kind: "deck_reart", status: "completed", request: {}, steps: [step(1)], created_at: RUN_STARTED });
      expect((await planUndoReartRunAction(JOB)).ok).toBe(false);
      run([step(1)]);
      m.deck.mockResolvedValueOnce(null);
      expect(await planUndoReartRunAction(JOB)).toEqual({ ok: false, error: "That run's deck isn't one of yours any more." });
      expect(m.event).not.toHaveBeenCalled();
    });

    it("counts what would go back, kind by kind, and names what is left and why — and changes nothing", async () => {
      run([
        step(1, { kept_art: before(1) }), // re-rolled: the earlier picture the run kept
        step(2), // a first paint: its own art back
        { status: "done", card_id: C(3), label: "Step 3", linked: true }, // a real card the run made: the real card back
        step(4), // locked since
        step(5), // painted again by a later run
        step(6), // shows other art now
        step(7), // had no art before
        { status: "failed", card_id: C(8), label: "Failed" }, // never painted
        { status: "done", card_id: null, label: "Locked since" }, // names no card
        // Done, names its card, painted NOTHING (already in the style — another
        // run's picture): not this run's to undo, and not listed either.
        { status: "done", card_id: C(9), label: "Left as it was" },
        step(1, { kept_art: before(1) }), // the same card twice is once
      ]);
      deckHas(
        [
          rowOf(1),
          rowOf(2),
          rowOf(3, { made: true, entryId: ID(3), previousArtUrl: null }),
          rowOf(4),
          rowOf(5, { jobId: "00000000-0000-4000-8000-00000000a002" }),
          rowOf(6),
          rowOf(7, { previousArtUrl: null }),
          rowOf(9, { jobId: "00000000-0000-4000-8000-00000000a000" }),
        ],
        [cardOf(1), cardOf(2), cardOf(3), cardOf(4), cardOf(5), cardOf(6, { art_url: ART("hand.png") }), cardOf(7), cardOf(9)],
        [
          { id: ID(3), card_id: C(3) },
          { id: ID(4), card_id: C(4) },
        ],
      );
      m.rolls.mockResolvedValue(new Map([[C(1), [{ id: R(9), artUrl: ART("other.jpg") }, { id: R(1), artUrl: before(1) }]]]));
      m.locks.mockResolvedValue(new Set([ID(4)]));

      expect(await planUndoReartRunAction(JOB)).toEqual({
        ok: true,
        earlier: 1,
        own: 1,
        real: 1,
        skipped: [
          { name: "Card 4", reason: REART_UNDO_SKIP_COPY.locked },
          { name: "Card 5", reason: REART_UNDO_SKIP_COPY.changed },
          { name: "Card 6", reason: REART_UNDO_SKIP_COPY.other_art },
          { name: "Card 7", reason: REART_UNDO_SKIP_COPY.no_art_before },
        ],
      });
      for (const fn of [m.update, m.keep, m.claim, m.writePainted, m.unlink, m.event]) expect(fn).not.toHaveBeenCalled();
    });

    it("a card that is gone is named by its step; a run that painted nothing has nothing to undo", async () => {
      run([step(1)]);
      deckHas([rowOf(1)], []);
      expect(await planUndoReartRunAction(JOB)).toEqual({ ok: true, earlier: 0, own: 0, real: 0, skipped: [{ name: "Step 1", reason: REART_UNDO_SKIP_COPY.gone }] });
      run([{ status: "done", card_id: null }, { status: "failed", card_id: C(1), painted: true }]);
      expect(await planUndoReartRunAction(JOB)).toEqual({ ok: true, earlier: 0, own: 0, real: 0, skipped: [] });
    });

    it("a card already put back says so: its own art back, the real card back", async () => {
      run([step(1), { status: "done", card_id: C(3), label: "Step 3", linked: true }]);
      deckHas(
        // “Old art back” (the maker's, or an undo's) leaves a row that names no picture and no run.
        [rowOf(1, { artUrl: null, previousArtUrl: null, jobId: null }), rowOf(3, { made: true, entryId: ID(3), previousArtUrl: null })],
        [cardOf(1, { art_url: ART("mine-1.png") }), cardOf(3)],
        [], // the made card's entry is the real card again
      );
      expect(await planUndoReartRunAction(JOB)).toEqual({
        ok: true,
        earlier: 0,
        own: 0,
        real: 0,
        skipped: [
          { name: "Card 1", reason: REART_UNDO_SKIP_COPY.own_back },
          { name: "Card 3", reason: REART_UNDO_SKIP_COPY.real_back },
        ],
      });
    });

    it("a run from before steps said what they did is told by the deck's rows: a card whose row still names the run", async () => {
      run([
        { status: "done", card_id: C(1), label: "Step 1" }, // painted by this run: its row says so
        { status: "done", card_id: C(2), label: "Step 2" }, // left as it was, or painted again since: unknown — not listed
        { status: "done", card_id: C(3), label: "Step 3" }, // a card this run MADE (it is newer than the run's start)
        { status: "done", card_id: C(4), label: "Step 4" }, // a card an EARLIER run made, re-rolled by this one
      ]);
      const made = { made: true, previousArtUrl: null };
      deckHas(
        [rowOf(1), rowOf(2, { jobId: "00000000-0000-4000-8000-00000000a002" }), rowOf(3, { ...made, entryId: ID(3) }), rowOf(4, { ...made, entryId: ID(4) })],
        [cardOf(1), cardOf(2), cardOf(3, { created_at: "2026-11-12T09:03:00Z" }), cardOf(4, { created_at: "2026-11-10T08:00:00Z" })],
        [
          { id: ID(3), card_id: C(3) },
          { id: ID(4), card_id: C(4) },
        ],
      );
      expect(await planUndoReartRunAction(JOB)).toEqual({
        ok: true,
        earlier: 0,
        own: 1,
        real: 1,
        // The re-rolled made card is never unlinked; such a run kept no
        // record of the picture it replaced.
        skipped: [{ name: "Card 4", reason: REART_UNDO_SKIP_COPY.earlier_gone }],
      });
    });

    it("a run that RE-ROLLED cards an earlier run made puts their earlier pictures back — it never unlinks them from the deck", async () => {
      // The check's finding. Run J made the cards from real cards; this run
      // re-rolled them (their records still say `made`).
      run([step(1, { kept_art: before(1) }), step(2, { kept_art: before(2) })]);
      const made = { made: true, previousArtUrl: null };
      deckHas(
        [rowOf(1, { ...made, entryId: ID(1) }), rowOf(2, { ...made, entryId: ID(2) })],
        [cardOf(1, { created_at: "2026-11-10T08:00:00Z" }), cardOf(2, { created_at: "2026-11-10T08:00:00Z" })],
        [
          { id: ID(1), card_id: C(1) },
          { id: ID(2), card_id: C(2) },
        ],
      );
      // Card 2's earlier picture was kept again under ANOTHER row since (a
      // pick that didn't land): found by its address all the same.
      m.rolls.mockResolvedValue(new Map([keptFor(1), keptFor(2, R(8))]));
      expect(await planUndoReartRunAction(JOB)).toEqual({ ok: true, earlier: 2, own: 0, real: 0, skipped: [] });

      m.card.mockReturnValue({ id: C(1), owner_id: "u1", art_url: ART("ai-1.jpg"), art_position: null, artist_credit: "dev_pro", frame_style: { template: "m15" }, back_face: null });
      m.paintedAdmin.mockResolvedValue(rowOf(1, { ...made, entryId: ID(1) }));
      m.claim.mockImplementation(async (_user: string, _deck: string, cardId: string, rollId: string) => ({
        id: rollId,
        cardId,
        styleVersion: 1,
        jobId: "job-0",
        artUrl: before(1),
        artPosition: null,
        artistCredit: "dev_pro",
        backArtUrl: null,
        backArtPosition: null,
        backArtistCredit: null,
        imageModel: null,
        method: "paint",
        paintedAt: "2026-11-10T08:00:00Z",
      }));
      expect(await undoReartRunAction(JOB)).toMatchObject({ ok: true, undone: 2, failed: [] });
      expect(m.unlink).not.toHaveBeenCalled();
      expect(m.claim.mock.calls.map((call) => call[3])).toEqual([R(1), R(8)]);
      expect(logged().at(-1)).toEqual(["undo_run", { undone: 2, earlier: 2, own: 0, real: 0, failed: 0, remaining: 0, left: 0 }]);
    });

    it("kept pictures that couldn't be READ: no plan at all — a re-rolled card would silently get its own art instead", async () => {
      run([step(1, { kept_art: before(1) })]);
      deckHas([rowOf(1)], [cardOf(1)]);
      m.rolls.mockResolvedValue(null);
      expect(await planUndoReartRunAction(JOB)).toEqual({ ok: false, error: "We couldn't read this run's cards — try again." });
      expect(await undoReartRunAction(JOB)).toEqual({ ok: false, error: "We couldn't read this run's cards — try again." });
      expect(m.update).not.toHaveBeenCalled();
    });

    it("a run over a long deck reads its cards a hundred at a time", async () => {
      const C3 = (n: number) => `00000000-0000-4000-8000-0000000d${String(n).padStart(4, "0")}`;
      const numbers = Array.from({ length: 230 }, (_, i) => i + 1);
      run(numbers.map((n) => ({ status: "done", card_id: C3(n), label: `Step ${n}`, painted: true })));
      m.painted.mockResolvedValue(new Map(numbers.map((n) => [C3(n), rowOf(1, { cardId: C3(n), artUrl: ART("ai.jpg") })])));
      m.cards.mockReturnValue({ data: numbers.map((n) => ({ id: C3(n), owner_id: "u1", title: `Card ${n}`, art_url: ART("ai.jpg") })), error: null });
      expect(await planUndoReartRunAction(JOB)).toMatchObject({ ok: true, own: 230 });
      // 230 cards: three reads of the cards and three of the deck's entries.
      expect(m.cards).toHaveBeenCalledTimes(3);
      expect(m.entries).toHaveBeenCalledTimes(3);
    });

    it("locks, cards or entries that couldn't be read: no plan at all (never “nothing is locked”)", async () => {
      run([step(1)]);
      deckHas([rowOf(1)], [cardOf(1)]);
      m.locks.mockResolvedValueOnce(null);
      expect(await planUndoReartRunAction(JOB)).toEqual({ ok: false, error: "We couldn't read this run's cards — try again." });
      m.cards.mockReturnValueOnce({ data: null, error: { message: "boom" } });
      expect((await planUndoReartRunAction(JOB)).ok).toBe(false);
      m.entries.mockReturnValueOnce({ data: null, error: { message: "boom" } });
      expect((await planUndoReartRunAction(JOB)).ok).toBe(false);
    });
  });

  describe("the undo itself (undoReartRunAction)", () => {
    it("a closed tool, ids that don't read and a run that isn't theirs undo nothing", async () => {
      m.access.mockResolvedValueOnce(null);
      expect((await undoReartRunAction(JOB)).ok).toBe(false);
      for (const bad of [
        ["not-a-run", []],
        [JOB, "c1"],
        [JOB, ["not-a-card"]],
        [JOB, [C(1), 3]],
        [JOB, Array.from({ length: 501 }, () => C(1))],
      ] as const) {
        expect((await undoReartRunAction(bad[0], bad[1])).ok).toBe(false);
      }
      expect((await undoReartRunAction(JOB)).ok).toBe(false);
      for (const fn of [m.update, m.keep, m.claim, m.unlink, m.event]) expect(fn).not.toHaveBeenCalled();
    });

    it("a run of the deck that is painting right now holds its cards: wait for it", async () => {
      run([step(1)]);
      deckHas([rowOf(1)], [cardOf(1)]);
      m.open.mockReturnValue([{ id: "job-9", steps: [{ status: "running", claimed_at: new Date().toISOString() }] }]);
      expect(await undoReartRunAction(JOB)).toMatchObject({ ok: false, code: "BUSY" });
      expect(m.update).not.toHaveBeenCalled();
      expect(logged()).toEqual([["undo_run_failed", { reason: "busy" }]]);
    });

    it("a first paint gets its own art back — the picture it takes off is kept — and no credit is touched", async () => {
      run([step(1)]);
      deckHas([rowOf(1)], [cardOf(1)]);
      m.card.mockReturnValue({ id: C(1), owner_id: "u1", art_url: ART("ai-1.jpg"), art_position: null, artist_credit: "dev_pro", back_face: null });
      expect(await undoReartRunAction(JOB)).toEqual({ ok: true, undone: 1, failed: [], remaining: 0 });
      expect(m.cardLocked).toHaveBeenCalledWith(DECK, C(1));
      expect(m.update.mock.calls[0][0]).toBe(C(1));
      expect(m.update.mock.calls[0][1]).toMatchObject({ art_url: ART("mine-1.png"), artist_credit: "Jane Painter" });
      expect(m.keep.mock.calls[0][2]).toMatchObject({ cardId: C(1), artUrl: ART("ai-1.jpg"), jobId: JOB });
      expect(m.balance).not.toHaveBeenCalled();
      expect(logged()).toEqual([["undo_run", { undone: 1, earlier: 0, own: 1, real: 0, failed: 0, remaining: 0, left: 0 }]]);
    });

    it("a re-rolled card goes back to the earlier picture the run kept", async () => {
      run([step(1, { kept_art: before(1) })]);
      const row = rowOf(1, { entryId: "entry-1" });
      deckHas([row], [cardOf(1)]);
      m.rolls.mockResolvedValue(new Map([keptFor(1)]));
      m.card.mockReturnValue({ id: C(1), owner_id: "u1", art_url: ART("ai-1.jpg"), art_position: null, artist_credit: "dev_pro", frame_style: { template: "m15" }, back_face: null });
      m.paintedAdmin.mockResolvedValue(row);
      m.paintedRows.mockResolvedValue([row]);
      m.claim.mockResolvedValue({
        id: R(1),
        cardId: C(1),
        styleVersion: 1,
        jobId: "job-0",
        artUrl: ART("ai-0.jpg"),
        artPosition: null,
        artistCredit: "dev_pro",
        backArtUrl: null,
        backArtPosition: null,
        backArtistCredit: null,
        imageModel: "bfl/flux-2-pro",
        method: "paint",
        paintedAt: "2026-11-11T10:00:00Z",
      });
      expect(await undoReartRunAction(JOB)).toEqual({ ok: true, undone: 1, failed: [], remaining: 0 });
      expect(m.claim).toHaveBeenCalledWith("u1", DECK, C(1), R(1));
      expect(m.update.mock.calls[0][1]).toMatchObject({ art_url: ART("ai-0.jpg") });
      // The deck's row names that picture under the run that painted IT —
      // so that run can be undone next.
      expect(m.writePainted.mock.calls[0].slice(0, 3)).toEqual(["u1", DECK, "job-0"]);
      expect(m.writePainted.mock.calls[0][3]).toMatchObject({ artUrl: ART("ai-0.jpg") });
      expect(logged()).toEqual([["undo_run", { undone: 1, earlier: 1, own: 0, real: 0, failed: 0, remaining: 0, left: 0 }]]);
    });

    it("a real card the run made goes back to the real card: its entry is unlinked through the deck's own action, and the made card is left alone", async () => {
      run([{ status: "done", card_id: C(3), label: "Step 3", linked: true }]);
      deckHas([rowOf(3, { made: true, entryId: ID(3), previousArtUrl: null })], [cardOf(3)], [{ id: ID(3), card_id: C(3) }]);
      expect(await undoReartRunAction(JOB)).toEqual({ ok: true, undone: 1, failed: [], remaining: 0 });
      expect(m.unlink.mock.calls).toEqual([[ID(3)]]);
      for (const fn of [m.update, m.keep, m.claim, m.discard, m.discardUnused]) expect(fn).not.toHaveBeenCalled();
      expect(logged()).toEqual([["undo_run", { undone: 1, earlier: 0, own: 0, real: 1, failed: 0, remaining: 0, left: 0 }]]);
    });

    it("puts back a few cards a request and says how many remain; the cards named in `skip` are not tried again", async () => {
      const count = REART_UNDO_BATCH + 3;
      const numbers = Array.from({ length: count }, (_, i) => i + 1);
      const C2 = (n: number) => `00000000-0000-4000-8000-0000000c${String(n).padStart(4, "0")}`;
      run(numbers.map((n) => ({ status: "done", card_id: C2(n), label: `Step ${n}`, painted: true })));
      m.painted.mockResolvedValue(new Map(numbers.map((n) => [C2(n), rowOf(1, { cardId: C2(n), artUrl: ART("ai.jpg") })])));
      m.cards.mockReturnValue({ data: numbers.map((n) => ({ id: C2(n), owner_id: "u1", title: `Card ${n}`, art_url: ART("ai.jpg") })), error: null });
      m.card.mockReturnValue({ id: C2(1), owner_id: "u1", art_url: ART("ai.jpg"), art_position: null, artist_credit: "dev_pro", back_face: null });

      expect(await undoReartRunAction(JOB)).toEqual({ ok: true, undone: REART_UNDO_BATCH, failed: [], remaining: 3 });
      expect(m.update).toHaveBeenCalledTimes(REART_UNDO_BATCH);
      // The cards it tried, in the run's order (each asks its lock first).
      const tried = () => m.cardLocked.mock.calls.map(([, cardId]) => cardId);
      expect(tried()).toEqual(numbers.slice(0, REART_UNDO_BATCH).map(C2));

      m.cardLocked.mockClear();
      m.event.mockClear();
      expect(await undoReartRunAction(JOB, [C2(1), C2(2)])).toMatchObject({ ok: true, undone: REART_UNDO_BATCH, remaining: 1 });
      expect(tried()).toEqual(numbers.slice(2, 2 + REART_UNDO_BATCH).map(C2));
      expect(logged()).toEqual([["undo_run", { undone: REART_UNDO_BATCH, earlier: 0, own: REART_UNDO_BATCH, real: 0, failed: 0, remaining: 1, left: 0 }]]);
    });

    it("a card that can't be put back is left as it is and named with its id — in words of ours — while the others go back", async () => {
      run([step(1), step(2), { status: "done", card_id: C(3), label: "Step 3", linked: true }]);
      deckHas(
        [rowOf(1), rowOf(2), rowOf(3, { made: true, entryId: ID(3), previousArtUrl: null })],
        [cardOf(1), cardOf(2), cardOf(3)],
        [{ id: ID(3), card_id: C(3) }],
      );
      const logs = vi.spyOn(console, "error").mockImplementation(() => undefined);
      // Card 1's edit is refused; card 2's throws; the real card's unlink fails with the database's words.
      m.card.mockImplementation(() => ({ id: C(1), owner_id: "u1", art_url: ART(`ai-${m.card.mock.calls.length}.jpg`), art_position: null, artist_credit: "dev_pro", back_face: null }));
      m.update.mockResolvedValueOnce({ ok: false, formError: "No." }).mockRejectedValueOnce(new Error("boom"));
      m.unlink.mockResolvedValue({ ok: false, error: 'new row violates row-level security policy for table "deck_cards"' });
      const result = await undoReartRunAction(JOB);
      expect(result).toMatchObject({ ok: true, undone: 0, remaining: 0 });
      if (!result.ok) throw new Error("unreachable");
      expect(result.failed.map((failure) => [failure.name, failure.cardId])).toEqual([
        ["Card 1", C(1)],
        ["Card 2", C(2)],
        ["Card 3", C(3)],
      ]);
      expect(result.failed[2].reason).toBe("The real card couldn't be put back in the deck — try again.");
      for (const failure of result.failed) expect(failure.reason).not.toMatch(/row-level|boom|violates/);
      expect(logged()).toEqual([["undo_run", { undone: 0, earlier: 0, own: 0, real: 0, failed: 3, remaining: 0, left: 0 }]]);
      logs.mockRestore();
    });

    it("what the plan leaves as it is is never touched, and counted in the log", async () => {
      run([step(1), step(4)]);
      deckHas([rowOf(1), rowOf(4)], [cardOf(1), cardOf(4)], [{ id: ID(4), card_id: C(4) }]);
      m.locks.mockResolvedValue(new Set([ID(4)]));
      m.card.mockReturnValue({ id: C(1), owner_id: "u1", art_url: ART("ai-1.jpg"), art_position: null, artist_credit: "dev_pro", back_face: null });
      expect(await undoReartRunAction(JOB)).toEqual({ ok: true, undone: 1, failed: [], remaining: 0 });
      expect(m.cardLocked.mock.calls).toEqual([[DECK, C(1)]]);
      expect(m.update).toHaveBeenCalledTimes(1);
      expect(logged()).toEqual([["undo_run", { undone: 1, earlier: 0, own: 1, real: 0, failed: 0, remaining: 0, left: 1 }]]);
    });

    it("a run whose cards couldn't be read undoes nothing and is `undo_run_failed`", async () => {
      run([step(1)]);
      deckHas([rowOf(1)], [cardOf(1)]);
      m.locks.mockResolvedValue(null);
      expect(await undoReartRunAction(JOB)).toEqual({ ok: false, error: "We couldn't read this run's cards — try again." });
      expect(m.update).not.toHaveBeenCalled();
      expect(logged()).toEqual([["undo_run_failed", { reason: "unread" }]]);
    });
  });
});
