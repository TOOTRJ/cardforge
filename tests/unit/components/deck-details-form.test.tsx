// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Deck } from "@/types/deck";

// ---------------------------------------------------------------------------
// The deck details dialog (TODO DK5.14): the deck type and the bracket are
// edited there (the bracket a Commander deck's only), a save sends ONLY the
// fields the maker changed, a refusal on either focuses it, and a rename
// that moved the slug lands on the deck's new URL.
// ---------------------------------------------------------------------------

const updateDeckAction = vi.fn();
const replace = vi.fn();
const refresh = vi.fn();
vi.mock("@/lib/decks/actions", () => ({
  updateDeckAction: (...args: unknown[]) => updateDeckAction(...args),
}));
vi.mock("@/lib/media/upload-cover", () => ({ uploadCoverImage: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, refresh, push: vi.fn() }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { DeckCreatorForm } from "@/components/decks/deck-creator-form";

afterEach(() => {
  cleanup();
  updateDeckAction.mockReset();
  replace.mockReset();
  refresh.mockReset();
});

const DECK = {
  id: "b0000000-0000-4000-a000-000000000001",
  owner_id: "u1",
  title: "Cinderwing Dragonstorm",
  slug: "cinderwing-dragonstorm",
  description: "Dragons.",
  cover_url: null,
  cover_position: null,
  format: "commander",
  visibility: "public",
  deck_type: "dragons",
  bracket: 3,
} as unknown as Deck;

const save = async () => {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
  });
};

describe("the deck details dialog — type and bracket", () => {
  it("shows the stored type and bracket, the bracket described by its blurb", () => {
    render(<DeckCreatorForm mode="edit" userId="u1" deck={DECK} embedded />);
    const type = screen.getByRole("combobox", { name: /Deck type/ }) as HTMLSelectElement;
    expect(type.value).toBe("dragons");
    const bracket = screen.getByRole("combobox", { name: "Bracket" }) as HTMLSelectElement;
    expect(bracket.value).toBe("3");
    expect(document.getElementById(bracket.getAttribute("aria-describedby")!.split(" ").pop()!)?.textContent).toMatch(
      /Tuned and consistent/,
    );
  });

  it("the bracket is a Commander deck's alone", () => {
    render(<DeckCreatorForm mode="edit" userId="u1" deck={DECK} embedded />);
    fireEvent.change(screen.getByRole("combobox", { name: "Format" }), { target: { value: "modern" } });
    expect(screen.queryByRole("combobox", { name: "Bracket" })).toBeNull();
  });

  it("a save sends only the changed fields", async () => {
    updateDeckAction.mockResolvedValue({ ok: true, deckId: DECK.id, slug: DECK.slug });
    const onSaved = vi.fn();
    render(<DeckCreatorForm mode="edit" userId="u1" deck={DECK} embedded onSaved={onSaved} />);
    fireEvent.change(screen.getByRole("combobox", { name: /Deck type/ }), { target: { value: "goblins" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Bracket" }), { target: { value: "" } });
    await save();
    expect(updateDeckAction).toHaveBeenCalledWith(DECK.id, { deck_type: "goblins", bracket: null });
    expect(onSaved).toHaveBeenCalledWith(DECK.slug);
    expect(refresh).toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it("an untouched save writes nothing and closes", async () => {
    const onSaved = vi.fn();
    render(<DeckCreatorForm mode="edit" userId="u1" deck={DECK} embedded onSaved={onSaved} />);
    await save();
    expect(updateDeckAction).not.toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalled();
  });

  it("a stored type the list doesn't know stays as it is", async () => {
    updateDeckAction.mockResolvedValue({ ok: true, deckId: DECK.id, slug: DECK.slug });
    const older = { ...DECK, deck_type: "Dragons" } as unknown as Deck;
    render(<DeckCreatorForm mode="edit" userId="u1" deck={older} embedded onSaved={vi.fn()} />);
    const type = screen.getByRole("combobox", { name: /Deck type/ }) as HTMLSelectElement;
    expect(type.value).toBe("Dragons");
    fireEvent.change(screen.getByRole("textbox", { name: "Description" }), { target: { value: "More dragons." } });
    await save();
    expect(updateDeckAction).toHaveBeenCalledWith(DECK.id, { description: "More dragons." });
  });

  it("a refusal on the bracket focuses it, described by the error", async () => {
    updateDeckAction.mockResolvedValue({ ok: false, fieldErrors: { bracket: "Only a Commander deck has a bracket." } });
    render(<DeckCreatorForm mode="edit" userId="u1" deck={DECK} embedded />);
    fireEvent.change(screen.getByRole("combobox", { name: "Bracket" }), { target: { value: "4" } });
    await save();
    const bracket = screen.getByRole("combobox", { name: "Bracket" });
    expect(document.activeElement).toBe(bracket);
    expect(bracket.getAttribute("aria-invalid")).toBe("true");
  });

  it("a rename that moved the slug lands on the new URL", async () => {
    updateDeckAction.mockResolvedValue({ ok: true, deckId: DECK.id, slug: "ashen-dragonstorm" });
    render(<DeckCreatorForm mode="edit" userId="u1" deck={DECK} embedded onSaved={vi.fn()} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Title" }), { target: { value: "Ashen Dragonstorm" } });
    await save();
    expect(updateDeckAction).toHaveBeenCalledWith(DECK.id, { title: "Ashen Dragonstorm" });
    expect(replace).toHaveBeenCalledWith("/deck/ashen-dragonstorm");
  });
});
