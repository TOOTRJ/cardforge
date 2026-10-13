// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FormProvider, useForm } from "react-hook-form";
import { LoyaltyAbilitiesEditor } from "@/components/creator/panels/loyalty-editor";
import { TypesField } from "@/components/creator/types-field";
import { EMPTY_BACK_FACE, type FormValues } from "@/lib/creator/form-types";

// ---------------------------------------------------------------------------
// A control that removes itself must not drop the keyboard focus. "Remove
// ability 2" leaves the page with its row, the Types field's "Reset" with
// the edit it undoes — and a focus left on a
// removed element falls back to the top of the document, so a keyboard or
// screen-reader user is thrown out of the editor.
// ---------------------------------------------------------------------------

afterEach(cleanup);

function Harness({ values, children }: { values: Partial<FormValues>; children: React.ReactNode }) {
  const methods = useForm<FormValues>({
    defaultValues: {
      card_type: "planeswalker",
      supertype: "",
      subtypes_text: "",
      printed_types: null,
      frame_style: { template: "m15pw" },
      back_face: { ...EMPTY_BACK_FACE },
      loyalty_abilities: [],
      ...values,
    } as Partial<FormValues> as FormValues,
  });
  return <FormProvider {...methods}>{children}</FormProvider>;
}

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ cost: `+${i + 1}`, text: `Row ${i + 1}.` }));
const removeButton = (n: number) => screen.getByRole("button", { name: `Remove ability ${n}` });
const press = (button: HTMLElement) => {
  button.focus();
  fireEvent.click(button);
};

describe("the walker's rows", () => {
  it("removing a row moves the focus to the row that took its place", () => {
    render(
      <Harness values={{ loyalty_abilities: rows(3) }}>
        <LoyaltyAbilitiesEditor />
      </Harness>,
    );
    press(removeButton(2));
    expect(screen.queryByRole("button", { name: "Remove ability 3" })).toBeNull();
    expect(document.activeElement).toBe(removeButton(2));
  });

  it("removing the last row moves it to the row before; removing the only row, to Add", () => {
    render(
      <Harness values={{ loyalty_abilities: rows(2) }}>
        <LoyaltyAbilitiesEditor />
      </Harness>,
    );
    press(removeButton(2));
    expect(document.activeElement).toBe(removeButton(1));
    press(removeButton(1));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Add ability" }));
  });

  it("adding a row is react-hook-form's own: the focus goes into the new row — at the limit too, where Add leaves", () => {
    render(
      <Harness values={{ loyalty_abilities: rows(5) }}>
        <LoyaltyAbilitiesEditor />
      </Harness>,
    );
    press(screen.getByRole("button", { name: "Add ability" }));
    expect(screen.queryByRole("button", { name: "Add ability" })).toBeNull();
    expect(document.activeElement).toBe(screen.getByLabelText("Ability 6 loyalty cost"));
  });

  it("never pulls a focus that is somewhere else on the page", () => {
    render(
      <Harness values={{ loyalty_abilities: rows(2) }}>
        <input aria-label="Elsewhere" />
        <LoyaltyAbilitiesEditor />
      </Harness>,
    );
    const elsewhere = screen.getByLabelText("Elsewhere");
    elsewhere.focus();
    fireEvent.click(removeButton(1));
    expect(document.activeElement).toBe(elsewhere);
  });
});

describe("the Types field's Reset", () => {
  it("puts the focus in the field it reset", () => {
    render(
      <Harness values={{ card_type: "creature", printed_types: "Creature Legendary", frame_style: { template: "m15" } }}>
        <TypesField face="front" />
      </Harness>,
    );
    const reset = screen.getByTestId("types-field-reset-front");
    press(reset);
    expect(screen.queryByTestId("types-field-reset-front")).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId("types-field-input-front"));
  });
});
