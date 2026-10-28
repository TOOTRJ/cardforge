// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

// ---------------------------------------------------------------------------
// TODO 6.30 — a download that takes long says so. Every file of the download
// modal is drawn live; a click used to hand the link to the browser and show
// nothing until the file arrived (or nothing at all when it failed). Now:
//   * the click fetches the link's OWN URL and saves it under the link's
//     own name — what is downloaded doesn't change;
//   * the button shows a spinner and "Preparing your image…" / "…PDF…";
//   * ONE polite live region, mounted empty, says it and that large files
//     can take up to a minute, then that the file was saved — or why not;
//   * a modifier click is still the browser's own.
// ---------------------------------------------------------------------------

const upgrade = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock("@/components/billing/upgrade-modal-provider", () => ({ useUpgradeModal: () => upgrade }));
vi.mock("@/lib/analytics/funnel-client", () => ({ trackFunnelEvent: vi.fn() }));

import { DownloadModal } from "@/components/cards/download-modal";
import { LONG_DOWNLOAD_NOTE } from "@/lib/cards/live-download";

type Deferred = { resolve: (r: Response) => void; reject: (e: unknown) => void };
let pending: Deferred[] = [];
const fetchMock = vi.fn<(url: string) => Promise<Response>>(
  () =>
    new Promise<Response>((resolve, reject) => {
      pending.push({ resolve, reject });
    }),
);
const saved: Array<{ href: string; download: string }> = [];

beforeEach(() => {
  pending = [];
  saved.length = 0;
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
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

describe("DownloadModal — a live download says so (TODO 6.30)", () => {
  it("the live region is there, empty, before anything happens — and there is one", async () => {
    await open();
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(status().textContent).toBe("");
    expect(status().getAttribute("aria-live")).toBe("polite");
  });

  it("a click shows a spinner and 'Preparing your image…', says it can take up to a minute, then saves the link's own file", async () => {
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
      pending[0].resolve(new Response(new Uint8Array([137, 80, 78, 71]), { status: 200 }));
    });
    expect(saved).toEqual([{ href: "blob:saved-file", download: filename }]);
    expect(status().textContent).toBe(`Saved ${filename} — check your downloads.`);
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
    expect(saved).toEqual([]);
    expect(status().textContent).toBe("PDF export is a Plus feature. Upgrade to download print-ready PDFs.");
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
    expect(status().textContent).toMatch(/didn't go through/);
  });

  it("a modifier click (a new tab, save as) is left to the browser", async () => {
    await open();
    await click(link("/png?"), { metaKey: true });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(status().textContent).toBe("");
  });
});
