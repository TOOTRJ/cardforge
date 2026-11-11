// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { JobStep } from "@/lib/ai/generation-jobs";

// ---------------------------------------------------------------------------
// How a Bulk Customize RUN ended, as the tool's analytics see it (the
// 2026-11-10 tools audit). The browser runs the batch's steps, so only the
// dialog knows a run is over: it records `run_finished` ONCE per run through
// trackToolEvent — the cards this run made, the credits it really
// spent, how the batch stands, why it stopped, the art choice and the
// surface that opened it. A batch continued after a stop is a second run,
// counted from where the first left off. Counts and codes only.
// (What the summary says for each ending: bulk-customize-events.test.ts.)
// ---------------------------------------------------------------------------

const m = vi.hoisted(() => ({
  track: vi.fn(),
  prepare: vi.fn(),
  start: vi.fn(),
  upgrade: vi.fn(),
  finished: vi.fn(),
}));

vi.mock("@/lib/tools/track-client", () => ({ trackToolEvent: m.track }));
vi.mock("@/lib/tools/bulk-customize/actions", () => ({
  prepareBulkCustomizeAction: m.prepare,
  startBulkCustomizeAction: m.start,
}));
vi.mock("@/lib/tools/bulk-customize/planner", () => ({
  planCustomizedCard: ({ fallbackTitle }: { fallbackTitle: string }) => ({
    ok: true,
    title: fallbackTitle,
    payload: {},
    changes: ["frame"],
    notes: [],
    doubleFaced: false,
    credits: 0,
  }),
}));
vi.mock("@/components/billing/upgrade-modal-provider", () => ({ useUpgradeModal: () => ({ open: m.upgrade }) }));
vi.mock("@/components/billing/credits-bus", () => ({ publishCredits: vi.fn() }));
vi.mock("@/components/ai/use-leave-warning", () => ({ useLeaveWarning: () => {} }));
vi.mock("@/components/tools/collection/printing-tile", () => ({ PrintingPicture: () => null }));
// The dialog's chrome is not under test: plain elements stand in for Radix.
vi.mock("@/components/ui/dialog", async () => {
  const { createElement } = await import("react");
  const box = ({ children }: { children?: React.ReactNode }) => createElement("div", null, children);
  return {
    Dialog: ({ open, children }: { open: boolean; children?: React.ReactNode }) => (open ? createElement("div", { role: "dialog" }, children) : null),
    DialogContent: box,
    DialogDescription: box,
    DialogFooter: box,
    DialogHeader: box,
    DialogTitle: ({ children }: { children?: React.ReactNode }) => createElement("h2", null, children),
  };
});
vi.mock("@/components/creator/field-group", async () => {
  const { createElement } = await import("react");
  return {
    inputClass: () => "",
    FieldGroup: ({ children }: { children: React.ReactNode | ((aria: Record<string, never>) => React.ReactNode) }) =>
      createElement("div", null, typeof children === "function" ? children({}) : children),
  };
});

import { BulkCustomizeDialog } from "@/components/tools/bulk-customize/bulk-customize-dialog";

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const SOURCES = [
  { kind: "collection" as const, id: ID(1) },
  { kind: "collection" as const, id: ID(2) },
];

/** The job's steps as the server holds them; `answers` decides what a step
 *  POST makes of the step it names. */
let steps: JobStep[];
let answers: (key: string) => Partial<JobStep>;
const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
  const key = (JSON.parse(String(init?.body)) as { step: string }).step;
  steps = steps.map((step) => (step.key === key ? { ...step, ...answers(key) } : step));
  return { status: 200, headers: { get: () => null }, json: async () => ({ ok: true, job: { id: "job-1", steps }, credits: 8 }) };
});

const tracked = () => m.track.mock.calls.map(([slug, event, props]) => [slug, event, props]);

async function settle(times = 12) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function openAndCreate(surface: "collection" | "deck" | "search" = "collection") {
  render(<BulkCustomizeDialog open onOpenChange={() => {}} sources={SOURCES} surface={surface} onFinished={m.finished} />);
  await settle();
  // One change, so the batch isn't a set of exact copies.
  fireEvent.click(screen.getByRole("radio", { name: /1997 frame/ }));
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Create 2 cards" }));
  });
  await settle();
}

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset();
  fetchMock.mockClear();
  m.track.mockReturnValue(undefined);
  steps = [
    { key: "bulk:0", label: "Secret Card A", status: "pending" },
    { key: "bulk:1", label: "Secret Card B", status: "pending" },
  ];
  m.prepare.mockResolvedValue({
    ok: true,
    cards: SOURCES.map((source, i) => ({
      key: `collection:${source.id}`,
      source,
      name: `Secret Card ${i}`,
      setName: "Dominaria",
      collectorNumber: String(i + 1),
      thumbUrl: null,
      patch: {},
      scryfallSet: "dom",
    })),
    skipped: [],
    verifiedKeys: [],
    removeWatermark: true,
    capacity: null,
    credits: 10,
    aiAvailable: true,
  });
  m.start.mockImplementation(async () => ({ ok: true, job: { id: "job-1", kind: "bulk_customize", steps }, skipped: [], credits: 0 }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("`run_finished`", () => {
  it("a batch that runs to the end is recorded once: every card made, what it spent, the surface", async () => {
    answers = (key) => ({ status: "done", card_id: `card-${key}`, spend_ref: key === "bulk:0" ? "spend:job-1:bulk:0:x" : null });
    await openAndCreate("deck");
    expect(screen.getByRole("heading", { name: "Your cards are ready" })).toBeTruthy();
    expect(tracked()).toEqual([
      [
        "bulk-customize",
        "run_finished",
        { total: 2, made: 2, failed: 0, left: 0, credits: 1, stopped: "none", run: 1, art: "keep", surface: "deck" },
      ],
    ]);
    // The opener's refresh still happens, as before.
    expect(m.finished).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(m.track.mock.calls)).not.toMatch(/Secret|card-bulk|job-1/);
  });

  it("a run the card limit stopped says so; the continued run counts only its own cards and credits", async () => {
    answers = () => ({ status: "failed", error: "You've reached your plan's card limit.", error_code: "CARD_CAPACITY" });
    await openAndCreate();
    expect(tracked()).toEqual([
      [
        "bulk-customize",
        "run_finished",
        { total: 2, made: 0, failed: 2, left: 0, credits: 0, stopped: "capacity", run: 1, art: "keep", surface: "collection" },
      ],
    ]);
    expect(m.upgrade).toHaveBeenCalledWith("capacity", "bulk_customize_collection");

    // Room was made: the failed ones are tried again and both land, charged.
    answers = (key) => ({ status: "done", card_id: `card-${key}`, error: undefined, error_code: null, spend_ref: `spend:job-1:${key}:y` });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Try the failed ones again/ }));
    });
    await settle();
    expect(tracked()).toHaveLength(2);
    expect(tracked()[1]).toEqual([
      "bulk-customize",
      "run_finished",
      { total: 2, made: 2, failed: 0, left: 0, credits: 2, stopped: "none", run: 2, art: "keep", surface: "collection" },
    ]);
  });

  it("nothing is recorded before a run ends", async () => {
    answers = () => ({ status: "done", card_id: "card-1", spend_ref: null });
    render(<BulkCustomizeDialog open onOpenChange={() => {}} sources={SOURCES} surface="search" onFinished={m.finished} />);
    await settle();
    // The selection is read and priced: no run yet.
    expect(m.track).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("radio", { name: /1997 frame/ }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Create 2 cards" }));
    });
    await settle();
    expect(m.track).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("heading", { name: "Your cards are ready" })).toBeTruthy();
  });
});
