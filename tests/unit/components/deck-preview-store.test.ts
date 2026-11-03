import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPreviewStore } from "@/components/decks/deck-preview-pane";

// ---------------------------------------------------------------------------
// The deck page's preview pane follows a pointer that RESTS on a card. After
// a drop (TODO DK5.15) the list re-renders and scrolls under the still
// pointer: no card it slides under may take the pane until the pointer
// really moves (#724's check: the pane showed another card than the one the
// drop handed the focus to).
// ---------------------------------------------------------------------------

describe("createPreviewStore — quietUntilMoved", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("a rest at the pointer's unchanged place after a drop shows nothing", () => {
    const store = createPreviewStore(100);
    store.set("dropped");
    store.quietUntilMoved();
    store.rest("slid-under", { x: 40, y: 50 });
    store.rest("slid-under", { x: 40, y: 50 });
    vi.advanceTimersByTime(500);
    expect(store.get()).toBe("dropped");
  });

  it("the pointer's next real move rests as before", () => {
    const store = createPreviewStore(100);
    store.set("dropped");
    store.quietUntilMoved();
    store.rest("slid-under", { x: 40, y: 50 });
    store.rest("slid-under", { x: 41, y: 50 });
    vi.advanceTimersByTime(100);
    expect(store.get()).toBe("slid-under");
  });

  it("without a drop, a rest shows its card after the rest time", () => {
    const store = createPreviewStore(100);
    store.rest("a", { x: 1, y: 1 });
    vi.advanceTimersByTime(99);
    expect(store.get()).toBeNull();
    vi.advanceTimersByTime(1);
    expect(store.get()).toBe("a");
  });
});
