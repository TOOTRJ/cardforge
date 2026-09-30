// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { CardPreviewData } from "@/components/cards/card-preview";
import type { FrameProfileOverride } from "@/lib/cards/profile-override";

// ---------------------------------------------------------------------------
// The compare tool's client half (TODO 0.18 — the Phase 0 fixes 0.6, 0.7 and
// 0.15 had no test of their own; the score button is the other end of
// /api/admin/frame-align-score). Contract:
//
//   * Score alignment posts { template, color, ref } — `ref` only for an
//     explicit registry pick (the route's schema refuses a null) — shows the
//     frame score, and is off while the draft is unsaved (the score measures
//     the SAVED layout);
//   * selecting the cost / set-symbol slot leaves the draft clean and shows
//     its fields at once (the region it occupies inline); the first edit —
//     a nudge or a typed value — seeds the COMPLETE rect (a bare { topPct }
//     breaks the renderer);
//   * keyboard nudges: 0.1 %, Alt / Option 0.5 %, physical keys (Option+]
//     types a quote on macOS), never with Cmd / Ctrl (browser shortcuts),
//     never while typing in a field;
//   * the draft re-syncs when the SAVED override changes, and an unrelated
//     refresh (a verify tick, a pin) leaves an in-progress draft alone;
//   * "Apply nudge" moves the slot by the score's suggestion.
// ---------------------------------------------------------------------------

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), message: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/components/cards/card-preview", () => ({
  CardPreview: () => <div data-testid="card-preview" />,
}));
const actions = vi.hoisted(() => ({
  saveFrameProfileOverrideAction: vi.fn(),
  resetFrameProfileOverrideAction: vi.fn(),
}));
vi.mock("@/lib/cards/frame-profile-override-actions", () => actions);
vi.mock("@/components/admin/rebake-marked-store", () => ({
  shouldRebakeAfterLayoutChange: () => false,
  startMarkedRebake: vi.fn(),
}));
const fetchMock = vi.hoisted(() => vi.fn());

import { FrameCompare } from "@/components/admin/frame-compare";
import { defaultCostRect, defaultSymbolRect, resolveFrameProfile, slotRect } from "@/lib/cards/profile-override";

const REF = "308465a9-2143-49f2-b9d0-a09272dd1b62";
const SCAN = "https://cards.scryfall.io/png/front/3/0/scan.png";
const M15 = resolveFrameProfile("m15", null);
const TITLE = slotRect(M15, "title")!;
const round = (value: number) => Math.round(value * 10000) / 10000;

function renderCompare(
  props: Partial<{ referenceId: string | null; savedOverride: FrameProfileOverride | null; scanUrl: string | null }> = {},
) {
  const all = {
    preview: { title: "Sample" } as CardPreviewData,
    scanUrl: SCAN,
    scanAlt: "Official scan",
    template: "m15",
    colorKey: "w",
    referenceId: null,
    savedOverride: null,
    ...props,
  };
  const view = render(<FrameCompare {...all} />);
  return {
    ...view,
    rerenderWith: (next: typeof props) => view.rerender(<FrameCompare {...all} {...next} />),
  };
}

function scoreAnswers(body: unknown) {
  fetchMock.mockImplementation(async () => ({ ok: true, json: async () => body }));
}

const SCORE = {
  ok: true,
  overall: 4.2,
  global: { dxPct: 0.1, dyPct: 0, confidence: 0.8 },
  slots: {
    title: { score: 9.5, best: 4.1, dxPct: 0.3, dyPct: -0.2 },
    artSlot: { score: 30, best: 30, dxPct: 0, dyPct: 0 },
  },
  referenceId: REF,
};

