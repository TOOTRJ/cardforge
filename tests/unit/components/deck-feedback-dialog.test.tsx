// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

// ---------------------------------------------------------------------------
// The deck feedback dialog (TODO DK10.1) and the beta banner that opens it
// (DK10.2):
//  - a Radix dialog: focus inside on open, Escape closes, the focus goes
//    back to the button that opened it;
//  - Idea / Bug / Other is ONE radiogroup (one tab stop, arrows move the
//    focus, Space picks — the ChipGroup rule);
//  - it SAYS what it attaches ("We'll include: …") and sends exactly that:
//    the deck, the page's path (no query string) and the window size;
//  - signed out, it asks the visitor to sign in (/feedback's rule);
//  - the banner hides for this viewer (localStorage, in try/catch) and
//    hands the focus on; past its end date it never draws.
// ---------------------------------------------------------------------------

vi.mock("next/navigation", () => ({ usePathname: () => "/deck/ness" }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
const actions = vi.hoisted(() => ({
  submitDeckFeedbackAction: vi.fn(),
  submitFeedbackAction: vi.fn(),
  setFeedbackStatusAction: vi.fn(),
}));
vi.mock("@/lib/feedback/actions", () => actions);

import { DeckFeedbackButton, DeckFeedbackFooter } from "@/components/feedback/deck-feedback-dialog";
import { DeckBetaBanner } from "@/components/decks/deck-beta-banner";
import {
  DECK_BETA_BANNER_ENDS_AT,
  DECK_BETA_BANNER_STORAGE_KEY,
} from "@/lib/decks/beta-banner";

const DECK = "b0000000-0000-4000-a000-000000000001";
const storage = new Map<string, string>();

beforeEach(() => {
  window.history.replaceState(null, "", "/deck/ness?ref=someone@example.com#top");
  storage.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, value),
  });
  actions.submitDeckFeedbackAction.mockResolvedValue({ ok: true });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const fn of Object.values(actions)) fn.mockReset();
});

async function click(el: Element) {
  await act(async () => {
    fireEvent.click(el);
  });
}

async function openDialog(ui = <DeckFeedbackButton deckId={DECK} signedIn />) {
  render(ui);
  const trigger = screen.getByRole("button", { name: "Feedback" });
  trigger.focus();
  await click(trigger);
  return { trigger, dialog: screen.getByRole("dialog", { name: "Feedback on decks" }) };
}

