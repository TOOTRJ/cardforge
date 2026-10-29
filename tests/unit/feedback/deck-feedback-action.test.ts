import { beforeEach, describe, expect, it, vi } from "vitest";
import { chainClient, called, payloadOf, type ChainAnswer, type ChainCall } from "@/tests/stubs/supabase-chain";

// ---------------------------------------------------------------------------
// submitDeckFeedbackAction (TODO DK10.1): the dialog's Idea / Bug / Other +
// message lands in `feedback` under area "decks" with the deck, the path and
// the window size — through the same hourly cap and RLS-bound insert as
// /feedback. A deck the sender can't read is dropped, never refused.
// ---------------------------------------------------------------------------

const state = vi.hoisted(() => ({
  user: { id: "u1" } as { id: string } | null,
  resolve: null as null | ((table: string, calls: ChainCall[]) => ChainAnswer),
  stub: null as null | ReturnType<typeof import("@/tests/stubs/supabase-chain").chainClient>,
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  getCurrentUser: async () => state.user,
  getCurrentProfile: async () => null,
  createClient: async () => state.stub!.client,
}));
vi.mock("@/lib/supabase/admin", () => ({
  isAdminConfigured: () => false,
  createAdminClient: () => {
    throw new Error("not in this test");
  },
}));

import { submitDeckFeedbackAction, submitFeedbackAction } from "@/lib/feedback/actions";

const DECK = "b0000000-0000-4000-a000-000000000001";
const input = {
  kind: "bug",
  message: "The steppers jump\nwhen I click fast.",
  deck_id: DECK,
  page_url: "/deck/cinderwing-dragonstorm",
  viewport: "390x844",
};

beforeEach(() => {
  state.user = { id: "u1" };
  state.resolve = (table, calls) =>
    table === "decks"
      ? { data: { id: DECK } }
      : called(calls, "select")
        ? { count: 0 }
        : { data: null };
  state.stub = chainClient((table, calls) => state.resolve!(table, calls));
});

const insertOf = () =>
  payloadOf(state.stub!.forTable("feedback").find((e) => called(e.calls, "insert"))?.calls ?? [], "insert");

describe("submitDeckFeedbackAction", () => {
  it("files the row under area decks with the deck, the path and the window size", async () => {
    expect(await submitDeckFeedbackAction(input)).toEqual({ ok: true });
    expect(insertOf()).toEqual({
      user_id: "u1",
      category: "bug",
      subject: "The steppers jump",
      message: "The steppers jump\nwhen I click fast.",
      area: "decks",
      deck_id: DECK,
      page_url: "/deck/cinderwing-dragonstorm",
      viewport: "390x844",
    });
    // The deck was read through the sender's own (RLS-bound) client.
    const deckRead = state.stub!.forTable("decks")[0];
    expect(called(deckRead.calls, "eq", "id")).toBe(true);
  });

  it("an Idea files as a feature request", async () => {
    await submitDeckFeedbackAction({ ...input, kind: "idea" });
    expect(insertOf()).toMatchObject({ category: "feature", area: "decks" });
  });

  it("drops a deck the sender can't read, and still files the feedback", async () => {
    state.resolve = (table, calls) =>
      table === "decks" ? { data: null } : called(calls, "select") ? { count: 0 } : { data: null };
    expect(await submitDeckFeedbackAction(input)).toEqual({ ok: true });
    expect(insertOf()).toMatchObject({ area: "decks", deck_id: null });
  });

  it("My Decks sends no deck: no deck read, deck_id null", async () => {
    await submitDeckFeedbackAction({ ...input, deck_id: "", page_url: "/dashboard/decks" });
    expect(state.stub!.forTable("decks")).toHaveLength(0);
    expect(insertOf()).toMatchObject({ deck_id: null, page_url: "/dashboard/decks" });
  });

  it("refuses a signed-out caller, a query string and an empty message before any write", async () => {
    state.user = null;
    expect(await submitDeckFeedbackAction(input)).toEqual({ ok: false, error: "Sign in to send feedback." });
    state.user = { id: "u1" };
    expect((await submitDeckFeedbackAction({ ...input, page_url: "/deck/x?q=me" })).ok).toBe(false);
    expect((await submitDeckFeedbackAction({ ...input, message: " " })).ok).toBe(false);
    expect(insertOf()).toBeUndefined();
  });

  it("shares /feedback's hourly cap", async () => {
    state.resolve = (table, calls) =>
      table === "decks" ? { data: { id: DECK } } : called(calls, "select") ? { count: 5 } : { data: null };
    const result = await submitDeckFeedbackAction(input);
    expect(result.ok).toBe(false);
    expect(insertOf()).toBeUndefined();
  });

  it("says so when the insert fails", async () => {
    state.resolve = (table, calls) =>
      table === "decks"
        ? { data: { id: DECK } }
        : called(calls, "insert")
          ? { error: { message: "boom" } }
          : { count: 0 };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await submitDeckFeedbackAction(input)).toEqual({
      ok: false,
      error: "Couldn't save your feedback. Try again.",
    });
    warn.mockRestore();
  });

  it("on a database 0146 has not reached, the send fails with the same friendly error", async () => {
    state.resolve = (table, calls) =>
      table === "decks"
        ? { data: { id: DECK } }
        : called(calls, "insert")
          ? { error: { code: "PGRST204", message: "Could not find the 'area' column of 'feedback' in the schema cache" } }
          : { count: 0 };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await submitDeckFeedbackAction(input)).toEqual({
      ok: false,
      error: "Couldn't save your feedback. Try again.",
    });
    warn.mockRestore();
  });

  it("a long first line of emoji still saves: the subject is well formed", async () => {
    await submitDeckFeedbackAction({ ...input, message: "😀".repeat(100) });
    const subject = (insertOf() as { subject: string }).subject;
    expect(subject.isWellFormed()).toBe(true);
    expect(subject).toBe(`${"😀".repeat(39)}…`);
  });
});

describe("submitFeedbackAction (the /feedback page) is unchanged", () => {
  it("files no area, deck or viewport", async () => {
    await submitFeedbackAction({ category: "bug", subject: "S", message: "M", page_url: "/create" });
    expect(insertOf()).toEqual({
      user_id: "u1",
      category: "bug",
      subject: "S",
      message: "M",
      frame_template: null,
      page_url: "/create",
    });
  });
});
