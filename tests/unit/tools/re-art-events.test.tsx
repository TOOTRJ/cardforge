// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import type { GenerationJobView, JobStep } from "@/lib/ai/generation-jobs";
import type { ReartStudioEntry } from "@/lib/tools/re-art/model";

// ---------------------------------------------------------------------------
// What a Re-art RUN tells the tool's log. The runner lives in the browser
// (components/tools/bulk-customize/use-bulk-runner.ts), so the studio says
// what a run came to: `run_finished` once each time the runner ends — the
// cards painted and the credits really charged in THAT pass (a continued run
// reports each pass; the passes add up), the cards it left failed or
// waiting, and why it stopped — and the maker's `stop`, `continue` and
// `retry`. Numbers and codes only: never a card's or a deck's name.
// (What the server's actions log is re-art-actions.test.ts.)
//
// And ONE card at a time: every one-card paint is priced in the confirm
// first (pressing its link charges nothing), a re-roll says the picture it
// replaces can't be brought back, and no card is painted while the style
// form shows a style that isn't saved.
// ---------------------------------------------------------------------------

type Runner = {
  steps: JobStep[];
  running: boolean;
  waitingUntil: number | null;
  stoppedBy: "CARD_CAPACITY" | "INSUFFICIENT_CREDITS" | null;
  error: string | null;
  paused: boolean;
  runsEnded: number;
};

