// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import type { ReartSceneResult, ReartStudioEntry } from "@/lib/tools/re-art/model";

// ---------------------------------------------------------------------------
// Re-art deck's studio — an AI-WRITTEN SCENE for a card (migration 0217, one
// credit each), with the real words dialog, "Write scenes…" dialog and card
// list:
//
//   * the card's own-words dialog offers "Write a scene with AI · 1 credit",
//     says what it does BEFORE anything is charged, sends what is typed as
//     direction, shows the scene the server saved, and keeps what was typed
//     one press away; a refusal is the dialog's one alert;
//   * the list's selection offers "Write scenes…": one confirm, priced, for
//     the picked cards that aren't locked; the scenes are written one after
//     another, each card's own failure is named and the rest go on, and a
//     failure the next card would meet too (no credit, the AI's limit, no
//     connection) stops it and says so;
//   * neither is offered without a text model, or for a run that starts
//     from the card's own art.
// ---------------------------------------------------------------------------

const h = vi.hoisted(() => ({
  scene: vi.fn(),
  save: vi.fn(),
  refresh: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  upgrade: vi.fn(),
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
vi.mock("@/components/billing/upgrade-modal-provider", () => ({ useUpgradeModal: () => ({ open: h.upgrade }) }));
vi.mock("@/components/ai/use-leave-warning", () => ({ useLeaveWarning: () => undefined }));
vi.mock("@/lib/tools/track-client", () => ({ trackToolEvent: vi.fn() }));
vi.mock("@/lib/media/upload-cover", () => ({ uploadCoverImage: vi.fn() }));
vi.mock("@/lib/tools/re-art/actions", () => ({
  startReartAction: vi.fn(),
  saveReartStyleAction: vi.fn(),
  restoreReartArtAction: vi.fn(),
  planReartAction: vi.fn(),
  chooseReartPictureAction: vi.fn(),
  setReartLocksAction: vi.fn(),
  planUndoReartRunAction: vi.fn(),
  undoReartRunAction: vi.fn(),
  saveReartCardWordsAction: h.save,
}));
vi.mock("@/lib/tools/re-art/scene-client", async (original) => ({
  ...(await original<typeof import("@/lib/tools/re-art/scene-client")>()),
  requestReartScene: h.scene,
}));
vi.mock("@/components/tools/bulk-customize/use-bulk-runner", () => ({
  useBulkRunner: () => ({ steps: [], running: false, waitingUntil: null, stoppedBy: null, error: null, paused: false, runsEnded: 0, stop: vi.fn(), retryFailed: vi.fn() }),
}));
vi.mock("@/components/tools/bulk-customize/bulk-progress", () => ({ BulkProgress: () => null }));
vi.mock("@/components/tools/re-art/reart-style-panel", () => ({ ReartStylePanel: () => null }));
vi.mock("@/components/tools/re-art/reart-earlier-pictures-dialog", () => ({ ReartEarlierPicturesDialog: () => null }));
vi.mock("@/components/tools/re-art/reart-confirm-dialog", () => ({ ReartConfirmDialog: () => null }));
vi.mock("@/components/tools/re-art/reart-undo-dialog", () => ({ ReartUndoDialog: () => null }));
vi.mock("@/components/tools/re-art/reart-run-list", () => ({ ReartRunList: () => null }));
vi.mock("@/components/cards/card-tile", () => ({ CardTile: ({ thumbnail }: { thumbnail: { title: string } }) => <div data-testid="tile">{thumbnail.title}</div> }));
vi.mock("@/lib/cards/preview-data", () => ({ cardToPreviewData: () => ({}) }));

import { ReartStudio } from "@/components/tools/re-art/reart-studio";
import { ReartCardWordsDialog } from "@/components/tools/re-art/reart-card-words-dialog";
import { REART_SCENE_HELP, REART_SCENE_ONLY_NOTE } from "@/lib/tools/re-art/model";

const DECK = "00000000-0000-4000-8000-0000000000d1";
const E = (n: number) => `00000000-0000-4000-8000-0000000000e${n}`;
const SAVED = { preset: "watercolor", theme: "a haunted fen", mode: "preset" as const, prompt: "", version: 3 };
const SCENE = "An old goblin chieftain rallies a mob on a scorched ridge, banners snapping in the dusk wind.";

const entry = (n: number, over: Partial<ReartStudioEntry> = {}): ReartStudioEntry => ({
  id: E(n),
  name: `Card ${n}`,
  quantity: 1,
  board: "main",
  typeLine: "Creature — Goblin",
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

const written = (text = SCENE, over: Partial<Extract<ReartSceneResult, { ok: true }>> = {}): ReartSceneResult => ({
  ok: true,
  words: { text, only: false },
  previous: null,
  credits: 9,
  ...over,
});

function studio(entries: ReartStudioEntry[], over: { sceneAvailable?: boolean; balance?: number | null } = {}) {
  return render(
    <ReartStudio
      deck={{ id: DECK, slug: "embers", title: "Embers of the Fen" }}
      storedStyle={SAVED}
      entries={entries}
      username="dev_pro"
      capacity={null}
      balance={"balance" in over ? (over.balance ?? null) : 20}
      aiAvailable
      sceneAvailable={over.sceneAvailable ?? true}
      pausedRunId={null}
      runs={[]}
    />,
  );
}

const button = (name: string | RegExp) => screen.getByRole("button", { name });
const off = (element: Element | null) => element?.getAttribute("aria-disabled") === "true";
const box = (words: string, name: string) =>
  screen.getAllByRole("checkbox").find((input) => {
    const label = input.closest("label")?.textContent ?? "";
    return label.startsWith(words) && label.includes(name);
  }) as HTMLInputElement;
const bar = () => within(screen.getByRole("group", { name: "Selected cards" }));
const openWords = async (name: string) => {
  await act(async () => {
    fireEvent.click(button(new RegExp(`(Its own words…|Edit its words…) — ${name}`)));
  });
  return screen.getByRole("dialog", { name: `Words for ${name}` });
};
const settled = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

beforeEach(() => {
  for (const fn of Object.values(h)) fn.mockReset();
  h.scene.mockResolvedValue(written());
});
afterEach(cleanup);

describe("“Write a scene with AI” in a card's own words", () => {
  const direction = (dialog: HTMLElement) => within(dialog).getByRole("textbox", { name: "Direction for the writer (optional)" }) as HTMLInputElement;
  const wordsBox = (dialog: HTMLElement) => within(dialog).getByRole("textbox", { name: "This card's own words" }) as HTMLTextAreaElement;
  const pressWrite = (dialog: HTMLElement) =>
    act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: /Write (a scene with AI|another scene)/ }));
    });

  it("is offered with its price, and says what it does before anything is charged — the dialog no longer says nothing is charged here", async () => {
    studio([entry(1, { name: "Goblin Chieftain" })]);
    const dialog = await openWords("Goblin Chieftain");
    const write = within(dialog).getByRole("button", { name: "Write a scene with AI · 1 credit" });
    expect(document.getElementById(write.getAttribute("aria-describedby") ?? "")?.textContent).toBe(REART_SCENE_HELP);
    expect(dialog.textContent).toContain("Nothing is painted here, and saving your own words is free");
    expect(dialog.textContent).not.toContain("Nothing is painted or charged here");
    expect(h.scene).not.toHaveBeenCalled();
  });

  it("sends the DIRECTION (never the words' box), shows the scene the server SAVED, and tells the studio — the dialog stays open on it", async () => {
    studio([entry(1, { name: "Goblin Chieftain" })]);
    const dialog = await openWords("Goblin Chieftain");
    fireEvent.change(direction(dialog), { target: { value: "at dusk, on a ridge" } });
    await pressWrite(dialog);
    expect(h.scene.mock.calls).toEqual([[{ deckId: DECK, entryId: E(1), note: "at dusk, on a ridge" }]]);
    expect(wordsBox(dialog).value).toBe(SCENE);
    expect(within(dialog).getByText(/Scene written and saved \(1 credit\): it is this card's words now\./)).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "Words for Goblin Chieftain" })).toBeTruthy();
    expect(h.toastSuccess).toHaveBeenCalledWith("Goblin Chieftain has an AI-written scene. It is used the next time the card is painted.");
    expect(h.refresh).toHaveBeenCalledTimes(1);
    // Nothing was saved by the browser: the server did.
    expect(h.save).not.toHaveBeenCalled();
    // The scene IS the card's words now: nothing left to save, nothing to cancel.
    expect(off(within(dialog).getByRole("button", { name: "Save words" }))).toBe(true);
    expect(within(dialog).getByRole("button", { name: "Done" })).toBeTruthy();
  });

  it("pressing again asks for ANOTHER scene with the same direction — never the first scene handed back as the direction (a paid paraphrase)", async () => {
    h.scene.mockResolvedValueOnce(written()).mockResolvedValueOnce(written("A second, different scene on the same ridge under a red moon."));
    studio([entry(1, { name: "Goblin Chieftain" })]);
    const dialog = await openWords("Goblin Chieftain");
    fireEvent.change(direction(dialog), { target: { value: "at dusk" } });
    await pressWrite(dialog);
    expect(within(dialog).getByRole("button", { name: "Write another scene · 1 credit" })).toBeTruthy();
    await pressWrite(dialog);
    expect(h.scene.mock.calls.map(([input]) => input.note)).toEqual(["at dusk", "at dusk"]);
    expect(JSON.stringify(h.scene.mock.calls[1])).not.toContain("goblin chieftain rallies");
    expect(wordsBox(dialog).value).toBe("A second, different scene on the same ridge under a red moon.");
  });

  it("the words the box held stay one press away until the dialog closes — the first ones, however many scenes are written", async () => {
    studio([entry(1, { name: "Goblin Chieftain" })]);
    const dialog = await openWords("Goblin Chieftain");
    fireEvent.change(wordsBox(dialog), { target: { value: "my own careful words" } });
    await pressWrite(dialog);
    await pressWrite(dialog);
    fireEvent.click(within(dialog).getByRole("button", { name: "Put back the words it had" }));
    expect(wordsBox(dialog).value).toBe("my own careful words");
    // …which the maker then saves: the scene is still what is stored, the
    // dialog goes on saying so, and Cancel is what drops this draft.
    expect(off(within(dialog).getByRole("button", { name: "Save words" }))).toBe(false);
    expect(within(dialog).queryByRole("button", { name: "Put back the words it had" })).toBeNull();
    expect(within(dialog).getByText(/Scene written and saved \(1 credit\): it is this card's words now\./)).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: "Done" })).toBeNull();
  });

  it("the card's STORED words are never lost without a word: with the box emptied first, the way back is what the server hands back", async () => {
    h.scene.mockResolvedValueOnce(written(SCENE, { previous: { text: "an old goblin, stored last week", only: true } }));
    studio([entry(1, { name: "Goblin Chieftain", words: { text: "an old goblin, stored last week", only: true } })]);
    const dialog = await openWords("Goblin Chieftain");
    fireEvent.change(wordsBox(dialog), { target: { value: "" } });
    await pressWrite(dialog);
    // A scene is painted in the deck's look: “only these words” is off, and said.
    expect((within(dialog).getByRole("checkbox", { name: /Use only these words for this card/ }) as HTMLInputElement).checked).toBe(false);
    expect(dialog.textContent).toContain(REART_SCENE_ONLY_NOTE);
    fireEvent.click(within(dialog).getByRole("button", { name: "Put back the words it had" }));
    expect(wordsBox(dialog).value).toBe("an old goblin, stored last week");
    expect((within(dialog).getByRole("checkbox", { name: /Use only these words for this card/ }) as HTMLInputElement).checked).toBe(true);
  });

  it("a card with no words and an empty box has nothing to put back", async () => {
    studio([entry(1, { name: "Goblin Chieftain" })]);
    const dialog = await openWords("Goblin Chieftain");
    await pressWrite(dialog);
    expect(h.scene.mock.calls[0][0]).toEqual({ deckId: DECK, entryId: E(1), note: "" });
    expect(within(dialog).queryByRole("button", { name: "Put back the words it had" })).toBeNull();
  });

  it("an edit of the scene is a draft: the button is Cancel again, and Save words stores it", async () => {
    studio([entry(1, { name: "Goblin Chieftain" })]);
    const dialog = await openWords("Goblin Chieftain");
    await pressWrite(dialog);
    expect(within(dialog).getByRole("button", { name: "Done" })).toBeTruthy();
    fireEvent.change(wordsBox(dialog), { target: { value: `${SCENE} Rain falls.` } });
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeTruthy();
    expect(off(within(dialog).getByRole("button", { name: "Save words" }))).toBe(false);
  });

  it("a refusal is the dialog's ONE alert and changes nothing; out of credits opens the credits offer", async () => {
    h.scene.mockResolvedValueOnce({ ok: false, error: "The AI's answer couldn't be read. Nothing was charged." });
    studio([entry(1, { name: "Goblin Chieftain", words: { text: "an old goblin", only: false } })]);
    const dialog = await openWords("Goblin Chieftain");
    await pressWrite(dialog);
    expect(within(dialog).getAllByRole("alert").map((alert) => alert.textContent)).toEqual(["The AI's answer couldn't be read. Nothing was charged."]);
    expect(wordsBox(dialog).value).toBe("an old goblin");
    expect(h.refresh).not.toHaveBeenCalled();
    expect(h.upgrade).not.toHaveBeenCalled();
    h.scene.mockResolvedValueOnce({ ok: false, code: "INSUFFICIENT_CREDITS", error: "You're out of credits." });
    await pressWrite(dialog);
    expect(within(dialog).getByRole("alert").textContent).toBe("You're out of credits.");
    expect(h.upgrade).toHaveBeenCalledWith("credits", "reart_deck");
  });

  it("while it writes, a second press does nothing and the dialog can't be closed under it", async () => {
    let finish: (result: ReartSceneResult) => void = () => undefined;
    h.scene.mockReturnValueOnce(new Promise<ReartSceneResult>((resolve) => (finish = resolve)));
    studio([entry(1, { name: "Goblin Chieftain" })]);
    const dialog = await openWords("Goblin Chieftain");
    await pressWrite(dialog);
    const writing = within(dialog).getByRole("button", { name: "Writing the scene…" });
    expect(off(writing)).toBe(true);
    fireEvent.click(writing);
    expect(h.scene).toHaveBeenCalledTimes(1);
    expect((within(dialog).getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => {
      finish(written());
    });
    // After a scene there is nothing to cancel: it is saved.
    expect(within(dialog).getByRole("button", { name: "Done" })).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: "Cancel" })).toBeNull();
  });

  it("waits while the form shows a style that isn't saved — a scene is written for the deck's SAVED world — and says why", async () => {
    render(
      <ReartCardWordsDialog
        open
        onOpenChange={() => undefined}
        deckId={DECK}
        entry={entry(1)}
        style={SAVED}
        onSaved={() => undefined}
        scene={{ onWritten: vi.fn(), blocked: "You changed the style. Save it or undo your changes first: a scene is written for the deck's saved world." }}
      />,
    );
    const write = screen.getByRole("button", { name: "Write a scene with AI · 1 credit" });
    expect(off(write)).toBe(true);
    const described = (write.getAttribute("aria-describedby") ?? "").split(" ").map((id) => document.getElementById(id)?.textContent);
    expect(described).toContain("You changed the style. Save it or undo your changes first: a scene is written for the deck's saved world.");
    await act(async () => {
      fireEvent.click(write);
    });
    expect(h.scene).not.toHaveBeenCalled();
  });

  it("is not offered without a text model — or by the dialog on its own (a run from the card's own art)", async () => {
    studio([entry(1, { name: "Goblin Chieftain" })], { sceneAvailable: false });
    const dialog = await openWords("Goblin Chieftain");
    expect(within(dialog).queryByRole("button", { name: /Write a scene with AI/ })).toBeNull();
    expect(within(dialog).queryByRole("textbox", { name: /Direction for the writer/ })).toBeNull();
    cleanup();
    render(<ReartCardWordsDialog open onOpenChange={() => undefined} deckId={DECK} entry={entry(1)} style={SAVED} method="restyle" onSaved={() => undefined} />);
    expect(screen.queryByRole("button", { name: /Write a scene with AI/ })).toBeNull();
  });
});

describe("“Write scenes…” for the cards picked in the list", () => {
  const cards = () => [
    entry(1, { name: "Thornback Wyrm" }),
    entry(2, { name: "Mossy Fen", words: { text: "a drowned chapel", only: false } }),
    entry(3, { name: "Sol Ring", locked: true }),
    entry(4, { name: "Archivist" }),
  ];
  const pick = (...names: string[]) => {
    fireEvent.click(button("Select cards"));
    for (const name of names) fireEvent.click(box("Select", name));
  };
  const openScenes = async () => {
    await act(async () => {
      fireEvent.click(bar().getByRole("button", { name: "Write scenes…" }));
    });
    return screen.getByRole("dialog", { name: "Write scenes with AI" });
  };

  it("says what it will do and cost for the picked cards that aren't locked — before anything is charged", async () => {
    studio(cards());
    pick("Thornback Wyrm", "Mossy Fen", "Sol Ring");
    const dialog = await openScenes();
    const text = dialog.textContent ?? "";
    expect(text).toContain("Writes a scene for 2 cards · 2 credits");
    expect(text).toContain("1 of them has words of its own: those are replaced.");
    expect(text).not.toContain("Use only these words");
    expect(text).toContain("Nothing is painted.");
    expect(text).toContain("Nothing is charged until you press Write.");
    expect(within(dialog).getByRole("button", { name: "Write 2 scenes" })).toBeTruthy();
    expect(h.scene).not.toHaveBeenCalled();
  });

  it("says so when a picked card is set to “use only these words”: with a scene it is painted in the deck's look again", async () => {
    studio([entry(1, { name: "Thornback Wyrm", words: { text: "a wyrm, alone", only: true } }), entry(2, { name: "Mossy Fen" })]);
    pick("Thornback Wyrm", "Mossy Fen");
    const dialog = await openScenes();
    expect(dialog.textContent).toContain("1 is set to “Use only these words”: with a scene it is painted in the deck's look again.");
  });

  it("a card on two rows of the deck gets ONE scene (it is painted once, from its first row's words)", async () => {
    const card = { id: "00000000-0000-4000-8000-0000000000c1", slug: "wyrm", title: "Thornback Wyrm" } as never;
    studio([entry(1, { name: "Thornback Wyrm", card }), entry(2, { name: "Thornback Wyrm", board: "side", card }), entry(3, { name: "Mossy Fen" })]);
    fireEvent.click(button("Select cards"));
    fireEvent.click(bar().getByRole("button", { name: "Select all shown" }));
    const dialog = await openScenes();
    expect(dialog.textContent).toContain("Writes a scene for 2 cards · 2 credits");
  });

  it("writes them one after another, as stored (no direction), then says so and re-reads the page", async () => {
    studio(cards());
    pick("Thornback Wyrm", "Mossy Fen", "Archivist");
    const dialog = await openScenes();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Write 3 scenes" }));
    });
    expect(h.scene.mock.calls.map(([input]) => ({ deckId: input.deckId, entryId: input.entryId, note: input.note }))).toEqual([
      { deckId: DECK, entryId: E(1), note: undefined },
      { deckId: DECK, entryId: E(2), note: undefined },
      { deckId: DECK, entryId: E(4), note: undefined },
    ]);
    expect(dialog.textContent).toContain("3 scenes written and saved (3 credits).");
    expect(h.toastSuccess).toHaveBeenCalledWith("3 scenes written.");
    expect(h.refresh).toHaveBeenCalledTimes(1);
    expect(within(dialog).queryByRole("button", { name: /Write \d+ scene/ })).toBeNull();
  });

  it("a card whose scene couldn't be written is named with why, nothing charged for it — and the rest go on", async () => {
    h.scene
      .mockResolvedValueOnce(written())
      .mockResolvedValueOnce({ ok: false, error: "The AI's answer couldn't be read. Nothing was charged." })
      .mockResolvedValueOnce(written());
    studio(cards());
    pick("Thornback Wyrm", "Mossy Fen", "Archivist");
    const dialog = await openScenes();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Write 3 scenes" }));
    });
    expect(h.scene).toHaveBeenCalledTimes(3);
    expect(dialog.textContent).toContain("2 scenes written and saved (2 credits).");
    // What became of its credit is the route's own sentence — the heading
    // promises nothing (a refund can still be on its way).
    expect(dialog.textContent).toContain("1 card got no scene:");
    expect(dialog.textContent).not.toContain("nothing was charged for");
    expect(dialog.textContent).toContain("Mossy Fen — The AI's answer couldn't be read. Nothing was charged.");
    expect(h.toastSuccess).toHaveBeenCalledWith("2 scenes written. 1 card got none: the dialog says why.");
  });

  it("out of credits STOPS it: the next card is never asked, the reason is the dialog's alert, and the credits offer opens", async () => {
    h.scene.mockResolvedValueOnce(written()).mockResolvedValueOnce({ ok: false, code: "INSUFFICIENT_CREDITS", error: "You're out of credits." });
    studio(cards());
    pick("Thornback Wyrm", "Mossy Fen", "Archivist");
    const dialog = await openScenes();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Write 3 scenes" }));
    });
    expect(h.scene).toHaveBeenCalledTimes(2);
    expect(within(dialog).getByRole("alert").textContent).toBe("You're out of credits.");
    expect(dialog.textContent).toContain("1 scene written and saved (1 credit).");
    // The card it stopped on isn't "a card that got no scene": nothing was wrong with it.
    expect(dialog.textContent).not.toContain("got no scene");
    expect(h.upgrade).toHaveBeenCalledWith("credits", "reart_deck");
    expect(dialog.textContent).toContain("The 2 cards without one are still selected: press “Write scenes…” again for them.");
  });

  it("pressing “Write scenes…” again after a stop goes on with the REST — it never pays twice for a card already done", async () => {
    h.scene.mockResolvedValueOnce(written()).mockResolvedValueOnce({ ok: false, code: "INSUFFICIENT_CREDITS", error: "You're out of credits." });
    studio(cards());
    pick("Thornback Wyrm", "Mossy Fen", "Archivist");
    let dialog = await openScenes();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Write 3 scenes" }));
    });
    await act(async () => {
      fireEvent.click(within(dialog).getAllByRole("button", { name: "Close" })[0]);
    });
    await settled();
    // The card that got its scene left the selection.
    expect(bar().getByRole("status").textContent).toBe("2 selected");
    expect(box("Select", "Thornback Wyrm").checked).toBe(false);
    h.scene.mockReset();
    h.scene.mockResolvedValue(written());
    dialog = await openScenes();
    expect(dialog.textContent).toContain("Writes a scene for 2 cards · 2 credits");
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Write 2 scenes" }));
    });
    expect(h.scene.mock.calls.map(([input]) => input.entryId)).toEqual([E(2), E(4)]);
  });

  it("three cards in a row with no scene stop it (the writer is down) — the rest are not asked, failed and refunded one by one", async () => {
    h.scene.mockResolvedValue({ ok: false, error: "The AI service is having trouble. Nothing was charged." });
    studio([1, 2, 3, 4, 5, 6].map((n) => entry(n, { name: `Card ${n}` })));
    fireEvent.click(button("Select cards"));
    fireEvent.click(bar().getByRole("button", { name: "Select all shown" }));
    const dialog = await openScenes();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Write 6 scenes" }));
    });
    expect(h.scene).toHaveBeenCalledTimes(3);
    expect(within(dialog).getByRole("alert").textContent).toBe("Stopped: 3 cards in a row got no scene. Try again in a little while.");
    expect(dialog.textContent).toContain("3 cards got no scene:");
  });

  it("a failure between successes doesn't count toward that: only a RUN of them stops it", async () => {
    const bad = { ok: false as const, error: "The AI's answer couldn't be read. Nothing was charged." };
    h.scene
      .mockResolvedValueOnce(bad)
      .mockResolvedValueOnce(bad)
      .mockResolvedValueOnce(written())
      .mockResolvedValueOnce(bad)
      .mockResolvedValueOnce(bad)
      .mockResolvedValueOnce(written());
    studio([1, 2, 3, 4, 5, 6].map((n) => entry(n, { name: `Card ${n}` })));
    fireEvent.click(button("Select cards"));
    fireEvent.click(bar().getByRole("button", { name: "Select all shown" }));
    const dialog = await openScenes();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Write 6 scenes" }));
    });
    expect(h.scene).toHaveBeenCalledTimes(6);
    expect(within(dialog).queryByRole("alert")).toBeNull();
  });

  it("leaving the page STOPS it: the request on its way is aborted and no further card is asked for (nothing is charged with no screen to say so)", async () => {
    const signals: AbortSignal[] = [];
    h.scene.mockImplementation(
      (input: { signal?: AbortSignal }) =>
        new Promise<ReartSceneResult>((resolve) => {
          if (input.signal) {
            signals.push(input.signal);
            input.signal.addEventListener("abort", () => resolve({ ok: false, code: "UNREACHABLE", error: "We couldn't reach PipGlyph." }));
          }
        }),
    );
    const view = studio(cards());
    pick("Thornback Wyrm", "Mossy Fen", "Archivist");
    const dialog = await openScenes();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Write 3 scenes" }));
    });
    expect(h.scene).toHaveBeenCalledTimes(1);
    await act(async () => {
      view.unmount();
    });
    await settled();
    expect(signals[0].aborted).toBe(true);
    expect(h.scene).toHaveBeenCalledTimes(1);
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("a lost connection stops it too, and says what was written is saved", async () => {
    h.scene.mockResolvedValueOnce({ ok: false, code: "UNREACHABLE", error: "We couldn't reach PipGlyph. If a scene was written it is saved: reload the page to see it." });
    studio(cards());
    pick("Thornback Wyrm", "Archivist");
    const dialog = await openScenes();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Write 2 scenes" }));
    });
    expect(h.scene).toHaveBeenCalledTimes(1);
    expect(within(dialog).getByRole("alert").textContent).toMatch(/couldn't reach PipGlyph/);
    expect(h.refresh).not.toHaveBeenCalled();
  });

  it("“Stop after this one” stops it between cards, and says how many were left", async () => {
    let finish: (result: ReartSceneResult) => void = () => undefined;
    h.scene.mockReturnValueOnce(new Promise<ReartSceneResult>((resolve) => (finish = resolve)));
    studio(cards());
    pick("Thornback Wyrm", "Mossy Fen", "Archivist");
    const dialog = await openScenes();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Write 3 scenes" }));
    });
    expect(dialog.textContent).toContain("Writing scenes… 1 of 3");
    fireEvent.click(within(dialog).getByRole("button", { name: "Stop after this one" }));
    await act(async () => {
      finish(written());
    });
    expect(h.scene).toHaveBeenCalledTimes(1);
    expect(dialog.textContent).toContain("1 scene written and saved (1 credit).");
    expect(within(dialog).getByRole("alert").textContent).toBe("Stopped. 2 cards were left as they are.");
  });

  it("says when the credits won't cover them all — and how many it will write", async () => {
    studio(cards(), { balance: 2 });
    pick("Thornback Wyrm", "Mossy Fen", "Archivist");
    const dialog = await openScenes();
    expect(dialog.textContent).toContain("You have 2 credits: it writes 2 scenes, then stops.");
    cleanup();
    // Where credits aren't charged, nothing is said about them.
    studio(cards(), { balance: null });
    pick("Thornback Wyrm", "Mossy Fen");
    expect((await openScenes()).textContent).not.toMatch(/You have/);
  });

  it("waits with nothing to write for (only locked cards picked), and isn't offered without a text model", async () => {
    studio(cards());
    pick("Sol Ring");
    const write = bar().getByRole("button", { name: "Write scenes…" });
    expect(off(write)).toBe(true);
    fireEvent.click(write);
    expect(screen.queryByRole("dialog")).toBeNull();
    cleanup();
    studio(cards(), { sceneAvailable: false });
    pick("Thornback Wyrm");
    expect(bar().queryByRole("button", { name: "Write scenes…" })).toBeNull();
  });

  it("closed, the focus goes back to the list's button", async () => {
    studio(cards());
    pick("Thornback Wyrm");
    const dialog = await openScenes();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    });
    await settled();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(bar().getByRole("button", { name: "Write scenes…" }));
  });
});
