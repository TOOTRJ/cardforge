// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

// ---------------------------------------------------------------------------
// The compare page's re-bake loop (rebake-marked-store.ts) and its panel.
// Contract: one loop per tab; each round forwards the ids that failed so
// far; it stops at remaining 0, on no progress, or on an error; the panel
// hides when nothing is owed, offers "Re-bake now" when something is, shows
// progress, and refreshes the page once a run settles.
// ---------------------------------------------------------------------------

// The loop POSTs /api/admin/rebake-marked; `action` answers each call with
// the route's JSON body and records the skipIds it was sent.
const action = vi.hoisted(() => vi.fn());
vi.stubGlobal(
  "fetch",
  vi.fn(async (_url: string, init: { body: string }) => {
    const body = await action(JSON.parse(init.body));
    return new Response(JSON.stringify(body), { status: body.ok ? 200 : 412 });
  }),
);
const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import {
  __resetMarkedRebakeForTests,
  startMarkedRebake,
} from "@/components/admin/rebake-marked-store";
import { MarkedRendersPanel } from "@/components/admin/marked-renders-panel";

const A = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  action.mockReset();
  refresh.mockReset();
  __resetMarkedRebakeForTests();
});
afterEach(cleanup);

describe("startMarkedRebake", () => {
  it("loops until nothing remains, forwarding failed ids as skipIds", async () => {
    action
      .mockResolvedValueOnce({ ok: true, rebaked: 3, failed: [{ id: A, error: "art" }], superseded: 0, remaining: 4 })
      .mockResolvedValueOnce({ ok: true, rebaked: 4, failed: [], superseded: 0, remaining: 0 });
    const final = await startMarkedRebake();
    expect(action).toHaveBeenNthCalledWith(1, { skipIds: [] });
    expect(action).toHaveBeenNthCalledWith(2, { skipIds: [A] });
    expect(final).toMatchObject({ status: "done", rebaked: 7, remaining: 0 });
    expect(final.failed).toHaveLength(1);
  });

  it("stops on an error and on a round with no progress", async () => {
    action.mockResolvedValueOnce({ ok: false, error: "billing flag off" });
    expect(await startMarkedRebake()).toMatchObject({ status: "error", error: "billing flag off" });

    __resetMarkedRebakeForTests();
    action.mockReset();
    action.mockResolvedValue({ ok: true, rebaked: 0, failed: [], superseded: 0, remaining: 9 });
    const final = await startMarkedRebake();
    expect(action).toHaveBeenCalledTimes(1);
    expect(final.status).toBe("done");
  });

  it("keeps going while a mid-batch save supersedes rows, and stops on repeated all-failed rounds", async () => {
    action
      .mockResolvedValueOnce({ ok: true, rebaked: 0, failed: [], superseded: 2, remaining: 2 })
      .mockResolvedValueOnce({ ok: true, rebaked: 2, failed: [], superseded: 0, remaining: 0 });
    expect(await startMarkedRebake()).toMatchObject({ status: "done", rebaked: 2 });
    expect(action).toHaveBeenCalledTimes(2);

    __resetMarkedRebakeForTests();
    action.mockReset();
    action.mockResolvedValue({ ok: true, rebaked: 0, failed: [{ id: A, error: "storage quota exceeded" }], superseded: 0, remaining: 50 });
    const final = await startMarkedRebake();
    expect(action).toHaveBeenCalledTimes(2);
    expect(final).toMatchObject({ status: "error" });
    expect(final.error).toContain("storage quota exceeded");
  });

  it("does not start a second loop while one runs", async () => {
    let release: (v: unknown) => void = () => {};
    action.mockImplementationOnce(() => new Promise((r) => (release = r)));
    const first = startMarkedRebake();
    const second = await startMarkedRebake();
    expect(second.status).toBe("running");
    release({ ok: true, rebaked: 1, failed: [], superseded: 0, remaining: 0 });
    await first;
    expect(action).toHaveBeenCalledTimes(1);
  });
});

describe("MarkedRendersPanel", () => {
  it("renders nothing when no card is owed a re-bake", () => {
    const { container } = render(<MarkedRendersPanel initialCount={0} />);
    expect(container.innerHTML).toBe("");
  });

  it("offers Re-bake now, shows the result and refreshes once", async () => {
    action.mockResolvedValueOnce({ ok: true, rebaked: 12, failed: [], superseded: 0, remaining: 0 });
    render(<MarkedRendersPanel initialCount={12} />);
    expect(screen.getByTestId("marked-renders-panel").textContent).toContain("12 published cards are owed a re-bake");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /re-bake now/i }));
    });
    expect(screen.getByTestId("marked-renders-panel").textContent).toContain("Re-baked 12 cards.");
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("keeps Try again after a run that left failed cards", async () => {
    action.mockResolvedValueOnce({ ok: true, rebaked: 1, failed: [{ id: A, error: "Art unavailable" }], superseded: 0, remaining: 0 });
    render(<MarkedRendersPanel initialCount={2} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /re-bake now/i }));
    });
    expect(screen.getByTestId("marked-renders-panel").textContent).toContain("1 could not be re-baked");
    expect(screen.getByRole("button", { name: /try again/i })).toBeTruthy();
  });

  it("explains a stop and offers Try again", async () => {
    action.mockResolvedValueOnce({ ok: false, error: "This server has NEXT_PUBLIC_BILLING_ENABLED off" });
    render(<MarkedRendersPanel initialCount={3} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /re-bake now/i }));
    });
    expect(screen.getByTestId("marked-renders-panel").textContent).toContain("Re-bake stopped:");
    expect(screen.getByRole("button", { name: /try again/i })).toBeTruthy();
  });
});
