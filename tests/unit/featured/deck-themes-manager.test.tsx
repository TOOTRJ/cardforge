// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// /admin/featured "Featured themed decks": a row's controls go OFF while a
// request runs as `aria-disabled`, never `disabled` — a disabled button
// drops the keyboard focus mid-reorder. Off, a press calls no action.
// ---------------------------------------------------------------------------

const actions = vi.hoisted(() => ({
  moveDeckThemeAction: vi.fn(() => new Promise<{ ok: true }>(() => {})),
  moveDeckInThemeAction: vi.fn(() => new Promise<{ ok: true }>(() => {})),
  setDeckThemeLiveAction: vi.fn(),
  deleteDeckThemeAction: vi.fn(),
  removeDeckFromThemeAction: vi.fn(),
  addDeckToThemeAction: vi.fn(),
  createDeckThemeAction: vi.fn(),
  updateDeckThemeAction: vi.fn(),
}));
vi.mock("@/lib/featured/deck-theme-actions", () => actions);
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("sonner", () => ({ toast: { success: () => {} } }));
vi.mock("@/lib/admin/admin-toast", () => ({ adminErrorToast: () => {} }));

import { FeaturedDeckThemesManager, type AdminDeckTheme } from "@/components/admin/featured-deck-themes-manager";

const theme = (id: string, title: string): AdminDeckTheme => ({
  id,
  title,
  blurb: null,
  isLive: true,
  picks: [
    { deckId: `${id}-a`, slug: `${id}-a`, title: `${title} A`, hiddenReason: null },
    { deckId: `${id}-b`, slug: `${id}-b`, title: `${title} B`, hiddenReason: null },
  ],
});

afterEach(cleanup);

describe("FeaturedDeckThemesManager", () => {
  it("never uses `disabled` on a row control; the ends are aria-disabled and inert", () => {
    render(<FeaturedDeckThemesManager themes={[theme("t1", "Dragons"), theme("t2", "Artifacts")]} />);
    const up = screen.getByRole("button", { name: "Move Dragons up" });
    expect((up as HTMLButtonElement).disabled).toBe(false);
    expect(up.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(up);
    expect(actions.moveDeckThemeAction).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Move Dragons A up" }).getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByRole("button", { name: "Move Dragons down" }).hasAttribute("aria-disabled")).toBe(false);
  });

  it("keeps the focus on the pressed button while its request runs, and ignores presses until it answers", async () => {
    render(<FeaturedDeckThemesManager themes={[theme("t1", "Dragons"), theme("t2", "Artifacts")]} />);
    const down = screen.getByRole("button", { name: "Move Dragons A down" });
    down.focus();
    await act(async () => {
      fireEvent.click(down);
    });
    expect(actions.moveDeckInThemeAction).toHaveBeenCalledTimes(1);
    expect(down.getAttribute("aria-disabled")).toBe("true");
    expect((down as HTMLButtonElement).disabled).toBe(false);
    expect(document.activeElement).toBe(down);
    fireEvent.click(down);
    fireEvent.click(screen.getByRole("button", { name: "Move Dragons down" }));
    expect(actions.moveDeckInThemeAction).toHaveBeenCalledTimes(1);
    expect(actions.moveDeckThemeAction).not.toHaveBeenCalled();
  });
});