const openEditor = () => fireEvent.click(screen.getByRole("button", { name: /edit layout/i }));
const chip = (name: string) => fireEvent.click(screen.getByRole("button", { name }));
const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const saveButton = () => screen.getByRole("button", { name: /^save$/i }) as HTMLButtonElement;
const scoreButton = () => screen.getByRole("button", { name: /score alignment/i }) as HTMLButtonElement;
const press = (init: KeyboardEventInit, target: Element | Window = window) =>
  act(() => {
    fireEvent.keyDown(target, init);
  });

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  scoreAnswers(SCORE);
  toast.success.mockReset();
  toast.error.mockReset();
  toast.message.mockReset();
  router.refresh.mockReset();
  actions.saveFrameProfileOverrideAction.mockReset();
  actions.saveFrameProfileOverrideAction.mockResolvedValue({ ok: true, changed: true, staleCount: 0, keptForOwner: 0 });
  actions.resetFrameProfileOverrideAction.mockReset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("FrameCompare — the score button", () => {
  it("posts the combo without a ref for the pinned/default printing, and shows the frame score", async () => {
    renderCompare();
    fireEvent.click(scoreButton());
    await screen.findByTestId("score-panel");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/admin/frame-align-score");
    expect(init.method).toBe("POST");
    // No `ref` key at all: the route's schema takes a Scryfall id or nothing.
    expect(JSON.parse(init.body as string)).toEqual({ template: "m15", color: "w" });
    expect(screen.getByTestId("score-panel").textContent).toContain("frame 4.2%");
  });

  it("names an explicit registry pick, so the score measures the printing on screen", async () => {
    renderCompare({ referenceId: REF });
    fireEvent.click(scoreButton());
    await screen.findByTestId("score-panel");
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toEqual({
      template: "m15",
      color: "w",
      ref: REF,
    });
  });

  it("toasts the route's error", async () => {
    scoreAnswers({ ok: false, error: "Could not download the scan." });
    renderCompare();
    fireEvent.click(scoreButton());
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Could not download the scan."));
    expect(screen.queryByTestId("score-panel")).toBeNull();
  });

  it("has nothing to score without a printing", () => {
    renderCompare({ scanUrl: null });
    expect(screen.queryByRole("button", { name: /score alignment/i })).toBeNull();
  });

  it("is off while the draft is unsaved, and flags a score taken before the last save", async () => {
    renderCompare();
    fireEvent.click(scoreButton());
    await screen.findByTestId("score-panel");

    openEditor();
    chip("title (name)");
    fireEvent.change(field("title topPct"), { target: { value: String(TITLE.topPct + 1) } });
    expect(scoreButton().disabled).toBe(true);

    fireEvent.click(saveButton());
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(screen.getByTestId("score-panel").textContent).toMatch(/Scored BEFORE your last save/);
  });
});

describe("FrameCompare — detached slots (0.7)", () => {
  it("fixture: M15's cost pips and set symbol have no rect of their own", () => {
    expect(M15.costRect).toBeUndefined();
    expect(M15.symbolRect).toBeUndefined();
    expect(M15.hideCost).toBeFalsy();
  });

  it("selecting the cost or set-symbol slot leaves the draft clean", () => {
    renderCompare();
    openEditor();
    chip("cost (pips)");
    chip("set symbol");
    expect(saveButton().disabled).toBe(true);
    expect(screen.queryByText(/Unsaved changes/)).toBeNull();
    expect(scoreButton().disabled).toBe(false);
  });

  it("a selected cost or set-symbol slot shows its fields — the region it occupies inline — before the first nudge", () => {
    const cost = defaultCostRect(M15);
    const symbol = defaultSymbolRect(M15);
    renderCompare();
    openEditor();
    chip("cost (pips)");
    expect(Number(field("costRect topPct").value)).toBe(cost.topPct);
    expect(Number(field("costRect leftPct").value)).toBe(cost.leftPct);
    expect(Number(field("costRect widthPct").value)).toBe(cost.widthPct);
    expect(Number(field("costRect heightPct").value)).toBe(cost.heightPct);
    expect(screen.getByTestId("inline-slot-note").textContent).toMatch(/inline in the title band/);
    chip("set symbol");
    expect(Number(field("symbolRect topPct").value)).toBe(symbol.topPct);
    expect(Number(field("symbolRect leftPct").value)).toBe(symbol.leftPct);
    expect(Number(field("symbolRect widthPct").value)).toBe(symbol.widthPct);
    expect(Number(field("symbolRect heightPct").value)).toBe(symbol.heightPct);
    expect(screen.getByTestId("inline-slot-note").textContent).toMatch(/inline in the type band/);
    // Showing them is not an edit.
    expect(saveButton().disabled).toBe(true);
    // A slot with a rect of its own carries no inline note.
    chip("title (name)");
    expect(screen.queryByTestId("inline-slot-note")).toBeNull();
  });

  it("typing into a detached slot's field detaches it with the complete rect", async () => {
    const seed = defaultSymbolRect(M15);
    renderCompare();
    openEditor();
    chip("set symbol");
    fireEvent.change(field("symbolRect widthPct"), { target: { value: String(seed.widthPct + 1) } });
    expect(saveButton().disabled).toBe(false);
    // Detached now: the note is gone, the other fields kept their values.
    expect(screen.queryByTestId("inline-slot-note")).toBeNull();
    expect(Number(field("symbolRect topPct").value)).toBe(seed.topPct);

    fireEvent.click(saveButton());
    await waitFor(() => expect(actions.saveFrameProfileOverrideAction).toHaveBeenCalledTimes(1));
    expect(actions.saveFrameProfileOverrideAction.mock.calls[0][0].overrides).toEqual({
      symbolRect: { ...seed, widthPct: round(seed.widthPct + 1) },
    });
  });

  it("the first edit seeds the complete rect, which is what Save sends", async () => {
    const seed = defaultCostRect(M15);
    renderCompare();
    openEditor();
    chip("cost (pips)");
    press({ code: "ArrowDown", key: "ArrowDown" });
    expect(saveButton().disabled).toBe(false);
    // Now a real rect: its fields show the region the pips occupied, moved.
    expect(Number(field("costRect topPct").value)).toBe(round(seed.topPct + 0.1));
    expect(Number(field("costRect widthPct").value)).toBe(seed.widthPct);

    fireEvent.click(saveButton());
    await waitFor(() => expect(actions.saveFrameProfileOverrideAction).toHaveBeenCalledTimes(1));
    const { template, overrides } = actions.saveFrameProfileOverrideAction.mock.calls[0][0];
    expect(template).toBe("m15");
    expect(overrides).toEqual({
      costRect: {
        topPct: round(seed.topPct + 0.1),
        leftPct: seed.leftPct,
        widthPct: seed.widthPct,
        heightPct: seed.heightPct,
      },
    });
  });
});

