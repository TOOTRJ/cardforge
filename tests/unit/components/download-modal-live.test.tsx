// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// ---------------------------------------------------------------------------
// TODO 6.30 — a download that takes long says so. Every file of the download
// modal is drawn live; a click used to hand the link to the browser and show
// nothing until the file arrived (or nothing at all when it failed). Now:
//   * the click fetches the link's OWN URL and saves it under the link's
//     own name — what is downloaded doesn't change;
//   * the button shows a spinner and "Preparing your image…" / "…PDF…" —
//     EVERY download button while a file is prepared, so an option changed
//     meanwhile never looks idle while its clicks are swallowed;
//   * ONE polite live region, mounted empty, says it and that large files
//     can take up to a minute, then "Saved — if nothing appeared, use Save
//     file" with a Save file link to the same bytes — or why not;
//   * Cancel stops it;
//   * a modifier click is still the browser's own, and still remembers the
//     PDF's options; iOS keeps the native link (#628's check).
// ---------------------------------------------------------------------------

const upgrade = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock("@/components/billing/upgrade-modal-provider", () => ({ useUpgradeModal: () => upgrade }));
vi.mock("@/lib/analytics/funnel-client", () => ({ trackFunnelEvent: vi.fn() }));

import { DownloadModal } from "@/components/cards/download-modal";
import { DOWNLOAD_CANCELLED_MESSAGE, LONG_DOWNLOAD_NOTE } from "@/lib/cards/live-download";
import { PRINT_SELECTION_SETTINGS_KEY } from "@/lib/cards/print-selection";

type Deferred = { resolve: (r: Response) => void; reject: (e: unknown) => void };
let pending: Deferred[] = [];
const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
  (_url, init) =>
    new Promise<Response>((resolve, reject) => {
      pending.push({ resolve, reject });
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    }),
);
const saved: Array<{ href: string; download: string }> = [];
const storage = new Map<string, string>();

beforeEach(() => {
  pending = [];
  saved.length = 0;
  storage.clear();
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, value),
  });
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:saved-file");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  // The temporary anchor that hands the blob to the browser.
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    saved.push({ href: this.href, download: this.download });
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  cleanup();
});

async function open({ isPaid = true, tab = "png" as "png" | "single" } = {}) {
  render(<DownloadModal cardId="c1" cardSlug="grizzly" isPaid={isPaid} canBatch={isPaid} defaultTab={tab} />);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /download/i }));
  });
}

function link(part: string): HTMLAnchorElement {
  const links = screen
    .getAllByRole("link")
    .filter((a) => (a.getAttribute("href") ?? "").includes(part)) as HTMLAnchorElement[];
  expect(links).toHaveLength(1);
  return links[0];
}

const status = () => screen.getByRole("status");

async function click(el: HTMLElement, init: MouseEventInit = {}) {
  await act(async () => {
    fireEvent.click(el, init);
  });
}

const png = () => new Response(new Uint8Array([137, 80, 78, 71]), { status: 200, headers: { "content-type": "image/png" } });

