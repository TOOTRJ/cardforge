// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { GenerationJobStep } from "@/components/ai/use-generation-job";
import { DECK_AI_PAUSED_MESSAGE, isDeckAiRetryPaused } from "@/lib/ai/deck-ai-pause";

// ---------------------------------------------------------------------------
// The AI deck pause, on the runner's side (TODO DK1 follow-up, owner D6):
// since #647 the step route refuses a re-run of a deck or deck-restyle job's
// FAILED step (DECK_AI_PAUSED). The runner must not offer what the server
// refuses: for those jobs the details show no Retry and say ONCE, in the deck
// pages' words, that deck AI is paused; the widget says "tap for details",
// never "tap to retry"; a programmatic retry posts nothing. Steps still open
// finish (D6). Card jobs keep their Retry.
// ---------------------------------------------------------------------------

const toast = vi.hoisted(() => ({
  info: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
  message: vi.fn(),
}));
vi.mock("sonner", () => ({ toast }));
vi.mock("@/components/billing/upgrade-modal-provider", () => ({
  useUpgradeModal: () => ({ open: vi.fn() }),
}));
vi.mock("@/components/billing/credit-confirm-provider", () => ({
  useCreditConfirm: () => async () => true,
}));
vi.mock("@/components/ai/use-leave-warning", () => ({ useLeaveWarning: () => {} }));

import { GenerationDetailsDialog, pausedFailedStepMessage } from "@/components/ai/generation-details-dialog";
import { GenerationJobProvider } from "@/components/ai/generation-provider";
import { useGenerationJob } from "@/components/ai/use-generation-job";

const stats = { startedAt: null, completions: [], concurrency: 3 };
const failedRun: GenerationJobStep[] = [
  { key: "card:0", label: "Ashen Duke", status: "done" },
  { key: "card:1", label: "Veiled Nymph", status: "failed", error: "x", failure: "art_busy", refunded: 1 },
  { key: "card:2", label: "Slow Wyrm", status: "failed", error: "x", failure: "art_busy", refunded: 1 },
];

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  for (const fn of Object.values(toast)) fn.mockReset();
});

describe("which jobs are paused", () => {
  it("a deck build and a deck restyle, never a card job", () => {
    expect(isDeckAiRetryPaused("deck")).toBe(true);
    expect(isDeckAiRetryPaused("deck_remix")).toBe(true);
    for (const kind of ["card", "card_remix", "card_fill", undefined]) {
      expect(isDeckAiRetryPaused(kind)).toBe(false);
    }
  });
});

