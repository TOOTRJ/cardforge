// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReartStudioEntry } from "@/lib/tools/re-art/model";

// ---------------------------------------------------------------------------
// The studio's card list (components/tools/re-art/reart-card-grid.tsx) and
// the run's progress panel (components/tools/bulk-customize/bulk-progress.tsx)
// as a maker reads them:
//
//   * a card painted in the deck's style that shows OTHER art now says so and
//     is among the cards to paint — never "In this style";
//   * every one-card paint link ends in "…" (it opens the confirm; nothing is
//     charged by the link), and while one card can't be painted the links are
//     off, described by the reason shown above the cards;
//   * the progress panel speaks the tool's words ("painted", "run") and names
//     no limit it can't know (it said "Scryfall's art limit" for every wait).
// ---------------------------------------------------------------------------

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={String(href)}>{children}</a>,
}));
vi.mock("@/components/cards/card-tile", () => ({ CardTile: () => <div data-testid="tile" /> }));
vi.mock("@/components/tools/collection/printing-tile", () => ({
  PrintingPicture: ({ name }: { name: string }) => <div data-testid="printing">{name}</div>,
}));

import { ReartCardGrid, gridFilterOf } from "@/components/tools/re-art/reart-card-grid";
import { ReartStylePanel } from "@/components/tools/re-art/reart-style-panel";
import { BulkProgress } from "@/components/tools/bulk-customize/bulk-progress";

const entry = (over: Partial<ReartStudioEntry> = {}): ReartStudioEntry => ({
  id: "00000000-0000-4000-8000-0000000000e1",
  name: "Thornback Wyrm",
  quantity: 1,
  board: "main",
  typeLine: "Creature — Wyrm",
  imageUrl: null,
  kind: "own",
  skipMessage: null,
  card: null,
  bucket: "creature",
  state: null,
  canRestore: false,
  artNow: "own",
  credits: 1,
  ...over,
});

function grid(entries: ReartStudioEntry[], over: { paintBlocked?: string | null; onPaintOne?: (e: ReartStudioEntry) => void } = {}) {
  return render(
    <ReartCardGrid
      entries={entries}
      username="dev_free"
      filter="all"
      onFilter={() => undefined}
      sample={new Set()}
      onToggleSample={() => undefined}
      busy={null}
      locked={false}
      paintBlocked={over.paintBlocked ?? null}
      onPaintOne={over.onPaintOne ?? (() => undefined)}
      onRestore={() => undefined}
    />,
  );
}

afterEach(cleanup);

describe("the studio's card list", () => {
  it("a card showing other art now says so: never in the style, and left as it is by a run", () => {
    grid([entry({ state: "changed" })]);
    expect(screen.getByText("Has other art now")).toBeTruthy();
    expect(screen.queryByText("In this style")).toBeNull();
    // Still paintable on its own.
    expect(screen.getByRole("button", { name: /Re-roll…/ })).toBeTruthy();
    expect(gridFilterOf(entry({ state: "changed" }))).toBe("skipped");
    expect(gridFilterOf(entry({ state: "earlier" }))).toBe("todo");
    expect(gridFilterOf(entry({ state: null }))).toBe("todo");
    expect(gridFilterOf(entry({ state: "in_style" }))).toBe("done");
    expect(gridFilterOf(entry({ state: "kept" }))).toBe("done");
  });

  it("a paint link opens the confirm: it ends in “…” for every card and hands the card on", () => {
    const onPaintOne = vi.fn();
    const fresh = entry();
    const { unmount } = grid([fresh], { onPaintOne });
    const paint = screen.getByRole("button", { name: /Paint this one…/ });
    expect(paint.getAttribute("aria-disabled")).toBeNull();
    fireEvent.click(paint);
    expect(onPaintOne).toHaveBeenCalledWith(fresh);
    unmount();
    grid([entry({ state: "in_style", artNow: "reart" })]);
    expect(screen.getByRole("button", { name: /Re-roll…/ })).toBeTruthy();
  });

  it("while one card can't be painted the links are off and described by the reason above the cards", () => {
    const onPaintOne = vi.fn();
    const reason = "You changed the style. Save it or undo your changes first: one card is painted in the deck's saved style.";
    grid([entry()], { paintBlocked: reason, onPaintOne });
    const note = screen.getByText(reason);
    const paint = screen.getByRole("button", { name: /Paint this one…/ });
    expect(paint.getAttribute("aria-disabled")).toBe("true");
    expect(paint.getAttribute("aria-describedby")).toBe(note.id);
    // Reachable, and pressing it lets the studio say why (it starts nothing).
    fireEvent.click(paint);
    expect(onPaintOne).toHaveBeenCalledTimes(1);
  });
});