describe("FrameCompare — keyboard nudges (0.15)", () => {
  function editTitle() {
    renderCompare();
    openEditor();
    chip("title (name)");
    return () => Number(field("title topPct").value);
  }

  it("moves the selected slot 0.1 % per arrow, 0.5 % with Alt / Option", () => {
    const top = editTitle();
    press({ code: "ArrowDown", key: "ArrowDown" });
    expect(top()).toBe(round(TITLE.topPct + 0.1));
    press({ code: "ArrowUp", key: "ArrowUp", altKey: true });
    expect(top()).toBe(round(TITLE.topPct + 0.1 - 0.5));
    press({ code: "ArrowRight", key: "ArrowRight" });
    expect(Number(field("title leftPct").value)).toBe(round(TITLE.leftPct + 0.1));
  });

  it("never nudges with Cmd or Ctrl held (browser shortcuts)", () => {
    const top = editTitle();
    press({ code: "ArrowDown", key: "ArrowDown", metaKey: true });
    press({ code: "ArrowDown", key: "ArrowDown", ctrlKey: true });
    press({ code: "BracketLeft", key: "[", metaKey: true });
    expect(top()).toBe(TITLE.topPct);
    expect(saveButton().disabled).toBe(true);
  });

  it("reads physical keys: Option+] still widens on macOS, Shift+[ shrinks the height", () => {
    editTitle();
    // Option+] types a curly quote — the key is "‘", the code is still BracketRight.
    press({ code: "BracketRight", key: "‘", altKey: true });
    expect(Number(field("title widthPct").value)).toBe(round(TITLE.widthPct + 0.5));
    press({ code: "BracketLeft", key: "{", shiftKey: true });
    expect(Number(field("title heightPct").value)).toBe(round(TITLE.heightPct - 0.1));
  });

  it("leaves arrows alone while typing in a field", () => {
    const top = editTitle();
    press({ code: "ArrowDown", key: "ArrowDown" }, field("title leftPct"));
    expect(top()).toBe(TITLE.topPct);
  });
});

describe("FrameCompare — draft vs saved override (0.6)", () => {
  const SAVED_A: FrameProfileOverride = { title: { rect: { topPct: 5.5 } } } as FrameProfileOverride;
  const SAVED_B: FrameProfileOverride = { title: { rect: { topPct: 6.25 } } } as FrameProfileOverride;

  it("keeps an in-progress draft through an unrelated refresh, re-syncs when the saved layout changes", () => {
    const view = renderCompare({ savedOverride: SAVED_A });
    openEditor();
    chip("title (name)");
    expect(field("title topPct").value).toBe("5.5");

    fireEvent.change(field("title topPct"), { target: { value: "7" } });
    expect(saveButton().disabled).toBe(false);

    // A verify tick or a pin refreshes the page: same saved layout, new object.
    view.rerenderWith({ savedOverride: structuredClone(SAVED_A) });
    expect(field("title topPct").value).toBe("7");
    expect(saveButton().disabled).toBe(false);

    // A save landing (ours or another admin's): the draft follows it.
    view.rerenderWith({ savedOverride: SAVED_B });
    expect(field("title topPct").value).toBe("6.25");
    expect(saveButton().disabled).toBe(true);
  });
});

describe("FrameCompare — Apply nudge", () => {
  it("turns editing on and moves the slot by the suggested offset", async () => {
    renderCompare();
    fireEvent.click(scoreButton());
    await screen.findByTestId("score-panel");
    // The art window never gets a nudge; the title does.
    expect(screen.getAllByRole("button", { name: /apply nudge/i })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /apply nudge/i }));

    expect(screen.getByRole("button", { name: /edit layout/i }).getAttribute("aria-pressed")).toBe("true");
    expect(Number(field("title topPct").value)).toBe(round(TITLE.topPct - 0.2));
    expect(Number(field("title leftPct").value)).toBe(round(TITLE.leftPct + 0.3));
    expect(saveButton().disabled).toBe(false);
  });
});
