// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { FormProvider, useForm, useWatch } from "react-hook-form";

// ---------------------------------------------------------------------------
// TODO 4.6.0 — the creator's anatomy switches and the "Two colours" row,
// with the anatomy 4.6a / 4.6b will declare (tests/unit/cards/
// anatomy-fixture.ts). Owner decisions 2026-09-29: a new card starts with
// every switch on; a stored card shows it off with a one-line hint (no
// badge, no notification); the pair is picked in a "Two colours" row under
// Multicolor, pre-filled from the cost's pips; a stored multicolour card
// gets the pair pre-filled only when its owner switches two-colour on, and
// a stored card is never re-coloured.
// ---------------------------------------------------------------------------

vi.mock("sonner", () => ({ toast: { info: vi.fn(), error: vi.fn(), success: vi.fn() } }));
vi.mock("@/lib/cards/template-layout", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/cards/template-layout")>();
  const { declaredGetFrameProfile } = await import("../cards/anatomy-fixture");
  return { ...real, getFrameProfile: declaredGetFrameProfile(real.getFrameProfile) };
});

import { ANATOMY_HINTS, AnatomyPanel, useTwoColorPairFollow } from "@/components/creator/panels/anatomy-panel";
import { CardSetupPanel } from "@/components/creator/panels/card-setup-panel";
import { NEW_CARD_ANATOMY } from "@/lib/cards/anatomy";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import type { FormValues } from "@/lib/creator/form-types";
import type { ColorIdentity, FrameStyle } from "@/types/card";

afterEach(() => cleanup());

type Seed = {
  template?: string;
  frameStyle?: FrameStyle;
  supertype?: string;
  cardType?: string;
  cost?: string;
  colors?: ColorIdentity[];
};

/** A form with the fields the panels read, plus readouts of what they write. */
function Harness({
  seed,
  stored = null,
  which = ["crown", "twoColor"],
  follow = false,
  setup = false,
}: {
  seed: Seed;
  stored?: { frameStyle: FrameStyle | null; colorIdentity: ColorIdentity[] } | null;
  which?: ("crown" | "twoColor")[];
  follow?: boolean;
  /** The Card step of a new card: the Colour section, and the anatomy
   *  panel without its own pair row (as the creator renders them). */
  setup?: boolean;
}) {
  const methods = useForm<FormValues>({
    defaultValues: {
      card_type: (seed.cardType ?? "creature") as FormValues["card_type"],
      supertype: seed.supertype ?? "",
      cost: seed.cost ?? "",
      color_identity: seed.colors ?? ["white"],
      frame_style: seed.frameStyle ?? { template: (seed.template ?? "m15") as FrameStyle["template"] },
      title: "",
      subtypes_text: "",
    } as Partial<FormValues> as FormValues,
  });
  const markTouched = useTwoColorPairFollow(methods, follow);
  const [colors, frameStyle, cardType] = useWatch({
    control: methods.control,
    name: ["color_identity", "frame_style", "card_type"],
  });
  return (
    <FormProvider {...methods}>
      {setup ? (
        <CardSetupPanel
          kind="creature"
          colorIdentity={colors}
          verifiedFrameKeys={["w", "u", "b", "r", "g", "c", "m"].map((k) => frameComboKey("m15", k))}
          onKindSelect={() => {}}
          onPairTouched={markTouched}
        />
      ) : null}
      <AnatomyPanel which={which} stored={stored} onPairTouched={markTouched} pairRow={!setup} />
      <output data-testid="colors">{colors.join(",")}</output>
      <output data-testid="style">{JSON.stringify(frameStyle)}</output>
      <output data-testid="type">{cardType}</output>
      <input aria-label="cost" value={useWatch({ control: methods.control, name: "cost" })} onChange={(e) => methods.setValue("cost", e.target.value)} />
      <input
        aria-label="template"
        value={frameStyle?.template ?? ""}
        onChange={(e) => methods.setValue("frame_style.template", e.target.value as FrameStyle["template"])}
      />
    </FormProvider>
  );
}

const style = () => JSON.parse(screen.getByTestId("style").textContent ?? "{}");
const colors = () => screen.getByTestId("colors").textContent;
const crownSwitch = () => screen.queryByRole("switch", { name: "Legendary crown" });
const twoColorSwitch = () => screen.queryByRole("switch", { name: "Two-colour frame" });

