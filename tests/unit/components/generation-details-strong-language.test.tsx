// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { GenerationDetailsDialog } from "@/components/ai/generation-details-dialog";
import type { GenerationJobStep } from "@/components/ai/use-generation-job";
import {
  GENERATED_PRIVATE_STEP_NOTE,
  generatedPrivateInBatchMessage,
  generatedPrivateMessage,
} from "@/lib/moderation/profanity";

// ---------------------------------------------------------------------------
// An AI job whose card the save kept PRIVATE for the strong language in its
// text (owner policy 2026-10-28): the generation's details name every such
// card on its own row; the runner's one toast is worded by the same module.
// ---------------------------------------------------------------------------

afterEach(cleanup);

const steps: GenerationJobStep[] = [
  { key: "card:0", label: "Grim Tidings", status: "done", card_id: "c-0", forced_private: { reason: "profanity", fields: ["rules_text"] } },
  { key: "card:1", label: "Bright Dawn", status: "done", card_id: "c-1" },
];

describe("the generation details", () => {
  it("names the card saved private on its row, and only that one", () => {
    render(
      <GenerationDetailsDialog
        open
        onOpenChange={vi.fn()}
        label="Deck"
        phase="done"
        steps={steps}
        stats={{ startedAt: null, completions: [], concurrency: 3 }}
        onRetryStep={vi.fn()}
        onRetryFailed={vi.fn()}
      />,
    );
    const rows = screen.getAllByRole("listitem");
    expect(rows[0].textContent).toContain(GENERATED_PRIVATE_STEP_NOTE);
    expect(rows[1].textContent).not.toContain(GENERATED_PRIVATE_STEP_NOTE);
  });
});

describe("the runner's words", () => {
  it("a single card names the card and the field; a batch is told once", () => {
    expect(generatedPrivateMessage("Grim Tidings", ["rules_text"])).toBe(
      "“Grim Tidings” was saved as private — its rules text includes strong language. Remove it to publish.",
    );
    expect(generatedPrivateInBatchMessage("Grim Tidings")).toBe(
      "Cards whose text includes strong language were saved as private — “Grim Tidings” is one. The generation details list them all.",
    );
  });
});