describe("the deck feedback dialog", () => {
  it("opens with the focus inside; Escape closes it and the focus goes back to its button", async () => {
    const { trigger, dialog } = await openDialog();
    expect(dialog.contains(document.activeElement)).toBe(true);
    await act(async () => {
      fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("says what it attaches — the deck only where there is one", async () => {
    await openDialog();
    expect(screen.getByText("We’ll include: this deck, the page address and your screen size.")).toBeTruthy();
    cleanup();
    await openDialog(<DeckFeedbackButton signedIn />);
    expect(screen.getByText("We’ll include: the page address and your screen size.")).toBeTruthy();
    expect(screen.queryByText(/this deck/)).toBeNull();
  });

  it("describes Send with that line", async () => {
    await openDialog();
    const send = screen.getByRole("button", { name: "Send feedback" });
    const describedBy = send.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)?.textContent).toMatch(/^We’ll include: this deck/);
  });

  it("Idea / Bug / Other is one radiogroup: one tab stop, arrows move the focus, Space picks", async () => {
    await openDialog();
    const group = screen.getByRole("radiogroup", { name: "What kind of feedback?" });
    const radios = screen.getAllByRole("radio");
    expect(radios.map((r) => r.textContent)).toEqual(["Idea", "Bug", "Other"]);
    expect(radios.map((r) => r.getAttribute("aria-checked"))).toEqual(["true", "false", "false"]);
    expect(radios.filter((r) => r.tabIndex === 0)).toHaveLength(1);
    // The kind's hint describes the row.
    expect(document.getElementById(group.getAttribute("aria-describedby")!)?.textContent).toMatch(/deck builder should do/);

    radios[0].focus();
    await act(async () => {
      fireEvent.keyDown(radios[0], { key: "ArrowRight" });
    });
    expect(document.activeElement).toBe(radios[1]);
    expect(radios[1].getAttribute("aria-checked")).toBe("false");
    await click(radios[1]);
    expect(screen.getAllByRole("radio")[1].getAttribute("aria-checked")).toBe("true");
  });

  it("sends the kind, the message, the deck, the PATH alone and the window size", async () => {
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(390);
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(844);
    await openDialog();
    await click(screen.getAllByRole("radio")[1]);
    const message = screen.getByRole("textbox", { name: "Message" });
    await act(async () => {
      fireEvent.change(message, { target: { value: "The steppers jump" } });
    });
    await click(screen.getByRole("button", { name: "Send feedback" }));
    expect(actions.submitDeckFeedbackAction).toHaveBeenCalledWith({
      kind: "bug",
      message: "The steppers jump",
      deck_id: DECK,
      page_url: "/deck/ness",
      viewport: "390x844",
    });
    // Thanks, with the focus on Done (Send is gone with the form).
    const done = await screen.findByRole("button", { name: "Done" });
    await waitFor(() => expect(document.activeElement).toBe(done));
    expect(document.getElementById(done.getAttribute("aria-describedby")!)?.textContent).toMatch(/Thank you/);
  });

  it("can't send an empty message", async () => {
    await openDialog();
    expect((screen.getByRole("button", { name: "Send feedback" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("a refusal from the server is the form's one alert, and the draft stays", async () => {
    actions.submitDeckFeedbackAction.mockResolvedValue({ ok: false, error: "Try again in a little while." });
    await openDialog();
    const message = screen.getByRole("textbox", { name: "Message" });
    await act(async () => {
      fireEvent.change(message, { target: { value: "Hello" } });
    });
    await click(screen.getByRole("button", { name: "Send feedback" }));
    expect(screen.getByRole("alert").textContent).toBe("Try again in a little while.");
    expect((screen.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement).value).toBe("Hello");
  });

  it("signed out, it asks for a sign-in that comes back to the page", async () => {
    await openDialog(<DeckFeedbackButton deckId={DECK} signedIn={false} />);
    expect(screen.queryByRole("textbox")).toBeNull();
    const signIn = screen.getByRole("link", { name: "Sign in" });
    expect(signIn.getAttribute("href")).toBe("/login?redirectTo=%2Fdeck%2Fness");
  });

  it("the deck footer opens the same dialog", async () => {
    render(<DeckFeedbackFooter deckId={DECK} signedIn />);
    expect(screen.getByRole("complementary", { name: "Deck builder feedback" })).toBeTruthy();
    await click(screen.getByRole("button", { name: "Send feedback" }));
    expect(screen.getByRole("dialog", { name: "Feedback on decks" })).toBeTruthy();
  });
});

describe("the deck builder beta banner (DK10.2)", () => {
  it("says what it is and opens the feedback dialog", async () => {
    render(<DeckBetaBanner deckId={DECK} signedIn />);
    const banner = screen.getByRole("region", { name: "Deck builder beta" });
    expect(banner.textContent).toContain("New deck builder: tell us what’s missing.");
    await click(screen.getByRole("button", { name: "Send feedback" }));
    expect(screen.getByRole("dialog", { name: "Feedback on decks" })).toBeTruthy();
    expect(screen.getByText(/this deck, the page address/)).toBeTruthy();
  });

  it("dismissing hides it for this viewer and hands the focus on", async () => {
    render(<DeckBetaBanner signedIn />);
    await click(screen.getByRole("button", { name: "Dismiss the deck builder banner" }));
    expect(screen.queryByRole("region", { name: "Deck builder beta" })).toBeNull();
    expect(storage.get(DECK_BETA_BANNER_STORAGE_KEY)).toBe(DECK_BETA_BANNER_ENDS_AT);
    await waitFor(() => expect(document.activeElement?.textContent).toBe("Banner dismissed."));
    cleanup();
    render(<DeckBetaBanner signedIn />);
    expect(screen.queryByRole("region", { name: "Deck builder beta" })).toBeNull();
  });

  it("comes back when the end date moves (a dismissal remembers the date it dismissed)", () => {
    storage.set(DECK_BETA_BANNER_STORAGE_KEY, "2026-01-01T00:00:00Z");
    render(<DeckBetaBanner signedIn />);
    expect(screen.getByRole("region", { name: "Deck builder beta" })).toBeTruthy();
  });

  it("renders, and dismisses, with storage blocked", async () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    });
    render(<DeckBetaBanner signedIn />);
    expect(screen.getByRole("region", { name: "Deck builder beta" })).toBeTruthy();
    await click(screen.getByRole("button", { name: "Dismiss the deck builder banner" }));
    expect(screen.queryByRole("region", { name: "Deck builder beta" })).toBeNull();
  });

  it("never draws after its end date", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.parse(DECK_BETA_BANNER_ENDS_AT) + 1000));
    const { container } = render(<DeckBetaBanner signedIn />);
    expect(container.textContent).toBe("");
  });
});
