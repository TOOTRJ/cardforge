// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";

// ---------------------------------------------------------------------------
// TODO 5.3 — the download modal of a double-faced card (`hasBackFace`: a
// back with a body of its own, what the bake writes). The Image tab gets a
// Face switch, Front / Back: every image link of the back carries
// `&face=back` and is named <slug>-back…; the PDF tab's One card gets Faces
// — Front / Back / Both faces (2 pages) — and its Sheet the shared "Include
// back faces" checkbox (on by default, remembered with the print settings;
// off → `backs=0`). A single-faced card's modal is exactly what it was: no
// switch, the links and names unchanged.
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
  it("opens on the front; Back turns every image link into the back's, named <slug>-back…", async () => {
    await open({ isPaid: false });
    expect(chip("Face", "Front").getAttribute("aria-checked")).toBe("true");
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

  it("a single-faced card has no Face switch, and the links it always had", async () => {
    await open({ hasBackFace: false, isPaid: false });
    expect(screen.queryByTestId("download-face")).toBeNull();
    expect(screen.queryByRole("radiogroup", { name: "Face" })).toBeNull();
    expect(link("/png?").getAttribute("href")).toBe("/api/cards/c1/png?preset=default&corners=round");
    expect(link("/png?").getAttribute("download")).toBe("village-elder.png");
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
