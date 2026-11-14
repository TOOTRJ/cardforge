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
const saveWords = vi.hoisted(() => vi.fn());
vi.mock("@/lib/tools/re-art/actions", () => ({ saveReartCardWordsAction: saveWords }));

import { ReartCardGrid, gridFilterOf } from "@/components/tools/re-art/reart-card-grid";
import { ReartStylePanel, starterPrompt } from "@/components/tools/re-art/reart-style-panel";
import { ReartCardWordsDialog } from "@/components/tools/re-art/reart-card-words-dialog";
import { REART_NO_FRAME_LINE, reartStyleBlock, type NormalReartStyle } from "@/lib/tools/re-art/model";
import { act } from "@testing-library/react";
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
  words: null,
  rulesText: null,
  flavorText: null,
  credits: 1,
  ...over,
});

function grid(
  entries: ReartStudioEntry[],
  over: {
    paintBlocked?: string | null;
    onPaintOne?: (e: ReartStudioEntry) => void;
    onEditWords?: (e: ReartStudioEntry) => void;
    locked?: boolean;
  } = {},
) {
  return render(
    <ReartCardGrid
      entries={entries}
      username="dev_free"
      filter="all"
      onFilter={() => undefined}
      sample={new Set()}
      onToggleSample={() => undefined}
      busy={null}
      locked={over.locked ?? false}
      paintBlocked={over.paintBlocked ?? null}
      onPaintOne={over.onPaintOne ?? (() => undefined)}
      onEditWords={over.onEditWords}
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
        style={{ preset: "watercolor", theme: "a neon harbour", mode: "preset", prompt: "" }}
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

describe("a card's own words in the list (0209)", () => {
  it("each paintable card offers its own words; a card that has some says so", () => {
    const onEditWords = vi.fn();
    const plain = entry();
    const { unmount } = grid([plain], { onEditWords });
    expect(screen.queryByText("Own words")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Its own words…/ }));
    expect(onEditWords).toHaveBeenCalledWith(plain);
    unmount();
    grid([entry({ words: { text: "a goblin chef", only: false } })], { onEditWords });
    expect(screen.getByText("Own words")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Edit its words…/ })).toBeTruthy();
    cleanup();
    grid([entry({ words: { text: "a lighthouse", only: true } })], { onEditWords });
    expect(screen.getByText("Only its own words")).toBeTruthy();
  });

  it("is off while a run is going, and not offered for a card a run never paints", () => {
    const onEditWords = vi.fn();
    grid([entry()], { onEditWords, locked: true });
    const link = screen.getByRole("button", { name: /Its own words…/ });
    expect(link.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(link);
    expect(onEditWords).not.toHaveBeenCalled();
    cleanup();
    grid([entry({ kind: "skip", skipMessage: "Another creator's card keeps its own art." })], { onEditWords });
    expect(screen.queryByRole("button", { name: /own words|its words/i })).toBeNull();
  });
});

