// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

// ---------------------------------------------------------------------------
// The reference pin (TODO 0.18) — "Change reference card" on the compare
// page. Contract: the search goes through our /api/scryfall/search proxy,
// debounced, only for a non-empty query; picking a printing pins exactly
// that id for this (template, colour) — the server re-reads the card and
// may refuse or warn — then closes the search and refreshes the page;
// "Revert to default" shows only while a printing is pinned and sends null.
// A refusal keeps the search open and refreshes nothing.
// ---------------------------------------------------------------------------

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), message: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
const actions = vi.hoisted(() => ({ setFrameReferenceAction: vi.fn() }));
vi.mock("@/lib/cards/frame-review-actions", () => ({
  setFrameReferenceAction: actions.setFrameReferenceAction,
}));
const fetchMock = vi.hoisted(() => vi.fn());

import { FrameReferencePicker } from "@/components/admin/frame-reference-picker";

const GANDALF = {
  id: "eae80537-f355-4aa3-8952-b08f3d1a1e41",
  name: "Gandalf, Friend of the Shire",
  set: "ltr",
  thumb_url: null,
  image_status: "lowres",
};
const ELROND = {
  id: "308465a9-2143-49f2-b9d0-a09272dd1b62",
  name: "Elrond, Lord of Rivendell",
  set: "ltr",
  thumb_url: null,
  image_status: "highres_scan",
};

function searchAnswers(results: unknown[]) {
  fetchMock.mockImplementation(async () => ({ ok: true, json: async () => ({ ok: true, results }) }));
}

