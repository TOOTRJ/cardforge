import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Re-art deck's server reads and writes (lib/tools/re-art/server.ts) that
// decide what a run may do to a card and to a stored picture:
//
//   * the PLAN calls a card "in this style" only while it still SHOWS the
//     picture Re-art painted. It used to compare the style version alone, so
//     a card whose art was changed in the editor — or repainted by a run of
//     another deck that holds it — still counted as done. Such a card is
//     left as it is by a run over the deck (someone's later choice: nothing
//     is charged for it) and the run SAYS so; a named paint paints it;
//
//   * a picture a re-roll or "Put the old art back" took off a card is
//     removed only when NOTHING else of the maker's shows or keeps it. It
//     used to be removed unasked: a remix of the maker's own card shares its
//     parent's art file (lib/cards/remix-media.ts), so the remix was left
//     with a dead picture. The guard fails CLOSED (an error, a count that
//     didn't come back, no service role: the picture stays) and asks the
//     cards before the rows (a paint writes its row before it edits the
//     card, so no moment misses both);
//
//   * a paint's row can be put back (the step writes it before the card's
//     edit), and the studio reads Re-art's pictures on a card from every
//     deck of the maker's.
// ---------------------------------------------------------------------------

type Call = {
  table: string;
  op: "select" | "delete" | "upsert";
  columns?: string;
  filters: Array<[string, unknown]>;
  head: boolean;
  row?: unknown;
};
type Result = { data?: unknown; count?: number | null; error?: { message: string; code?: string } | null };

const m = vi.hoisted(() => ({
  /** The caller's session client's answers. */
  query: vi.fn(),
  /** The service role's answers. */
  admin: vi.fn(),
  adminConfigured: vi.fn(),
  items: vi.fn(),
  discard: vi.fn(),
}));

function clientOf(answerOf: (call: Call) => Promise<Result>) {
  return {
    from: (table: string) => {
      const call: Call = { table, op: "select", filters: [], head: false };
      const answer = () => answerOf(call);
      const chain = {
        select: (columns: string, options?: { head?: boolean }) => {
          call.columns = columns;
          call.head = Boolean(options?.head);
          return chain;
        },
        delete: () => {
          call.op = "delete";
          return chain;
        },
        upsert: (row: unknown) => {
          call.op = "upsert";
          call.row = row;
          return answer();
        },
        eq: (column: string, value: unknown) => {
          call.filters.push([column, value]);
          return chain;
        },
        in: (column: string, value: unknown) => {
          call.filters.push([column, value]);
          return chain;
        },
        not: () => chain,
        filter: (column: string, _operator: string, value: unknown) => {
          call.filters.push([column, value]);
          return chain;
        },
        maybeSingle: answer,
        then: (resolve: (value: Result) => unknown, reject?: (reason: unknown) => unknown) => answer().then(resolve, reject),
      };
      return chain;
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => clientOf(async (call) => m.query(call)) }));
vi.mock("@/lib/supabase/admin", () => ({
  isAdminConfigured: () => m.adminConfigured(),
  createAdminClient: () => clientOf(async (call) => m.admin(call)),
}));
vi.mock("@/lib/decks/queries", () => ({ listDeckPageCards: m.items }));
vi.mock("@/lib/scryfall/rate-limit", () => ({ checkScryfallRateLimit: vi.fn(), logScryfallCall: vi.fn() }));
vi.mock("@/lib/cards/frame-reviews", () => ({ getVerifiedFrameKeys: vi.fn(async () => []) }));
vi.mock("@/lib/billing/entitlements", () => ({ getEntitlements: vi.fn(async () => ({ removeWatermark: false })) }));
vi.mock("@/lib/ai/random-art", () => ({ discardGeneratedArt: m.discard }));
vi.mock("@/lib/tools/bulk-customize/planner", () => ({ planCustomizedCard: vi.fn() }));
vi.mock("@/lib/tools/bulk-customize/server", () => ({ fetchBulkPrintings: vi.fn(), importPatchOf: vi.fn() }));

import {
  discardReartArtIfUnused,
  planReartRun,
  readCardWords,
  readCardWordsAdmin,
  readDeckStyle,
  readDeckStyleAdmin,
  readPaintedCardAdmin,
  readPaintedCards,
  readPaintedRowsForCardAdmin,
  readReartPicturesByCard,
  revertPaintedCard,
  saveCardWords,
  saveDeckStyle,
  writePaintedCard,
  type PaintedCard,
} from "@/lib/tools/re-art/server";
import { REART_CHANGED_COPY } from "@/lib/tools/re-art/model";

