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

import { GenerationDetailsDialog } from "@/components/ai/generation-details-dialog";
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
