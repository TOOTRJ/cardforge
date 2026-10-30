// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { dynamicReady } from "@/tests/stubs/next-dynamic";
import { addDays, buildDeckActivity, type ActivityPeriod, type DayCount } from "@/lib/decks/deck-activity";

// ---------------------------------------------------------------------------
// The deck activity panel (TODO DK7.4): the OWNER's views and likes, Pro.
//   * owner on Pro: the period switch, totals with their change, a chart per
//     series and its table twin (in the page for a screen reader, shown by
//     the card's "Table" switch);
//   * owner on another plan: a locked preview whose button opens the
//     upgrade modal with reason "deck_activity" and its surface — no read;
//   * a visitor: the page renders the slot only for the owner.
// ---------------------------------------------------------------------------

const TODAY = new Date().toISOString().slice(0, 10);
const DECK = "33333333-3333-4333-8333-333333333333";

const state = vi.hoisted(() => ({
  calls: [] as Array<[string, number]>,
  upgrade: [] as unknown[][],
  empty: false,
}));

function rows(days: number, countOf: (i: number) => number): DayCount[] {
  const first = addDays(new Date().toISOString().slice(0, 10), -(days - 1));
  return Array.from({ length: days }, (_, i) => ({ day: addDays(first, i), count: countOf(i) }));
}

vi.mock("@/lib/decks/activity-actions", () => ({
  getDeckActivityAction: vi.fn(async (deckId: string, days: ActivityPeriod) => {
    state.calls.push([deckId, days]);
    const span = days * 2;
    return {
      ok: true,
      activity: buildDeckActivity(
        state.empty
          ? { views: [], likes: [] }
          : { views: rows(span, (i) => (i < days ? 1 : 2)), likes: rows(span, (i) => (i === span - 1 ? 3 : 0)) },
        days,
        TODAY,
      ),
    };
  }),
}));
vi.mock("@/components/billing/upgrade-modal-provider", () => ({
  useUpgradeModal: () => ({ open: (...args: unknown[]) => state.upgrade.push(args) }),
}));

import { DeckActivityPanel } from "@/components/decks/deck-activity-panel";
import { DeckActivitySlot } from "@/components/decks/deck-activity-slot";

beforeEach(() => {
  state.calls = [];
  state.upgrade = [];
  state.empty = false;
});
afterEach(cleanup);

describe("owner on Pro", () => {
  it("reads 30 days, shows the totals with their change and both charts", async () => {
    render(<DeckActivityPanel deckId={DECK} canView isPrivate={false} />);
    expect(screen.getByRole("heading", { name: "Deck activity" })).toBeTruthy();
    const totals = await screen.findByText("Views", { selector: "dt" });
    expect(state.calls).toEqual([[DECK, 30]]);
    const viewsTile = totals.parentElement!;
    expect(within(viewsTile).getByText("60")).toBeTruthy();
    expect(within(viewsTile).getByText("100% up on the previous 30 days (30).")).toBeTruthy();
    const likesTile = screen.getByText("Likes", { selector: "dt" }).parentElement!;
    expect(within(likesTile).getByText("3")).toBeTruthy();
    expect(within(likesTile).getByText("None in the previous 30 days.")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Views", level: 3 })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Likes", level: 3 })).toBeTruthy();
  });

  it("has a table twin per chart, shown by the Table switch", async () => {
    render(<DeckActivityPanel deckId={DECK} canView isPrivate={false} />);
    await screen.findByText("Views", { selector: "dt" });
    // In the page for a screen reader already.
    const table = screen.getByRole("table", { name: "Views per day, last 30 days" });
    expect(within(table).getAllByRole("row")).toHaveLength(31);
    fireEvent.click(screen.getByRole("button", { name: "Show likes as a table" }));
    const likes = screen.getByRole("table", { name: "Likes per day, last 30 days" });
    const lastRow = within(likes).getAllByRole("row").at(-1)!;
    expect(within(lastRow).getByText("3")).toBeTruthy();
  });

  it("reads again on a period switch; 90 days draws weeks", async () => {
    render(<DeckActivityPanel deckId={DECK} canView isPrivate={false} />);
    await screen.findByText("Views", { selector: "dt" });
    fireEvent.click(screen.getByRole("radio", { name: "90 days" }));
    await waitFor(() => expect(screen.getByRole("table", { name: "Views per week, last 90 days" })).toBeTruthy());
    expect(state.calls).toEqual([
      [DECK, 30],
      [DECK, 90],
    ]);
  });

  it("says so when a new deck has nothing yet", async () => {
    state.empty = true;
    render(<DeckActivityPanel deckId={DECK} canView isPrivate={false} />);
    expect(await screen.findByText(/No views or likes in the last 60 days yet/)).toBeTruthy();
    expect(screen.getByText("No views in these 30 days.")).toBeTruthy();
  });

  it("explains a private deck's missing views", async () => {
    state.empty = true;
    render(<DeckActivityPanel deckId={DECK} canView isPrivate />);
    expect(await screen.findByText(/This deck is private, so only you can open it/)).toBeTruthy();
  });

  it("loads through the slot's lazy island", async () => {
    render(<DeckActivitySlot deckId={DECK} canView isPrivate={false} />);
    await dynamicReady();
    expect(await screen.findByRole("heading", { name: "Deck activity" })).toBeTruthy();
  });
});

describe("owner on another plan", () => {
  it("shows a locked preview and opens the upgrade modal with its surface — and reads nothing", async () => {
    render(<DeckActivityPanel deckId={DECK} canView={false} isPrivate={false} />);
    expect(screen.getByText(/Deck activity is part of Pro/)).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Upgrade to Pro" }));
    expect(state.upgrade).toEqual([["deck_activity", "deck_activity"]]);
    await Promise.resolve();
    expect(state.calls).toEqual([]);
  });
});

describe("a visitor", () => {
  it("gets no slot: the deck page renders it for the owner alone", () => {
    const page = readFileSync(join(process.cwd(), "app/(marketing)/deck/[slug]/page.tsx"), "utf8");
    const uses = page.split("<DeckActivitySlot").length - 1;
    expect(uses).toBe(1);
    expect(page).toMatch(/\{isOwner \? \(\s*<DeckActivitySlot/);
    expect(page).toMatch(/canView=\{entitlements\.effectiveTier === "pro"\}/);
  });
});
