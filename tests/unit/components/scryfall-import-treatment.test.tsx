// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import {
  card,
  stubScryfallRoutes,
  verifiedIn,
  type FixtureKey,
} from "./scryfall-import-stubs";

// ---------------------------------------------------------------------------
// TODO 1.5's frame chooser in the import dialog (it replaced 1.16's pre-import
// heads-up and the post-import treatment toast): a printing whose frame
// PipGlyph doesn't have — or a borderless printing whose Scryfall art is
// only the bordered window (1.18's owner decision) — asks for a frame in the
// detail pane before commit. The kind's published frames in the imported
// colour, the nearest preselected, "Keep my current frame"; the pick rides on
// the payload. A substitute card can't be imported. The /api/scryfall/*
// routes are stubbed with the real mapper's output for real printings.
// ---------------------------------------------------------------------------

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), message: vi.fn(), info: vi.fn() },
}));

import { toast } from "sonner";
import {
  ScryfallImportDialog,
  type ScryfallImportPayload,
} from "@/components/creator/scryfall-import-dialog";

type OnImport = Mock<(payload: ScryfallImportPayload) => unknown>;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.mocked(toast.info).mockClear();
});

async function pickPrinting(
  key: FixtureKey,
  options: { verified?: string[]; currentFrameTemplate?: string; onImport?: OnImport } = {},
) {
  const verified = options.verified ?? verifiedIn("m15", "m15land", "m15token");
  stubScryfallRoutes({ search: [key], printings: {}, serverVerified: new Set(verified) });
  const onImport: OnImport = options.onImport ?? vi.fn();
  render(
    <ScryfallImportDialog
      signedIn
      open
      onOpenChange={() => {}}
      onImport={onImport}
      verifiedFrameKeys={verified}
      currentFrameTemplate={options.currentFrameTemplate ?? "m15"}
    />,
  );
  const name = card(key).name;
  fireEvent.change(screen.getByLabelText("Search Scryfall"), { target: { value: name } });
  fireEvent.click(await screen.findByRole("option", { name: new RegExp(name.split(",")[0]!) }));
  await screen.findByText(/Will populate/);
  return onImport;
}

function frameRadio(label: RegExp) {
  const group = screen.getByRole("radiogroup", { name: "Frame for the import" });
  const radio = within(group)
    .getAllByRole("radio")
    .find((el) => label.test(el.textContent ?? ""));
  if (!radio) throw new Error(`no frame option ${label}`);
  return radio as HTMLButtonElement;
}

async function commit(onImport: OnImport) {
  // Skip the art fetch.
  fireEvent.click(screen.getByRole("checkbox", { name: /also import artwork/i }));
  fireEvent.click(screen.getByRole("button", { name: /use as starting point/i }));
  await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1));
  return onImport.mock.calls[0]![0];
}

