import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// What Bulk Customize records beside its two actions (bulk-customize-
// actions.test.ts) and a failed card (bulk-customize-step.test.ts), for the
// admin's analytics (the 2026-11-10 tools audit):
//   - how ONE RUN of a batch ended (`run_finished`): the browser runs the
//     steps, so the dialog records it, from `bulkRunSummary` — the cards
//     this run made, the credits it really spent, why it stopped;
//   - one real card customized on its own (`customize_one`), where its
//     collection row is handed the new card.
// ---------------------------------------------------------------------------

const m = vi.hoisted(() => ({
  user: vi.fn(),
  row: vi.fn(),
  card: vi.fn(),
  write: vi.fn(),
  event: vi.fn(),
  admin: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ isAdminConfigured: m.admin }));
vi.mock("@/lib/supabase/server", () => ({
  getCurrentUser: m.user,
  createClient: async () => ({
    from: (table: string) => ({
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: table === "cards" ? m.card : m.row }) }) }),
    }),
  }),
}));
vi.mock("@/lib/tools/bulk-customize/server", () => ({ writeCollectionCustomized: m.write }));
vi.mock("@/lib/tools/events", () => ({ recordToolEventLater: m.event }));

import { bulkRunSummary, type BulkRunEnd } from "@/lib/tools/bulk-customize/model";
import { recordCollectionCustomizedAction } from "@/lib/tools/bulk-customize/record-actions";

const ROW = "00000000-0000-4000-8000-000000000001";
const CARD = "00000000-0000-4000-8000-000000000002";

const done = (charged: false | number = false) => ({
  status: "done",
  ...(charged ? { spend_ref: "spend:job:bulk:0:x", ...(charged > 1 ? { credits: charged } : {}) } : { spend_ref: null }),
});
const failed = { status: "failed", refunded: 1 };
const pending = { status: "pending" };
const end = (steps: BulkRunEnd["steps"], over: Partial<BulkRunEnd> = {}): BulkRunEnd => ({
  steps,
  stoppedBy: null,
  error: null,
  paused: false,
  run: 1,
  ...over,
});

describe("bulkRunSummary — what `run_finished` says", () => {
  it("a batch that ran to the end: every card made, nothing spent on the printings' own art", () => {
    expect(bulkRunSummary(end([done(), done(), done()])).props).toEqual({
      total: 3,
      made: 3,
      failed: 0,
      left: 0,
      credits: 0,
      stopped: "none",
      run: 1,
    });
  });

  it("the credits are the charges of the cards MADE — a double-faced card's two, a failed card's none", () => {
    const { props, totals } = bulkRunSummary(end([done(1), done(2), failed, done()]));
    expect(props).toMatchObject({ total: 4, made: 3, failed: 1, left: 0, credits: 3, stopped: "none" });
    expect(totals).toEqual({ made: 3, credits: 3 });
  });

  it("says why a run ended short: the card limit, the credits, a door error, the maker's Stop", () => {
    const steps = [done(1), failed, pending, pending];
    expect(bulkRunSummary(end(steps, { stoppedBy: "CARD_CAPACITY", paused: true })).props).toMatchObject({ stopped: "capacity", left: 2 });
    expect(bulkRunSummary(end(steps, { stoppedBy: "INSUFFICIENT_CREDITS", paused: true })).props.stopped).toBe("credits");
    expect(bulkRunSummary(end(steps, { error: "We couldn't reach PipGlyph.", paused: true })).props.stopped).toBe("error");
    expect(bulkRunSummary(end(steps, { paused: true })).props.stopped).toBe("cancelled");
    // The door error's words never travel: a code only.
    expect(JSON.stringify(bulkRunSummary(end(steps, { error: "We couldn't reach PipGlyph." })).props)).not.toMatch(/PipGlyph/);
  });

  it("a continued batch's second run counts only ITS cards and credits, so the runs add up", () => {
    const first = bulkRunSummary(end([done(1), done(1), pending, pending], { paused: true }));
    expect(first.props).toMatchObject({ made: 2, credits: 2, left: 2, stopped: "cancelled", run: 1 });
    const second = bulkRunSummary(end([done(1), done(1), done(1), failed], { run: 2 }), first.totals);
    expect(second.props).toEqual({ total: 4, made: 1, failed: 1, left: 0, credits: 1, stopped: "none", run: 2 });
    expect(Number(first.props.made) + Number(second.props.made)).toBe(3);
    expect(Number(first.props.credits) + Number(second.props.credits)).toBe(3);
  });

  it("every prop is a count or a code under a snake_case key (the sanitizer keeps all of them)", () => {
    const { props } = bulkRunSummary(end([done(2), failed, pending], { stoppedBy: "CARD_CAPACITY", paused: true }));
    expect(Object.keys(props).length).toBeLessThanOrEqual(10); // + `art` and `surface` in the dialog
    for (const [key, value] of Object.entries(props)) {
      expect(key).toMatch(/^[a-z][a-z0-9_]{0,31}$/);
      expect(["string", "number"]).toContain(typeof value);
    }
  });
});

describe("one real card customized on its own (`customize_one`)", () => {
  beforeEach(() => {
    for (const fn of Object.values(m)) fn.mockReset();
    m.admin.mockReturnValue(true);
    m.user.mockResolvedValue({ id: "u1" });
    m.row.mockResolvedValue({ data: { id: ROW } });
    m.card.mockResolvedValue({ data: { id: CARD } });
    m.write.mockResolvedValue(true);
  });

  it("is recorded once the collection row holds the new card — no id, no name", async () => {
    expect(await recordCollectionCustomizedAction(ROW, CARD)).toEqual({ ok: true });
    expect(m.event).toHaveBeenCalledTimes(1);
    expect(m.event).toHaveBeenCalledWith({
      slug: "bulk-customize",
      userId: "u1",
      event: "customize_one",
      // The action checks its rows, not a tool gate: no access path to name.
      access: null,
      props: { source: "collection" },
    });
  });

  it("nothing is recorded when nothing was written", async () => {
    m.write.mockResolvedValueOnce(false);
    expect(await recordCollectionCustomizedAction(ROW, CARD)).toEqual({ ok: false });
    m.row.mockResolvedValueOnce({ data: null });
    expect(await recordCollectionCustomizedAction(ROW, CARD)).toEqual({ ok: false });
    m.user.mockResolvedValueOnce(null);
    expect(await recordCollectionCustomizedAction(ROW, CARD)).toEqual({ ok: false });
    expect(await recordCollectionCustomizedAction("nope", CARD)).toEqual({ ok: false });
    expect(m.event).not.toHaveBeenCalled();
  });
});
