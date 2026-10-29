// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";

// ---------------------------------------------------------------------------
// The private-deck cap and the import's slot forecast, shown (TODO DK3.2,
// DK3.3, DK3.7; owner decisions D1 and D2):
//   * My Decks' meter reads "Private decks: N of M"; at the cap it offers
//     the three ways out — make a deck public, delete one, upgrade (the
//     modal's "deck_capacity" reason) — and it is null on an unlimited plan;
//   * the create flow warns before a private / unlisted deck the plan can't
//     hold, "Make it public" switches the choice, and a server refusal
//     opens the plans;
//   * the deck details form warns only for a deck that JOINS the count;
//   * the import's review says the list uses no slots, how many are left,
//     links to more when the list has more different cards than slots, and
//     never blocks the import;
//   * the upgrade modal's deck_capacity copy says the plans' numbers.
// ---------------------------------------------------------------------------

const s = vi.hoisted(() => ({
  open: vi.fn(),
  refresh: vi.fn(),
  push: vi.fn(),
  updateDeck: vi.fn(),
  createDeck: vi.fn(),
  resolve: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: s.refresh, push: s.push, replace: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode } & Record<string, unknown>) => (
    <a href={String(href)} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), message: vi.fn() } }));
vi.mock("@/components/billing/upgrade-modal-provider", () => ({ useUpgradeModal: () => ({ open: s.open }) }));
vi.mock("@/lib/decks/actions", () => ({
  updateDeckAction: s.updateDeck,
  createDeckAction: s.createDeck,
  deleteDeckAction: vi.fn(),
}));
vi.mock("@/lib/decks/import", () => ({ resolveDecklistAction: s.resolve, commitDeckImportAction: vi.fn() }));
vi.mock("@/lib/stripe/actions", () => ({ createCheckoutSessionAction: vi.fn(), createPortalSessionAction: vi.fn() }));
vi.mock("@/lib/routing/navigate", () => ({ navigateTo: vi.fn() }));
vi.mock("@/lib/analytics/funnel-client", () => ({ trackFunnelEvent: vi.fn() }));
vi.mock("@/lib/supabase/session-cookie", () => ({ hasSupabaseSessionCookie: () => true }));
vi.mock("@/lib/media/upload-cover", () => ({ uploadCoverImage: vi.fn() }));

import { DeckCapacityMeter } from "@/components/decks/deck-capacity";
import { DeckWizard } from "@/components/decks/deck-wizard";
import { DeckCreatorForm } from "@/components/decks/deck-creator-form";
import { ImportDecklistDialog } from "@/components/decks/import-decklist-dialog";
import { UpgradeModal } from "@/components/billing/upgrade-modal";
import { DECK_CAPACITY } from "@/lib/billing/plans";
import type { Deck } from "@/types/deck";

const click = async (element: Element) => {
  await act(async () => {
    fireEvent.click(element);
  });
};

