// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import type { ReartRunInput, ReartStudioEntry } from "@/lib/tools/re-art/model";

// ---------------------------------------------------------------------------
// Re-art deck's studio — SELECTING several cards, FILTERING the list,
// LOCKING a card (migration 0216) and UNDOING a run, with the real card
// grid, run list and undo dialog:
//
//   * the list is narrowed by a name typed, a type and the state chips
//     (which gain "Locked" once a card is locked) — one answer for the list
//     and for "Select all shown";
//   * "Select cards" turns each card's checkbox into a selection; the bar
//     paints, locks or unlocks what is picked — a locked card is never
//     handed to a paint — and leaving the mode lets go of the selection;
//   * a locked card says so, its one-card actions wait (described by the
//     lock's note) and it can be unlocked on the spot;
//   * a run that painted a card offers "Undo this run…": the dialog says
//     what would go back BEFORE anything changes, puts the cards back a few
//     a request until none remain, names what couldn't be, and hands the
//     focus back to the run's button.
// ---------------------------------------------------------------------------

const h = vi.hoisted(() => ({
  locks: vi.fn(),
  planUndo: vi.fn(),
  undo: vi.fn(),
  refresh: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  confirm: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: h.refresh, push: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={String(href)} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("sonner", () => ({ toast: { error: h.toastError, success: h.toastSuccess } }));
vi.mock("@/components/billing/upgrade-modal-provider", () => ({ useUpgradeModal: () => ({ open: vi.fn() }) }));
vi.mock("@/components/ai/use-leave-warning", () => ({ useLeaveWarning: () => undefined }));
vi.mock("@/lib/tools/track-client", () => ({ trackToolEvent: vi.fn() }));
vi.mock("@/lib/media/upload-cover", () => ({ uploadCoverImage: vi.fn() }));
vi.mock("@/lib/tools/re-art/actions", () => ({
  startReartAction: vi.fn(),
  saveReartStyleAction: vi.fn(),
  restoreReartArtAction: vi.fn(),
  planReartAction: vi.fn(),
  chooseReartPictureAction: vi.fn(),
  setReartLocksAction: h.locks,
  planUndoReartRunAction: h.planUndo,
  undoReartRunAction: h.undo,
}));
vi.mock("@/components/tools/bulk-customize/use-bulk-runner", () => ({
  useBulkRunner: () => ({ steps: [], running: false, waitingUntil: null, stoppedBy: null, error: null, paused: false, runsEnded: 0, stop: vi.fn(), retryFailed: vi.fn() }),
}));
vi.mock("@/components/tools/bulk-customize/bulk-progress", () => ({ BulkProgress: () => null }));
vi.mock("@/components/tools/re-art/reart-style-panel", () => ({ ReartStylePanel: () => null }));
vi.mock("@/components/tools/re-art/reart-card-words-dialog", () => ({ ReartCardWordsDialog: () => null }));
vi.mock("@/components/tools/re-art/reart-earlier-pictures-dialog", () => ({ ReartEarlierPicturesDialog: () => null }));
// The confirm is the studio's one door to a paint: what it is opened with is
// what would be planned and started.
vi.mock("@/components/tools/re-art/reart-confirm-dialog", () => ({
  ReartConfirmDialog: (props: { open: boolean; title: string; description: string; input: ReartRunInput }) => {
    if (props.open) h.confirm({ title: props.title, description: props.description, input: props.input });
    return null;
  },
}));
vi.mock("@/components/ui/local-date", () => ({ LocalDate: ({ iso }: { iso: string }) => <time dateTime={iso}>{iso.slice(0, 10)}</time> }));
vi.mock("@/components/cards/card-tile", () => ({ CardTile: ({ thumbnail }: { thumbnail: { title: string } }) => <div data-testid="tile">{thumbnail.title}</div> }));
vi.mock("@/lib/cards/preview-data", () => ({ cardToPreviewData: () => ({}) }));

import { ReartStudio } from "@/components/tools/re-art/reart-studio";
import { ReartCardGrid, gridFilterOf, shownEntries, type ReartGridFilter } from "@/components/tools/re-art/reart-card-grid";
import { ReartRunList } from "@/components/tools/re-art/reart-run-list";
import { REART_UNDO_NO_REFUND_COPY } from "@/lib/tools/re-art/model";

const DECK = "00000000-0000-4000-8000-0000000000d1";
const E = (n: number) => `00000000-0000-4000-8000-0000000000e${n}`;
const RUN = "00000000-0000-4000-8000-00000000a001";
const SAVED = { preset: "watercolor", theme: "a haunted fen", mode: "preset" as const, prompt: "", version: 3 };

const entry = (n: number, over: Partial<ReartStudioEntry> = {}): ReartStudioEntry => ({
  id: E(n),
  name: `Card ${n}`,
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
  words: null,
  rulesText: null,
  flavorText: null,
  credits: 1,
  paintedBy: null,
  restyled: false,
  ...over,
});

/** A wyrm, a land, a locked painted card, a real card and one a run never paints. */
const DECK_ENTRIES = () => [
  entry(1, { name: "Thornback Wyrm" }),
  entry(2, { name: "Mossy Fen", bucket: "land", typeLine: "Land" }),
  entry(3, {
    name: "Archivist of Lost Hours",
    state: "in_style",
    locked: true,
    canRestore: true,
    earlier: [{ id: "f1", artUrl: "https://x/ai-1.jpg", backArtUrl: null, paintedBy: null, restyled: false, earlierStyle: false, paintedAt: "2026-11-11T10:00:00Z" }],
  }),
  entry(4, { name: "Sol Ring", kind: "printing", bucket: "permanent" }),
  entry(5, { name: "Cinderwing Matriarch", kind: "skip", skipMessage: "Another creator's card keeps its own art." }),
];

type Selection = NonNullable<Parameters<typeof ReartCardGrid>[0]["selection"]>;

/** The grid on its own, holding the selection and the state chip as the studio does. */
function Grid({
  entries,
  spy,
  running = false,
  working = false,
  paintBlocked = null,
  withSelection = true,
}: {
  entries: ReartStudioEntry[];
  spy: { onPaint: Selection["onPaint"]; onLock: Selection["onLock"]; onPaintOne?: (e: ReartStudioEntry) => void; onRestore?: (e: ReartStudioEntry) => void; onEarlier?: (e: ReartStudioEntry) => void; onToggleSample?: (id: string) => void };
  running?: boolean;
  working?: boolean;
  paintBlocked?: string | null;
  withSelection?: boolean;
}) {
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [filter, setFilter] = React.useState<ReartGridFilter>("all");
  return (
    <ReartCardGrid
      entries={entries}
      username="dev_pro"
      filter={filter}
      onFilter={setFilter}
      sample={new Set()}
      onToggleSample={spy.onToggleSample ?? (() => undefined)}
      busy={null}
      locked={running}
      paintBlocked={paintBlocked}
      onPaintOne={spy.onPaintOne ?? (() => undefined)}
      onEarlier={spy.onEarlier ?? (() => undefined)}
      onRestore={spy.onRestore ?? (() => undefined)}
      selection={withSelection ? { selected, onSelected: setSelected, onPaint: spy.onPaint, onLock: spy.onLock, working } : undefined}
    />
  );
}
import * as React from "react";

const spies = () => ({ onPaint: vi.fn(), onLock: vi.fn(), onPaintOne: vi.fn(), onRestore: vi.fn(), onEarlier: vi.fn(), onToggleSample: vi.fn() });
const names = () => screen.getAllByRole("listitem").map((item) => item.querySelector("p")?.textContent);
const off = (element: Element | null) => element?.getAttribute("aria-disabled") === "true";
const button = (name: string | RegExp) => screen.getByRole("button", { name });
const bar = () => within(screen.getByRole("group", { name: "Selected cards" }));
/** A checkbox's name is its label's words and the card's name (read out after them). */
const box = (words: string, name: string) =>
  screen.getAllByRole("checkbox").find((input) => {
    const label = input.closest("label")?.textContent ?? "";
    return label.startsWith(words) && label.includes(name);
  }) as HTMLInputElement;
const select = (name: string) => fireEvent.click(box("Select", name));
/** One card's part of the list. */
const cardItem = (name: string) => within(screen.getAllByRole("listitem").find((item) => item.querySelector("p")?.textContent === name)!);
/** A dialog hands the focus on a tick after it closes. */
const settled = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

beforeEach(() => {
  for (const fn of Object.values(h)) fn.mockReset();
});
afterEach(cleanup);

describe("narrowing the list", () => {
  it("a name typed, a type and a state chip each narrow it — together", () => {
    render(<Grid entries={DECK_ENTRIES()} spy={spies()} />);
    expect(names()).toHaveLength(5);
    fireEvent.change(screen.getByRole("searchbox", { name: "Find a card" }), { target: { value: "  FEN " } });
    expect(names()).toEqual(["Mossy Fen"]);
    fireEvent.change(screen.getByRole("searchbox", { name: "Find a card" }), { target: { value: "" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Type" }), { target: { value: "creature" } });
    expect(names()).toEqual(["Thornback Wyrm", "Archivist of Lost Hours", "Cinderwing Matriarch"]);
    fireEvent.click(screen.getByRole("radio", { name: /To paint/ }));
    expect(names()).toEqual(["Thornback Wyrm"]);
    fireEvent.change(screen.getByRole("searchbox", { name: "Find a card" }), { target: { value: "zzz" } });
    expect(screen.getByText("No cards here.")).toBeTruthy();
  });

  it("offers only the types the deck has, and no type list for a deck of one type", () => {
    const { unmount } = render(<Grid entries={DECK_ENTRIES()} spy={spies()} />);
    const options = within(screen.getByRole("combobox", { name: "Type" })).getAllByRole("option").map((option) => option.textContent);
    expect(options).toEqual(["All types", "Creatures", "Artifacts and enchantments", "Lands"]);
    unmount();
    render(<Grid entries={[entry(1), entry(2)]} spy={spies()} />);
    expect(screen.queryByRole("combobox", { name: "Type" })).toBeNull();
  });

  it("“Locked” is a view of its own once a card is locked — and a locked card counts among those left as they are", () => {
    const { unmount } = render(<Grid entries={DECK_ENTRIES()} spy={spies()} />);
    expect(screen.getByRole("radio", { name: "Locked (1)" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Left as they are (2)" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "In this style (0)" })).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "Locked (1)" }));
    expect(names()).toEqual(["Archivist of Lost Hours"]);
    unmount();
    render(<Grid entries={[entry(1)]} spy={spies()} />);
    expect(screen.queryByRole("radio", { name: /Locked/ })).toBeNull();
    expect(gridFilterOf(entry(1, { state: "in_style", locked: true }))).toBe("skipped");
    expect(gridFilterOf(entry(1, { locked: true }))).toBe("skipped");
  });

  it("the list and “Select all shown” read one answer (shownEntries)", () => {
    const all = DECK_ENTRIES();
    const ids = (view: Parameters<typeof shownEntries>[1]) => shownEntries(all, view).map((e) => e.name);
    expect(ids({ filter: "all", bucket: "all", query: "" })).toHaveLength(5);
    expect(ids({ filter: "locked", bucket: "all", query: "" })).toEqual(["Archivist of Lost Hours"]);
    expect(ids({ filter: "locked", bucket: "land", query: "" })).toEqual([]);
    expect(ids({ filter: "todo", bucket: "all", query: "" })).toEqual(["Thornback Wyrm", "Mossy Fen", "Sol Ring"]);
    expect(ids({ filter: "skipped", bucket: "all", query: "a" })).toEqual(["Archivist of Lost Hours", "Cinderwing Matriarch"]);
    expect(ids({ filter: "all", bucket: "permanent", query: "SOL" })).toEqual(["Sol Ring"]);
  });
});

describe("selecting several cards", () => {
  it("is a mode: each card's checkbox picks it, and the bar says how many are picked", () => {
    render(<Grid entries={DECK_ENTRIES()} spy={spies()} />);
    expect(screen.queryByRole("group", { name: "Selected cards" })).toBeNull();
    expect(screen.getAllByRole("checkbox", { name: /In the sample/ })).toHaveLength(4);
    const mode = button("Select cards");
    expect(mode.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(mode);
    expect(button("Done selecting").getAttribute("aria-pressed")).toBe("true");
    // A card a run never paints can't be picked.
    expect(screen.getAllByRole("checkbox").map((input) => input.closest("label")?.textContent)).toEqual([
      "Select: Thornback Wyrm",
      "Select: Mossy Fen",
      "Select: Archivist of Lost Hours",
      "Select: Sol Ring",
    ]);
    expect(bar().getByRole("status").textContent).toBe("0 selected");
    select("Thornback Wyrm");
    select("Sol Ring");
    expect(bar().getByRole("status").textContent).toBe("2 selected");
    select("Sol Ring");
    expect(bar().getByRole("status").textContent).toBe("1 selected");
  });

  it("“Paint selected…” hands the picked cards on — never a locked one", () => {
    const spy = spies();
    render(<Grid entries={DECK_ENTRIES()} spy={spy} />);
    fireEvent.click(button("Select cards"));
    expect(off(bar().getByRole("button", { name: "Paint selected…" }))).toBe(true);
    fireEvent.click(bar().getByRole("button", { name: "Paint selected…" }));
    expect(spy.onPaint).not.toHaveBeenCalled();
    select("Thornback Wyrm");
    select("Archivist of Lost Hours");
    select("Sol Ring");
    fireEvent.click(bar().getByRole("button", { name: "Paint selected…" }));
    expect(spy.onPaint.mock.calls[0][0].map((e: ReartStudioEntry) => e.name)).toEqual(["Thornback Wyrm", "Sol Ring"]);
  });

  it("“Select all shown” picks what the list shows that a run can paint, and adds to what is picked; “Clear” lets go", () => {
    render(<Grid entries={DECK_ENTRIES()} spy={spies()} />);
    fireEvent.click(button("Select cards"));
    select("Sol Ring");
    fireEvent.change(screen.getByRole("combobox", { name: "Type" }), { target: { value: "creature" } });
    fireEvent.click(bar().getByRole("button", { name: "Select all shown" }));
    // The two creatures a run can paint (not the other creator's card), and Sol Ring still.
    expect(bar().getByRole("status").textContent).toBe("3 selected");
    fireEvent.change(screen.getByRole("combobox", { name: "Type" }), { target: { value: "all" } });
    expect(screen.getAllByRole("checkbox").filter((input) => (input as HTMLInputElement).checked)).toHaveLength(3);
    fireEvent.click(bar().getByRole("button", { name: "Clear" }));
    expect(bar().getByRole("status").textContent).toBe("0 selected");
  });

  it("locks the picked cards that aren't locked, unlocks the ones that are", () => {
    const spy = spies();
    render(<Grid entries={DECK_ENTRIES()} spy={spy} />);
    fireEvent.click(button("Select cards"));
    expect(off(bar().getByRole("button", { name: "Lock" }))).toBe(true);
    expect(off(bar().getByRole("button", { name: "Unlock" }))).toBe(true);
    select("Thornback Wyrm");
    select("Archivist of Lost Hours");
    fireEvent.click(bar().getByRole("button", { name: "Lock" }));
    fireEvent.click(bar().getByRole("button", { name: "Unlock" }));
    expect(spy.onLock.mock.calls.map(([picked, lock]) => [picked.map((e: ReartStudioEntry) => e.name), lock])).toEqual([
      [["Thornback Wyrm"], true],
      [["Archivist of Lost Hours"], false],
    ]);
  });

  it("leaving the mode lets go of the selection: what nobody can see is never acted on later", () => {
    const spy = spies();
    render(<Grid entries={DECK_ENTRIES()} spy={spy} />);
    fireEvent.click(button("Select cards"));
    select("Thornback Wyrm");
    fireEvent.click(button("Done selecting"));
    expect(screen.queryByRole("group", { name: "Selected cards" })).toBeNull();
    expect(screen.getAllByRole("checkbox", { name: /In the sample/ })).toHaveLength(4);
    fireEvent.click(button("Select cards"));
    expect(bar().getByRole("status").textContent).toBe("0 selected");
  });

  it("waits while a run paints or a lock is on its way; a paint that can't start says why", () => {
    const spy = spies();
    const { unmount } = render(<Grid entries={DECK_ENTRIES()} spy={spy} running />);
    fireEvent.click(button("Select cards"));
    select("Thornback Wyrm");
    select("Archivist of Lost Hours");
    for (const name of ["Lock", "Unlock", "Paint selected…"]) {
      expect(off(bar().getByRole("button", { name }))).toBe(true);
      fireEvent.click(bar().getByRole("button", { name }));
    }
    unmount();
    render(<Grid entries={DECK_ENTRIES()} spy={spy} working />);
    fireEvent.click(button("Select cards"));
    select("Thornback Wyrm");
    for (const name of ["Lock", "Paint selected…"]) fireEvent.click(bar().getByRole("button", { name }));
    expect(spy.onLock).not.toHaveBeenCalled();
    expect(spy.onPaint).not.toHaveBeenCalled();
    cleanup();
    render(<Grid entries={DECK_ENTRIES()} spy={spy} paintBlocked="Save the deck's style first." />);
    fireEvent.click(button("Select cards"));
    select("Thornback Wyrm");
    const paint = bar().getByRole("button", { name: "Paint selected…" });
    expect(off(paint)).toBe(true);
    expect(document.getElementById(paint.getAttribute("aria-describedby") ?? "")?.textContent).toBe("Save the deck's style first.");
  });

  it("the list on its own (no selection handed in) offers neither selecting nor locking", () => {
    render(<Grid entries={DECK_ENTRIES()} spy={spies()} withSelection={false} />);
    expect(screen.queryByRole("button", { name: "Select cards" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^(Lock|Unlock)/ })).toBeNull();
  });
});

describe("a locked card", () => {
  it("says so, and its one-card actions wait — described by what a lock means — until it is unlocked", () => {
    const spy = spies();
    render(<Grid entries={DECK_ENTRIES()} spy={spy} />);
    const card = cardItem("Archivist of Lost Hours");
    expect(card.getByText("Locked")).toBeTruthy();
    const note = screen.getByText(/A locked card is left as it is by everything here/);
    for (const name of [/Re-roll…/, /Earlier pictures/, /Old art back/]) {
      const action = card.getByRole("button", { name });
      expect(off(action)).toBe(true);
      expect(action.getAttribute("aria-describedby")).toContain(note.id);
      fireEvent.click(action);
    }
    const sample = card.getByRole("checkbox", { name: /In the sample/ });
    expect(off(sample)).toBe(true);
    fireEvent.click(sample);
    for (const fn of [spy.onPaintOne, spy.onEarlier, spy.onRestore, spy.onToggleSample]) expect(fn).not.toHaveBeenCalled();
    // An unlocked card beside it is untouched by the lock.
    const other = cardItem("Thornback Wyrm");
    expect(off(other.getByRole("button", { name: /Paint this one…/ }))).toBe(false);
    expect(other.queryByText("Locked")).toBeNull();
  });

  it("each card can be locked or unlocked on the spot; a card a run never paints has no lock", () => {
    const spy = spies();
    render(<Grid entries={DECK_ENTRIES()} spy={spy} />);
    fireEvent.click(button("Unlock — Archivist of Lost Hours"));
    fireEvent.click(button("Lock — Sol Ring"));
    expect(spy.onLock.mock.calls.map(([picked, lock]) => [picked.map((e: ReartStudioEntry) => e.name), lock])).toEqual([
      [["Archivist of Lost Hours"], false],
      [["Sol Ring"], true],
    ]);
    expect(screen.queryByRole("button", { name: /Lock — Cinderwing Matriarch/ })).toBeNull();
  });

  it("a deck with no locked card says nothing about locks", () => {
    render(<Grid entries={[entry(1)]} spy={spies()} />);
    expect(screen.queryByText(/A locked card is left as it is/)).toBeNull();
  });
});

function studio(entries: ReartStudioEntry[] = DECK_ENTRIES(), runs: Parameters<typeof ReartStudio>[0]["runs"] = []) {
  return render(
    <ReartStudio
      deck={{ id: DECK, slug: "embers", title: "Embers of the Fen" }}
      storedStyle={SAVED}
      entries={entries}
      username="dev_pro"
      capacity={null}
      balance={20}
      aiAvailable
      pausedRunId={null}
      runs={runs}
    />,
  );
}

describe("the studio: what a selection and a lock do", () => {
  it("several picked cards open ONE confirm that names exactly those entries — priced there, nothing charged before", () => {
    studio();
    fireEvent.click(button("Select cards"));
    select("Thornback Wyrm");
    select("Sol Ring");
    select("Archivist of Lost Hours"); // locked: never painted
    fireEvent.click(bar().getByRole("button", { name: "Paint selected…" }));
    const opened = h.confirm.mock.calls.at(-1)![0];
    expect(opened.title).toBe("Paint 2 selected cards");
    expect(opened.description).toMatch(/Nothing is charged until you press Paint\.$/);
    expect(opened.input).toMatchObject({ deckId: DECK, entryIds: [E(1), E(4)], scope: "all" });
    // No style rides along: selected cards are painted in the deck's SAVED style.
    expect(opened.input.style).toBeUndefined();
  });

  it("one picked card is the one-card paint", () => {
    studio();
    fireEvent.click(button("Select cards"));
    select("Thornback Wyrm");
    fireEvent.click(bar().getByRole("button", { name: "Paint selected…" }));
    expect(h.confirm.mock.calls.at(-1)![0]).toMatchObject({ title: "Paint Thornback Wyrm", input: { entryIds: [E(1)] } });
  });

  it("locking asks the server for exactly those entries, says what it did and re-reads the page", async () => {
    h.locks.mockResolvedValue({ ok: true, changed: 1 });
    studio();
    await act(async () => {
      fireEvent.click(button("Lock — Thornback Wyrm"));
    });
    expect(h.locks.mock.calls).toEqual([[DECK, [E(1)], true]]);
    expect(h.toastSuccess).toHaveBeenCalledWith("Thornback Wyrm locked: the tool leaves it as it is.");
    expect(h.refresh).toHaveBeenCalledTimes(1);
    await act(async () => {
      fireEvent.click(button("Unlock — Archivist of Lost Hours"));
    });
    expect(h.locks.mock.calls[1]).toEqual([DECK, [E(3)], false]);
    expect(h.toastSuccess).toHaveBeenLastCalledWith("Archivist of Lost Hours unlocked.");
  });

  it("a refusal — or a lost connection — is said, and nothing is re-read", async () => {
    h.locks.mockResolvedValueOnce({ ok: false, error: "Couldn't lock that card — try again." });
    studio();
    await act(async () => {
      fireEvent.click(button("Lock — Thornback Wyrm"));
    });
    expect(h.toastError).toHaveBeenCalledWith("Couldn't lock that card — try again.");
    h.locks.mockRejectedValueOnce(new Error("offline"));
    await act(async () => {
      fireEvent.click(button("Lock — Thornback Wyrm"));
    });
    expect(h.toastError).toHaveBeenLastCalledWith("We couldn't reach PipGlyph — try again.");
    expect(h.refresh).not.toHaveBeenCalled();
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("a card just locked leaves the sample: a sample never paints it", async () => {
    h.locks.mockResolvedValue({ ok: true, changed: 1 });
    studio();
    const inSample = () => box("In the sample", "Thornback Wyrm").checked;
    // The studio starts a sample for the maker; make sure this card is in it.
    if (!inSample()) fireEvent.click(box("In the sample", "Thornback Wyrm"));
    expect(inSample()).toBe(true);
    await act(async () => {
      fireEvent.click(button("Lock — Thornback Wyrm"));
    });
    expect(inSample()).toBe(false);
  });
});

describe("undoing a run", () => {
  const runs = [
    { id: RUN, deckId: DECK, createdAt: "2026-11-12T10:00:00Z", cards: 4, made: 3, failed: 1, waiting: 0, sample: false, status: "completed" },
    { id: "00000000-0000-4000-8000-00000000a002", deckId: DECK, createdAt: "2026-11-11T10:00:00Z", cards: 2, made: 0, failed: 2, waiting: 0, sample: true, status: "failed" },
  ];
  const PLAN = {
    ok: true,
    earlier: 1,
    own: 1,
    real: 1,
    skipped: [{ name: "Mossy Fen", reason: "Locked — left as it is." }],
  };
  const undoButton = () => screen.getByRole("button", { name: "Undo this run…" });
  const open = async () => {
    await act(async () => {
      fireEvent.click(undoButton());
    });
    return screen.getByRole("dialog", { name: "Undo this run" });
  };

  it("only a run that painted a card offers it, named by its date for a screen reader; the tool page's list offers none", () => {
    const { unmount } = render(<ReartRunList runs={runs} onUndo={vi.fn()} />);
    const buttons = screen.getAllByRole("button", { name: "Undo this run…" });
    expect(buttons).toHaveLength(1);
    expect(document.getElementById(buttons[0].getAttribute("aria-describedby") ?? "")?.textContent).toBe("2026-11-12");
    unmount();
    render(<ReartRunList runs={runs} />);
    expect(screen.queryByRole("button", { name: /Undo/ })).toBeNull();
  });

  it("waits while a run paints", () => {
    const onUndo = vi.fn();
    render(<ReartRunList runs={runs} onUndo={onUndo} undoHeld />);
    expect(off(undoButton())).toBe(true);
    fireEvent.click(undoButton());
    expect(onUndo).not.toHaveBeenCalled();
  });

  it("says what would go back, what is left and that no credit returns — BEFORE anything changes", async () => {
    h.planUndo.mockResolvedValue(PLAN);
    studio(DECK_ENTRIES(), runs);
    const dialog = await open();
    expect(h.planUndo.mock.calls).toEqual([[RUN]]);
    const text = dialog.textContent ?? "";
    expect(text).toContain("Puts 3 cards back");
    expect(text).toContain("1 card goes back to the picture it had before this run.");
    expect(text).toContain("1 card gets its own art back.");
    expect(text).toContain("1 card goes back to being the real card in the deck.");
    expect(text).toContain(REART_UNDO_NO_REFUND_COPY);
    expect(text).toContain("1 left as it is");
    expect(text).toContain("Mossy Fen — Locked — left as it is.");
    expect(within(dialog).getByRole("button", { name: "Undo 3 cards" })).toBeTruthy();
    expect(h.undo).not.toHaveBeenCalled();
  });

  it("puts the cards back a few a request until none remain, then says so and re-reads the page", async () => {
    h.planUndo.mockResolvedValueOnce({ ...PLAN, earlier: 5, own: 3, real: 0, skipped: [] }).mockResolvedValue({ ok: true, earlier: 0, own: 0, real: 0, skipped: [] });
    h.undo.mockResolvedValueOnce({ ok: true, undone: 6, failed: [], remaining: 2 }).mockResolvedValueOnce({ ok: true, undone: 2, failed: [], remaining: 0 });
    studio(DECK_ENTRIES(), runs);
    const dialog = await open();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Undo 8 cards" }));
    });
    expect(h.undo.mock.calls).toEqual([
      [RUN, []],
      [RUN, []],
    ]);
    expect(h.toastSuccess).toHaveBeenCalledWith("8 cards put back.");
    expect(h.refresh).toHaveBeenCalledTimes(1);
    // The dialog says what it did; read again, nothing of the run is left,
    // and the button is off.
    expect(within(dialog).getAllByRole("status").map((status) => status.textContent)).toContain("8 cards put back.");
    expect(dialog.textContent).toContain("Nothing of this run is left to undo");
    const again = within(dialog).getByRole("button", { name: "Undo" });
    expect(off(again)).toBe(true);
    fireEvent.click(again);
    expect(h.undo).toHaveBeenCalledTimes(2);
  });

  it("the cards it just put back are never listed as “left as they are”: that list stays the one shown before the undo", async () => {
    h.planUndo
      .mockResolvedValueOnce({ ...PLAN, earlier: 0, own: 2, real: 0, skipped: [{ name: "Mossy Fen", reason: "Locked — left as it is." }] })
      // Read again after the undo, the server names the two cards just put back.
      .mockResolvedValue({
        ok: true,
        earlier: 0,
        own: 0,
        real: 0,
        skipped: [
          { name: "Thornback Wyrm", reason: "It has its own art back already." },
          { name: "Sol Ring", reason: "It has its own art back already." },
          { name: "Mossy Fen", reason: "Locked — left as it is." },
        ],
      });
    h.undo.mockResolvedValueOnce({ ok: true, undone: 2, failed: [], remaining: 0 });
    studio(DECK_ENTRIES(), runs);
    const dialog = await open();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Undo 2 cards" }));
    });
    expect(dialog.textContent).toContain("2 cards put back.");
    expect(dialog.textContent).toContain("1 left as it is");
    expect(dialog.textContent).not.toContain("It has its own art back already.");
  });

  it("a card that couldn't be put back is named with why, never tried again in this undo, and the rest go back", async () => {
    const C1 = "00000000-0000-4000-8000-0000000000c1";
    h.planUndo.mockResolvedValue({ ...PLAN, earlier: 0, own: 8, real: 0, skipped: [] });
    h.undo
      .mockResolvedValueOnce({ ok: true, undone: 5, failed: [{ name: "Thornback Wyrm", reason: "It couldn't be put back — try again.", cardId: C1 }], remaining: 2 })
      .mockResolvedValueOnce({ ok: true, undone: 2, failed: [], remaining: 0 });
    studio(DECK_ENTRIES(), runs);
    const dialog = await open();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Undo 8 cards" }));
    });
    expect(h.undo.mock.calls[1]).toEqual([RUN, [C1]]);
    expect(dialog.textContent).toContain("1 card couldn't be put back and was left as it is:");
    expect(dialog.textContent).toContain("Thornback Wyrm — It couldn't be put back — try again.");
    expect(h.toastSuccess).toHaveBeenCalledWith("7 cards put back. 1 couldn't be: the dialog says why.");
  });

  it("a refusal stops it and is the dialog's alert; a request that moves nothing never loops", async () => {
    h.planUndo.mockResolvedValue({ ...PLAN, skipped: [] });
    h.undo.mockResolvedValueOnce({ ok: false, code: "BUSY", error: "A run of this deck is painting a card — wait for it, then try again." });
    studio(DECK_ENTRIES(), runs);
    const dialog = await open();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Undo 3 cards" }));
    });
    expect(within(dialog).getByRole("alert").textContent).toBe("A run of this deck is painting a card — wait for it, then try again.");
    expect(h.undo).toHaveBeenCalledTimes(1);
    expect(h.refresh).not.toHaveBeenCalled();
    h.undo.mockReset();
    h.undo.mockResolvedValue({ ok: true, undone: 0, failed: [], remaining: 3 });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Undo 3 cards" }));
    });
    expect(h.undo).toHaveBeenCalledTimes(1);
  });

  it("a run that can't be read says so, with nothing to press", async () => {
    h.planUndo.mockResolvedValue({ ok: false, error: "That run isn't one of yours." });
    studio(DECK_ENTRIES(), runs);
    const dialog = await open();
    expect(within(dialog).getByRole("alert").textContent).toBe("That run isn't one of yours.");
    expect(off(within(dialog).getByRole("button", { name: "Undo" }))).toBe(true);
  });

  it("closed, the focus goes back to the run's Undo button", async () => {
    h.planUndo.mockResolvedValue(PLAN);
    studio(DECK_ENTRIES(), runs);
    const dialog = await open();
    await act(async () => {
      fireEvent.click(within(dialog).getAllByRole("button", { name: "Close" })[0]);
    });
    await settled();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(undoButton());
  });
});
