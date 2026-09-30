// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FormProvider, useForm, useWatch } from "react-hook-form";

// ---------------------------------------------------------------------------
// TODO 4.6b (4.6 review 2026-09-29) — the Pips step's "Switch" prompt on a
// frame that draws the two-colour frame. A card that HOLDS a pair draws it
// (split halves), so a cost naming another pair — or three colours — no
// longer matches it, although both are the gold "m" key: before, "Switch"
// to W|U and then a {W}{B} cost kept the W|U split with no prompt. Where
// the frame draws no pair masters (Dragon Wing splits its own way), and on
// a plain "multicolor" card, nothing changes.
// ---------------------------------------------------------------------------

vi.mock("@/components/creator/custom-pip-dialog", () => ({ CustomPipDialog: () => null }));
vi.mock("@/components/cards/mana-cost-picker", () => ({
  ManaCostPicker: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <input aria-label="cost" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

import { PipsPanel } from "@/components/creator/panels/pips-panel";
import type { FormValues } from "@/lib/creator/form-types";
import type { ColorIdentity } from "@/types/card";

afterEach(() => cleanup());

function Harness({ template, colors, cost }: { template: string; colors: ColorIdentity[]; cost: string }) {
  const methods = useForm<FormValues>({
    defaultValues: { cost, color_identity: colors, frame_style: { template } } as Partial<FormValues> as FormValues,
  });
  const identity = useWatch({ control: methods.control, name: "color_identity" });
  return (
    <FormProvider {...methods}>
      <PipsPanel frameTemplate={template} pipOverrides={{} as never} />
      <output data-testid="colors">{identity.join(",")}</output>
    </FormProvider>
  );
}

const colors = () => screen.getByTestId("colors").textContent;
const switchButton = () => screen.queryByRole("button", { name: "Switch" });
const setCost = async (value: string) =>
  act(async () => {
    fireEvent.change(screen.getByLabelText("cost"), { target: { value } });
  });

describe("the Switch prompt and a held colour pair (m15 draws pairs)", () => {
  it("Switch to W|U, then {W}{B}: prompted again, and Switch makes it W|B", async () => {
    render(<Harness template="m15" colors={["blue"]} cost="{W}{U}" />);
    fireEvent.click(switchButton()!);
    expect(colors()).toBe("white,blue");
    expect(switchButton()).toBeNull();
    await setCost("{W}{B}");
    expect(switchButton(), "a W|U pair with a {W}{B} cost is prompted").not.toBeNull();
    expect(screen.getByText(/black/i)).toBeTruthy();
    fireEvent.click(switchButton()!);
    expect(colors()).toBe("white,black");
  });

  it("a pair with a three-colour cost is prompted, and Switch makes it gold", async () => {
    render(<Harness template="m15" colors={["white", "blue"]} cost="{W}{U}{B}" />);
    fireEvent.click(switchButton()!);
    expect(colors()).toBe("multicolor");
  });

  it("a pair with its own cost, a generic cost, or no cost: no prompt", async () => {
    render(<Harness template="m15" colors={["white", "blue"]} cost="{1}{W}{U}" />);
    expect(switchButton()).toBeNull();
    await setCost("{3}");
    expect(switchButton()).toBeNull();
    await setCost("");
    expect(switchButton()).toBeNull();
  });

  it("a plain multicolor card is never prompted for its pair (the follow fills it, or its owner chose gold)", () => {
    render(<Harness template="m15" colors={["multicolor"]} cost="{1}{W}{U}" />);
    expect(switchButton()).toBeNull();
  });

  it("a frame without pair masters keeps the old rule: Dragon Wing's W|U with a {W}{B} cost is not prompted", () => {
    render(<Harness template="tarkirdragon" colors={["white", "blue"]} cost="{W}{B}" />);
    expect(switchButton()).toBeNull();
  });
});
