// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FormProvider, useForm, useFormContext, useWatch } from "react-hook-form";
import { AbilitiesPanel } from "@/components/creator/panels/abilities-panel";
import { PtNotDrawnNote } from "@/components/creator/pt-not-drawn-note";
import { BackFaceStatsFields } from "@/components/creator/panels/back-face-panels";
import { SecondPartStatsFields } from "@/components/creator/panels/second-part-panels";
import { PT_NOT_DRAWN_NOTE } from "@/lib/cards/pt-drawn";
import { EMPTY_BACK_FACE, type FormValues } from "@/lib/creator/form-types";
import { parseSubtypes } from "@/lib/creator/card-fields";
import { statVisibility } from "@/lib/creator/steps";

// ---------------------------------------------------------------------------
// The one line under the power / toughness inputs when the card's frame
// draws none (owner 2026-10-09). The front's sits in the Abilities panel
// beside the inputs the card's TYPE shows (statVisibility, as the creator
// computes it); it reads the frame from the form, so it follows a frame
// switch live. The second face's is the same component.
// ---------------------------------------------------------------------------

afterEach(() => cleanup());

/** The frame picker's stand-in: writes the card's template as a pick does. */
function FramePick() {
  const { setValue } = useFormContext<FormValues>();
  return (
    <input
      aria-label="Frame"
      defaultValue=""
      onChange={(event) =>
        setValue("frame_style.template", event.target.value as FormValues["frame_style"]["template"], { shouldDirty: true })
      }
    />
  );
}

function defaults(over: Partial<FormValues>): FormValues {
  return {
    card_type: "creature",
    supertype: "",
    subtypes_text: "",
    power: "",
    toughness: "",
    frame_style: { template: "m15" },
    back_face: { ...EMPTY_BACK_FACE },
    ...over,
  } as Partial<FormValues> as FormValues;
}

function FrontHarness({ values }: { values: Partial<FormValues> }) {
  const methods = useForm<FormValues>({ defaultValues: defaults(values) });
  const [cardType, subtypes, supertype] = useWatch({
    control: methods.control,
    name: ["card_type", "subtypes_text", "supertype"],
  });
  return (
    <FormProvider {...methods}>
      <FramePick />
      <AbilitiesPanel statVis={statVisibility(cardType, parseSubtypes(subtypes ?? ""), supertype)} />
    </FormProvider>
  );
}

function SecondHarness({
  values,
  backBody = null,
  onlyWithValue = false,
}: {
  values: Partial<FormValues>;
  backBody?: string | null;
  onlyWithValue?: boolean;
}) {
  const methods = useForm<FormValues>({ defaultValues: defaults(values) });
  return (
    <FormProvider {...methods}>
      <FramePick />
      <input aria-label="Back power" {...methods.register("back_face.power")} />
      <PtNotDrawnNote face="second" backBody={backBody} onlyWithValue={onlyWithValue} />
    </FormProvider>
  );
}

const note = () => screen.queryByText(PT_NOT_DRAWN_NOTE);
const setTemplate = (template: string) => fireEvent.change(screen.getByLabelText("Frame"), { target: { value: template } });

describe("the front's note, in the Abilities panel", () => {
  it("a saga whose type says Creature (Summon: Bahamut): the inputs AND the note", () => {
    render(
      <FrontHarness
        values={{ card_type: "enchantment", supertype: "Creature", subtypes_text: "Saga Dragon", power: "9", toughness: "9", frame_style: { template: "saga" } }}
      />,
    );
    expect(screen.getByText("Power")).toBeTruthy();
    expect(screen.getByText("Toughness")).toBeTruthy();
    expect(note()).toBeTruthy();
    expect(note()?.getAttribute("data-testid")).toBe("pt-not-drawn-note-front");
  });

  it("a creature on m15: the inputs, no note", () => {
    render(<FrontHarness values={{ card_type: "creature", power: "2", toughness: "2" }} />);
    expect(screen.getByText("Power")).toBeTruthy();
    expect(note()).toBeNull();
  });

  it("follows a frame switch live, both ways", () => {
    render(<FrontHarness values={{ card_type: "enchantment", supertype: "Creature", frame_style: { template: "m15" } }} />);
    expect(note()).toBeNull();
    setTemplate("saga");
    expect(note()).toBeTruthy();
    setTemplate("nyx");
    expect(note()).toBeNull();
    setTemplate("m15pw");
    expect(note()).toBeTruthy();
  });

  it("no P/T inputs (a plain saga, an instant): no note, whatever the frame", () => {
    render(<FrontHarness values={{ card_type: "enchantment", supertype: "", frame_style: { template: "saga" } }} />);
    expect(screen.queryByText("Power")).toBeNull();
    expect(note()).toBeNull();
  });
});

