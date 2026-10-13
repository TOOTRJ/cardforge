// @vitest-environment happy-dom
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { FormProvider, useForm, useWatch } from "react-hook-form";
import { FaceScope, FieldGroup } from "@/components/creator/field-group";
import { ChipGroup } from "@/components/ui/chip-group";
import { RarityPanel } from "@/components/creator/panels/rarity-panel";

// ---------------------------------------------------------------------------
// FieldGroup has two shapes with one look. A field that is ONE text input,
// select or textarea is a <label>. A field that is a SET of controls (chips,
// a toolbar over an editor, switches) is a role="group" named by its caption:
// as a <label> it named its FIRST chip "<caption> <every chip> <helper>",
// named nothing else, and a click on the caption pressed that chip.
// ---------------------------------------------------------------------------

afterEach(cleanup);

const OPTIONS = [
  { value: "common", label: "Common" },
  { value: "uncommon", label: "Uncommon" },
  { value: "rare", label: "Rare" },
] as const;
type Option = (typeof OPTIONS)[number]["value"];

function Chips({ onPick = () => {}, error }: { onPick?: (next: Option) => void; error?: string }) {
  const [value, setValue] = useState<Option>("rare");
  return (
    <FieldGroup kind="group" label="Rarity" helper="Tints the set icon on the type line." error={error}>
      <ChipGroup
        ariaLabel="Rarity"
        value={value}
        onChange={(next) => {
          setValue(next);
          onPick(next);
        }}
        options={[...OPTIONS]}
      />
    </FieldGroup>
  );
}

describe("FieldGroup kind=\"group\" — a set of chips", () => {
  it("is a group named by its visible caption, described by its helper", () => {
    render(<Chips />);
    const group = screen.getByRole("group", { name: "Rarity" });
    const caption = screen.getByText("Rarity", { selector: "span" });
    expect(group.getAttribute("aria-labelledby")).toBe(caption.id);
    expect(caption.id).not.toBe("");
    expect(screen.getByRole("group", { description: "Tints the set icon on the type line." })).toBe(group);
    // The chip row is inside it, and nothing here is a <label>.
    expect(within(group).getByRole("radiogroup", { name: "Rarity" })).toBeTruthy();
    expect(group.tagName).toBe("DIV");
    expect(document.querySelector("label")).toBeNull();
  });

  it("describes the group by the error when there is one (it replaces the helper)", () => {
    render(<Chips error="Pick a rarity." />);
    const group = screen.getByRole("group", { name: "Rarity" });
    expect(screen.getByRole("group", { description: "Pick a rarity." })).toBe(group);
    expect(screen.queryByText("Tints the set icon on the type line.")).toBeNull();
  });

  it("has no aria-describedby without a helper or an error", () => {
    render(
      <FieldGroup kind="group" label="Finish">
        <button type="button">Foil</button>
      </FieldGroup>,
    );
    expect(screen.getByRole("group", { name: "Finish" }).hasAttribute("aria-describedby")).toBe(false);
  });

  it("leaves each chip its OWN accessible name — never prefixed by the caption", () => {
    render(<Chips />);
    const chips = screen.getAllByRole("radio");
    expect(chips).toHaveLength(OPTIONS.length);
    // Exact names: "Common", not "Rarity Common Uncommon Rare Tints the…".
    for (const { label } of OPTIONS) {
      expect(screen.getByRole("radio", { name: label })).toBeTruthy();
    }
    expect(screen.queryByRole("radio", { name: /Rarity|Tints/ })).toBeNull();
    // No chip is any label's control.
    for (const chip of chips) expect((chip as HTMLButtonElement).labels?.length ?? 0).toBe(0);
  });

  it("a click on the caption, the helper or a gap presses no chip", () => {
    const onPick = vi.fn();
    render(<Chips onPick={onPick} />);
    fireEvent.click(screen.getByText("Rarity", { selector: "span" }));
    fireEvent.click(screen.getByText("Tints the set icon on the type line."));
    fireEvent.click(screen.getByRole("radiogroup"));
    fireEvent.click(screen.getByRole("group", { name: "Rarity" }));
    expect(onPick).not.toHaveBeenCalled();
    expect(screen.getByRole("radio", { name: "Rare" }).getAttribute("aria-checked")).toBe("true");
    // …and a click ON a chip still picks it.
    fireEvent.click(screen.getByRole("radio", { name: "Common" }));
    expect(onPick).toHaveBeenCalledWith("common");
  });

  it("gives two groups on one page their own caption ids", () => {
    render(
      <>
        <Chips />
        <FieldGroup kind="group" label="Finish" helper="A treatment layered on top.">
          <button type="button">Foil</button>
        </FieldGroup>
      </>,
    );
    const ids = ["Rarity", "Finish"].flatMap((name) => {
      const group = screen.getByRole("group", { name });
      return [group.getAttribute("aria-labelledby"), group.getAttribute("aria-describedby")];
    });
    expect(new Set(ids).size).toBe(4);
  });
});

