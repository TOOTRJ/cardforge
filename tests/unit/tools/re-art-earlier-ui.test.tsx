// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import type { ReartEarlierPicture, ReartStudioEntry } from "@/lib/tools/re-art/model";

// ---------------------------------------------------------------------------
// Re-art deck's studio — a card's EARLIER PICTURES (migration 0215), with
// the real card grid and the real dialog:
//
//   * a card with kept pictures has an "Earlier pictures (n)…" button; one
//     with none has no such button;
//   * the dialog shows the picture on the card now and each earlier one,
//     says which is of an earlier style and how many are kept, and "Use
//     this one" asks the server for exactly that picture — nothing else;
//   * a refusal is said in the dialog and it stays open; a pick closes it
//     and the page re-reads;
//   * while a run paints, the button waits like every one-card action.
// ---------------------------------------------------------------------------

const h = vi.hoisted(() => ({
  choose: vi.fn(),
  refresh: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: h.refresh, push: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={String(href)} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: h.toastSuccess } }));
vi.mock("@/components/billing/upgrade-modal-provider", () => ({ useUpgradeModal: () => ({ open: vi.fn() }) }));
vi.mock("@/components/ai/use-leave-warning", () => ({ useLeaveWarning: () => undefined }));
vi.mock("@/lib/tools/track-client", () => ({ trackToolEvent: vi.fn() }));
vi.mock("@/lib/media/upload-cover", () => ({ uploadCoverImage: vi.fn() }));
vi.mock("@/lib/tools/re-art/actions", () => ({
  startReartAction: vi.fn(),
  saveReartStyleAction: vi.fn(),
  restoreReartArtAction: vi.fn(),
  planReartAction: vi.fn(),
  chooseReartPictureAction: h.choose,
}));
vi.mock("@/components/tools/bulk-customize/use-bulk-runner", () => ({
  useBulkRunner: () => ({ steps: [], running: false, waitingUntil: null, stoppedBy: null, error: null, paused: false, runsEnded: 0, stop: vi.fn(), retryFailed: vi.fn() }),
}));
vi.mock("@/components/tools/bulk-customize/bulk-progress", () => ({ BulkProgress: () => null }));
vi.mock("@/components/tools/re-art/reart-style-panel", () => ({ ReartStylePanel: () => null }));
vi.mock("@/components/tools/re-art/reart-card-words-dialog", () => ({ ReartCardWordsDialog: () => null }));
vi.mock("@/components/tools/re-art/reart-confirm-dialog", () => ({ ReartConfirmDialog: () => null }));
vi.mock("@/components/tools/re-art/reart-run-list", () => ({ ReartRunList: () => null }));
// The card's own tile draws a baked card: not this test's business.
vi.mock("@/components/cards/card-tile", () => ({ CardTile: ({ thumbnail }: { thumbnail: { title: string } }) => <div data-testid="tile">{thumbnail.title}</div> }));
vi.mock("@/lib/cards/preview-data", () => ({ cardToPreviewData: () => ({}) }));

import { ReartStudio } from "@/components/tools/re-art/reart-studio";
import { ReartCardGrid } from "@/components/tools/re-art/reart-card-grid";
import { REART_ROLLS_KEPT_COPY, REART_ROW_PICTURE } from "@/lib/tools/re-art/model";

const DECK = "00000000-0000-4000-8000-0000000000d1";
const CARD = "00000000-0000-4000-8000-0000000000c1";
const ART = (n: string) => `https://x.supabase.co/storage/v1/object/public/card-art/u1/${n}`;
const SAVED = { preset: "watercolor", theme: "a haunted fen", mode: "preset" as const, prompt: "", version: 3 };

const picture = (id: string, n: number, over: Partial<ReartEarlierPicture> = {}): ReartEarlierPicture => ({
  id,
  artUrl: ART(`ai-${n}.jpg`),
  backArtUrl: null,
  paintedBy: null,
  restyled: false,
  earlierStyle: false,
  paintedAt: "2026-11-11T10:00:00Z",
  ...over,
});

