import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Re-art deck — a card's EARLIER PICTURES (migration 0215,
// lib/tools/re-art/rolls.ts and the rules in model.ts). A re-roll and "Put
// the old art back" keep the picture they take off a card; the maker can go
// back to one.
//
//   * WHAT is offered: the kept pictures, and the deck's own last picture
//     while the card shows other art — never the picture the card shows,
//     never one twice.
//   * A picture is kept ONCE per deck and card, with the owner named in
//     every statement; keeping never prunes.
//   * A pick CLAIMS its row (delete … returning): one caller holds it.
//   * Past the limit the OLDEST go — their rows first, and only the rows
//     this call took out have their pictures handed to the guarded discard.
//   * A database the migration hasn't reached keeps nothing and lists
//     nothing: never an error a paint could fail on.
// ---------------------------------------------------------------------------

type Call = {
  table: string;
  op: "select" | "insert" | "delete";
  columns?: string;
  row?: unknown;
  filters: Array<[string, unknown]>;
  orders: string[];
};
type Result = { data?: unknown; error?: { message: string; code?: string } | null };

const m = vi.hoisted(() => ({
  session: vi.fn(),
  admin: vi.fn(),
  adminConfigured: vi.fn(),
  discardUnused: vi.fn(),
}));

function clientOf(answerOf: (call: Call) => Promise<Result>) {
  return {
    from: (table: string) => {
      const call: Call = { table, op: "select", filters: [], orders: [] };
      const answer = () => answerOf(call);
      const chain = {
        // After an insert or a delete, `select` only says what comes back.
        select: (columns: string) => {
          call.columns = columns;
          return chain;
        },
        insert: (row: unknown) => {
          call.op = "insert";
          call.row = row;
          return chain;
        },
        delete: () => {
          call.op = "delete";
          return chain;
        },
        eq: (column: string, value: unknown) => {
          call.filters.push([column, value]);
          return chain;
        },
        in: (column: string, value: unknown) => {
          call.filters.push([column, value]);
          return chain;
        },
        order: (column: string, options?: { ascending?: boolean }) => {
          call.orders.push(`${column} ${options?.ascending === false ? "desc" : "asc"}`);
          return chain;
        },
        maybeSingle: answer,
        then: (resolve: (value: Result) => unknown, reject?: (reason: unknown) => unknown) => answer().then(resolve, reject),
      };
      return chain;
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => clientOf(async (call) => m.session(call)) }));
vi.mock("@/lib/supabase/admin", () => ({
  isAdminConfigured: () => m.adminConfigured(),
  createAdminClient: () => clientOf(async (call) => m.admin(call)),
}));
vi.mock("@/lib/tools/re-art/server", () => ({ discardReartArtIfUnused: m.discardUnused }));

import { claimRoll, dropRoll, keepRoll, pruneRolls, readRolls } from "@/lib/tools/re-art/rolls";
import {
  REART_ROLLS_KEPT,
  REART_ROLLS_KEPT_COPY,
  REART_ROW_PICTURE,
  reartEarlierPictures,
  reartPreviousArt,
  type ReartRoll,
} from "@/lib/tools/re-art/model";

const ME = "u1";
const DECK = "00000000-0000-4000-8000-0000000000d1";
const CARD = "00000000-0000-4000-8000-0000000000c1";
const ART = (n: string) => `https://x.supabase.co/storage/v1/object/public/card-art/u1/${n}`;
const adminCalls = () => m.admin.mock.calls.map(([call]) => call as Call);

const roll = (n: number, over: Partial<ReartRoll> = {}): ReartRoll => ({
  id: `roll-${n}`,
  cardId: CARD,
  styleVersion: 3,
  jobId: `job-${n}`,
  artUrl: ART(`ai-${n}.jpg`),
  artPosition: { focalX: 0.5, focalY: 0.4, scale: 1.2 },
  artistCredit: "dev_pro",
  backArtUrl: null,
  backArtPosition: null,
  backArtistCredit: null,
  imageModel: "bfl/flux-2-pro",
  method: "paint",
  paintedAt: `2026-11-1${n}T10:00:00Z`,
  ...over,
});
const stored = (r: ReartRoll) => ({
  id: r.id,
  card_id: r.cardId,
  style_version: r.styleVersion,
  job_id: r.jobId,
  art_url: r.artUrl,
  art_position: r.artPosition,
  artist_credit: r.artistCredit,
  back_art_url: r.backArtUrl,
  back_art_position: r.backArtPosition,
  back_artist_credit: r.backArtistCredit,
  image_model: r.imageModel,
  method: r.method,
  painted_at: r.paintedAt,
});

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset();
  m.adminConfigured.mockReturnValue(true);
});