const ME = "u1";
const DECK = "00000000-0000-4000-8000-0000000000d1";
const ENTRY = "00000000-0000-4000-8000-0000000000e1";
const CARD = "00000000-0000-4000-8000-0000000000c1";
const ART = (n: string) => `https://x.supabase.co/storage/v1/object/public/card-art/u1/${n}`;

const columnOf = (call: Call) => call.filters.find(([column]) => column !== "owner_id")?.[0];

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset();
  m.adminConfigured.mockReturnValue(true);
});

describe("the plan — a card is in the style only while it still shows the style's picture", () => {
  const item = (artUrl: string | null) => ({
    entry: { id: ENTRY, name: "Archivist", quantity: 1, board: "main", card_id: CARD, scryfall_id: null, type_line: "Creature — Human Wizard" },
    card: { id: CARD, owner_id: ME, title: "Archivist of Lost Hours", card_type: "creature", art_url: artUrl, frame_style: { template: "m15" }, back_face: null },
    cardOwner: null,
  });
  const row = (artUrl: string | null) => ({
    card_id: CARD,
    entry_id: null,
    style_version: 3,
    art_url: artUrl,
    back_art_url: null,
    made: false,
    previous_art_url: ART("mine.png"),
    previous_art_position: null,
    previous_back_art_url: null,
    previous_back_art_position: null,
    previous_artist_credit: null,
    previous_back_artist_credit: null,
    painted_at: "2026-11-12T00:00:00Z",
  });

  /** The deck with its stored style (version 3) and one own card. */
  function deckWith(cardArt: string | null, painted: ReturnType<typeof row> | null, words: unknown[] = []) {
    m.items.mockResolvedValue([item(cardArt)]);
    m.query.mockImplementation(async (call: Call): Promise<Result> => {
      if (call.table === "decks") return { data: { id: DECK, slug: "embers", title: "Embers", visibility: "private" } };
      if (call.table === "deck_art_styles") return { data: { preset: "watercolor", theme: "a haunted fen", version: 3 } };
      if (call.table === "deck_reart_cards") return { data: painted ? [painted] : [] };
      if (call.table === "deck_reart_prompts") return { data: words };
      return { data: null };
    });
  }

  const plan = (entryIds?: string[]) =>
    planReartRun(ME, { deckId: DECK, scope: "all", visibility: "private", ...(entryIds ? { entryIds } : {}) }, "deck_import");

  it("painted in this style and still showing it: in the style, nothing to paint", async () => {
    deckWith(ART("ai-1.jpg"), row(ART("ai-1.jpg")));
    expect(await plan()).toMatchObject({ ok: true, version: 3, styleChanged: false, inStyle: 1, entries: [], skipped: [] });
  });

  it("painted in this style but showing OTHER art now: not in the style — left as it is, and the run says why", async () => {
    // Changed in the card's editor, or repainted by a run of another deck.
    deckWith(ART("hand.png"), row(ART("ai-1.jpg")));
    expect(await plan()).toMatchObject({
      ok: true,
      inStyle: 0,
      entries: [],
      skipped: [{ name: "Archivist of Lost Hours", reason: REART_CHANGED_COPY }],
    });
  });

  it("a NAMED paint (a re-roll) paints it, priced", async () => {
    deckWith(ART("hand.png"), row(ART("ai-1.jpg")));
    const named = await plan([ENTRY]);
    expect(named.ok && named.entries).toEqual([
      expect.objectContaining({ entryId: ENTRY, kind: "own", cardId: CARD, credits: 1, repaint: true, paintedBefore: true }),
    ]);
    expect(named.ok && named.skipped).toEqual([]);
  });

  it("given its own art back from the tool: kept — a run over the deck leaves it alone", async () => {
    deckWith(ART("mine.png"), row(null));
    expect(await plan()).toMatchObject({ ok: true, inStyle: 1, entries: [], skipped: [] });
  });

  it("says which cards have words of their own (0209) — never the words", async () => {
    deckWith(ART("mine.png"), null, [{ entry_id: ENTRY, prompt: "an old goblin librarian", only_words: true }]);
    const withWords = await plan();
    expect(withWords.ok && withWords.entries).toEqual([expect.objectContaining({ ownWords: true, notes: ["Its own words."] })]);
    expect(JSON.stringify(withWords)).not.toContain("librarian");
    deckWith(ART("mine.png"), null);
    const without = await plan();
    expect(without.ok && without.entries).toEqual([expect.objectContaining({ ownWords: false, notes: [] })]);
  });

  it("never painted: painted; and a named card in the style is painted again", async () => {
    deckWith(ART("mine.png"), null);
    const fresh = await plan();
    expect(fresh.ok && fresh.entries).toEqual([expect.objectContaining({ kind: "own", repaint: false, paintedBefore: false })]);
    deckWith(ART("ai-1.jpg"), row(ART("ai-1.jpg")));
    const named = await plan([ENTRY]);
    expect(named.ok && named.entries).toEqual([expect.objectContaining({ kind: "own", repaint: true, paintedBefore: true })]);
  });
});