const entry = (over: Partial<ReartStudioEntry> = {}): ReartStudioEntry => ({
  id: "00000000-0000-4000-8000-0000000000e1",
  name: "Thornback Wyrm",
  quantity: 1,
  board: "main",
  typeLine: "Creature — Wyrm",
  imageUrl: null,
  kind: "own",
  skipMessage: null,
  card: { id: CARD, slug: "thornback-wyrm", title: "Thornback Wyrm", art_url: ART("ai-3.jpg") } as never,
  bucket: "creature",
  state: "in_style",
  canRestore: true,
  artNow: "reart",
  words: null,
  rulesText: null,
  flavorText: null,
  credits: 1,
  paintedBy: null,
  restyled: false,
  ownPictureOnCard: true,
  earlier: [picture("00000000-0000-4000-8000-0000000000f2", 2), picture("00000000-0000-4000-8000-0000000000f1", 1, { earlierStyle: true })],
  ...over,
});

function studio(entries: ReartStudioEntry[] = [entry()]) {
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
      runs={[]}
    />,
  );
}

const opener = () => screen.queryByRole("button", { name: /Earlier pictures/ });
/** The dialog hands the focus on a tick after it closes. */
const settled = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
const open = async () => {
  await act(async () => {
    fireEvent.click(opener()!);
  });
  return screen.getByRole("dialog", { name: "Earlier pictures of Thornback Wyrm" });
};

beforeEach(() => {
  for (const fn of [h.choose, h.refresh, h.toastSuccess]) fn.mockReset();
  h.choose.mockResolvedValue({ ok: true });
});
afterEach(cleanup);

