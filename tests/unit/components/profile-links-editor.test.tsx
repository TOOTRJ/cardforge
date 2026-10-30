// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Settings → "More links" / "Store cards" (migration 0153): the editor checks
// the list with the server's own schema before sending it (a bad link never
// leaves the page), sends the rows in order under the payload keys the RPCs
// read, puts a server error under its row, and hands the focus on when a row
// is removed.
// ---------------------------------------------------------------------------

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
const saveLinks = vi.fn();
const saveStores = vi.fn();
vi.mock("@/app/(app)/settings/link-actions", () => ({
  saveProfileLinksAction: (rows: unknown) => saveLinks(rows),
  saveProfileStoresAction: (rows: unknown) => saveStores(rows),
}));

import { ProfileLinksEditor, ProfileStoresEditor } from "@/components/settings/profile-links-editor";

beforeEach(() => {
  saveLinks.mockReset().mockResolvedValue({ ok: true });
  saveStores.mockReset().mockResolvedValue({ ok: true });
  refresh.mockReset();
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => {
    fn(0);
    return 0;
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ProfileLinksEditor", () => {
  it("refuses a link for the wrong site before sending anything", async () => {
    render(<ProfileLinksEditor initialRows={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "Add a link" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Site" }), { target: { value: "moxfield" } });
    fireEvent.change(screen.getByRole("textbox", { name: /URL/ }), {
      target: { value: "https://evil.example/users/a" },
    });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save" })));
    expect(saveLinks).not.toHaveBeenCalled();
    const url = screen.getByRole("textbox", { name: /URL/ });
    expect(url.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText(/isn't a Moxfield link/)).toBeTruthy();
  });

  it("sends the rows in order under the RPC's keys", async () => {
    render(
      <ProfileLinksEditor
        initialRows={[
          { choice: "kofi", url: "https://ko-fi.com/forge", text: "" },
          { choice: "other", url: "https://forge.example/blog", text: "Blog" },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Move Link 2 up" }));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save" })));
    expect(saveLinks).toHaveBeenCalledWith([
      { kind: "other", url: "https://forge.example/blog", label: "Blog" },
      { kind: "kofi", url: "https://ko-fi.com/forge" },
    ]);
    expect(refresh).toHaveBeenCalled();
  });

  it("puts a server's row error under that row", async () => {
    saveLinks.mockResolvedValue({ ok: false, formError: "Check the highlighted rows.", rowErrors: { 0: { label: "Too long." } } });
    render(<ProfileLinksEditor initialRows={[{ choice: "other", url: "https://a.example/", text: "Blog" }]} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "Blog 2" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save" })));
    expect(screen.getByText("Too long.")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("Check the highlighted rows.");
  });

  it("hands the focus to the next row's remove button when a row goes", async () => {
    render(
      <ProfileLinksEditor
        initialRows={[
          { choice: "kofi", url: "https://ko-fi.com/a", text: "" },
          { choice: "kofi", url: "https://ko-fi.com/b", text: "" },
        ]}
      />,
    );
    const first = screen.getByRole("button", { name: "Remove Link 1" });
    first.focus();
    await act(async () => fireEvent.click(first));
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Remove Link 1");
    expect(screen.getAllByRole("textbox", { name: /URL/ })).toHaveLength(1);
  });
});

describe("ProfileStoresEditor", () => {
  it("saves a store with its title", async () => {
    render(<ProfileStoresEditor initialRows={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "Add a store" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Platform" }), { target: { value: "ebay" } });
    fireEvent.change(screen.getByRole("textbox", { name: /URL/ }), {
      target: { value: "https://www.ebay.com/str/forgecards" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: /Card title/ }), { target: { value: "Singles & sealed" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save" })));
    expect(saveStores).toHaveBeenCalledWith([
      { platform: "ebay", url: "https://www.ebay.com/str/forgecards", title: "Singles & sealed" },
    ]);
  });
});
