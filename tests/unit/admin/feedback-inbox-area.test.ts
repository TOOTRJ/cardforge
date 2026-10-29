import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chainClient, called, type ChainAnswer, type ChainCall } from "@/tests/stubs/supabase-chain";

// ---------------------------------------------------------------------------
// The admin feedback inbox's Area filter (migration 0146, TODO DK10.1): one
// area narrows the read to it, none reads every area (/feedback's rows
// included); a deck row carries its deck's slug + title for the link, read
// in one go, and a failed deck read is flagged like a failed sender read.
// ---------------------------------------------------------------------------

const state = vi.hoisted(() => ({
  resolve: null as null | ((table: string, calls: ChainCall[]) => ChainAnswer),
  stub: null as null | ReturnType<typeof import("@/tests/stubs/supabase-chain").chainClient>,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  getCurrentProfile: async () => ({ id: "admin", is_admin: true }),
  getCurrentUser: async () => ({ id: "admin" }),
  createClient: async () => {
    throw new Error("not in this test");
  },
}));
vi.mock("@/lib/supabase/admin", () => ({
  isAdminConfigured: () => true,
  createAdminClient: () => state.stub!.client,
}));

import { listAllFeedback } from "@/lib/feedback/queries";

const ROWS = [
  { id: "f1", category: "feature", subject: "Sort by colour", message: "Sort by colour", frame_template: null, page_url: "/deck/ness", area: "decks", deck_id: "d1", viewport: "390x844", status: "new", created_at: "2026-10-29T10:00:00Z", user_id: "u1" },
  { id: "f2", category: "bug", subject: "Old page", message: "Old", frame_template: null, page_url: null, area: null, deck_id: null, viewport: null, status: "new", created_at: "2026-10-28T10:00:00Z", user_id: "u1" },
];

let log: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  log = vi.spyOn(console, "error").mockImplementation(() => {});
  state.resolve = (table) =>
    table === "feedback"
      ? { data: ROWS }
      : table === "decks"
        ? {
            data: [
              { id: "d1", slug: "ness", title: "Ness", visibility: "public" },
              { id: "d2", slug: "wip", title: "WIP", visibility: "private" },
            ],
          }
        : { data: [{ id: "u1", username: "dev_free", display_name: null }] };
  state.stub = chainClient((table, calls) => state.resolve!(table, calls));
});
afterEach(() => log.mockRestore());

const feedbackRead = () => state.stub!.forTable("feedback")[0].calls;

describe("listAllFeedback's area", () => {
  it("narrows the read to one area", async () => {
    await listAllFeedback("all", "decks");
    expect(called(feedbackRead(), "eq", "area")).toBe(true);
    expect(feedbackRead().find((c) => c.method === "eq" && c.args[0] === "area")?.args).toEqual(["area", "decks"]);
  });

  it("reads every area when none is asked for", async () => {
    await listAllFeedback("all");
    expect(called(feedbackRead(), "eq", "area")).toBe(false);
  });

  it("carries the area badge, the deck link and the window size", async () => {
    const inbox = await listAllFeedback("all");
    expect(inbox?.loadError).toBe(false);
    expect(inbox?.items[0]).toMatchObject({
      area: "decks",
      deck: { id: "d1", slug: "ness", title: "Ness", isPrivate: false },
      viewport: "390x844",
      pageUrl: "/deck/ness",
    });
    expect(inbox?.items[1]).toMatchObject({ area: null, deck: null, viewport: null });
    // One deck read for the whole page, only for the decks named.
    const deckReads = state.stub!.forTable("decks");
    expect(deckReads).toHaveLength(1);
    expect(deckReads[0].calls.find((c) => c.method === "in")?.args).toEqual(["id", ["d1"]]);
  });

  it("names a private deck but marks it (its page opens for its owner only)", async () => {
    const base = state.resolve!;
    state.resolve = (table, calls) =>
      table === "feedback" ? { data: [{ ...ROWS[0], deck_id: "d2" }] } : base(table, calls);
    const inbox = await listAllFeedback("all", "decks");
    expect(inbox?.items[0].deck).toEqual({ id: "d2", slug: "wip", title: "WIP", isPrivate: true });
  });

  it("flags a failed deck read (every deck link would be missing)", async () => {
    const base = state.resolve!;
    state.resolve = (table, calls) =>
      table === "decks" ? { data: null, error: { message: "boom" } } : base(table, calls);
    const inbox = await listAllFeedback("all");
    expect(inbox?.loadError).toBe(true);
    expect(inbox?.items[0].deck).toBeNull();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("deck read failed"), "boom");
  });

  describe("on a database 0146 has not reached (the deploy before the migration, the dev DB)", () => {
    const selectsArea = (calls: ChainCall[]) =>
      calls.some((c) => c.method === "select" && String(c.args[0]).includes("area"));
    // The rows as a pre-0146 database holds them: no area, deck_id or viewport.
    const LEGACY = ROWS.map((r) =>
      Object.fromEntries(Object.entries(r).filter(([key]) => !["area", "deck_id", "viewport"].includes(key))),
    );

    for (const code of ["42703", "PGRST204"]) {
      it(`${code}: reads the rows without the new columns — never the load error`, async () => {
        const base = state.resolve!;
        state.resolve = (table, calls) =>
          table === "feedback"
            ? selectsArea(calls)
              ? { data: null, error: { code, message: "column feedback.area does not exist" } }
              : { data: LEGACY }
            : base(table, calls);
        const inbox = await listAllFeedback("unresolved");
        expect(inbox?.loadError).toBe(false);
        expect(inbox?.items).toHaveLength(2);
        expect(inbox?.items.map((i) => [i.area, i.deck, i.viewport])).toEqual([
          [null, null, null],
          [null, null, null],
        ]);
        // The retry keeps the status filter and asks for no deck.
        const reads = state.stub!.forTable("feedback");
        expect(reads).toHaveLength(2);
        expect(called(reads[1].calls, "in", "status")).toBe(true);
        expect(state.stub!.forTable("decks")).toHaveLength(0);
        expect(log).not.toHaveBeenCalled();
      });
    }

    it("one area there is an honest empty inbox (no row has an area yet)", async () => {
      state.resolve = (table) =>
        table === "feedback" ? { data: null, error: { code: "42703", message: "column feedback.area does not exist" } } : { data: [] };
      expect(await listAllFeedback("all", "decks")).toEqual({ items: [], loadError: false });
      expect(state.stub!.forTable("feedback")).toHaveLength(1);
    });

    it("any other error is still the load error", async () => {
      state.resolve = (table) =>
        table === "feedback" ? { data: null, error: { code: "42703", message: "column feedback.subjectx does not exist" } } : { data: [] };
      expect(await listAllFeedback("all")).toEqual({ items: [], loadError: true });
      state.stub = chainClient((table, calls) => state.resolve!(table, calls));
      state.resolve = (table) =>
        table === "feedback" ? { data: null, error: { code: "57014", message: "timeout on area" } } : { data: [] };
      expect(await listAllFeedback("all")).toEqual({ items: [], loadError: true });
    });
  });

  it("an unknown stored area reads as none", async () => {
    state.resolve = (table) =>
      table === "feedback" ? { data: [{ ...ROWS[1], area: "retired" }] } : { data: [] };
    const inbox = await listAllFeedback("all");
    expect(inbox?.items[0].area).toBeNull();
  });
});
