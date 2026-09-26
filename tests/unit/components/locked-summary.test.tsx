// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { FormProvider, useForm } from "react-hook-form";
import { LockedSummary } from "@/components/creator/locked-summary";
import { defaultValuesFor, remixValuesFrom } from "@/lib/creator/card-fields";
import type { FormValues } from "@/lib/creator/form-types";
import type { Card } from "@/types/card";

// ---------------------------------------------------------------------------
// The edit / remix summary ("Fixed for this card" / "Kept from the original")
// was the one screen where users saw the retired finish: it printed
// "Finish: Borderless" straight from the stored frame_style (TODO 0.25,
// migration 0119). Rendered here through the real form defaults, so the
// summary reads what the creator actually loads for a legacy card.
// ---------------------------------------------------------------------------

afterEach(cleanup);

function savedCard(frameStyle: unknown): Card {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    title: "Smothering Tithe",
    slug: "smothering-tithe",
    game_system_id: "00000000-0000-4000-8000-000000000009",
    cost: "{3}{W}",
    color_identity: ["white"],
    supertype: null,
    card_type: "enchantment",
    subtypes: [],
    tags: [],
    rarity: "rare",
    rules_text: "Whenever an opponent draws a card, that player may pay {2}.",
    flavor_text: null,
    power: null,
    toughness: null,
    loyalty: null,
    defense: null,
    artist_credit: null,
    art_url: null,
    art_position: {},
    frame_style: frameStyle,
    visibility: "public",
    back_face: null,
    back_card_id: null,
    source_scryfall_id: null,
    set_icon_url: null,
    set_icon_code: null,
    face_content: null,
    watermark: null,
    footer_text: null,
  } as unknown as Card;
}

function Harness({ values, mode }: { values: FormValues; mode: "edit" | "remix" }) {
  const methods = useForm<FormValues>({ defaultValues: values });
  return (
    <FormProvider {...methods}>
      <LockedSummary mode={mode} />
    </FormProvider>
  );
}

const facts = () =>
  screen.getByTestId("locked-summary").querySelector("dl")?.textContent ?? "";

describe("LockedSummary — a legacy 'borderless' card", () => {
  const legacy = savedCard({ finish: "borderless", template: "m15" });

  it("an edit says Finish Regular", () => {
    render(<Harness values={defaultValuesFor(legacy, [])} mode="edit" />);
    expect(facts()).toContain("FinishRegular");
    expect(facts()).not.toMatch(/borderless/i);
  });

  it("a remix says Finish Regular", () => {
    render(<Harness values={remixValuesFrom(legacy, [])} mode="remix" />);
    expect(facts()).toContain("FinishRegular");
    expect(facts()).not.toMatch(/borderless/i);
  });

  it("control: the raw stored value is what used to print 'Borderless'", () => {
    const raw = {
      ...defaultValuesFor(legacy, []),
      frame_style: { finish: "borderless", template: "m15" },
    } as unknown as FormValues;
    render(<Harness values={raw} mode="edit" />);
    expect(facts()).toContain("FinishBorderless");
  });

  it("a current finish reads back as itself", () => {
    render(
      <Harness
        values={defaultValuesFor(savedCard({ finish: "etched", template: "m15" }), [])}
        mode="edit"
      />,
    );
    expect(facts()).toContain("FinishEtched");
  });
});