describe("the style form — the maker's own prompt (0209)", () => {
  const TEMPLATE: NormalReartStyle = { preset: "watercolor", theme: "a drowned city", mode: "preset", prompt: "" };
  const OWN: NormalReartStyle = { ...TEMPLATE, mode: "custom", prompt: "An oil painting of {card}" };

  function panel(style: NormalReartStyle, over: { onChange?: (next: NormalReartStyle) => void; preview?: Parameters<typeof ReartStylePanel>[0]["preview"] } = {}) {
    return render(
      <ReartStylePanel
        style={style}
        onChange={over.onChange ?? (() => undefined)}
        dirty
        saved={false}
        saving={false}
        onSave={() => undefined}
        problem={null}
        saveError={null}
        paintedInSaved={0}
        preview={over.preview}
      />,
    );
  }

  it("the template shows the preset, the deck's world and the block every prompt shares — no prompt box", () => {
    panel(TEMPLATE);
    expect(screen.getByRole("radiogroup", { name: "Style" })).toBeTruthy();
    expect(screen.getByText(reartStyleBlock(TEMPLATE))).toBeTruthy();
    expect(screen.queryByLabelText("The deck's prompt")).toBeNull();
  });

  it("“Write my own prompt” starts from the look the form shows, so switching loses nothing", () => {
    const onChange = vi.fn();
    panel(TEMPLATE, { onChange });
    fireEvent.click(screen.getByRole("radio", { name: /Write my own prompt/ }));
    expect(onChange).toHaveBeenCalledWith({ ...TEMPLATE, mode: "custom", prompt: starterPrompt(TEMPLATE) });
    expect(starterPrompt(TEMPLATE)).toBe(`{card}. ${reartStyleBlock(TEMPLATE)}`);
    // A prompt already written is kept as it is on a switch back and forth.
    cleanup();
    const again = vi.fn();
    panel({ ...OWN, mode: "preset" }, { onChange: again });
    fireEvent.click(screen.getByRole("radio", { name: /Write my own prompt/ }));
    expect(again).toHaveBeenCalledWith(OWN);
  });

  it("the maker's own prompt: a box for every word, the card's facts one press away, and no template controls", () => {
    vi.stubGlobal("requestAnimationFrame", (run: () => void) => {
      run();
      return 0;
    });
    const onChange = vi.fn();
    panel(OWN, { onChange });
    const box = screen.getByLabelText("The deck's prompt") as HTMLTextAreaElement;
    expect(box.value).toBe("An oil painting of {card}");
    expect(box.maxLength).toBe(1500);
    expect(screen.queryByRole("radiogroup", { name: "Style" })).toBeNull();
    fireEvent.change(box, { target: { value: "Thick paint" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...OWN, prompt: "Thick paint" });
    // A brace name goes in where the caret is.
    box.setSelectionRange(3, 3);
    fireEvent.click(screen.getByRole("button", { name: /Add \{name\}/ }));
    expect(onChange).toHaveBeenLastCalledWith({ ...OWN, prompt: "An {name}oil painting of {card}" });
    expect(document.activeElement).toBe(box);
    vi.unstubAllGlobals();
  });

  it("warns when the prompt names no card, and shows one card's whole prompt as it is sent", () => {
    const { unmount } = panel({ ...OWN, prompt: "Thick oil paint, candle light" });
    expect(screen.getByText(/names no card, so every card is painted from the same words/)).toBeTruthy();
    expect(screen.getByText(`Your prompt, then: ${REART_NO_FRAME_LINE}`)).toBeTruthy();
    unmount();
    panel(OWN, { preview: { name: "Krenko, Mob Boss", prompt: `An oil painting of "Krenko, Mob Boss". ${REART_NO_FRAME_LINE}`, partial: true } });
    expect(screen.queryByText(/names no card/)).toBeNull();
    expect(screen.getByText("What is sent for Krenko, Mob Boss")).toBeTruthy();
    expect(screen.getByText(`An oil painting of "Krenko, Mob Boss". ${REART_NO_FRAME_LINE}`)).toBeTruthy();
    expect(screen.getByText(/A real card's flavour and rules text are read when it is painted/)).toBeTruthy();
  });
});

describe("a card's own words — the dialog (0209)", () => {
  const DECK = "00000000-0000-4000-8000-0000000000d1";
  const STYLE: NormalReartStyle = { preset: "watercolor", theme: "a drowned city", mode: "preset", prompt: "" };

  function dialog(card: ReartStudioEntry, onSaved = vi.fn(), style: NormalReartStyle = STYLE) {
    render(<ReartCardWordsDialog open onOpenChange={() => undefined} deckId={DECK} entry={card} style={style} onSaved={onSaved} />);
    return onSaved;
  }
  const box = () => screen.getByLabelText("This card's own words") as HTMLTextAreaElement;
  const preview = () => screen.getByLabelText("What is sent for this card").textContent ?? "";
  const press = async (name: string | RegExp) => {
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name }));
    });
  };

  it("shows the prompt exactly as it would be sent, as the words are written", () => {
    dialog(entry({ flavorText: "Scales like slate." }));
    // No words: the template's own subject.
    expect(preview()).toContain('Trading-card illustration of "Thornback Wyrm", a Creature — Wyrm. Its mood: Scales like slate.');
    fireEvent.change(box(), { target: { value: "a wyrm coiled round a lighthouse" } });
    expect(preview().startsWith("a wyrm coiled round a lighthouse. Rendered strictly in watercolor style.")).toBe(true);
    expect(preview()).not.toContain("Trading-card illustration");
    // Only these words: the deck's style is left out.
    fireEvent.click(screen.getByRole("checkbox", { name: /Use only these words for this card/ }));
    expect(preview()).toBe(`a wyrm coiled round a lighthouse. ${REART_NO_FRAME_LINE}`);
  });

  it("previews in the maker's own deck prompt when that is the deck's", () => {
    dialog(entry(), vi.fn(), { ...STYLE, mode: "custom", prompt: "An oil painting of {card}, candle-lit" });
    fireEvent.change(box(), { target: { value: "a wyrm asleep" } });
    expect(preview()).toBe(`An oil painting of a wyrm asleep, candle-lit. ${REART_NO_FRAME_LINE}`);
  });

  it("saves the words for the card's ENTRY and hands back what the server kept", async () => {
    saveWords.mockReset();
    saveWords.mockResolvedValue({ ok: true, words: { text: "a wyrm asleep", only: true } });
    const card = entry();
    const onSaved = dialog(card);
    // Nothing to save yet.
    expect(screen.getByRole("button", { name: "Save words" }).getAttribute("aria-disabled")).toBe("true");
    await press("Save words");
    expect(saveWords).not.toHaveBeenCalled();
    fireEvent.change(box(), { target: { value: "a wyrm asleep" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /Use only these words/ }));
    await press("Save words");
    expect(saveWords).toHaveBeenCalledWith(DECK, card.id, { text: "a wyrm asleep", only: true });
    expect(onSaved).toHaveBeenCalledWith({ text: "a wyrm asleep", only: true });
  });

  it("opens on the card's stored words, removes them, and says when a painted card needs a re-roll", async () => {
    saveWords.mockReset();
    saveWords.mockResolvedValue({ ok: true, words: null });
    const card = entry({ state: "in_style", words: { text: "a goblin chef", only: false } });
    const onSaved = dialog(card);
    expect(box().value).toBe("a goblin chef");
    expect(screen.getByText(/re-roll it to paint it with these words/)).toBeTruthy();
    await press("Remove its words");
    expect(saveWords).toHaveBeenCalledWith(DECK, card.id, { text: "", only: false });
    expect(onSaved).toHaveBeenCalledWith(null);
  });

  it("a refusal is said on the field and nothing is handed back", async () => {
    saveWords.mockReset();
    saveWords.mockResolvedValue({ ok: false, error: "That card is no longer in this deck." });
    const onSaved = dialog(entry());
    fireEvent.change(box(), { target: { value: "a wyrm asleep" } });
    await press("Save words");
    expect(screen.getByText("That card is no longer in this deck.")).toBeTruthy();
    expect(box().getAttribute("aria-invalid")).toBe("true");
    expect(onSaved).not.toHaveBeenCalled();
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