describe("how many are kept", () => {
  it("three for each card on each deck — and the studio says so", () => {
    expect(REART_ROLLS_KEPT).toBe(3);
    expect(REART_ROLLS_KEPT_COPY).toBe("Up to 3 earlier pictures are kept for each card. When another is kept, the oldest goes.");
  });
});

describe("what “Earlier pictures” offers", () => {
  const painted = { artUrl: ART("ai-9.jpg"), backArtUrl: null, styleVersion: 3, imageModel: "google/gemini-2.5-flash-image", method: "restyle" as const, paintedAt: "2026-11-19T10:00:00Z" };
  const offer = (over: Partial<Parameters<typeof reartEarlierPictures>[0]> = {}) =>
    reartEarlierPictures({ painted, rolls: [roll(1), roll(2)], cardArtUrl: ART("ai-9.jpg"), styleVersion: 3, namesModel: true, ...over });

  it("the kept pictures, newest first — never the picture the card shows", () => {
    expect(offer().map((picture) => picture.id)).toEqual(["roll-2", "roll-1"]);
    // Whatever order they were read in.
    expect(offer({ rolls: [roll(1), roll(3), roll(2)] }).map((picture) => picture.id)).toEqual(["roll-3", "roll-2", "roll-1"]);
    // A kept copy of the picture on the card (a write that stopped half-way) is not offered.
    expect(offer({ rolls: [roll(1), roll(2, { artUrl: ART("ai-9.jpg") })] }).map((picture) => picture.id)).toEqual(["roll-1"]);
  });

  it("the deck's own last picture too, FIRST, while the card shows other art — the way back to “in this style”", () => {
    const list = offer({ cardArtUrl: ART("hand.png") });
    expect(list.map((picture) => picture.id)).toEqual([REART_ROW_PICTURE, "roll-2", "roll-1"]);
    expect(list[0]).toEqual({
      id: REART_ROW_PICTURE,
      artUrl: ART("ai-9.jpg"),
      backArtUrl: null,
      paintedBy: "Gemini 2.5 Flash Image",
      restyled: true,
      earlierStyle: false,
      paintedAt: "2026-11-19T10:00:00Z",
    });
    // Never twice: a kept copy of the row's own picture is the row's.
    expect(offer({ cardArtUrl: ART("hand.png"), rolls: [roll(1, { artUrl: ART("ai-9.jpg") })] }).map((picture) => picture.id)).toEqual([REART_ROW_PICTURE]);
  });

  it("a card with no row, or a row that names no picture (its own art was put back), offers the kept ones alone", () => {
    expect(offer({ painted: null, cardArtUrl: ART("mine.png") }).map((picture) => picture.id)).toEqual(["roll-2", "roll-1"]);
    expect(offer({ painted: { ...painted, artUrl: null }, cardArtUrl: ART("mine.png") }).map((picture) => picture.id)).toEqual(["roll-2", "roll-1"]);
    expect(offer({ painted: null, rolls: [], cardArtUrl: null })).toEqual([]);
  });

  it("says which are of an earlier style — every one when no style is saved", () => {
    const list = offer({ rolls: [roll(1, { styleVersion: 2 }), roll(2)] });
    expect(list.map((picture) => [picture.id, picture.earlierStyle])).toEqual([
      ["roll-2", false],
      ["roll-1", true],
    ]);
    expect(offer({ styleVersion: null }).every((picture) => picture.earlierStyle)).toBe(true);
  });

  it("names who painted a picture, and how, only to those who can name a model", () => {
    expect(offer()[0]).toMatchObject({ paintedBy: "FLUX.2 [pro]", restyled: false });
    expect(offer({ rolls: [roll(1, { method: "restyle" })] })[0]).toMatchObject({ restyled: true });
    for (const picture of offer({ namesModel: false, rolls: [roll(1, { method: "restyle" })] })) {
      expect(picture.paintedBy).toBeNull();
      expect(picture.restyled).toBe(false);
    }
  });
});