describe("the card's button", () => {
  it("says how many earlier pictures are kept, and names the card for a screen reader", () => {
    studio();
    expect(opener()?.textContent).toContain("Earlier pictures (2)…");
    expect(opener()?.textContent).toContain("Thornback Wyrm");
  });

  it("a card with none — never re-rolled, a real card, one left as it is — has no such button", () => {
    studio([entry({ earlier: [] }), entry({ id: "e2", name: "Sol Ring", kind: "printing", card: null, earlier: undefined }), entry({ id: "e3", name: "Emblem", kind: "skip", skipMessage: "Emblems keep their art.", card: null })]);
    expect(opener()).toBeNull();
  });

  it("waits while a run paints, like every one-card action (the grid's own rule)", () => {
    const onEarlier = vi.fn();
    const grid = (locked: boolean) => (
      <ReartCardGrid
        entries={[entry()]}
        username="dev_pro"
        filter="all"
        onFilter={vi.fn()}
        sample={new Set()}
        onToggleSample={vi.fn()}
        busy={null}
        locked={locked}
        onPaintOne={vi.fn()}
        onEarlier={onEarlier}
        onRestore={vi.fn()}
      />
    );
    const { rerender } = render(grid(true));
    expect(opener()?.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(opener()!);
    expect(onEarlier).not.toHaveBeenCalled();
    rerender(grid(false));
    expect(opener()?.getAttribute("aria-disabled")).toBeNull();
    fireEvent.click(opener()!);
    expect(onEarlier).toHaveBeenCalledTimes(1);
  });

  it("is not offered where the studio passes no handler (the grid on its own)", () => {
    render(
      <ReartCardGrid
        entries={[entry()]}
        username="dev_pro"
        filter="all"
        onFilter={vi.fn()}
        sample={new Set()}
        onToggleSample={vi.fn()}
        busy={null}
        locked={false}
        onPaintOne={vi.fn()}
        onRestore={vi.fn()}
      />,
    );
    expect(opener()).toBeNull();
  });
});

describe("the dialog", () => {
  it("shows the picture on the card now and each earlier one, with what it is and how many are kept", async () => {
    studio();
    const dialog = await open();
    const images = within(dialog).getAllByRole("img") as HTMLImageElement[];
    expect(images.map((image) => image.src)).toEqual([ART("ai-3.jpg"), ART("ai-2.jpg"), ART("ai-1.jpg")]);
    expect(images.map((image) => image.alt)).toEqual([
      "Thornback Wyrm — the picture on the card now",
      "Thornback Wyrm — earlier picture 1 of 2",
      "Thornback Wyrm — earlier picture 2 of 2",
    ]);
    expect(within(dialog).getByText("On the card now")).toBeTruthy();
    expect(within(dialog).getAllByText("Earlier style")).toHaveLength(1);
    expect(within(dialog).getByText(REART_ROLLS_KEPT_COPY)).toBeTruthy();
    expect(dialog.textContent).toContain("Nothing is painted or charged");
    // One button a picture, each named for its picture; none for the one on the card.
    expect(within(dialog).getAllByRole("button", { name: /^Use this one/ })).toHaveLength(2);
  });

  it("the deck's own last picture is labelled as that; a two-faced picture shows its back; who painted is said only when known", async () => {
    studio([
      entry({
        state: "changed",
        ownPictureOnCard: false,
        card: { id: CARD, slug: "thornback-wyrm", title: "Thornback Wyrm", art_url: ART("hand.png") } as never,
        earlier: [
          picture(REART_ROW_PICTURE, 3, { backArtUrl: ART("ai-3-back.jpg"), paintedBy: "Grok Imagine 2.0", restyled: true }),
          picture("00000000-0000-4000-8000-0000000000f1", 1),
        ],
      }),
    ]);
    const dialog = await open();
    expect(within(dialog).getByText("This deck's last picture")).toBeTruthy();
    expect(within(dialog).getByRole("img", { name: "Thornback Wyrm — earlier picture 1 of 2, its back face" })).toBeTruthy();
    expect(dialog.textContent).toContain("restyled by Grok Imagine 2.0");
    expect(dialog.textContent?.match(/ by /g)).toHaveLength(1);
  });

  it("“Use this one” asks the server for exactly that picture; the dialog closes, the maker is told, and the page re-reads", async () => {
    studio();
    const dialog = await open();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Use this one — earlier picture 2 of 2" }));
    });
    expect(h.choose.mock.calls).toEqual([[DECK, CARD, "00000000-0000-4000-8000-0000000000f1"]]);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(h.toastSuccess).toHaveBeenCalledWith("Thornback Wyrm shows the picture you picked.");
    expect(h.refresh).toHaveBeenCalledTimes(1);
  });

  it("closed without a pick, the focus goes back to the button that opened it — never to <body>", async () => {
    studio();
    const dialog = await open();
    await act(async () => {
      // The footer's Close (the dialog's own × is named "Close" too).
      fireEvent.click(within(dialog).getAllByRole("button", { name: "Close" })[0]);
    });
    await settled();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener());
  });

  it("after a pick the focus goes to the card's paint button (the opener can be gone once the page re-reads)", async () => {
    studio();
    const dialog = await open();
    await act(async () => {
      fireEvent.click(within(dialog).getAllByRole("button", { name: /^Use this one/ })[0]);
    });
    await settled();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /Re-roll…/ }));
  });

  it("a refusal is said in the dialog, which stays open; nothing is announced as done", async () => {
    h.choose.mockResolvedValue({ ok: false, error: "That picture is no longer kept — reload the page." });
    studio();
    const dialog = await open();
    await act(async () => {
      fireEvent.click(within(dialog).getAllByRole("button", { name: /^Use this one/ })[0]);
    });
    expect(within(screen.getByRole("dialog")).getByRole("alert").textContent).toBe("That picture is no longer kept — reload the page.");
    expect(h.toastSuccess).not.toHaveBeenCalled();
    expect(h.refresh).not.toHaveBeenCalled();
  });

  it("a request that never answered says so, and the buttons work again", async () => {
    h.choose.mockRejectedValueOnce(new Error("offline"));
    studio();
    const dialog = await open();
    const first = () => within(screen.getByRole("dialog")).getAllByRole("button", { name: /^Use this one/ })[0];
    await act(async () => {
      fireEvent.click(first());
    });
    expect(within(dialog).getByRole("alert").textContent).toMatch(/couldn't reach PipGlyph/);
    await act(async () => {
      fireEvent.click(first());
    });
    expect(h.choose).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("one pick at a time: a second press while the first is on its way asks nothing", async () => {
    let answer: (value: unknown) => void = () => undefined;
    h.choose.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    studio();
    const dialog = await open();
    const buttons = within(dialog).getAllByRole("button", { name: /^Use this one/ });
    await act(async () => {
      fireEvent.click(buttons[0]);
    });
    await act(async () => {
      fireEvent.click(buttons[1]);
    });
    expect(h.choose).toHaveBeenCalledTimes(1);
    await act(async () => {
      answer({ ok: true });
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