describe("FieldGroup (default) — one text control", () => {
  it("is a <label> whose caption names the input and whose click reaches it", () => {
    const onClick = vi.fn();
    render(
      <FieldGroup label="Title" helper="The card's name.">
        <input placeholder="Emberwing" onClick={onClick} />
      </FieldGroup>,
    );
    const input = screen.getByPlaceholderText("Emberwing") as HTMLInputElement;
    const caption = screen.getByText("Title", { selector: "span" });
    const label = caption.closest("label") as HTMLLabelElement;
    expect(label).not.toBeNull();
    expect(label.control).toBe(input);
    expect(screen.getByRole("textbox", { name: /^Title/ })).toBe(input);
    expect(screen.queryByRole("group")).toBeNull();
    // The label's forwarding is left alone: the click is not cancelled, and
    // it arrives at the input (which is what focuses it in a browser).
    expect(fireEvent.click(caption)).toBe(true);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("names a select and a textarea the same way", () => {
    render(
      <>
        <FieldGroup label="Language">
          <select>
            <option>English</option>
          </select>
        </FieldGroup>
        <FieldGroup label="Flavor text">
          <textarea />
        </FieldGroup>
      </>,
    );
    expect(screen.getByRole("combobox", { name: "Language" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Flavor text" })).toBeTruthy();
  });
});

describe("a real creator panel — Rarity", () => {
  function Harness() {
    const methods = useForm({ defaultValues: { rarity: "rare" } });
    const rarity = useWatch({ control: methods.control, name: "rarity" });
    return (
      <FormProvider {...methods}>
        <RarityPanel />
        <output data-testid="rarity">{rarity}</output>
      </FormProvider>
    );
  }

  it("is ONE named row of chips with their own names, said once; the caption presses nothing", () => {
    render(<Harness />);
    // The chip row is the field (TODO 3b.24): "Rarity", described by the
    // helper — and no group around it that says "Rarity" a second time.
    const row = screen.getByRole("radiogroup", { name: "Rarity" });
    expect(screen.getByRole("radiogroup", { description: "Tints the set icon on the type line." })).toBe(row);
    expect(screen.queryByRole("group")).toBeNull();
    const group = row.parentElement!;
    expect(group.closest("label")).toBeNull();
    expect(within(group).getByRole("radio", { name: "common" })).toBeTruthy();
    expect(within(group).getByRole("radio", { name: "mythic" })).toBeTruthy();
    fireEvent.click(within(group).getByText("Rarity", { selector: "span" }));
    expect(screen.getByTestId("rarity").textContent).toBe("rare");
    fireEvent.click(within(group).getByRole("radio", { name: "mythic" }));
    expect(screen.getByTestId("rarity").textContent).toBe("mythic");
  });
});

// ---------------------------------------------------------------------------
// TODO 3b.19 — a text field's NAME is its caption and nothing else; the
// helper (or the error that replaces it) is its DESCRIPTION. As a bare
// <label> the helper was part of the name ("Flavor text Optional — up to
// 1000 characters."), and an error was only more name.
// ---------------------------------------------------------------------------

describe("FieldGroup (default) — the control's name and description", () => {
  it("names the input by the caption alone and describes it by the helper", () => {
    render(
      <FieldGroup label="Flavor text" helper="Optional — up to 1000 characters.">
        <textarea />
      </FieldGroup>,
    );
    const box = screen.getByRole("textbox", { name: "Flavor text" });
    expect(screen.getByRole("textbox", { description: "Optional — up to 1000 characters." })).toBe(box);
    expect(box.hasAttribute("aria-invalid")).toBe(false);
    // Still a <label>: a click on the caption reaches the control.
    expect((screen.getByText("Flavor text").closest("label") as HTMLLabelElement).control).toBe(box);
  });

  it("an error replaces the helper as the description and marks the control invalid", () => {
    render(
      <FieldGroup label="Title" helper="The card's name." error="Give the card a name.">
        <input />
      </FieldGroup>,
    );
    const input = screen.getByRole("textbox", { name: "Title" });
    expect(screen.getByRole("textbox", { description: "Give the card a name." })).toBe(input);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    // Not a live region: the form's own alert and the focus announce it once.
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("has no description without a helper or an error", () => {
    render(
      <FieldGroup label="Power">
        <input />
      </FieldGroup>,
    );
    const input = screen.getByRole("textbox", { name: "Power" });
    expect(input.hasAttribute("aria-describedby")).toBe(false);
  });

  it("keeps what the control says about itself: its own name, its own note after the field's", () => {
    render(
      <>
        <FieldGroup label="Power" helper="A number, * or X.">
          <input aria-describedby="own-note" />
        </FieldGroup>
        <p id="own-note">This frame draws none.</p>
        <FieldGroup label="Format" helper="Sets the deck size.">
          <select aria-label="Deck format">
            <option>Commander</option>
          </select>
        </FieldGroup>
      </>,
    );
    expect(screen.getByRole("textbox", { name: "Power", description: "A number, * or X. This frame draws none." })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Deck format", description: "Sets the deck size." })).toBeTruthy();
  });

  it("a control inside a wrapper takes them from a function child", () => {
    render(
      <FieldGroup label="Footer mark" helper="Prints bottom-right." error="Too long.">
        {(aria) => (
          <div>
            <input {...aria} />
            <button type="button">Save as my default</button>
          </div>
        )}
      </FieldGroup>,
    );
    const input = screen.getByRole("textbox", { name: "Footer mark", description: "Too long." });
    expect(input.getAttribute("aria-invalid")).toBe("true");
    // The button beside it is not the label's control (a label names its
    // FIRST labelable descendant only — the input).
    expect((screen.getByText("Footer mark").closest("label") as HTMLLabelElement).control).toBe(input);
  });

  it("inside a FaceScope the name carries the face — and still no helper", () => {
    render(
      <FaceScope label="Back face">
        <FieldGroup label="Title" helper="The back face's name.">
          <input />
        </FieldGroup>
      </FaceScope>,
    );
    expect(screen.getByRole("textbox", { name: "Back face — Title", description: "The back face's name." })).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// TODO 3b.24 — a field that is ONE control with a role of its own (a chip
// row, the rules editor) is said once: no group named like it around it.
// ---------------------------------------------------------------------------

describe("FieldGroup kind=\"control\" — one control, said once", () => {
  function Row({ error }: { error?: string }) {
    return (
      <FieldGroup kind="control" label="Rarity" helper="Tints the set icon on the type line." error={error}>
        {(aria) => (
          <ChipGroup
            ariaLabel="Rarity"
            ariaDescribedBy={aria["aria-describedby"]}
            ariaInvalid={aria["aria-invalid"]}
            value="rare"
            onChange={() => {}}
            options={[...OPTIONS]}
          />
        )}
      </FieldGroup>
    );
  }

  it("has no role of its own: the row is the only thing named \"Rarity\", described by the helper", () => {
    render(<Row />);
    expect(screen.queryByRole("group")).toBeNull();
    expect(screen.getAllByRole("radiogroup")).toHaveLength(1);
    expect(screen.getByRole("radiogroup", { name: "Rarity", description: "Tints the set icon on the type line." })).toBeTruthy();
    // Same look as the other shapes: caption, control, note — and no <label>.
    const wrapper = screen.getByRole("radiogroup").parentElement!;
    expect(wrapper.tagName).toBe("DIV");
    expect(wrapper.className).toBe(screen.getByText("Rarity", { selector: "span" }).parentElement!.className);
    expect(document.querySelector("label")).toBeNull();
  });

  it("an error describes the row and marks it invalid", () => {
    render(<Row error="Pick a rarity." />);
    const row = screen.getByRole("radiogroup", { name: "Rarity", description: "Pick a rarity." });
    expect(row.getAttribute("aria-invalid")).toBe("true");
  });

  it("a click on the caption or the helper presses no chip", () => {
    const onPick = vi.fn();
    render(
      <FieldGroup kind="control" label="Finish" helper="A treatment layered on top.">
        {() => <ChipGroup ariaLabel="Finish" value="common" onChange={onPick} options={[...OPTIONS]} />}
      </FieldGroup>,
    );
    fireEvent.click(screen.getByText("Finish", { selector: "span" }));
    fireEvent.click(screen.getByText("A treatment layered on top."));
    expect(onPick).not.toHaveBeenCalled();
  });
});