describe("the crown switch", () => {
  it("a new card: on, shown for a Legendary card on a frame that draws it, no hint", () => {
    render(<Harness seed={{ supertype: "Legendary", frameStyle: { template: "m15", ...NEW_CARD_ANATOMY } }} which={["crown"]} />);
    expect(crownSwitch()?.getAttribute("aria-checked")).toBe("true");
    expect(screen.queryByTestId("anatomy-hint-crown")).toBeNull();
    fireEvent.click(crownSwitch()!);
    expect(style()).toMatchObject({ crown: false });
  });

  it("hidden where it can't draw: not Legendary, a planeswalker, a frame without the crown", () => {
    for (const seed of [
      { supertype: "", frameStyle: { template: "m15" as const, crown: true } },
      { supertype: "Lengendary", frameStyle: { template: "m15" as const, crown: true } },
      { supertype: "Legendary", cardType: "planeswalker", frameStyle: { template: "m15pw" as const, crown: true } },
      { supertype: "Legendary", frameStyle: { template: "m15snow" as const, crown: true } },
    ]) {
      render(<Harness seed={seed} which={["crown"]} />);
      expect(crownSwitch(), JSON.stringify(seed)).toBeNull();
      cleanup();
    }
  });

  it("a stored card with no key: off, with the one-line hint; switching it on removes the hint", () => {
    render(
      <Harness
        seed={{ supertype: "Legendary", frameStyle: { template: "m15", finish: "foil" } }}
        stored={{ frameStyle: { template: "m15", finish: "foil" }, colorIdentity: ["white"] }}
      />,
    );
    expect(crownSwitch()?.getAttribute("aria-checked")).toBe("false");
    expect(screen.getByTestId("anatomy-hint-crown").textContent).toBe(ANATOMY_HINTS.crown);
    fireEvent.click(crownSwitch()!);
    expect(style()).toEqual({ template: "m15", finish: "foil", crown: true });
    expect(screen.queryByTestId("anatomy-hint-crown")).toBeNull();
  });

  it("a stored card its owner switched off: off, no hint", () => {
    render(
      <Harness
        seed={{ supertype: "Legendary", frameStyle: { template: "m15", crown: false } }}
        stored={{ frameStyle: { template: "m15", crown: false }, colorIdentity: ["white"] }}
      />,
    );
    expect(crownSwitch()?.getAttribute("aria-checked")).toBe("false");
    expect(screen.queryByTestId("anatomy-hint-crown")).toBeNull();
  });
});

