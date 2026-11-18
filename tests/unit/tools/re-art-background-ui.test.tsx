// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import type { GenerationJobView, JobStep } from "@/lib/ai/generation-jobs";
import type { ReartBackground, ReartRunInput, ReartStudioEntry } from "@/lib/tools/re-art/model";

// ---------------------------------------------------------------------------
// Re-art deck's studio — a run that goes on with the page closed (migration
// 0218; owner 2026-11-18: a tick box, on by default, on the runs long enough
// to walk away from):
//
//   * the confirm of "Re-art the deck…" and of a selection offers "Keep
//     painting if I close this page", ticked, and says what it means before
//     the run starts; a one-card paint offers nothing;
//   * a run started with the box ticked is handed to the server at once;
//     while the server carries it the page says it can be closed and stops
//     warning about leaving; a refused hand-over is said, and the run is the
//     page's alone as it always was;
//   * Stop means stop: the server's part ends too — asked by a plain
//     request the browser sends even if the tab closes, the leave warning
//     kept until the server answers, and a Stop that didn't land SAID, with
//     a way to ask again;
//   * a page opened on a run the server is carrying shows it going on at
//     once — never as a paused run to "continue"; one the server is no
//     longer carrying (the hour ran out, nobody has looked at it lately) is
//     continued as ever, and handed to the server again;
//   * "the server is carrying this" is read from when it last looked: the
//     page says a run can be left only while that is recent, and reads the
//     run's row again every minute so it doesn't go stale on screen.
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
  hand: vi.fn(),
  stopServer: vi.fn(),
  plan: vi.fn(),
  refresh: vi.fn(),
  stop: vi.fn(),
  retry: vi.fn(),
  toastError: vi.fn(),
  /** What the leave warning was last told. */
  leave: { active: false },
  runner: null as unknown as Runner,
  job: null as unknown as GenerationJobView,
  /** The real confirm (its own tests) or the studio's stand-in. */
  realConfirm: false,
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
vi.mock("@/components/billing/upgrade-modal-provider", () => ({ useUpgradeModal: () => ({ open: vi.fn() }) }));
vi.mock("@/components/ai/use-leave-warning", () => ({
  useLeaveWarning: (active: boolean) => {
    h.leave.active = active;
  },
}));
vi.mock("@/lib/tools/track-client", () => ({ trackToolEvent: h.track }));
vi.mock("@/lib/tools/re-art/actions", () => ({
  startReartAction: vi.fn(),
  saveReartStyleAction: vi.fn(),
  restoreReartArtAction: vi.fn(),
  planReartAction: h.plan,
}));
vi.mock("@/lib/tools/re-art/background-actions", () => ({ handReartRunToServerAction: h.hand }));
// Stop is a plain request (keepalive), never a server action.
vi.mock("@/lib/tools/re-art/background-client", () => ({ requestReartBackgroundStop: h.stopServer }));
vi.mock("@/components/tools/bulk-customize/use-bulk-runner", () => ({
  useBulkRunner: (job: GenerationJobView | null) =>
    job
      ? { ...h.runner, stop: h.stop, retryFailed: h.retry }
      : { steps: [], running: false, waitingUntil: null, stoppedBy: null, error: null, paused: false, runsEnded: 0, stop: h.stop, retryFailed: h.retry },
}));
vi.mock("@/components/tools/bulk-customize/bulk-progress", () => ({
  BulkProgress: ({ runner }: { runner: { stop: () => void; retryFailed: () => void } }) => (
    <div data-testid="progress">
      <button type="button" onClick={runner.stop}>
        panel stop
      </button>
      <button type="button" onClick={runner.retryFailed}>
        panel again
      </button>
    </div>
  ),
}));
vi.mock("@/components/tools/re-art/reart-style-panel", () => ({ ReartStylePanel: () => null }));
vi.mock("@/components/tools/re-art/reart-card-words-dialog", () => ({ ReartCardWordsDialog: () => null }));
vi.mock("@/components/tools/re-art/reart-run-list", () => ({ ReartRunList: () => null }));
vi.mock("@/components/tools/re-art/reart-card-grid", () => ({
  ReartCardGrid: ({
    entries,
    onPaintOne,
    selection,
  }: {
    entries: ReartStudioEntry[];
    onPaintOne: (entry: ReartStudioEntry) => void;
    selection?: { onPaint: (picked: ReartStudioEntry[]) => void };
  }) => (
    <div>
      <button type="button" onClick={() => onPaintOne(entries[0])}>
        paint one
      </button>
      <button type="button" onClick={() => selection?.onPaint(entries)}>
        paint selected
      </button>
    </div>
  ),
}));
// The studio's confirm: the tick box as the studio hands it over, and a
// Paint that starts the run (the real dialog is tested by itself below).
vi.mock("@/components/tools/re-art/reart-confirm-dialog", async (original) => {
  const real = await original<typeof import("@/components/tools/re-art/reart-confirm-dialog")>();
  type Props = Parameters<typeof real.ReartConfirmDialog>[0];
  return {
    ReartConfirmDialog: (props: Props) => {
      if (h.realConfirm) return <real.ReartConfirmDialog {...props} />;
      if (!props.open) return null;
      return (
        <div role="dialog" aria-label={props.title} data-background={props.background ? String(props.background.checked) : "none"}>
          {props.background ? (
            <input type="checkbox" aria-label="keep painting" checked={props.background.checked} onChange={(event) => props.background!.onChange(event.target.checked)} />
          ) : null}
          <button type="button" onClick={() => props.onStarted(h.job, [], 1)}>
            confirm paint
          </button>
        </div>
      );
    },
  };
});

