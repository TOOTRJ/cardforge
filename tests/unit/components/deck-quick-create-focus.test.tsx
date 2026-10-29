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
// The DK0.8 remainder: the deck's visibility is SAID (Public unless
// changed) and sent as chosen. Decks are unlimited on every plan (owner,
// 2026-10-29): nothing is checked first and no plan is offered; a refusal
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
  it("says Public, and only changes when the maker changes it", () => {
    render(<Harness />);
    fireEvent.click(openButton());
    expect(screen.getByText("Public").closest("p")?.textContent).toMatch(/^Public — listed in the community decks\./);
    // The choice is behind "Change" — a disclosure, not a dropped default.
    const change = screen.getByRole("button", { name: "Change the new deck's visibility" });
    expect(change.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(change);
    const group = screen.getByRole("radiogroup", { name: "New deck visibility" });
    expect(within(group).getByRole("radio", { name: /Public/ }).getAttribute("aria-checked")).toBe("true");
  });

  it("a private deck is made private — nothing checked first, no plan offered", async () => {
    createDeckAction.mockResolvedValue({ ok: true, deckId: "d3", slug: "secret-tech" });
    render(<Harness />);
    fireEvent.click(openButton());
    fireEvent.change(nameInput()!, { target: { value: "Secret tech" } });
    fireEvent.click(screen.getByRole("button", { name: "Change the new deck's visibility" }));
    fireEvent.click(screen.getByRole("radio", { name: /Private/ }));
    // The line that says it (the chip says "Private" too).
    expect(screen.getByText(/only you can see it/).textContent).toMatch(/^Private — only you can see it\./);
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