describe("a replaced picture is removed only when nothing else shows or keeps it", () => {
  const PICTURE = ART("ai-old.jpg");
  /** How many rows hold the picture, by `table.column` (null: the count
   *  didn't come back). */
  function holders(counts: Record<string, number | null | "error"> = {}) {
    // (NaN is a `number` to TypeScript: the guard must not take it for 0.)
    m.admin.mockImplementation(async (call: Call): Promise<Result> => {
      const key = `${call.table}.${columnOf(call)}`;
      const answer = key in counts ? counts[key] : 0;
      return answer === "error" ? { count: null, error: { message: "boom" } } : { count: answer, error: null };
    });
  }

  it("nothing holds it: removed", async () => {
    holders();
    expect(await discardReartArtIfUnused(ME, PICTURE)).toBe(true);
    expect(m.discard).toHaveBeenCalledWith(ME, PICTURE);
  });

  it("asks with the service role, only about the caller's own rows, by the picture's exact address, reading no row", async () => {
    holders();
    await discardReartArtIfUnused(ME, PICTURE);
    // Never the caller's session: its read of deck_reart_cards is gated on
    // the tool being open, and a count a policy emptied reads as "unused".
    expect(m.query).not.toHaveBeenCalled();
    const calls = m.admin.mock.calls.map(([call]) => call as Call);
    expect(calls.map((call) => `${call.table}.${columnOf(call)}`)).toEqual([
      "cards.art_url",
      "cards.back_face->>art_url",
      "deck_reart_cards.previous_art_url",
      "deck_reart_cards.previous_back_art_url",
    ]);
    for (const call of calls) {
      expect(call.op).toBe("select");
      expect(call.head).toBe(true);
      expect(call.filters).toContainEqual(["owner_id", ME]);
      expect(call.filters).toContainEqual([columnOf(call), PICTURE]);
    }
  });

  it("asks the cards BEFORE the rows, never together (a paint writes its row before it edits the card)", async () => {
    const asked: string[] = [];
    let cardsAnswered = 0;
    m.admin.mockImplementation(async (call: Call): Promise<Result> => {
      // The rows are asked only once both card counts have come back.
      if (call.table === "deck_reart_cards") expect(cardsAnswered).toBe(2);
      asked.push(call.table);
      await new Promise((resolve) => setTimeout(resolve, 5));
      if (call.table === "cards") cardsAnswered += 1;
      return { count: 0, error: null };
    });
    expect(await discardReartArtIfUnused(ME, PICTURE)).toBe(true);
    expect(asked).toEqual(["cards", "cards", "deck_reart_cards", "deck_reart_cards"]);
  });

  it.each([
    ["another card of the maker's shows it (a remix of the card shares its art file)", "cards.art_url"],
    ["a card shows it on its back face", "cards.back_face->>art_url"],
    ["a Re-art row keeps it as the art to put back", "deck_reart_cards.previous_art_url"],
    ["a Re-art row keeps it as the back's art to put back", "deck_reart_cards.previous_back_art_url"],
  ])("%s: kept", async (_name, holder) => {
    holders({ [holder]: 1 });
    expect(await discardReartArtIfUnused(ME, PICTURE)).toBe(false);
    expect(m.discard).not.toHaveBeenCalled();
  });

  it("a card that shows it ends the question: the rows aren't asked", async () => {
    holders({ "cards.art_url": 2 });
    await discardReartArtIfUnused(ME, PICTURE);
    expect(m.admin.mock.calls.map(([call]) => (call as Call).table)).toEqual(["cards", "cards"]);
  });

  it.each([
    ["an error", "cards.art_url", "error" as const],
    ["an error on the rows", "deck_reart_cards.previous_art_url", "error" as const],
    ["a count that didn't come back (no error either)", "cards.back_face->>art_url", null],
    ["a rows count that didn't come back", "deck_reart_cards.previous_back_art_url", null],
    ["a count that is no number", "cards.art_url", Number.NaN],
  ])("fails closed on %s: the picture stays", async (_name, holder, answer) => {
    holders({ [holder]: answer });
    expect(await discardReartArtIfUnused(ME, PICTURE)).toBe(false);
    expect(m.discard).not.toHaveBeenCalled();
  });

  it("fails closed on a read that throws, and with no service role (a leftover is the orphan sweep's; a dead link is nobody's)", async () => {
    m.admin.mockRejectedValue(new Error("offline"));
    expect(await discardReartArtIfUnused(ME, PICTURE)).toBe(false);
    m.adminConfigured.mockReturnValue(false);
    m.admin.mockReset();
    expect(await discardReartArtIfUnused(ME, PICTURE)).toBe(false);
    expect(m.admin).not.toHaveBeenCalled();
    expect(m.discard).not.toHaveBeenCalled();
  });

  it("no picture: nothing asked, nothing removed", async () => {
    expect(await discardReartArtIfUnused(ME, null)).toBe(false);
    expect(await discardReartArtIfUnused(ME, undefined)).toBe(false);
    expect(m.admin).not.toHaveBeenCalled();
    expect(m.discard).not.toHaveBeenCalled();
  });
});