import { ReartStudio } from "@/components/tools/re-art/reart-studio";
import { ReartConfirmDialog } from "@/components/tools/re-art/reart-confirm-dialog";
import {
  REART_BACKGROUND_HELP,
  REART_BACKGROUND_LABEL,
  REART_BACKGROUND_ON_COPY,
  REART_BACKGROUND_STALE_MS,
  REART_BACKGROUND_STOP_FAILED,
  REART_BACKGROUND_UNAVAILABLE,
} from "@/lib/tools/re-art/model";

const DECK = "00000000-0000-4000-8000-0000000000d1";
const JOB = "00000000-0000-4000-8000-00000000a001";
const E = (n: number) => `00000000-0000-4000-8000-0000000000e${n}`;
const SAVED = { preset: "watercolor", theme: "a haunted fen", mode: "preset" as const, prompt: "", version: 1 };

const entry = (n: number): ReartStudioEntry => ({
  id: E(n),
  name: `Card ${n}`,
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
  flavorText: null,
  credits: 1,
  paintedBy: null,
  restyled: false,
});
const step = (key: number, status: JobStep["status"] = "pending"): JobStep => ({ key: `reart:${key}`, label: `Card ${key}`, status });
const jobOf = (steps: JobStep[]): GenerationJobView => ({
  id: JOB,
  owner_id: "u1",
  kind: "deck_reart",
  status: "generating",
  request: { sample: false, reroll: false },
  steps,
  deck_id: null,
  error: null,
});
const runnerOf = (steps: JobStep[], over: Partial<Runner> = {}): Runner => ({
  steps,
  running: true,
  waitingUntil: null,
  stoppedBy: null,
  error: null,
  paused: false,
  runsEnded: 0,
  ...over,
});
const carriedRow = (over: Partial<ReartBackground> = {}): ReartBackground => ({ jobId: JOB, state: "running", reason: null, beatAt: new Date().toISOString(), ...over });

function studio(over: { pausedRunId?: string | null; background?: ReartBackground | null } = {}) {
  return (
    <ReartStudio
      deck={{ id: DECK, slug: "embers", title: "Embers of the Fen" }}
      storedStyle={SAVED}
      entries={[entry(1), entry(2), entry(3)]}
      username="dev_pro"
      capacity={null}
      balance={20}
      aiAvailable
      pausedRunId={over.pausedRunId ?? null}
      background={over.background ?? null}
      runs={[]}
    />
  );
}

const STEPS = [step(0), step(1), step(2)];
const dialog = () => screen.getByRole("dialog");
const banner = () => screen.queryByText(REART_BACKGROUND_ON_COPY);
const press = async (text: string) => {
  await act(async () => {
    fireEvent.click(screen.getByText(text));
  });
};

