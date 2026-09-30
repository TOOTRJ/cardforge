// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { FormProvider, useForm, useWatch } from "react-hook-form";

// ---------------------------------------------------------------------------
// TODO 4.6b — the creator on the REAL frame profiles (no fixture): m15,
// m15artifact and m15land draw the two-colour pair masters, so the
// two-colour switch and the "Two colours" row show there — on for a new
// card, pre-filled from the cost; off with the hint on a stored card — and
// nowhere else. No frame draws the legendary crown in this step (4.6a), so
// its switch never shows. The same UI with every piece declared:
// tests/unit/components/anatomy-panel.test.tsx (the fixture).
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

describe("a new card on m15 (4.6b)", () => {
  it("Multicolor shows the Two colours row, pre-filled from the cost, and the two-colour switch on; no crown switch", () => {
    render(<Harness stored={false} />);
    expect(screen.queryByTestId("two-colour-row")).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: /multicolor/i }));
    expect(colors()).toBe("white,blue");
    expect(screen.getAllByTestId("two-colour-row")).toHaveLength(1);
    expect(twoColorSwitch()?.getAttribute("aria-checked")).toBe("true");
    expect(screen.queryByRole("switch", { name: "Legendary crown" })).toBeNull();
    expect(screen.queryByText(/New: the printed/)).toBeNull();
    expect(screen.queryByTestId("anatomy-note-twoColor")).toBeNull();
  });
});

describe("a stored card (no switch key)", () => {
  it("a stored multicolour m15 card: the switch off with the hint; on pre-fills the pair from the cost", () => {
    render(<Harness stored colors={["multicolor"]} />);
    expect(twoColorSwitch()?.getAttribute("aria-checked")).toBe("false");
    expect(screen.getByTestId("anatomy-hint-twoColor").textContent).toBe(ANATOMY_HINTS.twoColor);
    expect(screen.queryByRole("switch", { name: "Legendary crown" })).toBeNull();
    expect(colors()).toBe("multicolor");
    fireEvent.click(twoColorSwitch()!);
    expect(JSON.parse(screen.getByTestId("style").textContent ?? "{}")).toMatchObject({ twoColor: true });
    expect(colors()).toBe("white,blue");
    expect(within(screen.getByTestId("two-colour-row")).getByRole("button", { name: /^white$/i })).toBeTruthy();
  });

  it.each(["m15snow", "m15devoid", "m15borderless", "saga"])("%s draws no pair: no switch, no row, no hint", (template) => {
    render(<Harness stored template={template} colors={["multicolor"]} />);
    expect(screen.queryByTestId("anatomy-panel")).toBeNull();
    expect(twoColorSwitch()).toBeNull();
    expect(screen.queryByText(/New: the printed/)).toBeNull();
  });
});

describe("a hybrid artifact (m15artifact has no hybrid dress yet)", () => {
  it("says the all-hybrid cost gets the gold two-colour frame", () => {
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
