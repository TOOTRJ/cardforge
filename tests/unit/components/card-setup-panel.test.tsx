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
  const supertypeNow = useWatch({ control: methods.control, name: "supertype" }) as string;
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
      <output data-testid="supertype">{supertypeNow}</output>
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
    name: /Full Art — Borderless Basic Land/,
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

describe("CardSetupPanel — the artifact frame is a creature variation (TODO 1.7)", () => {
  const verified = [frameComboKey("m15", "c"), frameComboKey("m15artifact", "c")];
  const variations = () => screen.getByRole("radiogroup", { name: /Frame variations/ });
  const m15Standard = () =>
    within(screen.getByRole("radiogroup", { name: /M15 \(2015\) frames/ })).getByRole("radio", {
      name: /Standard/,
    });

  it("offers Artifact under a creature's M15 frame, and the Frame section stays on M15", () => {
    render(
      <Harness
        verified={verified}
        onColor={vi.fn()}
        initialColor="colorless"
        supertype="Artifact"
      />,
    );
    const chip = within(variations()).getByRole("radio", { name: /^Artifact/ });
    expect(chip.textContent).toContain("For Artifact Creatures");
    fireEvent.click(chip);
    expect(screen.getByTestId("template").textContent).toBe("m15artifact");
    expect(chip.getAttribute("aria-checked")).toBe("true");
    // The base is still M15's Standard — not a "Current frame" legacy pin.
    expect(screen.queryByRole("radiogroup", { name: "Current frame" })).toBeNull();
    expect(m15Standard().getAttribute("aria-checked")).toBe("true");
  });

  it("picking it makes a plain creature an Artifact Creature, and leaving it undoes that", () => {
    render(
      <Harness
        verified={verified}
        onColor={vi.fn()}
        initialColor="colorless"
        supertype="Legendary"
      />,
    );
    fireEvent.click(within(variations()).getByRole("radio", { name: /^Artifact/ }));
    expect(screen.getByTestId("template").textContent).toBe("m15artifact");
    expect(screen.getByTestId("supertype").textContent).toBe("Legendary Artifact");
    // Back to Standard: the word the chip added comes out again.
    fireEvent.click(within(variations()).getByRole("radio", { name: /Standard/ }));
    expect(screen.getByTestId("template").textContent).toBe("m15");
    expect(screen.getByTestId("supertype").textContent).toBe("Legendary");
  });

  it("never touches an Artifact word the card already had", () => {
    render(
      <Harness
        verified={verified}
        onColor={vi.fn()}
        initialColor="colorless"
        supertype="Artifact"
      />,
    );
    fireEvent.click(within(variations()).getByRole("radio", { name: /^Artifact/ }));
    expect(screen.getByTestId("supertype").textContent).toBe("Artifact");
    fireEvent.click(within(variations()).getByRole("radio", { name: /Standard/ }));
    expect(screen.getByTestId("supertype").textContent).toBe("Artifact");
  });

  it("an imported Artifact Creature on m15artifact opens on that variation", () => {
    render(
      <Harness
        verified={verified}
        onColor={vi.fn()}
        initialColor="colorless"
        supertype="Artifact"
        initialTemplate="m15artifact"
      />,
    );
    expect(screen.queryByRole("radiogroup", { name: "Current frame" })).toBeNull();
    expect(
      within(variations()).getByRole("radio", { name: /^Artifact/ }).getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("an Artifact card has no borrowed chip: m15artifact is its own standard", () => {
    render(
      <Harness
        verified={verified}
        onColor={vi.fn()}
        initialColor="colorless"
        cardType="artifact"
        initialTemplate="m15artifact"
      />,
    );
    expect(document.body.textContent).not.toContain("For Artifact Creatures");
    const artifactStandard = within(
      screen.getByRole("radiogroup", { name: /M15 \(2015\) frames/ }),
    ).getByRole("radio", { name: /Artifact/ });
    expect(artifactStandard.getAttribute("aria-checked")).toBe("true");
  });
});

// Frames plan 4.32 / 4.39: the new frames sit in the Variations of the frame
// they re-dress, gated on verification like every frame — nothing is
// offered until the owner ticks it in /admin/frame-compare.
describe("CardSetupPanel — the borderless M15 frame and the black-bordered full-art basic", () => {
  const variations = () => screen.getByRole("radiogroup", { name: /Frame variations/ });

  it("offers Borderless under a creature's M15 frame, awaiting verification until verified", () => {
    render(<Harness verified={[frameComboKey("m15", "u")]} onColor={vi.fn()} />);
    const chip = within(variations()).getByRole("radio", { name: /^Borderless(?! Artifact)/ }) as HTMLButtonElement;
    expect(chip.disabled).toBe(true);
    expect(chip.textContent).toContain("Awaiting verification");
    cleanup();
    render(
      <Harness verified={[frameComboKey("m15", "u"), frameComboKey("m15borderless", "u")]} onColor={vi.fn()} />,
    );
    const live = within(variations()).getByRole("radio", { name: /^Borderless(?! Artifact)/ }) as HTMLButtonElement;
    expect(live.disabled).toBe(false);
    fireEvent.click(live);
    expect(screen.getByTestId("template").textContent).toBe("m15borderless");
  });

  it("offers the black-bordered full-art basic to a basic land and refuses it on a nonbasic", () => {
    const verified = [frameComboKey("m15land", "w"), frameComboKey("m15fullartland", "w")];
    const chip = () =>
      within(variations()).getByRole("radio", { name: /^Full Art — Basic Land/ }) as HTMLButtonElement;
    render(
      <LandHarness
        verified={verified}
        identity={{ title: "Plains", supertype: "Basic", subtypes_text: "Plains", rules_text: "" }}
      />,
    );
    expect(chip().disabled).toBe(false);
    fireEvent.click(chip());
    expect(screen.getByTestId("template").textContent).toBe("m15fullartland");
    cleanup();
    render(
      <LandHarness
        verified={verified}
        identity={{
          title: "Hallowed Fountain",
          supertype: "",
          subtypes_text: "Plains, Island",
          rules_text: "({T}: Add {W} or {U}.)",
        }}
      />,
    );
    expect(chip().disabled).toBe(true);
    expect(chip().textContent).toContain("Full-art basic frames are for basic lands");
  });
});