beforeEach(() => {
  s.open.mockReset();
  s.refresh.mockReset();
  s.push.mockReset();
  s.updateDeck.mockReset().mockResolvedValue({ ok: true, deckId: "d1", slug: "d1" });
  s.createDeck.mockReset().mockResolvedValue({ ok: true, deckId: "d-new", slug: "new" });
  s.resolve.mockReset();
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ user: null }), { status: 200 })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("DeckCapacityMeter (My Decks)", () => {
  it("is the label and where the plan stands while there is room", () => {
    render(<DeckCapacityMeter capacity={{ used: 1, cap: 3, tier: "plus" }} cappedDecks={[]} />);
    const meter = screen.getByRole("region", { name: "Private decks" });
    expect(meter.textContent).toContain("Private decks: 1 of 3");
    expect(meter.textContent).toContain("2 left on Plus. Public decks are unlimited.");
    expect(within(meter).queryByRole("button")).toBeNull();
  });

  it("at the cap offers the three ways out: make public, delete, upgrade", async () => {
    render(
      <DeckCapacityMeter
        capacity={{ used: 1, cap: 1, tier: "free" }}
        cappedDecks={[{ id: "d1", title: "Merfolk Tempo", visibility: "private" }]}
      />,
    );
    const meter = screen.getByRole("region", { name: "Private decks" });
    expect(meter.textContent).toContain("Private decks: 1 of 1");
    expect(meter.textContent).toContain("make one of these public or delete it — or upgrade");
    const list = within(meter).getByRole("list", { name: "Your private and unlisted decks" });
    expect(list.textContent).toContain("Merfolk Tempo");
    expect(list.textContent).toContain("Private");
    expect(within(meter).getByRole("button", { name: "Delete Merfolk Tempo" })).toBeTruthy();

    await click(within(meter).getByRole("button", { name: "Make Merfolk Tempo public" }));
    expect(s.updateDeck).toHaveBeenCalledWith("d1", { visibility: "public" });
    expect(s.refresh).toHaveBeenCalled();

    await click(within(meter).getByRole("button", { name: "Upgrade for more private decks" }));
    expect(s.open).toHaveBeenCalledWith("deck_capacity");
  });

  it("over the cap (a lapsed plan) says how many to free and that nothing is locked", () => {
    render(
      <DeckCapacityMeter
        capacity={{ used: 3, cap: 1, tier: "free" }}
        cappedDecks={[
          { id: "a", title: "A", visibility: "private" },
          { id: "b", title: "B", visibility: "unlisted" },
          { id: "c", title: "C", visibility: "private" },
        ]}
      />,
    );
    const meter = screen.getByRole("region", { name: "Private decks" });
    expect(meter.textContent).toContain("2 over Free's 1 — they're safe and stay editable");
    expect(meter.textContent).toContain("make 3 of these public or delete them");
    expect(meter.textContent).toContain("Your decks are never locked.");
  });

  it("without the deck list the ways out are links (the account menu's compact use aside)", () => {
    render(<DeckCapacityMeter capacity={{ used: 1, cap: 1, tier: "free" }} />);
    expect(screen.getByRole("link", { name: "Manage your decks" }).getAttribute("href")).toBe("/dashboard/decks");
  });

  it("compact: the label, the plan and the bar only", () => {
    render(<DeckCapacityMeter capacity={{ used: 1, cap: 1, tier: "free" }} variant="compact" />);
    expect(document.body.textContent).toBe("Private decks: 1 of 1Free");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders nothing on an unlimited plan or without a capacity", () => {
    const { container } = render(
      <>
        <DeckCapacityMeter capacity={{ used: 12, cap: -1, tier: "pro" }} />
        <DeckCapacityMeter capacity={null} />
      </>,
    );
    expect(container.innerHTML).toBe("");
  });
});

describe("the create flow (DeckWizard)", () => {
  const atCap = { used: 1, cap: 1, tier: "free" as const };

  it("shows where the plan stands under Visibility, and warns once a capped choice can't be held", async () => {
    render(<DeckWizard userId="u1" deckCapacity={atCap} />);
    const select = screen.getByRole("combobox", { name: "Visibility" }) as HTMLSelectElement;
    expect(document.getElementById(select.getAttribute("aria-describedby") ?? "")?.textContent).toBe(
      "Private decks: 1 of 1 · All in use on Free. Public decks are unlimited.",
    );
    // Public (the default): nothing to warn about.
    expect(screen.queryByTestId("deck-capacity-notice")).toBeNull();

    await act(async () => {
      fireEvent.change(select, { target: { value: "unlisted" } });
    });
    const notice = screen.getByTestId("deck-capacity-notice");
    expect(notice.getAttribute("role")).toBe("status");
    expect(notice.textContent).toContain("Free includes 1 private or unlisted deck, and yours is in use.");
    expect(within(notice).getByRole("link", { name: "Manage decks" }).getAttribute("href")).toBe("/dashboard/decks");
    await click(within(notice).getByRole("button", { name: "Upgrade" }));
    expect(s.open).toHaveBeenCalledWith("deck_capacity");

    await click(within(notice).getByRole("button", { name: "Make it public" }));
    expect(select.value).toBe("public");
    expect(screen.queryByTestId("deck-capacity-notice")).toBeNull();
  });

  it("a server refusal opens the plans with the deck_capacity reason", async () => {
    s.createDeck.mockResolvedValue({
      ok: false,
      code: "UPGRADE_REQUIRED",
      reason: "deck_capacity",
      formError: "Free includes 1 private or unlisted deck, and yours is in use.",
    });
    render(<DeckWizard userId="u1" deckCapacity={{ used: 0, cap: 1, tier: "free" }} />);
    await act(async () => {
      fireEvent.change(screen.getByRole("textbox", { name: "Deck name" }), { target: { value: "Gorgon Gaze" } });
      fireEvent.change(screen.getByRole("combobox", { name: "Visibility" }), { target: { value: "private" } });
    });
    // The last slot: a warning, not a block.
    expect(screen.getByTestId("deck-capacity-notice").textContent).toContain("This uses your last private deck on Free (1 of 1).");
    for (let i = 0; i < 3; i += 1) await click(screen.getByRole("button", { name: /^next$/i }));
    await click(screen.getByRole("button", { name: /create deck/i }));
    expect(s.createDeck).toHaveBeenCalledWith(expect.objectContaining({ visibility: "private" }), {
      redirectAfterCreate: false,
      surface: "wizard",
    });
    expect(s.open).toHaveBeenCalledWith("deck_capacity");
    expect(s.push).not.toHaveBeenCalled();
  });

  it("an unlimited plan shows no meter and no warning", async () => {
    render(<DeckWizard userId="u1" deckCapacity={{ used: 9, cap: -1, tier: "pro" }} />);
    const select = screen.getByRole("combobox", { name: "Visibility" });
    expect(select.getAttribute("aria-describedby")).toBeNull();
    await act(async () => {
      fireEvent.change(select, { target: { value: "private" } });
    });
    expect(screen.queryByTestId("deck-capacity-notice")).toBeNull();
  });
});

