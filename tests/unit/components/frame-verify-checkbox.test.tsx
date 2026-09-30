// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

// ---------------------------------------------------------------------------
// The verify toggle (TODO 0.18) — the checkbox on the compare page, the
// checklist rows and the sign-off view. Ticking publishes the combo to every
// user's frame picker; unticking withdraws it. Contract: the box moves at
// once (optimistic) and is locked while the action runs; the action gets the
// combo, the new state and the reference printing on screen (what the tick
// records and scores); a refusal puts the box back and says why; the toast
// says what happened, including a tick recorded without a score.
// ---------------------------------------------------------------------------

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
const actions = vi.hoisted(() => ({ setFrameReviewAction: vi.fn() }));
vi.mock("@/lib/cards/frame-review-actions", () => ({
  setFrameReviewAction: actions.setFrameReviewAction,
}));

import { FrameVerifyCheckbox } from "@/components/admin/frame-verify-checkbox";

const REF = "308465a9-2143-49f2-b9d0-a09272dd1b62";

/** An action whose answer the test releases by hand. */
function deferredAction() {
  let resolve!: (value: unknown) => void;
  actions.setFrameReviewAction.mockImplementationOnce(
    () => new Promise((r) => {
      resolve = r;
    }),
  );
  return (value: unknown) => act(async () => resolve(value));
}

const box = () => screen.getByRole("checkbox", { name: "Mark lotr/u as verified" }) as HTMLInputElement;

beforeEach(() => {
  actions.setFrameReviewAction.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
});
afterEach(cleanup);

describe("FrameVerifyCheckbox", () => {
  it("shows the stored state, with the publish label only in the compare header", () => {
    const { rerender } = render(<FrameVerifyCheckbox template="lotr" colorKey="u" verified />);
    expect(box().checked).toBe(true);
    expect(screen.queryByText(/publish to all users/)).toBeNull();
    rerender(<FrameVerifyCheckbox template="lotr" colorKey="u" verified={false} withLabel />);
    expect(screen.getByText(/Frame renders near-perfectly — publish to all users/)).toBeTruthy();
  });

  it("ticks at once, locks while publishing, and records the reference on screen", async () => {
    const release = deferredAction();
    render(<FrameVerifyCheckbox template="lotr" colorKey="u" verified={false} referenceId={REF} withLabel />);

    fireEvent.click(box());
    expect(box().checked).toBe(true);
    await waitFor(() => expect(box().disabled).toBe(true));
    expect(actions.setFrameReviewAction).toHaveBeenCalledWith({
      template: "lotr",
      colorKey: "u",
      verified: true,
      referenceId: REF,
    });

    await release({ ok: true, scored: true });
    expect(box().checked).toBe(true);
    expect(box().disabled).toBe(false);
    expect(toast.success).toHaveBeenCalledWith("lotr/u verified — now available to all users.");
  });

  it("says so when the tick was recorded without an alignment score", async () => {
    actions.setFrameReviewAction.mockResolvedValueOnce({ ok: true, scored: false });
    render(<FrameVerifyCheckbox template="lotr" colorKey="u" verified={false} />);
    fireEvent.click(box());
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        "lotr/u verified — now available to all users. (Alignment score unavailable for the record.)",
      ),
    );
    // No reference on screen → null, never undefined.
    expect(actions.setFrameReviewAction).toHaveBeenCalledWith(expect.objectContaining({ referenceId: null }));
  });

  it("withdraws on untick", async () => {
    actions.setFrameReviewAction.mockResolvedValueOnce({ ok: true, scored: false });
    render(<FrameVerifyCheckbox template="lotr" colorKey="u" verified referenceId={REF} />);
    fireEvent.click(box());
    expect(box().checked).toBe(false);
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("lotr/u withdrawn from the picker."));
    expect(actions.setFrameReviewAction).toHaveBeenCalledWith(
      expect.objectContaining({ template: "lotr", colorKey: "u", verified: false }),
    );
    expect(box().checked).toBe(false);
  });

  it("puts the box back and says why when the server refuses", async () => {
    const release = deferredAction();
    render(<FrameVerifyCheckbox template="lotr" colorKey="u" verified={false} />);
    fireEvent.click(box());
    expect(box().checked).toBe(true);

    await release({ ok: false, error: "Not authorized." });
    expect(box().checked).toBe(false);
    expect(box().disabled).toBe(false);
    expect(toast.error).toHaveBeenCalledWith("Not authorized.");
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("a refused withdraw leaves the combo ticked", async () => {
    actions.setFrameReviewAction.mockResolvedValueOnce({ ok: false, error: "Admin key is not configured." });
    render(<FrameVerifyCheckbox template="lotr" colorKey="u" verified />);
    fireEvent.click(box());
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Admin key is not configured."));
    expect(box().checked).toBe(true);
  });
});
