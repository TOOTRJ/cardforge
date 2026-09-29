// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FormProvider, useForm, useWatch } from "react-hook-form";

// ---------------------------------------------------------------------------
// TODO 4.6.0 ships the plumbing only: no profile draws the crown or a pair
// yet, so nothing of it may show in the creator — no switch, no hint, no
// "Two colours" row — and a Multicolor pick stays the one gold "multicolor"
// it always was, whatever the cost. (4.6a / 4.6b turn the pieces on by
// declaring them on m15 / m15artifact / m15land;
// tests/unit/components/anatomy-panel.test.tsx runs the same UI with them.)
// ---------------------------------------------------------------------------

vi.mock("sonner", () => ({ toast: { info: vi.fn(), error: vi.fn(), success: vi.fn() } }));

import { AnatomyPanel, useTwoColorPairFollow } from "@/components/creator/panels/anatomy-panel";
import { CardSetupPanel } from "@/components/creator/panels/card-setup-panel";
import { NEW_CARD_ANATOMY } from "@/lib/cards/anatomy";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import type { FormValues } from "@/lib/creator/form-types";
import type { ColorIdentity } from "@/types/card";

afterEach(() => cleanup());

function Harness({ stored }: { stored: boolean }) {
  const methods = useForm<FormValues>({
    defaultValues: {
      card_type: "creature",
      supertype: "Legendary",
      cost: "{1}{W}{U}",
      color_identity: ["white"] as ColorIdentity[],
      frame_style: stored ? { template: "m15" } : { template: "m15", ...NEW_CARD_ANATOMY },
      title: "",
      subtypes_text: "",
    } as Partial<FormValues> as FormValues,
  });
  const markTouched = useTwoColorPairFollow(methods, !stored);
  const colors = useWatch({ control: methods.control, name: "color_identity" });
  return (
    <FormProvider {...methods}>
      <CardSetupPanel
        kind="creature"
        colorIdentity={colors}
        verifiedFrameKeys={["w", "u", "m"].map((k) => frameComboKey("m15", k))}
        onKindSelect={() => {}}
        onPairTouched={markTouched}
      />
      <AnatomyPanel
        which={["crown", "twoColor"]}
        stored={stored ? { frameStyle: { template: "m15" }, colorIdentity: ["multicolor"] } : null}
      />
      <output data-testid="colors">{colors.join(",")}</output>
    </FormProvider>
  );
}

describe("the creator in 4.6.0 (no frame draws the pieces)", () => {
  it.each([false, true])("shows no switch, hint or Two colours row (stored card: %s)", (stored) => {
    render(<Harness stored={stored} />);
    fireEvent.click(screen.getByRole("radio", { name: /multicolor/i }));
    expect(screen.queryByTestId("anatomy-panel")).toBeNull();
    expect(screen.queryByRole("switch", { name: "Legendary crown" })).toBeNull();
    expect(screen.queryByRole("switch", { name: "Two-colour frame" })).toBeNull();
    expect(screen.queryByTestId("two-colour-row")).toBeNull();
    expect(screen.queryByText(/New: the printed/)).toBeNull();
    // A Multicolor pick is the gold "multicolor", as before — never a pair.
    expect(screen.getByTestId("colors").textContent).toBe("multicolor");
  });
});