describe("the art “Put the old art back” goes back to, when a picture of Re-art's goes on a card", () => {
  const card = { artUrl: ART("mine.png"), artPosition: { focalX: 0.2 }, artistCredit: "Jane Painter" };
  const back = { artUrl: ART("back.png"), artPosition: { focalX: 0.8 }, artistCredit: "Jo" };
  const source = {
    made: false,
    previousArtUrl: ART("first.png"),
    previousArtPosition: { focalX: 0.5 },
    previousBackArtUrl: ART("first-back.png"),
    previousBackArtPosition: null,
    previousArtistCredit: "Then",
    previousBackArtistCredit: null,
  };

  it("the card shows the maker's own art: that art, with its fit and credit — the back's only on a two-faced card", () => {
    expect(reartPreviousArt({ card, back: null, source: undefined })).toEqual({
      made: false,
      previousArtUrl: ART("mine.png"),
      previousArtPosition: { focalX: 0.2 },
      previousBackArtUrl: null,
      previousBackArtPosition: null,
      previousArtistCredit: "Jane Painter",
      previousBackArtistCredit: null,
    });
    expect(reartPreviousArt({ card, back, source: null })).toMatchObject({
      previousBackArtUrl: ART("back.png"),
      previousBackArtPosition: { focalX: 0.8 },
      previousBackArtistCredit: "Jo",
    });
  });

  it("the card shows a picture Re-art painted (from any deck): THAT row's art to put back — never the AI picture, never lost", () => {
    const shown = { artUrl: ART("ai-1.jpg"), artPosition: null, artistCredit: "AI" };
    expect(reartPreviousArt({ card: shown, back, source })).toEqual(source);
    // A card Re-art MADE has no art to put back, and stays "made".
    expect(reartPreviousArt({ card: shown, back: null, source: { ...source, made: true, previousArtUrl: null } })).toMatchObject({
      made: true,
      previousArtUrl: null,
    });
  });
});

describe("reading the deck's kept pictures", () => {
  it("is the owner's own session, by deck, newest first, grouped by card", async () => {
    m.session.mockResolvedValue({ data: [stored(roll(2)), stored(roll(1)), stored(roll(3, { cardId: "card-2" }))], error: null });
    const byCard = await readRolls(DECK);
    const [call] = m.session.mock.calls.map(([c]) => c as Call);
    expect(call).toMatchObject({ table: "deck_reart_rolls", op: "select", filters: [["deck_id", DECK]], orders: ["painted_at desc"] });
    expect(m.admin).not.toHaveBeenCalled();
    expect([...byCard.keys()]).toEqual([CARD, "card-2"]);
    expect(byCard.get(CARD)).toEqual([roll(2), roll(1)]);
  });

  it("a method the model doesn't know reads as none", async () => {
    m.session.mockResolvedValue({ data: [{ ...stored(roll(1)), method: "collage" }], error: null });
    expect((await readRolls(DECK)).get(CARD)?.[0].method).toBeNull();
  });

  it("a read that failed lists none, and says so in the log — except on a database the migration hasn't reached", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    m.session.mockResolvedValue({ data: null, error: { message: "connection reset", code: "08006" } });
    expect((await readRolls(DECK)).size).toBe(0);
    expect(logged).toHaveBeenCalledTimes(1);
    for (const code of ["42P01", "PGRST205"]) {
      m.session.mockResolvedValue({ data: null, error: { message: "no such table", code } });
      expect((await readRolls(DECK)).size).toBe(0);
    }
    expect(logged).toHaveBeenCalledTimes(1);
    logged.mockRestore();
  });
});