describe("borderless Sheoldred (DMU #435) — 1.18: the bordered frame, Borderless offered", () => {
  const BORDERLESS_VERIFIED = [...verifiedIn("m15"), "m15borderless/b"];

  it("preselects M15 with the window-cropped note and hands the pick to the form", async () => {
    const onImport = await pickPrinting("dmu-435", { verified: BORDERLESS_VERIFIED });
    const chooser = screen.getByTestId("import-frame-chooser");
    expect(
      within(chooser).getByText(
        "PipGlyph can't match this printing's Borderless frame exactly yet — pick one of these",
      ),
    ).toBeTruthy();
    expect(
      within(chooser).getByText("Scryfall's art for this printing is cropped to the bordered window."),
    ).toBeTruthy();
    expect(within(chooser).getByText("Why: PipGlyph doesn't draw the legendary crown on this frame yet.")).toBeTruthy();
    expect(frameRadio(/^M15 \(2015\) Standard/).getAttribute("aria-checked")).toBe("true");
    expect(frameRadio(/Borderless/).getAttribute("aria-checked")).toBe("false");

    const payload = await commit(onImport);
    expect(payload.frameChoice).toEqual({ template: "m15" });
    expect(payload.patch.frame_match).toMatchObject({ status: "nearest", landOn: "m15" });
  });

  it("picking Borderless sends it", async () => {
    const onImport = await pickPrinting("dmu-435", { verified: BORDERLESS_VERIFIED });
    fireEvent.click(frameRadio(/Borderless/));
    expect(frameRadio(/Borderless/).getAttribute("aria-checked")).toBe("true");
    expect((await commit(onImport)).frameChoice).toEqual({ template: "m15borderless" });
  });

  it("Keep my current frame sends keepCurrent", async () => {
    const onImport = await pickPrinting("dmu-435", { verified: BORDERLESS_VERIFIED });
    fireEvent.click(frameRadio(/Keep my current frame/));
    expect((await commit(onImport)).frameChoice).toEqual({ keepCurrent: true });
  });

  it("lists only published frames in the imported colour: no Borderless while it's unverified in black", async () => {
    await pickPrinting("dmu-435", { verified: [...verifiedIn("m15"), "m15borderless/w"] });
    const group = screen.getByRole("radiogroup", { name: "Frame for the import" });
    expect(within(group).queryByText(/Borderless/)).toBeNull();
    expect(
      screen.getByText("PipGlyph doesn't have the Borderless frame yet — pick one of these"),
    ).toBeTruthy();
  });

  it("names the match in the overwrite note, and never shows 1.16's heads-up or treatment toast", async () => {
    const onImport = await pickPrinting("dmu-435", { verified: BORDERLESS_VERIFIED });
    expect(
      screen.getByText(
        /the frame \(nearest to Borderless frame: M15 \(2015\) Standard, your pick above\) are all replaced/,
      ),
    ).toBeTruthy();
    // "Keep my current frame": the frame isn't replaced, and the note says so.
    fireEvent.click(frameRadio(/Keep my current frame/));
    expect(
      screen.getByText(/name, text, type and colors are all replaced; your current frame stays/),
    ).toBeTruthy();
    fireEvent.click(frameRadio(/^M15 \(2015\) Standard/));
    expect(screen.queryByText(/matched to this printing/)).toBeNull();
    expect(screen.queryByText(/which PipGlyph doesn't offer yet/)).toBeNull();
    await commit(onImport);
    expect(toast.info).not.toHaveBeenCalled();
  });
});

describe("the other outcomes", () => {
  it("an exact printing (a 2014–19 Soldier token) imports without asking", async () => {
    const onImport = await pickPrinting("tdom-3");
    expect(screen.queryByTestId("import-frame-chooser")).toBeNull();
    expect(screen.getByText(/the frame \(an exact match: .*\) are all replaced/)).toBeTruthy();
    const payload = await commit(onImport);
    expect(payload.frameChoice).toBeUndefined();
  });

  it("a 2023 full-art basic (ONE #262) preselects the full-art basic when it is verified in white", async () => {
    await pickPrinting("one-262", { verified: [...verifiedIn("m15", "m15land"), "m15fullartland/w"] });
    expect(frameRadio(/Basic Land/).getAttribute("aria-checked")).toBe("true");
    // The creature frame the card is on can't dress a land: keep-current is off.
    expect(frameRadio(/Keep my current frame/).disabled).toBe(true);
    expect(
      screen.getByText(/M15 \(2015\) Standard isn't published for land cards in white/),
    ).toBeTruthy();
  });

  it("a substitute card is Not available and can't be imported", async () => {
    await pickPrinting("sznr-1");
    expect(screen.getByRole("alert").textContent).toMatch(
      /Not available — this is a substitute card, not a playable card/,
    );
    const confirm = screen.getByRole("button", { name: /use as starting point/i }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    expect(confirm.title).toBe("Not available — this is a substitute card, not a playable card.");
    expect(screen.queryByTestId("import-frame-chooser")).toBeNull();
  });
});

describe("owner decisions 2026-09-29 (C1, C2)", () => {
  it("Sheoldred DMU #107, crowned, imports EXACT on its own M15 frame since 4.6a — crown on, no chooser", async () => {
    const onImport = await pickPrinting("dmu-107", { verified: verifiedIn("m15") });
    expect(screen.queryByTestId("import-frame-chooser")).toBeNull();
    expect(screen.getByText("M15 (2015) frame")).toBeTruthy();
    expect(screen.getByText(/the frame \(an exact match: M15 \(2015\) frame\) are all replaced/)).toBeTruthy();
    const payload = await commit(onImport);
    expect(payload.frameChoice).toBeUndefined();
    expect(payload.patch.frame_match).toMatchObject({ status: "exact", template: "m15" });
    expect(payload.patch.frame_match?.gaps).toBeUndefined();
    // Imports follow the printing: the card's crown switch goes on.
    expect(payload.patch.printed_crown).toBe(true);
    expect(toast.info).not.toHaveBeenCalled();
  });

  it("C1: …but asks while M15 isn't published in black (a real substitution)", async () => {
    await pickPrinting("dmu-107", { verified: [...verifiedIn("m15snow"), "m15/w"] });
    expect(screen.getByTestId("import-frame-chooser")).toBeTruthy();
  });

  it("C2: the standard frame and the printing's family first; Show all frames reveals the rest, and a pick among them is sent", async () => {
    const onImport = await pickPrinting("dmu-435", {
      verified: [...verifiedIn("m15", "m15snow", "m15devoid"), "m15borderless/b"],
    });
    const group = screen.getByRole("radiogroup", { name: "Frame for the import" });
    const labels = () => within(group).getAllByRole("radio").map((el) => el.textContent ?? "");
    expect(labels()).toHaveLength(3);
    expect(labels()[0]).toMatch(/^M15 \(2015\) Standard/);
    expect(labels()[1]).toMatch(/^M15 \(2015\) Borderless/);
    expect(labels()[2]).toMatch(/^Keep my current frame/);
    const showAll = screen.getByTestId("import-frame-show-all");
    expect(showAll.textContent).toBe("Show all frames (2 more)");

    fireEvent.click(showAll);
    expect(screen.queryByTestId("import-frame-show-all")).toBeNull();
    expect(labels()).toHaveLength(5);
    expect(labels().some((label) => /^M15 \(2015\) Snow/.test(label))).toBe(true);
    expect(labels().some((label) => /^M15 \(2015\) Devoid/.test(label))).toBe(true);
    // The link is gone, so keyboard focus moves to the first frame it revealed.
    expect(document.activeElement).toBe(frameRadio(/^M15 \(2015\) Snow/));
    // The preselection didn't move.
    expect(frameRadio(/^M15 \(2015\) Standard/).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(frameRadio(/^M15 \(2015\) Snow/));
    expect((await commit(onImport)).frameChoice).toEqual({ template: "m15snow" });
  });

  it("C2: no link when the standard frame and the family are all there is", async () => {
    await pickPrinting("dmu-435", { verified: [...verifiedIn("m15"), "m15borderless/b"] });
    expect(screen.getByTestId("import-frame-chooser")).toBeTruthy();
    expect(screen.queryByTestId("import-frame-show-all")).toBeNull();
  });

  it("C2: every printing starts collapsed, and a pick among the other frames stays on show when its printing comes back", async () => {
    // M15 isn't published in black here, so both Sheoldred printings ask:
    // Snow first (the fallback the import lands on), Devoid behind the link.
    const verified = verifiedIn("m15snow", "m15devoid");
    stubScryfallRoutes({
      search: ["dmu-107"],
      printings: { representative: [["dmu-107", "dmu-435"]] },
      serverVerified: new Set(verified),
    });
    render(
      <ScryfallImportDialog
        signedIn
        open
        onOpenChange={() => {}}
        onImport={vi.fn()}
        verifiedFrameKeys={verified}
        currentFrameTemplate="m15"
      />,
    );
    fireEvent.change(screen.getByLabelText("Search Scryfall"), { target: { value: "Sheoldred" } });
    fireEvent.click(await screen.findByRole("option", { name: /Sheoldred/ }));
    await screen.findByText(/Will populate/);
    const grid = () => screen.getByTestId("printings-grid");
    await waitFor(() => expect(within(grid()).getAllByRole("button")).toHaveLength(2));
    const heading = () => within(screen.getByTestId("import-frame-chooser")).getByRole("heading");
    const hasRadio = (label: RegExp) =>
      within(screen.getByRole("radiogroup", { name: "Frame for the import" }))
        .getAllByRole("radio")
        .some((el) => label.test(el.textContent ?? ""));

    // DMU #107: expand, pick Devoid.
    expect(heading().textContent).toMatch(/M15 \(2015\) frame yet/);
    expect(hasRadio(/^M15 \(2015\) Devoid/)).toBe(false);
    fireEvent.click(screen.getByTestId("import-frame-show-all"));
    fireEvent.click(frameRadio(/^M15 \(2015\) Devoid/));

    // DMU #435: its own chooser, collapsed again.
    fireEvent.click(within(grid()).getAllByRole("button")[1]!);
    await waitFor(() => expect(heading().textContent).toMatch(/Borderless frame yet/));
    expect(screen.getByTestId("import-frame-show-all")).toBeTruthy();
    expect(hasRadio(/^M15 \(2015\) Devoid/)).toBe(false);

    // Back to DMU #107: the Devoid pick is still its pick, and on show.
    fireEvent.click(within(grid()).getAllByRole("button")[0]!);
    await waitFor(() => expect(heading().textContent).toMatch(/M15 \(2015\) frame yet/));
    expect(frameRadio(/^M15 \(2015\) Devoid/).getAttribute("aria-checked")).toBe("true");
    expect(screen.queryByTestId("import-frame-show-all")).toBeNull();
  });
});
