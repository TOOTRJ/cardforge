// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { FormProvider, useForm, useWatch } from "react-hook-form";
import type { ColorIdentity } from "@/types/card";

// ---------------------------------------------------------------------------
// The Card step's frame tiles. A tile is the FRAME the user meant: when that
// frame isn't verified in the card's current colour, picking it moves the
// colour to the frame's first published colour and says so, instead of
// leaving the form on an unpublished (frame, colour) pair the server would
// refuse.
// ---------------------------------------------------------------------------

const toast = vi.hoisted(() => ({ info: vi.fn(), error: vi.fn(), success: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import { CardSetupPanel } from "@/components/creator/panels/card-setup-panel";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";

function Harness({
  verified,
  onColor,
  initialColor = "blue",
}: {
  verified: string[];
  onColor: (next: ColorIdentity[]) => void;
  initialColor?: ColorIdentity;
}) {
  const methods = useForm({
    defaultValues: {
      card_type: "creature",
      frame_style: { template: "m15" },
      color_identity: [initialColor] as ColorIdentity[],
      title: "",
      supertype: "",
      subtypes_text: "",
    },
  });
  // useWatch (not methods.watch) so the harness plays by the React Compiler's
  // rules like the real form does.
  const color = useWatch({ control: methods.control, name: "color_identity" }) as ColorIdentity[];
  const template = useWatch({ control: methods.control, name: "frame_style.template" }) as string;
  return (
    <FormProvider {...methods}>
      <CardSetupPanel
        kind="creature"
        colorIdentity={color}
        verifiedFrameKeys={verified}
        onKindSelect={() => {}}
        onColorIdentityChange={onColor}
      />
      <output data-testid="template">{template}</output>
      <output data-testid="color">{color.join(",")}</output>
    </FormProvider>
  );
}

const retroGroup = () =>
  screen.getByRole("radiogroup", { name: /Retro \(1997\) frames/ });

afterEach(() => {
  cleanup();
  toast.info.mockClear();
});

describe("CardSetupPanel frame tiles", () => {
  it("keeps the colour when the picked frame is verified in it", () => {
    const onColor = vi.fn();
    render(
      <Harness
        verified={[frameComboKey("m15", "u"), frameComboKey("retro", "u")]}
        onColor={onColor}
      />,
    );
    fireEvent.click(within(retroGroup()).getByRole("radio", { name: /Standard/ }));
    expect(screen.getByTestId("template").textContent).toBe("retro");
    expect(screen.getByTestId("color").textContent).toBe("blue");
    expect(onColor).not.toHaveBeenCalled();
    expect(toast.info).not.toHaveBeenCalled();
  });

  it("follows the frame to its first published colour and announces it", () => {
    const onColor = vi.fn();
    render(
      <Harness
        verified={[
          frameComboKey("m15", "u"),
          frameComboKey("retro", "w"),
          frameComboKey("retro", "g"),
        ]}
        onColor={onColor}
      />,
    );
    const tile = within(retroGroup()).getByRole("radio", { name: /Standard/ });
    // The tile is enabled (some colour is published) and says what a pick does.
    expect((tile as HTMLButtonElement).disabled).toBe(false);
    expect(tile.textContent).toMatch(/picking it switches to white/);

    fireEvent.click(tile);
    expect(screen.getByTestId("template").textContent).toBe("retro");
    expect(screen.getByTestId("color").textContent).toBe("white");
    expect(onColor).toHaveBeenCalledWith(["white"]);
    expect(toast.info).toHaveBeenCalledTimes(1);
    expect(String(toast.info.mock.calls[0][0])).toMatch(/isn't verified in blue yet — switched the colour to white/);
  });

  it("disables a frame with no published colour at all", () => {
    render(<Harness verified={[frameComboKey("m15", "u")]} onColor={vi.fn()} />);
    const tile = within(retroGroup()).getByRole("radio", { name: /Standard/ });
    expect((tile as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(tile);
    expect(screen.getByTestId("template").textContent).toBe("m15");
  });
});