describe("keeping a picture", () => {
  const { id: _id, ...toKeep } = roll(1, { backArtUrl: ART("ai-1-back.jpg"), backArtistCredit: "dev_pro" });
  void _id;

  it("writes one row under the owner, with everything a pick needs — and never prunes", async () => {
    m.admin.mockResolvedValue({ data: { id: "new-roll" }, error: null });
    expect(await keepRoll(ME, DECK, toKeep)).toEqual({ id: "new-roll", inserted: true });
    expect(adminCalls()).toHaveLength(1);
    expect(adminCalls()[0]).toMatchObject({ table: "deck_reart_rolls", op: "insert" });
    expect(adminCalls()[0].row).toEqual({
      deck_id: DECK,
      card_id: CARD,
      owner_id: ME,
      style_version: 3,
      job_id: "job-1",
      art_url: ART("ai-1.jpg"),
      art_position: { focalX: 0.5, focalY: 0.4, scale: 1.2 },
      artist_credit: "dev_pro",
      back_art_url: ART("ai-1-back.jpg"),
      back_art_position: null,
      back_artist_credit: "dev_pro",
      image_model: "bfl/flux-2-pro",
      method: "paint",
      painted_at: "2026-11-11T10:00:00Z",
    });
    expect(m.discardUnused).not.toHaveBeenCalled();
  });

  it("holds the credit and the model to the columns' limits, and an empty text is none", async () => {
    m.admin.mockResolvedValue({ data: { id: "new-roll" }, error: null });
    await keepRoll(ME, DECK, { ...toKeep, artistCredit: "x".repeat(400), imageModel: "  ", backArtistCredit: "" });
    expect(adminCalls()[0].row).toMatchObject({ artist_credit: "x".repeat(200), image_model: null, back_artist_credit: null });
  });

  it("the same picture kept twice is kept once: the row there is handed back, as NOT put in by this call", async () => {
    m.admin
      .mockResolvedValueOnce({ data: null, error: { message: "duplicate key", code: "23505" } })
      .mockResolvedValueOnce({ data: { id: "roll-there" }, error: null });
    expect(await keepRoll(ME, DECK, toKeep)).toEqual({ id: "roll-there", inserted: false });
    const [, lookup] = adminCalls();
    expect(lookup.filters).toEqual([
      ["deck_id", DECK],
      ["card_id", CARD],
      ["owner_id", ME],
      ["art_url", ART("ai-1.jpg")],
    ]);
  });

  it("a write that failed — or the table not being there yet — keeps nothing, and never throws", async () => {
    const warned = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    m.admin.mockResolvedValue({ data: null, error: { message: "boom", code: "XX000" } });
    expect(await keepRoll(ME, DECK, toKeep)).toBeNull();
    expect(warned).toHaveBeenCalledTimes(1);
    m.admin.mockResolvedValue({ data: null, error: { message: "no such table", code: "42P01" } });
    expect(await keepRoll(ME, DECK, toKeep)).toBeNull();
    expect(warned).toHaveBeenCalledTimes(1);
    warned.mockRestore();
  });

  it("nothing is written without the service role, or for a picture with no address", async () => {
    expect(await keepRoll(ME, DECK, { ...toKeep, artUrl: "" })).toBeNull();
    m.adminConfigured.mockReturnValue(false);
    expect(await keepRoll(ME, DECK, toKeep)).toBeNull();
    expect(m.admin).not.toHaveBeenCalled();
  });
});

describe("claiming a kept picture (a pick)", () => {
  it("takes the row out and hands it back in ONE statement, held to the deck, the card and the owner", async () => {
    m.admin.mockResolvedValue({ data: stored(roll(1)), error: null });
    expect(await claimRoll(ME, DECK, CARD, "roll-1")).toEqual(roll(1));
    expect(adminCalls()).toHaveLength(1);
    expect(adminCalls()[0]).toMatchObject({ table: "deck_reart_rolls", op: "delete" });
    expect(adminCalls()[0].filters).toEqual([
      ["id", "roll-1"],
      ["deck_id", DECK],
      ["card_id", CARD],
      ["owner_id", ME],
    ]);
    // What comes back is the whole row (a refused edit keeps it again).
    expect(adminCalls()[0].columns).toContain("art_position");
  });

  it("a row that is gone (another tab picked it, a prune dropped it), a failed read, no service role: nothing is claimed", async () => {
    m.admin.mockResolvedValue({ data: null, error: null });
    expect(await claimRoll(ME, DECK, CARD, "roll-1")).toBeNull();
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    m.admin.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect(await claimRoll(ME, DECK, CARD, "roll-1")).toBeNull();
    logged.mockRestore();
    m.adminConfigured.mockReturnValue(false);
    m.admin.mockReset();
    expect(await claimRoll(ME, DECK, CARD, "roll-1")).toBeNull();
    expect(m.admin).not.toHaveBeenCalled();
  });
});