async function openAndSearch(query: string) {
  fireEvent.click(screen.getByRole("button", { name: /change reference card/i }));
  const input = screen.getByRole("searchbox", { name: "Search Scryfall for a reference card" });
  fireEvent.change(input, { target: { value: query } });
  return input;
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  searchAnswers([GANDALF, ELROND]);
  actions.setFrameReferenceAction.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
  toast.message.mockReset();
  router.refresh.mockReset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("FrameReferencePicker", () => {
  it("searches through the proxy and lists the printings with a low-res flag", async () => {
    render(<FrameReferencePicker template="lotr" colorKey="u" isCustom={false} />);
    await openAndSearch("gandalf e:ltr");

    await screen.findByText(GANDALF.name);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = new URL(fetchMock.mock.calls[0][0] as string, "https://www.pipglyph.com");
    expect(url.pathname).toBe("/api/scryfall/search");
    expect(url.searchParams.get("q")).toBe("gandalf e:ltr");
    expect(url.searchParams.get("limit")).toBe("8");
    expect(screen.getByText(/ltr · low-res scan/)).toBeTruthy();
    expect(screen.getByText(ELROND.name)).toBeTruthy();
  });

  it("waits for the typing to pause: one search for the finished query, none per keystroke", async () => {
    render(<FrameReferencePicker template="lotr" colorKey="u" isCustom={false} />);
    const input = await openAndSearch("g");
    // Keystrokes 50 ms apart — well inside the 300 ms debounce.
    for (const partial of ["ga", "gan", "gandalf"]) {
      await new Promise((r) => setTimeout(r, 50));
      fireEvent.change(input, { target: { value: partial } });
    }

    await screen.findByText(GANDALF.name);
    await new Promise((r) => setTimeout(r, 400));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = new URL(fetchMock.mock.calls[0][0] as string, "https://www.pipglyph.com");
    expect(url.searchParams.get("q")).toBe("gandalf");
  });

  it("never searches for a blank query, and says when nothing matched", async () => {
    render(<FrameReferencePicker template="lotr" colorKey="u" isCustom={false} />);
    const input = await openAndSearch("   ");
    await new Promise((r) => setTimeout(r, 400));
    expect(fetchMock).not.toHaveBeenCalled();

    searchAnswers([]);
    fireEvent.change(input, { target: { value: "no such card" } });
    await screen.findByText("No matches.");
  });

  it("pins the picked printing for this combo, then closes and refreshes the page", async () => {
    actions.setFrameReferenceAction.mockResolvedValueOnce({ ok: true, warning: null, name: ELROND.name });
    render(<FrameReferencePicker template="lotr" colorKey="u" isCustom={false} />);
    await openAndSearch("elrond");
    fireEvent.click(await screen.findByRole("button", { name: /Elrond, Lord of Rivendell/ }));

    await waitFor(() => expect(router.refresh).toHaveBeenCalledTimes(1));
    expect(actions.setFrameReferenceAction).toHaveBeenCalledWith({
      template: "lotr",
      colorKey: "u",
      scryfallId: ELROND.id,
    });
    expect(toast.success).toHaveBeenCalledWith(`Reference set to ${ELROND.name}.`);
    expect(screen.queryByRole("searchbox")).toBeNull();
  });

  it("shows the server's warning with the pin (a low-res scan, an era mismatch)", async () => {
    actions.setFrameReferenceAction.mockResolvedValueOnce({
      ok: true,
      warning: "This printing only has a low-resolution scan.",
      name: GANDALF.name,
    });
    render(<FrameReferencePicker template="lotr" colorKey="u" isCustom={false} />);
    await openAndSearch("gandalf");
    fireEvent.click(await screen.findByRole("button", { name: /Gandalf, Friend of the Shire/ }));

    await waitFor(() =>
      expect(toast.message).toHaveBeenCalledWith(`Reference set to ${GANDALF.name}`, {
        description: "This printing only has a low-resolution scan.",
      }),
    );
    expect(toast.success).not.toHaveBeenCalled();
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it("keeps the search open and refreshes nothing when the server refuses the printing", async () => {
    actions.setFrameReferenceAction.mockResolvedValueOnce({
      ok: false,
      error: "That printing is white; this row is blue.",
    });
    render(<FrameReferencePicker template="lotr" colorKey="u" isCustom={false} />);
    await openAndSearch("gandalf");
    fireEvent.click(await screen.findByRole("button", { name: /Gandalf, Friend of the Shire/ }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("That printing is white; this row is blue."));
    expect(router.refresh).not.toHaveBeenCalled();
    expect(screen.getByRole("searchbox")).toBeTruthy();
    expect(screen.getByText(GANDALF.name)).toBeTruthy();
  });

  it("offers Revert only while a printing is pinned, and reverts with null", async () => {
    const { rerender } = render(<FrameReferencePicker template="lotr" colorKey="u" isCustom={false} />);
    expect(screen.queryByRole("button", { name: /revert to default/i })).toBeNull();

    actions.setFrameReferenceAction.mockResolvedValueOnce({ ok: true, warning: null, name: null });
    rerender(<FrameReferencePicker template="lotr" colorKey="u" isCustom />);
    fireEvent.click(screen.getByRole("button", { name: /revert to default/i }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Reverted to the default reference."));
    expect(actions.setFrameReferenceAction).toHaveBeenCalledWith({
      template: "lotr",
      colorKey: "u",
      scryfallId: null,
    });
    expect(router.refresh).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("on a back-face frame's row the results show each printing's BACK face, and say when there is none (TODO 5.0b)", async () => {
    const avacyn = {
      id: "a1a1a1a1-0001-4001-8001-000000000001",
      name: "Archangel Avacyn // Avacyn, the Purifier",
      set: "soi",
      thumb_url: "https://cards.scryfall.io/art_crop/front/a/1/front.jpg",
      back_thumb_url: "https://cards.scryfall.io/art_crop/back/a/1/back.jpg",
      image_status: "highres_scan",
    };
    searchAnswers([avacyn, { ...GANDALF, thumb_url: "https://cards.scryfall.io/art_crop/front/e/a/gandalf.jpg", back_thumb_url: null }]);
    render(<FrameReferencePicker template="lotr" colorKey="u" isCustom={false} face="back" />);
    fireEvent.click(screen.getByRole("button", { name: /change reference card \(back face\)/i }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "avacyn" } });

    await screen.findByText(avacyn.name);
    const thumbs = Array.from(document.querySelectorAll("img")).map((img) => img.getAttribute("src"));
    // The back's art for the two-faced printing; nothing (no front art
    // standing in) for the single-faced one.
    expect(thumbs).toEqual(["https://cards.scryfall.io/art_crop/back/a/1/back.jpg"]);
    expect(screen.getByText(/soi · back face/)).toBeTruthy();
    expect(screen.getByText(/ltr · low-res scan · no second face/)).toBeTruthy();
    // The pin itself carries no face: the row's template decides it.
    actions.setFrameReferenceAction.mockResolvedValueOnce({ ok: true, warning: null, name: avacyn.name });
    fireEvent.click(screen.getByRole("button", { name: /Archangel Avacyn/ }));
    await waitFor(() => expect(router.refresh).toHaveBeenCalledTimes(1));
    expect(actions.setFrameReferenceAction).toHaveBeenCalledWith({ template: "lotr", colorKey: "u", scryfallId: avacyn.id });
  });

  it("a front row shows the front art as before", async () => {
    searchAnswers([{ ...GANDALF, thumb_url: "https://cards.scryfall.io/art_crop/front/e/a/gandalf.jpg", back_thumb_url: null }]);
    render(<FrameReferencePicker template="lotr" colorKey="u" isCustom={false} />);
    await openAndSearch("gandalf");
    await screen.findByText(GANDALF.name);
    expect(Array.from(document.querySelectorAll("img")).map((img) => img.getAttribute("src"))).toEqual([
      "https://cards.scryfall.io/art_crop/front/e/a/gandalf.jpg",
    ]);
    expect(screen.queryByText(/no second face/)).toBeNull();
  });
});
