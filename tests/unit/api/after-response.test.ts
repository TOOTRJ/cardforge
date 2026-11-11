import { afterEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// afterResponse: instrumentation runs once the response is on its way — never
// a database round trip a save or a download waits for, never able to fail
// one — and still runs where there is no request (a unit test, a script).
// ---------------------------------------------------------------------------

const s = vi.hoisted(() => ({ after: vi.fn() as ReturnType<typeof vi.fn> }));
vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({
  get after() {
    return s.after;
  },
}));

import { afterResponse } from "@/lib/api/after-response";

afterEach(() => vi.restoreAllMocks());

describe("afterResponse", () => {
  it("hands the task to after(): nothing runs during the request", async () => {
    s.after = vi.fn();
    const task = vi.fn(async () => {});
    afterResponse(task);
    expect(task).not.toHaveBeenCalled();
    expect(s.after).toHaveBeenCalledTimes(1);
    await (s.after.mock.calls[0][0] as () => Promise<void>)();
    expect(task).toHaveBeenCalledTimes(1);
  });

  it("outside a request scope (after() throws) the task runs now, unawaited", async () => {
    s.after = vi.fn(() => {
      throw new Error("`after` was called outside a request scope.");
    });
    const task = vi.fn(async () => {});
    expect(() => afterResponse(task)).not.toThrow();
    expect(task).toHaveBeenCalledTimes(1);
  });

  it("a task that fails is logged and goes nowhere — in either mode", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    s.after = vi.fn();
    afterResponse(async () => {
      throw new Error("funnel write failed");
    });
    await expect((s.after.mock.calls[0][0] as () => Promise<void>)()).resolves.toBeUndefined();

    s.after = vi.fn(() => {
      throw new Error("no request scope");
    });
    afterResponse(() => {
      throw new Error("sync failure");
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(warn).toHaveBeenCalledTimes(2);
    expect(String(warn.mock.calls[0][1])).toBe("funnel write failed");
  });
});
