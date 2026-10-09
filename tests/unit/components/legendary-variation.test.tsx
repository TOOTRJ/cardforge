// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { FormProvider, useForm, useWatch } from "react-hook-form";

// ---------------------------------------------------------------------------
// TODO 3b.17 — the Variations section's "Legendary" chip on the REAL frame
// profiles, beside the anatomy panel's "Legendary crown" switch:
//   • ONE state: the chip's pressed state and the switch's are the same
//     `frame_style.crown`, whichever is clicked; the chip never changes
//     `frame_style.template`;
//   • the word: picking it on a card that isn't legendary puts "Legendary"
//     FIRST in the supertype and says so; un-picking keeps the word; a card
//     typed Legendary starts selected (a new card) or as stored (an edit);
//   • a frame with no printed crown shows it disabled with the reason, and
//     the switch's value survives a round trip to such a frame and back;
//   • the live preview and the bake's asset list draw the crown the chip
//     switched on, for one frame of each crown family.
// The rules themselves: tests/unit/creator/legendary-variation.test.ts.
// ---------------------------------------------------------------------------

const toast = vi.hoisted(() => ({ info: vi.fn(), error: vi.fn(), success: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import { CardPreview, type CardPreviewData } from "@/components/cards/card-preview";
import { frameMasterKey } from "@/components/cards/frame-layer";
import { AnatomyPanel } from "@/components/creator/panels/anatomy-panel";
import { CardSetupPanel } from "@/components/creator/panels/card-setup-panel";
import { LEGENDARY_WORD_ADDED, LegendaryVariationChip } from "@/components/creator/panels/legendary-variation";
import { NEW_CARD_ANATOMY, frameAnatomyOf } from "@/lib/cards/anatomy";
import { dfcBodyOf } from "@/lib/cards/dfc";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import { getFrameProfile } from "@/lib/cards/template-layout";
import { kindFromCard, type CardKind } from "@/lib/creator/card-kinds";
import type { FormValues } from "@/lib/creator/form-types";
import { NO_CROWN_REASON, NOT_LEGENDARY_LOCKED_REASON, previewFrameStyleOf } from "@/lib/creator/legendary-variation";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { frameAssetPathsFor } from "@/lib/render/card-image";
import { FRAME_TEMPLATE_VALUES, type ColorIdentity, type FrameStyle, type FrameTemplate } from "@/types/card";

beforeEach(() => toast.info.mockClear());
afterEach(() => cleanup());

type HarnessProps = {
  /** An EDIT of a stored card (no Card step: the chip stands alone). */
  stored?: FrameStyle | null;
  template?: string;
  cardType?: string;
  supertype?: string;
  colors?: ColorIdentity[];
  cost?: string;
  kind?: CardKind;
  verified?: string[];
  backFace?: { card_type: string; supertype: string };
  preview?: boolean;
};

function Harness({
  stored = null,
  template = "m15",
  cardType = "creature",
  supertype = "",
  colors: seedColors = ["white"],
  cost = "{2}{W}",
  kind,
  verified = ["m15/w", "m15snow/w", "m15devoid/w", "m15borderless/w", "extendedart/w"],
  backFace,
  preview = false,
}: HarnessProps) {
  const frameStyle = (stored ?? { template, ...NEW_CARD_ANATOMY }) as FrameStyle;
  const methods = useForm<FormValues>({
    defaultValues: {
      card_type: cardType as FormValues["card_type"],
      supertype,
      cost,
      color_identity: seedColors,
      frame_style: frameStyle,
      title: "Kesh",
      subtypes_text: "",
      rules_text: "",
      ...(backFace ? { back_face: backFace } : {}),
    } as Partial<FormValues> as FormValues,
  });
  const [colors, style, word, type, back] = useWatch({
    control: methods.control,
    name: ["color_identity", "frame_style", "supertype", "card_type", "back_face.supertype"],
  });
  const data: CardPreviewData = {
    title: "Kesh",
    cost,
    cardType: type || null,
    supertype: word,
    colorIdentity: colors,
    frameStyle: style,
    brandMark: false,
  };
  return (
    <FormProvider {...methods}>
      {stored ? (
        <LegendaryVariationChip standalone />
      ) : (
        <CardSetupPanel
          kind={kind ?? kindFromCard(cardType as FormValues["card_type"], template as FrameTemplate)}
          colorIdentity={colors}
          verifiedFrameKeys={verified.map((k) => frameComboKey(k.split("/")[0] as FrameTemplate, k.split("/")[1]))}
          onKindSelect={() => {}}
        />
      )}
      <AnatomyPanel
        which={["crown"]}
        stored={stored ? { frameStyle: stored, colorIdentity: seedColors } : null}
      />
      {preview ? <CardPreview {...data} /> : null}
      <output data-testid="style">{JSON.stringify(style)}</output>
      <output data-testid="supertype">{word}</output>
      <output data-testid="back-supertype">{back ?? ""}</output>
      <output data-testid="assets">{preview ? frameAssetPathsFor(data).join("\n") : ""}</output>
    </FormProvider>
  );
}

const chip = () => within(screen.getByTestId("legendary-variation")).getByRole("button", { name: /^Legendary/ }) as HTMLButtonElement;
const crownSwitch = () => screen.queryByRole("switch", { name: "Legendary crown" });
const style = () => JSON.parse(screen.getByTestId("style").textContent ?? "{}") as Record<string, unknown>;
const supertype = () => screen.getByTestId("supertype").textContent;
const pressed = () => chip().getAttribute("aria-pressed");

describe("where it lives", () => {
  it("a new card: inside the Card step's Variations section, a toggle chip named Legendary", () => {
    render(<Harness />);
    const section = screen.getByTestId("variations-section");
    expect(within(section).getByTestId("legendary-variation")).toBeTruthy();
    expect(chip().tagName).toBe("BUTTON");
    expect(chip().disabled).toBe(false);
    expect(pressed()).toBe("false");
    // The section's own frame chips are still there, beside it.
    expect(within(section).getByRole("radiogroup", { name: "Frame variations" })).toBeTruthy();
  });

  it("a kind whose frame has no other variation still shows the section, for this entry", () => {
    render(<Harness template="saga" cardType="enchantment" kind="saga" verified={["saga/w"]} />);
    expect(within(screen.getByTestId("variations-section")).getByTestId("legendary-variation")).toBeTruthy();
  });

  it("an edit (no Card step): the chip stands alone under its own Variations caption", () => {
    render(<Harness stored={{ template: "m15", crown: true }} supertype="Legendary" />);
    expect(screen.queryByTestId("variations-section")).toBeNull();
    expect(screen.getByRole("group", { name: "Variations" })).toBeTruthy();
    expect(pressed()).toBe("true");
  });
});

describe("the word \"Legendary\"", () => {
  it("(a) picking it on a card that isn't legendary adds the word FIRST, says so, and draws the crown; un-picking keeps the word", () => {
    render(<Harness supertype="Snow" />);
    expect(pressed()).toBe("false");
    expect(crownSwitch()).toBeNull();
    fireEvent.click(chip());
    expect(supertype()).toBe("Legendary Snow");
    expect(toast.info).toHaveBeenCalledWith(LEGENDARY_WORD_ADDED);
    expect(pressed()).toBe("true");
    expect(style()).toMatchObject({ template: "m15", crown: true });
    // The anatomy panel's switch appeared, in step.
    expect(crownSwitch()?.getAttribute("aria-checked")).toBe("true");

    fireEvent.click(chip());
    expect(pressed()).toBe("false");
    expect(style()).toMatchObject({ template: "m15", crown: false });
    expect(supertype()).toBe("Legendary Snow");
    expect(crownSwitch()?.getAttribute("aria-checked")).toBe("false");
    // Back on: the word is there already — nothing is added or announced twice.
    fireEvent.click(chip());
    expect(supertype()).toBe("Legendary Snow");
    expect(toast.info).toHaveBeenCalledTimes(1);
    expect(pressed()).toBe("true");
  });

  it("(b) a NEW card typed Legendary starts selected (the new-card default: the crown on)", () => {
    render(<Harness supertype="Legendary" />);
    expect(pressed()).toBe("true");
    expect(crownSwitch()?.getAttribute("aria-checked")).toBe("true");
    expect(toast.info).not.toHaveBeenCalled();
  });

  it("(b) an EDIT reflects the stored value: an old crowned card selected; a legendary card stored before the crown, or with it off, not", () => {
    render(<Harness stored={{ template: "m15", crown: true }} supertype="Legendary" />);
    expect(pressed()).toBe("true");
    cleanup();
    render(<Harness stored={{ template: "m15" }} supertype="Legendary" />);
    expect(pressed()).toBe("false");
    expect(crownSwitch()?.getAttribute("aria-checked")).toBe("false");
    cleanup();
    render(<Harness stored={{ template: "m15", crown: false }} supertype="Legendary" />);
    expect(pressed()).toBe("false");
  });

  it("an edit of a legendary card stored before the crown: picking writes the switch alone", () => {
    render(<Harness stored={{ template: "m15" }} supertype="Legendary" />);
    fireEvent.click(chip());
    expect(style()).toEqual({ template: "m15", crown: true });
    expect(supertype()).toBe("Legendary");
    expect(toast.info).not.toHaveBeenCalled();
  });
});

describe("an edit of a card that is not legendary (the type line is locked)", () => {
  it("disabled with the reason: no word is written, no switch flips", () => {
    render(<Harness stored={{ template: "m15" }} supertype="Snow" />);
    expect(chip().disabled).toBe(true);
    expect(chip().textContent).toContain(NOT_LEGENDARY_LOCKED_REASON);
    fireEvent.click(chip());
    expect(supertype()).toBe("Snow");
    expect(style()).toEqual({ template: "m15" });
    expect(crownSwitch()).toBeNull();
  });
});

describe("one state with the anatomy panel's switch", () => {
  it("clicking either moves both, and neither touches the template", () => {
    render(<Harness supertype="Legendary" />);
    for (const click of [() => fireEvent.click(crownSwitch()!), () => fireEvent.click(chip()), () => fireEvent.click(chip()), () => fireEvent.click(crownSwitch()!)]) {
      const before = pressed();
      click();
      expect(pressed()).not.toBe(before);
      expect(crownSwitch()?.getAttribute("aria-checked")).toBe(pressed());
      expect(style().crown).toBe(pressed() === "true");
      expect(style().template).toBe("m15");
    }
  });

  it("on every template: the switch shows exactly when the chip is offered and the card is legendary, with the chip's value", () => {
    for (const template of FRAME_TEMPLATE_VALUES.filter((t) => dfcBodyOf(t)?.role !== "back")) {
      for (const crown of [true, false]) {
        render(<Harness stored={{ template, crown } as FrameStyle} supertype="Legendary" />);
        const offered = frameAnatomyOf(template).crown;
        expect(chip().disabled, template).toBe(!offered);
        if (offered) {
          expect(crownSwitch()?.getAttribute("aria-checked"), template).toBe(pressed());
          expect(pressed(), template).toBe(String(crown));
        } else {
          expect(crownSwitch(), template).toBeNull();
          expect(pressed(), template).toBe("false");
          expect(chip().textContent, template).toContain(NO_CROWN_REASON);
        }
        cleanup();
      }
    }
  });
});

describe("a frame with no printed crown", () => {
  it.each([
    ["m15pw", "planeswalker", "planeswalker"],
    ["saga", "enchantment", "saga"],
    ["m15token", "token", "token"],
    ["emblem", "emblem", "emblem"],
    ["retro", "creature", "creature"],
  ] as const)("%s: disabled, with the reason, and a click writes nothing", (template, cardType, kind) => {
    render(<Harness template={template} cardType={cardType} kind={kind} supertype="" verified={[`${template}/w`, `${template}/c`]} />);
    expect(chip().disabled).toBe(true);
    expect(chip().textContent).toContain(NO_CROWN_REASON);
    const before = screen.getByTestId("style").textContent;
    fireEvent.click(chip());
    expect(screen.getByTestId("style").textContent).toBe(before);
    expect(supertype()).toBe("");
    expect(toast.info).not.toHaveBeenCalled();
  });

  it("the switch survives a frame round trip: Standard → Devoid (no crown: disabled) → Standard restores it", () => {
    render(<Harness supertype="Legendary" />);
    expect(pressed()).toBe("true");
    const variations = () => screen.getByRole("radiogroup", { name: "Frame variations" });
    fireEvent.click(within(variations()).getByRole("radio", { name: /Devoid/i }));
    expect(style().template).toBe("m15devoid");
    expect(chip().disabled).toBe(true);
    expect(pressed()).toBe("false");
    expect(crownSwitch()).toBeNull();
    // The stored value is untouched while the frame can't draw it.
    expect(style().crown).toBe(true);
    fireEvent.click(within(variations()).getByRole("radio", { name: /^Standard/i }));
    expect(style().template).toBe("m15");
    expect(pressed()).toBe("true");
    expect(crownSwitch()?.getAttribute("aria-checked")).toBe("true");
  });

  it("…and an OFF survives it too, and a move onto another crowned frame keeps the selection", () => {
    render(<Harness supertype="Legendary" />);
    fireEvent.click(chip());
    expect(pressed()).toBe("false");
    const variations = () => screen.getByRole("radiogroup", { name: "Frame variations" });
    fireEvent.click(within(variations()).getByRole("radio", { name: /Devoid/i }));
    fireEvent.click(within(variations()).getByRole("radio", { name: /^Snow/i }));
    expect(style()).toMatchObject({ template: "m15snow", crown: false });
    expect(pressed()).toBe("false");
    fireEvent.click(chip());
    fireEvent.click(within(variations()).getByRole("radio", { name: /^Standard/i }));
    expect(style()).toMatchObject({ template: "m15", crown: true });
    expect(pressed()).toBe("true");
  });
});

describe("a double-faced card", () => {
  it("neither face legendary: the word goes to the FRONT's supertype", () => {
    render(
      <Harness template="m15dfcfront" kind="transform" verified={["m15dfcfront/w"]} backFace={{ card_type: "creature", supertype: "" }} />,
    );
    fireEvent.click(chip());
    expect(supertype()).toBe("Legendary");
    expect(screen.getByTestId("back-supertype").textContent).toBe("");
    expect(pressed()).toBe("true");
  });

  it("a legendary back alone is a drawn crown: selected, and un-picking writes no word anywhere", () => {
    render(
      <Harness template="m15dfcfront" kind="transform" verified={["m15dfcfront/w"]} backFace={{ card_type: "creature", supertype: "Legendary" }} />,
    );
    expect(pressed()).toBe("true");
    expect(crownSwitch()?.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(chip());
    fireEvent.click(chip());
    expect(supertype()).toBe("");
    expect(screen.getByTestId("back-supertype").textContent).toBe("Legendary");
    expect(toast.info).not.toHaveBeenCalled();
  });
});

describe("the preview and the bake draw the crown the chip switched on", () => {
  // One frame of each crown family: the standard band (m15 / artifact /
  // land), the snow frames' (the same band), extended art's floating band,
  // the borderless frames' crowned twin masters, and the double-faced
  // bodies' bands cut round the well (transform) and the housing (modal).
  it.each([
    ["m15", "creature", "creature", "m15crown/w"],
    ["m15artifact", "artifact", "artifact", "m15crown/w"],
    ["m15land", "land", "land", "m15crown/w"],
    ["m15snow", "creature", "creature", "m15crown/w"],
    ["extendedart", "creature", "creature", "extendedcrown/w"],
    ["m15dfcfront", "creature", "transform", "m15dfccrown/w"],
    ["m15mdfcfront", "creature", "mdfc", "m15mdfccrown/w"],
  ] as const)("%s (a %s): the band is in the preview and in the bake's assets only once picked", (template, cardType, kind, band) => {
    render(
      <Harness
        preview
        template={template}
        cardType={cardType}
        kind={kind}
        cost={cardType === "land" ? "" : "{2}{W}"}
        verified={[`${template}/w`]}
        backFace={kind === "transform" || kind === "mdfc" ? { card_type: "creature", supertype: "" } : undefined}
      />,
    );
    const crownInPreview = () => document.querySelector<HTMLElement>('[data-frame-overlay="crown"]');
    const assets = () => screen.getByTestId("assets").textContent ?? "";
    expect(crownInPreview()).toBeNull();
    expect(assets()).not.toContain(band);
    fireEvent.click(chip());
    expect(crownInPreview()?.dataset.overlayKey).toBe("w");
    expect(assets()).toContain(`${band}.png`);
    expect(style().template).toBe(template);
    fireEvent.click(chip());
    expect(crownInPreview()).toBeNull();
    expect(assets()).not.toContain(band);
  });

  it("m15borderless: the crown is the master's crowned twin — picked, both renderers paint w-legendary", () => {
    render(<Harness preview template="m15borderless" verified={["m15borderless/w", "m15/w"]} />);
    const master = () =>
      frameMasterKey(getFrameProfile("m15borderless"), ["white"], { cardType: "creature", supertype: supertype() }, style() as FrameStyle);
    // The live preview's frame layer paints the same key.
    const painted = () => document.body.innerHTML.includes("m15borderless/w-legendary");
    expect(master()).toBe("w");
    expect(painted()).toBe(false);
    fireEvent.click(chip());
    expect(master()).toBe("w-legendary");
    expect(painted()).toBe(true);
    expect(style().template).toBe("m15borderless");
  });
});

describe("a modal LAND front with a legendary back: the preview draws what the save keeps", () => {
  // The save drops the crown switch there (normalizeAnatomy: m15mdfclandfront
  // draws none), the entry and the switch's row are off — but a new card's
  // switch starts ON and the back's body (m15mdfcback) declares the crown, so
  // the raw form style previewed a crown the saved image never had.
  const card = (frameStyle: FrameStyle): CardPreviewData & { face: "back" } => ({
    title: "Shore",
    cardType: "land",
    supertype: null,
    colorIdentity: ["red"],
    frameStyle,
    brandMark: false,
    backFace: {
      title: "Kesh",
      card_type: "creature",
      supertype: "Legendary",
      frame_style: { template: "m15mdfcback" },
      color_identity: ["red"],
    } as CardPreviewData["backFace"],
    face: "back",
  });
  const formStyle = { template: "m15mdfclandfront", ...NEW_CARD_ANATOMY } as FrameStyle;
  const crownInPreview = () => document.querySelector('[data-frame-overlay="crown"]');

  it("the form's raw style would draw the back's crown; the previewed style draws none", () => {
    render(<CardPreview {...card(formStyle)} />);
    expect(crownInPreview()).not.toBeNull();
    cleanup();
    render(<CardPreview {...card(previewFrameStyleOf(formStyle))} />);
    expect(crownInPreview()).toBeNull();
  });

  it("a modal NONLAND front keeps its legendary back's crown (the save keeps the switch)", () => {
    const style = { template: "m15mdfcfront", ...NEW_CARD_ANATOMY } as FrameStyle;
    render(<CardPreview {...card(previewFrameStyleOf(style))} cardType="creature" />);
    expect(crownInPreview()).not.toBeNull();
  });

  it("the creator's live preview is fed through it", () => {
    const form = readFileSync(join(process.cwd(), "components/creator/card-creator-form.tsx"), "utf8");
    expect(form).toContain("frameStyle: previewFrameStyleOf(watched.frame_style),");
    expect(form).not.toMatch(/frameStyle: watched\.frame_style,/);
  });
});
