// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FormProvider, useForm } from "react-hook-form";

// ---------------------------------------------------------------------------
// The Publish step's "Add to deck" quick-create (#541's independent check).
// "＋ New deck" is REPLACED by a name / format / Create / Cancel row, and that
// row by the button again: each swap removes the control that held the
// keyboard focus. The focus is handed on both ways — to the name input, and
// back to "＋ New deck" on Cancel — never dropped on the page.
//
// Both buttons sit in the field's <label> and are gone before their click
// ends; WebKit then forwards the click to the label's control (the deck
// select), which took the focus. The clicks are cancelled, which stops that.
// ---------------------------------------------------------------------------

vi.mock("@/lib/decks/actions", () => ({ createDeckAction: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/components/creator/panels/watermark-picker", () => ({ WatermarkPicker: () => null }));
vi.mock("@/components/creator/challenge-brief-dialog", () => ({ ChallengeBriefDialog: () => null }));

import { PublishPanel } from "@/components/creator/panels/publish-panel";

function Harness() {
  const methods = useForm({
    defaultValues: {
      deck_id: "",
      tags_text: "",
      visibility: "public",
      save_as_draft: false,
      frame_style: { finish: "regular", template: "m15" },
    },
  });
  return (
    <FormProvider {...methods}>
      <PublishPanel userId="u1" myDecks={[{ id: "d1", title: "Cinderwing", format: "commander" }]} />
    </FormProvider>
  );
}

afterEach(cleanup);

// By their own words: testing-library names every button inside a <label>
// with the label's whole text (a browser names only the label's first
// control that way — checked in Chromium's accessibility tree).
const openButton = () => screen.getByText(/New deck/).closest("button") as HTMLButtonElement;
const cancelButton = () => screen.getByText("Cancel").closest("button") as HTMLButtonElement;
const nameInput = () => screen.queryByPlaceholderText("Deck name") as HTMLInputElement | null;

describe("Add to deck — quick-create keeps the keyboard focus", () => {
  it("＋ New deck hands the focus to the name input; Cancel hands it back", () => {
    render(<Harness />);
    const open = openButton();
    open.focus();
    // The click is cancelled: a <label> does not forward a cancelled click.
    expect(fireEvent.click(open)).toBe(false);
    expect(nameInput()).not.toBeNull();
    expect(nameInput()!.getAttribute("aria-label")).toBe("New deck name");
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
});
