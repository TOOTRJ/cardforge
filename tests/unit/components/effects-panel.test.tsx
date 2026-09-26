// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { FormProvider, useForm, useWatch } from "react-hook-form";
import { EffectsPanel, FINISH_OPTIONS } from "@/components/creator/panels/effects-panel";
import { frameStyleRequiresPremium, type CardFinish } from "@/types/card";

// ---------------------------------------------------------------------------
// The Publish step's finish picker (TODO 6.5, owner decision 2026-09-26):
// Foil and Etched ship — the preview and the saved image draw the same shared
// SVG — so their chips are selectable and write frame_style.finish. Showcase
// stays a disabled "Soon" chip: the bake prints nothing for it (a showcase
// bake is byte-identical to a regular one), so picking it would save a card
// that doesn't look like its preview.
// ---------------------------------------------------------------------------

function Harness({ initial = "regular" }: { initial?: CardFinish }) {
  const methods = useForm({
    defaultValues: { frame_style: { finish: initial, template: "m15" } },
  });
  // useWatch (not methods.watch), as the real form does.
  const finish = useWatch({ control: methods.control, name: "frame_style.finish" });
  const template = useWatch({ control: methods.control, name: "frame_style.template" });
  return (
    // The panel reads FormValues; the harness only carries what it touches.
    <FormProvider {...methods}>
      <EffectsPanel />
      <output data-testid="finish">{finish}</output>
      <output data-testid="template">{template}</output>
    </FormProvider>
  );
}

const group = () => screen.getByRole("radiogroup", { name: "Finish" });
// Found by the chip's own text, not its accessible name: FieldGroup is a
// <label>, so the DOM names the chips inside it after the caption ("Finish …").
const chip = (name: RegExp): HTMLButtonElement => {
  const hits = within(group())
    .getAllByRole("radio")
    .filter((el) => name.test(el.textContent ?? ""));
  expect(hits, String(name)).toHaveLength(1);
  return hits[0] as HTMLButtonElement;
};

afterEach(cleanup);

describe("EffectsPanel — finish chips", () => {
  it("offers Regular, Foil and Etched; Showcase is still 'Soon'", () => {
    render(<Harness />);
    for (const name of [/^Regular/, /^Foil/, /^Etched/]) {
      const button = chip(name);
      expect(button.disabled, String(name)).toBe(false);
      expect(button.textContent, String(name)).not.toMatch(/Soon/);
    }
    const showcase = chip(/^Showcase/);
    expect(showcase.disabled).toBe(true);
    expect(showcase.textContent).toMatch(/Soon/);
  });

  it("picking Foil, then Etched, writes frame_style.finish and leaves the frame alone", () => {
    render(<Harness />);
    expect(chip(/^Regular/).getAttribute("aria-checked")).toBe("true");

    fireEvent.click(chip(/^Foil/));
    expect(screen.getByTestId("finish").textContent).toBe("foil");
    expect(chip(/^Foil/).getAttribute("aria-checked")).toBe("true");
    expect(chip(/^Regular/).getAttribute("aria-checked")).toBe("false");

    fireEvent.click(chip(/^Etched/));
    expect(screen.getByTestId("finish").textContent).toBe("etched");
    expect(chip(/^Etched/).getAttribute("aria-checked")).toBe("true");

    fireEvent.click(chip(/^Regular/));
    expect(screen.getByTestId("finish").textContent).toBe("regular");
    // The finish is its own key: the frame the user picked never moves.
    expect(screen.getByTestId("template").textContent).toBe("m15");
  });

  it("ignores a click on Showcase", () => {
    render(<Harness initial="foil" />);
    fireEvent.click(chip(/^Showcase/));
    expect(screen.getByTestId("finish").textContent).toBe("foil");
    expect(chip(/^Foil/).getAttribute("aria-checked")).toBe("true");
  });

  it("shows a saved card's finish as the selected chip", () => {
    render(<Harness initial="etched" />);
    expect(chip(/^Etched/).getAttribute("aria-checked")).toBe("true");
    expect(chip(/^Regular/).getAttribute("aria-checked")).toBe("false");
  });

  it("never offers a finish a free account can't save (every finish is free)", () => {
    const offered = FINISH_OPTIONS.filter((o) => !o.disabled).map((o) => o.value);
    expect(offered).toEqual(["regular", "foil", "etched"]);
    for (const finish of offered) {
      // createCardAction refuses frameStyleRequiresPremium for a free plan.
      expect(frameStyleRequiresPremium({ finish, template: "m15" }), finish).toBe(false);
    }
  });
});