describe("the two-colour switch on a stored card", () => {
  it("a stored multicolour card: off with the hint; switching on pre-fills the pair from the cost for the owner to confirm", () => {
    render(
      <Harness
        seed={{ colors: ["multicolor"], cost: "{1}{W}{U}", frameStyle: { template: "m15" } }}
        stored={{ frameStyle: { template: "m15" }, colorIdentity: ["multicolor"] }}
        which={["twoColor"]}
      />,
    );
    expect(twoColorSwitch()?.getAttribute("aria-checked")).toBe("false");
    expect(screen.getByTestId("anatomy-hint-twoColor").textContent).toBe(ANATOMY_HINTS.twoColor);
    expect(colors()).toBe("multicolor");
    fireEvent.click(twoColorSwitch()!);
    expect(style()).toMatchObject({ twoColor: true });
    expect(colors()).toBe("white,blue");
    // The row, pre-filled, for the owner to change: a third colour waits
    // until one is taken off.
    const row = screen.getByTestId("two-colour-row");
    fireEvent.click(within(row).getByRole("button", { name: /black/i }));
    expect(colors()).toBe("white,blue");
    fireEvent.click(within(row).getByRole("button", { name: /blue/i }));
    expect(colors()).toBe("multicolor");
    fireEvent.click(within(row).getByRole("button", { name: /black/i }));
    expect(colors()).toBe("white,black");
  });

  it("a stored multicolour land (no cost): switching on shows an empty row to pick from", () => {
    render(
      <Harness
        seed={{ colors: ["multicolor"], cardType: "land", frameStyle: { template: "m15land" } }}
        stored={{ frameStyle: { template: "m15land" }, colorIdentity: ["multicolor"] }}
        which={["twoColor"]}
      />,
    );
    fireEvent.click(twoColorSwitch()!);
    expect(colors()).toBe("multicolor");
    const row = screen.getByTestId("two-colour-row");
    fireEvent.click(within(row).getByRole("button", { name: /^white$/i }));
    fireEvent.click(within(row).getByRole("button", { name: /^blue$/i }));
    expect(colors()).toBe("white,blue");
  });

  it("a stored pair keeps its colours: the switch, no row", () => {
    render(
      <Harness
        seed={{ colors: ["white", "black"], cost: "{1}{W}{B}", frameStyle: { template: "m15" } }}
        stored={{ frameStyle: { template: "m15" }, colorIdentity: ["white", "black"] }}
        which={["twoColor"]}
      />,
    );
    fireEvent.click(twoColorSwitch()!);
    expect(style()).toMatchObject({ twoColor: true });
    expect(screen.queryByTestId("two-colour-row")).toBeNull();
    expect(colors()).toBe("white,black");
  });

  it("offered (switch + hint) only where it can apply: a pair, or plain Multicolor with a two-colour cost or none (4.6 review)", () => {
    const cases: [ColorIdentity[], string, boolean][] = [
      [["white", "blue"], "{1}{W}{U}", true],
      [["blue", "white", "multicolor"], "{1}{W}{U}", true], // the AI's letters: the pair
      [["multicolor"], "{2}{B}{G}", true], // the pair switching it on pre-fills
      [["multicolor"], "", true], // no cost: only the row can name the pair
      [["multicolor"], "{3}", true], // no coloured pip either
      // Where it could never apply:
      [["white", "blue", "black"], "{W}{U}{B}", false], // three colour words
      [["white", "blue", "black", "red", "green"], "{W}{U}{B}{R}{G}", false],
      [["multicolor"], "{1}{W}{U}{B}", false], // a three-colour cost: switching on would offer a pair it contradicts
      [["multicolor"], "{W}{U}{B}{R}{G}", false],
      [["multicolor"], "{2}{G}{G}", false], // a one-colour cost
      [["red", "multicolor"], "{1}{R}{G}", false], // an explicit colour word is never overridden
    ];
    for (const [identity, cost, offered] of cases) {
      render(
        <Harness
          seed={{ colors: identity, cost, frameStyle: { template: "m15" } }}
          stored={{ frameStyle: { template: "m15" }, colorIdentity: identity }}
          which={["twoColor"]}
        />,
      );
      const label = `${identity.join(",")} ${cost}`;
      expect(twoColorSwitch() !== null, label).toBe(offered);
      expect(screen.queryByTestId("anatomy-hint-twoColor") !== null, label).toBe(offered);
      cleanup();
    }
  });

  it("never offered (switch or hint) for a LAND on a nonland frame — Shadowwood Hollow on m15 (owner round 17, 2026-09-30)", () => {
    // Shadowwood Hollow / Sunfade Citadel: two-colour lands stored with no
    // template (drawn on m15). The crown switch still shows for a Legendary one.
    // The dev seed's Duskmire Thicket (owner pick (c), 2026-09-30) stores its
    // pair the AI's way, with "multicolor" after the two words.
    const identities: ColorIdentity[][] = [["black", "green"], ["black", "green", "multicolor"]];
    for (const colors of identities) {
      for (const frameStyle of [{}, { template: "m15" }, { template: "m15artifact" }] as FrameStyle[]) {
        render(
          <Harness
            seed={{ colors, cardType: "land", supertype: "Legendary", frameStyle }}
            stored={{ frameStyle, colorIdentity: colors }}
          />,
        );
        const label = `${colors.join(",")} ${JSON.stringify(frameStyle)}`;
        expect(twoColorSwitch(), label).toBeNull();
        expect(screen.queryByTestId("anatomy-hint-twoColor"), label).toBeNull();
        expect(crownSwitch(), label).not.toBeNull();
        cleanup();
      }
    }
    // A plain Multicolor land on m15 neither.
    render(
      <Harness
        seed={{ colors: ["multicolor"], cardType: "land", frameStyle: { template: "m15" } }}
        stored={{ frameStyle: { template: "m15" }, colorIdentity: ["multicolor"] }}
        which={["twoColor"]}
      />,
    );
    expect(twoColorSwitch()).toBeNull();
    cleanup();
    // On the land frame it is offered, with its hint.
    render(
      <Harness
        seed={{ colors: ["black", "green"], cardType: "land", frameStyle: { template: "m15land" } }}
        stored={{ frameStyle: { template: "m15land" }, colorIdentity: ["black", "green"] }}
        which={["twoColor"]}
      />,
    );
    expect(twoColorSwitch()).not.toBeNull();
    expect(screen.queryByTestId("anatomy-hint-twoColor")).not.toBeNull();
  });

  it("never offered on a mono card, whatever its cost (an explicit black {3}{U}{B} stays black)", () => {
    render(
      <Harness
        seed={{ colors: ["black"], cost: "{3}{U}{B}", frameStyle: { template: "m15" } }}
        stored={{ frameStyle: { template: "m15" }, colorIdentity: ["black"] }}
        which={["twoColor"]}
      />,
    );
    expect(twoColorSwitch()).toBeNull();
    expect(colors()).toBe("black");
  });
});

