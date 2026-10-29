// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { chipOff } from "../helpers/chip";

// ---------------------------------------------------------------------------
// AI deck building is paused (owner 2026-10-28, TODO DK1.1 / DK1.2,
// lib/ai/deck-ai-pause.ts). Every deck AI control is the ONE "Coming soon"
// pattern (components/decks/deck-ai-coming-soon.tsx): aria-disabled — never
// `disabled` — and INERT (chipOff throws on a greyed control that still has
// a click handler), a SHORT name ("Add with AI — coming soon") and, as its
// description, the ONE visible line that says why. And the owner's decisions
// on the deck page:
//   D4 — guides that exist stay readable to the same viewers; no new guide
//        and no refresh; the non-Pro teaser only on a deck that HAS one;
//   D6 — the Regenerate bar re-runs failed steps for NEW credits: greyed.
// The New deck dialog (TODO DK4.1, which replaced the wizard) has no AI path
// at all: one quiet line says AI deck building is coming back.
// ---------------------------------------------------------------------------

const s = vi.hoisted(() => ({ push: vi.fn(), createDeck: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: s.push, refresh: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={String(href)} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), message: vi.fn() } }));
vi.mock("@/components/billing/upgrade-modal-provider", () => ({ useUpgradeModal: () => ({ open: vi.fn() }) }));
vi.mock("@/lib/decks/actions", () => ({ createDeckAction: s.createDeck }));
vi.mock("@/components/decks/deck-creator-form", () => ({
  CoverField: () => null,
  DeckCreatorForm: () => null,
}));
vi.mock("@/components/decks/import-decklist-dialog", () => ({
  ImportDecklistDialog: () => <button type="button">Import decklist</button>,
  ImportSlotForecast: () => null,
}));
vi.mock("@/lib/decks/import", () => ({ resolveDecklistAction: vi.fn(), commitDeckImportAction: vi.fn() }));
vi.mock("@/lib/supabase/session-cookie", () => ({ hasSupabaseSessionCookie: () => true }));
vi.mock("@/components/decks/delete-deck-dialog", () => ({
  DeleteDeckDialog: () => <button type="button">Delete deck</button>,
}));

import { DeckAiComingSoonButton, DeckAiPausedNote } from "@/components/decks/deck-ai-coming-soon";
import { DeckGuideSection } from "@/components/decks/deck-guide-section";
import { DeckRegenerateBar } from "@/components/decks/deck-regenerate-bar";
import { DeckOwnerTools } from "@/components/decks/deck-owner-tools";
import { NewDeckDialog } from "@/components/decks/new-deck-dialog";
import { DECK_AI_PAUSED_MESSAGE } from "@/lib/ai/deck-ai-pause";
import type { DeckGuide } from "@/lib/decks/guides";
import type { Deck } from "@/types/deck";

const GUIDE: DeckGuide = {
  deck_id: "deck-1",
  overview: "Swarm the board, then sacrifice for value.",
  game_plan: ["Play two-drops.", "Swing."],
  mulligan: "Keep two lands.",
  combos: [],
  weaknesses: "Sweepers.",
  key_cards: ["Goblin Bombardment"],
  source: "generation",
  generated_at: "2026-10-01T00:00:00.000Z",
};

/** A greyed deck AI control: aria-disabled, inert, a short name, and the
 *  one VISIBLE reason line as its description. Returns that line. */
function expectComingSoon(name: string, role: "button" | "radio" = "button"): HTMLElement {
  const control = screen.getByRole(role, { name });
  expect(control.getAttribute("aria-disabled")).toBe("true");
  expect(control.hasAttribute("disabled")).toBe(false);
  expect(chipOff(control)).toBe(true);
  expect(control.textContent).toMatch(/Coming soon/);
  const noteId = control.getAttribute("aria-describedby");
  const note = noteId ? document.getElementById(noteId) : null;
  expect(note, `${name} is described by a line`).not.toBeNull();
  expect(note!.textContent).toBe(DECK_AI_PAUSED_MESSAGE);
  expect(note!.className).not.toMatch(/sr-only/);
  return note!;
}

const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ ok: true, batch: null }), { status: 200 }));

beforeEach(() => {
  vi.stubGlobal("fetch", fetchSpy);
  fetchSpy.mockClear();
  s.push.mockReset();
  s.createDeck.mockReset().mockResolvedValue({ ok: true, slug: "gorgon-gaze", deckId: "deck-1" });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the Coming soon button", () => {
  it("is aria-disabled (never disabled), inert, named short and described by the visible line", () => {
    render(
      <>
        <DeckAiComingSoonButton label="Add with AI" describedBy="why" />
        <DeckAiPausedNote id="why" />
      </>,
    );
    expectComingSoon("Add with AI — coming soon");
  });
});

