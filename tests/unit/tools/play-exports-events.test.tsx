// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

// ---------------------------------------------------------------------------
// What the play-surface exports record from the BROWSER (tool_events, through
// trackToolEvent): the moments no server action sees — the dialog
// opened, the file SAVED (the server's `export` only says the model was
// handed over), a file that couldn't be built, a build the user stopped.
// A request the SERVER refused is the action's own `export_failed`
// (play-exports-server-events.test.ts) and is never recorded twice. Counts and
// choices only: never a deck's name, a card's name or a file name.
// ---------------------------------------------------------------------------

const m = vi.hoisted(() => ({
  track: vi.fn<(slug: string, event: string, props?: Record<string, unknown>) => void>(() => undefined),
  build: vi.fn(),
  download: vi.fn(),
  save: vi.fn(),
}));

vi.mock("@/lib/tools/track-client", () => ({ trackToolEvent: m.track }));
vi.mock("@/lib/tools/play-exports/actions", () => ({ buildPlayExportAction: m.build }));
vi.mock("@/lib/tools/play-exports/files", () => ({
  buildPlayDownload: m.download,
  saveBlob: m.save,
  browserToJpeg: vi.fn(),
}));

import { PlayExportButton } from "@/components/tools/play-exports/play-export-button";
import { PlayExportDialog, type PlayExportDialogProps } from "@/components/tools/play-exports/play-export-dialog";
import { dynamicReady } from "@/tests/stubs/next-dynamic";

type Source = PlayExportDialogProps["source"];
const DECK: Source = { kind: "deck", deckId: "22222222-2222-4222-8222-222222222222" };
const CARDS: Source = { kind: "cards", cardIds: ["33333333-3333-4333-8333-333333333333"] };

const summary = (overrides: Record<string, unknown> = {}) => ({
  target: "cockatrice",
  customCards: 3,
  realCards: 57,
  unpictured: [{ name: "Secret Wolf", reason: "private" }],
  leftOutCards: 0,
  picturesFailed: 2,
  hiddenEntries: 1,
  maybeboard: 4,
  ...overrides,
});

const events = () => m.track.mock.calls.map(([slug, event, props]) => [slug, event, props]);

function openDialog(source: Source = DECK) {
  const onOpenChange = vi.fn();
  render(<PlayExportDialog open onOpenChange={onOpenChange} source={source} label="Wolf Pack" />);
  return onOpenChange;
}

const press = async (name: RegExp) => {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
  });
};

beforeEach(() => {
  try {
    // The dialog remembers the last app picked in this browser.
    window.localStorage.removeItem("pipglyph.play-export.target");
  } catch {
    // An environment without storage remembers nothing.
  }
  m.track.mockClear();
  m.build.mockReset();
  m.download.mockReset();
  m.save.mockReset();
  m.build.mockResolvedValue({ ok: true, export: { cards: [], lines: [] }, skipped: 1 });
  m.download.mockResolvedValue({ blob: new Blob(["x"]), filename: "wolf-pack-cockatrice.zip", summary: summary() });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  // Never a name, a file name or an id.
  for (const [, , props] of m.track.mock.calls) {
    expect(JSON.stringify(props ?? {})).not.toMatch(/wolf|secret|\.zip|2222|3333/i);
  }
});

describe("the Play online button", () => {
  it("records the dialog opened, with what it exports", async () => {
    render(<PlayExportButton source={DECK} label="Wolf Pack" />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Play online/ }));
      await dynamicReady();
    });
    expect(events()).toEqual([["play-exports", "dialog_opened", { source: "deck" }]]);
  });

  it("a selection is `cards`, as the server's `export` says it", async () => {
    render(<PlayExportButton source={CARDS} label="1 card" />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Play online/ }));
      await dynamicReady();
    });
    expect(events()).toEqual([["play-exports", "dialog_opened", { source: "cards" }]]);
  });

  it("a button that can't export opens nothing and records nothing", async () => {
    render(<PlayExportButton source={DECK} label="Empty" disabledReason="This deck has no cards yet." />);
    await press(/Play online/);
    expect(m.track).not.toHaveBeenCalled();
  });

  it("a tracking call that fails never stops the dialog", async () => {
    m.track.mockImplementationOnce(() => {
      throw new Error("offline");
    });
    render(<PlayExportButton source={DECK} label="Wolf Pack" />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Play online/ }));
      await dynamicReady();
    });
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});

