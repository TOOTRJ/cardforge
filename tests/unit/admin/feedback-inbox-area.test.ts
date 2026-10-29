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

  it("carries the area badge, the deck link and the screen size", async () => {
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

  it("an unknown stored area reads as none", async () => {
    state.resolve = (table) =>
      table === "feedback" ? { data: [{ ...ROWS[1], area: "retired" }] } : { data: [] };
    const inbox = await listAllFeedback("all");
    expect(inbox?.items[0].area).toBeNull();
  });
});
