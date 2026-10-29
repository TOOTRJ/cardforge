// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";

// ---------------------------------------------------------------------------
// The decklist import's slot forecast (owner decision D2, TODO DK3.7): a
// pasted list uses no saved-CARD slots; customizing a card does. The review
// says how many slots are left, names both counts (copies and different
// cards) so it reads right beside the badge and the Add button, links to
// more slots when the list outgrows them, and never blocks the import.
// (Decks themselves are unlimited on every plan — owner 2026-10-29.)
// ---------------------------------------------------------------------------

const s = vi.hoisted(() => ({ resolve: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode } & Record<string, unknown>) => (
    <a href={String(href)} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), message: vi.fn() } }));
vi.mock("@/lib/decks/import", () => ({ resolveDecklistAction: s.resolve, commitDeckImportAction: vi.fn() }));

import { ImportDecklistDialog } from "@/components/decks/import-decklist-dialog";

const click = async (element: Element) => {
  await act(async () => {
    fireEvent.click(element);
  });
};

beforeEach(() => {
  s.resolve.mockReset();
});
afterEach(() => {
  cleanup();
});

describe("the import's slot forecast (D2)", () => {
  /** [name, quantity] lines; the last one on the sideboard. */
  const lines = (entries: Array<[string, number]>) =>
    entries.map(([name, quantity], i) => ({
      line: i + 1,
      raw: `${quantity} ${name}`,
      name,
      quantity,
      board: i === entries.length - 1 ? "side" : "main",
      status: "unresolved",
      resolved: null,
    }));

  async function review(
    cardCapacity: { used: number; cap: number; tier: "free" | "plus" | "pro" } | null,
    entries: Array<[string, number]>,
  ) {
    window.history.replaceState(null, "", "/deck/me/burn");
    s.resolve.mockResolvedValue({ ok: true, title: null, parseWarnings: [], lines: lines(entries) });
    render(<ImportDecklistDialog deckId="d1" defaultOpen cardCapacity={cardCapacity} />);
    await act(async () => {
      fireEvent.change(screen.getByRole("textbox", { name: "Decklist text" }), {
        target: { value: entries.map(([name, quantity]) => `${quantity} ${name}`).join("\n") },
      });
    });
    await click(screen.getByRole("button", { name: /preview import/i }));
    return screen.findByTestId("import-slot-forecast");
  }

  it("names the copies the review counts AND the different cards customizing would use", async () => {
    // A 100-card list with 30 Islands: the badge and the button say 100,
    // customizing would take one slot per DIFFERENT card (71).
    const spells = Array.from({ length: 70 }, (_, i) => [`Spell ${i + 1}`, 1] as [string, number]);
    const forecast = await review({ used: 12, cap: 50, tier: "free" }, [["Island", 30], ...spells]);
    expect(forecast.textContent).toBe(
      "These 100 cards (71 different) use no saved-card slots. Each different card you customize uses 1 — you have 38 left. Get more slots",
    );
    expect(screen.getByText("100 cards")).toBeTruthy();
    expect((screen.getByRole("button", { name: /^add 100 cards$/i }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("one name on two boards is one card to customize; with room there is no link — and it never blocks", async () => {
    const forecast = await review({ used: 12, cap: 50, tier: "free" }, [["Lightning Bolt", 1], ["Mountain", 1], ["Lightning Bolt", 1]]);
    expect(forecast.textContent).toBe(
      "These 3 cards (2 different) use no saved-card slots. Each different card you customize uses 1 — you have 38 left.",
    );
    expect(within(forecast).queryByRole("link")).toBeNull();
    expect((screen.getByRole("button", { name: /^add 3 cards$/i }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("links to more slots when the list has more different cards than slots left — still never blocks", async () => {
    const forecast = await review({ used: 49, cap: 50, tier: "free" }, [["Sol Ring", 1], ["Arcane Signet", 1], ["Command Tower", 1]]);
    expect(forecast.textContent).toContain("These 3 cards use no saved-card slots. Each one you customize uses 1 — you have 1 left.");
    expect(within(forecast).getByRole("link", { name: "Get more slots" }).getAttribute("href")).toBe("/pricing");
    expect((screen.getByRole("button", { name: /^add 3 cards$/i }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("copies of a single card", async () => {
    const forecast = await review({ used: 12, cap: 50, tier: "free" }, [["Lightning Bolt", 4]]);
    expect(forecast.textContent).toBe("These 4 copies of one card use no saved-card slots. Customizing it uses 1 — you have 38 left.");
  });

  it("an unlimited plan hears only that importing uses no slots", async () => {
    const forecast = await review({ used: 900, cap: -1, tier: "pro" }, [["Sol Ring", 1]]);
    expect(forecast.textContent).toBe("This card uses no saved-card slots.");
  });

  it("without a capacity (signed out, an unreadable count) there is no line", async () => {
    window.history.replaceState(null, "", "/deck/me/burn");
    s.resolve.mockResolvedValue({ ok: true, title: null, parseWarnings: [], lines: lines([["Sol Ring", 1]]) });
    render(<ImportDecklistDialog deckId="d1" defaultOpen />);
    await act(async () => {
      fireEvent.change(screen.getByRole("textbox", { name: "Decklist text" }), { target: { value: "1 Sol Ring" } });
    });
    await click(screen.getByRole("button", { name: /preview import/i }));
    await screen.findByRole("button", { name: /^add 1 card$/i });
    expect(screen.queryByTestId("import-slot-forecast")).toBeNull();
  });
});
