import { beforeEach, describe, expect, it, vi } from "vitest";

const { spendCredits, refundCredits } = vi.hoisted(() => ({
  spendCredits: vi.fn(),
  refundCredits: vi.fn(async () => undefined),
}));
vi.mock("@/lib/ai/rate-limit", () => ({ spendCredits, refundCredits }));

import { withCreditedStep } from "@/lib/ai/credited-step";
import type { JobStep } from "@/lib/ai/generation-jobs";

// ---------------------------------------------------------------------------
// withCreditedStep — the contract the reconcile-credits cron relies on:
//   * a charged success stamps spend_ref = the reserving ref,
//   * a failure (result or throw) refunds under refund:{ref} and clears it,
//   * an UNCHARGED reserve (admin, billing off) is never refunded — that
//     would mint credits (grant_credits has no matching-spend check).
// ---------------------------------------------------------------------------

const USER = "00000000-0000-4000-8000-000000000001";
const JOB = "11111111-1111-4111-8111-111111111111";
const STEP: JobStep = { key: "card:0", status: "running", label: "Card 1" } as JobStep;
const REF = /^spend:11111111-1111-4111-8111-111111111111:card:0:[0-9a-f-]{36}$/;

beforeEach(() => {
  spendCredits.mockReset();
  refundCredits.mockClear();
});

describe("withCreditedStep", () => {
  it("fails the step without running the body when the reserve is refused", async () => {
    spendCredits.mockResolvedValue({ ok: false, reason: "insufficient_credits", balance: 0, message: "Out of credits." });
    const body = vi.fn();
    const result = await withCreditedStep(USER, JOB, 1, "spend:card", STEP, body);
    // An empty balance is a plan limit the runner stops on (credits modal);
    // an infra hiccup carries no code and stays retryable.
    expect(result).toMatchObject({ status: "failed", error: "Out of credits.", error_code: "INSUFFICIENT_CREDITS" });
    expect(body).not.toHaveBeenCalled();
    expect(refundCredits).not.toHaveBeenCalled();
    spendCredits.mockResolvedValue({ ok: false, reason: "error", balance: Number.NaN, message: "Try again." });
    expect((await withCreditedStep(USER, JOB, 1, "spend:card", STEP, body)).error_code).toBeUndefined();
  });

  it("reserves with a unique ref, fail-closed, and stamps it onto a charged success", async () => {
    spendCredits.mockResolvedValue({ ok: true, balance: 4, charged: true });
    const result = await withCreditedStep(USER, JOB, 1, "spend:card", STEP, async () => ({
      ...STEP,
      status: "done",
    }));
    const [amount, reason, options] = spendCredits.mock.calls[0] as [number, string, { failClosed: boolean; ref: string }];
    expect([amount, reason, options.failClosed]).toEqual([1, "spend:card", true]);
    expect(options.ref).toMatch(REF);
    expect(result.spend_ref).toBe(options.ref);
    expect(refundCredits).not.toHaveBeenCalled();
  });

  it("refunds a charged reserve under refund:{ref} when the body reports failure", async () => {
    spendCredits.mockResolvedValue({ ok: true, balance: 4, charged: true });
    const result = await withCreditedStep(USER, JOB, 1, "spend:card", STEP, async () => ({
      ...STEP,
      status: "failed",
      error: "paint failed",
    }));
    const ref = (spendCredits.mock.calls[0] as [number, string, { ref: string }])[2].ref;
    expect(refundCredits).toHaveBeenCalledWith(USER, 1, "spend:card", `refund:${ref}`);
    expect(result).toMatchObject({ status: "failed", spend_ref: null });
  });

  it("refunds and rethrows when the body throws", async () => {
    spendCredits.mockResolvedValue({ ok: true, balance: 4, charged: true });
    await expect(
      withCreditedStep(USER, JOB, 1, "spend:card", STEP, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(refundCredits).toHaveBeenCalledTimes(1);
  });

  it("never refunds an uncharged reserve, and leaves no spend_ref on it", async () => {
    spendCredits.mockResolvedValue({ ok: true, balance: Number.POSITIVE_INFINITY, charged: false });
    const failed = await withCreditedStep(USER, JOB, 1, "spend:card", STEP, async () => ({
      ...STEP,
      status: "failed",
      error: "x",
    }));
    const done = await withCreditedStep(USER, JOB, 1, "spend:card", { ...STEP, spend_ref: "stale" }, async () => ({
      ...STEP,
      status: "done",
      spend_ref: "stale",
    }));
    expect(refundCredits).not.toHaveBeenCalled();
    expect(failed.spend_ref).toBeNull();
    expect(done.spend_ref).toBeNull();
  });
});
