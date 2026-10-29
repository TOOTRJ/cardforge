// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { FormProvider, useForm, useWatch } from "react-hook-form";

// ---------------------------------------------------------------------------
// The "＋ New deck" quick-create (#541's independent check), now the shared
// picker's (components/decks/deck-membership-picker.tsx, TODO DK9.1) in the
// creator's "Add to a deck" box. "＋ New deck" is REPLACED by a name /
// format / visibility / Create / Cancel row, and that row by the button
// again: each swap removes the control that held the keyboard focus. The
// focus is handed on both ways — to the name input, and back to "＋ New
// deck" on Cancel or once the deck is made — never dropped on the page.
//
// The DK0.8 remainder (owner 2026-10-29: "decks default to public; the user
// chooses private — the same as create card"): the deck's visibility is ON
// SHOW, as the card creator's Publish control — a "Keep it private" box over
// Unlisted / Public, Public picked — and sent as chosen. Decks are unlimited
// on every plan: nothing is checked first and no plan is offered; a refusal
// keeps the row with what was typed.
// ---------------------------------------------------------------------------

const createDeckAction = vi.hoisted(() => vi.fn());
vi.mock("@/lib/decks/actions", () => ({ createDeckAction }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

import { CreatorDeckBox } from "@/components/creator/creator-deck-box";
function Harness() {
  const methods = useForm({ defaultValues: { deck_id: "" } });
  return (
    <FormProvider {...methods}>
      <CreatorDeckBox
        mode="create"
        myDecks={[{ id: "d1", title: "Cinderwing", format: "commander" }]}
        deckRemix={null}
      />
      <DeckIdProbe />
    </FormProvider>
  );
}

function DeckIdProbe() {
  const deckId = useWatch({ name: "deck_id" }) as string;
  return <output data-testid="deck-id">{deckId}</output>;
}

beforeEach(() => {
  createDeckAction.mockReset();
});
afterEach(cleanup);

const openButton = () => screen.getByRole("button", { name: /New deck/ }) as HTMLButtonElement;
const cancelButton = () => screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement;
const nameInput = () => screen.queryByRole("textbox", { name: "New deck name" }) as HTMLInputElement | null;

describe("＋ New deck keeps the keyboard focus", () => {
  it("hands the focus to the name input; Cancel hands it back", () => {
    render(<Harness />);
    const open = openButton();
    open.focus();
    // The click is cancelled: nothing under it is handed the click.
    expect(fireEvent.click(open)).toBe(false);
    expect(nameInput()).not.toBeNull();
    expect(document.activeElement).toBe(nameInput());

    const cancel = cancelButton();
    cancel.focus();
    expect(fireEvent.click(cancel)).toBe(false);
    expect(nameInput()).toBeNull();
    expect(document.activeElement).toBe(openButton());
  });

  it("does not take the focus from someone who has moved on", () => {
    render(
      <>
        <Harness />
        <input aria-label="elsewhere" />
      </>,
    );
    fireEvent.click(openButton());
    const elsewhere = screen.getByLabelText("elsewhere") as HTMLInputElement;
    const cancel = cancelButton();
    // The row closes while the focus is somewhere else on the page.
    elsewhere.focus();
    fireEvent.click(cancel);
    expect(nameInput()).toBeNull();
    expect(document.activeElement).toBe(elsewhere);
  });

  it("a made deck becomes the card's deck, and the focus goes back to ＋ New deck", async () => {
    createDeckAction.mockResolvedValue({ ok: true, deckId: "d2", slug: "goblins" });
    render(<Harness />);
    fireEvent.click(openButton());
    fireEvent.change(nameInput()!, { target: { value: "Goblins" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Create deck/ }));
    });
    expect(createDeckAction).toHaveBeenCalledWith(
      { title: "Goblins", format: "commander", visibility: "public" },
      { surface: "creator" },
    );
    expect(screen.getByTestId("deck-id").textContent).toBe("d2");
    const select = screen.getByRole("combobox", { name: "Deck for this card" }) as HTMLSelectElement;
    expect(within(select).getByRole("option", { name: /Goblins/ })).toBeTruthy();
    expect(document.activeElement).toBe(openButton());
  });
});

describe("the new deck's visibility (TODO DK0.8)", () => {
  const privateBox = () => screen.getByRole("checkbox", { name: "Keep it private" }) as HTMLInputElement;
  const visibilityRow = () => screen.queryByRole("radiogroup", { name: "New deck visibility" });

  it("is on show as the card creator's: the private box, then Unlisted / Public — Public picked", () => {
    render(<Harness />);
    fireEvent.click(openButton());
    expect(privateBox().checked).toBe(false);
    // Named by its words, described by the line under them.
    const note = document.getElementById(privateBox().getAttribute("aria-describedby")!);
    expect(note?.textContent).toMatch(/^Private — only you can see it\./);
    const radios = within(visibilityRow()!).getAllByRole("radio");
    expect(radios.map((r) => r.textContent)).toEqual([
      expect.stringMatching(/^Unlisted/),
      expect.stringMatching(/^Public/),
    ]);
    expect(radios[1]!.getAttribute("aria-checked")).toBe("true");
    // The box comes before the chips, as on the card's Publish step.
    expect(privateBox().compareDocumentPosition(visibilityRow()!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("left alone, the deck is made Public", async () => {
    createDeckAction.mockResolvedValue({ ok: true, deckId: "d4", slug: "open" });
    render(<Harness />);
    fireEvent.click(openButton());
    fireEvent.change(nameInput()!, { target: { value: "Open" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Create deck/ }));
    });
    expect(createDeckAction).toHaveBeenCalledWith({ title: "Open", format: "commander", visibility: "public" }, { surface: "creator" });
  });

  it("Unlisted is a pick of its own", async () => {
    createDeckAction.mockResolvedValue({ ok: true, deckId: "d5", slug: "link" });
    render(<Harness />);
    fireEvent.click(openButton());
    fireEvent.change(nameInput()!, { target: { value: "By link" } });
    fireEvent.click(within(visibilityRow()!).getByRole("radio", { name: /Unlisted/ }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Create deck/ }));
    });
    expect(createDeckAction).toHaveBeenCalledWith({ title: "By link", format: "commander", visibility: "unlisted" }, { surface: "creator" });
  });

  it("the private box makes it private — the chips step aside, nothing is checked first, no plan offered", async () => {
    createDeckAction.mockResolvedValue({ ok: true, deckId: "d3", slug: "secret-tech" });
    render(<Harness />);
    fireEvent.click(openButton());
    fireEvent.change(nameInput()!, { target: { value: "Secret tech" } });
    fireEvent.click(privateBox());
    expect(visibilityRow()).toBeNull();
    expect(screen.queryByTestId("deck-capacity-notice")).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Create deck/ }));
    });
    expect(createDeckAction).toHaveBeenCalledWith(
      { title: "Secret tech", format: "commander", visibility: "private" },
      { surface: "creator" },
    );
    expect(screen.getByTestId("deck-id").textContent).toBe("d3");
  });

  it("a refusal keeps the row with what was typed, and the card's deck as it was", async () => {
    createDeckAction.mockResolvedValue({ ok: false, formError: "Could not create deck." });
    render(<Harness />);
    fireEvent.click(openButton());
    fireEvent.change(nameInput()!, { target: { value: "Secret tech" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Create deck/ }));
    });
    expect(nameInput()?.value).toBe("Secret tech");
    expect(screen.getByTestId("deck-id").textContent).toBe("");
  });
});
