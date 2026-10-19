import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { refillActiveSubscribers, type CreditGrantClient } from "@/lib/billing/credit-refill";

// ---------------------------------------------------------------------------
// refillActiveSubscribers' failure reporting (2026-10-18): each failed grant
// is logged with its user id and error, and handed to `onGrantFailed`; the
// result, and every grant asked for, are what they were before.
// ---------------------------------------------------------------------------

const PERIOD = "2026-10";
const subscribers = ["ok-1", "bad-1", "ok-2", "bad-2"].map((id) => ({
  id,
  subscription_tier: "pro",
  subscription_status: "active",
  is_admin: false,
  created_at: "2026-01-01T00:00:00Z",
}));

function admin(failing: Set<string>, pageError?: string) {
  const grants: string[] = [];
  const client = {
    from: () => ({
      select: () => ({
        like: async () => ({ data: [], error: null }),
        order: () => ({
          range: async () =>
            pageError ? { data: null, error: { message: pageError } } : { data: subscribers, error: null },
        }),
      }),
    }),
    rpc: async (_fn: string, args: { p_user_id: string }) => {
      grants.push(args.p_user_id);
      return { error: failing.has(args.p_user_id) ? { message: `grant broke for ${args.p_user_id}` } : null };
    },
  } as unknown as CreditGrantClient;
  return { client, grants };
}

let errorLog: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => errorLog.mockRestore());

describe("refillActiveSubscribers — failures", () => {
  it("logs and reports each failed grant, and still tries every subscriber once", async () => {
    const { client, grants } = admin(new Set(["bad-1", "bad-2"]));
    const failed: Array<[string, string]> = [];
    const result = await refillActiveSubscribers(client, PERIOD, {
      onGrantFailed: (userId, error) => failed.push([userId, error]),
    });
    expect(result).toEqual({ ok: true, processed: 4, granted: 2, failed: 2 });
    expect(grants).toEqual(["ok-1", "bad-1", "ok-2", "bad-2"]);
    expect(failed).toEqual([
      ["bad-1", "grant broke for bad-1"],
      ["bad-2", "grant broke for bad-2"],
    ]);
    expect(errorLog.mock.calls.map((c: unknown[]) => c[0])).toEqual([
      "[refill-credits] grant failed for user bad-1 (pro, 2026-10): grant broke for bad-1",
      "[refill-credits] grant failed for user bad-2 (pro, 2026-10): grant broke for bad-2",
    ]);
  });

  it("works without a callback, and a clean sweep logs nothing", async () => {
    const { client } = admin(new Set());
    expect(await refillActiveSubscribers(client, PERIOD)).toEqual({ ok: true, processed: 4, granted: 4, failed: 0 });
    expect(errorLog).not.toHaveBeenCalled();
  });

  it("logs a failed page read", async () => {
    const { client } = admin(new Set(), "statement timeout");
    expect(await refillActiveSubscribers(client, PERIOD)).toEqual({ ok: false, error: "statement timeout" });
    expect(errorLog).toHaveBeenCalledWith("[refill-credits] profiles page read failed at row 0: statement timeout");
  });
});
