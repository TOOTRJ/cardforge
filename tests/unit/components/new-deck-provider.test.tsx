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
//   * it remembers what opened it (the button itself — Safari doesn't focus
//     a clicked button) so the focus goes back there; after
//     /dashboard/decks/new's dismissal, My Decks' New deck button takes it;
//   * a dialog that fails to draw (its chunk won't load) never takes the page
//     with it: closed, then a fresh /dashboard/decks/new — or, there, a toast.
// The dialog itself is new-deck-dialog.test.tsx's.
// ---------------------------------------------------------------------------

const nav = vi.hoisted(() => ({
  pathname: "/decks",
  replace: vi.fn(),
  push: vi.fn(),
  failDialog: false,
  lastRequest: null as null | { returnFocusTo?: HTMLElement | null },
  toastError: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { error: nav.toastError } }));

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
      request: { key: number; format?: string; cardId?: string; returnFocusTo?: HTMLElement | null };
      onClosed: (reason: "dismiss" | "created") => void;
    }) {
      // A chunk that won't load throws where the lazy component renders.
      if (nav.failDialog) throw Object.assign(new Error("Loading chunk 812 failed."), { name: "ChunkLoadError" });
      nav.lastRequest = request;
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
import { NEW_DECK_FIRST_ADD, useFocusAddOnNewDeck } from "@/components/decks/use-focus-add-on-new-deck";
import { DeckStartDoors } from "@/components/decks/deck-start-doors";

beforeEach(() => {
  nav.pathname = "/decks";
  nav.replace.mockReset();
  nav.push.mockReset();
  nav.failDialog = false;
  nav.lastRequest = null;
  nav.toastError.mockReset();
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

describe("the focus comes back to what opened it", () => {
  it("NewDeckButton hands itself over as the opener (Safari never focuses a clicked button)", async () => {
    render(
      <NewDeckProvider>
        <NewDeckButton>New deck</NewDeckButton>
      </NewDeckProvider>,
    );
    const button = screen.getByRole("button", { name: "New deck" });
    // No focus on it: the click alone names it.
    expect(document.activeElement).not.toBe(button);
    await act(async () => fireEvent.click(button));
    expect(nav.lastRequest?.returnFocusTo).toBe(button);
  });

  it("openNewDeck without one takes what holds the focus — never <body>", async () => {
    function Opener() {
      const { openNewDeck } = useNewDeck();
      return (
        <button type="button" onClick={() => openNewDeck()}>
          Around this card
        </button>
      );
    }
    render(
      <NewDeckProvider>
        <Opener />
      </NewDeckProvider>,
    );
    const button = screen.getByRole("button", { name: "Around this card" });
    button.focus();
    await act(async () => fireEvent.click(button));
    expect(nav.lastRequest?.returnFocusTo).toBe(button);
  });

  it("/dashboard/decks/new's dismissal: My Decks' New deck button takes the focus on the page it opens", async () => {
    nav.pathname = "/dashboard/decks/new";
    const view = render(
      <NewDeckProvider>
        <OpenNewDeckOnMount />
      </NewDeckProvider>,
    );
    await act(async () => {});
    expect(nav.lastRequest?.returnFocusTo ?? null).toBeNull();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Dismiss" })));
    expect(nav.replace).toHaveBeenCalledWith("/dashboard/decks", { scroll: false });
    // The router swaps the page for My Decks.
    nav.pathname = "/dashboard/decks";
    await act(async () => {
      view.rerender(
        <NewDeckProvider>
          <NewDeckButton>New deck</NewDeckButton>
        </NewDeckProvider>,
      );
    });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "New deck" }));
  });

  it("…a one-shot: the next page's buttons don't take it", async () => {
    render(
      <NewDeckProvider>
        <NewDeckButton>New deck</NewDeckButton>
      </NewDeckProvider>,
    );
    expect(document.activeElement).not.toBe(screen.getByRole("button", { name: "New deck" }));
  });
});

describe("a dialog that fails to draw (a chunk that won't load)", () => {
  const consoleError = vi.spyOn(console, "error");
  beforeEach(() => consoleError.mockImplementation(() => {}));
  afterEach(() => consoleError.mockReset());

  it("closes, keeps the page, and opens a fresh /dashboard/decks/new with its format", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, pathname: "/decks/format/pauper", assign });
    nav.failDialog = true;
    render(
      <NewDeckProvider>
        <p>The page</p>
        <NewDeckButton format="pauper">Build a Pauper deck</NewDeckButton>
      </NewDeckProvider>,
    );
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Build a Pauper deck" })));
    expect(screen.getByText("The page")).toBeTruthy();
    expect(dialog()).toBeNull();
    expect(assign).toHaveBeenCalledWith("/dashboard/decks/new?format=pauper");
    expect(nav.toastError).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("on /dashboard/decks/new itself it says so instead (the same failure would only come back)", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, pathname: "/dashboard/decks/new", assign });
    nav.pathname = "/dashboard/decks/new";
    nav.failDialog = true;
    render(
      <NewDeckProvider>
        <p>My Decks</p>
        <OpenNewDeckOnMount />
      </NewDeckProvider>,
    );
    await act(async () => {});
    expect(screen.getByText("My Decks")).toBeTruthy();
    expect(assign).not.toHaveBeenCalled();
    expect(nav.toastError).toHaveBeenCalledWith("The New deck dialog didn't load. Reload the page and try again.");
    vi.unstubAllGlobals();

    // …and the next open, once it loads, works.
    nav.failDialog = false;
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
        <button ref={add.target} type="button" data-clearing={String(add.clearing)}>
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

  it("the empty deck's doors drawn: its “Paste a decklist” door takes the focus, not the owner bar", async () => {
    window.history.replaceState(null, "", "/deck/goblin-swarm?new=1");
    function OwnerWithDoors() {
      const add = useFocusAddOnNewDeck<HTMLButtonElement>(NEW_DECK_FIRST_ADD);
      return (
        <>
          <button ref={add.target} type="button">
            Import decklist
          </button>
          <DeckStartDoors commander={false} />
        </>
      );
    }
    await act(async () => {
      render(
        <StrictMode>
          <OwnerWithDoors />
        </StrictMode>,
      );
    });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /^Paste a decklist/ }));
    expect(nav.replace).toHaveBeenCalledTimes(1);
  });
});
