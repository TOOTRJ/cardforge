// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import type { ReartStudioEntry } from "@/lib/tools/re-art/model";

// ---------------------------------------------------------------------------
// Re-art deck's studio — a deck that names a LICENSED PROPERTY, and a deck's
// REFERENCE PICTURE (migration 0214), with the REAL style panel:
//
//   * a property the deck doesn't name yet shows the sentence to confirm,
//     and nothing can be saved or painted until it is ticked; the tick
//     travels with the save / the run and never carries over to another
//     name; a property the deck names already asks nothing again;
//   * a reference picture is uploaded (the moderated upload, with its own
//     purpose), shown, removable — and with one in the style a picture
//     can't also start from the card's own art;
//   * the prompt the panel shows is the one the step sends.
// ---------------------------------------------------------------------------

const h = vi.hoisted(() => ({
  save: vi.fn(),
  upload: vi.fn(),
  refresh: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: h.refresh, push: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={String(href)} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("sonner", () => ({ toast: { error: h.toastError, success: vi.fn() } }));
vi.mock("@/components/billing/upgrade-modal-provider", () => ({ useUpgradeModal: () => ({ open: vi.fn() }) }));
vi.mock("@/components/ai/use-leave-warning", () => ({ useLeaveWarning: () => undefined }));
vi.mock("@/lib/tools/track-client", () => ({ trackToolEvent: vi.fn() }));
vi.mock("@/lib/media/upload-cover", () => ({ uploadCoverImage: h.upload }));
vi.mock("@/lib/tools/re-art/actions", () => ({
  startReartAction: vi.fn(),
  saveReartStyleAction: h.save,
  restoreReartArtAction: vi.fn(),
  planReartAction: vi.fn(),
}));
vi.mock("@/components/tools/bulk-customize/use-bulk-runner", () => ({
  useBulkRunner: () => ({ steps: [], running: false, waitingUntil: null, stoppedBy: null, error: null, paused: false, runsEnded: 0, stop: vi.fn(), retryFailed: vi.fn() }),
}));
vi.mock("@/components/tools/bulk-customize/bulk-progress", () => ({ BulkProgress: () => null }));
vi.mock("@/components/tools/re-art/reart-card-words-dialog", () => ({ ReartCardWordsDialog: () => null }));
vi.mock("@/components/tools/re-art/reart-run-list", () => ({ ReartRunList: () => null }));
vi.mock("@/components/tools/re-art/reart-card-grid", () => ({
  ReartCardGrid: ({ paintBlocked }: { paintBlocked?: string | null }) => (paintBlocked ? <p data-testid="grid-blocked">{paintBlocked}</p> : null),
}));
// The confirm as the studio opens it: the run it would start, and what it
// is told about the style's licence.
vi.mock("@/components/tools/re-art/reart-confirm-dialog", () => ({
  ReartConfirmDialog: ({ open, title, input, licence }: { open: boolean; title: string; input: unknown; licence?: unknown }) =>
    open ? <div role="dialog" aria-label={title} data-input={JSON.stringify(input)} data-licence={JSON.stringify(licence)} /> : null,
}));

import { ReartStudio } from "@/components/tools/re-art/reart-studio";
import { REART_REFERENCE_LEAD, reartIpLine, reartIpStatement } from "@/lib/tools/re-art/model";

const DECK = "00000000-0000-4000-8000-0000000000d1";
const REFERENCE = "https://x.supabase.co/storage/v1/object/public/set-covers/11111111-1111-4111-8111-111111111111/ref.webp";
const SAVED = { preset: "watercolor", theme: "a haunted fen", mode: "preset" as const, prompt: "", version: 1 };
const ENTRY: ReartStudioEntry = {
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
  flavorText: "Scales like slate.",
  credits: 1,
  paintedBy: null,
  restyled: false,
};

function studio(over: { storedStyle?: Record<string, unknown>; canPickModel?: boolean } = {}) {
  return render(
    <ReartStudio
      deck={{ id: DECK, slug: "embers", title: "Embers of the Fen" }}
      storedStyle={(over.storedStyle ?? SAVED) as never}
      entries={[ENTRY]}
      username="dev_free"
      capacity={null}
      balance={20}
      aiAvailable
      canPickModel={over.canPickModel}
      pausedRunId={null}
      runs={[]}
    />,
  );
}

const nameField = () => screen.getByRole("textbox", { name: "Licensed property" }) as HTMLInputElement;
const typeName = (value: string) => fireEvent.change(nameField(), { target: { value } });
const tick = () => screen.queryByRole("checkbox") as HTMLInputElement | null;
const button = (name: string | RegExp) => screen.getByRole("button", { name });
const off = (name: string | RegExp) => button(name).getAttribute("aria-disabled") === "true";
const press = async (name: string | RegExp) => {
  await act(async () => {
    fireEvent.click(button(name));
  });
};
const inputOf = (title: string) => JSON.parse(screen.getByRole("dialog", { name: title }).getAttribute("data-input") ?? "{}");
const licenceOf = (title: string) => JSON.parse(screen.getByRole("dialog", { name: title }).getAttribute("data-licence") ?? "{}");

beforeEach(() => {
  for (const fn of Object.values(h)) fn.mockReset();
  h.save.mockImplementation(async (_deck: string, style: Record<string, unknown>) => ({
    ok: true,
    style: { ...style, ...(typeof style.ipName === "string" ? { ipName: style.ipName.trim() } : {}) },
    version: 2,
  }));
});
afterEach(cleanup);

describe("a licensed property", () => {
  it("a deck that names none shows an empty field, no sentence, and nothing extra in the prompt", () => {
    studio();
    expect(nameField().value).toBe("");
    expect(tick()).toBeNull();
    expect(screen.queryByText(/Licensed artwork for/)).toBeNull();
    expect(off("Save style")).toBe(true); // nothing changed
  });

  it("naming one shows the sentence to confirm — the model's, with the name — and its line in what every prompt shares", () => {
    studio();
    typeName("Emberfall Chronicles");
    expect(tick()?.checked).toBe(false);
    expect(screen.getByText(reartIpStatement("Emberfall Chronicles"))).toBeTruthy();
    expect(screen.getByText(`Then: ${reartIpLine("Emberfall Chronicles")}`)).toBeTruthy();
    expect(screen.getByText(/Image services still decline some names and characters/)).toBeTruthy();
  });

  it("until it is ticked nothing is saved or painted, and each button says why", async () => {
    studio();
    typeName("Emberfall Chronicles");
    for (const name of ["Save style", /Paint the sample/, /Re-art the deck/]) expect(off(name), String(name)).toBe(true);
    expect(screen.getAllByText("Tick the confirmation under the property's name first.").length).toBeGreaterThanOrEqual(3);
    await press("Save style");
    await press(/Re-art the deck/);
    expect(h.save).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
    // One card is painted in the deck's SAVED style: it waits for the save, as for any new look.
    expect(screen.getByTestId("grid-blocked").textContent).toMatch(/Save it or undo your changes first/);
  });

  it("ticked: the save carries the confirmation, and the deck then names it — no sentence again", async () => {
    studio();
    typeName("Emberfall Chronicles");
    fireEvent.click(tick()!);
    expect(off("Save style")).toBe(false);
    await press("Save style");
    expect(h.save).toHaveBeenCalledWith(DECK, expect.objectContaining({ ipName: "Emberfall Chronicles" }), { attested: true });
    expect(tick()).toBeNull();
    expect(screen.getByText(/You confirmed your rights to Emberfall Chronicles for this deck\./)).toBeTruthy();
    expect(screen.queryByTestId("grid-blocked")).toBeNull();
  });

  it("ticked: a run carries it too, and its confirm is told the property", async () => {
    studio();
    typeName("Emberfall Chronicles");
    fireEvent.click(tick()!);
    await press(/Re-art the deck/);
    expect(inputOf("Re-art Embers of the Fen")).toMatchObject({ attested: true, style: { ipName: "Emberfall Chronicles" } });
    expect(licenceOf("Re-art Embers of the Fen")).toEqual({ ipName: "Emberfall Chronicles", reference: false });
  });

  it("the tick never carries over to another name", () => {
    studio();
    typeName("Emberfall Chronicles");
    fireEvent.click(tick()!);
    expect(tick()?.checked).toBe(true);
    typeName("Tidewrights");
    expect(tick()?.checked).toBe(false);
    expect(screen.getByText(reartIpStatement("Tidewrights"))).toBeTruthy();
    expect(off("Save style")).toBe(true);
    // Only spaces typed after it: the same property, the tick stays.
    fireEvent.click(tick()!);
    typeName("Tidewrights ");
    expect(tick()?.checked).toBe(true);
  });

  it("a deck that names one already asks nothing again: its runs carry no confirmation; another name asks; no name asks nothing", async () => {
    studio({ storedStyle: { ...SAVED, ipName: "Emberfall Chronicles" } });
    expect(nameField().value).toBe("Emberfall Chronicles");
    expect(tick()).toBeNull();
    await press(/Re-art the deck/);
    expect(Object.keys(inputOf("Re-art Embers of the Fen"))).not.toContain("attested");
    expect(licenceOf("Re-art Embers of the Fen")).toMatchObject({ ipName: "Emberfall Chronicles" });
    cleanup();
    studio({ storedStyle: { ...SAVED, ipName: "Emberfall Chronicles" } });
    typeName("Tidewrights");
    expect(tick()?.checked).toBe(false);
    typeName("");
    expect(tick()).toBeNull();
    expect(off("Save style")).toBe(false);
    await press("Save style");
    // Removing it: no confirmation, and no name in what is saved.
    expect(h.save.mock.calls[0][2]).toEqual({ attested: false });
    expect(Object.keys(h.save.mock.calls[0][1])).not.toContain("ipName");
  });

  it("a name that says nothing is asked for before the confirmation", () => {
    studio();
    typeName("?");
    expect(screen.getAllByText("Name the licensed property.").length).toBeGreaterThanOrEqual(1);
  });
});

describe("a reference picture", () => {
  const file = new File([new Uint8Array([1, 2, 3])], "look.png", { type: "image/png" });
  const choose = async () => {
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });
  };

  it("is uploaded through the moderated upload with its own purpose, shown, and part of the look to save", async () => {
    h.upload.mockResolvedValue({ ok: true, publicUrl: REFERENCE, path: "x", width: 800, height: 600 });
    studio();
    expect(screen.getByText(/Upload only a picture you have the right to use/)).toBeTruthy();
    await choose();
    expect(h.upload).toHaveBeenCalledWith("", file, { purpose: "reart-reference" });
    expect((screen.getByRole("img", { name: "The deck's reference picture" }) as HTMLImageElement).src).toBe(REFERENCE);
    // The focus went to Remove (the upload button took itself away).
    expect(document.activeElement).toBe(button("Remove the reference picture"));
    // A new look: it can be saved, and one card waits for the save.
    expect(off("Save style")).toBe(false);
    await press("Save style");
    expect(h.save.mock.calls[0][1]).toMatchObject({ referenceUrl: REFERENCE });
    // No property is named: no confirmation is sent or asked.
    expect(h.save.mock.calls[0][2]).toEqual({ attested: false });
  });

  it("an upload that is refused says why and changes nothing", async () => {
    h.upload.mockResolvedValue({ ok: false, error: "That image was flagged by our content filter and can't be uploaded." });
    studio();
    await choose();
    expect(screen.getByRole("alert").textContent).toMatch(/flagged by our content filter/);
    expect(screen.queryByRole("img", { name: "The deck's reference picture" })).toBeNull();
    expect(off("Save style")).toBe(true);
  });

  it("can be removed: the look is the one without it again, and the focus goes to the upload button", async () => {
    studio({ storedStyle: { ...SAVED, referenceUrl: REFERENCE } });
    expect(screen.getByRole("img", { name: "The deck's reference picture" })).toBeTruthy();
    await press("Remove the reference picture");
    expect(screen.queryByRole("img", { name: "The deck's reference picture" })).toBeNull();
    expect(document.activeElement).toBe(button("Upload a reference picture"));
    await press("Save style");
    expect(Object.keys(h.save.mock.calls[0][1])).not.toContain("referenceUrl");
  });

  it("the prompt the panel explains opens with the picture; a run's confirm is told there is one", async () => {
    studio({ storedStyle: { ...SAVED, referenceUrl: REFERENCE } });
    expect(screen.getByText(/Before it: your reference picture, with the instruction to paint in its look/)).toBeTruthy();
    await press(/Re-art the deck/);
    expect(licenceOf("Re-art Embers of the Fen")).toEqual({ ipName: "", reference: true });
    expect(inputOf("Re-art Embers of the Fen")).toMatchObject({ method: "paint", style: { referenceUrl: REFERENCE } });
    // The maker's own prompt shows the whole thing as sent.
    cleanup();
    studio({ storedStyle: { ...SAVED, mode: "custom", prompt: "{card} in thick oil paint", referenceUrl: REFERENCE, ipName: "Emberfall Chronicles" } });
    const sent = screen.getByText((text) => text.startsWith(REART_REFERENCE_LEAD));
    expect(sent.textContent).toContain(reartIpLine("Emberfall Chronicles"));
  });

  it("with one in the style a picture can't also start from the card's own art: that choice is off, and says why", async () => {
    studio({ canPickModel: true, storedStyle: { ...SAVED, referenceUrl: REFERENCE } });
    const group = screen.getByRole("radiogroup", { name: "Each picture starts from" });
    // Its reason is part of its name, and said in full under the row.
    const restyle = within(group).getByRole("radio", { name: "The card's own art — not with a reference picture" });
    expect(restyle.getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByText(/can't be used together yet/)).toBeTruthy();
    expect(restyle.getAttribute("aria-checked")).toBe("false");
    expect(within(group).getByRole("radio", { name: /The prompt alone/ }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(restyle);
    await press(/Re-art the deck/);
    expect(inputOf("Re-art Embers of the Fen").method).toBe("paint");
    expect(screen.getByText(/Automatic paints with Gemini 2.5 Flash Image/)).toBeTruthy();
  });

  it("without one both choices are on, as before", () => {
    studio({ canPickModel: true });
    const group = screen.getByRole("radiogroup", { name: "Each picture starts from" });
    expect(within(group).getByRole("radio", { name: /The card's own art/ }).getAttribute("aria-disabled")).not.toBe("true");
  });
});