describe("the generation details", () => {
  const dialog = (retryPaused?: boolean) =>
    render(
      <GenerationDetailsDialog
        open
        onOpenChange={() => {}}
        label="Generating deck cards"
        phase="done"
        steps={failedRun}
        stats={stats}
        onRetryStep={() => {}}
        onRetryFailed={() => {}}
        retryPaused={retryPaused}
      />,
    );

  it("a paused deck job: no Retry anywhere, and the paused line ONCE", () => {
    dialog(true);
    expect(screen.queryByRole("button", { name: /retry/i })).toBeNull();
    expect(screen.getAllByText(DECK_AI_PAUSED_MESSAGE)).toHaveLength(1);
    expect(screen.getByText("Finished with some failures.")).toBeTruthy();
    expect(screen.queryByText(/retry them below/)).toBeNull();
  });

  it("a paused deck job's failed rows say what happened and the credit, never “try again”", () => {
    dialog(true);
    const rows = screen.getAllByRole("listitem");
    expect(rows[1].textContent).toContain("The image service is busy right now. Your credit was returned.");
    for (const row of rows) expect(row.textContent).not.toMatch(/try again/i);
  });

  it("any other job keeps the full line, its advice included", () => {
    dialog();
    expect(screen.getAllByRole("listitem")[1].textContent).toContain(
      "The image service is busy right now. Wait a minute, then try again. Your credit was returned.",
    );
  });

  it("any other job keeps a Retry per failed step and Retry all failed, with no paused line", () => {
    dialog();
    expect(screen.getAllByRole("button", { name: "Retry" })).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Retry all failed" })).toBeTruthy();
    expect(screen.queryByText(DECK_AI_PAUSED_MESSAGE)).toBeNull();
    expect(screen.getByText(/retry them below/)).toBeTruthy();
  });

  it("while the job runs neither shows: nothing to retry yet", () => {
    render(
      <GenerationDetailsDialog
        open
        onOpenChange={() => {}}
        label="Generating deck cards"
        phase="stepping"
        steps={[...failedRun, { key: "card:3", label: "Late Lark", status: "running" }]}
        stats={stats}
        onRetryStep={() => {}}
        onRetryFailed={() => {}}
        retryPaused
      />,
    );
    expect(screen.queryByRole("button", { name: /retry/i })).toBeNull();
    expect(screen.queryByText(DECK_AI_PAUSED_MESSAGE)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The provider: a job from an earlier visit with one step still open and one
// failed is picked up by the auto-resume (GET /api/ai/jobs); its open step
// runs, the failed one stays.
// ---------------------------------------------------------------------------

function jobOf(kind: string, steps: GenerationJobStep[]) {
  return { id: "job-1", kind, status: "generating", steps, request: { deck_slug: "kesh/gorgons" } };
}

function stubServer(kind: string) {
  const resumable = jobOf(kind, [
    { key: "card:0", label: "Ashen Duke", status: "failed", error: "x", failure: "art_busy", refunded: 1 },
    { key: "card:1", label: "Veiled Nymph", status: "pending" },
  ]);
  const stepPosts: Array<string | undefined> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/ai/jobs" && (!init?.method || init.method === "GET")) {
        return new Response(JSON.stringify({ ok: true, job: resumable }));
      }
      if (url === "/api/ai/jobs/job-1/step") {
        const key = (JSON.parse(String(init?.body ?? "{}")) as { step?: string }).step;
        stepPosts.push(key);
        const done = jobOf(kind, [
          resumable.steps[0],
          { key: "card:1", label: "Veiled Nymph", status: "done", card_id: "c-1" },
        ]);
        return new Response(JSON.stringify({ ok: true, job: { ...done, status: "done_with_errors" } }));
      }
      return new Response(JSON.stringify({ ok: false }), { status: 404 });
    }),
  );
  return stepPosts;
}

/** A panel asking for the failed steps again, the way a caller of
 *  `retryFailed` would. */
function RetryHandle() {
  const { retryFailed } = useGenerationJob();
  return (
    <button type="button" data-testid="ask-failed-again" onClick={() => void retryFailed()}>
      test: run the failed steps
    </button>
  );
}

async function resumeAndSettle() {
  render(
    <GenerationJobProvider>
      <RetryHandle />
    </GenerationJobProvider>,
  );
  await waitFor(() => expect(screen.getByText(/1 step failed/)).toBeTruthy());
}

describe("the runner", () => {
  it("a deck job: its open step still runs (D6); the widget promises no retry and the details show none", async () => {
    const posts = stubServer("deck");
    await resumeAndSettle();
    expect(posts).toEqual(["card:1"]);
    expect(screen.getByText(/1 step failed — tap for details\./)).toBeTruthy();
    expect(screen.queryByText(/tap to retry/)).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /open details/ }));
    });
    expect(screen.queryByRole("button", { name: /retry/i })).toBeNull();
    expect(screen.getAllByText(DECK_AI_PAUSED_MESSAGE)).toHaveLength(1);

    // A retry asked for anyway posts nothing and says why, once.
    await act(async () => {
      fireEvent.click(screen.getByTestId("ask-failed-again"));
    });
    expect(posts).toEqual(["card:1"]);
    expect(toast.message).toHaveBeenCalledWith(DECK_AI_PAUSED_MESSAGE);
  });

  it("a deck restyle job is paused the same way", async () => {
    stubServer("deck_remix");
    await resumeAndSettle();
    expect(screen.getByText(/1 step failed — tap for details\./)).toBeTruthy();
  });

  it("a card job keeps its Retry", async () => {
    const posts = stubServer("card");
    await resumeAndSettle();
    expect(screen.getByText(/tap to retry/)).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /open details/ }));
    });
    expect(screen.getByRole("button", { name: "Retry all failed" })).toBeTruthy();
    expect(screen.queryByText(DECK_AI_PAUSED_MESSAGE)).toBeNull();
    expect(posts).toEqual(["card:1"]);
  });
});

describe("a paused deck job's line, without its advice", () => {
  it("keeps the first sentence and the credit sentence, whatever the failure", () => {
    expect(
      pausedFailedStepMessage({ key: "k", label: "L", status: "failed", error: "x", failure: "art_timeout", refund_pending: true }),
    ).toBe(
      "The image service is running slowly right now, so the artwork took too long. The credit it took comes back to you automatically within the hour.",
    );
    expect(pausedFailedStepMessage({ key: "k", label: "L", status: "failed", error: "x", failure: "design_failed" })).toBe(
      "The AI couldn't write this card. No credits were used.",
    );
    // An older step's own words that are nothing but advice.
    expect(pausedFailedStepMessage({ key: "k", label: "L", status: "failed", error: "Please try again later." })).toBe(
      "This card didn't finish. No credits were used.",
    );
  });
});

