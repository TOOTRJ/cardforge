// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import {
  card,
  json,
  searchResult,
  stubScryfallRoutes,
  verifiedIn,
} from "./scryfall-import-stubs";

// ---------------------------------------------------------------------------
// The import dialog's printings grid (TODO 1.5) and its state fixes (1.9):
// every printing's Exact / Nearest / Not available badge with its tooltip,
// the treatment filter chips and "Load more" (each a view/page of
// /api/scryfall/printings), a stale search that never reports "Search
// failed" nor stops the newer search's spinner, a printing click that keeps
// the result list's selection and the grid (so its scroll), and a commit the
// dialog can't be closed under.
// ---------------------------------------------------------------------------

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), message: vi.fn(), info: vi.fn() },
}));

import { ScryfallImportDialog } from "@/components/creator/scryfall-import-dialog";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const SERVER_VERIFIED = new Set([...verifiedIn("m15", "m15token", "m15land")]);

function renderDialog(props: Partial<Parameters<typeof ScryfallImportDialog>[0]> = {}) {
  const onOpenChange = vi.fn();
  const onImport = vi.fn();
  render(
    <ScryfallImportDialog
      signedIn
      open
      onOpenChange={onOpenChange}
      onImport={onImport}
      verifiedFrameKeys={[...SERVER_VERIFIED]}
      currentFrameTemplate="m15"
      {...props}
    />,
  );
  return { onOpenChange, onImport };
}

async function openSheoldred() {
  fireEvent.change(screen.getByLabelText("Search Scryfall"), { target: { value: "Sheoldred" } });
  fireEvent.click(await screen.findByRole("option", { name: /Sheoldred/ }));
  await screen.findByText(/Will populate/);
}

const grid = () => screen.getByTestId("printings-grid");
const printingsCalls = (mock: ReturnType<typeof vi.fn>) =>
  mock.mock.calls.map(([u]) => String(u)).filter((u) => u.startsWith("/api/scryfall/printings"));

describe("the printings grid (TODO 1.5)", () => {
  it("badges each printing ✓ Exact · ≈ Nearest · ✕ Not available, with what it is and why in the tooltip", async () => {
    stubScryfallRoutes({
      search: ["dmu-107"],
      printings: { representative: [["tdom-3", "dmu-435", "sznr-1", "t2xm-4"]] },
      serverVerified: SERVER_VERIFIED,
    });
    renderDialog();
    await openSheoldred();
    await waitFor(() => expect(grid()).toBeTruthy());

    const tiles = within(grid()).getAllByRole("button");
    expect(tiles).toHaveLength(4);
    const badge = (tile: HTMLElement) => tile.querySelector("[data-status]") as HTMLElement;
    expect(badge(tiles[0]!).textContent).toBe("✓ Exact");
    expect(badge(tiles[1]!).textContent).toBe("≈ Nearest");
    expect(badge(tiles[1]!).title).toBe(
      "Borderless frame — PipGlyph doesn't draw the legendary crown on this frame yet",
    );
    expect(badge(tiles[2]!).textContent).toBe("✕ Not available");
    // SET · year · #number, and the treatment badge.
    expect(tiles[1]!.textContent).toContain("DMU · 2023 · #435");
    expect(tiles[1]!.textContent).toContain("Borderless");
    // A full-art token of the M20 design: nearest the arch (TODO 1.23).
    expect(badge(tiles[3]!).textContent).toBe("≈ Nearest");
    expect(badge(tiles[3]!).title).toBe(
      "M20 full-art token frame — PipGlyph doesn't have the current full-art token frame yet",
    );
    expect(tiles[3]!.textContent).toContain("Full art");
  });

  it("a filter chip asks for that view; Load more asks for the next page and appends it", async () => {
    const mock = stubScryfallRoutes({
      search: ["dmu-107"],
      printings: {
        representative: [["dmu-107"]],
        fullart: [["one-262", "bfz-250"], ["znr-266"]],
      },
      serverVerified: SERVER_VERIFIED,
    });
    renderDialog();
    await openSheoldred();
    await waitFor(() => expect(printingsCalls(mock)).toHaveLength(1));
    expect(printingsCalls(mock)[0]).toContain("view=representative");

    const filters = screen.getByRole("radiogroup", { name: "Printing filter" });
    fireEvent.click(within(filters).getByRole("radio", { name: "Full art" }));
    await waitFor(() => expect(within(grid()).getAllByRole("button")).toHaveLength(2));
    expect(printingsCalls(mock)[1]).toMatch(/view=fullart&page=1/);
    expect(screen.getByText("2 of 3 printings")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /load more/i }));
    await waitFor(() => expect(within(grid()).getAllByRole("button")).toHaveLength(3));
    expect(printingsCalls(mock)[2]).toMatch(/view=fullart&page=2/);
    expect(screen.queryByRole("button", { name: /load more/i })).toBeNull();

    // Back to Representative: cached, no new search.
    fireEvent.click(within(filters).getByRole("radio", { name: "Representative" }));
    await waitFor(() => expect(within(grid()).getAllByRole("button")).toHaveLength(1));
    expect(printingsCalls(mock)).toHaveLength(3);
  });
});

