// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";

// ---------------------------------------------------------------------------
// TODO 5.3 — the download modal of a double-faced card (`hasBackFace`: a
// back with a body of its own, what the bake writes). The Image tab gets a
// Face switch — Both faces / Front / Back (TODO 5.3c, owner decision
// 2026-10-05: Both faces is FIRST and the DEFAULT — the front and the back
// side by side in one PNG, `&faces=both`, named <slug>-both…, with the
// corners and the free / paid image applying to it, while the print options
// and JPEG — one face each — are disabled with a note until a face is
// picked); every image link of the back carries `&face=back` and is named
// <slug>-back…; the PDF tab's One card gets Faces — Front / Back / Both
// faces (2 pages) — and its Sheet the shared "Include back faces" checkbox
// (on by default, remembered with the print settings; off → `backs=0`). A
// single-faced card's modal is exactly what it was: no switch, the links and
// names unchanged.
// ---------------------------------------------------------------------------

const upgrade = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock("@/components/billing/upgrade-modal-provider", () => ({ useUpgradeModal: () => upgrade }));
vi.mock("@/lib/analytics/funnel-client", () => ({ trackFunnelEvent: vi.fn() }));

import { DownloadModal } from "@/components/cards/download-modal";
import { PRINT_SELECTION_SETTINGS_KEY } from "@/lib/cards/print-selection";

const storage = new Map<string, string>();
beforeEach(() => {
  storage.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, value),
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
  upgrade.open.mockReset();
});

async function click(el: HTMLElement) {
  await act(async () => {
    fireEvent.click(el);
  });
}

async function open({ isPaid = true, canBatch = true, hasBackFace = true, defaultTab = "png" as "png" | "single" } = {}) {
  render(
    <DownloadModal cardId="c1" cardSlug="village-elder" isPaid={isPaid} canBatch={canBatch} defaultTab={defaultTab} hasBackFace={hasBackFace} />,
  );
  await click(screen.getByRole("button", { name: /download/i }));
}

function link(part: string): HTMLAnchorElement {
  const links = screen.getAllByRole("link").filter((a) => (a.getAttribute("href") ?? "").includes(part)) as HTMLAnchorElement[];
  expect(links).toHaveLength(1);
  return links[0];
}

function chip(group: string, label: string | RegExp): HTMLButtonElement {
  return within(screen.getByRole("radiogroup", { name: group })).getByRole("radio", { name: label }) as HTMLButtonElement;
}

