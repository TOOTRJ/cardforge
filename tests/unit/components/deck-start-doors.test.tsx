// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";

// ---------------------------------------------------------------------------
// An empty deck's doors and the commander slot (TODO DK4.4): each opens a
// flow the page already has, says what it really does, and hands the focus
// back to the control that opened it on close (DK5.12; the dialogs have no
// trigger of their own). "Search and add" and the slot's "Search for your
// commander" open the add box (TODO DK5.2 — it replaced #671's "Add from my
// cards" picker; the box's own tests: deck-add-box.test.tsx); the slot's
// "Type the commander's name" starts the import's text under "Commander".
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={String(href)} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("next/image", () => ({ default: ({ alt }: { alt: string }) => <span aria-label={alt} /> }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/components/decks/deck-creator-form", () => ({ DeckCreatorForm: () => null }));
vi.mock("@/components/decks/delete-deck-dialog", () => ({ DeleteDeckDialog: () => <button type="button">Delete deck</button> }));
vi.mock("@/lib/decks/import", () => ({ resolveDecklistAction: vi.fn(), commitDeckImportAction: vi.fn() }));

import { DeckOwnerTools } from "@/components/decks/deck-owner-tools";
import { CommanderSlot, DeckStartDoors } from "@/components/decks/deck-start-doors";
import type { Deck } from "@/types/deck";

afterEach(cleanup);

const page = (commander: boolean) =>
  render(
    <>
      <DeckOwnerTools deck={{ id: "deck-1", title: "Ness" } as Deck} userId="user-1" />
      <h2 id="deck-cards-title" tabIndex={-1}>
        Cards
      </h2>
      <DeckStartDoors commander={commander} />
    </>,
  );

const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 10)));

describe("the empty deck's doors", () => {
  it("three doors, worded for what they do; a deck with a commander zone gets the slot first", () => {
    page(false);
    expect(screen.queryByRole("region", { name: "Choose your commander" })).toBeNull();
    for (const name of [/^Search and add/, /^Paste a decklist/, /^Add cards by name/]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
    // #671's picker is gone: the add box is the one way to add a card of yours.
    expect(screen.queryByRole("button", { name: /add from my cards/i })).toBeNull();
    cleanup();
    page(true);
    const slot = screen.getByRole("region", { name: "Choose your commander" });
    expect(within(slot).getByRole("button", { name: "Search for your commander" })).toBeTruthy();
    expect(within(slot).getByRole("button", { name: "Type the commander’s name" })).toBeTruthy();
  });

  it("“Add cards by name” opens the import in its own words; closing it hands the focus back to the door", async () => {
    page(false);
    const door = screen.getByRole("button", { name: /^Add cards by name/ });
    door.focus();
    await act(async () => {
      fireEvent.click(door);
    });
    const dialog = screen.getByRole("dialog", { name: "Add cards by name" });
    expect(within(dialog).getByRole("textbox", { name: "Decklist text" }).getAttribute("placeholder")).toContain("1 Sol Ring");
    await act(async () => {
      fireEvent.keyDown(dialog, { key: "Escape" });
    });
    await settle();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(door);
  });

  it("the commander slot's “Type the commander’s name” starts the text under Commander", async () => {
    page(true);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Type the commander’s name" }));
    });
    const dialog = screen.getByRole("dialog", { name: "Choose your commander" });
    expect((within(dialog).getByRole("textbox", { name: "Decklist text" }) as HTMLTextAreaElement).value).toBe("Commander\n1 ");
  });

  it("“Search and add” and “Search for your commander” open the add box — the commander's with the Commander board", () => {
    const tools: Array<{ tool: string; opener: HTMLElement | null }> = [];
    const listen = (event: Event) => tools.push((event as CustomEvent<{ tool: string; opener: HTMLElement | null }>).detail);
    window.addEventListener("pipglyph:deck-tool", listen);
    page(true);
    const door = screen.getByRole("button", { name: /^Search and add/ });
    fireEvent.click(door);
    fireEvent.click(screen.getByRole("button", { name: "Search for your commander" }));
    window.removeEventListener("pipglyph:deck-tool", listen);
    expect(tools.map((t) => t.tool)).toEqual(["add", "add-commander"]);
    expect(tools[0]!.opener).toBe(door);
    // The import dialog stays shut: the add box is not one of its tools.
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("the compact slot over a deck with cards and no commander says so", () => {
    render(<CommanderSlot compact />);
    expect(screen.getByRole("region", { name: "No commander yet" })).toBeTruthy();
  });
});