describe("taking a kept row back out (a paint that never landed)", () => {
  it("removes the row under the owner and touches no picture", async () => {
    m.admin.mockResolvedValue({ error: null });
    await dropRoll(ME, "roll-1");
    expect(adminCalls()[0]).toMatchObject({ op: "delete", filters: [["id", "roll-1"], ["owner_id", ME]] });
    expect(m.discardUnused).not.toHaveBeenCalled();
  });
});

describe("past the limit the oldest kept pictures go", () => {
  /** Five kept, newest first as the read orders them. */
  const five = [5, 4, 3, 2, 1].map((n) => ({ id: `roll-${n}` }));
  const answer = (dropped: unknown, list: unknown = five) =>
    m.admin.mockImplementation(async (call: Call): Promise<Result> => (call.op === "select" ? { data: list, error: null } : { data: dropped, error: null }));

  it("the rows first, then each picture through the guarded discard — front and back", async () => {
    answer([
      { art_url: ART("ai-2.jpg"), back_art_url: ART("ai-2-back.jpg") },
      { art_url: ART("ai-1.jpg"), back_art_url: null },
    ]);
    expect(await pruneRolls(ME, DECK, CARD)).toBe(2);
    const [list, drop] = adminCalls();
    expect(list).toMatchObject({ op: "select", orders: ["painted_at desc", "kept_at desc"] });
    expect(list.filters).toEqual([
      ["deck_id", DECK],
      ["card_id", CARD],
      ["owner_id", ME],
    ]);
    // Only what is past the newest three, by id, under the owner.
    expect(drop).toMatchObject({ op: "delete" });
    expect(drop.filters).toEqual([
      ["id", ["roll-2", "roll-1"]],
      ["owner_id", ME],
    ]);
    expect(m.discardUnused.mock.calls).toEqual([
      [ME, ART("ai-2.jpg")],
      [ME, ART("ai-2-back.jpg")],
      [ME, ART("ai-1.jpg")],
      [ME, null],
    ]);
  });

  it("only the rows THIS call took out are its to remove (another tab claimed one meanwhile)", async () => {
    answer([{ art_url: ART("ai-1.jpg"), back_art_url: null }]);
    expect(await pruneRolls(ME, DECK, CARD)).toBe(1);
    expect(m.discardUnused.mock.calls.map((call) => call[1])).toEqual([ART("ai-1.jpg"), null]);
  });

  it("at the limit or under it: nothing is removed, and nothing is asked twice", async () => {
    answer([], five.slice(0, REART_ROLLS_KEPT));
    expect(await pruneRolls(ME, DECK, CARD)).toBe(0);
    expect(adminCalls()).toHaveLength(1);
    expect(m.discardUnused).not.toHaveBeenCalled();
  });

  it("a read or a delete that failed removes nothing; nothing throws; no service role does nothing", async () => {
    m.admin.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect(await pruneRolls(ME, DECK, CARD)).toBe(0);
    m.admin.mockImplementation(async (call: Call): Promise<Result> => (call.op === "select" ? { data: five, error: null } : { data: null, error: { message: "boom" } }));
    expect(await pruneRolls(ME, DECK, CARD)).toBe(0);
    const warned = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    m.admin.mockRejectedValue(new Error("offline"));
    expect(await pruneRolls(ME, DECK, CARD)).toBe(0);
    warned.mockRestore();
    m.adminConfigured.mockReturnValue(false);
    m.admin.mockReset();
    expect(await pruneRolls(ME, DECK, CARD)).toBe(0);
    expect(m.admin).not.toHaveBeenCalled();
    expect(m.discardUnused).not.toHaveBeenCalled();
  });
});