describe("the deck page's owner tools", () => {
  it("Add with AI and Restyle with AI are Coming soon beside ONE visible reason; edit, import and delete are untouched", () => {
    render(
      <DeckOwnerTools
        deck={{ id: "deck-1", title: "Gorgon Gaze" } as Deck}
        userId="user-1"
        aiConfigured
        maxCards={100}
        capacity={null}
        remixableCount={12}
        aiSeed={{ theme: "gorgons", style: "ink" }}
      />,
    );
    const add = expectComingSoon("Add with AI — coming soon");
    const remix = expectComingSoon("Restyle with AI — coming soon");
    expect(add).toBe(remix);
    expect(screen.getAllByText(DECK_AI_PAUSED_MESSAGE)).toHaveLength(1);
    for (const name of [/edit details/i, /import decklist/i, /delete deck/i]) {
      expect(screen.getByRole("button", { name }).getAttribute("aria-disabled")).toBeNull();
    }
    // Nothing opens: no AI dialog exists any more.
    fireEvent.click(screen.getByRole("button", { name: "Add with AI — coming soon" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("the deck guide section (D4)", () => {
  const section = (props: Partial<Parameters<typeof DeckGuideSection>[0]>) =>
    render(
      <DeckGuideSection
        deckId="deck-1"
        guide={null}
        isOwner={false}
        viewerIsPro={false}
        aiConfigured
        hasCards
        {...props}
      />,
    );

  it("a non-Pro viewer sees the teaser ONLY on a deck that has a guide", () => {
    const { container } = section({ guide: null });
    expect(container.textContent).toBe("");
    cleanup();
    section({ guide: GUIDE });
    expect(screen.getByText(/deck guides are a pro feature/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /upgrade to pro/i })).toBeTruthy();
    expect(screen.queryByText(GUIDE.overview)).toBeNull();
  });

  it("an existing guide stays readable to a Pro viewer, owner or not", () => {
    section({ guide: GUIDE, viewerIsPro: true });
    expect(screen.getByText(GUIDE.overview)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByText(DECK_AI_PAUSED_MESSAGE)).toBeNull();
    cleanup();
    section({ guide: GUIDE, viewerIsPro: true, isOwner: true });
    expect(screen.getByText(GUIDE.overview)).toBeTruthy();
    expectComingSoon("Refresh analysis — coming soon");
  });

  it("no guide: the Pro owner sees Analyze greyed with the reason; anyone else sees nothing", () => {
    section({ viewerIsPro: true, isOwner: true });
    expectComingSoon("Analyze this deck — coming soon");
    expect(screen.getByRole("button", { name: "Analyze this deck — coming soon" }).textContent).not.toMatch(/credit/i);
    cleanup();
    const { container } = section({ viewerIsPro: true, isOwner: false });
    expect(container.textContent).toBe("");
    cleanup();
    // An empty deck had no analyze button before the pause either.
    const empty = section({ viewerIsPro: true, isOwner: true, hasCards: false });
    expect(empty.container.textContent).toBe("");
  });
});

describe("the Regenerate bar (D6: a regenerate reserves new credits)", () => {
  it("still says what didn't generate and why, and Regenerate is Coming soon", () => {
    render(<DeckRegenerateBar jobId="job-1" failedCount={2} failedLabels={["Goblin Grin", "Ember Imp"]} />);
    expect(screen.getByText(/2 cards didn't generate/)).toBeTruthy();
    expectComingSoon("Regenerate them — coming soon");
  });
});

describe("the New deck dialog", () => {
  const signedIn = () =>
    fetchSpy.mockImplementation(
      async () => new Response(JSON.stringify({ user: { id: "user-1" }, cardCapacity: null }), { status: 200 }),
    );

  it("has no AI path — one quiet line says it's coming back, and no AI control or request", async () => {
    signedIn();
    render(<NewDeckDialog open request={{ key: 1 }} onClosed={vi.fn()} />);
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledWith("/api/me", expect.anything()));
    const dialog = screen.getByRole("dialog", { name: "New deck" });
    expect(dialog.textContent).toContain(DECK_AI_PAUSED_MESSAGE);
    expect(screen.getAllByText(DECK_AI_PAUSED_MESSAGE)).toHaveLength(1);
    // A line, not a control: nothing greyed, nothing to press.
    expect(screen.queryByRole("button", { name: /\bai\b/i })).toBeNull();
    expect(screen.queryByRole("radio", { name: /\bai\b/i })).toBeNull();
    expect(screen.queryByText(/coming soon$/i)).toBeNull();
    // The only request is the dialog's own: no AI ideas, no estimate.
    expect(fetchSpy.mock.calls.map((call) => String((call as unknown[])[0]))).toEqual(["/api/me"]);
  });

  it("creates the deck with no AI fields and opens it, its add control focused (?new=1)", async () => {
    signedIn();
    render(<NewDeckDialog open request={{ key: 1 }} onClosed={vi.fn()} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Deck name" }), { target: { value: "Gorgon Gaze" } });
    fireEvent.click(screen.getByRole("button", { name: /^create deck$/i }));
    await vi.waitFor(() => expect(s.push).toHaveBeenCalledWith("/deck/gorgon-gaze?new=1"));
    const [payload] = s.createDeck.mock.calls[0] as [Record<string, unknown>];
    expect(payload).toEqual({ title: "Gorgon Gaze", format: "commander", visibility: "public" });
  });

  it("preselects the format a format hub links with", () => {
    render(<NewDeckDialog open request={{ key: 1, format: "standard" }} onClosed={vi.fn()} />);
    expect(screen.getByRole("radio", { name: "Standard" }).getAttribute("aria-checked")).toBe("true");
  });
});
