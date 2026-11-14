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
  saveCardWords: m.saveWords,
  readDeckStyleAdmin: m.storedStyle,
  styleLicenceProblem: m.licence,
  planLines: (plan: { entries: unknown[] }) => plan.entries,
}));

import {
  planReartAction,
  restoreReartArtAction,
  saveReartCardWordsAction,
  saveReartStyleAction,
  startReartAction,
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
  m.licence.mockReturnValue(null);
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
    m.licence.mockReturnValue("Confirm that you hold the rights to this property before the deck names it.");
    expect(await saveReartStyleAction(DECK, NAMED)).toEqual({
      ok: false,
      error: "Confirm that you hold the rights to this property before the deck names it.",
    });
    expect(m.saveStyle).not.toHaveBeenCalled();
    expect(logged()).toEqual([["save_style_failed", { reason: "not_confirmed" }]]);
    m.event.mockClear();
    m.licence.mockReturnValue("The reference picture has to be one you uploaded here — upload it again.");
    expect((await saveReartStyleAction(DECK, NAMED, { attested: true })).ok).toBe(false);
    expect(logged()).toEqual([["save_style_failed", { reason: "reference_not_own" }]]);
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
    m.plan.mockResolvedValue({ ok: false, error: "Confirm that you hold the rights to this property before the deck names it." });
    const refused = await startReartAction({ deckId: DECK, style: NAMED });
    expect(refused).toMatchObject({ ok: false, error: "Confirm that you hold the rights to this property before the deck names it." });
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
    // …and names no model: nothing Re-art painted is on the card now.
    expect(m.writePainted.mock.calls[0][3]).toMatchObject({ artUrl: null, previousArtUrl: null, styleVersion: 2, imageModel: null });
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
