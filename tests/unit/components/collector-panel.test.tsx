// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FormProvider, useForm, useWatch } from "react-hook-form";
import {
  CollectorSwitches,
  FOIL_FINISH_STAR_NOTE,
  NO_COLLECTOR_SLOT_NOTE,
  collectorStyleExamples,
} from "@/components/creator/panels/collector-panel";
import { ANATOMY_HINTS } from "@/components/creator/panels/anatomy-panel";
import { NEW_CARD_ANATOMY } from "@/lib/cards/anatomy";
import type { FormValues } from "@/lib/creator/form-types";
import type { FrameStyle } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 4.9b — the collector line's switches on the Set & collector info
// step (owner decisions 2026-09-29): a new card starts with the line on
// (the 2023 style), a stored card from before the line shows it OFF with
// the one-line hint "New: add a collector line and holofoil stamp" until
// its owner switches it on — then in the 2015 style for a stored
// "107/281"-style number, else 2023 — and an explicit "off" shows no
// hint; the style chips swap the two styles; the ★ switch writes `true`
// or takes the key away; a frame without the slot says so instead.
// ---------------------------------------------------------------------------

afterEach(() => cleanup());

function Harness({
  frameStyle,
  stored = null,
  cardType = "creature",
  rarity = "mythic",
  collectorNumber = "",
}: {
  frameStyle: FrameStyle;
  stored?: FrameStyle | null;
  cardType?: string;
  rarity?: string;
  collectorNumber?: string;
}) {
  const methods = useForm<FormValues>({
    defaultValues: {
      card_type: cardType as FormValues["card_type"],
      supertype: "",
      rarity: rarity as FormValues["rarity"],
      frame_style: frameStyle,
      collector_number: collectorNumber,
    } as Partial<FormValues> as FormValues,
  });
  const style = useWatch({ control: methods.control, name: "frame_style" });
  return (
    <FormProvider {...methods}>
      <CollectorSwitches stored={stored} />
      <output data-testid="style">{JSON.stringify(style)}</output>
    </FormProvider>
  );
}

const styleOf = () => JSON.parse(screen.getByTestId("style").textContent ?? "{}") as FrameStyle;
const lineSwitch = () => screen.getByRole("switch", { name: "Collector line" });
const starSwitch = () => screen.queryByRole("switch", { name: "Foil printing (★)" });

describe("a new card", () => {
  it("starts with the line on in the 2023 style, the chips showing, no hint, the ★ off", () => {
    render(<Harness frameStyle={{ template: "m15", ...NEW_CARD_ANATOMY }} />);
    expect(lineSwitch().getAttribute("aria-checked")).toBe("true");
    expect(screen.queryByText(ANATOMY_HINTS.collector!)).toBeNull();
    expect(screen.getByTestId("collector-style")).toBeTruthy();
    expect(starSwitch()?.getAttribute("aria-checked")).toBe("false");
    // The chips name each style with the card's own letter: "M 0040" / "040/281 M".
    expect(screen.getByRole("radio", { name: /Current \(M 0040\)/ })).toBeTruthy();
    expect(screen.getByRole("radio", { name: /2015–2022 \(040\/281 M\)/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: /2015–2022/ }));
    expect(styleOf().collector).toBe("2015");
    fireEvent.click(lineSwitch());
    expect(styleOf().collector).toBe("off");
    expect(screen.queryByTestId("collector-style")).toBeNull();
    expect(starSwitch()).toBeNull();
  });

  it("the ★ switch writes true, and takes the key away again; a Foil finish says the ★ prints anyway", () => {
    render(<Harness frameStyle={{ template: "m15", finish: "foil", collector: "2023" }} />);
    expect(screen.getByTestId("collector-foil-note").textContent).toBe(FOIL_FINISH_STAR_NOTE);
    fireEvent.click(starSwitch()!);
    expect(styleOf().star).toBe(true);
    fireEvent.click(starSwitch()!);
    expect("star" in styleOf()).toBe(false);
  });
});

describe("a stored card (an edit)", () => {
  it("key-less: off with the hint; switching on picks 2015 for a number with a set size, else 2023", () => {
    render(<Harness frameStyle={{ template: "m15", finish: "regular" }} stored={{ template: "m15", finish: "regular" }} collectorNumber="107/281" />);
    expect(lineSwitch().getAttribute("aria-checked")).toBe("false");
    expect(screen.getByTestId("anatomy-hint-collector").textContent).toBe("New: add a collector line and holofoil stamp");
    fireEvent.click(lineSwitch());
    expect(styleOf().collector).toBe("2015");
    expect(screen.queryByTestId("anatomy-hint-collector")).toBeNull();
    cleanup();
    render(<Harness frameStyle={{ template: "m15", finish: "regular" }} stored={{ template: "m15", finish: "regular" }} collectorNumber="107" />);
    fireEvent.click(lineSwitch());
    expect(styleOf().collector).toBe("2023");
  });

  it("an explicit off shows no hint; a stored style shows on", () => {
    render(<Harness frameStyle={{ template: "m15", collector: "off" }} stored={{ template: "m15", collector: "off" }} />);
    expect(lineSwitch().getAttribute("aria-checked")).toBe("false");
    expect(screen.queryByTestId("anatomy-hint-collector")).toBeNull();
    cleanup();
    render(<Harness frameStyle={{ template: "m15", collector: "2015", star: true }} stored={{ template: "m15", collector: "2015", star: true }} />);
    expect(lineSwitch().getAttribute("aria-checked")).toBe("true");
    expect(starSwitch()?.getAttribute("aria-checked")).toBe("true");
    expect(screen.queryByTestId("anatomy-hint-collector")).toBeNull();
  });

  it("a remix (no stored card) starts on with no hint", () => {
    render(<Harness frameStyle={{ template: "m15", collector: "2023" }} />);
    expect(lineSwitch().getAttribute("aria-checked")).toBe("true");
    expect(screen.queryByTestId("anatomy-hint-collector")).toBeNull();
  });
});

describe("where the frame has no slot", () => {
  it("says the frame prints its own footer, and offers no switch", () => {
    for (const template of ["m15borderless", "lotr", "saga", "m20token"] as const) {
      render(<Harness frameStyle={{ template, collector: "2023" }} />);
      expect(screen.getByTestId("collector-no-slot").textContent).toBe(NO_COLLECTOR_SLOT_NOTE);
      expect(screen.queryByRole("switch", { name: "Collector line" })).toBeNull();
      cleanup();
    }
  });
});

describe("the chip examples", () => {
  it("read the card's letter and number — a token's T, an emblem's E, a sample number when none is filled", () => {
    expect(collectorStyleExamples({ cardType: "creature", rarity: "rare", collectorNumber: "107/281" })).toEqual({ "2023": "R 0107", "2015": "107/281 R" });
    expect(collectorStyleExamples({ cardType: "token", rarity: "rare", collectorNumber: "1/16" })).toEqual({ "2023": "T 0001", "2015": "001/016 T" });
    expect(collectorStyleExamples({ cardType: "emblem", collectorNumber: "24" })).toEqual({ "2023": "E 0024", "2015": "024 E" });
    expect(collectorStyleExamples({ cardType: "creature", rarity: null, collectorNumber: null })).toEqual({ "2023": "R 0040", "2015": "040/281 R" });
  });
});