describe("the style form — a way back that saves no new look", () => {
  const panel = (over: { dirty?: boolean; saved?: boolean; onReset?: () => void } = {}) =>
    render(
      <ReartStylePanel
        style={{ preset: "watercolor", theme: "a neon harbour" }}
        onChange={() => undefined}
        dirty={over.dirty ?? true}
        saved={over.saved ?? true}
        saving={false}
        onSave={() => undefined}
        onReset={over.onReset}
        problem={null}
        saveError={null}
        paintedInSaved={0}
      />,
    );

  it("offers “Undo changes” while the form differs from the saved style, and hands the focus to the words", () => {
    vi.stubGlobal("requestAnimationFrame", (run: () => void) => {
      run();
      return 0;
    });
    const onReset = vi.fn();
    panel({ onReset });
    fireEvent.click(screen.getByRole("button", { name: "Undo changes" }));
    expect(onReset).toHaveBeenCalledTimes(1);
    // The button removes itself once the form matches: the focus isn't lost.
    expect(document.activeElement).toBe(screen.getByRole("textbox"));
    vi.unstubAllGlobals();
  });

  it("offers none with nothing to go back to", () => {
    panel({ dirty: false, onReset: () => undefined });
    expect(screen.queryByRole("button", { name: "Undo changes" })).toBeNull();
    cleanup();
    panel({ saved: false, onReset: () => undefined });
    expect(screen.queryByRole("button", { name: "Undo changes" })).toBeNull();
    cleanup();
    panel({});
    expect(screen.queryByRole("button", { name: "Undo changes" })).toBeNull();
  });
});

describe("the run's progress panel speaks the tool's words", () => {
  const runner = (over: Record<string, unknown> = {}) =>
    ({
      steps: [
        { key: "reart:0", label: "Thornback Wyrm", status: "done" },
        { key: "reart:1", label: "Cinder Hound", status: "failed", error: "No picture." },
        { key: "reart:2", label: "Fen Witch", status: "pending" },
      ],
      running: true,
      waitingUntil: null,
      stoppedBy: null,
      error: null,
      paused: false,
      runsEnded: 0,
      stop: () => undefined,
      retryFailed: () => undefined,
      ...over,
    }) as unknown as Parameters<typeof BulkProgress>[0]["runner"];

  const panel = (over: Record<string, unknown> = {}, props: Partial<Parameters<typeof BulkProgress>[0]> = {}) =>
    render(
      <BulkProgress
        runner={runner(over)}
        total={3}
        doneCount={1}
        failedCount={1}
        settled={false}
        paused={false}
        skipped={[]}
        {...props}
      />,
    );

  it("a wait names no limit it can't know", () => {
    panel({ waitingUntil: Date.now() + 20_000 }, { noun: "painted", doing: "Painting", unit: "run" });
    expect(screen.getByText(/Waiting \d+s for a per-minute limit to clear…/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Scryfall/);
  });

  it("Re-art: painted cards, a run", () => {
    panel({}, { noun: "painted", doing: "Painting", unit: "run" });
    expect(screen.getByRole("progressbar", { name: "Cards painted" })).toBeTruthy();
    expect(screen.getByLabelText("Painted")).toBeTruthy();
    expect(screen.getByLabelText("Not painted")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Stop after the cards being painted" })).toBeTruthy();
    cleanup();
    // As the studio mounts it: its own note and closing button.
    panel(
      { running: false, paused: true, stoppedBy: "INSUFFICIENT_CREDITS" },
      {
        paused: true,
        noun: "painted",
        doing: "Painting",
        unit: "run",
        pausedNote: "You can continue it later from this page; the cards painted so far are saved.",
        finishedAction: <button type="button">Done</button>,
      },
    );
    expect(screen.getByRole("alert").textContent).toBe("You're out of credits — the run stopped. The cards painted so far are saved.");
    expect(screen.getByRole("button", { name: "Continue the run" })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/batch|made/);
  });

  it("Bulk Customize keeps its own: made cards, a batch", () => {
    panel();
    expect(screen.getByRole("progressbar", { name: "Cards made" })).toBeTruthy();
    expect(screen.getByLabelText("Made")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Stop after the cards being made" })).toBeTruthy();
    cleanup();
    panel({ running: false, paused: true, stoppedBy: "CARD_CAPACITY" }, { paused: true });
    expect(screen.getByRole("alert").textContent).toBe("Your card limit is full — the batch stopped. The cards made so far are saved.");
    expect(screen.getByRole("button", { name: "Continue the batch" })).toBeTruthy();
  });
});
