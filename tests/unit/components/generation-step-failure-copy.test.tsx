// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { GenerationProgress } from "@/components/ai/generation-progress";
import { GenerationDetailsDialog } from "@/components/ai/generation-details-dialog";
import type { GenerationJobStep } from "@/components/ai/use-generation-job";

// ---------------------------------------------------------------------------
// A deck run's failed steps say what the creator says (owner 2026-10-28,
// feat/ai-art-backup-and-scan): the failure's sentence AND what its credit
// did — lib/ai/failure.ts failedStepMessage — never the bare step error.
// ---------------------------------------------------------------------------

afterEach(cleanup);

const NUDITY = "This artwork was blocked by our nudity filter. Try again or change the prompt.";

const steps: GenerationJobStep[] = [
  { key: "card:0", label: "Ashen Duke", status: "done" },
  { key: "card:1", label: "Veiled Nymph", status: "failed", error: NUDITY, failure: "art_blocked", refunded: 1 },
  {
    key: "card:2",
    label: "Slow Wyrm",
    status: "failed",
    error: "The image service is running slowly right now, so the artwork took too long. Try again in a few minutes.",
    failure: "art_timeout",
    refunded: 0,
    refund_pending: true,
  },
];

describe("a deck run's failed steps", () => {
  it("the progress list words each failure with its credit", () => {
    render(<GenerationProgress steps={steps} phase="done" />);
    expect(screen.getByText(`${NUDITY} Your credit was returned.`)).toBeTruthy();
    expect(
      screen.getByText(/took too long\. Try again in a few minutes\. The credit it took comes back to you automatically within the hour\./),
    ).toBeTruthy();
  });

  it("the details dialog does the same", () => {
    render(
      <GenerationDetailsDialog
        open
        onOpenChange={() => {}}
        label="Deck"
        phase="done"
        steps={steps}
        stats={{ startedAt: null, completions: [], concurrency: 1 }}
        onRetryStep={() => {}}
        onRetryFailed={() => {}}
      />,
    );
    expect(screen.getByText(`${NUDITY} Your credit was returned.`)).toBeTruthy();
  });
});