describe("dialog state (TODO 1.9)", () => {
  it("a stale aborted search never shows 'Search failed' nor stops the newer search's spinner", async () => {
    let releaseSecond: (() => void) | null = null;
    stubScryfallRoutes({
      search: [],
      printings: {},
      serverVerified: SERVER_VERIFIED,
      override: (url, init) => {
        if (!url.startsWith("/api/scryfall/search")) return undefined;
        const q = new URL(url, "http://x").searchParams.get("q");
        if (q === "Sheo") {
          // The first search's body is still being read when the next
          // keystroke aborts it: json() rejects.
          const signal = init?.signal as AbortSignal;
          return {
            ok: true,
            json: () =>
              new Promise((_, reject) =>
                signal.addEventListener("abort", () =>
                  reject(new DOMException("aborted", "AbortError")),
                ),
              ),
          } as unknown as Response;
        }
        return new Promise<Response>((resolve) => {
          releaseSecond = () => resolve(json({ ok: true, results: [searchResult("dmu-107")] }));
        });
      },
    });
    renderDialog();
    const input = screen.getByLabelText("Search Scryfall");
    fireEvent.change(input, { target: { value: "Sheo" } });
    await waitFor(() => expect(screen.queryByTestId("search-spinner")).toBeTruthy());
    // The first request is in flight (its body pending); type again.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    fireEvent.change(input, { target: { value: "Sheoldred" } });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(screen.queryByText("Search failed.")).toBeNull();
    expect(screen.queryByTestId("search-spinner")).toBeTruthy();

    await waitFor(() => expect(releaseSecond).not.toBeNull());
    await act(async () => {
      releaseSecond!();
    });
    await screen.findByRole("option", { name: /Sheoldred/ });
    expect(screen.queryByText("Search failed.")).toBeNull();
    await waitFor(() => expect(screen.queryByTestId("search-spinner")).toBeNull());
  });

  it("a printing click keeps the result list's selection and the grid (its scroll)", async () => {
    const mock = stubScryfallRoutes({
      search: ["dmu-107"],
      printings: { representative: [["dmu-107", "dmu-435"]] },
      serverVerified: SERVER_VERIFIED,
    });
    renderDialog();
    await openSheoldred();
    await waitFor(() => expect(within(grid()).getAllByRole("button")).toHaveLength(2));
    const gridBefore = grid();
    gridBefore.scrollTop = 120;

    const [plain, borderless] = within(gridBefore).getAllByRole("button");
    expect(plain!.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(borderless!);
    // While it loads, the detail stays mounted under an overlay.
    expect(screen.getByText("Loading printing…")).toBeTruthy();
    expect(screen.getByText(/Will populate/)).toBeTruthy();
    await waitFor(() =>
      expect(within(grid()).getAllByRole("button")[1]!.getAttribute("aria-pressed")).toBe("true"),
    );
    expect(screen.queryByText("Loading printing…")).toBeNull();

    // The left list still highlights the search result.
    expect(screen.getByRole("option", { name: /Sheoldred/ }).getAttribute("aria-selected")).toBe("true");
    // Same grid node, same scroll; no second printings search.
    expect(grid()).toBe(gridBefore);
    expect(grid().scrollTop).toBe(120);
    expect(printingsCalls(mock)).toHaveLength(1);
    expect(
      mock.mock.calls.map(([u]) => String(u)).filter((u) => u.includes(card("dmu-435").id)),
    ).toHaveLength(1);
  });

  it("Escape, Cancel, an outside click and the X can't close the dialog while it commits", async () => {
    let releaseArt: (() => void) | null = null;
    stubScryfallRoutes({
      search: ["t2xm-4"],
      printings: {},
      serverVerified: SERVER_VERIFIED,
      override: (url) =>
        url.startsWith("/api/scryfall/import-art")
          ? new Promise<Response>((resolve) => {
              releaseArt = () => resolve(json({ ok: false, error: "nope" }));
            })
          : undefined,
    });
    const { onOpenChange, onImport } = renderDialog();
    fireEvent.change(screen.getByLabelText("Search Scryfall"), { target: { value: "Cat" } });
    fireEvent.click(await screen.findByRole("option", { name: /Cat/ }));
    await screen.findByText(/Will populate/);

    fireEvent.click(screen.getByRole("button", { name: /use as starting point/i }));
    await screen.findByText("Working…");

    const cancel = screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement;
    const close = screen.getByRole("button", { name: "Close" }) as HTMLButtonElement;
    expect(cancel.disabled).toBe(true);
    expect(close.disabled).toBe(true);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    fireEvent.click(close);
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(screen.getByRole("dialog")).toBeTruthy();

    await waitFor(() => expect(releaseArt).not.toBeNull());
    await act(async () => {
      releaseArt!();
    });
    await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1));
    // The import itself closes it.
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });
});