describe("the export dialog", () => {
  it("records the file saved: the app, what went in, what didn't, how long it took", async () => {
    openDialog();
    await press(/Download for Cockatrice/);
    expect(m.save).toHaveBeenCalledTimes(1);
    expect(events()).toEqual([
      [
        "play-exports",
        "export_saved",
        {
          target: "cockatrice",
          source: "deck",
          cards: 3,
          real_cards: 57,
          unpictured: 1,
          pictures_failed: 2,
          left_out: 0,
          hidden: 1,
          skipped: 1,
          ms: expect.any(Number),
        },
      ],
    ]);
  });

  it("names the app picked (Tabletop Simulator's left-out cards)", async () => {
    m.download.mockResolvedValue({
      blob: new Blob(["{}"]),
      filename: "wolf-pack-tts.json",
      summary: summary({ target: "tts", leftOutCards: 5, picturesFailed: 0 }),
    });
    openDialog(CARDS);
    await act(async () => {
      fireEvent.click(screen.getByRole("radio", { name: /Tabletop Simulator/ }));
    });
    await press(/Download for Tabletop Simulator/);
    expect(events()).toEqual([
      ["play-exports", "export_saved", expect.objectContaining({ target: "tts", source: "cards", left_out: 5, pictures_failed: 0 })],
    ]);
  });

  it("a request the server refused is the server's to record: nothing from the browser", async () => {
    m.build.mockResolvedValue({ ok: false, error: "This deck has no cards to export yet." });
    openDialog();
    await press(/Download for Cockatrice/);
    expect(screen.getByRole("alert").textContent).toContain("no cards");
    expect(m.save).not.toHaveBeenCalled();
    expect(m.track).not.toHaveBeenCalled();
  });

  it("a file that couldn't be built: export_build_failed, build_failed", async () => {
    m.download.mockRejectedValue(new Error("zip failed"));
    openDialog();
    await press(/Download for Cockatrice/);
    expect(screen.getByRole("alert").textContent).toContain("couldn't be built");
    expect(events()).toEqual([
      ["play-exports", "export_build_failed", { target: "cockatrice", source: "deck", reason: "build_failed", ms: expect.any(Number) }],
    ]);
  });

  it("an answer that never arrived: export_build_failed, request_failed", async () => {
    m.build.mockRejectedValue(new Error("offline"));
    openDialog();
    await press(/Download for Cockatrice/);
    expect(m.download).not.toHaveBeenCalled();
    expect(events()).toEqual([
      ["play-exports", "export_build_failed", { target: "cockatrice", source: "deck", reason: "request_failed", ms: expect.any(Number) }],
    ]);
  });

  it("Cancel while the pictures are fetched: export_cancelled with how far it got, and nothing saved", async () => {
    let progress: (done: number, total: number) => void = () => undefined;
    m.download.mockImplementation((_exp: unknown, _target: unknown, deps: { onProgress: typeof progress }) => {
      progress = deps.onProgress;
      return new Promise(() => undefined);
    });
    openDialog();
    await press(/Download for Cockatrice/);
    await act(async () => {
      progress(2, 5);
    });
    await press(/^Cancel$/);
    expect(m.save).not.toHaveBeenCalled();
    expect(events()).toEqual([
      [
        "play-exports",
        "export_cancelled",
        { target: "cockatrice", source: "deck", by: "button", pictures_done: 2, pictures_total: 5, ms: expect.any(Number) },
      ],
    ]);
  });

  it("closing the dialog while it builds is a cancel too; closing an idle one records nothing", async () => {
    m.download.mockImplementation(() => new Promise(() => undefined));
    const onOpenChange = openDialog();
    await press(/^Close$/);
    expect(m.track).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    await press(/Download for Cockatrice/);
    await press(/^Close$/);
    expect(events()).toEqual([
      [
        "play-exports",
        "export_cancelled",
        { target: "cockatrice", source: "deck", by: "close", pictures_done: 0, pictures_total: 0, ms: expect.any(Number) },
      ],
    ]);
  });

  it("a tracking call that fails never changes what the dialog says", async () => {
    m.track.mockImplementation(() => {
      throw new Error("offline");
    });
    openDialog();
    await press(/Download for Cockatrice/);
    expect(screen.getByRole("heading", { name: /Downloaded/ })).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