describe("the deck details form (a visibility change)", () => {
  const deck = (visibility: Deck["visibility"]): Deck =>
    ({
      id: "d1",
      owner_id: "u1",
      title: "Burn",
      slug: "burn",
      description: null,
      cover_url: null,
      cover_position: null,
      format: "modern",
      visibility,
    }) as unknown as Deck;
  const atCap = { used: 1, cap: 1, tier: "free" as const };

  it("warns when a PUBLIC deck is turned private at the cap; Make it public puts the choice back", async () => {
    render(<DeckCreatorForm mode="edit" userId="u1" deck={deck("public")} deckCapacity={atCap} embedded />);
    expect(screen.queryByTestId("deck-capacity-notice")).toBeNull();
    await click(screen.getByRole("button", { name: /^Private/ }));
    expect(screen.getByTestId("deck-capacity-notice").textContent).toContain("yours is in use");
    await click(screen.getByRole("button", { name: "Make it public" }));
    expect(screen.queryByTestId("deck-capacity-notice")).toBeNull();
    expect(screen.getByRole("button", { name: /^Public/ }).getAttribute("aria-pressed")).toBe("true");
  });

  it("a deck that is private already holds its slot: no warning, private ↔ unlisted", async () => {
    render(<DeckCreatorForm mode="edit" userId="u1" deck={deck("private")} deckCapacity={{ used: 3, cap: 1, tier: "free" }} embedded />);
    await click(screen.getByRole("button", { name: /^Unlisted/ }));
    expect(screen.queryByTestId("deck-capacity-notice")).toBeNull();
  });

  it("a refused save opens the plans", async () => {
    s.updateDeck.mockResolvedValue({ ok: false, code: "UPGRADE_REQUIRED", reason: "deck_capacity", formError: "In use." });
    render(<DeckCreatorForm mode="edit" userId="u1" deck={deck("public")} deckCapacity={atCap} embedded />);
    await click(screen.getByRole("button", { name: /^Private/ }));
    await click(screen.getByRole("button", { name: /save changes/i }));
    expect(s.updateDeck).toHaveBeenCalledWith("d1", expect.objectContaining({ visibility: "private" }));
    expect(s.open).toHaveBeenCalledWith("deck_capacity");
    expect(screen.getByRole("alert").textContent).toBe("In use.");
  });
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

describe("the upgrade modal's deck_capacity reason", () => {
  it("says public decks are unlimited and every plan's private decks, from DECK_CAPACITY", () => {
    render(<UpgradeModal open reason="deck_capacity" onOpenChange={() => {}} />);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Your private decks are full")).toBeTruthy();
    expect(dialog.textContent).toContain(
      `Public decks are unlimited on every plan. Free includes ${DECK_CAPACITY.free} private or unlisted deck, Plus ${DECK_CAPACITY.plus}, and Pro as many as you like.`,
    );
    expect(dialog.textContent).toContain("Every deck you have stays exactly as it is.");
  });
});
