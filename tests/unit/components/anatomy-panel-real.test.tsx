// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { FormProvider, useForm, useWatch } from "react-hook-form";

// ---------------------------------------------------------------------------
// TODO 4.6a + 4.6b — the creator on the REAL frame profiles (no fixture):
// m15, m15artifact and m15land draw the legendary crown and the two-colour
// pair masters, so the crown switch, the two-colour switch and the "Two
// colours" row show there — on for a new card, the pair pre-filled from the
// cost; off with each one-line hint on a stored card that never set them —
// and nowhere else. The same UI on a fixture profile:
// tests/unit/components/anatomy-panel.test.tsx.
// ---------------------------------------------------------------------------

vi.mock("sonner", () => ({ toast: { info: vi.fn(), error: vi.fn(), success: vi.fn() } }));

import {
  ANATOMY_HINTS,
  AnatomyPanel,
  HYBRID_FALLBACK_NOTE,
  useTwoColorPairFollow,
} from "@/components/creator/panels/anatomy-panel";
import { CardSetupPanel } from "@/components/creator/panels/card-setup-panel";
import { NEW_CARD_ANATOMY } from "@/lib/cards/anatomy";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import type { FormValues } from "@/lib/creator/form-types";
import type { ColorIdentity, FrameStyle } from "@/types/card";

afterEach(() => cleanup());

function Harness({
  stored,
  template = "m15",
  cost = "{1}{W}{U}",
  cardType = "creature",
  colors: seedColors = ["white"],
}: {
  stored: boolean;
  template?: string;
  cost?: string;
  cardType?: string;
  colors?: ColorIdentity[];
}) {
  const frameStyle = (stored ? { template } : { template, ...NEW_CARD_ANATOMY }) as FrameStyle;
  const methods = useForm<FormValues>({
    defaultValues: {
      card_type: cardType as FormValues["card_type"],
      supertype: "Legendary",
      cost,
      color_identity: seedColors,
      frame_style: frameStyle,
      title: "",
      subtypes_text: "",
    } as Partial<FormValues> as FormValues,
  });
  const markTouched = useTwoColorPairFollow(methods, !stored);
  const [colors, style] = useWatch({ control: methods.control, name: ["color_identity", "frame_style"] });
  return (
    <FormProvider {...methods}>
      {stored ? null : (
        <CardSetupPanel
          kind="creature"
          colorIdentity={colors}
          verifiedFrameKeys={["w", "u", "m"].map((k) => frameComboKey("m15", k))}
          onKindSelect={() => {}}
          onPairTouched={markTouched}
        />
      )}
      <AnatomyPanel
        which={["crown", "twoColor"]}
        stored={stored ? { frameStyle: { template: template as FrameStyle["template"] }, colorIdentity: seedColors } : null}
        onPairTouched={markTouched}
        pairRow={stored}
      />
      <output data-testid="colors">{colors.join(",")}</output>
      <output data-testid="style">{JSON.stringify(style)}</output>
    </FormProvider>
  );
}

const colors = () => screen.getByTestId("colors").textContent;
const twoColorSwitch = () => screen.queryByRole("switch", { name: "Two-colour frame" });
const crownSwitch = () => screen.queryByRole("switch", { name: "Legendary crown" });

describe("a new card on m15 (4.6a + 4.6b)", () => {
  it("Multicolor shows the Two colours row, pre-filled from the cost, and both switches on, with no hint", () => {
    render(<Harness stored={false} />);
    expect(screen.queryByTestId("two-colour-row")).toBeNull();
    // The legendary crown is on from the start (a mono Legendary card).
    expect(crownSwitch()?.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("radio", { name: /multicolor/i }));
    expect(colors()).toBe("white,blue");
    expect(screen.getAllByTestId("two-colour-row")).toHaveLength(1);
    expect(twoColorSwitch()?.getAttribute("aria-checked")).toBe("true");
    expect(crownSwitch()?.getAttribute("aria-checked")).toBe("true");
    expect(screen.queryByText(/New: the printed/)).toBeNull();
    expect(screen.queryByTestId("anatomy-note-twoColor")).toBeNull();
  });
});