describe("a paint's row is put back when its edit was refused", () => {
  const before: PaintedCard = {
    cardId: CARD,
    entryId: ENTRY,
    styleVersion: 2,
    artUrl: ART("ai-old.jpg"),
    backArtUrl: null,
    made: false,
    previousArtUrl: ART("mine.png"),
    previousArtPosition: null,
    previousBackArtUrl: null,
    previousBackArtPosition: null,
    previousArtistCredit: "Jane Painter",
    previousBackArtistCredit: null,
    paintedAt: "2026-11-01T00:00:00Z",
    jobId: "job-earlier",
    imageModel: "bfl/flux-kontext-pro",
  };

  it("an earlier row is written back as it was — the run that painted it included", async () => {
    m.admin.mockResolvedValue({ error: null });
    await revertPaintedCard(ME, DECK, CARD, before);
    const [call] = m.admin.mock.calls.map(([c]) => c as Call);
    expect(call).toMatchObject({ table: "deck_reart_cards", op: "upsert" });
    expect(call.row).toMatchObject({
      deck_id: DECK,
      card_id: CARD,
      owner_id: ME,
      style_version: 2,
      entry_id: ENTRY,
      art_url: ART("ai-old.jpg"),
      previous_art_url: ART("mine.png"),
      previous_artist_credit: "Jane Painter",
      made: false,
      job_id: "job-earlier",
      // …and who painted it (0211).
      image_model: "bfl/flux-kontext-pro",
    });
  });

  it("no earlier row: the new one is removed, held to the deck, the card and the owner", async () => {
    m.admin.mockResolvedValue({ error: null });
    await revertPaintedCard(ME, DECK, CARD, null);
    const [call] = m.admin.mock.calls.map(([c]) => c as Call);
    expect(call).toMatchObject({ table: "deck_reart_cards", op: "delete" });
    expect(call.filters).toEqual([
      ["deck_id", DECK],
      ["card_id", CARD],
      ["owner_id", ME],
    ]);
  });

  it("never throws on a failed write, and does nothing without the service role", async () => {
    m.admin.mockResolvedValue({ error: { message: "boom" } });
    await expect(revertPaintedCard(ME, DECK, CARD, null)).resolves.toBeUndefined();
    m.adminConfigured.mockReturnValue(false);
    m.admin.mockReset();
    await revertPaintedCard(ME, DECK, CARD, null);
    expect(m.admin).not.toHaveBeenCalled();
  });
});

describe("Re-art's pictures on a card, from every deck of the maker's", () => {
  it("groups the pictures by card (their own rows: the caller's session)", async () => {
    m.query.mockResolvedValue({
      data: [
        { card_id: CARD, art_url: ART("ai-a.jpg") },
        { card_id: CARD, art_url: ART("ai-b.jpg") },
        { card_id: "other", art_url: ART("ai-c.jpg") },
        { card_id: "bare", art_url: null },
      ],
    });
    const { pictures, complete } = await readReartPicturesByCard([CARD, "other", CARD]);
    expect(complete).toBe(true);
    expect(pictures.get(CARD)).toEqual([ART("ai-a.jpg"), ART("ai-b.jpg")]);
    expect(pictures.get("other")).toEqual([ART("ai-c.jpg")]);
    expect(pictures.has("bare")).toBe(false);
    const [call] = m.query.mock.calls.map(([c]) => c as Call);
    expect(call.table).toBe("deck_reart_cards");
    // Each card named once.
    expect(call.filters).toEqual([["card_id", [CARD, "other"]]]);
    expect(m.admin).not.toHaveBeenCalled();
  });

  it("no cards: no read; a long deck is read a hundred cards at a time", async () => {
    expect(await readReartPicturesByCard([])).toEqual({ pictures: new Map(), complete: true });
    expect(m.query).not.toHaveBeenCalled();
    m.query.mockResolvedValue({ data: [] });
    await readReartPicturesByCard(Array.from({ length: 250 }, (_, i) => `card-${i}`));
    expect(m.query.mock.calls.map(([c]) => ((c as Call).filters[0][1] as string[]).length)).toEqual([100, 100, 50]);
  });

  it("a read that failed is said, never passed off as “no pictures”", async () => {
    m.query.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect(await readReartPicturesByCard([CARD])).toEqual({ pictures: new Map(), complete: false });
    // One chunk of several: what was read is kept, and it is still incomplete.
    m.query.mockReset();
    m.query
      .mockResolvedValueOnce({ data: [{ card_id: "card-0", art_url: ART("ai-a.jpg") }], error: null })
      .mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    const partial = await readReartPicturesByCard(Array.from({ length: 150 }, (_, i) => `card-${i}`));
    expect(partial.complete).toBe(false);
    expect(partial.pictures.get("card-0")).toEqual([ART("ai-a.jpg")]);
  });
});