describe("a new card's Two colours row (Card step)", () => {
  it("shows under Multicolor and pre-fills from the cost; follows the cost until picked by hand", async () => {
    render(<Harness seed={{ colors: ["white"], cost: "{1}{W}{U}", frameStyle: { template: "m15", ...NEW_CARD_ANATOMY } }} setup follow which={["twoColor"]} />);
    expect(screen.queryByTestId("two-colour-row")).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: /multicolor/i }));
    expect(colors()).toBe("white,blue");
    // ONE row, the Colour section's (the anatomy panel's switch has none here).
    expect(screen.getAllByTestId("two-colour-row")).toHaveLength(1);
    expect(twoColorSwitch()?.getAttribute("aria-checked")).toBe("true");
    // The cost changes: the pre-filled pair follows it.
    await act(async () => {
      fireEvent.change(screen.getByLabelText("cost"), { target: { value: "{1}{U}{R}" } });
    });
    expect(colors()).toBe("blue,red");
    // A pick by hand ends it.
    const row = screen.getAllByTestId("two-colour-row")[0];
    fireEvent.click(within(row).getByRole("button", { name: /^red$/i }));
    expect(colors()).toBe("multicolor");
    await act(async () => {
      fireEvent.change(screen.getByLabelText("cost"), { target: { value: "{1}{W}{U}" } });
    });
    expect(colors()).toBe("multicolor");
  });

  it("a pair the cost filled goes back to plain multicolor when the frame stops drawing pairs (Dragon Wing); a hand-picked pair stays", async () => {
    render(<Harness seed={{ colors: ["multicolor"], cost: "{1}{W}{U}", frameStyle: { template: "m15", ...NEW_CARD_ANATOMY } }} follow which={["twoColor"]} />);
    expect(colors()).toBe("white,blue");
    await act(async () => {
      fireEvent.change(screen.getByLabelText("template"), { target: { value: "tarkirdragon" } });
    });
    expect(colors()).toBe("multicolor");
    // Back on a frame that draws pairs: filled from the cost again.
    await act(async () => {
      fireEvent.change(screen.getByLabelText("template"), { target: { value: "m15" } });
    });
    expect(colors()).toBe("white,blue");
    cleanup();

    // Picked by hand in the row: the owner's choice, kept on any frame.
    render(<Harness seed={{ colors: ["multicolor"], cost: "", frameStyle: { template: "m15", ...NEW_CARD_ANATOMY } }} follow which={["twoColor"]} />);
    const row = screen.getByTestId("two-colour-row");
    fireEvent.click(within(row).getByRole("button", { name: /^white$/i }));
    fireEvent.click(within(row).getByRole("button", { name: /^black$/i }));
    expect(colors()).toBe("white,black");
    await act(async () => {
      fireEvent.change(screen.getByLabelText("template"), { target: { value: "tarkirdragon" } });
    });
    expect(colors()).toBe("white,black");
  });

  it("a mono card's cost never re-colours it", async () => {
    render(<Harness seed={{ colors: ["black"], cost: "{3}{U}{B}", frameStyle: { template: "m15" } }} follow which={["twoColor"]} />);
    await act(async () => {
      fireEvent.change(screen.getByLabelText("cost"), { target: { value: "{2}{U}{B}" } });
    });
    expect(colors()).toBe("black");
  });

  it("the edit of a stored card never follows the cost", async () => {
    render(
      <Harness
        seed={{ colors: ["multicolor"], cost: "{1}{W}{U}", frameStyle: { template: "m15" } }}
        stored={{ frameStyle: { template: "m15" }, colorIdentity: ["multicolor"] }}
        follow={false}
        which={["twoColor"]}
      />,
    );
    await act(async () => {
      fireEvent.change(screen.getByLabelText("cost"), { target: { value: "{1}{U}{R}" } });
    });
    expect(colors()).toBe("multicolor");
  });
});