/** "Re-art the deck…", then the confirm's Paint — the box as `keep` says. */
async function startDeckRun(keep = true) {
  h.runner = runnerOf(STEPS);
  h.job = jobOf(STEPS);
  const view = render(studio());
  await press("Re-art the deck…");
  if (!keep) {
    await act(async () => {
      fireEvent.click(screen.getByLabelText("keep painting"));
    });
  }
  await press("confirm paint");
  return view;
}

beforeEach(() => {
  for (const fn of [h.track, h.hand, h.stopServer, h.plan, h.refresh, h.stop, h.retry, h.toastError]) fn.mockReset();
  h.leave.active = false;
  h.realConfirm = false;
  h.hand.mockResolvedValue({ ok: true, state: "started" });
  h.stopServer.mockResolvedValue(true);
  vi.stubGlobal("requestAnimationFrame", (run: () => void) => {
    run();
    return 0;
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the confirm's tick box", () => {
  const planned = (lines: number) => ({
    ok: true,
    lines: Array.from({ length: lines }, (_, index) => ({ entryId: E(index + 1), name: `Card ${index + 1}`, kind: "own", credits: 1, notes: [] })),
    skipped: [],
    inStyle: 0,
    locked: 0,
    styleChanged: false,
    cost: { cards: lines, makes: 0, credits: lines, slotsLeftAfter: null },
    capacity: null,
    balance: 20,
    aiAvailable: true,
  });
  const open = async (background: { checked: boolean; onChange: (next: boolean) => void } | undefined, lines = 3) => {
    h.realConfirm = true;
    h.plan.mockResolvedValue(planned(lines));
    await act(async () => {
      render(
        <ReartConfirmDialog
          open
          onOpenChange={() => undefined}
          input={{ deckId: DECK, scope: "all", visibility: "private" } as ReartRunInput}
          title="Re-art Embers of the Fen"
          description="Nothing is charged until you press Paint."
          background={background}
          onStarted={() => undefined}
        />,
      );
    });
  };

  it("is offered with its label and what it means — said before the run starts — and reports a change", async () => {
    const onChange = vi.fn();
    await open({ checked: true, onChange });
    const box = screen.getByLabelText(new RegExp(`^${REART_BACKGROUND_LABEL}`)) as HTMLInputElement;
    expect(box.type).toBe("checkbox");
    expect(box.checked).toBe(true);
    expect(dialog().textContent).toContain(REART_BACKGROUND_HELP);
    fireEvent.click(box);
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it("the words promise no more than the feature does: about an hour, a pause after it, the bell", () => {
    expect(REART_BACKGROUND_HELP).toMatch(/up to about an hour/);
    expect(REART_BACKGROUND_HELP).toMatch(/pauses and continues when you open this page again/);
    expect(REART_BACKGROUND_HELP).toMatch(/told in the bell/);
    expect(REART_BACKGROUND_ON_COPY).toMatch(/^You can close this page/);
    expect(REART_BACKGROUND_ON_COPY).toMatch(/up to about an hour/);
    expect(REART_BACKGROUND_UNAVAILABLE).toMatch(/paints while this page stays open/);
  });

  it("is not shown where the studio offers none, or for a run that paints nothing", async () => {
    await open(undefined);
    expect(screen.queryByLabelText(new RegExp(REART_BACKGROUND_LABEL))).toBeNull();
    cleanup();
    await open({ checked: true, onChange: vi.fn() }, 0);
    expect(screen.queryByLabelText(new RegExp(REART_BACKGROUND_LABEL))).toBeNull();
  });
});

describe("which runs offer it", () => {
  it("the deck's run and a selection do, ticked; a one-card paint does not", async () => {
    h.runner = runnerOf(STEPS);
    h.job = jobOf(STEPS);
    render(studio());
    await press("Re-art the deck…");
    expect(dialog().getAttribute("data-background")).toBe("true");
    cleanup();
    render(studio());
    await press("paint selected");
    expect(dialog().getAttribute("aria-label")).toBe("Paint 3 selected cards");
    expect(dialog().getAttribute("data-background")).toBe("true");
    cleanup();
    render(studio());
    await press("paint one");
    expect(dialog().getAttribute("data-background")).toBe("none");
  });

  it("a one-card paint is never handed over, whatever the box last said", async () => {
    h.runner = runnerOf([step(0)]);
    h.job = jobOf([step(0)]);
    render(studio());
    await press("paint one");
    await press("confirm paint");
    expect(screen.getByText("panel stop")).toBeTruthy();
    expect(h.hand).not.toHaveBeenCalled();
    expect(banner()).toBeNull();
    expect(h.leave.active).toBe(true);
  });
});

describe("a run started with the box ticked", () => {
  it("is handed to the server at once; the page then says it can be closed, and stops warning about leaving", async () => {
    await startDeckRun();
    // The run's FIRST hand-over (the server refuses it on a run already stopped).
    expect(h.hand.mock.calls).toEqual([[JOB, true]]);
    expect(banner()).toBeTruthy();
    expect(banner()!.getAttribute("role")).toBe("status");
    expect(h.leave.active).toBe(false);
    expect(h.toastError).not.toHaveBeenCalled();
  });

  it("until the server has taken it the page says nothing of the kind and still warns", async () => {
    let answer: (value: { ok: true; state: "started" }) => void = () => undefined;
    h.hand.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    await startDeckRun();
    expect(h.hand).toHaveBeenCalledTimes(1);
    expect(banner()).toBeNull();
    expect(h.leave.active).toBe(true);
    await act(async () => answer({ ok: true, state: "started" }));
    expect(banner()).toBeTruthy();
    expect(h.leave.active).toBe(false);
  });

  it("the box unticked: nothing is handed over — the run is the page's, and leaving is warned about as ever", async () => {
    await startDeckRun(false);
    expect(screen.getByText("panel stop")).toBeTruthy();
    expect(h.hand).not.toHaveBeenCalled();
    expect(banner()).toBeNull();
    expect(h.leave.active).toBe(true);
  });

  it("the box is remembered for the next run of the visit", async () => {
    const view = await startDeckRun(false);
    h.runner = runnerOf([step(0, "done"), step(1, "done"), step(2, "done")], { running: false, runsEnded: 1 });
    act(() => view.rerender(studio()));
    await press("Re-art the deck…");
    expect(dialog().getAttribute("data-background")).toBe("false");
  });

  it("a hand-over the server refuses is SAID, and the run stays the page's alone", async () => {
    h.hand.mockResolvedValue({ ok: false, error: REART_BACKGROUND_UNAVAILABLE });
    await startDeckRun();
    expect(h.toastError).toHaveBeenCalledWith(REART_BACKGROUND_UNAVAILABLE);
    expect(banner()).toBeNull();
    expect(h.leave.active).toBe(true);
    // The run itself goes on.
    expect(screen.getByText("panel stop")).toBeTruthy();
  });

  it("…and so is one that never answered", async () => {
    h.hand.mockRejectedValue(new Error("network"));
    await startDeckRun();
    expect(h.toastError).toHaveBeenCalledWith(REART_BACKGROUND_UNAVAILABLE);
    expect(banner()).toBeNull();
    expect(h.leave.active).toBe(true);
  });
});

describe("Stop, and trying again", () => {
  it("Stop means stop: the server's part of the run is told to end too, and the page no longer says it can be closed", async () => {
    await startDeckRun();
    await press("panel stop");
    expect(h.stop).toHaveBeenCalledTimes(1);
    expect(h.stopServer.mock.calls).toEqual([[JOB]]);
    expect(banner()).toBeNull();
    expect(h.track.mock.calls.find((call) => call[1] === "stop")![2]).toEqual({ painted: 0, failed: 0, waiting: 3, carried: true });
  });

  it("until the server has ANSWERED the Stop the page keeps warning about leaving — and reads the run again once it has", async () => {
    let answer: (ok: boolean) => void = () => undefined;
    h.stopServer.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    const view = await startDeckRun();
    await press("panel stop");
    // The page's own part is over (paused), the server's not yet known to be.
    h.runner = runnerOf([step(0, "done"), step(1), step(2)], { running: false, paused: true, runsEnded: 1 });
    act(() => view.rerender(studio()));
    expect(h.leave.active).toBe(true);
    h.refresh.mockClear();
    await act(async () => answer(true));
    expect(h.leave.active).toBe(false);
    expect(h.refresh).toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("a Stop the server did not acknowledge is SAID — it may still be painting — with a way to ask again", async () => {
    h.stopServer.mockResolvedValue(false);
    const view = await startDeckRun();
    await press("panel stop");
    h.runner = runnerOf([step(0, "done"), step(1), step(2)], { running: false, paused: true, runsEnded: 1 });
    act(() => view.rerender(studio()));
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain(REART_BACKGROUND_STOP_FAILED);
    // Asked again, and it lands: the alert goes — and the focus, whose
    // button went with it, is handed to the run's heading.
    h.stopServer.mockResolvedValue(true);
    await press("Stop it");
    expect(h.stopServer.mock.calls).toEqual([[JOB], [JOB]]);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "The run is paused" }));
  });

  it("Stop pressed while the hand-over is still on its way: the server's part is taken back when the answer arrives — it never paints on after a Stop", async () => {
    let answer: (value: { ok: true; state: "started" }) => void = () => undefined;
    h.hand.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    const view = await startDeckRun();
    await press("panel stop");
    // Asked at once (there may be a server part)…
    expect(h.stopServer.mock.calls).toEqual([[JOB]]);
    // …and although that Stop was answered, it is not OVER while the
    // hand-over is still on its way: the page goes on warning about leaving.
    h.runner = runnerOf([step(0, "done"), step(1), step(2)], { running: false, paused: true, runsEnded: 1 });
    act(() => view.rerender(studio()));
    expect(h.leave.active).toBe(true);
    await act(async () => answer({ ok: true, state: "started" }));
    // The hand-over had landed after all: taken back.
    expect(h.stopServer.mock.calls).toEqual([[JOB], [JOB]]);
    expect(banner()).toBeNull();
    expect(h.leave.active).toBe(false);
    expect(h.toastError).not.toHaveBeenCalled();
  });

  it("…and when the server refused that late hand-over (it found the Stop), the Stop is simply over: no second request, no error", async () => {
    let answer: (value: { ok: false; error: string }) => void = () => undefined;
    h.hand.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    const view = await startDeckRun();
    await press("panel stop");
    h.runner = runnerOf([step(0, "done"), step(1), step(2)], { running: false, paused: true, runsEnded: 1 });
    act(() => view.rerender(studio()));
    expect(h.leave.active).toBe(true);
    await act(async () => answer({ ok: false, error: REART_BACKGROUND_UNAVAILABLE }));
    expect(h.stopServer.mock.calls).toEqual([[JOB]]);
    expect(h.leave.active).toBe(false);
    expect(h.toastError).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("…and a hand-over that never answered is stopped once more, to be sure", async () => {
    let fail: (reason: Error) => void = () => undefined;
    h.hand.mockReturnValue(new Promise((_resolve, reject) => (fail = reject)));
    await startDeckRun();
    await press("panel stop");
    await act(async () => fail(new Error("network")));
    expect(h.stopServer.mock.calls).toEqual([[JOB], [JOB]]);
    expect(h.toastError).not.toHaveBeenCalled();
  });

  it("Stop ends the server's part even when the page no longer believes the run is carried (its last read went stale)", async () => {
    h.runner = runnerOf(STEPS);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ json: async () => ({ ok: true, job: jobOf(STEPS) }) })),
    );
    let view!: ReturnType<typeof render>;
    await act(async () => {
      view = render(studio({ pausedRunId: JOB, background: carriedRow() }));
    });
    const quiet = carriedRow({ beatAt: new Date(Date.now() - REART_BACKGROUND_STALE_MS - 1_000).toISOString() });
    await act(async () => view.rerender(studio({ pausedRunId: JOB, background: quiet })));
    expect(banner()).toBeNull();
    await press("panel stop");
    expect(h.stopServer.mock.calls).toEqual([[JOB]]);
  });

  it("a run the server isn't carrying stops as it always did: no server call", async () => {
    await startDeckRun(false);
    await press("panel stop");
    expect(h.stop).toHaveBeenCalledTimes(1);
    expect(h.stopServer).not.toHaveBeenCalled();
    expect(h.track.mock.calls.find((call) => call[1] === "stop")![2]).toEqual({ painted: 0, failed: 0, waiting: 3, carried: false });
  });

  it("trying FAILED cards again is the page's own: a finished run is not handed over again (the server asks for waiting cards only) — and the page does NOT say it can be closed while it retries", async () => {
    const view = await startDeckRun();
    expect(banner()).toBeTruthy();
    h.runner = runnerOf([step(0, "done"), step(1, "failed"), step(2, "done")], { running: false, runsEnded: 1 });
    act(() => view.rerender(studio()));
    h.hand.mockClear();
    await press("panel again");
    expect(h.retry).toHaveBeenCalledTimes(1);
    expect(h.hand).not.toHaveBeenCalled();
    // The retry is under way: closing the page would stop it.
    h.runner = runnerOf([step(0, "done"), step(1, "running"), step(2, "done")], { running: true, runsEnded: 1 });
    act(() => view.rerender(studio()));
    expect(banner()).toBeNull();
    expect(h.leave.active).toBe(true);
  });

  it("continuing a run that was handed over hands it over again; one that never was is not", async () => {
    const view = await startDeckRun();
    await press("panel stop");
    h.runner = runnerOf([step(0, "done"), step(1), step(2)], { running: false, paused: true, runsEnded: 1 });
    act(() => view.rerender(studio()));
    h.hand.mockClear();
    await press("panel again");
    expect(h.retry).toHaveBeenCalledTimes(1);
    // Continue's hand-over: the maker asking for it (not a first one).
    expect(h.hand.mock.calls).toEqual([[JOB, false]]);
    cleanup();
    h.hand.mockClear();
    h.retry.mockClear();
    const other = await startDeckRun(false);
    h.runner = runnerOf([step(0, "done"), step(1), step(2)], { running: false, paused: true, runsEnded: 1 });
    act(() => other.rerender(studio()));
    await press("panel again");
    expect(h.retry).toHaveBeenCalledTimes(1);
    expect(h.hand).not.toHaveBeenCalled();
  });
});

describe("coming back to the page", () => {
  const steps = [step(0, "done"), step(1), step(2)];
  const serveJob = () =>
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ json: async () => ({ ok: true, job: jobOf(steps) }) })),
    );

  it("a run the server is carrying is shown going on at once — no “continue”, no second hand-over, no leave warning", async () => {
    h.runner = runnerOf(steps);
    serveJob();
    await act(async () => {
      render(studio({ pausedRunId: JOB, background: carriedRow() }));
    });
    expect(vi.mocked(fetch).mock.calls).toEqual([[`/api/ai/jobs/${JOB}`]]);
    expect(screen.getByText("panel stop")).toBeTruthy();
    expect(screen.queryByText("Continue it")).toBeNull();
    expect(banner()).toBeTruthy();
    expect(h.leave.active).toBe(false);
    expect(h.hand).not.toHaveBeenCalled();
    // Nobody pressed Continue: the log is told of none.
    expect(h.track.mock.calls.filter((call) => call[1] === "continue")).toEqual([]);
  });

  it("…once: a later render of the page does not attach again", async () => {
    h.runner = runnerOf(steps);
    serveJob();
    let view!: ReturnType<typeof render>;
    await act(async () => {
      view = render(studio({ pausedRunId: JOB, background: carriedRow() }));
    });
    await act(async () => view.rerender(studio({ pausedRunId: JOB, background: carriedRow() })));
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it("a run whose chain ended (the hour ran out) waits to be continued, as ever — and Continue hands it to the server again", async () => {
    h.runner = runnerOf(steps);
    serveJob();
    await act(async () => {
      render(studio({ pausedRunId: JOB, background: carriedRow({ state: "paused", reason: "expired" }) }));
    });
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    expect(screen.getByText("A run of this deck stopped with cards still to paint.")).toBeTruthy();
    await press("Continue it");
    expect(screen.getByText("panel stop")).toBeTruthy();
    expect(h.track.mock.calls.filter((call) => call[1] === "continue").map((call) => call[2])).toEqual([{ earlier_visit: true }]);
    expect(h.hand.mock.calls).toEqual([[JOB, false]]);
  });

  it("a row that says running but has been quiet too long is a broken chain: not attached to", async () => {
    h.runner = runnerOf(steps);
    serveJob();
    await act(async () => {
      render(studio({ pausedRunId: JOB, background: carriedRow({ beatAt: new Date(Date.now() - REART_BACKGROUND_STALE_MS - 1_000).toISOString() }) }));
    });
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    expect(screen.getByText("Continue it")).toBeTruthy();
    expect(banner()).toBeNull();
  });

  it("a paused run that was never handed over is continued without a hand-over", async () => {
    h.runner = runnerOf(steps);
    serveJob();
    await act(async () => {
      render(studio({ pausedRunId: JOB }));
    });
    await press("Continue it");
    expect(screen.getByText("panel stop")).toBeTruthy();
    expect(h.hand).not.toHaveBeenCalled();
    expect(h.leave.active).toBe(true);
  });

  it("a carried run that can't be read is left as a run to continue — no error toast for something nobody pressed", async () => {
    h.runner = runnerOf(steps);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ json: async () => ({ ok: false }) })),
    );
    await act(async () => {
      render(studio({ pausedRunId: JOB, background: carriedRow() }));
    });
    expect(h.toastError).not.toHaveBeenCalled();
    expect(screen.queryByText("panel stop")).toBeNull();
    expect(screen.getByText("Continue it")).toBeTruthy();
  });

  it("a run nobody has looked at lately is not said to be carried — where there is no cron the hand-over's own driver ends after a few minutes", async () => {
    h.runner = runnerOf(steps);
    serveJob();
    let view!: ReturnType<typeof render>;
    await act(async () => {
      view = render(studio({ pausedRunId: JOB, background: carriedRow() }));
    });
    expect(banner()).toBeTruthy();
    const quiet = carriedRow({ beatAt: new Date(Date.now() - REART_BACKGROUND_STALE_MS - 1_000).toISOString() });
    await act(async () => view.rerender(studio({ pausedRunId: JOB, background: quiet })));
    expect(banner()).toBeNull();
    expect(h.leave.active).toBe(true);
    // Looked at again: carried again.
    await act(async () => view.rerender(studio({ pausedRunId: JOB, background: carriedRow() })));
    expect(banner()).toBeTruthy();
    expect(h.leave.active).toBe(false);
  });

  it("while the server carries a run the page reads its row again every minute, even when no card lands", async () => {
    vi.useFakeTimers();
    try {
      await startDeckRun();
      expect(banner()).toBeTruthy();
      h.refresh.mockClear();
      await act(async () => {
        vi.advanceTimersByTime(59_000);
      });
      expect(h.refresh).not.toHaveBeenCalled();
      await act(async () => {
        vi.advanceTimersByTime(2_000);
      });
      expect(h.refresh).toHaveBeenCalledTimes(1);
      // A run the page paints alone is not polled.
      cleanup();
      await startDeckRun(false);
      h.refresh.mockClear();
      await act(async () => {
        vi.advanceTimersByTime(200_000);
      });
      expect(h.refresh).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("when the page's re-read says the server's part ended, the page stops saying it can be closed and warns about leaving again", async () => {
    h.runner = runnerOf(steps);
    serveJob();
    let view!: ReturnType<typeof render>;
    await act(async () => {
      view = render(studio({ pausedRunId: JOB, background: carriedRow() }));
    });
    expect(banner()).toBeTruthy();
    await act(async () => view.rerender(studio({ pausedRunId: JOB, background: carriedRow({ state: "paused", reason: "expired" }) })));
    expect(banner()).toBeNull();
    // The page is still painting the cards that are left.
    expect(screen.getByText("panel stop")).toBeTruthy();
    expect(h.leave.active).toBe(true);
  });
});
