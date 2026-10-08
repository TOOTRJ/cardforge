// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { FormProvider, useForm, useWatch } from "react-hook-form";

// ---------------------------------------------------------------------------
// TODO 4.21e — the creator's "Text alignment: Left / Centred" control on the
// Text step (owner 2026-10-07: every kind of card may choose it; a new card
// starts on Left). Shown on every frame that sets its text in plain rules
// boxes, hidden where it can't apply (a textless frame; the saga and the
// walker have their own editors, and their frames never offer it); it writes
// frame_style.rulesAlign, which the live preview and the save both read.
// ---------------------------------------------------------------------------

vi.mock("@/components/creator/pip-text-editor", () => ({
  PipTextEditor: (props: { value: string; "aria-label"?: string }) => <textarea aria-label={props["aria-label"]} defaultValue={props.value} />,
}));
vi.mock("@/components/creator/rules-symbol-toolbar", () => ({ RulesSymbolToolbar: () => null }));

import { RULES_ALIGN_HELP, TextPanel } from "@/components/creator/panels/text-panel";
import { NEW_CARD_ANATOMY } from "@/lib/cards/anatomy";
import { defaultValuesFor } from "@/lib/creator/card-fields";
import type { FormValues } from "@/lib/creator/form-types";
import { frameAnatomyPatchFor } from "@/lib/creator/revise";
import { FRAME_TEMPLATE_VALUES, type Card, type FrameStyle } from "@/types/card";
import { getFrameProfile, profileOffersRulesAlign } from "@/lib/cards/template-layout";

afterEach(() => cleanup());

function Harness({ frameStyle, stored }: { frameStyle: FrameStyle; stored?: Record<string, unknown> }) {
  const methods = useForm<FormValues>({
    defaultValues: { rules_text: "Discard a card, then draw two cards.", flavor_text: "", color_identity: ["red"], frame_style: frameStyle } as Partial<FormValues> as FormValues,
  });
  const [style, colors] = useWatch({ control: methods.control, name: ["frame_style", "color_identity"] });
  const patch = stored ? frameAnatomyPatchFor({ frame_style: stored, color_identity: ["red"] }, { frame_style: style, color_identity: colors }) : undefined;
  return (
    <FormProvider {...methods}>
      <TextPanel rulesTextRef={{ current: null }} onInsertSymbol={() => {}} />
      <output data-testid="style">{JSON.stringify(style)}</output>
      <output data-testid="patch">{JSON.stringify(patch ?? null)}</output>
      <input aria-label="template" value={style?.template ?? ""} onChange={(e) => methods.setValue("frame_style.template", e.target.value as FrameStyle["template"])} />
    </FormProvider>
  );
}

const style = () => JSON.parse(screen.getByTestId("style").textContent ?? "{}");
const patch = () => JSON.parse(screen.getByTestId("patch").textContent ?? "null");
const group = () => screen.queryByRole("radiogroup", { name: "Text alignment" });
const chip = (name: "Left" | "Centred") => within(group()!).getByRole("radio", { name });

describe("the Text step's alignment control", () => {
  it("a new card: shown, on Left, with its help — one click centres, another goes back", () => {
    const fresh = defaultValuesFor(undefined, [], {}).frame_style;
    expect(fresh).toMatchObject(NEW_CARD_ANATOMY);
    render(<Harness frameStyle={fresh} />);
    expect(group()).not.toBeNull();
    // A labelled group of two radios.
    expect(screen.getByRole("group", { name: "Text alignment" })).toBe(screen.getByTestId("rules-align"));
    expect(screen.getByText(RULES_ALIGN_HELP)).toBeTruthy();
    expect(within(group()!).getAllByRole("radio").map((r) => r.textContent)).toEqual(["Left", "Centred"]);
    expect(chip("Left").getAttribute("aria-checked")).toBe("true");
    expect(chip("Centred").getAttribute("aria-checked")).toBe("false");
    expect("rulesAlign" in style()).toBe(false);

    fireEvent.click(chip("Centred"));
    expect(style().rulesAlign).toBe("center");
    expect(chip("Centred").getAttribute("aria-checked")).toBe("true");
    expect(chip("Left").getAttribute("aria-checked")).toBe("false");

    fireEvent.click(chip("Left"));
    expect(style().rulesAlign).toBe("left");
    expect(chip("Left").getAttribute("aria-checked")).toBe("true");
  });

  it("is shown for every kind of frame with a plain rules box, and hidden on a textless one", () => {
    for (const template of ["m15", "m15land", "split", "aftermath", "flip", "adventure", "battle", "emblem", "m15token", "m15tokentext", "m15dfcfront", "m15mdfcfront", "retro", "m15borderless"] as const) {
      render(<Harness frameStyle={{ template }} />);
      expect(group(), template).not.toBeNull();
      cleanup();
    }
    for (const template of FRAME_TEMPLATE_VALUES.filter((t) => !profileOffersRulesAlign(getFrameProfile(t)))) {
      render(<Harness frameStyle={{ template, rulesAlign: "center" }} />);
      expect(group(), template).toBeNull();
      cleanup();
    }
  });

  it("follows the frame: gone when the card moves to a textless frame, back (with its value) on a text frame", () => {
    render(<Harness frameStyle={{ template: "m20tokentext", rulesAlign: "center" }} />);
    expect(chip("Centred").getAttribute("aria-checked")).toBe("true");
    fireEvent.change(screen.getByLabelText("template"), { target: { value: "m20token" } });
    expect(group()).toBeNull();
    fireEvent.change(screen.getByLabelText("template"), { target: { value: "m20tokentall" } });
    expect(chip("Centred").getAttribute("aria-checked")).toBe("true");
  });

  it("editing a stored card: Left for a card that names none, and the edit sends only the change", () => {
    const stored = { template: "split", finish: "regular" };
    const card = { title: "Fast", slug: "fast", color_identity: ["red"], subtypes: [], tags: [], frame_style: stored } as unknown as Card;
    render(<Harness frameStyle={defaultValuesFor(card, [], {}).frame_style} stored={stored} />);
    expect(chip("Left").getAttribute("aria-checked")).toBe("true");
    expect(patch()).toBeNull();
    fireEvent.click(chip("Centred"));
    expect(patch()).toEqual({ rulesAlign: "center" });
    fireEvent.click(chip("Left"));
    expect(patch()).toBeNull();
  });

  it("editing a centred card: Centred is checked; Left sends the off patch", () => {
    const stored = { template: "m15", rulesAlign: "center" };
    const card = { title: "Bolt", slug: "bolt", color_identity: ["red"], subtypes: [], tags: [], frame_style: stored } as unknown as Card;
    render(<Harness frameStyle={defaultValuesFor(card, [], {}).frame_style} stored={stored} />);
    expect(chip("Centred").getAttribute("aria-checked")).toBe("true");
    expect(patch()).toBeNull();
    fireEvent.click(chip("Left"));
    expect(patch()).toEqual({ rulesAlign: "left" });
  });
});