describe("DownloadModal — a live download says so (TODO 6.30)", () => {
  it("the live region is there, empty, before anything happens — and there is one", async () => {
    await open();
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(status().textContent).toBe("");
    expect(status().getAttribute("aria-live")).toBe("polite");
  });

  it("a click shows a spinner and 'Preparing your image…', says it can take up to a minute, then saves the link's own file — and keeps it as Save file", async () => {
    await open();
    const anchor = link("/png?");
    const href = anchor.getAttribute("href")!;
    const filename = anchor.getAttribute("download")!;
    await click(anchor);

    // The same URL the link names — nothing about the file changes.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(href);
    expect(link("/png?").textContent).toBe(" Preparing your image…");
    expect(link("/png?").getAttribute("aria-busy")).toBe("true");
    expect(link("/png?").querySelector(".animate-spin")).not.toBeNull();
    expect(status().textContent).toBe(`Preparing your image… ${LONG_DOWNLOAD_NOTE}`);

    // A second click while it is prepared starts nothing.
    await click(link("/png?"));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      pending[0].resolve(png());
    });
    await waitFor(() => expect(saved).toEqual([{ href: "blob:saved-file", download: filename }]));
    // A browser may drop a save made long after the click (iOS): "Saved"
    // never claims more than it knows, and the bytes stay one click away.
    expect(status().textContent).toBe(`Saved ${filename} — if nothing appeared, use Save file.`);
    const saveFile = screen.getByTestId("live-download-save");
    expect(saveFile.getAttribute("href")).toBe("blob:saved-file");
    expect(saveFile.getAttribute("download")).toBe(filename);
    // …outside the live region, which only speaks.
    expect(within(status()).queryByRole("link")).toBeNull();
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    expect(link("/png?").textContent).toBe(" Download");
  });

  it("a refusal is said in the route's own words, in the same region", async () => {
    await open({ tab: "single" });
    await click(link("/pdf?"));
    expect(link("/pdf?").textContent).toBe(" Preparing your PDF…");
    expect(status().textContent).toBe(`Preparing your PDF… ${LONG_DOWNLOAD_NOTE}`);
    await act(async () => {
      pending[0].resolve(
        new Response(JSON.stringify({ error: "PDF export is a Plus feature. Upgrade to download print-ready PDFs." }), {
          status: 403,
          headers: { "content-type": "application/json" },
        }),
      );
    });
    await waitFor(() =>
      expect(status().textContent).toBe("PDF export is a Plus feature. Upgrade to download print-ready PDFs."),
    );
    expect(saved).toEqual([]);
    expect(screen.getAllByRole("status")).toHaveLength(1);
    // The button is back, ready for another try.
    expect(link("/pdf?").textContent).toBe(" Download");
  });

  it("a dropped connection says so — never a silent dead click", async () => {
    await open({ isPaid: false });
    await click(link("/png?"));
    await act(async () => {
      pending[0].reject(new TypeError("Failed to fetch"));
    });
    await waitFor(() => expect(status().textContent).toMatch(/didn't go through/));
  });

  it("Cancel stops the file being prepared and says so", async () => {
    await open();
    await click(link("/png?"));
    await click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(status().textContent).toBe(DOWNLOAD_CANCELLED_MESSAGE));
    expect(saved).toEqual([]);
    expect(link("/png?").textContent).toBe(" Download");
  });

  it("an option changed while a file is prepared keeps the busy look; the new link starts a fresh download once the old one is done", async () => {
    await open();
    const first = link("/png?").getAttribute("href")!;
    await click(link("/png?"));
    // Square corners: the link moves to another file.
    await click(within(screen.getByTestId("download-corners")).getByRole("radio", { name: "Square" }));
    const second = link("/png?").getAttribute("href")!;
    expect(second).not.toBe(first);
    // Still busy, and saying so — never an idle button that swallows clicks.
    expect(link("/png?").textContent).toBe(" Preparing your image…");
    expect(link("/png?").getAttribute("aria-disabled")).toBe("true");
    await click(link("/png?"));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      pending[0].resolve(png());
    });
    await waitFor(() => expect(link("/png?").textContent).toBe(" Download"));
    await click(link("/png?"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe(second);
  });

  it("a modifier click (a new tab, save as) is left to the browser — and still remembers the PDF's options", async () => {
    await open({ tab: "single" });
    await click(screen.getByTestId("download-pdf-bleed"));
    await click(link("/pdf?"), { metaKey: true });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(status().textContent).toBe("");
    expect(JSON.parse(storage.get(PRINT_SELECTION_SETTINGS_KEY)!)).toMatchObject({ bleed: true });
  });

  it.each([
    ["iPhone Safari", "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1"],
    ["iPhone Chrome", "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 CriOS/130.0 Mobile/15E148 Safari/604.1"],
  ])("%s keeps the native link: no fetch, no programmatic save", async (_name, userAgent) => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(userAgent);
    await open();
    const anchor = link("/png?");
    const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    await act(async () => {
      anchor.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(saved).toEqual([]);
  });
});
