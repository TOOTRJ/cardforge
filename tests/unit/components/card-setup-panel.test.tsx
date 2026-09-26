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
  cardType = "creature",
  supertype = "",
  initialTemplate = "m15",
}: {
  verified: string[];
  onColor: (next: ColorIdentity[]) => void;
  initialColor?: ColorIdentity;
  cardType?: "creature" | "artifact";
  supertype?: string;
  initialTemplate?: string;
}) {
  const methods = useForm({
    defaultValues: {
      card_type: cardType,
      frame_style: { template: initialTemplate },
      color_identity: [initialColor] as ColorIdentity[],
      title: "",
      supertype,
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
        kind={cardType}
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

describe("CardSetupPanel variation chips — Dragon Wing's own frame set", () => {
  it("labels Dragon Wing as Multiverse Legends, never under Tarkir: Dragonstorm", () => {
    render(
      <Harness
        verified={[
          frameComboKey("m15", "u"),
          frameComboKey("tarkirdragon", "u"),
          frameComboKey("tarkirdraconic", "u"),
        ]}
        onColor={vi.fn()}
      />,
    );
    const group = screen.getByRole("radiogroup", { name: /Frame variations/ });
    const chip = within(group).getByRole("radio", { name: /Dragon Wing/ });
    expect(chip.textContent).toContain("Dragon Wing (Multiverse Legends)");
    expect(chip.textContent).not.toMatch(/Tarkir|Multiverse Legends —/);
    // Draconic stays a Tarkir: Dragonstorm frame.
    expect(within(group).getByRole("radio", { name: /Draconic/ }).textContent).toContain("Tarkir: Dragonstorm — Draconic");
    fireEvent.click(chip);
    expect(document.body.textContent).not.toMatch(/Tarkir: Dragonstorm — Dragon Wing|Multiverse Legends — Dragon Wing/);
  });
});

describe("CardSetupPanel — Alpha's colourless tiles follow the card type (TODO 4.31)", () => {
  // A colourless ARTIFACT paints the brown artifact card (agclassic/a), any
  // other colourless card the grey one (agclassic/c) — the renderers' rule
  // (frameMasterKey), so the tiles show what the card will get. The
  // frame_reviews gate stays per colour: agclassic/c publishes both.
  const tiles = () => {
    const colour = within(screen.getByRole("radiogroup", { name: "Color identity" }))
      .getByRole("radio", { name: /colorless/i })
      .querySelector<HTMLElement>("[data-frame-key]");
    const frame = within(screen.getByRole("radiogroup", { name: /Classic \(1993\) frames/ }))
      .getByRole("radio", { name: /Standard/ })
      .querySelector<HTMLElement>("[data-frame-key]");
    return { colour: colour?.dataset.frameKey, frame: frame?.dataset.frameKey, colourBg: colour?.style.backgroundImage };
  };

  it.each<[string, "creature" | "artifact", string, string]>([
    ["an artifact", "artifact", "", "a"],
    ["an Artifact Creature", "creature", "Artifact", "a"],
    ["a creature", "creature", "", "c"],
  ])("%s on agclassic: the colourless tile and the frame tile show master %s", (_label, cardType, supertype, want) => {
    render(
      <Harness
        verified={[frameComboKey("agclassic", "c")]}
        onColor={vi.fn()}
        initialColor="colorless"
        cardType={cardType}
        supertype={supertype}
        initialTemplate="agclassic"
      />,
    );
    const { colour, frame, colourBg } = tiles();
    expect(colour).toBe(want);
    expect(frame).toBe(want);
    expect(colourBg).toContain(`/frames/agclassic/${want}.webp`);
  });
});