describe("the deck's style — the template or the maker's own prompt (0209)", () => {
  const OWN_ROW = { preset: "watercolor", theme: "a haunted fen", mode: "custom", prompt: "{card} in thick oil paint", version: 4, owner_id: ME };

  it("reads the mode and the prompt with the style", async () => {
    m.query.mockResolvedValue({ data: OWN_ROW, error: null });
    expect(await readDeckStyle(DECK)).toEqual({ preset: "watercolor", theme: "a haunted fen", mode: "custom", prompt: "{card} in thick oil paint", version: 4 });
    expect((m.query.mock.calls[0][0] as Call).columns).toContain("mode, prompt");
  });

  it("a row with neither (saved before 0209) is the template", async () => {
    m.query.mockResolvedValue({ data: { preset: "watercolor", theme: "a haunted fen", version: 2 }, error: null });
    expect(await readDeckStyle(DECK)).toEqual({ preset: "watercolor", theme: "a haunted fen", mode: "preset", prompt: "", version: 2 });
  });

  it("a database 0209 hasn't reached is read again without its columns: every style there is the template", async () => {
    m.query
      .mockResolvedValueOnce({ data: null, error: { message: "column deck_art_styles.mode does not exist", code: "42703" } })
      .mockResolvedValueOnce({ data: { preset: "storybook", theme: "", version: 1 }, error: null });
    expect(await readDeckStyle(DECK)).toEqual({ preset: "storybook", theme: "", mode: "preset", prompt: "", version: 1 });
    expect(m.query.mock.calls.map(([call]) => (call as Call).columns)).toEqual(["preset, theme, mode, prompt, version", "preset, theme, version"]);
    // The step's read falls back the same way, and still holds the row to its owner.
    m.admin
      .mockResolvedValueOnce({ data: null, error: { message: "nope", code: "42703" } })
      .mockResolvedValueOnce({ data: { preset: "storybook", theme: "", version: 1, owner_id: ME }, error: null });
    expect(await readDeckStyleAdmin(ME, DECK)).toMatchObject({ mode: "preset", version: 1 });
    m.admin.mockResolvedValue({ data: { ...OWN_ROW, owner_id: "someone" }, error: null });
    expect(await readDeckStyleAdmin(ME, DECK)).toBeNull();
  });

  describe("saving", () => {
    const upserts = () => m.admin.mock.calls.map(([call]) => call as Call).filter((call) => call.op === "upsert");
    const stored = (row: unknown) =>
      m.admin.mockImplementation(async (call: Call): Promise<Result> => (call.op === "upsert" ? { error: null } : { data: row, error: null }));

    it("the same look keeps its version and writes nothing", async () => {
      stored(OWN_ROW);
      expect(await saveDeckStyle(ME, DECK, { preset: "watercolor", theme: "a haunted fen", mode: "custom", prompt: "  {card} in thick oil paint " })).toMatchObject({
        version: 4,
        mode: "custom",
      });
      expect(upserts()).toEqual([]);
    });

    it("the other mode's draft is saved WITHOUT a new version: the same look, nothing repainted, nothing lost on a reload", async () => {
      // Saved in the template; the maker wrote a prompt, then went back.
      stored({ preset: "watercolor", theme: "a haunted fen", mode: "preset", prompt: "", version: 4, owner_id: ME });
      expect(await saveDeckStyle(ME, DECK, { preset: "watercolor", theme: "a haunted fen", mode: "preset", prompt: "{card} in oils, a draft" })).toMatchObject({
        version: 4,
        mode: "preset",
        prompt: "{card} in oils, a draft",
      });
      expect(upserts()).toHaveLength(1);
      expect(upserts()[0].row).toMatchObject({ mode: "preset", prompt: "{card} in oils, a draft", version: 4 });
      // …and the other way: the template's fields under the maker's own prompt.
      m.admin.mockClear();
      stored(OWN_ROW);
      expect(await saveDeckStyle(ME, DECK, { ...OWN_ROW, mode: "custom", theme: "a sunken city" })).toMatchObject({ version: 4 });
      expect(upserts()[0].row).toMatchObject({ mode: "custom", theme: "a sunken city", version: 4 });
    });

    it("a rewritten prompt — or a switch of mode — is a new look: the version moves on and the row holds both", async () => {
      stored(OWN_ROW);
      expect(await saveDeckStyle(ME, DECK, { ...OWN_ROW, mode: "custom", prompt: "{card} in thin washes" })).toMatchObject({ version: 5 });
      expect(upserts()[0].row).toEqual({
        deck_id: DECK,
        owner_id: ME,
        preset: "watercolor",
        theme: "a haunted fen",
        mode: "custom",
        prompt: "{card} in thin washes",
        version: 5,
      });
      m.admin.mockClear();
      expect(await saveDeckStyle(ME, DECK, { preset: "watercolor", theme: "a haunted fen" })).toMatchObject({ version: 5, mode: "preset" });
      expect(upserts()[0].row).toMatchObject({ mode: "preset", version: 5 });
    });

    it("a first style is version 1; another user's deck saves nothing; a failed write says so", async () => {
      stored(null);
      expect(await saveDeckStyle(ME, DECK, { preset: "anime", theme: "" })).toMatchObject({ version: 1, mode: "preset", prompt: "" });
      stored({ ...OWN_ROW, owner_id: "someone" });
      m.admin.mockClear();
      stored({ ...OWN_ROW, owner_id: "someone" });
      expect(await saveDeckStyle(ME, DECK, { preset: "anime", theme: "" })).toBeNull();
      expect(upserts()).toEqual([]);
      m.admin.mockImplementation(async (call: Call): Promise<Result> => (call.op === "upsert" ? { error: { message: "boom" } } : { data: null, error: null }));
      expect(await saveDeckStyle(ME, DECK, { preset: "anime", theme: "" })).toBeNull();
    });
  });
});

