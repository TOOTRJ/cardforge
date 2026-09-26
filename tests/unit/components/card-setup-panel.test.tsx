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

// TODO 0.26: the full-art basic frame draws a name bar, a type bar and the
// big symbol over the art — nothing else. A nonbasic land's rules would
// print straight on the art, so its chip is disabled with the reason, and
// the Zendikar Rising hedron frame reads as its set, not "Full Art".
function LandHarness({
  verified,
  identity,
}: {
  verified: string[];
  identity: { title: string; supertype: string; subtypes_text: string; rules_text: string };
}) {
  const methods = useForm({
    defaultValues: {
      card_type: "land",
      frame_style: { template: "m15land" },
      color_identity: ["white"] as ColorIdentity[],
      ...identity,
    },
  });
  const color = useWatch({ control: methods.control, name: "color_identity" }) as ColorIdentity[];
  const template = useWatch({ control: methods.control, name: "frame_style.template" }) as string;
  return (
    <FormProvider {...methods}>
      <CardSetupPanel
        kind="land"
        colorIdentity={color}
        verifiedFrameKeys={verified}
        onKindSelect={() => {}}
      />
      <output data-testid="template">{template}</output>
    </FormProvider>
  );
}

const landVerified = [frameComboKey("m15land", "w"), frameComboKey("fullartland", "w")];
const fullArtBasicChip = () =>
  within(screen.getByRole("radiogroup", { name: /Frame variations/ })).getByRole("radio", {
    name: /Full Art — Basic Land/,
  }) as HTMLButtonElement;

describe("CardSetupPanel variation chips — full-art basic lands only", () => {
  it("disables the full-art basic frame for a nonbasic land, with the reason", () => {
    render(
      <LandHarness
        verified={landVerified}
        identity={{
          title: "Hallowed Fountain",
          supertype: "",
          subtypes_text: "Plains, Island",
          rules_text: "({T}: Add {W} or {U}.)",
        }}
      />,
    );
    const chip = fullArtBasicChip();
    expect(chip.disabled).toBe(true);
    expect(chip.textContent).toContain("Full-art basic frames are for basic lands");
    fireEvent.click(chip);
    expect(screen.getByTestId("template").textContent).toBe("m15land");
  });

  it("offers it to a basic land", () => {
    render(
      <LandHarness
        verified={landVerified}
        identity={{ title: "Plains", supertype: "Basic", subtypes_text: "Plains", rules_text: "" }}
      />,
    );
    const chip = fullArtBasicChip();
    expect(chip.disabled).toBe(false);
    expect(chip.textContent).not.toContain("for basic lands");
    fireEvent.click(chip);
    expect(screen.getByTestId("template").textContent).toBe("fullartland");
  });
});

describe("CardSetupPanel variation chips — Zendikar Rising hedron", () => {
  it("labels the fullart template as Zendikar Rising — Hedron, never Full Art", () => {
    render(
      <Harness
        verified={[frameComboKey("m15", "u"), frameComboKey("fullart", "u")]}
        onColor={vi.fn()}
      />,
    );
    const group = screen.getByRole("radiogroup", { name: /Frame variations/ });
    const chip = within(group).getByRole("radio", { name: /Hedron/ });
    expect(chip.textContent).toContain("Zendikar Rising — Hedron");
    expect(chip.textContent).not.toMatch(/Full Art/);
  });
});

// A server refusal of the frame (the 0.13 verification gate, the 0.26 kind
// gate) lands on frame_style and the wizard jumps to this step. It used to
// render nowhere: the step turned red with no reason.
function RefusedHarness() {
  const methods = useForm({
    defaultValues: {
      card_type: "land",
      frame_style: { template: "fullartland" },
      color_identity: ["white"] as ColorIdentity[],
      title: "Hallowed Fountain",
      supertype: "",
      subtypes_text: "Plains, Island",
      rules_text: "({T}: Add {W} or {U}.)",
    },
  });
  const color = useWatch({ control: methods.control, name: "color_identity" }) as ColorIdentity[];
  const template = useWatch({ control: methods.control, name: "frame_style.template" }) as string;
  return (
    <FormProvider {...methods}>
      <button
        type="button"
        onClick={() =>
          methods.setError("frame_style", {
            message: "Full-art basic frames are for basic lands — pick another frame.",
          })
        }
      >
        server refusal
      </button>
      <CardSetupPanel
        kind="land"
        colorIdentity={color}
        verifiedFrameKeys={landVerified}
        onKindSelect={() => {}}
      />
      <output data-testid="template">{template}</output>
    </FormProvider>
  );
}

describe("CardSetupPanel — a refused frame says why", () => {
  it("shows the server's frame_style error and clears it when a frame is picked", () => {
    render(<RefusedHarness />);
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "server refusal" }));
    expect(screen.getByRole("alert").textContent).toBe(
      "Full-art basic frames are for basic lands — pick another frame.",
    );
    fireEvent.click(
      within(screen.getByRole("radiogroup", { name: /Frame variations/ })).getByRole("radio", {
        name: /Standard/,
      }),
    );
    expect(screen.getByTestId("template").textContent).toBe("m15land");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
