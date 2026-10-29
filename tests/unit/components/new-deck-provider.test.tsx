// @vitest-environment happy-dom
import { StrictMode, useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

// ---------------------------------------------------------------------------
// How the New deck dialog is opened (TODO DK4.2) and what an empty new deck
// does on arrival (DK4.1):
//   * NewDeckButton is a BUTTON that opens the dialog (aria-haspopup), with
//     the format it was given; every open is a fresh form (a new key);
//   * /dashboard/decks/new opens it ONCE (StrictMode runs effects twice), and
//     only a dismissal goes back to /dashboard/decks — a create or a page
//     change never does;
//   * the page changing under the dialog closes it (a link inside it);
//   * `/deck/<slug>?new=1` focuses the control the hook's ref is on and drops
//     the flag with ONE router.replace, under StrictMode too; no flag, no
//     focus and no navigation.
// The dialog itself is new-deck-dialog.test.tsx's.
// ---------------------------------------------------------------------------

const nav = vi.hoisted(() => ({ pathname: "/decks", replace: vi.fn(), push: vi.fn() }));

vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ replace: nav.replace, push: nav.push, refresh: vi.fn() }),
}));
// The dialog's code loads on first use; here a stand-in says what it was
// asked and closes the way the real one does.
vi.mock("next/dynamic", () => ({
  default: () =>
    function StubNewDeckDialog({
      open,
      request,
      onClosed,
    }: {
      open: boolean;
      request: { key: number; format?: string; cardId?: string };
      onClosed: (reason: "dismiss" | "created") => void;
    }) {
      if (!open) return null;
      return (
        <div role="dialog" aria-label="New deck" data-key={request.key} data-format={request.format ?? ""} data-card={request.cardId ?? ""}>
          <button type="button" onClick={() => onClosed("dismiss")}>
            Dismiss
          </button>
          <button type="button" onClick={() => onClosed("created")}>
            Created
          </button>
        </div>
      );
    },
}));

import { NewDeckButton, NewDeckProvider, OpenNewDeckOnMount, useNewDeck } from "@/components/decks/new-deck-provider";
import { useFocusAddOnNewDeck } from "@/components/decks/use-focus-add-on-new-deck";

beforeEach(() => {
  nav.pathname = "/decks";
  nav.replace.mockReset();
  nav.push.mockReset();
});
afterEach(cleanup);

const dialog = () => screen.queryByRole("dialog", { name: "New deck" });

describe("NewDeckButton", () => {
  it("is a button that opens the dialog with its format; each open is a fresh form", async () => {
    render(
      <NewDeckProvider>
        <NewDeckButton format="pauper">Build a Pauper deck</NewDeckButton>
      </NewDeckProvider>,
    );
    const button = screen.getByRole("button", { name: "Build a Pauper deck" });
    expect(button.getAttribute("aria-haspopup")).toBe("dialog");
    expect(dialog()).toBeNull();
    await act(async () => fireEvent.click(button));
    expect(dialog()?.getAttribute("data-format")).toBe("pauper");
    expect(dialog()?.getAttribute("data-key")).toBe("1");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Dismiss" })));
    expect(dialog()).toBeNull();
    await act(async () => fireEvent.click(button));
    expect(dialog()?.getAttribute("data-key")).toBe("2");
  });

  it("openNewDeck carries a card for the deck to start with (DK8.3 / DK9.3)", async () => {
    function AroundThisCard() {
      const { openNewDeck } = useNewDeck();
      return (
        <button type="button" onClick={() => openNewDeck({ format: "commander", cardId: "card-1" })}>
          Build a deck around this card
        </button>
      );
    }
    render(
      <NewDeckProvider>
        <AroundThisCard />
      </NewDeckProvider>,
    );
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Build a deck around this card" })));
    expect(dialog()?.getAttribute("data-card")).toBe("card-1");
    expect(dialog()?.getAttribute("data-format")).toBe("commander");
  });

  it("outside the provider it does nothing (never a crash)", () => {
    render(<NewDeckButton>New deck</NewDeckButton>);
    expect(() => fireEvent.click(screen.getByRole("button", { name: "New deck" }))).not.toThrow();
  });
});

describe("/dashboard/decks/new (OpenNewDeckOnMount)", () => {
  const page = (format?: "standard") => (
    <StrictMode>
      <NewDeckProvider>
        <OpenNewDeckOnMount format={format} />
      </NewDeckProvider>
    </StrictMode>
  );

  it("opens the dialog once, with the page's format", async () => {
    nav.pathname = "/dashboard/decks/new";
    await act(async () => {
      render(page("standard"));
    });
    expect(dialog()?.getAttribute("data-key")).toBe("1");
    expect(dialog()?.getAttribute("data-format")).toBe("standard");
  });

  it("a dismissal goes back to /dashboard/decks; a create does not", async () => {
    nav.pathname = "/dashboard/decks/new";
    await act(async () => {
      render(page());
    });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Created" })));
    expect(dialog()).toBeNull();
    expect(nav.replace).not.toHaveBeenCalled();
    cleanup();

    await act(async () => {
      render(page());
    });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Dismiss" })));
    expect(dialog()).toBeNull();
    expect(nav.replace).toHaveBeenCalledTimes(1);
    expect(nav.replace).toHaveBeenCalledWith("/dashboard/decks", { scroll: false });
  });
});

describe("the page changing under the dialog", () => {
  it("closes it, and is no dismissal", async () => {
    nav.pathname = "/dashboard/decks/new";
    const view = render(
      <NewDeckProvider>
        <OpenNewDeckOnMount />
      </NewDeckProvider>,
    );
    await act(async () => {});
    expect(dialog()).not.toBeNull();
    // A link inside the dialog (Manage decks, Get more slots) navigated.
    nav.pathname = "/pricing";
    await act(async () => {
      view.rerender(
        <NewDeckProvider>
          <OpenNewDeckOnMount />
        </NewDeckProvider>,
      );
    });
    expect(dialog()).toBeNull();
    expect(nav.replace).not.toHaveBeenCalled();
  });
});

describe("an empty new deck's page (?new=1)", () => {
  function Owner() {
    const add = useFocusAddOnNewDeck<HTMLButtonElement>();
    const other = useRef<HTMLButtonElement>(null);
    return (
      <>
        <button ref={other} type="button">
          Edit details
        </button>
        <button ref={add} type="button">
          Import decklist
        </button>
      </>
    );
  }

  it("focuses the add control and drops the flag with ONE replace", async () => {
    window.history.replaceState(null, "", "/deck/goblin-swarm?new=1#cards");
    await act(async () => {
      render(
        <StrictMode>
          <Owner />
        </StrictMode>,
      );
    });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Import decklist" }));
    expect(nav.replace).toHaveBeenCalledTimes(1);
    expect(nav.replace).toHaveBeenCalledWith("/deck/goblin-swarm#cards", { scroll: false });
  });

  it("without the flag: no focus, no navigation", async () => {
    window.history.replaceState(null, "", "/deck/goblin-swarm?import=1");
    await act(async () => {
      render(<Owner />);
    });
    expect(document.activeElement).toBe(document.body);
    expect(nav.replace).not.toHaveBeenCalled();
  });
});