describe("one card's own words (0209 deck_reart_prompts)", () => {
  it("are read by entry, from the caller's own rows; a failed read is “none”", async () => {
    m.query.mockResolvedValue({
      data: [
        { entry_id: ENTRY, prompt: "an old goblin librarian", only_words: false },
        { entry_id: "e2", prompt: "a lighthouse", only_words: true },
      ],
      error: null,
    });
    const words = await readCardWords(DECK);
    expect(words.get(ENTRY)).toEqual({ text: "an old goblin librarian", only: false });
    expect(words.get("e2")).toEqual({ text: "a lighthouse", only: true });
    expect((m.query.mock.calls[0][0] as Call).filters).toEqual([["deck_id", DECK]]);
    // The table isn't there yet (a deploy ahead of its migration).
    m.query.mockResolvedValue({ data: null, error: { message: "relation does not exist", code: "42P01" } });
    expect((await readCardWords(DECK)).size).toBe(0);
  });

  it("the step reads one entry's with the service role, held to the owner", async () => {
    m.admin.mockResolvedValue({ data: { entry_id: ENTRY, prompt: "a lighthouse", only_words: true, owner_id: ME }, error: null });
    expect(await readCardWordsAdmin(ME, DECK, ENTRY)).toEqual({ ok: true, words: { text: "a lighthouse", only: true } });
    expect((m.admin.mock.calls[0][0] as Call).filters).toEqual([
      ["deck_id", DECK],
      ["entry_id", ENTRY],
    ]);
    expect(await readCardWordsAdmin("someone", DECK, ENTRY)).toEqual({ ok: true, words: null });
    m.admin.mockResolvedValue({ data: null, error: null });
    expect(await readCardWordsAdmin(ME, DECK, ENTRY)).toEqual({ ok: true, words: null });
  });

  it("…and FAILS CLOSED: a read that didn't answer is never “no words” (the card would be painted without them, and charged)", async () => {
    m.admin.mockResolvedValue({ data: null, error: { message: "connection reset", code: "08006" } });
    expect(await readCardWordsAdmin(ME, DECK, ENTRY)).toEqual({ ok: false });
    m.admin.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect(await readCardWordsAdmin(ME, DECK, ENTRY)).toEqual({ ok: false });
    m.adminConfigured.mockReturnValue(false);
    expect(await readCardWordsAdmin(ME, DECK, ENTRY)).toEqual({ ok: false });
    m.adminConfigured.mockReturnValue(true);
    // The one error that IS "none": the table isn't there yet (a deploy
    // that lands before migration 0209) — no card has words.
    for (const code of ["42P01", "PGRST205"]) {
      m.admin.mockResolvedValue({ data: null, error: { message: "no such table", code } });
      expect(await readCardWordsAdmin(ME, DECK, ENTRY)).toEqual({ ok: true, words: null });
    }
  });

  it("are saved clean under the owner; empty words remove the row", async () => {
    m.admin.mockResolvedValue({ error: null });
    expect(await saveCardWords(ME, DECK, ENTRY, { text: "  a   lighthouse\n in a storm ", only: true })).toBe(true);
    const [write] = m.admin.mock.calls.map(([call]) => call as Call);
    expect(write).toMatchObject({ table: "deck_reart_prompts", op: "upsert" });
    // Spaces folded; the maker's own line break kept.
    expect(write.row).toEqual({ deck_id: DECK, entry_id: ENTRY, owner_id: ME, prompt: "a lighthouse\nin a storm", only_words: true });
    m.admin.mockClear();
    for (const none of [null, { text: "   ", only: true }]) await saveCardWords(ME, DECK, ENTRY, none);
    for (const [call] of m.admin.mock.calls) {
      expect(call).toMatchObject({ table: "deck_reart_prompts", op: "delete" });
      expect((call as Call).filters).toEqual([
        ["deck_id", DECK],
        ["entry_id", ENTRY],
        ["owner_id", ME],
      ]);
    }
    expect(m.admin).toHaveBeenCalledTimes(2);
  });

  it("a failed write is false, and nothing is written without the service role", async () => {
    m.admin.mockResolvedValue({ error: { message: "deck_reart_prompt_not_owner" } });
    expect(await saveCardWords(ME, DECK, ENTRY, { text: "a lighthouse", only: false })).toBe(false);
    m.adminConfigured.mockReturnValue(false);
    m.admin.mockClear();
    expect(await saveCardWords(ME, DECK, ENTRY, { text: "a lighthouse", only: false })).toBe(false);
    expect(m.admin).not.toHaveBeenCalled();
  });
});