describe("DownloadModal — the Image tab's Face switch", () => {
  it("opens on Both faces — first in the switch, one PNG with &faces=both named <slug>-both…; the corners apply, JPEG is off until a face is picked (TODO 5.3c)", async () => {
    await open({ isPaid: false });
    const faces = within(screen.getByRole("radiogroup", { name: "Face" })).getAllByRole("radio");
    expect(faces.map((r) => r.textContent)).toEqual(["Both faces", "Front", "Back"]);
    expect(chip("Face", "Both faces").getAttribute("aria-checked")).toBe("true");
    expect(chip("Face", "Front").getAttribute("aria-checked")).toBe("false");
    let a = link("/png?");
    expect(a.getAttribute("href")).toBe("/api/cards/c1/png?preset=default&corners=round&faces=both");
    expect(a.getAttribute("download")).toBe("village-elder-both.png");
    expect(screen.getByText("Low-resolution PNG — both faces")).toBeTruthy();
    expect(screen.getByText(/^750 × 1050 per face with the PipGlyph mark, the front and the back side by side in one PNG/)).toBeTruthy();
    expect(screen.getByText(/^The front and the back side by side in one PNG, named <card>-both\./)).toBeTruthy();
    expect(screen.getByRole("link", { name: /download free png/i })).toBe(a);
    expect(chip("File type", "JPEG").disabled).toBe(true);
    expect(chip("File type", "PNG").getAttribute("aria-checked")).toBe("true");
    // The corners apply to both faces.
    await click(chip("Corners", "Square"));
    a = link("/png?");
    expect(a.getAttribute("href")).toBe("/api/cards/c1/png?preset=default&corners=square&faces=both");
    expect(a.getAttribute("download")).toBe("village-elder-both-square.png");
    // A face alone: the links as they were, JPEG back on.
    await click(chip("Face", "Front"));
    a = link("/png?");
    expect(a.getAttribute("href")).toBe("/api/cards/c1/png?preset=default&corners=square");
    expect(a.getAttribute("download")).toBe("village-elder-square.png");
    expect(chip("File type", "JPEG").disabled).toBe(false);
    expect(screen.getByText("Low-resolution PNG")).toBeTruthy();
    await click(chip("File type", "JPEG"));
    expect(link("/png?").getAttribute("href")).toBe("/api/cards/c1/png?preset=default&format=jpeg");
    // Both faces again: a PNG — the JPEG pick is set aside, not lost.
    await click(chip("Face", "Both faces"));
    a = link("/png?");
    expect(a.getAttribute("href")).toBe("/api/cards/c1/png?preset=default&corners=square&faces=both");
    expect(a.getAttribute("download")).toBe("village-elder-both-square.png");
    expect(chip("File type", "PNG").getAttribute("aria-checked")).toBe("true");
    expect(chip("File type", "JPEG").disabled).toBe(true);
    await click(chip("Face", "Back"));
    expect(link("/png?").getAttribute("href")).toBe("/api/cards/c1/png?preset=default&format=jpeg&face=back");
    expect(link("/png?").getAttribute("download")).toBe("village-elder-back.jpg");
  });

  it("Front and Back: Back turns every image link into the back's, named <slug>-back…", async () => {
    await open({ isPaid: false });
    await click(chip("Face", "Front"));
    expect(link("/png?").getAttribute("href")).toBe("/api/cards/c1/png?preset=default&corners=round");
    expect(link("/png?").getAttribute("download")).toBe("village-elder.png");
    await click(chip("Face", "Back"));
    let a = link("/png?");
    expect(a.getAttribute("href")).toBe("/api/cards/c1/png?preset=default&corners=round&face=back");
    expect(a.getAttribute("download")).toBe("village-elder-back.png");
    await click(chip("Corners", "Square"));
    a = link("/png?");
    expect(a.getAttribute("href")).toBe("/api/cards/c1/png?preset=default&corners=square&face=back");
    expect(a.getAttribute("download")).toBe("village-elder-back-square.png");
    await click(chip("File type", "JPEG"));
    a = link("/png?");
    expect(a.getAttribute("href")).toBe("/api/cards/c1/png?preset=default&format=jpeg&face=back");
    expect(a.getAttribute("download")).toBe("village-elder-back.jpg");
  });

  it("a paid viewer's Both faces: the clean HD pair; the print options are off with a note until a face is picked, and come back with their picks", async () => {
    await open();
    expect(chip("Face", "Both faces").getAttribute("aria-checked")).toBe("true");
    let a = link("/png?");
    expect(a.getAttribute("href")).toBe("/api/cards/c1/png?preset=hd&corners=round&faces=both");
    expect(a.getAttribute("download")).toBe("village-elder-both.png");
    expect(screen.getByText("High-resolution PNG — both faces")).toBeTruthy();
    expect(screen.getByText(/^Clean, full-resolution \(1500 × 2100 per face\) render of the front and the back side by side in one PNG/)).toBeTruthy();
    // The print-only options: shown, disabled, with the reason.
    expect(chip("Resolution", /800 ppi/).disabled).toBe(true);
    expect(chip("Resolution", /600 ppi/).disabled).toBe(true);
    expect(chip("Bleed", "MakePlayingCards").disabled).toBe(true);
    expect(chip("Bleed", "1/8″").disabled).toBe(true);
    expect(screen.getByText("Print files come one face at a time — pick Front or Back.")).toBeTruthy();
    expect(chip("File type", "JPEG").disabled).toBe(true);
    // A face: the options are on; a print pick makes the print file.
    await click(chip("Face", "Back"));
    expect(chip("Resolution", /800 ppi/).disabled).toBe(false);
    expect(chip("Bleed", "MakePlayingCards").disabled).toBe(false);
    expect(screen.queryByText("Print files come one face at a time — pick Front or Back.")).toBeNull();
    await click(chip("Resolution", /800 ppi/));
    a = link("/png?");
    expect(a.getAttribute("href")).toBe("/api/cards/c1/png?ppi=800&corners=square&face=back");
    expect(a.getAttribute("download")).toBe("village-elder-back-800ppi.png");
    // Both faces again: never a print file — the plain pair, the 800 ppi
    // pick set aside (and back with the face).
    await click(chip("Face", "Both faces"));
    a = link("/png?");
    expect(a.getAttribute("href")).toBe("/api/cards/c1/png?preset=hd&corners=round&faces=both");
    expect(a.getAttribute("download")).toBe("village-elder-both.png");
    expect(chip("Resolution", /800 ppi/).disabled).toBe(true);
    expect(screen.getByText("Print files come one face at a time — pick Front or Back.")).toBeTruthy();
    expect(screen.queryByText(/ppi=800/)).toBeNull();
    await click(chip("Face", "Front"));
    expect(link("/png?").getAttribute("href")).toBe("/api/cards/c1/png?ppi=800&corners=square");
    expect(link("/png?").getAttribute("download")).toBe("village-elder-800ppi.png");
  });

  it("a paid viewer's print files of the back: 800 ppi, the bleed, MakePlayingCards", async () => {
    await open();
    await click(chip("Face", "Back"));
    await click(chip("Resolution", /800 ppi/));
    let a = link("/png?");
    expect(a.getAttribute("href")).toBe("/api/cards/c1/png?ppi=800&corners=square&face=back");
    expect(a.getAttribute("download")).toBe("village-elder-back-800ppi.png");
    await click(chip("Bleed", "MakePlayingCards"));
    a = link("/png?");
    expect(a.getAttribute("href")).toBe("/api/cards/c1/png?ppi=800&corners=square&bleed=mpc&face=back");
    expect(a.getAttribute("download")).toBe("village-elder-back-800ppi-mpc.png");
    // Back to the front: the links as they always were.
    await click(chip("Face", "Front"));
    a = link("/png?");
    expect(a.getAttribute("href")).toBe("/api/cards/c1/png?ppi=800&corners=square&bleed=mpc");
    expect(a.getAttribute("download")).toBe("village-elder-800ppi-mpc.png");
  });

  it("a single-faced card has no Face switch, no 'both faces' anywhere, and the links it always had", async () => {
    await open({ hasBackFace: false, isPaid: false });
    expect(screen.queryByTestId("download-face")).toBeNull();
    expect(screen.queryByRole("radiogroup", { name: "Face" })).toBeNull();
    expect(screen.queryByText(/both faces/i)).toBeNull();
    expect(screen.queryByText(/one face at a time/)).toBeNull();
    expect(chip("File type", "JPEG").disabled).toBe(false);
    expect(link("/png?").getAttribute("href")).toBe("/api/cards/c1/png?preset=default&corners=round");
    expect(link("/png?").getAttribute("download")).toBe("village-elder.png");
    expect(screen.getByText("Low-resolution PNG")).toBeTruthy();
    cleanup();
    // …and a paid viewer's: the print options on, the plain HD link.
    await open({ hasBackFace: false });
    expect(screen.queryByText(/both faces/i)).toBeNull();
    expect(chip("Resolution", /800 ppi/).disabled).toBe(false);
    expect(link("/png?").getAttribute("href")).toBe("/api/cards/c1/png?preset=hd&corners=round");
    expect(screen.getByText("High-resolution PNG")).toBeTruthy();
  });
});

