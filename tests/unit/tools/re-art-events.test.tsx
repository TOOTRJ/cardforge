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
  BulkProgress: ({
    runner,
    modelLabel,
  }: {
    runner: { stop: () => void; retryFailed: () => void };
    modelLabel?: (imageModel: string) => string | null;
  }) => (
    <div data-testid="progress" data-names-model={modelLabel ? (modelLabel("bfl/flux-kontext-pro") ?? "") : "no"}>
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
  ReartStylePanel: ({
    onChange,
    preview,
    dirty,
    paintedInSaved,
    framing,
  }: {
    onChange: (next: { preset: string; theme: string; mode: "preset" | "custom"; prompt: string }) => void;
    preview?: { name: string; prompt: string; partial: boolean } | null;
    dirty: boolean;
    paintedInSaved: number;
    framing?: string;
  }) => (
    <div data-testid="style-panel" data-framing={framing}>
      <button type="button" onClick={() => onChange({ preset: "anime", theme: "a neon harbour", mode: "preset", prompt: "" })}>
        change style
      </button>
      <button type="button" onClick={() => onChange({ preset: "watercolor", theme: "a haunted fen", mode: "preset", prompt: "{card} in oils, a draft" })}>
        leave a draft
      </button>
      <button type="button" onClick={() => onChange({ preset: "watercolor", theme: "a haunted fen", mode: "custom", prompt: "An oil painting of {card}" })}>
        own prompt
      </button>
      {preview ? <p data-testid="panel-preview">{`${preview.name} | ${preview.partial} | ${preview.prompt}`}</p> : null}
      <p data-testid="panel-state">{`dirty:${dirty} repaint:${paintedInSaved}`}</p>
    </div>
  ),
}));
// The card's own words (0209): the dialog as the studio opens it.
vi.mock("@/components/tools/re-art/reart-card-words-dialog", () => ({
  ReartCardWordsDialog: ({
    open,
    entry,
    style,
    framing,
    onSaved,
  }: {
    open: boolean;
    entry: ReartStudioEntry;
    style: { mode?: string };
    framing?: string;
    onSaved: (words: { text: string; only: boolean } | null) => void;
  }) =>
    open ? (
      <div role="dialog" aria-label={`Words for ${entry.name}`} data-mode={style.mode} data-framing={framing}>
        <button type="button" onClick={() => onSaved({ text: "a wyrm asleep", only: false })}>
          save words
        </button>
      </div>
    ) : null,
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
    onEditWords,
  }: {
    entries: ReartStudioEntry[];
    paintBlocked?: string | null;
    onPaintOne: (entry: ReartStudioEntry) => void;
    onEditWords?: (entry: ReartStudioEntry) => void;
  }) => (
    <div>
      {paintBlocked ? <p data-testid="grid-blocked">{paintBlocked}</p> : null}
      <button type="button" onClick={() => onPaintOne(entries[0])}>
        paint one
      </button>
      <button type="button" onClick={() => onEditWords?.(entries[0])}>
        edit words
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
  words: null,
  rulesText: null,
  flavorText: "Scales like slate.",
  credits: 1,
  paintedBy: null,
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

const SAVED_STYLE = { preset: "watercolor", theme: "a haunted fen", mode: "preset" as const, prompt: "", version: 1 };

function studio(
  pausedRunId: string | null = null,
  over: { entry?: Partial<ReartStudioEntry>; storedStyle?: typeof SAVED_STYLE | null; canPickModel?: boolean } = {},
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
      canPickModel={over.canPickModel}
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
      // No picker for this viewer: every run is Automatic.
      model: "auto",
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
    // A card that shows other art now is never counted as in the style: it
    // is one of the cards left as they are, as the list's filter counts it.
    render(studio(null, { entry: { state: "changed" } }));
    expect(screen.getByText("0 of 1 card in the deck's style · 1 left as it is")).toBeTruthy();
  });

  it("the sample's confirm says when it replaces a picture Re-art painted", async () => {
    // The one card is the default sample.
    const { unmount } = render(studio(null, { entry: { state: "earlier", artNow: "reart" } }));
    await press("Paint the sample…");
    expect(screen.getByRole("dialog").textContent).toContain("A picture Re-art painted on a sample card is replaced and can't be brought back.");
    unmount();
    render(studio());
    await press("Paint the sample…");
    const plain = screen.getByRole("dialog").textContent ?? "";
    expect(plain).not.toMatch(/brought back/);
    expect(plain).toContain("Nothing is charged until you press Paint.");
  });

  it("a deck with no saved style asks for one first", async () => {
    render(studio(null, { storedStyle: null }));
    expect(screen.getByTestId("grid-blocked").textContent).toMatch(/Save the deck's style first/);
    await press("paint one");
    expect(h.toastError).toHaveBeenCalledWith(expect.stringMatching(/Save the deck's style first/));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("the maker's own prompts in the studio (0209)", () => {
  const press = async (text: string) => {
    await act(async () => {
      fireEvent.click(screen.getByText(text));
    });
  };

  it("the style form is shown one card's whole prompt, built as the step builds it — and follows the form", async () => {
    render(studio());
    // The template: the card's own subject, then the deck's style block.
    expect(screen.getByTestId("panel-preview").textContent).toMatch(
      /^Thornback Wyrm \| false \| Trading-card illustration of "Thornback Wyrm", a Creature — Wyrm\. Its mood: Scales like slate\. Rendered strictly in watercolor style\./,
    );
    await press("own prompt");
    expect(screen.getByTestId("panel-preview").textContent).toBe(
      'Thornback Wyrm | false | An oil painting of "Thornback Wyrm", a Creature — Wyrm. NO frame, NO borders, NO card layout, NO text or lettering anywhere in the image.',
    );
  });

  it("a real card's preview is marked partial (its text is read when it is painted); the card's own words are in it", () => {
    render(studio(null, { entry: { kind: "printing", flavorText: null, words: { text: "a wyrm asleep", only: false } } }));
    expect(screen.getByTestId("panel-preview").textContent).toMatch(/^Thornback Wyrm \| true \| a wyrm asleep\. Rendered strictly in watercolor style\./);
  });

  it("a card's own words open in their dialog with the form's style; saving them re-reads the page and paints nothing", async () => {
    render(studio());
    await press("own prompt");
    await press("edit words");
    const dialog = screen.getByRole("dialog", { name: "Words for Thornback Wyrm" });
    expect(dialog.getAttribute("data-mode")).toBe("custom");
    h.refresh.mockClear();
    await press("save words");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(h.refresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("panel stop")).toBeNull();
    expect(h.track).not.toHaveBeenCalled();
  });

  it("no words are edited while a run is going", async () => {
    await begin([step(0)]);
    await press("edit words");
    expect(screen.queryByRole("dialog", { name: /Words for/ })).toBeNull();
  });
});

describe("the other mode's draft (0209) — something to save, never a new look", () => {
  const press = async (text: string) => {
    await act(async () => {
      fireEvent.click(screen.getByText(text));
    });
  };
  const second: ReartStudioEntry = { ...ENTRY, id: "00000000-0000-4000-8000-0000000000e2", name: "Cinder Hound", state: "in_style", artNow: "reart" };

  function studioWith(entries: ReartStudioEntry[]) {
    return render(
      <ReartStudio
        deck={{ id: "00000000-0000-4000-8000-0000000000d1", slug: "embers", title: "Embers of the Fen" }}
        storedStyle={SAVED_STYLE}
        entries={entries}
        username="dev_free"
        capacity={null}
        balance={20}
        aiAvailable
        pausedRunId={null}
        runs={[]}
      />,
    );
  }

  it("a prompt written and then left for the template is the SAME look: the form has something to save, and nothing else changes", async () => {
    studioWith([ENTRY, second]);
    expect(screen.getByTestId("panel-state").textContent).toBe("dirty:false repaint:0");
    await press("leave a draft");
    // Save is offered (the draft was dropped on a reload)…
    expect(screen.getByTestId("panel-state").textContent).toBe("dirty:true repaint:0");
    // …but it is no new look: one card can still be painted, and the card
    // painted in the saved style is not painted again.
    expect(screen.queryByTestId("grid-blocked")).toBeNull();
    expect(screen.getByText(/1 card to paint · 1 in this style already/)).toBeTruthy();
    await press("paint one");
    expect(screen.getByRole("dialog", { name: "Paint Thornback Wyrm" })).toBeTruthy();
  });

  it("another LOOK is: one card waits for the save, and the painted cards would be painted again", async () => {
    studioWith([ENTRY, second]);
    await press("change style");
    expect(screen.getByTestId("panel-state").textContent).toBe("dirty:true repaint:1");
    expect(screen.getByTestId("grid-blocked")).toBeTruthy();
    expect(screen.getByText(/2 cards to paint/)).toBeTruthy();
  });

  it("the deck prompt's preview is a card painted from the DECK's prompt — never one that uses only its own words, while another exists", async () => {
    const onlyWords: ReartStudioEntry = { ...ENTRY, words: { text: "a lighthouse in a storm", only: true } };
    const withWords: ReartStudioEntry = { ...second, state: null, artNow: "own", words: { text: "a hound of embers", only: false } };
    const plain: ReartStudioEntry = { ...second, id: "00000000-0000-4000-8000-0000000000e3", name: "Fen Witch", state: null, artNow: "own" };
    const view = studioWith([onlyWords, withWords, plain]);
    expect(screen.getByTestId("panel-preview").textContent).toMatch(/^Fen Witch \|/);
    view.unmount();
    const next = studioWith([onlyWords, withWords]);
    expect(screen.getByTestId("panel-preview").textContent).toMatch(/^Cinder Hound \| false \| a hound of embers\. Rendered strictly/);
    next.unmount();
    studioWith([onlyWords]);
    expect(screen.getByTestId("panel-preview").textContent).toMatch(/^Thornback Wyrm \| false \| a lighthouse in a storm\. NO frame/);
  });
});


describe("the model picker (0211) — for admins and testers", () => {
  const KONTEXT = "FLUX.1 Kontext [pro]";
  const press = async (text: string) => {
    await act(async () => {
      fireEvent.click(screen.getByText(text));
    });
  };
  const pick = async (label: string) => {
    await act(async () => {
      fireEvent.click(screen.getByRole("radio", { name: new RegExp(`^${label.replace(/[.[\]]/g, "\\$&")}`) }));
    });
  };
  const inputOf = () => JSON.parse(screen.getByRole("dialog").getAttribute("data-input")!) as Record<string, unknown>;

  it("is not shown to a viewer who may not pick: every run is Automatic, and no card says who painted it", async () => {
    render(studio());
    expect(screen.queryByRole("radiogroup", { name: "Painted by" })).toBeNull();
    expect(screen.queryByText(/for testing/)).toBeNull();
    for (const open of ["paint one", "Paint the sample…", "Re-art the deck…"]) {
      await press(open);
      expect(inputOf().model).toBe("auto");
      cleanup();
      render(studio());
    }
    // A run's panel isn't handed a model's name either.
    cleanup();
    await begin([step(0)]);
    expect(screen.getByTestId("progress").getAttribute("data-names-model")).toBe("no");
  });

  it("lists Automatic and the five models, Automatic picked, each one's line said as it is picked", async () => {
    render(studio(null, { canPickModel: true }));
    const group = screen.getByRole("radiogroup", { name: "Painted by" });
    const chips = [...group.querySelectorAll("[role='radio']")];
    expect(chips.map((chip) => chip.textContent)).toEqual([
      "Automatic",
      "FLUX.2 [pro]",
      "FLUX.1 Kontext [pro]",
      "Grok Imagine",
      "Grok Imagine 2.0",
      "Gemini 3.1 Flash Image",
    ]);
    expect(chips.map((chip) => chip.getAttribute("aria-checked"))).toEqual(["true", "false", "false", "false", "false", "false"]);
    // The picked model's line describes the row, with the price.
    const described = () => document.getElementById(group.getAttribute("aria-describedby")!)?.textContent ?? "";
    expect(described()).toMatch(/What every other tool paints with/);
    expect(described()).toMatch(/One credit a picture, whichever model paints\./);
    await pick(KONTEXT);
    expect(described()).toMatch(/editing model/);
    expect(screen.getByText(/sent the same prompt in plainer words/)).toBeTruthy();
    // FLUX.2's own wording needs no such note.
    await pick("FLUX.2 [pro]");
    expect(screen.queryByText(/plainer words/)).toBeNull();
  });

  it("the picked model goes with every run — one card, the sample, the deck — and is no part of the style", async () => {
    for (const [open, extra] of [
      ["paint one", { entryIds: [ENTRY.id] }],
      ["Paint the sample…", { sample: true }],
      ["Re-art the deck…", {}],
    ] as const) {
      render(studio(null, { canPickModel: true }));
      await pick(KONTEXT);
      // Picking a model leaves the style as saved: one card can still be painted.
      expect(screen.getByTestId("panel-state").textContent).toBe("dirty:false repaint:0");
      expect(screen.queryByTestId("grid-blocked")).toBeNull();
      await press(open);
      expect(inputOf()).toMatchObject({ model: "bfl/flux-kontext-pro", ...extra });
      expect(JSON.stringify(inputOf().style ?? {})).not.toMatch(/kontext/);
      cleanup();
    }
  });

  it("the prompt shown is in the wording the picked model is sent — the style form's and the card's own words' alike", async () => {
    render(studio(null, { canPickModel: true }));
    expect(screen.getByTestId("panel-preview").textContent).toMatch(/\| Trading-card illustration of "Thornback Wyrm", a Creature — Wyrm\./);
    expect(screen.getByTestId("style-panel").getAttribute("data-framing")).toBe("flux2");
    await press("edit words");
    expect(screen.getByRole("dialog", { name: /Words for/ }).getAttribute("data-framing")).toBe("flux2");
    cleanup();

    render(studio(null, { canPickModel: true }));
    await pick("Gemini 3.1 Flash Image");
    const preview = screen.getByTestId("panel-preview").textContent ?? "";
    expect(preview).toMatch(/\| Fantasy illustration of Thornback Wyrm, a Creature — Wyrm\. Its mood: Scales like slate\./);
    expect(preview).toMatch(/no text, letters, signature, title or caption anywhere\.$/);
    expect(preview).not.toMatch(/Trading-card|NO frame/);
    expect(screen.getByTestId("style-panel").getAttribute("data-framing")).toBe("plain");
    await press("edit words");
    expect(screen.getByRole("dialog", { name: /Words for/ }).getAttribute("data-framing")).toBe("plain");
  });

  it("a run's panel names who painted each card, and its outcome says which model the run named", async () => {
    h.runner = running([step(0)]);
    h.job = job([step(0)], { sample: false, reroll: true, model: "bfl/flux-kontext-pro" });
    const view = render(studio(null, { canPickModel: true }));
    await press("paint one");
    await press("confirm paint");
    expect(screen.getByTestId("progress").getAttribute("data-names-model")).toBe(KONTEXT);
    h.runner = { ...h.runner, steps: [done(0, { image_model: "bfl/flux-kontext-pro" })], running: false, runsEnded: 1 };
    act(() => view.rerender(studio(null, { canPickModel: true })));
    expect(events("run_finished")).toEqual([
      {
        cards: 1,
        painted: 1,
        failed: 0,
        waiting: 0,
        credits: 1,
        stopped: "done",
        mode: "cards",
        pass: 1,
        resumed: false,
        model: "bfl/flux-kontext-pro",
      },
    ]);
    expect(Object.keys(events("run_finished")[0] as object).length).toBeLessThanOrEqual(12);
  });
});