describe("who painted a card (0211 deck_reart_cards.image_model)", () => {
  const stored = (over: Record<string, unknown> = {}) => ({
    card_id: CARD,
    entry_id: ENTRY,
    style_version: 3,
    art_url: ART("ai-new.jpg"),
    back_art_url: null,
    made: false,
    previous_art_url: ART("mine.png"),
    previous_art_position: null,
    previous_back_art_url: null,
    previous_back_art_position: null,
    previous_artist_credit: null,
    previous_back_artist_credit: null,
    painted_at: "2026-11-13T00:00:00Z",
    job_id: "job-1",
    ...over,
  });
  const painted: Omit<PaintedCard, "paintedAt" | "jobId"> = {
    cardId: CARD,
    entryId: ENTRY,
    styleVersion: 3,
    artUrl: ART("ai-new.jpg"),
    backArtUrl: null,
    made: false,
    previousArtUrl: ART("mine.png"),
    previousArtPosition: null,
    previousBackArtUrl: null,
    previousBackArtPosition: null,
    previousArtistCredit: "Jane Painter",
    previousBackArtistCredit: null,
    imageModel: "spacexai/grok-imagine-image",
  };
  const upserts = () => m.admin.mock.calls.map(([call]) => call as Call).filter((call) => call.op === "upsert");
  const NO_COLUMN = { message: "column deck_reart_cards.image_model does not exist", code: "42703" };

  it("is read with the row, by every reader; a row painted before 0211 names none", async () => {
    m.query.mockResolvedValue({ data: [stored({ image_model: "bfl/flux-2-pro" })], error: null });
    expect((await readPaintedCards(DECK)).get(CARD)).toMatchObject({ imageModel: "bfl/flux-2-pro", jobId: "job-1" });
    expect((m.query.mock.calls[0][0] as Call).columns).toMatch(/, image_model$/);

    m.admin.mockResolvedValue({ data: { ...stored({ image_model: null }), owner_id: ME }, error: null });
    expect(await readPaintedCardAdmin(ME, DECK, CARD)).toMatchObject({ cardId: CARD, imageModel: null });
    expect((m.admin.mock.calls[0][0] as Call).columns).toMatch(/, image_model, owner_id$/);

    m.admin.mockResolvedValue({ data: [stored({ image_model: "bfl/flux-2-flex + bfl/flux-2-pro" })], error: null });
    expect(await readPaintedRowsForCardAdmin(ME, CARD)).toMatchObject([{ imageModel: "bfl/flux-2-flex + bfl/flux-2-pro" }]);
  });

  it("a database 0211 hasn't reached is read again without the column — never as “nothing painted”", async () => {
    // The owner's session (the studio's page): every card read as never
    // painted would be offered for painting again, and charged.
    m.query.mockResolvedValueOnce({ data: null, error: NO_COLUMN }).mockResolvedValueOnce({ data: [stored()], error: null });
    const cards = await readPaintedCards(DECK);
    expect(cards.get(CARD)).toMatchObject({ artUrl: ART("ai-new.jpg"), imageModel: null });
    const columns = m.query.mock.calls.map(([call]) => (call as Call).columns ?? "");
    expect(columns[0]).toContain("image_model");
    expect(columns[1]).not.toContain("image_model");
    expect(columns[1]).toContain("job_id");

    // The step's reads (the service role) fall back the same way, and the
    // one-row read still holds the row to its owner.
    m.admin.mockResolvedValueOnce({ data: null, error: NO_COLUMN }).mockResolvedValueOnce({ data: { ...stored(), owner_id: ME }, error: null });
    expect(await readPaintedCardAdmin(ME, DECK, CARD)).toMatchObject({ cardId: CARD, imageModel: null });
    m.admin.mockResolvedValueOnce({ data: null, error: NO_COLUMN }).mockResolvedValueOnce({ data: { ...stored(), owner_id: "someone" }, error: null });
    expect(await readPaintedCardAdmin(ME, DECK, CARD)).toBeNull();
    m.admin.mockResolvedValueOnce({ data: null, error: NO_COLUMN }).mockResolvedValueOnce({ data: [stored()], error: null });
    expect(await readPaintedRowsForCardAdmin(ME, CARD)).toHaveLength(1);
  });

  it("any other failed read is not read twice", async () => {
    m.query.mockResolvedValue({ data: null, error: { message: "boom", code: "57014" } });
    expect((await readPaintedCards(DECK)).size).toBe(0);
    expect(m.query).toHaveBeenCalledTimes(1);
  });

  it("is written with the row, under the owner", async () => {
    m.admin.mockResolvedValue({ error: null });
    expect(await writePaintedCard(ME, DECK, "job-1", painted)).toBe(true);
    expect(upserts()).toHaveLength(1);
    expect(upserts()[0].row).toMatchObject({
      deck_id: DECK,
      card_id: CARD,
      owner_id: ME,
      job_id: "job-1",
      art_url: ART("ai-new.jpg"),
      image_model: "spacexai/grok-imagine-image",
    });
  });

  it("is held to the column's limit, and an empty name is none (the CHECK takes 1 to 200 characters)", async () => {
    m.admin.mockResolvedValue({ error: null });
    await writePaintedCard(ME, DECK, "job-1", { ...painted, imageModel: `vendor/${"x".repeat(400)}` });
    await writePaintedCard(ME, DECK, "job-1", { ...painted, imageModel: "   " });
    await writePaintedCard(ME, DECK, "job-1", { ...painted, imageModel: null });
    const [long, blank, none] = upserts().map((call) => (call.row as { image_model: string | null }).image_model);
    expect(long).toHaveLength(200);
    expect(blank).toBeNull();
    expect(none).toBeNull();
  });

  it("a database 0211 hasn't reached still records the paint — it holds the art to put back", async () => {
    for (const code of ["PGRST204", "42703"]) {
      m.admin.mockReset();
      m.admin.mockResolvedValueOnce({ error: { message: "Could not find the 'image_model' column", code } }).mockResolvedValueOnce({ error: null });
      expect(await writePaintedCard(ME, DECK, "job-1", painted)).toBe(true);
      const [first, second] = upserts().map((call) => call.row as Record<string, unknown>);
      expect(first).toHaveProperty("image_model", "spacexai/grok-imagine-image");
      expect(second).not.toHaveProperty("image_model");
      // The same row otherwise: the art to put back is in it.
      expect(second).toMatchObject({ card_id: CARD, previous_art_url: ART("mine.png"), previous_artist_credit: "Jane Painter" });
    }
  });

  it("any other refused write is false, and is not tried again", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    m.admin.mockResolvedValue({ error: { message: "boom", code: "23514" } });
    expect(await writePaintedCard(ME, DECK, "job-1", painted)).toBe(false);
    expect(upserts()).toHaveLength(1);
    m.adminConfigured.mockReturnValue(false);
    m.admin.mockReset();
    expect(await writePaintedCard(ME, DECK, "job-1", painted)).toBe(false);
    expect(m.admin).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
