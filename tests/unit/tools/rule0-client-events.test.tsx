// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

// ---------------------------------------------------------------------------
// What the Rule 0 table sheet's editor records from the BROWSER (tool_events,
// through trackToolEvent): the moments no server code sees — the link
// copied, the sheet printed, and an AI draft whose answer never reached the
// page (`ai_draft_lost`: a dropped connection, or a function the platform
// stopped — the route recorded nothing then). A draft the ROUTE answered,
// made or refused, is the route's to record (rule0-events.test.ts), never
// twice.
// ---------------------------------------------------------------------------

const m = vi.hoisted(() => ({
  track: vi.fn<(slug: string, event: string, props?: Record<string, unknown>) => void>(() => undefined),
}));

vi.mock("@/lib/tools/track-client", () => ({ trackToolEvent: m.track }));
vi.mock("@/lib/tools/rule0/actions", () => ({ saveTableSheetAction: vi.fn(), setTableSheetSharedAction: vi.fn() }));
vi.mock("@/components/tools/rule0/table-sheet", () => ({ TableSheet: () => null }));
vi.mock("@/components/ai/use-leave-warning", () => ({ useLeaveWarning: () => undefined }));
vi.mock("@/components/billing/credits-bus", () => ({ publishCredits: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { TableSheetEditor } from "@/components/tools/rule0/table-sheet-editor";
import type { TableSheetFacts } from "@/lib/tools/rule0/sheet";

const FACTS = {
  commanders: [],
  cardCount: 100,
  custom: [],
  customCount: 3,
  proxies: [],
  proxyCount: 0,
  realCount: 97,
  notFound: [],
  notFoundCount: 0,
  gameChangers: [],
  estimate: null,
} as TableSheetFacts;

function editor() {
  render(
    <TableSheetEditor
      deckId="22222222-2222-4222-8222-222222222222"
      deckSlug="wolf-pack"
      deckVisibility="public"
      deck={{ title: "Wolf Pack" } as never}
      facts={FACTS}
      initial={{ gamePlan: null, winConditions: null, tableNotes: null, shared: true, aiDraftedAt: null, updatedAt: null }}
      qr={null}
      shareUrl="https://pipglyph.test/deck/wolf-pack/table-sheet"
      aiAvailable
    />,
  );
}

const draft = async () => {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /Draft with AI/ }));
  });
};

const events = () => m.track.mock.calls.map(([slug, event, props]) => [slug, event, props]);

beforeEach(() => {
  m.track.mockClear();
  m.track.mockReturnValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  // Never the deck's name, its address or an id.
  for (const [, , props] of m.track.mock.calls) {
    expect(JSON.stringify(props ?? {})).not.toMatch(/wolf|pipglyph|2222/i);
  }
});

describe("an AI draft whose answer never reached the page", () => {
  it("a dropped connection: ai_draft_lost, network", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    editor();
    await draft();
    expect(screen.getByRole("alert").textContent).toContain("We lost the answer");
    expect(events()).toEqual([["rule0-sheet", "ai_draft_lost", { reason: "network", ms: expect.any(Number) }]]);
  });

  it("an answer that isn't the route's (a platform error page): ai_draft_lost, no_answer, with its status", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>504</html>", { status: 504 })));
    editor();
    await draft();
    expect(screen.getByRole("alert").textContent).toContain("didn't finish");
    expect(events()).toEqual([["rule0-sheet", "ai_draft_lost", { reason: "no_answer", status: 504, ms: expect.any(Number) }]]);
  });

  it("a refusal the route answered is the route's to record: nothing from the browser", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ ok: false, error: "Out of credits.", code: "INSUFFICIENT_CREDITS" }, { status: 402 })),
    );
    editor();
    await draft();
    expect(screen.getByRole("alert").textContent).toContain("Out of credits.");
    expect(m.track).not.toHaveBeenCalled();
  });

  it("a draft that arrived records nothing from the browser either", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ ok: true, draft: { gamePlan: "Ramp.", winConditions: ["Dragons"] }, sheet: null, credits: 3 })),
    );
    editor();
    await draft();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(m.track).not.toHaveBeenCalled();
  });

  it("a tracking call that fails never changes what the page says", async () => {
    m.track.mockImplementation(() => {
      throw new Error("offline");
    });
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    editor();
    await draft();
    expect(screen.getByRole("alert").textContent).toContain("We lost the answer");
  });
});

describe("the editor's other browser events (unchanged)", () => {
  it("Print records print, with whether the sheet is shared and how many custom cards it names", async () => {
    vi.stubGlobal("print", vi.fn());
    editor();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Print$/ }));
    });
    expect(events()).toEqual([["rule0-sheet", "print", { shared: true, custom: 3 }]]);
  });
});
