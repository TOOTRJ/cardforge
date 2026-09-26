// @vitest-environment happy-dom
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";

// ---------------------------------------------------------------------------
// TODO 3b.7 — the creator's unsaved-changes guard pushes a sentinel history
// entry while the form is dirty (so browser Back can ask first). It was
// never taken off after a save: Back had to be pressed twice after saving
// an edit, and after a create's redirect Back landed on a blank /create.
// release() pops it (and waits for the pop) before the caller navigates.
// ---------------------------------------------------------------------------

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

import { useUnsavedChangesGuard } from "@/components/creator/unsaved-changes-guard";

type Guard = ReturnType<typeof useUnsavedChangesGuard>;
let guard: Guard;

function Probe({ enabled }: { enabled: boolean }) {
  const current = useUnsavedChangesGuard({ enabled });
  useEffect(() => {
    guard = current;
  });
  return null;
}

let pushState: ReturnType<typeof vi.spyOn>;
let back: ReturnType<typeof vi.spyOn>;
let go: ReturnType<typeof vi.spyOn>;

/** The browser answering a history traversal: popstate, a tick later. */
function popLater() {
  setTimeout(() => window.dispatchEvent(new PopStateEvent("popstate", { state: null })), 0);
}

beforeEach(() => {
  pushState = vi.spyOn(window.history, "pushState");
  back = vi.spyOn(window.history, "back").mockImplementation(popLater);
  go = vi.spyOn(window.history, "go").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  router.push.mockReset();
});

const sentinelPushes = () =>
  pushState.mock.calls.filter((call: unknown[]) => {
    const state = call[0] as { pipglyphUnsavedGuard?: boolean } | null;
    return state?.pipglyphUnsavedGuard === true;
  }).length;

describe("3b.7 the Back sentinel comes off after a save", () => {
  it("release() pops the sentinel and resolves once the browser has", async () => {
    render(<Probe enabled />);
    expect(sentinelPushes()).toBe(1);

    let released = false;
    await act(async () => {
      const done = guard.release().then(() => {
        released = true;
      });
      expect(back).toHaveBeenCalledTimes(1);
      expect(released).toBe(false); // waits for the pop
      await done;
    });
    expect(released).toBe(true);
    // Released: a later Back is not intercepted.
    await act(async () => {
      window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
    });
    expect(guard.pending).toBeNull();
    expect(sentinelPushes()).toBe(1);
  });

  it("release() with no sentinel on the stack touches no history", async () => {
    render(<Probe enabled={false} />);
    await act(async () => {
      await guard.release();
    });
    expect(back).not.toHaveBeenCalled();
  });

  it("Back while dirty still asks, and Leave walks past the right number of entries", async () => {
    render(<Probe enabled />);
    await act(async () => {
      window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
    });
    // Re-pushed and asking.
    expect(sentinelPushes()).toBe(2);
    expect(guard.pending).not.toBeNull();

    // Leave without a release: from the sentinel, two entries back.
    act(() => guard.pending?.proceed());
    expect(go).toHaveBeenLastCalledWith(-2);
  });

  it("after release() (a save from the Back dialog), proceed goes back one entry", async () => {
    render(<Probe enabled />);
    await act(async () => {
      window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
    });
    const pending = guard.pending;
    await act(async () => {
      await guard.release();
    });
    act(() => pending?.proceed());
    expect(go).toHaveBeenLastCalledWith(-1);
  });

  it("a sentinel walked off while clean is re-pushed the next time the form is dirty", async () => {
    const view = render(<Probe enabled />);
    expect(sentinelPushes()).toBe(1);
    view.rerender(<Probe enabled={false} />);
    // Back with nothing to lose: the browser leaves the sentinel.
    await act(async () => {
      window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
    });
    expect(guard.pending).toBeNull();
    view.rerender(<Probe enabled />);
    expect(sentinelPushes()).toBe(2);
    // …so Back is guarded again.
    await act(async () => {
      window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
    });
    expect(guard.pending).not.toBeNull();
  });
});