describe("a stored card (no switch key)", () => {
  it("a stored multicolour m15 card: the switch off with the hint; on pre-fills the pair from the cost", () => {
    render(<Harness stored colors={["multicolor"]} />);
    expect(twoColorSwitch()?.getAttribute("aria-checked")).toBe("false");
    expect(screen.getByTestId("anatomy-hint-twoColor").textContent).toBe(ANATOMY_HINTS.twoColor);
    // The crown too: off, with its own hint, until the owner turns it on.
    expect(crownSwitch()?.getAttribute("aria-checked")).toBe("false");
    expect(screen.getByTestId("anatomy-hint-crown").textContent).toBe(ANATOMY_HINTS.crown);
    expect(colors()).toBe("multicolor");
    fireEvent.click(twoColorSwitch()!);
    expect(JSON.parse(screen.getByTestId("style").textContent ?? "{}")).toMatchObject({ twoColor: true });
    expect(colors()).toBe("white,blue");
    expect(within(screen.getByTestId("two-colour-row")).getByRole("button", { name: /^white$/i })).toBeTruthy();
  });

  it("the crown switch turns on alone: the pair and the colours stay as stored", () => {
    render(<Harness stored colors={["multicolor"]} />);
    fireEvent.click(crownSwitch()!);
    expect(JSON.parse(screen.getByTestId("style").textContent ?? "{}")).toEqual({ template: "m15", crown: true });
    expect(crownSwitch()?.getAttribute("aria-checked")).toBe("true");
    expect(screen.queryByTestId("anatomy-hint-crown")).toBeNull();
    expect(colors()).toBe("multicolor");
  });

  it.each(["m15devoid", "m15borderlessland", "saga"])("%s draws neither: no switch, no row, no hint", (template) => {
    render(<Harness stored template={template} colors={["multicolor"]} />);
    expect(screen.queryByTestId("anatomy-panel")).toBeNull();
    expect(twoColorSwitch()).toBeNull();
    expect(crownSwitch()).toBeNull();
    expect(screen.queryByText(/New: the printed/)).toBeNull();
  });

  it("m15snow draws both since 4.6f wave 2c: a stored legendary snow pair with no key shows both switches off, with their hints", () => {
    render(<Harness stored template="m15snow" colors={["blue", "black"]} />);
    expect(screen.queryByTestId("anatomy-panel")).not.toBeNull();
    expect(crownSwitch()?.getAttribute("aria-checked")).toBe("false");
    expect(twoColorSwitch()?.getAttribute("aria-checked")).toBe("false");
    expect(screen.queryByTestId("anatomy-hint-crown")).not.toBeNull();
    expect(screen.queryByTestId("anatomy-hint-twoColor")).not.toBeNull();
  });
});

describe("a hybrid artifact (m15artifact has no hybrid dress yet)", () => {
  it("says the all-hybrid cost gets the split two-colour frame", () => {
    render(<Harness stored template="m15artifact" cardType="artifact" cost="{W/U}{W/U}" colors={["white", "blue"]} />);
    expect(twoColorSwitch()).not.toBeNull();
    expect(screen.getByTestId("anatomy-note-twoColor").textContent).toBe(HYBRID_FALLBACK_NOTE);
  });

  it("no note on m15, which draws the hybrid dress, nor for a gold-split cost on the artifact frame", () => {
    render(<Harness stored cost="{G/W}{G/W}" colors={["green", "white"]} />);
    expect(screen.queryByTestId("anatomy-note-twoColor")).toBeNull();
    cleanup();
    render(<Harness stored template="m15artifact" cardType="artifact" cost="{1}{W}{U}" colors={["white", "blue"]} />);
    expect(screen.queryByTestId("anatomy-note-twoColor")).toBeNull();
  });
});