describe("the second face's note", () => {
  it("a double-faced card's back: the BODY decides (a land back has no slot)", () => {
    const { unmount } = render(<SecondHarness values={{ frame_style: { template: "m15mdfcfront" } }} backBody="m15mdfclandback" />);
    expect(note()?.getAttribute("data-testid")).toBe("pt-not-drawn-note-second");
    unmount();
    render(<SecondHarness values={{ frame_style: { template: "m15mdfcfront" } }} backBody="m15mdfcback" />);
    expect(note()).toBeNull();
  });

  it("a split half's ungated stat row: only once a number is typed; a flip's lower half draws one", () => {
    render(<SecondHarness values={{ frame_style: { template: "split" } }} onlyWithValue />);
    expect(note()).toBeNull();
    fireEvent.change(screen.getByLabelText("Back power"), { target: { value: "3" } });
    expect(note()).toBeTruthy();
    setTemplate("flip");
    expect(note()).toBeNull();
    setTemplate("aftermath");
    expect(note()).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Back power"), { target: { value: " " } });
    expect(note()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// TODO 3b.19 — the note is tied to the inputs it is about. Under them on the
// screen, it was nothing to a screen reader on the inputs themselves: each
// of the two now points its `aria-describedby` at the note WHILE it shows
// (never at an id that is not on the page), in all three panels.
// ---------------------------------------------------------------------------

/** What `aria-describedby` says for a control: the text of every element it
 *  names, or null when it has none. Throws on an id that is not on the page. */
function describedBy(control: Element): string | null {
  const ids = control.getAttribute("aria-describedby");
  if (!ids) return null;
  return ids
    .split(/\s+/)
    .map((id) => {
      const el = document.getElementById(id);
      if (!el) throw new Error(`aria-describedby names #${id}, which is not on the page`);
      return el.textContent ?? "";
    })
    .join(" ");
}
const named = (name: string) => document.querySelector(`[name='${name}']`)!;

function PanelHarness({ values, children }: { values: Partial<FormValues>; children: React.ReactNode }) {
  const methods = useForm<FormValues>({ defaultValues: defaults(values) });
  return (
    <FormProvider {...methods}>
      <FramePick />
      {children}
    </FormProvider>
  );
}

describe("the note describes the Power and Toughness inputs (TODO 3b.19)", () => {
  it("the front (Abilities panel): both inputs while the note shows, neither once the frame draws them", () => {
    render(
      <FrontHarness
        values={{ card_type: "enchantment", supertype: "Creature", subtypes_text: "Saga Dragon", frame_style: { template: "saga" } }}
      />,
    );
    expect(describedBy(named("power"))).toBe(PT_NOT_DRAWN_NOTE);
    expect(describedBy(named("toughness"))).toBe(PT_NOT_DRAWN_NOTE);
    // The inputs keep their own short names.
    expect(screen.getByRole("textbox", { name: "Power" })).toBe(named("power"));
    expect(screen.getByRole("textbox", { name: "Toughness", description: PT_NOT_DRAWN_NOTE })).toBe(named("toughness"));
    setTemplate("nyx");
    expect(note()).toBeNull();
    expect(named("power").hasAttribute("aria-describedby")).toBe(false);
    expect(named("toughness").hasAttribute("aria-describedby")).toBe(false);
  });

  it("a double-faced card's back (back face panel): by the back BODY", () => {
    const { unmount } = render(
      <PanelHarness values={{ frame_style: { template: "m15mdfcfront" }, back_face: { ...EMPTY_BACK_FACE, card_type: "creature" } }}>
        <BackFaceStatsFields backBody="m15mdfclandback" />
      </PanelHarness>,
    );
    expect(describedBy(named("back_face.power"))).toBe(PT_NOT_DRAWN_NOTE);
    expect(describedBy(named("back_face.toughness"))).toBe(PT_NOT_DRAWN_NOTE);
    unmount();
    render(
      <PanelHarness values={{ frame_style: { template: "m15mdfcfront" }, back_face: { ...EMPTY_BACK_FACE, card_type: "creature" } }}>
        <BackFaceStatsFields backBody="m15mdfcback" />
      </PanelHarness>,
    );
    expect(note()).toBeNull();
    expect(named("back_face.power").hasAttribute("aria-describedby")).toBe(false);
  });

  it("a split half (second part panel): only once a number is typed", () => {
    render(
      <PanelHarness values={{ frame_style: { template: "split" } }}>
        <SecondPartStatsFields />
      </PanelHarness>,
    );
    expect(note()).toBeNull();
    expect(named("back_face.power").hasAttribute("aria-describedby")).toBe(false);
    fireEvent.change(named("back_face.power"), { target: { value: "3" } });
    expect(describedBy(named("back_face.power"))).toBe(PT_NOT_DRAWN_NOTE);
    expect(describedBy(named("back_face.toughness"))).toBe(PT_NOT_DRAWN_NOTE);
    // Loyalty and defense are not what the note is about.
    expect(named("back_face.loyalty").hasAttribute("aria-describedby")).toBe(false);
  });
});