const h = vi.hoisted(() => ({
  track: vi.fn(),
  start: vi.fn(),
  refresh: vi.fn(),
  stop: vi.fn(),
  retry: vi.fn(),
  upgrade: vi.fn(),
  toastError: vi.fn(),
  runner: null as unknown as Runner,
  /** What the confirm's Paint starts (the server's answer to the start). */
  job: null as unknown as GenerationJobView,
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: h.refresh, push: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={String(href)} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("sonner", () => ({ toast: { error: h.toastError, success: vi.fn() } }));
vi.mock("@/components/billing/upgrade-modal-provider", () => ({ useUpgradeModal: () => ({ open: h.upgrade }) }));
vi.mock("@/components/ai/use-leave-warning", () => ({ useLeaveWarning: () => undefined }));
vi.mock("@/lib/tools/track-client", () => ({ trackToolEvent: h.track }));
vi.mock("@/lib/tools/re-art/actions", () => ({
  startReartAction: h.start,
  saveReartStyleAction: vi.fn(),
  restoreReartArtAction: vi.fn(),
  planReartAction: vi.fn(),
}));
// The runner as the test sets it: a job's steps and where the run stands.
vi.mock("@/components/tools/bulk-customize/use-bulk-runner", () => ({
  useBulkRunner: (job: GenerationJobView | null) =>
    job
      ? { ...h.runner, stop: h.stop, retryFailed: h.retry }
      : { steps: [], running: false, waitingUntil: null, stoppedBy: null, error: null, paused: false, runsEnded: 0, stop: h.stop, retryFailed: h.retry },
}));
vi.mock("@/components/tools/bulk-customize/bulk-progress", () => ({
  BulkProgress: ({ runner }: { runner: { stop: () => void; retryFailed: () => void } }) => (
    <div>
      <button type="button" onClick={runner.stop}>
        panel stop
      </button>
      <button type="button" onClick={runner.retryFailed}>
        panel again
      </button>
    </div>
  ),
}));
// The style form as a button that changes it (the form is then not saved).
vi.mock("@/components/tools/re-art/reart-style-panel", () => ({
  ReartStylePanel: ({ onChange }: { onChange: (next: { preset: string; theme: string }) => void }) => (
    <button type="button" onClick={() => onChange({ preset: "anime", theme: "a neon harbour" })}>
      change style
    </button>
  ),
}));
// The confirm as the studio opens it: its words, the run it would start, and
// a Paint that starts it (the real dialog plans, prices and calls the start:
// its own business).
vi.mock("@/components/tools/re-art/reart-confirm-dialog", () => ({
  ReartConfirmDialog: ({
    open,
    title,
    description,
    input,
    onStarted,
  }: {
    open: boolean;
    title: string;
    description: string;
    input: unknown;
    onStarted: (job: GenerationJobView, skipped: Array<{ name: string; reason: string }>, version: number) => void;
  }) =>
    open ? (
      <div role="dialog" aria-label={title} data-input={JSON.stringify(input)}>
        <p>{description}</p>
        <button type="button" onClick={() => onStarted(h.job, [], 1)}>
          confirm paint
        </button>
      </div>
    ) : null,
}));
vi.mock("@/components/tools/re-art/reart-run-list", () => ({ ReartRunList: () => null }));
vi.mock("@/components/tools/re-art/reart-card-grid", () => ({
  ReartCardGrid: ({
    entries,
    paintBlocked,
    onPaintOne,
  }: {
    entries: ReartStudioEntry[];
    paintBlocked?: string | null;
    onPaintOne: (entry: ReartStudioEntry) => void;
  }) => (
    <div>
      {paintBlocked ? <p data-testid="grid-blocked">{paintBlocked}</p> : null}
      <button type="button" onClick={() => onPaintOne(entries[0])}>
        paint one
      </button>
    </div>
  ),
}));

import { ReartStudio } from "@/components/tools/re-art/reart-studio";
import { reartRunMode, reartRunOutcome } from "@/lib/tools/re-art/model";

const step = (key: number, patch: Partial<JobStep> = {}): JobStep => ({
  key: `reart:${key}`,
  label: `Thornback Wyrm ${key}`,
  status: "pending",
  ...patch,
});
const done = (key: number, patch: Partial<JobStep> = {}) => step(key, { status: "done", spend_ref: `spend:job:${key}`, ...patch });
const failed = (key: number, patch: Partial<JobStep> = {}) => step(key, { status: "failed", ...patch });

describe("reartRunOutcome — one pass of the runner, as the log reads it", () => {
  const before = [step(0), step(1), step(2), step(3)];

  it("a run that painted every card: the cards and the credits really charged", () => {
    expect(
      reartRunOutcome({
        before,
        // A two-faced card is two credits; one found in the style already and
        // an admin's (no charge ref) cost nothing.
        after: [done(0), done(1, { credits: 2 }), done(2, { spend_ref: null }), done(3)],
        retried: false,
        stoppedBy: null,
        error: false,
      }),
    ).toEqual({ cards: 4, painted: 4, failed: 0, waiting: 0, credits: 4, stopped: "done" });
  });

  it("names why it stopped: the maker, a plan limit, a door error", () => {
    const partly = [done(0), step(1), step(2), step(3)];
    const run = (end: { stoppedBy?: "CARD_CAPACITY" | "INSUFFICIENT_CREDITS"; error?: boolean }, after = partly) =>
      reartRunOutcome({ before, after, retried: false, stoppedBy: end.stoppedBy ?? null, error: end.error ?? false });
    expect(run({})).toMatchObject({ painted: 1, waiting: 3, credits: 1, stopped: "cancelled" });
    expect(run({ error: true })).toMatchObject({ waiting: 3, stopped: "error" });
    const wall = [done(0), failed(1, { error_code: "INSUFFICIENT_CREDITS" }), step(2), step(3)];
    expect(run({ stoppedBy: "INSUFFICIENT_CREDITS" }, wall)).toMatchObject({
      painted: 1,
      failed: 1,
      waiting: 2,
      stopped: "credits",
      top_failure: "insufficient_credits",
    });
    const full = [failed(0, { error_code: "CARD_CAPACITY" }), step(1), step(2), step(3)];
    expect(run({ stoppedBy: "CARD_CAPACITY" }, full)).toMatchObject({ painted: 0, stopped: "capacity", top_failure: "capacity" });
  });

  it("names the commonest reason its failed cards failed — a code, never the card's own words", () => {
    const outcome = reartRunOutcome({
      before,
      after: [
        failed(0, { failure: "art_blocked", error: "The filter declined Thornback Wyrm." }),
        failed(1, { failure: "art_blocked" }),
        failed(2, { failure: "art_timeout" }),
        failed(3, { error: "The deck's style changed since this run started." }),
      ],
      retried: false,
      stoppedBy: null,
      error: false,
    });
    expect(outcome).toEqual({ cards: 4, painted: 0, failed: 4, waiting: 0, credits: 0, stopped: "done", top_failure: "art_blocked" });
    expect(JSON.stringify(outcome)).not.toMatch(/Thornback|style changed/);
  });

  it("a continued run reports its own pass: the passes add up", () => {
    const first = [done(0), failed(1, { failure: "art_failed" }), failed(2, { failure: "art_failed" }), step(3)];
    const second = [done(0), done(1), failed(2, { failure: "art_busy" }), done(3, { credits: 2 })];
    const one = reartRunOutcome({ before, after: first, retried: false, stoppedBy: null, error: false });
    const two = reartRunOutcome({ before: first, after: second, retried: true, stoppedBy: null, error: false });
    expect(one).toMatchObject({ painted: 1, failed: 2, waiting: 1, credits: 1, stopped: "cancelled" });
    expect(two).toMatchObject({ painted: 2, failed: 1, waiting: 0, credits: 3, stopped: "done", top_failure: "art_busy" });
    expect(one.painted + two.painted).toBe(3);
    expect(one.credits + two.credits).toBe(4);
  });

  it("a run picked up from an earlier visit never counts that visit's cards", () => {
    // Its first pass runs only the cards still waiting: an older failure
    // stays failed without being this pass's.
    const earlier = [done(0), failed(1, { failure: "art_failed" }), step(2), step(3)];
    const now = [done(0), failed(1, { failure: "art_failed" }), done(2), failed(3, { failure: "art_timeout" })];
    expect(reartRunOutcome({ before: earlier, after: now, retried: false, stoppedBy: null, error: false })).toEqual({
      cards: 4,
      painted: 1,
      failed: 1,
      waiting: 0,
      credits: 1,
      stopped: "done",
      top_failure: "art_timeout",
    });
  });

  it("a run is a sample, named cards or the deck — from the job's own request", () => {
    expect(reartRunMode({ sample: true, reroll: false })).toBe("sample");
    expect(reartRunMode({ sample: false, reroll: true })).toBe("cards");
    expect(reartRunMode({ sample: false, reroll: false })).toBe("deck");
    expect(reartRunMode(null)).toBe("deck");
  });
});

const ENTRY: ReartStudioEntry = {
  id: "00000000-0000-4000-8000-0000000000e1",
  name: "Thornback Wyrm",
  quantity: 1,
  board: "main",
  typeLine: "Creature — Wyrm",
  imageUrl: null,
  kind: "own",
  skipMessage: null,
  card: null,
  bucket: "creature",
  state: null,
  canRestore: false,
  artNow: "own",
  credits: 1,
};

const job = (steps: JobStep[], request: Record<string, unknown> = { sample: false, reroll: false }): GenerationJobView => ({
  id: "job-1",
  owner_id: "u1",
  kind: "deck_reart",
  status: "generating",
  request,
  steps,
  deck_id: null,
  error: null,
});

const SAVED_STYLE = { preset: "watercolor", theme: "a haunted fen", version: 1 };

function studio(
  pausedRunId: string | null = null,
  over: { entry?: Partial<ReartStudioEntry>; storedStyle?: typeof SAVED_STYLE | null } = {},
) {
  return (
    <ReartStudio
      deck={{ id: "00000000-0000-4000-8000-0000000000d1", slug: "embers", title: "Embers of the Fen" }}
      storedStyle={over.storedStyle === undefined ? SAVED_STYLE : over.storedStyle}
      entries={[{ ...ENTRY, ...over.entry }]}
      username="dev_free"
      capacity={null}
      balance={20}
      aiAvailable
      pausedRunId={pausedRunId}
      runs={[]}
    />
  );
}

const running = (steps: JobStep[]): Runner => ({
  steps,
  running: true,
  waitingUntil: null,
  stoppedBy: null,
  error: null,
  paused: false,
  runsEnded: 0,
});

/** The studio with a run under way: one card's "Paint this one…", then the
 *  confirm's Paint (nothing starts before it). */
async function begin(steps: JobStep[], request?: Record<string, unknown>) {
  h.runner = running(steps);
  h.job = job(steps, request);
  const view = render(studio());
  await act(async () => {
    fireEvent.click(screen.getByText("paint one"));
  });
  expect(screen.queryByText("panel stop")).toBeNull();
  await act(async () => {
    fireEvent.click(screen.getByText("confirm paint"));
  });
  expect(screen.getByText("panel stop")).toBeTruthy();
  return view;
}

/** The runner moves on; the studio renders again with what it says now. */
function runnerSays(view: ReturnType<typeof render>, next: Partial<Runner>, pausedRunId: string | null = null) {
  h.runner = { ...h.runner, ...next };
  act(() => view.rerender(studio(pausedRunId)));
}

const events = (name: string) => h.track.mock.calls.filter((call) => call[1] === name).map((call) => call[2]);

beforeEach(() => {
  for (const fn of [h.track, h.start, h.refresh, h.stop, h.retry, h.upgrade, h.toastError]) fn.mockReset();
  vi.stubGlobal("requestAnimationFrame", (run: () => void) => {
    run();
    return 0;
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the studio — `run_finished`, once each time the runner ends", () => {
  it("says what the run came to, after the page's refresh, and never twice", async () => {
    const view = await begin([step(0), step(1), step(2)], { sample: true, reroll: false });
    expect(h.track).not.toHaveBeenCalled();

    // Cards landing while it runs are not an end.
    runnerSays(view, { steps: [done(0), step(1, { status: "running" }), step(2)] });
    expect(h.track).not.toHaveBeenCalled();

    runnerSays(view, {
      steps: [done(0), done(1, { credits: 2 }), failed(2, { failure: "art_timeout", refunded: 1 })],
      running: false,
      runsEnded: 1,
    });
    expect(h.track).toHaveBeenCalledTimes(1);
    expect(h.track).toHaveBeenCalledWith("re-art-deck", "run_finished", {
      cards: 3,
      painted: 2,
      failed: 1,
      waiting: 0,
      credits: 3,
      stopped: "done",
      top_failure: "art_timeout",
      mode: "sample",
      pass: 1,
      resumed: false,
    });
    // The refresh of the cards behind the run was asked for first.
    expect(h.refresh.mock.invocationCallOrder.at(-1)!).toBeLessThan(h.track.mock.invocationCallOrder[0]);

    // Another render of the same ended run says nothing more.
    runnerSays(view, {});
    expect(h.track).toHaveBeenCalledTimes(1);
    const props = h.track.mock.calls[0][2] as Record<string, unknown>;
    expect(Object.keys(props).length).toBeLessThanOrEqual(12);
    expect(JSON.stringify(props)).not.toMatch(/Thornback|Embers|fen|0000-4000/i);
  });

  it("a stop is `cancelled`; the continue that follows reports its own pass", async () => {
    const view = await begin([step(0), step(1), step(2)]);
    fireEvent.click(screen.getByText("panel stop"));
    expect(h.stop).toHaveBeenCalledTimes(1);
    expect(events("stop")).toEqual([{ painted: 0, failed: 0, waiting: 3 }]);

    runnerSays(view, { steps: [done(0), step(1), step(2)], running: false, paused: true, runsEnded: 1 });
    expect(events("run_finished")).toEqual([
      { cards: 3, painted: 1, failed: 0, waiting: 2, credits: 1, stopped: "cancelled", mode: "deck", pass: 1, resumed: false },
    ]);

    // Paused: the panel's button continues the run.
    fireEvent.click(screen.getByText("panel again"));
    expect(h.retry).toHaveBeenCalledTimes(1);
    expect(events("continue")).toEqual([{ earlier_visit: false, failed: 0, waiting: 2 }]);

    runnerSays(view, { running: true, paused: false });
    runnerSays(view, { steps: [done(0), done(1), done(2)], running: false, runsEnded: 2 });
    expect(events("run_finished")[1]).toEqual({
      cards: 3,
      painted: 2,
      failed: 0,
      waiting: 0,
      credits: 2,
      stopped: "done",
      mode: "deck",
      pass: 2,
      resumed: false,
    });
  });

  it("a plan limit is the reason; trying the failed cards again is `retry`", async () => {
    const view = await begin([step(0), step(1)], { sample: false, reroll: true });
    runnerSays(view, {
      steps: [done(0), failed(1, { error_code: "INSUFFICIENT_CREDITS" })],
      running: false,
      stoppedBy: "INSUFFICIENT_CREDITS",
      runsEnded: 1,
    });
    expect(events("run_finished")).toEqual([
      {
        cards: 2,
        painted: 1,
        failed: 1,
        waiting: 0,
        credits: 1,
        stopped: "credits",
        top_failure: "insufficient_credits",
        mode: "cards",
        pass: 1,
        resumed: false,
      },
    ]);
    // Settled with a failure: the panel's button tries the failed ones again.
    fireEvent.click(screen.getByText("panel again"));
    expect(events("retry")).toEqual([{ earlier_visit: false, failed: 1, waiting: 0 }]);
    expect(events("continue")).toEqual([]);
  });

  it("a run continued from an earlier visit says so, and counts this visit's cards only", async () => {
    const earlier = [done(0), failed(1, { failure: "art_failed" }), step(2)];
    h.runner = running(earlier);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ json: async () => ({ ok: true, job: job(earlier) }) })),
    );
    const view = render(studio("job-1"));
    await act(async () => {
      fireEvent.click(screen.getByText("Continue it"));
    });
    expect(events("continue")).toEqual([{ earlier_visit: true }]);

    runnerSays(view, { steps: [done(0), failed(1, { failure: "art_failed" }), done(2)], running: false, runsEnded: 1 }, "job-1");
    expect(events("run_finished")).toEqual([
      {
        cards: 3,
        painted: 1,
        failed: 0,
        waiting: 0,
        credits: 1,
        stopped: "done",
        mode: "deck",
        pass: 1,
        resumed: true,
      },
    ]);
  });
});

describe("one card at a time — priced first, in the saved style, never by a stray press", () => {
  const press = async (text: string) => {
    await act(async () => {
      fireEvent.click(screen.getByText(text));
    });
  };

  it("pressing a card's paint link opens the confirm and charges nothing by itself", async () => {
    h.runner = running([step(0)]);
    h.job = job([step(0)], { sample: false, reroll: true });
    render(studio());
    await press("paint one");
    // Its own card used to be charged the moment the link was pressed: now
    // nothing runs until the confirm's Paint.
    expect(screen.queryByText("panel stop")).toBeNull();
    const dialog = screen.getByRole("dialog", { name: "Paint Thornback Wyrm" });
    expect(dialog.textContent).toContain("The art it has now can be put back from this page.");
    expect(dialog.textContent).toContain("Nothing is charged until you press Paint.");
    // One named card, in the deck's SAVED style: the run names no style.
    expect(JSON.parse(dialog.getAttribute("data-input")!)).toEqual({
      deckId: "00000000-0000-4000-8000-0000000000d1",
      entryIds: [ENTRY.id],
      scope: "all",
      visibility: "private",
    });
    await press("confirm paint");
    expect(screen.getByText("panel stop")).toBeTruthy();
  });

  it("a re-roll says the picture it replaces can't be brought back", async () => {
    render(studio(null, { entry: { state: "in_style", artNow: "reart" } }));
    await press("paint one");
    const dialog = screen.getByRole("dialog", { name: "Re-roll Thornback Wyrm" });
    expect(dialog.textContent).toContain("can't be brought back");
    expect(dialog.textContent).toContain("Nothing is charged until you press Paint.");
  });

  it("says the same of a picture another deck's run painted, and promises no put-back to a card with no art", async () => {
    // Never painted on THIS deck, but the art on it is Re-art's (deck B's).
    const { unmount } = render(studio(null, { entry: { state: null, artNow: "reart" } }));
    await press("paint one");
    const other = screen.getByRole("dialog", { name: "Paint Thornback Wyrm" });
    expect(other.textContent).toContain("can't be brought back");
    expect(other.textContent).not.toContain("can be put back");
    unmount();
    render(studio(null, { entry: { state: null, artNow: "none" } }));
    await press("paint one");
    const bare = screen.getByRole("dialog", { name: "Paint Thornback Wyrm" });
    expect(bare.textContent).toContain("Your card gets new art in the deck's saved style.");
    expect(bare.textContent).not.toMatch(/put back|brought back/);
  });

  it("a real card's confirm says it becomes the maker's own", async () => {
    render(studio(null, { entry: { kind: "printing" } }));
    await press("paint one");
    expect(screen.getByRole("dialog", { name: "Paint Thornback Wyrm" }).textContent).toContain("It becomes your own card");
  });

  it("no card is painted while the form shows a style that isn't saved — it says why", async () => {
    render(studio());
    expect(screen.queryByTestId("grid-blocked")).toBeNull();
    await press("change style");
    // Said above the cards…
    expect(screen.getByTestId("grid-blocked").textContent).toMatch(/You changed the style\. Save it or undo your changes first/);
    // …and again where the link is pressed. It used to paint in the SAVED
    // style without a word.
    await press("paint one");
    expect(h.toastError).toHaveBeenCalledWith(expect.stringMatching(/You changed the style\. Save it or undo your changes first/));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText("panel stop")).toBeNull();
  });

  it("the header reads as a sentence (it lost a space: “7 cardsin the deck's style”)", () => {
    render(studio(null, { entry: { state: "in_style", artNow: "reart" } }));
    expect(screen.getByText("1 of 1 card in the deck's style")).toBeTruthy();
    cleanup();
    // A card that shows other art now is never counted as in the style.
    render(studio(null, { entry: { state: "changed" } }));
    expect(screen.getByText("0 of 1 card in the deck's style")).toBeTruthy();
  });

  it("a deck with no saved style asks for one first", async () => {
    render(studio(null, { storedStyle: null }));
    expect(screen.getByTestId("grid-blocked").textContent).toMatch(/Save the deck's style first/);
    await press("paint one");
    expect(h.toastError).toHaveBeenCalledWith(expect.stringMatching(/Save the deck's style first/));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