// ---------------------------------------------------------------------------
// The paused refusal INSIDE a run (the independent check of #654): a deck
// step the runner still holds open — pending, or running in another tab and
// polled — has FAILED on the server meanwhile, and its next post is refused
// with DECK_AI_PAUSED. It is posted no more, no network toast is shown, and
// it ends FAILED (as the server has it, else marked locally) — never left
// "running" behind "One step is still finishing…" and a resume toast that
// says the generation finished successfully.
// ---------------------------------------------------------------------------

const PAUSED_REFUSAL = {
  ok: false,
  code: "DECK_AI_PAUSED",
  error: `${DECK_AI_PAUSED_MESSAGE} No credits were used.`,
};

// The job's one open step is the refused one, so no other step's answer
// tells the runner what became of it.
function stubRefusal(opts: { first: "pending" | "running"; serverHasIt: boolean }) {
  const doneOne = { key: "card:1", label: "Veiled Nymph", status: "done", card_id: "c-1" } as const;
  const resumable = jobOf("deck", [{ key: "card:0", label: "Ashen Duke", status: opts.first }, doneOne]);
  const failedOnServer = { key: "card:0", label: "Ashen Duke", status: "failed", error: "x", failure: "art_busy", refunded: 1 } as const;
  const posts: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/ai/jobs" && (!init?.method || init.method === "GET")) {
        return new Response(JSON.stringify({ ok: true, job: resumable }));
      }
      if (url === "/api/ai/jobs/job-1" && opts.serverHasIt) {
        return new Response(JSON.stringify({ ok: true, job: jobOf("deck", [failedOnServer, doneOne]) }));
      }
      if (url === "/api/ai/jobs/job-1/step") {
        const key = (JSON.parse(String(init?.body ?? "{}")) as { step: string }).step;
        posts.push(key);
        if (key === "card:0") {
          // A running step is polled once (another tab holds it), then its
          // attempt fails there and the next post is refused.
          if (opts.first === "running" && posts.filter((k) => k === "card:0").length === 1) {
            return new Response(JSON.stringify({ ok: true, inFlight: true, job: resumable }));
          }
          return new Response(JSON.stringify(PAUSED_REFUSAL), { status: 403 });
        }
      }
      return new Response(JSON.stringify({ ok: false }), { status: 404 });
    }),
  );
  return posts;
}

async function expectFailedNotRunning() {
  expect(screen.getByText(/1 step failed — tap for details\./)).toBeTruthy();
  expect(screen.queryByText(/still finishing/)).toBeNull();
  expect(toast.error).not.toHaveBeenCalled();
  expect(toast.success).not.toHaveBeenCalledWith("Your AI generation from earlier finished successfully.");
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /open details/ }));
  });
  expect(screen.getAllByText(DECK_AI_PAUSED_MESSAGE)).toHaveLength(1);
  expect(screen.queryByRole("button", { name: /retry/i })).toBeNull();
}

describe("a deck step refused mid-run", () => {
  it("a pending step: posted exactly once, then shown failed as the server has it", async () => {
    const posts = stubRefusal({ first: "pending", serverHasIt: true });
    await resumeAndSettle();
    expect(posts).toEqual(["card:0"]);
    await expectFailedNotRunning();
    // The server's own failure, worded without its advice.
    expect(screen.getByText("The image service is busy right now. Your credit was returned.")).toBeTruthy();
  });

  it("a pending step whose job can't be read back: still marked failed, still posted once", async () => {
    const posts = stubRefusal({ first: "pending", serverHasIt: false });
    await resumeAndSettle();
    expect(posts).toEqual(["card:0"]);
    await expectFailedNotRunning();
  });

  it("a running step another tab held: polled, refused, and ends failed — not “still finishing”", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const posts = stubRefusal({ first: "running", serverHasIt: true });
    render(
      <GenerationJobProvider>
        <RetryHandle />
      </GenerationJobProvider>,
    );
    // The poll waits 15 s before posting the held step again.
    for (let i = 0; i < 20 && !screen.queryByText(/1 step failed/); i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
    }
    vi.useRealTimers();
    expect(posts).toEqual(["card:0", "card:0"]);
    await expectFailedNotRunning();
  });
});