describe("DownloadModal — the PDF tab's faces", () => {
  it("One card: Front / Back / Both faces (2 pages) — the link and the name follow", async () => {
    await open({ defaultTab: "single" });
    expect(chip("Faces", "Front").getAttribute("aria-checked")).toBe("true");
    expect(link("/pdf?").getAttribute("href")).toBe("/api/cards/c1/pdf?layout=card");
    expect(link("/pdf?").getAttribute("download")).toBe("village-elder.pdf");
    await click(chip("Faces", "Both faces (2 pages)"));
    expect(link("/pdf?").getAttribute("href")).toBe("/api/cards/c1/pdf?layout=card&faces=both");
    expect(link("/pdf?").getAttribute("download")).toBe("village-elder-both-faces.pdf");
    expect(screen.getByText("Both faces PDF")).toBeTruthy();
    await click(chip("Faces", "Back"));
    expect(link("/pdf?").getAttribute("href")).toBe("/api/cards/c1/pdf?layout=card&face=back");
    expect(link("/pdf?").getAttribute("download")).toBe("village-elder-back.pdf");
    await click(screen.getByTestId("download-pdf-bleed"));
    expect(link("/pdf?").getAttribute("href")).toBe("/api/cards/c1/pdf?layout=card&bleed=1&face=back");
    expect(link("/pdf?").getAttribute("download")).toBe("village-elder-back-bleed.pdf");
  });

  it("a Sheet includes the backs by default (the plain link), and backs=0 once 'Include back faces' is off — remembered", async () => {
    await open({ defaultTab: "single" });
    await click(chip("PDF layout", "Sheet of copies"));
    expect(screen.queryByRole("radiogroup", { name: "Faces" })).toBeNull();
    const backs = screen.getByTestId("download-pdf-backs") as HTMLInputElement;
    expect(backs.checked).toBe(true);
    expect(link("/pdf?").getAttribute("href")).toBe("/api/cards/c1/pdf?layout=sheet&paper=letter");
    expect(screen.getByText(/^4 copies of this card, each face beside the other, on a US Letter/)).toBeTruthy();
    await click(backs);
    expect(link("/pdf?").getAttribute("href")).toBe("/api/cards/c1/pdf?layout=sheet&paper=letter&backs=0");
    expect(link("/pdf?").getAttribute("download")).toBe("village-elder-sheet.pdf");
    expect(screen.getByText(/^9 copies of this card on a US Letter/)).toBeTruthy();
    await click(link("/pdf?"));
    expect(JSON.parse(storage.get(PRINT_SELECTION_SETTINGS_KEY)!)).toMatchObject({ layout: "sheet-letter", includeBacks: false });
  });

  it("a remembered 'off' applies to the sheet; a single-faced card shows no faces controls and keeps its links", async () => {
    storage.set(PRINT_SELECTION_SETTINGS_KEY, JSON.stringify({ includeBacks: false }));
    await open({ defaultTab: "single" });
    await click(chip("PDF layout", "Sheet of copies"));
    expect((screen.getByTestId("download-pdf-backs") as HTMLInputElement).checked).toBe(false);
    expect(link("/pdf?").getAttribute("href")).toBe("/api/cards/c1/pdf?layout=sheet&paper=letter&backs=0");
    cleanup();
    await open({ defaultTab: "single", hasBackFace: false });
    expect(screen.queryByRole("radiogroup", { name: "Faces" })).toBeNull();
    expect(link("/pdf?").getAttribute("href")).toBe("/api/cards/c1/pdf?layout=card");
    await click(chip("PDF layout", "Sheet of copies"));
    expect(screen.queryByTestId("download-pdf-backs")).toBeNull();
    expect(link("/pdf?").getAttribute("href")).toBe("/api/cards/c1/pdf?layout=sheet&paper=letter");
  });
});
